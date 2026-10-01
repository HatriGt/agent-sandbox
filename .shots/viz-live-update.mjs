// Live-update check: the reply re-emits a titled stats block 3 times with changing numbers (an
// agent looping tail → summary). The thread must show ONE stats block whose DOM node is never
// remounted (data-probe), ending at the last version's values, plus a collapsed "updated" row.
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";
const base = process.env.ASB_UI || "http://localhost:5185";
const BOX = "asb-viz-live";
const lifecycle = { capacity: 4, maxDurationSec: 3600, idleTimeoutSec: 900 };
const block = (calls, errs, p95) => "**Backend traffic**\n\n```stats\nCalls: " + calls + "\nErrors: " + errs + "\np95: " + p95 + "ms\n```\n\n";
const parts = [
  "Tailing the backend log.\n\n" + block(12, 0, 210),
  "Still listening — new calls came in.\n\n" + block(31, 1, 230),
  "Another batch.\n\n" + block(58, 2, 190) + "Done.\n",
];
const logs = parts.map((_, i) => parts.slice(0, i + 1).join(""));
const N = logs.length;
const reduce = process.argv.includes("reduce"), dark = process.argv.includes("dark");
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, reducedMotion: reduce ? "reduce" : "no-preference", colorScheme: dark ? "dark" : "light" });
await ctx.addInitScript(() => { localStorage.setItem("asb-token", "devtoken123"); localStorage.setItem("asb-hub-howto-done", "1"); });
const page = await ctx.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
let hit = 0;
const done = () => hit >= N;
const meta = () => ({ name: BOX, boxStatus: "running", runState: done() ? "idle" : "running", task: "Keep listening to backend logs and tell me calls + status", role: "cold" });
await page.route("**/fleet.json*", (r) => r.fulfill({ json: { boxes: [meta()], lifecycle } }));
await page.route("**/monitor.json*", (r) => r.fulfill({ json: { boxes: [meta()], lifecycle } }));
await page.route("**/watch.sse*", async (r) => {
  if (hit > 0) await new Promise((res) => setTimeout(res, 2500));
  const log = logs[Math.min(hit, N - 1)];
  hit++;
  const ev = `event: snapshot\nid: ${log.length}\ndata: ${JSON.stringify({ meta: meta(), log, from: 0 })}\n\n` + (done() ? `event: state\ndata: ${JSON.stringify(meta())}\n\n` : "");
  r.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: ev });
});
await page.route("**/watch.json*", (r) => r.fulfill({ json: { ...meta(), log: logs[Math.min(hit, N - 1)] } }));
await page.goto(`${base}/dashboard/box/${BOX}`, { waitUntil: "load" });
const bad = [];
let tagged = false, maxBlocks = 0, s, firstAt = -1;
for (let i = 0; i < 300; i++) {
  s = await page.evaluate((tagged) => {
    const main = document.querySelector("main") ?? document.body;
    const blocks = [...main.querySelectorAll("[class*='group/viz']")].filter((el) => /Calls/.test(el.textContent));
    const b = blocks[0];
    if (b && !tagged && !b.dataset.probe) b.dataset.probe = "1";
    return {
      blocks: blocks.length,
      same: !!main.querySelector("[data-probe='1']"),
      text: b ? b.innerText.replace(/\s+/g, " ").slice(0, 120) : "",
      rows: main.querySelectorAll("[data-live-copy]").length,
      rowText: [...main.querySelectorAll("[data-live-copy]")].map((r) => r.innerText.replace(/\s+/g, " ")).join(" | "),
      badge: main.querySelector("[data-live-badge]")?.textContent ?? "",
      pre: [...main.querySelectorAll("pre")].some((p) => /Calls: \d/.test(p.innerText)),
      done: /Done\./.test(main.innerText),
    };
  }, tagged);
  // Watch for remounts from the first re-emit on: the initial load can swap skeleton → transcript once (Swap).
  if (s.blocks && firstAt < 0) firstAt = i;
  if (s.blocks && firstAt >= 0 && i - firstAt >= 10 && hit < 2 && !tagged) { tagged = true; await page.evaluate(() => { const m = document.querySelector("main"); m.querySelectorAll("[data-probe]").forEach((e) => delete e.dataset.probe); const b = [...m.querySelectorAll("[class*='group/viz']")].find((el) => /Calls/.test(el.textContent)); if (b) b.dataset.probe = "1"; }); continue; }
  maxBlocks = Math.max(maxBlocks, s.blocks);
  if (s.blocks > 1) bad.push(`frame ${i}: ${s.blocks} stats blocks`);
  if (tagged && !s.same) { bad.push(`frame ${i}: stats block remounted`); console.log("remount", i, JSON.stringify(s)); }
  if (s.pre) bad.push(`frame ${i}: stats source leaked as code`);
  if (i % 10 === 0) console.log(i, JSON.stringify(s));
  if (s.done && done() && i > 5) { await page.waitForTimeout(2500); break; }
  await page.waitForTimeout(100);
}
const end = await page.evaluate(() => {
  const main = document.querySelector("main");
  const b = main.querySelector("[data-probe='1']");
  return { same: !!b, text: b?.innerText.replace(/\s+/g, " ") ?? "", rows: [...main.querySelectorAll("[data-live-copy]")].map((r) => r.innerText.replace(/\s+/g, " ")) };
});
if (!end.same) bad.push("stats block remounted at the end");
if (!/58/.test(end.text) || /\b12\b/.test(end.text)) bad.push("final values are not the last version: " + end.text);
if (!end.rows.some((r) => /updated/i.test(r))) bad.push("no Updated row");
await page.screenshot({ path: `.shots/out/viz-live-update${dark ? "-dark" : ""}${reduce ? "-reduce" : ""}.png`, fullPage: true });
console.log("snapshots:", hit, "| max blocks:", maxBlocks, "| end:", JSON.stringify(end));
console.log(bad.length ? "FAIL\n" + [...new Set(bad)].slice(0, 10).join("\n") : "PASS");
console.log("errors:", errors.slice(0, 3).join(" | ") || "none");
await browser.close();
