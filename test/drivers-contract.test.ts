/**
 * The driver contract (plan §A): the SAME logical run, expressed as each CLI's native events, must
 * come out of every driver's formatter as the SAME sentinel log — that is what lets trace.ts, the
 * thread, the digest and mobile stay driver-blind. Normalisation is limited to what is legitimately
 * per-driver: ⟦at⟧ clock stamps, blank-line spacing, the ctx= footprint (each CLI reports context
 * differently) and tool-name case (omp and opencode name tools in lowercase).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { DRIVERS, listDrivers, assertSelectable } from "../src/drivers/index.ts";
import type { DriverKind } from "../src/drivers/index.ts";
import { meetsSupervisionFloor } from "../src/drivers/types.ts";
import { parseTrace } from "../src/trace.ts";

function program(kind: DriverKind): string {
  const b64 = DRIVERS[kind].formatter().match(/printf '%s' '([A-Za-z0-9+/=]+)'/)?.[1];
  assert.ok(b64, `${kind}: formatter install must carry a base64 payload`);
  return Buffer.from(b64!, "base64").toString("utf8");
}

function run(kind: DriverKind, events: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), `drv-${kind}-`));
  const script = join(dir, "fmt.js");
  const log = join(dir, "agent.log");
  writeFileSync(script, program(kind));
  writeFileSync(log, "");
  execFileSync(process.execPath, [script, log], {
    env: { ...process.env, ANTHROPIC_MODEL: "M", AGENT_MODEL: "M" },
    input: events.map((e) => JSON.stringify(e)).join("\n") + "\n",
  });
  return readFileSync(log, "utf8");
}

function norm(log: string): string {
  return log
    .split("\n")
    .filter((l) => !l.startsWith("⟦at⟧"))
    .map((l) => l.replace(/^→ (\w+)/, (_, n: string) => `→ ${n.toLowerCase()}`).replace(/ ctx=\d+/, ""))
    .map((l) => l.replace(/^(⟦plan⟧) \d+$/, "$1"))
    .filter((l) => l.trim() !== "")
    .join("\n");
}

type Scenario = Record<DriverKind, unknown[]>;

/** Say something, run `ls` (ok) and `false` (fails), say done, report usage 10 in / 5 out. */
const basic: Scenario = {
  claude: [
    { type: "system", subtype: "init", model: "M" },
    { type: "assistant", message: { content: [{ type: "text", text: "Listing files" }, { type: "tool_use", id: "toolu_abcd1234", name: "Bash", input: { command: "ls" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_abcd1234", content: "a.txt" }] } },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "toolu_bad00001", name: "Bash", input: { command: "false" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_bad00001", content: "boom", is_error: true }] } },
    { type: "assistant", message: { content: [{ type: "text", text: "Done" }] } },
    { type: "result", result: "Done", usage: { input_tokens: 10, output_tokens: 5 } },
  ],
  omp: [
    { type: "agent_start" },
    { type: "message_end", message: { role: "assistant", model: "M", content: [{ type: "text", text: "Listing files" }, { type: "toolCall", id: "call_abcd1234", name: "bash", arguments: { command: "ls" } }] } },
    { type: "message_end", message: { role: "toolResult", toolCallId: "call_abcd1234", content: [{ type: "text", text: "a.txt" }], isError: false } },
    { type: "message_end", message: { role: "assistant", model: "M", content: [{ type: "toolCall", id: "call_bad00001", name: "bash", arguments: { command: "false" } }] } },
    { type: "message_end", message: { role: "toolResult", toolCallId: "call_bad00001", content: [{ type: "text", text: "boom" }], isError: true } },
    { type: "message_end", message: { role: "assistant", model: "M", content: [{ type: "text", text: "Done" }] } },
    { type: "turn_end", message: { role: "assistant", usage: { input: 10, output: 5 } } },
  ],
  codex: [
    { type: "thread.started", thread_id: "t1" },
    { type: "turn.started" },
    { type: "item.completed", item: { id: "item_0", type: "agent_message", text: "Listing files" } },
    { type: "item.started", item: { id: "item_abcd1234", type: "command_execution", command: "ls", status: "in_progress" } },
    { type: "item.completed", item: { id: "item_abcd1234", type: "command_execution", command: "ls", aggregated_output: "a.txt", exit_code: 0, status: "completed" } },
    { type: "item.started", item: { id: "item_bad00001", type: "command_execution", command: "false", status: "in_progress" } },
    { type: "item.completed", item: { id: "item_bad00001", type: "command_execution", command: "false", aggregated_output: "boom", exit_code: 1, status: "failed" } },
    { type: "item.completed", item: { id: "item_9", type: "agent_message", text: "Done" } },
    { type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5, reasoning_output_tokens: 0 } },
  ],
  opencode: [
    { type: "step_start", part: {} },
    { type: "text", part: { text: "Listing files" } },
    { type: "tool_use", part: { tool: "bash", callID: "call_abcd1234", state: { status: "completed", input: { command: "ls" }, output: "a.txt" } } },
    { type: "tool_use", part: { tool: "bash", callID: "call_bad00001", state: { status: "error", input: { command: "false" }, error: "boom" } } },
    { type: "text", part: { text: "Done" } },
    { type: "step_finish", part: { tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } } } },
  ],
};

