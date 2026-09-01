/**
 * The formatter is shipped as a base64-embedded JS string, so a syntax error or an undefined
 * variable is invisible at build time and silently kills ALL log output in the box (it has happened
 * twice). These tests decode the real shipped payload, parse it, and run it against synthetic
 * stream-json — the only way to know the thing we deploy actually works.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { streamFmtScript, RESULT_MAX_LINES, RESULT_MAX_BYTES } from "../src/msb.ts";
import { parseTrace } from "../web/src/lib/trace.ts";
import { deriveTaskBoard } from "../web/src/lib/planTasks.ts";

/** The exact JS the box will execute, recovered the same way the box recovers it. */
function formatterSource(): string {
  const b64 = streamFmtScript().match(/printf '%s' '([A-Za-z0-9+/=]+)'/)?.[1];
  assert.ok(b64, "install command must carry a base64 payload");
  return Buffer.from(b64!, "base64").toString("utf8");
}

/** Run the formatter as the box does — real node, NDJSON on stdin — and return the log it wrote. */
function runFormatter(events: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), "streamfmt-"));
  const script = join(dir, "stream-fmt.js");
  const log = join(dir, "agent.log");
  writeFileSync(script, formatterSource());
  execFileSync(process.execPath, [script, log], {
    input: events.map((e) => JSON.stringify(e)).join("\n") + "\n",
  });
  return readFileSync(log, "utf8");
}

/**
 * The result the UI would show for the only/first tool in the log. Trimmed at the end: the log's
 * final newline reads as a blank continuation line of the last result block, which predates this
 * work and is not what these tests are about.
 */
function firstResult(log: string): { result: string; failed?: boolean } {
  const tool = parseTrace(log).find((e) => e.kind === "tool");
  if (tool?.kind !== "tool") throw new Error("no tool event in log");
  return { result: (tool.result ?? "").replace(/\n+$/, ""), failed: tool.failed };
}

const toolUse = (id: string, command: string) => ({
  type: "assistant",
  message: { content: [{ type: "tool_use", id, name: "Bash", input: { command } }] },
});
const toolResult = (id: string, text: string, isError = false) => ({
  type: "user",
  message: { content: [{ type: "tool_result", tool_use_id: id, is_error: isError, content: text }] },
});

test("the shipped formatter payload is syntactically valid JS", () => {
  // `node --check` equivalent without spawning: a parse failure throws here.
  assert.doesNotThrow(() => new vm.Script(formatterSource()));
});

test("formatter writes real output for a whole session (init, text, tool, result)", () => {
  const log = runFormatter([
    { type: "system", subtype: "init", model: "test-model" },
    { type: "assistant", message: { content: [{ type: "text", text: "starting" }] } },
    toolUse("toolu_abc12345", "echo hi"),
    toolResult("toolu_abc12345", "hi"),
    { type: "result", result: "starting" },
  ]);
  assert.match(log, /● session started \(model test-model\)/);
  assert.match(log, /→ Bash: echo hi ⟦#abc12345⟧/);
  assert.match(log, /⟦#abc12345⟧ hi/);
  // The final `result` repeats assistant text already written, so it must not be appended again.
  assert.equal(log.split("starting").length - 1, 1);
});

test("a 60-line result survives whole — the case the 20-line cap destroyed", () => {
  const body = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join("\n");
  const log = runFormatter([toolUse("toolu_long0001", "seq 60"), toolResult("toolu_long0001", body)]);
  const { result } = firstResult(log);
  assert.equal(result, body);
  assert.doesNotMatch(result, /more lines/);
});

test("beyond the line cap the tail is still disclosed honestly", () => {
  const n = RESULT_MAX_LINES + 25;
  const body = Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n");
  const log = runFormatter([toolUse("toolu_huge0001", "seq big"), toolResult("toolu_huge0001", body)]);
  const lines = firstResult(log).result.split("\n");
  assert.equal(lines.length, RESULT_MAX_LINES + 1);
  assert.equal(lines[RESULT_MAX_LINES - 1], `line ${RESULT_MAX_LINES}`);
  assert.equal(lines[RESULT_MAX_LINES], "… 25 more lines");
});

test("the byte cap bounds a pathological dump even when the line count is modest", () => {
  // 50 lines of 4KB each is well under the line cap but ~200KB — exactly the `cat a bundle` shape
  // that would bloat .agent.log and every SSE poll that re-reads it.
  const body = Array.from({ length: 50 }, () => "x".repeat(3500)).join("\n");
  const log = runFormatter([toolUse("toolu_bytes001", "cat bundle"), toolResult("toolu_bytes001", body)]);
  assert.ok(Buffer.byteLength(log, "utf8") < RESULT_MAX_BYTES * 1.2, "log stays near the byte budget");
  assert.match(log, /… \d+ more lines/);
});

test("parallel tools with long outputs each keep their own complete result", () => {
  const a = Array.from({ length: 45 }, (_, i) => `a${i + 1}`).join("\n");
  const b = Array.from({ length: 40 }, (_, i) => `b${i + 1}`).join("\n");
  const log = runFormatter([
    {
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", id: "toolu_par00001", name: "Bash", input: { command: "seq a" } },
          { type: "tool_use", id: "toolu_par00002", name: "Bash", input: { command: "seq b" } },
        ],
      },
    },
    toolResult("toolu_par00001", a),
    toolResult("toolu_par00002", b),
  ]);
  const tools = parseTrace(log).filter((e) => e.kind === "tool");
  assert.equal(tools.length, 2);
  if (tools[0].kind === "tool" && tools[1].kind === "tool") {
    assert.equal(tools[0].result, a);
    assert.equal((tools[1].result ?? "").replace(/\n+$/, ""), b);
  }
});

