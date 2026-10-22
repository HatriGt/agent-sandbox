import * as React from "react";
import { api, type AskResult } from "./api";

/**
 * One box's side conversation: questions answered from inside the sandbox by a read-only helper,
 * never seen by the agent. Settled turns are a list; the in-flight one is a single slot, so two
 * asks racing the box's one ask session is unrepresentable.
 */
export interface SideChat {
  readonly turns: readonly SettledTurn[];
  readonly pending: PendingTurn | null;
  readonly open: boolean;
  /** Turns that settled after this instant are unread. The count is derived, never stored. */
  readonly readAt: number;
  readonly draft: string;
  /** Text selected in the conversation, attached to the next question. Already clipped to QUOTE_MAX. */
  readonly quote: string | null;
}

export type TurnId = string & { readonly __brand: "TurnId" };

export interface PendingTurn {
  readonly id: TurnId;
  /** Exactly what went over the wire: the quote as `> ` lines, a blank line, then the text. */
  readonly question: string;
  readonly askedAt: number;
  /** The quoted selection, when the question carried one, so the bubble can render it as a block. */
  readonly quote?: string;
}

interface TurnBase extends PendingTurn {
  readonly at: number;
}

export type SettledTurn =
  | (TurnBase & {
      readonly kind: "answered";
      readonly answer: string;
      readonly partial: boolean;
      /** false when the box started a new ask thread (the driver's task changed). */
      readonly continued: boolean;
      readonly driverState?: string;
    })
  | (TurnBase & { readonly kind: "failed"; readonly error: string });

export const MAX_TURNS = 40;
export const QUOTE_MAX = 1500;
/** Sent when a quote is attached and the draft is empty; the composer shows it as the placeholder. */
export const DEFAULT_QUOTE_QUESTION = "Explain this.";

export const EMPTY: SideChat = { turns: [], pending: null, open: false, readAt: 0, draft: "", quote: null };

export type SideEvent =
  | { type: "open" }
  | { type: "close" }
  | { type: "toggle" }
  | { type: "draft"; text: string }
  | { type: "quote"; text: string }
  | { type: "unquote" }
  | { type: "asked"; turn: PendingTurn; replaces?: TurnId }
  | { type: "settled"; turn: SettledTurn }
  | { type: "read" }
  | { type: "forget" };

export function reduce(chat: SideChat, ev: SideEvent): SideChat {
  switch (ev.type) {
    case "open":
      return chat.open ? chat : { ...chat, open: true };
    case "close":
      return chat.open ? { ...chat, open: false } : chat;
    case "toggle":
      return { ...chat, open: !chat.open };
    case "draft":
      return chat.draft === ev.text ? chat : { ...chat, draft: ev.text };
    case "quote": {
      const quote = clipQuote(ev.text);
      if (!quote) return chat;
      return { ...chat, quote, open: true };
    }
    case "unquote":
      return chat.quote === null ? chat : { ...chat, quote: null };
    case "asked":
      if (chat.pending) return chat;
      return {
        ...chat,
        turns: ev.replaces ? chat.turns.filter((t) => t.id !== ev.replaces) : chat.turns,
        pending: ev.turn,
        open: true,
        draft: "",
        quote: null,
      };
    case "settled":
      if (chat.pending?.id !== ev.turn.id) return chat;
      return { ...chat, pending: null, turns: [...chat.turns, ev.turn].slice(-MAX_TURNS) };
    case "read": {
      // Marks everything settled so far as read, so a repeat is a no-op (an effect may fire it often).
      const last = chat.turns.length ? chat.turns[chat.turns.length - 1].at : 0;
      return chat.readAt >= last ? chat : { ...chat, readAt: last };
    }
    case "forget":
      return chat.turns.length ? { ...chat, turns: [] } : chat;
  }
}

export function unreadCount(chat: SideChat): number {
  let n = 0;
  for (const t of chat.turns) if (t.at > chat.readAt) n++;
  return n;
}

/** Trimmed and capped at QUOTE_MAX with an ellipsis; null when nothing is left. */
export function clipQuote(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  return t.length > QUOTE_MAX ? `${t.slice(0, QUOTE_MAX).trimEnd()}…` : t;
}

/** Markdown quote lines: every line prefixed with `> `. Shared with the main composer's "Quote in reply". */
export function asQuote(text: string): string {
  return text
    .trim()
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
}

/** The wire form of a question: the quote as `> ` lines, a blank line, then the text. */
export function composeQuestion(quote: string | null, text: string): string {
  return quote ? `${asQuote(quote)}\n\n${text}` : text;
}

/** The typed part of a turn's question, with the quote prefix removed. */
export function questionBody(turn: PendingTurn): string {
  if (!turn.quote) return turn.question;
  const prefix = `${asQuote(turn.quote)}\n\n`;
  return turn.question.startsWith(prefix) ? turn.question.slice(prefix.length) : turn.question;
}

export const RELOADED_ERROR = "The page reloaded before the answer arrived";

/* ───────────────────────── store: per box, outside React ───────────────────────── */

const KEY = (box: string) => `asb-sidechat:${box}`;
const chats = new Map<string, SideChat>();
const listeners = new Map<string, Set<() => void>>();

function get(box: string): SideChat {
  let chat = chats.get(box);
  if (!chat) {
    chat = load(box);
    chats.set(box, chat);
  }
  return chat;
}

