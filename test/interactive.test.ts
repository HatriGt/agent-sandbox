/**
 * Tests for runInteractive — the elicitation-driven A2A loop.
 *
 * This is the real fix: instead of returning a "poll status yourself" string (a FINAL tool result
 * that ends the call and lets the agent wander off), the delegate/resume handler drives the whole
 * conversation INSIDE the still-open tool call:
 *   launch → wait for boundary → on `waiting`, ELICIT the question from the client (native prompt) →
 *   feed the answer back via resume → wait again → … → on `done`, return the result.
 *
 * Pure by construction: poll, elicit, resume, progress and sleep are all injected, so we test the
 * turn-taking with no VPS, no MCP transport, and no timers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runInteractive } from "../src/interactive.ts";
import type { PollResult } from "../src/wait.ts";

const wait = (q: string): PollResult => ({ state: "waiting", text: `run:waiting\n${q}`, question: q });
const running = (): PollResult => ({ state: "running", text: "run:running" });
const done = (): PollResult => ({ state: "done", text: "run:done exit=0\nPR: https://x/pr/1" });

const baseOpts = { sleep: async () => {}, timeoutMs: 10_000, intervalMs: 10 };

test("done with no question: returns the result, never elicits", async () => {
  let elicits = 0;
  const polls = [done()];
  let i = 0;
  const r = await runInteractive({
    ...baseOpts,
    poll: async () => polls[Math.min(i++, polls.length - 1)],
    elicit: async () => {
      elicits++;
      return { action: "accept", answer: "x" };
    },
    resume: async () => {},
  });
  assert.equal(r.status, "done");
  assert.match(r.text, /PR: https/);
  assert.equal(elicits, 0, "no question => no elicitation");
});

test("waiting: elicits the question, resumes with the answer, then completes", async () => {
  // poll sequence: waiting -> (after resume) done
  const seq: PollResult[] = [wait("Which npm tag? A/B"), done()];
  let i = 0;
  let elicitedWith = "";
  let resumedWith = "";
  const r = await runInteractive({
    ...baseOpts,
    poll: async () => seq[Math.min(i++, seq.length - 1)],
    elicit: async (question: string) => {
      elicitedWith = question;
      return { action: "accept", answer: "A" };
    },
    resume: async (answer: string) => {
      resumedWith = answer;
    },
  });
  assert.match(elicitedWith, /Which npm tag/, "the box's question is elicited from the client");
  assert.equal(resumedWith, "A", "the user's answer is fed back via resume");
  assert.equal(r.status, "done");
  assert.match(r.text, /PR: https/);
});

test("multi-turn: two questions then done", async () => {
  const seq: PollResult[] = [wait("Q1?"), wait("Q2?"), done()];
  let i = 0;
  const asked: string[] = [];
  const answered: string[] = [];
  const r = await runInteractive({
    ...baseOpts,
    poll: async () => seq[Math.min(i++, seq.length - 1)],
    elicit: async (q: string) => {
      asked.push(q);
      return { action: "accept", answer: `ans-${asked.length}` };
    },
    resume: async (a: string) => {
      answered.push(a);
    },
  });
  assert.deepEqual(asked, ["Q1?", "Q2?"]);
  assert.deepEqual(answered, ["ans-1", "ans-2"]);
  assert.equal(r.status, "done");
});

test("user declines the elicitation (box no longer waiting): stops, does NOT resume, reports cancelled", async () => {
  // Genuine decline: after declining, the box is no longer waiting (the re-poll confirms it stopped).
  const seq: PollResult[] = [
    wait("Proceed with destructive migration?"), // boundary → elicit
    { state: "idle", text: "run:idle" }, // re-poll after decline → not waiting → genuine cancel
  ];
  let i = 0;
  let resumes = 0;
  const r = await runInteractive({
    ...baseOpts,
    poll: async () => seq[Math.min(i++, seq.length - 1)],
    elicit: async () => ({ action: "decline" }),
    resume: async () => {
      resumes++;
    },
  });
  assert.equal(r.status, "cancelled");
  assert.equal(resumes, 0, "a declined question must not resume the agent");
});

test("timeout with no boundary: emits progress once and RETURNS running (under client timeout)", async () => {
  // The box is still working when the wait window elapses. Instead of looping forever (which would
  // blow past the MCP client's request timeout -> -32001), we emit one progress ping and return
  // `running` so the caller reconnects via status.
  let now = 0;
  const progresses: string[] = [];
  const r = await runInteractive({
    sleep: async (ms) => {
      now += ms;
    },
    now: () => now,
    timeoutMs: 50,
    intervalMs: 20,
    poll: async () => running(), // never reaches a boundary within the window
    elicit: async () => ({ action: "accept", answer: "x" }),
    resume: async () => {},
    progress: async (msg: string) => {
      progresses.push(msg);
    },
  });
  assert.equal(r.status, "running", "still-working window returns running, not an infinite loop");
  assert.equal(progresses.length, 1, "exactly one progress ping before returning");
});

test("elicit returns cancel BUT box still waiting (Cursor auto-dismiss): treat as waiting, not cancelled", async () => {
  // Cursor's Auto-review can auto-cancel a token-bearing elicitation before the user sees the card;
  // it resolves the elicitation with action:"cancel" (not a throw). If the box is STILL waiting after
  // that, it was never a real user decline — don't abandon the box; return waiting so we can reconnect.
  const seq: PollResult[] = [
    wait("Which changeType?"), // initial boundary → elicit
    wait("Which changeType?"), // re-poll after spurious cancel → still waiting
  ];
  let i = 0;
  let resumes = 0;
  const r = await runInteractive({
    ...baseOpts,
    poll: async () => seq[Math.min(i++, seq.length - 1)],
    elicit: async () => ({ action: "cancel" }),
    resume: async () => {
      resumes++;
    },
  });
  assert.equal(r.status, "waiting", "spurious cancel while still waiting => reconnectable, not cancelled");
  assert.equal(resumes, 0);
  assert.match(r.text, /changeType/);
});

test("elicit returns decline AND box no longer waiting (genuine decline): cancels the run", async () => {
  // A real user decline: after they decline, the box is no longer waiting (idle/done). Then it IS a
  // genuine cancellation and we stop.
  const seq: PollResult[] = [
    wait("Which changeType?"), // boundary → elicit
    { state: "idle", text: "run:idle" }, // re-poll after decline → not waiting anymore
  ];
  let i = 0;
  const r = await runInteractive({
    ...baseOpts,
    poll: async () => seq[Math.min(i++, seq.length - 1)],
    elicit: async () => ({ action: "decline" }),
    resume: async () => {},
  });
  assert.equal(r.status, "cancelled", "decline + box not waiting => genuine cancellation");
});

test("elicit THROWS (transport cancel/timeout): does NOT cancel the run; returns waiting for reconnect", async () => {
  // The box is genuinely waiting; the elicitation round-trip was torn down by the client (e.g. an
  // approval-card timeout). That must NOT be treated as a user decline — the box keeps working.
  const seq: PollResult[] = [wait("Which changeType? feature/bugfix")];
  let i = 0;
  let resumes = 0;
  const r = await runInteractive({
    ...baseOpts,
    poll: async () => seq[Math.min(i++, seq.length - 1)],
    elicit: async () => {
      throw new Error("MCP error -32001: Request timed out");
    },
    resume: async () => {
      resumes++;
    },
  });
  assert.equal(r.status, "waiting", "a failed elicitation leaves the run waiting, not cancelled");
  assert.equal(resumes, 0, "must not resume on a failed elicitation");
  assert.match(r.text, /Which changeType/, "surfaces the pending question so it can be answered");
});

test("waiting result carries the raw question (so the caller can drive its own prompt UI)", async () => {
  const r = await runInteractive({
    ...baseOpts,
    poll: async () => wait("Which city and budget?"),
    elicit: undefined, // fallback path
    resume: async () => {},
  });
  assert.equal(r.status, "waiting");
  assert.equal(r.question, "Which city and budget?", "raw question is propagated for client-driven prompt");
});

test("no elicit capability (fallback): returns at the boundary instead of eliciting", async () => {
  const seq: PollResult[] = [wait("Which tag?")];
  let i = 0;
  const r = await runInteractive({
    ...baseOpts,
    poll: async () => seq[Math.min(i++, seq.length - 1)],
    elicit: undefined, // client can't elicit
    resume: async () => {},
  });
  assert.equal(r.status, "waiting", "without elicit we hand the question back (poll-model fallback)");
  assert.match(r.text, /Which tag/);
});