test("an errored long result keeps its sentinel and its full body", () => {
  const body = Array.from({ length: 30 }, (_, i) => `err ${i + 1}`).join("\n");
  const log = runFormatter([toolUse("toolu_fail0001", "false"), toolResult("toolu_fail0001", body, true)]);
  const tool = firstResult(log);
  assert.equal(tool.failed, true);
  assert.equal(tool.result, body);
});

test("thinking and TodoWrite become folded blocks; the TodoWrite result is not written", () => {
  const log = runFormatter([
    { type: "system", subtype: "init", model: "m" },
    {
      type: "assistant",
      message: {
        content: [
          { type: "thinking", thinking: "Let me map the entry points first.\nThen the handlers." },
          {
            type: "tool_use",
            id: "toolu_plan0001",
            name: "TodoWrite",
            input: {
              todos: [
                { content: "Read the schema", status: "completed" },
                { content: "Write the migration", status: "in_progress" },
                { content: "Run the tests", status: "pending" },
              ],
            },
          },
        ],
      },
    },
    toolResult("toolu_plan0001", "Todos have been modified successfully."),
    { type: "assistant", message: { content: [{ type: "text", text: "Starting." }] } },
  ]);
  assert.doesNotMatch(log, /Todos have been modified/);
  const ev = parseTrace(log);
  const think = ev.find((e) => e.kind === "think");
  assert.ok(think && think.kind === "think" && /entry points/.test(think.text));
  const plan = ev.find((e) => e.kind === "plan");
  assert.ok(plan && plan.kind === "plan");
  assert.deepEqual(
    plan.kind === "plan" && plan.items.map((i) => [i.text, i.state]),
    [["Read the schema", "done"], ["Write the migration", "active"], ["Run the tests", "todo"]]
  );
  assert.ok(ev.some((e) => e.kind === "say" && e.text === "Starting."));
});

// --- the plan on newer Claude Code (TaskCreate/TaskUpdate, no TodoWrite) -------------------------
// Verified against a live box: TaskCreate answers "Task #N created successfully", and TaskUpdate is
// then called with taskId "N" — so creation order IS the id. These lock that mapping in.

const call = (name: string, input: unknown, id = "t1") => ({
  type: "assistant",
  message: { content: [{ type: "tool_use", id, name, input }] },
});