function dispatch(box: string, ev: SideEvent) {
  const before = get(box);
  const after = reduce(before, ev);
  if (after === before) return;
  chats.set(box, after);
  save(box, after);
  listeners.get(box)?.forEach((fn) => fn());
}

function subscribe(box: string, fn: () => void) {
  let set = listeners.get(box);
  if (!set) listeners.set(box, (set = new Set()));
  set.add(fn);
  return () => {
    set.delete(fn);
  };
}

function load(box: string): SideChat {
  try {
    const raw = localStorage.getItem(KEY(box));
    if (!raw) return EMPTY;
    const p = JSON.parse(raw) as Partial<SideChat>;
    const turns = Array.isArray(p.turns) ? p.turns.filter(isSettled).slice(-MAX_TURNS) : [];
    const pending = p.pending && typeof p.pending.question === "string" ? p.pending : null;
    if (pending) turns.push({ ...pending, at: Date.now(), kind: "failed", error: RELOADED_ERROR });
    return {
      turns,
      pending: null,
      open: p.open === true,
      readAt: typeof p.readAt === "number" ? p.readAt : 0,
      draft: typeof p.draft === "string" ? p.draft : "",
      quote: typeof p.quote === "string" ? clipQuote(p.quote) : null,
    };
  } catch {
    return EMPTY;
  }
}

function isSettled(t: unknown): t is SettledTurn {
  if (!t || typeof t !== "object") return false;
  const x = t as Record<string, unknown>;
  if (x.quote !== undefined && typeof x.quote !== "string") return false;
  return typeof x.id === "string" && typeof x.question === "string" && typeof x.at === "number" && (x.kind === "answered" ? typeof x.answer === "string" : x.kind === "failed" && typeof x.error === "string");
}

function save(box: string, chat: SideChat) {
  try {
    if (chat === EMPTY) localStorage.removeItem(KEY(box));
    else localStorage.setItem(KEY(box), JSON.stringify(chat));
  } catch {
    /* storage full or blocked: the chat still works for this tab */
  }
}

function settleFromWire(pending: PendingTurn, res: AskResult): SettledTurn {
  return { ...pending, at: Date.now(), kind: "answered", answer: res.answer, partial: res.timedOut, continued: res.continued, driverState: res.driverState };
}

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` as TurnId;

function send(box: string, turn: PendingTurn, replaces?: TurnId) {
  if (get(box).pending) return;
  dispatch(box, { type: "asked", turn, replaces });
  api.ask(box, turn.question).then(
    (res) => dispatch(box, { type: "settled", turn: settleFromWire(turn, res) }),
    (e: unknown) => dispatch(box, { type: "settled", turn: { ...turn, at: Date.now(), kind: "failed", error: e instanceof Error ? e.message : String(e) } })
  );
}

function ask(box: string, text: string) {
  const { quote } = get(box);
  const body = text.trim() || (quote ? DEFAULT_QUOTE_QUESTION : "");
  if (!body) return;
  send(box, { id: newId(), question: composeQuestion(quote, body), askedAt: Date.now(), ...(quote ? { quote } : {}) });
}

/** Drop the box's chat from memory and storage (teardown). Safe for an unknown box. */
export function forgetSideChat(box: string) {
  chats.delete(box);
  try {
    localStorage.removeItem(KEY(box));
  } catch {
    /* ignore */
  }
  listeners.get(box)?.forEach((fn) => fn());
}

export interface SideChatHandle {
  readonly chat: SideChat;
  readonly unread: number;
  open(): void;
  close(): void;
  toggle(): void;
  setDraft(text: string): void;
  /** Attach selected text to the next question and open the surface. Blank text is ignored. */
  quote(text: string): void;
  unquote(): void;
  /**
   * Appends a pending turn, opens the surface, asks the box, settles. The attached quote travels with
   * it; with a quote and a blank text, DEFAULT_QUOTE_QUESTION is sent. No-op while a turn is pending
   * or there is nothing to send.
   */
  ask(text: string): void;
  /** Re-ask a failed turn's question, verbatim, in its place. */
  retry(id: TurnId): void;
  /** Clear the client turns only; the server's ask thread is untouched. */
  startFresh(): void;
  markRead(): void;
}

export function useSideChat(box: string): SideChatHandle {
  const chat = React.useSyncExternalStore(
    React.useCallback((fn: () => void) => subscribe(box, fn), [box]),
    () => get(box),
    () => EMPTY
  );
  const verbs = React.useMemo(
    () => ({
      open: () => dispatch(box, { type: "open" }),
      close: () => dispatch(box, { type: "close" }),
      toggle: () => dispatch(box, { type: "toggle" }),
      setDraft: (text: string) => dispatch(box, { type: "draft", text }),
      quote: (text: string) => dispatch(box, { type: "quote", text }),
      unquote: () => dispatch(box, { type: "unquote" }),
      ask: (text: string) => ask(box, text),
      retry: (id: TurnId) => {
        const failed = get(box).turns.find((t) => t.id === id);
        if (failed) send(box, { id: newId(), question: failed.question, askedAt: Date.now(), ...(failed.quote ? { quote: failed.quote } : {}) }, id);
      },
      startFresh: () => dispatch(box, { type: "forget" }),
      markRead: () => dispatch(box, { type: "read" }),
    }),
    [box]
  );
  return React.useMemo(() => ({ chat, unread: unreadCount(chat), ...verbs }), [chat, verbs]);
}
