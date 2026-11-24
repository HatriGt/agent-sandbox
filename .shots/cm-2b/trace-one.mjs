// One code-mode run with the full box log saved, for reading how the model used search/run.
//   ASB_TOKEN=… node .shots/cm-2b/trace-one.mjs --setting=on --task="…" [--out=.shots/cm-2b/trace.log] [--keep]
const flags = process.argv.slice(2);
const flag = (k, d) => flags.find((f) => f.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const BASE = "https://agent-sandbox.ajeethkumar.dev";
const TOKEN = process.env.ASB_TOKEN;
const SETTING = flag("setting", "on");
const OUT = flag("out", ".shots/cm-2b/trace.log");
const TASK = flag("task", "");
if (!TOKEN || !TASK) throw new Error("ASB_TOKEN and --task are required");
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, path, body) {
  const headers = { "content-type": "application/json", authorization: `Bearer ${TOKEN}`, "x-requested-with": "agent-sandbox", origin: BASE };
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  try { return { status: res.status, json: JSON.parse(text) }; } catch { return { status: res.status, json: null, text }; }
}
const prefs = (await call("GET", "/agent-prefs.json")).json;
const before = prefs.codeMode ?? "auto";
const setMode = (m) => call("POST", "/agent-prefs.json", { defaultAgent: prefs.defaultAgent, defaultModel: prefs.defaultModel ?? "", codeMode: m });
await setMode(SETTING);
const t0 = Date.now();
const r = await call("POST", "/delegate.json", { task: TASK });
const box = r.json?.box;
log("box", box, r.json?.error ?? "");
for (let i = 0; i < 40 && box; i++) {
  await sleep(5000);
  const w = (await call("GET", `/watch.json?box=${box}`)).json;
  if ((w?.mcpNotes ?? []).length) { log("notes", w.mcpNotes.join(" | ")); break; }
}
await setMode(before);
let view;
for (let i = 0; i < 90; i++) {
  await sleep(10000);
  view = ((await call("GET", "/fleet.json")).json?.boxes ?? []).find((b) => b.name === box);
  if (view && /done|failed|waiting/.test(view.runState ?? "")) break;
}
log("state", view?.runState, "after", Math.round((Date.now() - t0) / 1000), "s");
const w = (await call("GET", `/watch.json?box=${box}`)).json;
const { writeFileSync } = await import("node:fs");
writeFileSync(OUT, w?.log ?? "");
log("saved", OUT, (w?.log ?? "").length, "chars");
if (!flags.includes("--keep")) log("teardown", (await call("POST", "/teardown.json", { box })).status);
