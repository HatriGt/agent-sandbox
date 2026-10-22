// One box's side conversation: the read-only "ask the sandbox" lane. The server already keeps it
// as a separate session (own cwd, own `claude -c`, never fed to the driver); this is the client's
// copy. It lives outside React so an answer lands in the right box after the user navigated away,
// and in AsyncStorage so it survives the app being killed. Only this file sees /ask.json's reply.
import { useCallback, useMemo, useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api, type AskResult } from "@/lib/api";

export type TurnId = string & { readonly __brand: "TurnId" };

export interface PendingTurn {
  readonly id: TurnId;
  readonly question: string;
  readonly askedAt: number;
}

export type SettledTurn =
  | {
      readonly id: TurnId;
      readonly question: string;
      readonly askedAt: number;
      readonly at: number;
      readonly kind: "answered";
      readonly answer: string;
      /** The box stopped answering before it finished (timed out). */
      readonly partial: boolean;
      /** false when the box started a new ask thread because the driver's task changed. */
      readonly continued: boolean;
      readonly driverState?: string;
    }
  | {
      readonly id: TurnId;
      readonly question: string;
      readonly askedAt: number;
      readonly at: number;
      readonly kind: "failed";
      readonly error: string;
    };

/** Settled turns are a list; the in-flight one is a slot, so two asks racing the box's one
 *  claude session is unrepresentable. */
export interface SideChat {
  readonly turns: readonly SettledTurn[];
  readonly pending: PendingTurn | null;
  readonly open: boolean;
  /** Turns that settled after this instant are unread. `unread` is derived, never stored. */
  readonly readAt: number;
  readonly draft: string;
}

export type SideEvent =
  | { type: "open" }
  | { type: "close" }
  | { type: "toggle" }
  | { type: "draft"; text: string }
  | { type: "asked"; turn: PendingTurn }
  | { type: "settled"; turn: SettledTurn }
  | { type: "read"; at: number }
  | { type: "forget" };

export const MAX_TURNS = 40;

export const EMPTY: SideChat = { turns: [], pending: null, open: false, readAt: 0, draft: "" };

export const RELOADED_ERROR = "The app reloaded before the answer arrived";

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
      return { ...chat, pending: ev.turn, open: true, draft: "" };
    case "settled":
      if (chat.pending?.id !== ev.turn.id) return chat;
      return { ...chat, pending: null, turns: [...chat.turns, ev.turn].slice(-MAX_TURNS) };
    case "read":
      return chat.readAt === ev.at ? chat : { ...chat, readAt: ev.at };
    case "forget":
      return chat.turns.length === 0 ? chat : { ...chat, turns: [] };
  }
}

export function unreadCount(chat: SideChat): number {
  let n = 0;
  for (const t of chat.turns) if (t.at > chat.readAt) n++;
  return n;
}

export interface SideChatHandle {
  readonly chat: SideChat;
  readonly unread: number;
  open(): void;
  close(): void;
  toggle(): void;
  setDraft(text: string): void;
  /** Appends a pending turn, opens the sheet, asks the box, settles. No-op while a turn is
   *  pending or the question is blank. */
  ask(question: string): void;
  /** Drops the settled turns; a pending answer still lands. */
  startFresh(): void;
}

const KEY = (box: string) => `asb-sidechat:${box}`;
const SAVE_DEBOUNCE_MS = 300;

const chats = new Map<string, SideChat>();
const listeners = new Map<string, Set<() => void>>();
const hydrating = new Set<string>();
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

function get(box: string): SideChat {
  return chats.get(box) ?? EMPTY;
}

function set(box: string, next: SideChat) {
  if (next === get(box)) return;
  chats.set(box, next);
  scheduleSave(box, next);
  listeners.get(box)?.forEach((l) => l());
}

/** The one place that touches the clock: a settled turn is read the moment it lands in an open sheet. */
function dispatch(box: string, ev: SideEvent) {
  let next = reduce(get(box), ev);
  if (next.open && unreadCount(next) > 0) next = reduce(next, { type: "read", at: Date.now() });
  set(box, next);
}

function touch(box: string) {
  if (hydrating.has(box)) return;
  hydrating.add(box);
  void load(box).then((loaded) => {
    if (!hydrating.has(box)) return;
    const cur = chats.get(box);
    set(box, cur ? { ...loaded, ...cur, turns: [...loaded.turns, ...cur.turns].slice(-MAX_TURNS) } : loaded);
  });
}

