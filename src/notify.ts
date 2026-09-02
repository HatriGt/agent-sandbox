/**
 * Notifications — the missing half of walk-away (docs/features-2026-09.md §1).
 *
 * The product's premise is that the operator leaves; today the only way to learn that a box is
 * waiting on a question, finished, or failed is to come back and look. This module turns the fleet
 * sweep the controller already runs (~1.5 s cadence, src/fleet.ts) into pushes on exactly the three
 * transitions that matter. Everything here is pure or dependency-injected; the webhook POST and the
 * per-user webhook storage are wired in http.ts.
 *
 * Design rules:
 *  - EDGES only. A box first seen in a terminal state fires nothing — after a controller restart
 *    the first sweep hydrates history, and replaying "done" for every sleeping box would be noise
 *    that teaches the operator to ignore the channel.
 *  - A notification failure never breaks the sweep: send errors are swallowed and logged; a failed
 *    send is NOT marked delivered, so the next detection may retry.
 *  - Text leaving the server goes through the caller-provided redaction before send (http.ts).
 */

/** The slice of a fleet box view the detector needs. Kept minimal so tests need no full BoxView. */
export interface BoxRunView {
  name: string;
  runState: "running" | "waiting" | "done" | "idle";
  exitCode?: number;
  question?: string;
}

export interface NotifyEvent {
  box: string;
  kind: "waiting" | "done" | "failed";
  question?: string;
  exitCode?: number;
  /** Human note for special exit codes (interrupted / stopped by operator). */
  note?: string;
}

/** Exit codes the run wrapper uses for non-agent terminations (see msb.ts RUN_STATE_SH). */
const EXIT_INTERRUPTED = 254;
const EXIT_STOPPED = 253;

function terminalEvent(b: BoxRunView): NotifyEvent {
  const code = b.exitCode ?? 0;
  if (code === 0) return { box: b.name, kind: "done", exitCode: 0 };
  const note =
    code === EXIT_INTERRUPTED
      ? "interrupted (restart or send-now)"
      : code === EXIT_STOPPED
        ? "stopped by the operator"
        : undefined;
  return { box: b.name, kind: "failed", exitCode: code, ...(note ? { note } : {}) };
}

/**
 * Pure edge detection between two consecutive fleet sweeps.
 *
 * Fires on: →waiting (including a NEW question while already waiting — a second question is news),
 * and running/waiting→done, split into done (exit 0) vs failed (anything else). Boxes absent from
 * `prev` are hydration, not news. Boxes that vanished are torn down — teardown is operator-initiated,
 * so it needs no push.
 */
export function detectTransitions(prev: readonly BoxRunView[], next: readonly BoxRunView[]): NotifyEvent[] {
  const before = new Map(prev.map((b) => [b.name, b]));
  const out: NotifyEvent[] = [];
  for (const b of next) {
    const was = before.get(b.name);
    if (!was) continue; // first sighting: hydration, never a transition
    if (b.runState === "waiting") {
      const newQuestion = (b.question ?? "") !== "" && (was.runState !== "waiting" || was.question !== b.question);
      if (newQuestion) out.push({ box: b.name, kind: "waiting", question: b.question });
      continue;
    }
    if (b.runState === "done" && was.runState !== "done" && was.runState !== "idle") {
      out.push(terminalEvent(b));
    }
  }
  return out;
}

/**
 * Delivery wrapper: dedupe + failure isolation.
 *
 * Dedupe key is (box, kind, question) — an identical re-detection inside `cooldownMs` is suppressed
 * (the fleet sweep may re-derive the same edge from cached snapshots), while a still-unanswered
 * question may deliberately re-fire once the window elapses, as a reminder.
 */
export function makeNotifier(opts: {
  send: (e: NotifyEvent) => Promise<void>;
  cooldownMs?: number;
  now?: () => number;
  log?: (msg: string) => void;
}) {
  const cooldown = opts.cooldownMs ?? 5 * 60_000;
  const now = opts.now ?? Date.now;
  const log = opts.log ?? (() => {});
  const sentAt = new Map<string, number>();
  return {
    async notify(e: NotifyEvent): Promise<void> {
      const key = `${e.box}\n${e.kind}\n${e.question ?? ""}`;
      const last = sentAt.get(key);
      if (last !== undefined && now() - last < cooldown) return;
      try {
        await opts.send(e);
        sentAt.set(key, now()); // only a DELIVERED event suppresses the next one
      } catch (err) {
        log(`[notify] send failed for ${e.box}/${e.kind}: ${(err as Error).message}`);
      }
    },
  };
}

export interface NotificationText {
  /** One-line, human, leads with what happened. */
  text: string;
  /** Deep link to the box's thread. */
  url: string;
  event: NotifyEvent;
}

/**
 * The message a webhook receives. Leads with the outcome — the operator reads this on a phone.
 * `title` is the run's generated title (titles.ts); `headline` is the digest headline once feature 2
 * exists; both are optional and the box name is the fallback identity.
 */
export function formatNotification(
  e: NotifyEvent,
  ctx: { publicUrl: string; title?: string; task?: string; headline?: string }
): NotificationText {
  const label = ctx.title || ctx.task?.split("\n")[0] || e.box;
  const text =
    e.kind === "waiting"
      ? `“${label}” needs an answer: ${e.question}`
      : e.kind === "done"
        ? `“${label}” finished${ctx.headline ? ` — ${ctx.headline}` : ""} (${e.box})`
        : `“${label}” failed${e.note ? ` — ${e.note}` : ` (exit ${e.exitCode})`} (${e.box})`;
  return { text, url: `${ctx.publicUrl.replace(/\/+$/, "")}/dashboard/#/box/${e.box}`, event: e };
}

/**
 * A webhook target we are willing to store and POST to: http(s), a real host, and no credentials —
 * a user:pass URL would put a secret into the stored blob AND every request line/proxy log.
 */
export function isValidWebhookUrl(raw: unknown): boolean {
  if (typeof raw !== "string" || !raw) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  return (u.protocol === "https:" || u.protocol === "http:") && !!u.hostname && !u.username && !u.password;
}
