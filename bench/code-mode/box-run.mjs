// Runs inside the bench box: every task x mode x rep as one `claude -p` with the production flags,
// one after another, raw stream-json kept per run. bench.ts ships this directory to /root/bench and
// starts it detached; it can be re-run and skips runs that already have a result frame.
//
//   node /root/bench/box-run.mjs [--tasks T1,T3] [--modes A,B] [--runs 5] [--out /root/bench/out]
//
// /root/bench/config.json (written by bench.ts) carries what must match production: the
// --allowedTools list and the system prompt, both derived from src/ at ship time.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { RATES_TS, TASKS } from "./tasks.mjs";

const HERE = "/root/bench";
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const cfg = JSON.parse(readFileSync(`${HERE}/config.json`, "utf8"));
const tasks = arg("tasks", TASKS.map((t) => t.id).join(",")).split(",");
const modes = arg("modes", "A,B").split(",");
const runs = Number(arg("runs", "5"));
const out = arg("out", `${HERE}/out`);
mkdirSync(out, { recursive: true });

// The configurations, identical except for what --mcp-config points at and the prompt paragraph
// code mode adds. Two upstream servers: tracker (13 tools) and ops (38). BL/B2/A2 are variants with
// a CLI knob (see MODES), kept for when the gate is re-run.
const TRACKER = { type: "stdio", command: "node", args: [`${HERE}/tracker-server.mjs`] };
const OPS = { type: "stdio", command: "node", args: [`${HERE}/ops-server.mjs`] };
const UPSTREAM = "/root/.agent-mcp.upstream.json";
writeFileSync(`${HERE}/a.json`, JSON.stringify({ mcpServers: { tracker: TRACKER, ops: OPS } }));
writeFileSync(UPSTREAM, JSON.stringify({ mcpServers: { tracker: TRACKER, ops: OPS } }), { mode: 0o600 });
const WRAPPER = { type: "stdio", command: "node", args: ["/root/.claude/code-mode/server.js", UPSTREAM] };
writeFileSync(`${HERE}/b.json`, JSON.stringify({ mcpServers: { "code-mode": WRAPPER } }));
// alwaysLoad (Claude Code 2.1.322 --mcp-config schema): this server's tools are never deferred behind ToolSearch.
writeFileSync(`${HERE}/bl.json`, JSON.stringify({ mcpServers: { "code-mode": { ...WRAPPER, alwaysLoad: true } } }));
// BX = BL with the script seeing whole upstream results (4M chars) instead of the 24k cut copy.
writeFileSync(`${HERE}/bx.json`, JSON.stringify({ mcpServers: { "code-mode": { ...WRAPPER, alwaysLoad: true, env: { CODE_MODE_UPSTREAM_CAP: "4000000" } } } }));
// CL = BL with the tool catalog in run's description (CODE_MODE_CATALOG) and the v2 prompt paragraph.
writeFileSync(`${HERE}/cl.json`, JSON.stringify({ mcpServers: { "code-mode": { ...WRAPPER, alwaysLoad: true, env: { CODE_MODE_CATALOG: "1" } } } }));
const CM_PROMPT = readFileSync(`${HERE}/code-mode-prompt.txt`, "utf8").trim();
const CM_PROMPT_V2 = readFileSync(`${HERE}/code-mode-prompt-v2.txt`, "utf8").trim();
const DIRECT = ["tracker", "ops"];
const CM = ["code-mode"];
const MODES = {
  A: { config: `${HERE}/a.json`, servers: DIRECT, extraPrompt: "", env: {} },
  B: { config: `${HERE}/b.json`, servers: CM, extraPrompt: CM_PROMPT, env: {} },
  // B with the two code-mode tools always loaded (not deferred), via alwaysLoad.
  BL: { config: `${HERE}/bl.json`, servers: CM, extraPrompt: CM_PROMPT, env: {} },
  BX: { config: `${HERE}/bx.json`, servers: CM, extraPrompt: CM_PROMPT, env: {} },
  CL: { config: `${HERE}/cl.json`, servers: CM, extraPrompt: CM_PROMPT_V2, env: {} },
  // BL's server and config with the v2 prompt but no catalog: separates the prompt from the catalog.
  BP: { config: `${HERE}/bl.json`, servers: CM, extraPrompt: CM_PROMPT_V2, env: {} },
  // B with tool search off: every tool definition is sent up front (only the two code-mode tools here).
  B2: { config: `${HERE}/b.json`, servers: CM, extraPrompt: CM_PROMPT, env: { ENABLE_TOOL_SEARCH: "false" } },
  // A with tool search off, the pre-2.1.x baseline, for reference.
  A2: { config: `${HERE}/a.json`, servers: DIRECT, extraPrompt: "", env: { ENABLE_TOOL_SEARCH: "false" } },
};