const EXPECTED = [
  "● session started (model M)",
  "Listing files",
  "→ bash: ls ⟦#abcd1234⟧",
  "  ⟦#abcd1234⟧ a.txt",
  "→ bash: false ⟦#bad00001⟧",
  "  ⟦#bad00001⟧ ⟦err⟧ boom",
  "Done",
  "⟦usage⟧ in=10 out=5",
].join("\n");

for (const kind of Object.keys(DRIVERS) as DriverKind[]) {
  test(`${kind}: formatter payload is valid JS`, () => {
    assert.doesNotThrow(() => new vm.Script(program(kind)));
  });

  test(`${kind}: the basic run lands as the shared sentinel log`, () => {
    const log = run(kind, basic[kind]);
    assert.equal(norm(log), EXPECTED);
    const tools = parseTrace(log).filter((e) => e.kind === "tool");
    assert.equal(tools.length, 2, `${kind}: both tool calls parse`);
  });
}

/** Plan snapshots: only drivers that CLAIM planEvents are held to it. */
const plans: Partial<Scenario> = {
  claude: [
    { type: "system", subtype: "init", model: "M" },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "toolu_plan0001", name: "TodoWrite", input: { todos: [{ content: "read code", status: "completed" }, { content: "fix bug", status: "pending" }] } }] } },
  ],
  codex: [
    { type: "thread.started", thread_id: "t1" },
    { type: "item.started", item: { id: "item_p", type: "todo_list", items: [{ text: "read code", completed: true }, { text: "fix bug", completed: false }] } },
  ],
  // omp's `todo` call carries ops; the result's details.phases is the whole list after the change
  // (shape of omp 18.x toolResult message_end). Abandoned tasks are dropped from the card.
  omp: [
    { type: "agent_start" },
    { type: "message_end", message: { role: "assistant", content: [{ type: "toolCall", id: "call_plan01", name: "todo", arguments: { ops: [{ op: "done", task: "read code" }] } }] } },
    {
      type: "message_end",
      message: {
        role: "toolResult",
        toolCallId: "call_plan01",
        toolName: "todo",
        content: [{ type: "text", text: "Remaining: fix bug" }],
        details: { op: "update", phases: [{ name: "Work", tasks: [{ content: "read code", status: "completed" }, { content: "old idea", status: "abandoned" }, { content: "fix bug", status: "pending" }] }] },
      },
    },
  ],
};

test("every driver claiming planEvents has a plan scenario", () => {
  for (const d of Object.values(DRIVERS)) {
    if (d.capabilities.planEvents) assert.ok(plans[d.kind], `${d.kind} claims planEvents but has no contract case`);
  }
});

for (const [kind, events] of Object.entries(plans) as [DriverKind, unknown[]][]) {
  test(`${kind}: plan snapshot lands as a ⟦plan⟧ checklist`, () => {
    const log = norm(run(kind, events));
    assert.match(log, /⟦plan⟧\n\[x\] read code\n\[ \] fix bug\n⟦\/plan⟧/);
  });
}

test("the supervision floor: every listed driver reports it, and it is enforced", () => {
  for (const d of listDrivers()) assert.equal(d.supervised, meetsSupervisionFloor(d.capabilities));
  // A gate only read off the CLI's docs is not enough: codex/opencode stay partial until seen live.
  const byKind = Object.fromEntries(listDrivers().map((d) => [d.kind, d.supervised]));
  assert.deepEqual(byKind, { claude: true, omp: true, codex: false, opencode: false });
  assert.throws(() => assertSelectable("codex"), /supervision floor/);
  // A hypothetical below-floor driver is refused unless the partial acknowledgement is passed.
  const saved = DRIVERS.opencode;
  try {
    DRIVERS.opencode = { ...saved, capabilities: { ...saved.capabilities, gate: "none" } };
    assert.throws(() => assertSelectable("opencode"), /supervision floor/);
    assert.doesNotThrow(() => assertSelectable("opencode", true));
  } finally {
    DRIVERS.opencode = saved;
  }
});

test("opencode gate plugin blocks every tool call while a question is pending", async () => {
  const b64 = DRIVERS.opencode.gateScript()!.match(/printf '%s' '([A-Za-z0-9+/=]+)'/)![1];
  const src = Buffer.from(b64, "base64").toString("utf8");
  const dir = mkdtempSync(join(tmpdir(), "ocgate-"));
  const q = join(dir, "question").replace(/\\/g, "/");
  const file = join(dir, "gate.mjs");
  writeFileSync(file, src.replace(/const Q=[^;]+;/, `const Q=${JSON.stringify(q)};`));
  const mod = await import("file://" + file.replace(/\\/g, "/"));
  const hooks = await mod.AsbGate({});
  await hooks["tool.execute.before"]({ tool: "read" }, { args: { filePath: "x" } }); // no question → allowed
  writeFileSync(q, "which branch?");
  await assert.rejects(hooks["tool.execute.before"]({ tool: "bash" }, { args: { command: "ls" } }), /question is pending/);
});

test("codex gate: hooks.json wires the shared ask gate as a PreToolUse deny hook", () => {
  const b64 = DRIVERS.codex.gateScript()!.match(/printf '%s' '([A-Za-z0-9+/=]+)'/)![1];
  const j = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  const cmds = j.hooks.PreToolUse[0].hooks.map((h: { command: string }) => h.command);
  assert.ok(cmds.some((c: string) => c.endsWith("ask-gate.sh")));
  assert.match(DRIVERS.codex.launch({ resume: false }), /--dangerously-bypass-hook-trust/);
  assert.match(DRIVERS.codex.launch({ resume: true }), /codex exec resume --last/);
});
