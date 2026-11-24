// Live end-to-end for code mode's §13 round (docs/plan-code-mode.md), against the public controller.
//   ASB_TOKEN=<bearer> node .shots/live-code-mode-e2e.mjs [--setting=auto|on] [--keep] [--base=…]
//     → sets the caller's code mode setting, delegates a task that must search the servers behind
//       code mode, waits for done, then checks: the install note names the split (wrapped / direct),
//       the transcript shows a search and a run, the archived digest carries the mcp block, and the
//       box is torn down (unless --keep). The knowledge blob is checked separately in the container:
//       docker exec agent-sandbox node /app/live-blobs.cjs  (kind mcp-knowledge for the owner).
const flags = process.argv.slice(2);
const flag = (k, d) => flags.find((f) => f.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const BASE = flag("base", "https://agent-sandbox.ajeethkumar.dev");
const SETTING = flag("setting", "auto");
const TOKEN = process.env.ASB_TOKEN;
if (!TOKEN) throw new Error("ASB_TOKEN is required");
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const fails = [];
const check = (ok, what, extra) => {
  log(ok ? "PASS" : "FAIL", what, extra !== undefined ? JSON.stringify(extra).slice(0, 700) : "");
  if (!ok) fails.push(what);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, path, body) {
  const headers = { "content-type": "application/json", authorization: `Bearer ${TOKEN}`, "x-requested-with": "agent-sandbox", origin: BASE };
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }).catch((e) => ({ status: 0, text: async () => String(e) }));
  const text = await res.text();
  if (text.includes(TOKEN)) check(false, `the token was echoed by ${method} ${path}`);
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, json, text };
}
const fleetView = async (box) => ((await call("GET", "/fleet.json")).json?.boxes ?? []).find((b) => b.name === box);
async function waitDone(box, maxPolls = 60) {
  let view;
  for (let i = 0; i < maxPolls; i++) {
    await sleep(8000);
    view = await fleetView(box);
    if (view && !view.absent && /^running$/i.test(view.boxStatus ?? "") && /done|failed|waiting/.test(view.runState ?? "")) break;
  }
  return view;
}

// 1. The setting. The POST echoes the stored driver and model (a body without them resets those).
const prefs = (await call("GET", "/agent-prefs.json")).json;
check(!!prefs?.defaultAgent, "GET /agent-prefs.json", { codeMode: prefs?.codeMode, codeModeDefault: prefs?.codeModeDefault });
const saved = await call("POST", "/agent-prefs.json", { defaultAgent: prefs.defaultAgent, defaultModel: prefs.defaultModel ?? "", codeMode: SETTING });
check(saved.status === 200 && saved.json?.codeMode === SETTING, `code mode set to ${SETTING}`, saved.json?.error ?? { codeMode: saved.json?.codeMode });

// 2. The run.
const t0 = Date.now();
const r = await call("POST", "/delegate.json", {
  task:
    "Report which MCP servers this session can reach and how many tools each one has. Call mcp__code-mode__search with an empty query once (it lists every tool behind code mode; count them per server from the mcp__<server>__<tool> names), and name any MCP server whose tools are in your tool list directly (not behind code mode). Reply with one line per server: `<server>: <count> tools (code mode)` or `<server>: direct`. Then, in one mcp__code-mode__run script, call the cheapest read-only tool of ONE server behind code mode and return the number of top-level keys in its result; append one line `probe: <server> <keys>`. Nothing else. (code mode e2e)",
});
const box = r.json?.box;
check(r.status === 200 && typeof box === "string", `delegate started a run (${Math.round((Date.now() - t0) / 1000)}s)`, { status: r.status, box, error: r.json?.error });
if (!box) process.exit(1);
const view = await waitDone(box);
check(view?.runState === "done", `the run finished (${Math.round((Date.now() - t0) / 1000)}s)`, view && { host: view.host, boxStatus: view.boxStatus, runState: view.runState });

// 3. The install note and the transcript.
const w = (await call("GET", `/watch.json?box=${box}`)).json;
const notes = w?.mcpNotes ?? [];
const on = notes.find((n) => /^code-mode: on \(/.test(n));
check(!!on, "the install note names the split", notes);
const wrapped = on?.match(/wrapped: ([^;)]*)/)?.[1] ?? "";
const direct = on?.match(/direct: ([^)]*)/)?.[1] ?? "";
if (SETTING === "auto") check(/chrome/.test(direct), "auto kept the browser server direct", { wrapped, direct });
check(!notes.some((n) => /^code-mode: fallback/.test(n)), "no fallback", notes);
const logText = w?.log ?? "";
check(logText.includes("mcp__code-mode__search"), "the transcript shows a search");
check(/mcp__code-mode__run/.test(logText), "the transcript shows a run");
const tail = logText.slice(-1500);
log("answer tail:", tail.replace(/\s+/g, " ").slice(-700));

// 4. The archived digest (written on the finish edge; give it a moment).
let mcp;
for (let i = 0; i < 6 && !mcp; i++) {
  await sleep(5000);
  const h = (await call("GET", "/history.json?limit=10")).json;
  const row = (h?.runs ?? []).find((x) => x.box === box);
  mcp = row?.digest?.provenance?.mcp ?? (row?.id !== undefined ? (await call("GET", `/history.json?id=${row.id}`)).json?.run?.digest?.provenance?.mcp : undefined);
}
check(!!mcp && mcp.mode !== "direct", "the archived digest carries the mcp block", mcp);
check(!!mcp && (mcp.scripts ?? 0) >= 1, "the digest counted at least one script", mcp && { scripts: mcp.scripts, calls: mcp.calls });

// 5. Teardown.
if (!flags.includes("--keep")) {
  const t = await call("POST", "/teardown.json", { box });
  check(t.status === 200, "teardown", t.json?.error);
}
console.log(`\nBOX=${box}\nWRAPPED=${wrapped}\nDIRECT=${direct}\n`);
console.log(fails.length ? `${fails.length} FAILED:\n - ${fails.join("\n - ")}` : "ALL PASS");
process.exit(fails.length ? 1 : 0);
