/**
 * The elicitation-driven A2A loop — the spec-correct way to run an interactive delegation.
 *
 * Why this exists: an MCP `tools/call` returns exactly ONE final result, and returning a result
 * ENDS the call — the calling agent is then free to do whatever it wants (in practice: stop and say
 * "I'll report back"). No instruction reliably prevents that. So instead of returning early, the
 * delegate/resume handler keeps the tool call OPEN and drives the whole conversation from inside it:
 *
 *   launch → waitForBoundary
 *     ├─ done            → return the result (the call ends naturally) ✅
 *     ├─ waiting(question) → ELICIT the question from the client (native prompt via elicitation/create),
 *     │                     get the user's answer, resume the box with it, and loop
 *     └─ timeout (still running) → emit a progress notification (keeps the call alive per spec) and loop
 *
 * Because the question is surfaced via a server→client elicitation REQUEST while the tool call is
 * still open, the agent literally cannot wander off — the protocol enforces the turn-taking. When the
 * client can't elicit (capability absent — e.g. CI or another MCP client), we fall back to handing
 * the question back as the result (the poll-based model), detected by the caller via capabilities.
 *
 * Pure by construction: poll / elicit / resume / progress / sleep are all injected, so the loop is
 * unit-tested with no VPS, no MCP transport, and no real timers.
 */
import { waitForBoundary, type PollResult } from "./wait.js";

/** The outcome of an elicitation: the user accepted (with an answer), or declined/cancelled. */
export interface ElicitOutcome {
  action: "accept" | "decline" | "cancel";
  /** Present when action==="accept": the user's free-text answer to feed back to the box. */
  answer?: string;
}

export interface InteractiveOpts {
  /** Poll the box's run state + status text + raw question (one SSH round-trip in prod). */
  poll: () => Promise<PollResult>;
  /**
   * Ask the client (the user) a question via native elicitation, returning their answer. Undefined
   * when the client didn't advertise the elicitation capability — then we fall back to returning the
   * question as the result (poll model).
   */
  elicit?: (question: string) => Promise<ElicitOutcome>;
  /** Continue the box's session with the user's answer (resumeAgentTask in prod). */
  resume: (answer: string) => Promise<void>;
  /** Emit a progress notification to keep a long, question-less run alive (optional). */
  progress?: (message: string) => Promise<void>;
  /** Sleep (injected for tests). */
  sleep: (ms: number) => Promise<void>;
  /** Wall clock (injected; defaults to Date.now). */
  now?: () => number;
  /** How long each wait window blocks before emitting progress and looping. */
  timeoutMs: number;
  /** Poll interval within a wait window. */
  intervalMs: number;
}

export type InteractiveStatus = "done" | "cancelled" | "waiting";

export interface InteractiveResult {
  /** done = run finished; cancelled = user declined a question; waiting = fallback (no elicit). */
  status: InteractiveStatus;
  /** Human text to return from the tool call (the result, or the pending question in fallback). */
  text: string;
}

/**
 * Drive an interactive delegation to completion. Loops wait→(elicit→resume)→wait until the box is
 * done or the user declines. On a question-less timeout window it emits progress and keeps waiting
 * (the run keeps going in the box; progress keeps the client's request alive).
 */
export async function runInteractive(opts: InteractiveOpts): Promise<InteractiveResult> {
  for (;;) {
    const w = await waitForBoundary({
      poll: opts.poll,
      sleep: opts.sleep,
      now: opts.now,
      timeoutMs: opts.timeoutMs,
      intervalMs: opts.intervalMs,
    });

    // Still running after a full window: keep the call alive with a progress ping and wait again.
    if (!w.reached) {
      await opts.progress?.("still working…");
      continue;
    }

    // Finished — return the result; the tool call ends naturally.
    if (w.state === "done") {
      return { status: "done", text: w.text };
    }

    // Waiting on a question. Without elicitation support, hand it back as the result (poll fallback).
    if (!opts.elicit) {
      return { status: "waiting", text: w.text };
    }

    // Ask the user natively (server→client request mid tool-call), then continue the box.
    const question = w.question ?? w.text;
    let outcome: ElicitOutcome;
    try {
      outcome = await opts.elicit(question);
    } catch {
      // The elicitation round-trip FAILED (transport cancel, client approval-card timeout, network).
      // This is NOT a user decline — the box is still genuinely waiting. Do NOT stop it: return the
      // pending question so the caller reconnects (status/resume) and answers it. The box keeps its
      // place; nothing is lost.
      return { status: "waiting", text: w.text };
    }
    // Only an explicit user decline/cancel stops the run.
    if (outcome.action !== "accept") {
      return {
        status: "cancelled",
        text: `Cancelled: you ${outcome.action}d the question — the delegation was stopped without answering.`,
      };
    }
    await opts.resume(outcome.answer ?? "");
    // loop: wait for the next boundary (another question, or done).
  }
}
