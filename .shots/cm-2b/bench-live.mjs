// Live code-mode benchmark against the public controller under the caller's account: the same
// realistic tasks (HANA + Cloud Foundry MCP servers) run once with code mode ON and once OFF,
// then tokens, cache, requests, tool calls and wall time are read from each box's log.
//   ASB_TOKEN=<bearer> node .shots/cm-2b/bench-live.mjs [--keep] [--only=t1,t2] [--restore=auto]
// Boxes of one wave start together; the setting flips only after every box of the wave has its
// install note (the setting is read at install time). The caller's setting is restored at the end.
const flags = process.argv.slice(2);
const flag = (k, d) => flags.find((f) => f.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const BASE = flag("base", "https://agent-sandbox.ajeethkumar.dev");
const RESTORE = flag("restore", "auto");
const ONLY = flag("only", "").split(",").filter(Boolean);
const HANA = flag("hana", "deal-qa-system");
const TAG = flag("tag", "");
/** Which waves to run: `on,off` (default), `on` or `off` (a rerun of one side after a fix). */
const MODES = flag("modes", "on,off").split(",").filter((m) => m === "on" || m === "off");
const TOKEN = process.env.ASB_TOKEN;
if (!TOKEN) throw new Error("ASB_TOKEN is required");
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, path, body) {
  const headers = { "content-type": "application/json", authorization: `Bearer ${TOKEN}`, "x-requested-with": "agent-sandbox", origin: BASE };
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }).catch((e) => ({ status: 0, text: async () => String(e) }));
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, json, text };
}

const TASKS = {
  t1: {
    label: "HANA sweep (fan-out)",
    task:
      `Using the ${HANA} HANA MCP server only (read-only): list the tables in the configured schema whose name contains DEAL (up to 40). For the 6 largest by record count, report in one markdown table: table name, record count, number of columns, primary key columns, and whether it has foreign keys. End with one line naming the largest table. No other tools, no files.`,
  },
  t2: {
    label: "CF space audit (fan-out)",
    task:
      "Using the btp-cf MCP server only (read-only): find the Cloud Foundry org and space the server is targeted at (or the first available), list the apps there (up to 12), and for each app report in one markdown table: name, state, instance count, memory, and the timestamp of its most recent log line. Flag apps that are not STARTED. End with a one-line summary. No other tools, no files.",
  },
  t3: {
    label: "HANA one call",
    task: `Using the ${HANA} HANA MCP server only: test the connection and reply with one line giving the HANA version and the current schema. Nothing else.`,
  },
  // Round-three scenarios (2026-11-25): a different server (Jira), two servers in one task, a
  // multi-step HANA investigation, a CF log sweep, and a one-call docs lookup on a tiny server.
  s1: {
    label: "Jira triage (atlassian-rovo-mcp)",
    task:
      "Using the atlassian-rovo-mcp MCP server only (read-only): find Jira issues assigned to me or reported by me that were updated in the last 30 days (up to 30). Report them in one markdown table grouped by project: key, summary (at most 60 chars), status, updated date. End with one line saying how many of them are unresolved. No other tools, no files.",
  },
  s2: {
    label: "CF + HANA cross-server",
    task:
      `Using the btp-cf and ${HANA} MCP servers only (read-only; HANA database btp-qa): (a) in the Cloud Foundry space the server is targeted at (or the first available), find every app whose name contains "deal" and report name, state and instance count; (b) in HANA, in the configured schema, count the rows of the three largest tables whose name contains DEAL. Give one markdown table for each part, then one line relating them (which deal app runs against how much deal data). No other tools, no files.`,
  },
  s3: {
    label: "HANA investigation (multi-step)",
    task:
      `Using the ${HANA} MCP server only (read-only, database btp-qa): in the configured schema, find the tables whose name contains DEAL and that have a column named MODIFIEDAT or MODIFIED_AT. For the 3 such tables with the most rows, fetch the 5 most recently modified rows (only the key columns, STATUS if present, and the modified timestamp) and show them as one markdown table per table. End with one line naming the most recently modified record overall. No other tools, no files.`,
  },
  s4: {
    label: "CF error-log sweep (fan-out)",
    task:
      "Using the btp-cf MCP server only (read-only): in the org and space the server is targeted at (or the first available), for every app (up to 15) fetch its recent log lines with errors only and count them per app. Report one markdown table: app, state, error-line count, most recent error line (at most 100 chars). Flag apps with more than 10 error lines. End with a one-line summary. No other tools, no files.",
  },
  s5: {
    label: "CAP docs one call (cds-mcp)",
    task:
      "Using the cds-mcp MCP server only: search the CAP documentation for how to define a managed to-many composition in CDS and answer in at most 5 bullet lines, naming the documentation sections you used. No other tools, no files.",
  },
};
const ids = Object.keys(TASKS).filter((k) => !ONLY.length || ONLY.includes(k));

async function setMode(prefs, codeMode) {
  const r = await call("POST", "/agent-prefs.json", { defaultAgent: prefs.defaultAgent, defaultModel: prefs.defaultModel ?? "", codeMode });
  if (r.status !== 200 || r.json?.codeMode !== codeMode) throw new Error(`could not set code mode ${codeMode}: ${r.text.slice(0, 200)}`);
  log("code mode set to", codeMode);
}
const fleetView = async (box) => ((await call("GET", "/fleet.json")).json?.boxes ?? []).find((b) => b.name === box);

