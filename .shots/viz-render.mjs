// Viz render check: an agent reply full of fences written the way agents drift from the spec
// (`x` for labels, bullets, `=`, `-->`). Every fence must render as a visualizer, not code.
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";
const base = process.env.ASB_UI || "http://localhost:5181";
const BOX = "asb-viz-test";
const meta = { name: BOX, boxStatus: "running", runState: "idle", task: "Chart the calls", role: "cold" };
const lifecycle = { capacity: 4, maxDurationSec: 3600, idleTimeoutSec: 900 };
const f = (lang, body) => "```" + lang + "\n" + body + "\n```\n\n";
const log = "Here are the results.\n\n" +
  f("chart", '{"type":"bar","title":"Deal QA received calls — 5s buckets (2026-10-01 UTC)","x":["31:00","34:10","34:15","34:20","34:25","34:30","34:35","34:40","34:45","34:50","34:55","35:00"],"series":[{"name":"calls","data":[1,6,4,5,3,5,1,5,4,2,8,5]}]}') +
  f("stats", "- **Calls**: 49\n- p95 = 210ms") +
  f("timeline", "10:00 - started\n10:05 - tests ✗") +
  f("steps", "- [x] Clone\n- [ ] Build") +
  f("flow", "build --> test --> deploy") +
  f("progress", "- coverage | 72%") + "Done.\n";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1600 } });
await ctx.addInitScript(() => { localStorage.setItem("asb-token", "devtoken123"); localStorage.setItem("asb-hub-howto-done", "1"); });
const page = await ctx.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
await page.route("**/fleet.json*", (r) => r.fulfill({ json: { boxes: [meta], lifecycle } }));
await page.route("**/monitor.json*", (r) => r.fulfill({ json: { boxes: [meta], lifecycle } }));
await page.route("**/watch.sse*", (r) => r.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: `event: snapshot\nid: ${log.length}\ndata: ${JSON.stringify({ meta, log, from: 0 })}\n\n` }));
await page.route("**/watch.json*", (r) => r.fulfill({ json: { ...meta, log } }));
await page.goto(`${base}/dashboard/box/${BOX}`, { waitUntil: "load" });
await page.waitForTimeout(2500);
const raw = await page.evaluate(() => [...document.querySelectorAll("main pre")].map((p) => p.innerText.slice(0, 40)));
console.log("svg charts:", await page.locator("main svg").count(), "| raw code blocks left:", raw.length, JSON.stringify(raw));
await page.screenshot({ path: ".shots/out/viz-render.png", fullPage: true });
console.log("errors:", errors.slice(0, 3).join(" | ") || "none");
await browser.close();
