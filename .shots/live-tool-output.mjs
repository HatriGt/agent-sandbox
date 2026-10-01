// Live tool output check: the agent tails a backend access log in a background shell and polls it
// (BashOutput) over ~8 reconnecting snapshots. The live request view must render while the command
// is still running, its counters must only grow, the view must stay the same DOM node through the
// command ending, and the Visual/Raw switch must work while live.
//   node .shots/live-tool-output.mjs [dark] [reduce]      (ASB_UI defaults to http://localhost:5186)
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";
const base = process.env.ASB_UI || "http://localhost:5186";
const BOX = "asb-live-tool";
const lifecycle = { capacity: 4, maxDurationSec: 3600, idleTimeoutSec: 900 };
const paths = ["/api/orders", "/api/users/42", "/health", "/api/cart", "/api/login", "/static/app.js"];
const statuses = [200, 200, 201, 304, 404, 200, 500, 200, 401, 200, 502, 200];
let n = 0;
const chunk = (k) =>
  Array.from({ length: k }, () => {
    const i = n++;
    const m = i % 5 === 3 ? "POST" : "GET";
    return `10.0.0.${i % 9} - - [01/Oct/2026:10:00:${String(i % 60).padStart(2, "0")} +0000] "${m} ${paths[i % paths.length]} HTTP/1.1" ${statuses[i % statuses.length]} ${100 + i} "-" "curl/8" rt=0.${String(10 + ((i * 37) % 80)).padStart(3, "0")}`;
  });
const head = [
  "● session started (model claude-test)",
  "⟦you⟧",
  "keep listening to backend logs and tell me what calls come in and their status",
  "⟦/you⟧",
  "I'll tail the access log in the background and watch it.",
  "→ Bash: tail -f /var/log/nginx/access.log ⟦#aaaa1111⟧",
  "  ⟦#aaaa1111⟧ Command running in background with ID: bash_1",
];
const N = 8;
const snaps = [];
let log = head.join("\n");
for (let s = 0; s < N; s++) {
  if (s > 0) {
    const lines = chunk(3 + s * 2);
    const id = `poll${String(s).padStart(4, "0")}`;
    log += `\n→ BashOutput: bash_1 ⟦#${id}⟧\n  ⟦#${id}⟧ <status>running</status>\n  \n  <stdout>\n${lines.map((l) => "  " + l).join("\n")}\n  </stdout>`;
  }
  if (s === N - 1) log += "\n→ KillShell: bash_1 ⟦#kill0001⟧\n  ⟦#kill0001⟧ Shell bash_1 killed\nDone. Two 5xx so far on /api/cart.\n";
  snaps.push(log);
}
const reduce = process.argv.includes("reduce"), dark = process.argv.includes("dark");
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, reducedMotion: reduce ? "reduce" : "no-preference", colorScheme: dark ? "dark" : "light" });
await ctx.addInitScript(() => { localStorage.setItem("asb-token", "devtoken123"); localStorage.setItem("asb-hub-howto-done", "1"); });
const page = await ctx.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
let hit = 0;
const done = () => hit >= N;
const meta = () => ({ name: BOX, boxStatus: "running", runState: done() ? "idle" : "running", task: "Watch backend calls", role: "cold" });
await page.route("**/fleet.json*", (r) => r.fulfill({ json: { boxes: [meta()], lifecycle } }));
await page.route("**/monitor.json*", (r) => r.fulfill({ json: { boxes: [meta()], lifecycle } }));
await page.route("**/watch.sse*", async (r) => {
  if (hit > 0) await new Promise((res) => setTimeout(res, 900));
  const l = snaps[Math.min(hit, N - 1)];
  hit++;
  const ev = `event: snapshot\nid: ${l.length}\ndata: ${JSON.stringify({ meta: meta(), log: l, from: 0 })}\n\n` + (done() ? `event: state\ndata: ${JSON.stringify(meta())}\n\n` : "");
  r.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: ev });
});
await page.route("**/watch.json*", (r) => r.fulfill({ json: { ...meta(), log: snaps[Math.min(hit, N - 1)] } }));
await page.goto(`${base}/dashboard/box/${BOX}`, { waitUntil: "load" });

