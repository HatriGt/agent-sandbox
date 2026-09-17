/**
 * Context-window health: a pure derivation from the trace's usage events so the thread can show a
 * meter and warn before the agent's context degrades. TDD: written before web/src/lib/context-health.ts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { contextHealth, lastUsage, CONTEXT_WINDOW_TOKENS } from "../web/src/lib/context-health.ts";
import type { TraceEvent } from "../src/trace.ts";

test("lastUsage picks the final usage event; none means null", () => {
  const events: TraceEvent[] = [
    { kind: "say", text: "hi" },
    { kind: "usage", inputTokens: 10, outputTokens: 5, contextTokens: 1000 },
    { kind: "tool", name: "Bash", arg: "ls" },
    { kind: "usage", inputTokens: 400, outputTokens: 60, contextTokens: 90000 },
  ];
  assert.deepEqual(lastUsage(events), { kind: "usage", inputTokens: 400, outputTokens: 60, contextTokens: 90000 });
  assert.equal(lastUsage([{ kind: "say", text: "x" }]), null);
});

test("contextHealth levels: normal under 60%, high under 85%, critical above", () => {
  assert.equal(contextHealth(0).level, "normal");
  assert.equal(contextHealth(Math.floor(CONTEXT_WINDOW_TOKENS * 0.5)).level, "normal");
  assert.equal(contextHealth(Math.floor(CONTEXT_WINDOW_TOKENS * 0.7)).level, "high");
  assert.equal(contextHealth(Math.floor(CONTEXT_WINDOW_TOKENS * 0.9)).level, "critical");
});

test("contextHealth fraction is clamped to [0,1] and the label reads as a percentage", () => {
  const h = contextHealth(Math.floor(CONTEXT_WINDOW_TOKENS * 0.42));
  assert.ok(Math.abs(h.fraction - 0.42) < 0.01);
  assert.equal(h.label, "42% of context used");
  assert.equal(contextHealth(CONTEXT_WINDOW_TOKENS * 3).fraction, 1);
  assert.equal(contextHealth(-5).fraction, 0);
});

test("critical health carries advice the UI can show verbatim", () => {
  const h = contextHealth(CONTEXT_WINDOW_TOKENS);
  assert.ok(h.advice && /fresh|new task|context/i.test(h.advice));
  assert.equal(contextHealth(0).advice, undefined, "no advice when healthy");
});
