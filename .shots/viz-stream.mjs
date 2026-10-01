// Live-visual check: a reply with chart / stats / steps fences streams in over ~12 reconnecting
// snapshots. Each frame must show no code panel for an open visual fence, the chart's bar count must
// only grow, and the chart element must stay the same DOM node from first draw to the finished reply.
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";
const base = process.env.ASB_UI || "http://localhost:5181";
const BOX = "asb-viz-stream";
const lifecycle = { capacity: 4, maxDurationSec: 3600, idleTimeoutSec: 900 };
const f = (lang, body) => "```" + lang + "\n" + body + "\n```\n\n";
const full = "Counting calls per bucket.\n\n" +
  f("chart", '{"type":"bar","title":"Calls per 5s bucket","x":["31:00","34:10","34:15","34:20","34:25","34:30","34:35","34:40"],"series":[{"name":"calls","data":[1,6,4,5,3,5,1,5]}]}') +
  f("stats", "Calls: 30 | +12%\np95: 210ms | -40ms!\nErrors: 0") +
  f("steps", "1. Pull logs ✓\n2. Bucket calls ✓\n3. Chart …") + "Done.\n";
const N = 9;
const cuts = Array.from({ length: N }, (_, i) => Math.round(((i + 1) / N) * full.length));
const reduce = process.argv.includes("reduce"), dark = process.argv.includes("dark");
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, reducedMotion: reduce ? "reduce" : "no-preference", colorScheme: dark ? "dark" : "light" });
await ctx.addInitScript(() => { localStorage.setItem("asb-token", "devtoken123"); localStorage.setItem("asb-hub-howto-done", "1"); });
const page = await ctx.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
let hit = 0;
const done = () => hit >= N;
const meta = () => ({ name: BOX, boxStatus: "running", runState: done() ? "idle" : "running", task: "Chart the calls", role: "cold" });
await page.route("**/fleet.json*", (r) => r.fulfill({ json: { boxes: [meta()], lifecycle } }));
await page.route("**/monitor.json*", (r) => r.fulfill({ json: { boxes: [meta()], lifecycle } }));
await page.route("**/watch.sse*", async (r) => {
  if (hit > 0) await new Promise((res) => setTimeout(res, 600));
  const log = full.slice(0, cuts[Math.min(hit, N - 1)]);
  hit++;
  const ev = `event: snapshot\nid: ${log.length}\ndata: ${JSON.stringify({ meta: meta(), log, from: 0 })}\n\n` + (done() ? `event: state\ndata: ${JSON.stringify(meta())}\n\n` : "");
  r.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: ev });
});
await page.route("**/watch.json*", (r) => r.fulfill({ json: { ...meta(), log: full.slice(0, cuts[Math.min(hit, N - 1)]) } }));
await page.goto(`${base}/dashboard/box/${BOX}`, { waitUntil: "load" });
let lastBars = 0, bad = [], tagged = false;
for (let i = 0; i < 400; i++) {
  const s = await page.evaluate(() => {
    const main = document.querySelector("main") ?? document.body;
    const pres = [...main.querySelectorAll("pre")].map((p) => p.innerText);
    const codeLeak = pres.some((t) => /"type":"bar"|Calls: 30|Pull logs/.test(t));
    const chart = [...main.querySelectorAll("[class*='group/viz']")].find((el) => /Calls per 5s bucket/.test(el.textContent));
    const bars = chart ? chart.querySelectorAll("rect.viz-grow, rect").length : 0;
    if (chart && !chart.dataset.probe) chart.dataset.probe = "1";
    const same = !!main.querySelector("[data-probe='1']");
    return { codeLeak, bars, chart: !!chart, same, skel: main.querySelectorAll("[data-viz-skeleton]").length, done: /Done\./.test(main.innerText) };
  });
  if (s.chart) tagged = true;
  if (s.codeLeak) bad.push(`frame ${i}: code panel for a visual fence`);
  if (s.bars < lastBars) bad.push(`frame ${i}: bars shrank ${lastBars}->${s.bars}`);
  if (tagged && !s.same) bad.push(`frame ${i}: chart remounted`);
  lastBars = Math.max(lastBars, s.bars);
  if (i % 10 === 0) console.log(i, JSON.stringify(s));
  if (s.done && done() && i > 5) { await page.waitForTimeout(1500); break; }
  await page.waitForTimeout(100);
}
const end = await page.evaluate(() => ({ same: !!document.querySelector("main [data-probe='1']"), pre: document.querySelectorAll("main pre").length }));
if (!end.same) bad.push("chart remounted when the reply finished");
await page.screenshot({ path: `.shots/out/viz-stream${dark ? "-dark" : ""}${reduce ? "-reduce" : ""}.png`, fullPage: true });
console.log("snapshots served:", hit, "| max bars:", lastBars, "| end:", JSON.stringify(end));
console.log(bad.length ? "FAIL\n" + [...new Set(bad)].slice(0, 10).join("\n") : "PASS");
console.log("errors:", errors.slice(0, 3).join(" | ") || "none");
await browser.close();