const probe = () =>
  page.evaluate(() => {
    const view = document.querySelector("main [data-live-log]");
    const num = (label) => {
      if (!view) return null;
      const c = [...view.querySelectorAll(".label")].find((e) => e.textContent.trim() === label);
      const v = c?.nextElementSibling;
      return v ? Number((v.getAttribute("aria-label") ?? v.textContent).replace(/[^\d.]/g, "")) || 0 : null;
    };
    if (view && !view.dataset.probe) view.dataset.probe = "1";
    return {
      view: !!view,
      kind: view?.getAttribute("data-live-log") ?? null,
      live: !!view && view.hasAttribute("data-live"),
      same: !!document.querySelector("main [data-probe='1']"),
      calls: num("calls"),
      x5: num("5xx"),
      rows: view ? view.querySelectorAll("[data-seq]").length : 0,
      done: /Done\. Two 5xx/.test(document.querySelector("main")?.innerText ?? ""),
    };
  });

let bad = [], tagged = false, last = { calls: 0, x5: 0 }, liveSeen = false, rawChecked = false;
for (let i = 0; i < 300; i++) {
  const s = await probe();
  if (s.view) tagged = true;
  if (s.view && s.live) liveSeen = true;
  if (tagged && !s.same) bad.push(`frame ${i}: live view remounted`);
  if (s.calls !== null && s.calls < last.calls) bad.push(`frame ${i}: calls shrank ${last.calls}->${s.calls}`);
  if (s.x5 !== null && s.x5 < last.x5) bad.push(`frame ${i}: 5xx shrank ${last.x5}->${s.x5}`);
  if (s.calls !== null) last = { calls: Math.max(last.calls, s.calls), x5: Math.max(last.x5, s.x5 ?? 0) };
  // While live: flip to Raw (terminal text appears, view hidden but still mounted), then back.
  if (s.view && s.live && !rawChecked && hit >= 4) {
    rawChecked = true;
    await page.getByRole("button", { name: "Raw", exact: true }).first().click();
    await page.waitForTimeout(150);
    const r = await page.evaluate(() => ({
      pre: [...document.querySelectorAll("main pre")].some((p) => /HTTP\/1\.1" \d{3}/.test(p.innerText)),
      hidden: !!document.querySelector("main [data-probe='1']") && document.querySelector("main [data-probe='1']").offsetParent === null,
    }));
    if (!r.pre) bad.push("Raw switch did not show the terminal output");
    if (!r.hidden) bad.push("Raw switch did not hide (or unmounted) the live view");
    await page.screenshot({ path: `.shots/out/live-tool-output-raw${dark ? "-dark" : ""}.png`, fullPage: true });
    await page.getByRole("button", { name: "Visual", exact: true }).first().click();
    await page.waitForTimeout(150);
  }
  if (i % 10 === 0) console.log(i, "hit", hit, JSON.stringify(s));
  if (s.live && hit === 4) await page.screenshot({ path: `.shots/out/live-tool-output-live${dark ? "-dark" : ""}${reduce ? "-reduce" : ""}.png`, fullPage: true });
  if (s.done && done() && i > 5) { await page.waitForTimeout(1500); break; }
  await page.waitForTimeout(100);
}
const end = await probe();
if (!liveSeen) bad.push("live view never rendered while the command was running");
if (!rawChecked) bad.push("Raw switch never exercised while live");
if (!end.same) bad.push("live view remounted when the command ended");
if (end.calls !== n) bad.push(`final calls ${end.calls} != ${n} lines served`);
await page.screenshot({ path: `.shots/out/live-tool-output${dark ? "-dark" : ""}${reduce ? "-reduce" : ""}.png`, fullPage: true });
console.log("snapshots served:", hit, "| lines:", n, "| end:", JSON.stringify(end));
console.log(bad.length ? "FAIL\n" + [...new Set(bad)].slice(0, 10).join("\n") : "PASS");
console.log("errors:", errors.slice(0, 3).join(" | ") || "none");
await browser.close();