async function startWave(mode, prefs) {
  await setMode(prefs, mode);
  const runs = [];
  for (const id of ids) {
    const t0 = Date.now();
    const r = await call("POST", "/delegate.json", { task: TASKS[id].task + " (code mode bench)" });
    if (r.status !== 200 || !r.json?.box) throw new Error(`delegate ${id} failed: ${r.text.slice(0, 300)}`);
    runs.push({ id, mode, box: r.json.box, t0, tStarted: Date.now() });
    log(`${mode} ${id} → ${r.json.box} (${Math.round((Date.now() - t0) / 1000)}s)`);
  }
  // Wait for every install note before the setting may change.
  for (const run of runs) {
    for (let i = 0; i < 60; i++) {
      const w = (await call("GET", `/watch.json?box=${run.box}`)).json;
      const notes = w?.mcpNotes ?? [];
      const v = await fleetView(run.box);
      const done = /done|failed|waiting/.test(v?.runState ?? "");
      if (notes.length || done || /running/i.test(v?.runState ?? "")) {
        run.notes = notes;
        break;
      }
      await sleep(5000);
    }
    log(`${run.mode} ${run.id} notes:`, (run.notes ?? []).join(" | ") || "(none yet)");
  }
  return runs;
}

async function waitAll(runs) {
  const pending = new Set(runs);
  for (let i = 0; i < 180 && pending.size; i++) {
    await sleep(10000);
    for (const run of [...pending]) {
      const v = await fleetView(run.box);
      if (v && !v.absent && /done|failed|waiting/.test(v.runState ?? "")) {
        run.tDone = Date.now();
        run.runState = v.runState;
        run.host = v.host;
        pending.delete(run);
        log(`${run.mode} ${run.id} ${v.runState} on ${v.host} after ${Math.round((run.tDone - run.t0) / 1000)}s`);
      }
    }
  }
  for (const run of pending) log(`TIMEOUT ${run.mode} ${run.id} ${run.box}`);
}

function measure(text) {
  const lines = text.split("\n");
  let usage = null;
  let requests = 0;
  const tools = {};
  let mcpCalls = 0;
  let scripts = 0;
  let searches = 0;
  let scriptCalls = 0;
  let firstAt = null;
  let lastAt = null;
  for (const raw of lines) {
    const line = raw.trim();
    const u = line.match(/^⟦usage⟧ in=(\d+) out=(\d+)(?: ctx=(\d+))?(?: win=\d+)?(?: cr=(\d+))?(?: cw=(\d+))?/);
    if (u) usage = { in: +u[1], out: +u[2], ctx: +(u[3] ?? 0), cr: +(u[4] ?? 0), cw: +(u[5] ?? 0) };
    if (line.startsWith("⟦ctx⟧")) requests++;
    const at = line.match(/^⟦at⟧ (\d+)/);
    if (at) {
      firstAt ??= +at[1];
      lastAt = +at[1];
    }
    const t = line.match(/^→ ([A-Za-z0-9_-]+)/);
    if (t) {
      const name = t[1];
      tools[name] = (tools[name] ?? 0) + 1;
      if (name === "mcp__code-mode__run") scripts++;
      else if (name === "mcp__code-mode__search") searches++;
      else if (name.startsWith("mcp__")) mcpCalls++;
    }
    const c = line.match(/^--- (\d+) MCP calls?\b/);
    if (c) scriptCalls += +c[1];
  }
  return { usage, requests, tools, mcpCalls, scripts, searches, scriptCalls, firstAt, lastAt };
}

const prefs = (await call("GET", "/agent-prefs.json")).json;
if (!prefs?.defaultAgent) throw new Error("GET /agent-prefs.json failed");
log("caller setting before:", prefs.codeMode, "default:", prefs.codeModeDefault);
const results = [];
try {
  const all = [];
  for (const mode of MODES) all.push(...(await startWave(mode, prefs)));
  await setMode(prefs, RESTORE);
  await waitAll(all);
  for (const run of all) {
    const w = (await call("GET", `/watch.json?box=${run.box}`)).json;
    const text = w?.log ?? "";
    const m = measure(text);
    const notes = w?.mcpNotes ?? run.notes ?? [];
    const answer = text.slice(-2500);
    results.push({ ...run, notes, ...m, wallMs: run.tDone ? run.tDone - run.t0 : null, agentMs: m.firstAt && m.lastAt ? m.lastAt - m.firstAt : null, answer });
  }
} finally {
  await setMode(prefs, RESTORE).catch((e) => log("restore failed", e.message));
}
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const { writeFileSync } = await import("node:fs");
writeFileSync(`.shots/cm-2b/bench${TAG ? "-" + TAG : ""}-${stamp}.json`, JSON.stringify(results, null, 1));
console.log("\nmode  task  state   wall  agent  reqs  in(total)  cacheRd  cacheWr  out   mcpDirect  scripts  searches  callsInScripts  ctx");
for (const r of results) {
  const u = r.usage ?? {};
  console.log(
    [r.mode.padEnd(4), r.id, (r.runState ?? "?").padEnd(7), `${Math.round((r.wallMs ?? 0) / 1000)}s`, `${Math.round((r.agentMs ?? 0) / 1000)}s`, r.requests, u.in, u.cr, u.cw, u.out, r.mcpCalls, r.scripts, r.searches, r.scriptCalls, u.ctx].join("  "),
  );
}
for (const r of results) console.log(`\n=== ${r.mode} ${r.id} ${r.box}\n${r.answer.replace(/\s+/g, " ").slice(-900)}`);
if (!flags.includes("--keep")) {
  for (const r of results) {
    const t = await call("POST", "/teardown.json", { box: r.box });
    log("teardown", r.box, t.status);
  }
}
console.log("\nBOXES=" + results.map((r) => `${r.mode}:${r.id}:${r.box}`).join(" "));