function scheduleSave(box: string, chat: SideChat) {
  const prev = saveTimers.get(box);
  if (prev) clearTimeout(prev);
  saveTimers.set(
    box,
    setTimeout(() => {
      saveTimers.delete(box);
      AsyncStorage.setItem(KEY(box), JSON.stringify(chat)).catch(() => {});
    }, SAVE_DEBOUNCE_MS),
  );
}

async function load(box: string): Promise<SideChat> {
  try {
    const raw = await AsyncStorage.getItem(KEY(box));
    return raw ? parse(JSON.parse(raw)) : EMPTY;
  } catch {
    return EMPTY;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const str = (v: unknown) => (typeof v === "string" ? v : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function parseTurn(v: unknown): SettledTurn | null {
  if (!isRecord(v)) return null;
  const id = str(v.id);
  const question = str(v.question);
  const askedAt = num(v.askedAt);
  const at = num(v.at);
  if (id === null || question === null || askedAt === null || at === null) return null;
  const base = { id: id as TurnId, question, askedAt, at };
  if (v.kind === "answered") {
    const answer = str(v.answer);
    if (answer === null) return null;
    const driverState = str(v.driverState);
    return { ...base, kind: "answered", answer, partial: v.partial === true, continued: v.continued !== false, ...(driverState !== null ? { driverState } : {}) };
  }
  if (v.kind === "failed") {
    const error = str(v.error);
    return error === null ? null : { ...base, kind: "failed", error };
  }
  return null;
}

/** Storage to domain. A pending turn that was persisted is an answer this process will never
 *  receive, so it comes back failed with a Retry. The sheet never reopens itself on launch. */
function parse(v: unknown): SideChat {
  if (!isRecord(v)) return EMPTY;
  const turns: SettledTurn[] = [];
  for (const t of Array.isArray(v.turns) ? v.turns : []) {
    const turn = parseTurn(t);
    if (turn) turns.push(turn);
  }
  if (isRecord(v.pending)) {
    const id = str(v.pending.id);
    const question = str(v.pending.question);
    const askedAt = num(v.pending.askedAt);
    if (id !== null && question !== null && askedAt !== null) {
      turns.push({ id: id as TurnId, question, askedAt, at: askedAt, kind: "failed", error: RELOADED_ERROR });
    }
  }
  return { turns: turns.slice(-MAX_TURNS), pending: null, open: false, readAt: num(v.readAt) ?? 0, draft: str(v.draft) ?? "" };
}

function fromWire(p: PendingTurn, r: AskResult): SettledTurn {
  return { ...p, at: Date.now(), kind: "answered", answer: r.answer, partial: r.timedOut, continued: r.continued, ...(r.driverState ? { driverState: r.driverState } : {}) };
}

function newId(): TurnId {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` as TurnId;
}

function ask(box: string, question: string) {
  const q = question.trim();
  if (!q || get(box).pending) return;
  touch(box);
  const turn: PendingTurn = { id: newId(), question: q, askedAt: Date.now() };
  dispatch(box, { type: "asked", turn });
  api.ask(box, q).then(
    (r) => dispatch(box, { type: "settled", turn: fromWire(turn, r) }),
    (e: unknown) => dispatch(box, { type: "settled", turn: { ...turn, at: Date.now(), kind: "failed", error: e instanceof Error ? e.message : String(e) } }),
  );
}

export function useSideChat(box: string): SideChatHandle {
  const subscribe = useCallback(
    (cb: () => void) => {
      touch(box);
      let subs = listeners.get(box);
      if (!subs) listeners.set(box, (subs = new Set()));
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    [box],
  );
  const chat = useSyncExternalStore(subscribe, () => get(box));
  return useMemo(
    () => ({
      chat,
      unread: unreadCount(chat),
      open: () => dispatch(box, { type: "open" }),
      close: () => dispatch(box, { type: "close" }),
      toggle: () => dispatch(box, { type: "toggle" }),
      setDraft: (text: string) => dispatch(box, { type: "draft", text }),
      ask: (question: string) => ask(box, question),
      startFresh: () => dispatch(box, { type: "forget" }),
    }),
    [box, chat],
  );
}

/** Teardown: drop the box's chat from memory and storage. Safe for an unknown box. */
export function forgetSideChat(box: string) {
  const prev = saveTimers.get(box);
  if (prev) clearTimeout(prev);
  saveTimers.delete(box);
  hydrating.delete(box);
  chats.delete(box);
  listeners.get(box)?.forEach((l) => l());
  AsyncStorage.removeItem(KEY(box)).catch(() => {});
}