mkdirSync("/workspace/src", { recursive: true });
writeFileSync("/workspace/src/rates.ts", RATES_TS);

const done = (file) => existsSync(file) && readFileSync(file, "utf8").includes('"type":"result"');

async function runOne(task, mode, rep) {
  const m = MODES[mode];
  if (!m) throw new Error(`no mode ${mode}`);
  const base = `${out}/${task.id}-${mode}-${rep}`;
  if (done(`${base}.jsonl`)) return;
  // A fresh box per run as far as code mode is concerned: no shapes, call numbers or catalog
  // remembered from earlier runs.
  for (const f of ["shapes.json", "calls.json", "catalog.txt"]) rmSync(`/root/.claude/code-mode/${f}`, { force: true });
  // The fake servers log this run's writes to <base>.log.jsonl (state.mjs); a re-run starts clean.
  rmSync(`${base}.log.jsonl`, { force: true });
  writeFileSync(`${HERE}/current-log`, `${base}.log.jsonl`);
  // A follow-up task is two `claude -p` calls in /workspace, the second with -c; both streams go
  // into one .jsonl, the wall time is their sum.
  const first = await turn(task.prompt, m, []);
  const second = task.followUp && first.code === 0 ? await turn(task.followUp, m, ["-c"]) : undefined;
  const turns = second ? [first, second] : [first];
  writeFileSync(`${base}.jsonl`, Buffer.concat(turns.map((t) => t.stdout)));
  const err = Buffer.concat(turns.map((t) => t.stderr));
  if (err.length) writeFileSync(`${base}.err`, err);
  const wallMs = turns.reduce((s, t) => s + t.wallMs, 0);
  const last = turns[turns.length - 1];
  appendFileSync(`${out}/runs.jsonl`, JSON.stringify({ task: task.id, mode, rep, wallMs, code: last.code, signal: last.signal, turns: turns.length, at: new Date(first.t0).toISOString() }) + "\n");
  console.log(`${task.id} ${mode} #${rep} ${(wallMs / 1000).toFixed(1)}s exit=${last.code}${last.signal ? ` ${last.signal}` : ""}${second ? " (2 turns)" : ""}`);
}

function turn(prompt, m, extra) {
  const sys = m.extraPrompt ? `${cfg.sysPrompt} ${m.extraPrompt}` : cfg.sysPrompt;
  const argv = [
    ...extra,
    "-p", prompt,
    "--setting-sources", "user",
    "--output-format", "stream-json", "--verbose", "--include-partial-messages",
    "--mcp-config", m.config,
    "--append-system-prompt", sys,
    "--allowedTools", ...cfg.allowedTools, ...m.servers.map((s) => `mcp__${s}`),
  ];
  const env = {
    ...process.env,
    ...cfg.env,
    // Written by bench.ts straight from the controller container on the host; never in config.json.
    ANTHROPIC_API_KEY: readFileSync(`${HERE}/key`, "utf8").trim(),
    CLAUDE_CODE_MCP_STARTUP_WAIT_MS: String(cfg.mcpWaitMs),
    CLAUDE_CODE_ENABLE_TASKS: "0",
    ...m.env,
  };
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn("claude", argv, { cwd: "/workspace", env, stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    const err = [];
    child.stdout.on("data", (d) => chunks.push(d));
    child.stderr.on("data", (d) => err.push(d));
    const timer = setTimeout(() => child.kill("SIGKILL"), cfg.timeoutMs);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ t0, wallMs: Date.now() - t0, code, signal, stdout: Buffer.concat(chunks), stderr: Buffer.concat(err) });
    });
  });
}

// Interleaved: rep-major, and the mode order flips every rep, so drift in proxy latency over the
// hours a full bench takes lands on both modes alike.
for (let rep = 1; rep <= runs; rep++) {
  for (const id of tasks) {
    const task = TASKS.find((t) => t.id === id);
    if (!task) throw new Error(`no task ${id}`);
    const order = rep % 2 ? modes : [...modes].reverse();
    for (const mode of order) await runOne(task, mode, rep);
  }
}
console.log("bench done");
