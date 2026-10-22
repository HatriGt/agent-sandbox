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
}

export type TurnId = string & { readonly __brand: "TurnId" };

export interface PendingTurn {
  readonly id: TurnId;
  readonly question: string;
  readonly askedAt: number;
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

export const EMPTY: SideChat = { turns: [], pending: null, open: false, readAt: 0, draft: "" };

export type SideEvent =
  | { type: "open" }
  | { type: "close" }
  | { type: "toggle" }
  | { type: "draft"; text: string }
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
    case "asked":
      if (chat.pending) return chat;
      return {
        ...chat,
        turns: ev.replaces ? chat.turns.filter((t) => t.id !== ev.replaces) : chat.turns,
        pending: ev.turn,
        open: true,
        draft: "",
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
    };
  } catch {
    return EMPTY;
  }
}

function isSettled(t: unknown): t is SettledTurn {
  if (!t || typeof t !== "object") return false;
  const x = t as Record<string, unknown>;
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

function ask(box: string, question: string, replaces?: TurnId) {
  const q = question.trim();
  if (!q || get(box).pending) return;
  const turn: PendingTurn = { id: newId(), question: q, askedAt: Date.now() };
  dispatch(box, { type: "asked", turn, replaces });
  api.ask(box, q).then(
    (res) => dispatch(box, { type: "settled", turn: settleFromWire(turn, res) }),
    (e: unknown) => dispatch(box, { type: "settled", turn: { ...turn, at: Date.now(), kind: "failed", error: e instanceof Error ? e.message : String(e) } })
  );
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
  /** Appends a pending turn, opens the surface, asks the box, settles. No-op while a turn is pending or the question is blank. */
  ask(question: string): void;
  /** Re-ask a failed turn's question in its place. */
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
      ask: (question: string) => ask(box, question),
      retry: (id: TurnId) => {
        const failed = get(box).turns.find((t) => t.id === id);
        if (failed) ask(box, failed.question, id);
      },
      startFresh: () => dispatch(box, { type: "forget" }),
      markRead: () => dispatch(box, { type: "read" }),
    }),
    [box]
  );
  return React.useMemo(() => ({ chat, unread: unreadCount(chat), ...verbs }), [chat, verbs]);
}