test("TaskCreate/TaskUpdate fold into plan snapshots, not tool rows", () => {
  const log = runFormatter([
    call("TaskCreate", { subject: "Wire the parser", description: "edit trace.ts" }, "a"),
    call("TaskCreate", { subject: "Render the board", description: "new component" }, "b"),
    call("TaskUpdate", { taskId: "1", status: "in_progress" }, "c"),
    { type: "assistant", message: { content: [{ type: "tool_use", id: "d", name: "Write", input: { file_path: "/workspace/x.ts" } }] } },
    call("TaskUpdate", { taskId: "1", status: "completed" }, "e"),
    call("TaskUpdate", { taskId: "2", status: "in_progress" }, "f"),
  ]);

  // The task tools never appear as tool rows — the ticking checklist is the information.
  const tools = parseTrace(log).filter((e) => e.kind === "tool");
  assert.deepEqual(tools.map((t) => (t.kind === "tool" ? t.name : "")), ["Write"]);

  const plans = parseTrace(log).filter((e) => e.kind === "plan");
  assert.equal(plans.length, 5, "one snapshot per mutation: 2 creates + 3 updates");
  const last = plans[plans.length - 1];
  assert.ok(last.kind === "plan");
  assert.deepEqual(last.items, [
    { text: "Wire the parser", state: "done" },
    { text: "Render the board", state: "active" },
  ]);
  // Every snapshot carries the wall clock the board needs for per-step durations.
  assert.ok(last.at && last.at > 0);
});

test("the write between two snapshots is attributed to the step in progress", () => {
  const log = runFormatter([
    call("TaskCreate", { subject: "Wire the parser", description: "x" }, "a"),
    call("TaskUpdate", { taskId: "1", status: "in_progress" }, "b"),
    { type: "assistant", message: { content: [{ type: "tool_use", id: "c", name: "Write", input: { file_path: "/workspace/x.ts" } }] } },
    call("TaskUpdate", { taskId: "1", status: "completed" }, "d"),
  ]);
  const board = deriveTaskBoard(parseTrace(log));
  assert.ok(board);
  assert.deepEqual(board.tasks[0].evidence.files, ["/workspace/x.ts"]);
  assert.equal(board.complete, true);
});

test("a deleted task leaves the plan; an unknown taskId changes nothing", () => {
  const log = runFormatter([
    call("TaskCreate", { subject: "Keep me", description: "x" }, "a"),
    call("TaskCreate", { subject: "Drop me", description: "y" }, "b"),
    call("TaskUpdate", { taskId: "2", status: "deleted" }, "c"),
    call("TaskUpdate", { taskId: "9", status: "completed" }, "d"),
  ]);
  const plans = parseTrace(log).filter((e) => e.kind === "plan");
  const last = plans[plans.length - 1];
  assert.ok(last.kind === "plan");
  assert.deepEqual(last.items, [{ text: "Keep me", state: "todo" }]);
});

test("TodoWrite still works — older builds are not broken by the new path", () => {
  const log = runFormatter([
    call("TodoWrite", { todos: [{ content: "Step one", status: "completed" }, { content: "Step two", status: "in_progress" }] }, "a"),
  ]);
  const plan = parseTrace(log).find((e) => e.kind === "plan");
  assert.ok(plan?.kind === "plan");
  assert.deepEqual(plan.items, [
    { text: "Step one", state: "done" },
    { text: "Step two", state: "active" },
  ]);
});

test("a second system/init in one turn does not stamp a second 'session started'", () => {
  // Claude Code can re-init mid-stream — seen when a turn interrupted by send-now resumed with -c
  // and a killed background task triggered a fresh init. One formatter process is one turn, so two
  // markers back to back read as "the turn restarted and lost its context", which is not what
  // happened. Everything after the re-init must still be written normally.
  const log = runFormatter([
    { type: "system", subtype: "init", model: "m" },
    { type: "assistant", message: { content: [{ type: "text", text: "before" }] } },
    { type: "system", subtype: "init", model: "m" },
    { type: "assistant", message: { content: [{ type: "text", text: "after" }] } },
  ]);
  assert.equal(log.split("● session started").length - 1, 1);
  assert.match(log, /before/);
  assert.match(log, /after/);
});

test("a resume waits for a live in-flight run instead of racing it", async () => {
  const { agentSh } = await import("../src/msb.ts");
  const resume = agentSh("/workspace/api", true);
  // The guard: poll RUN_MARK with the same dead-pid liveness rule as RUN_STATE_SH, THEN start.
  assert.match(resume, /while \[ -f \/workspace\/\.agent\.running \]/);
  assert.match(resume, /\/proc\/\$p/);
  // A first run must NOT wait — there is nothing to wait for and the box may have stale marks.
  assert.doesNotMatch(agentSh("/workspace/api", false), /while \[ -f \/workspace\/\.agent\.running \]/);
});
