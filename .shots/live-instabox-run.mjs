// Live proof that a run lands on the Instabox host and finishes there.
//   ASB_TOKEN=<operator bearer> node .shots/live-instabox-run.mjs [--base=https://...] [--host=instabox-a]
// Waits for the host's prepare to end, puts the host at order -1 (ahead of every other host),
// delegates one run, watches it through /fleet.json, tears the box down, and puts the order back to 0.
import { readFileSync } from "node:fs";
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split("=").slice(1).join("=");
const BASE = arg("base", "https://agent-sandbox.ajeethkumar.dev");
const HOST = arg("host", "instabox-a");
const TOKEN = process.env.ASB_TOKEN || readFileSync(".shots/.asb-token", "utf8").trim();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const call = async (method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  return { status: r.status, json };
};
const hostRow = async () => (await call("GET", "/hosts.json")).json.hosts.find((h) => h.id === HOST);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let box;
try {
  // 1. the prepare must be over
  for (let i = 0; i < 90; i++) {
    const h = await hostRow();
    if (!h) throw new Error(`no host ${HOST}`);
    if (!h.prepare?.running) { log("prepare:", JSON.stringify(h.prepare)); if (h.prepare && h.prepare.ok === false) throw new Error(`prepare failed: ${h.prepare.error}`); break; }
    if (i % 3 === 0) log("prepare running:", h.prepare.steps.at(-1) ?? "(starting)");
    await sleep(10000);
  }
  // 2. ahead of everyone
  let r = await call("POST", "/hosts.json", { action: "upsert", id: HOST, spec: { priority: -1 } });
  if (r.status !== 200) throw new Error(`upsert: ${r.json?.error}`);
  log("host at order -1; check:", JSON.stringify(r.json.check), "providerState:", JSON.stringify(r.json.host?.providerState));
  // 3. one run
  const t0 = Date.now();
  r = await call("POST", "/delegate.json", { task: `Run \`hostname\`, \`nproc\`, \`cat /proc/1/cgroup | head -2\` and \`ls /dev/kvm 2>&1\`; print each result on its own line, then finish. (instabox live proof ${Date.now().toString(36)})` });
  box = r.json?.box;
  log("delegate:", r.status, box ?? r.json?.error ?? JSON.stringify(r.json).slice(0, 300));
  if (!box) throw new Error("no box");
  let view;
  for (let i = 0; i < 45; i++) {
    await sleep(8000);
    const f = (await call("GET", "/fleet.json")).json;
    view = f?.boxes?.find((b) => b.name === box);
    if (i % 2 === 0) log("fleet:", view ? `host=${view.host} runState=${view.runState} boxStatus=${view.boxStatus}` : "(not listed yet)");
    if (view && /done|failed|waiting/.test(view.runState ?? "")) break;
  }
  log(`run ended after ${Math.round((Date.now() - t0) / 1000)}s:`, JSON.stringify(view && { host: view.host, runState: view.runState, exitCode: view.exitCode, boxStatus: view.boxStatus, agent: view.agent }));
  // 4. what the agent said
  const out = await call("GET", `/watch.json?box=${encodeURIComponent(box)}&lines=200`);
  const text = out.json?.log ?? out.json?.tail ?? (Array.isArray(out.json?.lines) ? out.json.lines.join("\n") : undefined) ?? JSON.stringify(out.json).slice(0, 2000);
  log("output tail:\n" + String(text).slice(-1200));
  const ok = view?.host === HOST && view?.runState === "done";
  log(ok ? "PASS: the run landed on the Instabox host and finished" : "FAIL: see above");
} finally {
  if (box) {
    const t = await call("POST", "/teardown.json", { box });
    log("teardown:", t.status, t.json?.error ?? "ok");
  }
  const r = await call("POST", "/hosts.json", { action: "upsert", id: HOST, spec: { priority: 0 } });
  log("host back at order 0:", r.status, r.json?.host?.priority);
}
