// Viz interaction check (Phase 3): legend toggle, crosshair keyboard scrub, table filter,
// tree fold, log search. Prints PASS/FAIL per step.
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";
const base = process.env.ASB_UI || "http://localhost:5183";
const BOX = "asb-viz-test";
const meta = { name: BOX, boxStatus: "running", runState: "idle", task: "Interact", role: "cold" };
const lifecycle = { capacity: 4, maxDurationSec: 3600, idleTimeoutSec: 900 };
const f = (lang, body) => "```" + lang + "\n" + body + "\n```\n\n";
const csv = "name,ms\n" + Array.from({ length: 12 }, (_, i) => `route-${i},${(i + 1) * 10}`).join("\n");
const log = "Results.\n\n" +
  f("chart", '{"type":"line","title":"latency","x":["a","b","c","d","e"],"series":[{"name":"p50","data":[1,2,3,2,1]},{"name":"p95","data":[4,6,5,7,6]}]}') +
  f("csv", csv) +
  f("tree", "src/\n  app/\n    main.ts\n    util.ts\n  lib/\n    a.ts\nREADME.md") +
  f("log", "INFO boot ok\nWARN slow disk\nERROR db timeout\nINFO retry\nDEBUG tick") + "Done.\n";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1800 } });
await ctx.addInitScript(() => { localStorage.setItem("asb-token", "devtoken123"); localStorage.setItem("asb-hub-howto-done", "1"); });
const page = await ctx.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
await page.route("**/fleet.json*", (r) => r.fulfill({ json: { boxes: [meta], lifecycle } }));
await page.route("**/monitor.json*", (r) => r.fulfill({ json: { boxes: [meta], lifecycle } }));
await page.route("**/watch.sse*", (r) => r.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: `event: snapshot\nid: ${log.length}\ndata: ${JSON.stringify({ meta, log, from: 0 })}\n\n` }));
await page.route("**/watch.json*", (r) => r.fulfill({ json: { ...meta, log } }));
await page.goto(`${base}/dashboard/box/${BOX}`, { waitUntil: "load" });
await page.waitForTimeout(2500);
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"} ${name} ${extra}`);

// 1. Legend toggle
const p95 = page.locator('main button[data-series="p95"]');
await p95.click();
check("legend toggle hides p95", (await p95.getAttribute("aria-pressed")) === "false");
const p50 = page.locator('main button[data-series="p50"]');
await p50.click();
check("last visible series stays on", (await p50.getAttribute("aria-pressed")) === "true");
await p95.click();

// 2. Crosshair scrub
const svg = page.locator("main svg[data-viz-scrub]").first();
await svg.focus();
await page.keyboard.press("ArrowRight");
await page.keyboard.press("ArrowRight");
const tip = await page.locator("main [data-viz-tip]").first().innerText().catch(() => "");
check("crosshair reads both series at 'b'", tip.includes("b") && tip.includes("p50: 2") && tip.includes("p95: 6"), JSON.stringify(tip));

// 3. Table filter
const filter = page.locator('main input[aria-label="Filter rows"]');
await filter.fill("route-1");
const rows = await filter.locator("xpath=ancestor::div[contains(@class,'group/viz')]").locator("tbody tr").count();
check("table filter", rows === 3, `rows=${rows}`); // route-1, route-10, route-11

// 4. Tree fold
const app = page.locator('main button[data-tree-path="src"]');
const before = await page.locator('main [data-tree-path="src/main.ts"]').count();
await app.click();
const after = await page.locator('main [data-tree-path="src/main.ts"]').count();
check("tree fold", before === 1 && after === 0, `before=${before} after=${after}`);

// 5. Log search + jump
const search = page.locator('main input[aria-label="Search log"]');
await search.fill("retry");
const shown = await search.locator("xpath=ancestor::div[contains(@class,'group/viz')]").locator("[data-line]").count();
check("log search", shown === 1, `lines=${shown}`);
await page.locator('main button[aria-label="Jump to first error"]').click();
await page.waitForTimeout(200);
check("jump to first error clears hiding search", (await page.locator('main [data-line="2"]').count()) === 1);

await page.screenshot({ path: ".shots/out/viz-interact.png", fullPage: true });
console.log(results.join("\n"));
console.log("errors:", errors.slice(0, 3).join(" | ") || "none");
await browser.close();



