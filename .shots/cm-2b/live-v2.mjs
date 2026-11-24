// Live proof of the code-mode round two (compact search, tool index, previews, saved scripts,
// approval + replay) against the public controller under the caller's account.
//   ASB_TOKEN=… node .shots/cm-2b/live-v2.mjs --phase=audit            → new box, CF audit; keeps the box, prints BOX=
//   ASB_TOKEN=… node .shots/cm-2b/live-v2.mjs --phase=approve --box=X  → follow-up on X that needs an approval; answers yes
//   ASB_TOKEN=… node .shots/cm-2b/live-v2.mjs --phase=reuse            → new box, the same audit; the saved script should be rerun
// Each phase saves the box log under .shots/cm-2b/trace-v2-<phase>.log and prints the stats line.
const flags = process.argv.slice(2);
const flag = (k, d) => flags.find((f) => f.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const BASE = "https://agent-sandbox.ajeethkumar.dev";
const TOKEN = process.env.ASB_TOKEN;
const PHASE = flag("phase", "audit");
let BOX = flag("box", "");
if (!TOKEN) throw new Error("ASB_TOKEN is required");
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, path, body) {
  const headers = { "content-type": "application/json", authorization: `Bearer ${TOKEN}`, "x-requested-with": "agent-sandbox", origin: BASE };
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text), text };
  } catch {
    return { status: res.status, json: null, text };
  }
}

const AUDIT =
  "Using the btp-cf MCP server only (read-only): find the Cloud Foundry org and space the server is targeted at (or the first available), list the apps there (up to 12), and for each app report in one markdown table: name, state, instance count, memory, and the timestamp of its most recent log line. Flag apps that are not STARTED. End with a one-line summary. No other tools, no files.";
const APPROVE =
  "Using the btp-cf MCP server: in org adev01-dev, space dev, find the app named app_an_view_schema_map-db and add the metadata label asb-approval-test with value " +
  new Date().toISOString().slice(0, 10) +
  " to it (PATCH the app's metadata.labels; keep every other label). Then read the app back and report its labels in one line. No other tools, no files.";

const fleetView = async (box) => ((await call("GET", "/fleet.json")).json?.boxes ?? []).find((b) => b.name === box);
const watch = async (box) => (await call("GET", `/watch.json?box=${box}`)).json;

async function setMode(m) {
  const prefs = (await call("GET", "/agent-prefs.json")).json;
  const r = await call("POST", "/agent-prefs.json", { defaultAgent: prefs.defaultAgent, defaultModel: prefs.defaultModel ?? "", codeMode: m });
  if (r.status !== 200) throw new Error(`could not set code mode ${m}: ${r.text.slice(0, 200)}`);
  return prefs.codeMode ?? "auto";
}

async function waitState(box, re, maxSec) {
  for (let i = 0; i < maxSec / 5; i++) {
    await sleep(5000);
    const v = await fleetView(box);
    if (v && re.test(v.runState ?? "")) return v;
  }
  return undefined;
}

function measure(text) {
  const lines = text.split("\n");
  let usage = null, requests = 0, scripts = 0, searches = 0, scriptCalls = 0, snippetRuns = 0, resumes = 0, paused = 0, replayed = 0, firstAt = null, lastAt = null;
  const tools = {};
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
    const t = line.match(/^→ ([A-Za-z0-9_-]+)(.*)$/);
    if (t) {
      tools[t[1]] = (tools[t[1]] ?? 0) + 1;
      if (t[1] === "mcp__code-mode__run") {
        scripts++;
        if (/"?snippet"?\s*[:=]/.test(t[2])) snippetRuns++;
        if (/"?resume"?\s*[:=]/.test(t[2])) resumes++;
      } else if (t[1] === "mcp__code-mode__search") searches++;
    }
    const c = line.match(/^--- (\d+) MCP calls?\b/);
    if (c) scriptCalls += +c[1];
    if (/^Paused: call #/.test(line)) paused++;
    if (/\(replayed\)/.test(line)) replayed++;
  }
  return { usage, requests, tools, scripts, searches, scriptCalls, snippetRuns, resumes, paused, replayed, agentMs: firstAt && lastAt ? lastAt - firstAt : null };
}

async function finish(box, phase, t0) {
  const w = await watch(box);
  const text = w?.log ?? "";
  const { writeFileSync } = await import("node:fs");
  writeFileSync(`.shots/cm-2b/trace-v2-${phase}.log`, text);
  const m = measure(text);
  const u = m.usage ?? {};
  log(`STATS ${phase} box=${box} wall=${Math.round((Date.now() - t0) / 1000)}s agent=${Math.round((m.agentMs ?? 0) / 1000)}s reqs=${m.requests} in=${u.in} cr=${u.cr} cw=${u.cw} out=${u.out} ctx=${u.ctx} scripts=${m.scripts} searches=${m.searches} callsInScripts=${m.scriptCalls} snippetRuns=${m.snippetRuns} paused=${m.paused} resumes=${m.resumes} replayed=${m.replayed}`);
  log("tools:", JSON.stringify(m.tools));
  const i = text.lastIndexOf("⟦at⟧");
  log("tail:", text.slice(Math.max(0, text.length - 1200)).replace(/\s+/g, " "));
  return m;
}

async function newBox(task, phase) {
  const before = await setMode("on");
  const t0 = Date.now();
  const r = await call("POST", "/delegate.json", { task });
  BOX = r.json?.box;
  log("box", BOX, r.json?.error ?? "");
  if (!BOX) throw new Error(r.text.slice(0, 300));
  for (let i = 0; i < 40; i++) {
    await sleep(5000);
    const w = await watch(BOX);
    if ((w?.mcpNotes ?? []).length) {
      log("notes", w.mcpNotes.join(" | "));
      break;
    }
  }
  await setMode(before);
  const v = await waitState(BOX, /done|failed|waiting/, 900);
  log("state", v?.runState, "host", v?.host);
  await finish(BOX, phase, t0);
  console.log(`BOX=${BOX}`);
}

if (PHASE === "audit") await newBox(AUDIT, "audit");
else if (PHASE === "reuse") await newBox(AUDIT + " (Reuse the saved script if one fits.)", "reuse");
else if (PHASE === "approve") {
  if (!BOX) throw new Error("--box is required");
  const t0 = Date.now();
  const r = await call("POST", "/resume.json", { box: BOX, message: APPROVE });
  log("follow-up sent", r.status, r.text.slice(0, 120));
  const waiting = await waitState(BOX, /waiting/, 600);
  if (!waiting) {
    log("never asked");
    await finish(BOX, "approve", t0);
    process.exit(1);
  }
  const w = await watch(BOX);
  log("QUESTION:", (w?.question ?? w?.status ?? "").replace(/\s+/g, " ").slice(0, 800));
  await sleep(2000);
  const a = await call("POST", "/resume.json", { box: BOX, message: "Yes, go ahead and add the label." });
  log("answered", a.status, a.text.slice(0, 120));
  const done = await waitState(BOX, /done|failed/, 600);
  log("state", done?.runState);
  await finish(BOX, "approve", t0);
}
