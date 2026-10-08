// Local activity feed: state edges observed while the app is open, plus the merge that turns the
// server audit feed, finished ledger runs and those edges into one timeline (web Activity page).
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { AuditEventRow, BoxView, LedgerRow } from "./api";
import { describeEvent, eventKind, type AuditKind } from "./audit";

export type ActivityEvent = {
  id: string;
  at: number;
  box: string;
  title?: string;
  kind: "waiting" | "done" | "failed" | "started" | "stalled";
  detail?: string;
};

const KEY = "asb-activity";
const CAP = 200;

let cache: ActivityEvent[] | null = null;
const listeners = new Set<() => void>();
const edgeListeners = new Set<(ev: ActivityEvent) => void>();

export async function loadActivity(): Promise<ActivityEvent[]> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as ActivityEvent[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

export function subscribeActivity(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Fires once per detected edge with the event itself (in-app toasts); the feed uses subscribeActivity. */
export function subscribeEdges(fn: (ev: ActivityEvent) => void): () => void {
  edgeListeners.add(fn);
  return () => {
    edgeListeners.delete(fn);
  };
}

async function push(ev: ActivityEvent) {
  const list = await loadActivity();
  cache = [ev, ...list].slice(0, CAP);
  listeners.forEach((fn) => fn());
  edgeListeners.forEach((fn) => fn(ev));
  AsyncStorage.setItem(KEY, JSON.stringify(cache)).catch(() => {});
}

export async function clearActivity() {
  cache = [];
  listeners.forEach((fn) => fn());
  await AsyncStorage.removeItem(KEY);
}

type RunView = { runState: string; exitCode?: number; question?: string; stalled: boolean };
let prev = new Map<string, RunView>();
let hydrated = false;

/**
 * Edge detection over fleet sweeps — first sighting is hydration, never an event. Mirrors the
 * web Activity page's live edges: asked a question, finished/failed, started, stalled.
 */
export function detectEdges(boxes: BoxView[]) {
  const next = new Map<string, RunView>();
  for (const b of boxes) {
    if (b.role === "pool-free") continue;
    next.set(b.name, { runState: b.runState, exitCode: b.exitCode, question: b.question, stalled: !!b.stalled });
  }
  if (hydrated) {
    const now = Date.now();
    for (const [name, cur] of next) {
      const was = prev.get(name);
      if (!was) continue;
      const box = boxes.find((b) => b.name === name)!;
      const title = box.title ?? box.task?.slice(0, 80);
      if (cur.runState === "waiting" && (was.runState !== "waiting" || (cur.question && cur.question !== was.question))) {
        void push({ id: `${name}-${now}-ask`, at: now, box: name, title, kind: "waiting", detail: cur.question?.split("\n")[0] });
      } else if (cur.runState === "done" && was.runState !== "done") {
        void push({
          id: `${name}-${now}-fin`,
          at: now,
          box: name,
          title,
          kind: cur.exitCode === 0 ? "done" : "failed",
          detail: cur.exitCode === 0 ? undefined : `exit ${cur.exitCode}`,
        });
      } else if (cur.runState === "running" && was.runState !== "running") {
        void push({ id: `${name}-${now}-run`, at: now, box: name, title, kind: "started" });
      }
      if (cur.stalled && !was.stalled) {
        void push({ id: `${name}-${now}-stall`, at: now, box: name, title, kind: "stalled" });
      }
    }
  }
  prev = next;
  hydrated = true;
}

// ---- the timeline (web/src/components/Activity.tsx `Row`) ----

export type RowTone = "live" | "ok" | "muted" | "destructive" | "attention";

/**
 * One line of the Activity timeline. Three sources, one shape:
 *  - `audit`: a stored audit row (what you did, as the server recorded it);
 *  - `run`:   a finished ledger run — links to that run in History;
 *  - `live`:  a fleet transition this device saw while open (asked a question, finished, stalled).
 */
export interface TimelineRow {
  id: string;
  at: number;
  kind: AuditKind;
  verb: string;
  box: string | null;
  detail?: string;
  tone: RowTone;
  status: string;
  /** Ledger id: the row links to that run in History instead of repeating its receipt. */
  run?: number;
}

export function auditRow(e: AuditEventRow): TimelineRow | null {
  const at = Date.parse(e.at);
  if (!Number.isFinite(at)) return null;
  const d = describeEvent(e);
  const kind = eventKind(e);
  const failed = e.status >= 400;
  return {
    id: `a${e.id}`,
    at,
    kind,
    verb: d.verb,
    box: d.session,
    tone: failed ? "destructive" : kind === "machines" ? "live" : kind === "code" ? "ok" : "muted",
    status: failed ? `failed ${e.status}` : kind,
  };
}

/** A finished ledger run, as one row. Its start is already the audit's "Started a machine". */
export function runRow(r: LedgerRow): TimelineRow {
  const failed = r.state === "failed";
  return {
    id: `re${r.id}`,
    at: r.endedAt || r.archivedAt,
    kind: "machines",
    verb: failed ? "Run failed on" : "Run finished on",
    box: r.box,
    detail: r.headline || undefined,
    tone: failed ? "destructive" : "ok",
    status: failed ? "failed" : "finished",
    run: r.id,
  };
}

/** A device-local edge, in the same words the web page uses for its live rows. */
export function localRow(e: ActivityEvent): TimelineRow {
  const base = { id: `l${e.id}`, at: e.at, kind: "machines" as const, box: e.box };
  switch (e.kind) {
    case "waiting":
      return { ...base, verb: "Asked a question on", detail: e.detail, tone: "attention", status: "waiting" };
    case "done":
      return { ...base, verb: "Run finished on", detail: e.title, tone: "ok", status: "finished" };
    case "failed":
      return { ...base, verb: "Run failed on", detail: e.title, tone: "destructive", status: "failed" };
    case "started":
      return { ...base, verb: "Run started on", detail: e.title, tone: "live", status: "started" };
    case "stalled":
      return { ...base, verb: "No output for a while on", tone: "attention", status: "stalled" };
  }
}

export type ActivityFilter = "all" | AuditKind | "failed";
export const ACTIVITY_FILTERS: { value: ActivityFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "machines", label: "Machines" },
  { value: "code", label: "Code" },
  { value: "account", label: "Account" },
  { value: "failed", label: "Failed" },
];

const day = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
function dayKey(ms: number) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
/** "Today" / "Yesterday" / "Sep 3" — the timeline's day headers. Epoch milliseconds. */
export function dayLabel(ms: number) {
  const k = dayKey(ms);
  if (k === dayKey(Date.now())) return "Today";
  if (k === dayKey(Date.now() - 86400_000)) return "Yesterday";
  return day.format(ms);
}
