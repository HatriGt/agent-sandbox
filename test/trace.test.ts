/**
 * The dashboard's trace parser. It lives in web/src (it renders in the browser) but it is pure and
 * dependency-free, so it is covered here rather than dragging a second test runner into the repo.
 *
 * Its input is real: the lines below are the shape `stream-fmt.js` actually appends to
 * /workspace/.agent.log, copied from live runs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTrace, resultSummary, clean } from "../web/src/lib/trace.ts";

const REAL_LOG = [
  "● session started (model ak-claude-opus-4.8)",
  "I'll write these one at a time. Starting with a.md on filesystem isolation.",
  "→ Write: /workspace/a.md",
  "  File created successfully at: /workspace/a.md (file state is current in your context)",
  "a.md done. Now b.md on network isolation and egress control.",
  "→ Write: /workspace/b.md",
  "  File created successfully at: /workspace/b.md",
].join("\n");

test("parses a real log into speech, tool calls, and lifecycle events", () => {
  const ev = parseTrace(REAL_LOG);
  assert.deepEqual(
    ev.map((e) => e.kind),
    ["lifecycle", "say", "tool", "say", "tool"]
  );

  assert.deepEqual(ev[0], { kind: "lifecycle", label: "session started", detail: "model ak-claude-opus-4.8" });

  assert.equal(ev[1].kind, "say");
  if (ev[1].kind === "say") assert.match(ev[1].text, /filesystem isolation/);

  // A tool call carries its argument and absorbs the indented result that follows it.
  assert.equal(ev[2].kind, "tool");
  if (ev[2].kind === "tool") {
    assert.equal(ev[2].name, "Write");
    assert.equal(ev[2].arg, "/workspace/a.md");
    assert.match(ev[2].result!, /File created successfully/);
  }
});

test("consecutive prose lines coalesce into one turn, not one per line", () => {
  const ev = parseTrace("First line.\nSecond line.\nThird line.");
  assert.equal(ev.length, 1);
  assert.equal(ev[0].kind, "say");
  if (ev[0].kind === "say") assert.equal(ev[0].text, "First line.\nSecond line.\nThird line.");
});

test("multi-line tool output stays attached to its call", () => {
  const ev = parseTrace(["→ Bash: npm test", "  120 passing", "  0 failing"].join("\n"));
  assert.equal(ev.length, 1);
  if (ev[0].kind === "tool") assert.equal(ev[0].result, "120 passing\n0 failing");
});

test("an indented line that is NOT after a tool call stays prose", () => {
  // Agent prose is sometimes indented (lists, quotes). Swallowing it as tool output would silently
  // hide what the agent said.
  const ev = parseTrace("Here is the plan:\n  - step one\n  - step two");
  assert.equal(ev.length, 1);
  assert.equal(ev[0].kind, "say");
});

test("a lifecycle marker with no parenthetical still parses", () => {
  const ev = parseTrace("● run complete");
  assert.deepEqual(ev, [{ kind: "lifecycle", label: "run complete" }]);
});

test("tool call with no argument is still a tool call", () => {
  const ev = parseTrace("→ Read");
  assert.deepEqual(ev, [{ kind: "tool", name: "Read", arg: undefined }]);
});

test("empty and whitespace-only logs produce nothing, not an empty bubble", () => {
  assert.deepEqual(parseTrace(""), []);
  assert.deepEqual(parseTrace("\n\n   \n"), []);
  assert.deepEqual(parseTrace(undefined as unknown as string), []);
});

test("clean strips ANSI colour, OSC sequences, and carriage-return rewrites", () => {
  const esc = "\u001b"; // explicit escape, not an invisible literal byte
  assert.equal(clean(`${esc}[32mgreen${esc}[0m`), "green");
  assert.equal(clean(`${esc}]0;titleafter`), "after");
  // A spinner rewriting its line leaves only the final segment.
  assert.equal(clean("loading...\rdone"), "done");
});

test("ANSI in the middle of a log does not break event parsing", () => {
  const esc = "\u001b"; // explicit escape, not an invisible literal byte
  const ev = parseTrace(`${esc}[36m→ Write: /workspace/x.ts${esc}[0m`);
  assert.equal(ev.length, 1);
  if (ev[0].kind === "tool") assert.equal(ev[0].arg, "/workspace/x.ts");
});

test("resultSummary takes the first meaningful line and truncates", () => {
  assert.equal(resultSummary("\n\nfirst real line\nsecond"), "first real line");
  assert.equal(resultSummary(undefined), undefined);
  assert.equal(resultSummary("x".repeat(200))!.length, 100);
  assert.match(resultSummary("x".repeat(200))!, /…$/);
});

test("a repeated closing summary renders once, not twice", () => {
  // The in-box formatter emits assistant text as it streams and re-emits the final result at the
  // end, so the last block legitimately arrives twice. Showing both looks like a rendering bug.
  const summary = "All four essays are written in /workspace.";
  const ev = parseTrace([summary, "", summary].join("\n"));
  assert.equal(ev.filter((e) => e.kind === "say").length, 1);
});

test("distinct consecutive prose is NOT deduped", () => {
  const ev = parseTrace(["→ Write: /a.md", "first summary", "→ Write: /b.md", "second summary"].join("\n"));
  const says = ev.filter((e) => e.kind === "say");
  assert.equal(says.length, 2);
});

// ── inline markdown ──────────────────────────────────────────────────────────────────────────────
test("inline: bold and code are tokenized, not left as literal markers", async () => {
  const { tokenizeInline, plainInline } = await import("../web/src/lib/inline.ts");
  const t = tokenizeInline("**Finished** `/workspace/audit.md` now");
  assert.deepEqual(t, [
    { type: "strong", value: "Finished" },
    { type: "text", value: " " },
    { type: "code", value: "/workspace/audit.md" },
    { type: "text", value: " now" },
  ]);
  assert.equal(plainInline("**Finished** `x`"), "Finished x");
});

test("inline: asterisks inside code are not emphasis", async () => {
  const { tokenizeInline } = await import("../web/src/lib/inline.ts");
  const t = tokenizeInline("run `a * b * c` please");
  assert.equal(t.filter((x) => x.type === "strong").length, 0);
  assert.equal(t.find((x) => x.type === "code")!.value, "a * b * c");
});

test("inline: unmatched markers stay literal rather than eating the rest of the line", async () => {
  const { tokenizeInline } = await import("../web/src/lib/inline.ts");
  assert.deepEqual(tokenizeInline("a ** b"), [{ type: "text", value: "a ** b" }]);
  assert.deepEqual(tokenizeInline("50% * 2"), [{ type: "text", value: "50% * 2" }]);
});

test("inline: empty input yields nothing", async () => {
  const { tokenizeInline } = await import("../web/src/lib/inline.ts");
  assert.deepEqual(tokenizeInline(""), []);
});
