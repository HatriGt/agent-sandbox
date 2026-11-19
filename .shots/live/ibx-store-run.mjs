import { readFileSync } from "node:fs";
const BASE = "https://agent-sandbox.ajeethkumar.dev";
const TOKEN = process.env.ASB_TOKEN || readFileSync(".shots/.asb-token", "utf8").trim();
const H = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", "x-requested-with": "agent-sandbox", origin: BASE };
const call = async (m, p, b) => { const r = await fetch(BASE + p, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
const t0 = Date.now();
const d = await call("POST", "/delegate.json", { task: "Reply with the single word READY and nothing else.", host: "instabox-b" });
console.log(`delegate ${d.s} ${((Date.now() - t0) / 1000).toFixed(1)}s box=${d.j.box}`);
const box = d.j.box; if (!box) process.exit(1);
for (let i = 0; i < 60; i++) {
  await new Promise(r => setTimeout(r, 5000));
  const w = await call("GET", `/watch.json?box=${encodeURIComponent(box)}`);
  if (w.j.runState && w.j.runState !== "running") { console.log(`turn ${w.j.runState} ${((Date.now() - t0) / 1000).toFixed(1)}s`); break; }
}
const t = await call("POST", "/teardown.json", { box, force: true });
console.log(`teardown ${t.s}`);
