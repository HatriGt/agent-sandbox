// Round 4 tables: a thread whose reply holds a wide 6-column table, a chartable 3-column table and
// a csv fence. Drives a header-edge drag (mid-drag shot), proves the width survives a reload, scrolls
// the widened table sideways under its sticky first column, flips Table⇄Chart, copies CSV, nudges a
// grip by keyboard, resets it, then drags a column on the page-level History table.
//
//   node .shots/r4-tables.mjs [width] [--dark]        (ASB_UI defaults to http://localhost:5173)
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";
import { serveWorktreeFonts } from "./overflow-probe.mjs";

const [w = "1440", ...flags] = process.argv.slice(2);
const dark = flags.includes("--dark");
const base = process.env.ASB_UI || "http://localhost:5173";
const tag = `${w}-${dark ? "dark" : "light"}`;
const shot = (name, opts = {}) => page.screenshot({ path: `.shots/out/r4-tables-${tag}-${name}.png`, ...opts });
const BOX = "asb-r4-tables";
const meta = { name: BOX, boxStatus: "running", runState: "idle", task: "Audit the services", role: "cold" };
const lifecycle = { capacity: 4, maxDurationSec: 3600, idleTimeoutSec: 900 };
const f = (lang, body) => "```" + lang + "\n" + body + "\n```\n\n";

const services = ["alpha-gateway", "billing-core", "catalog-sync", "delta-indexer", "echo-mailer", "fleet-scheduler", "gamma-auth", "hermes-queue", "iris-search", "juno-ledger", "kappa-cache", "lambda-webhooks", "metrics-rollup", "notify-push"];
const owners = ["platform", "payments", "growth", "data", "comms", "infra", "identity"];
const blurbs = [
  "Terminates TLS for every public hostname and forwards to the mesh with per-tenant rate limits applied at the edge.",
  "Posts invoices to the ledger nightly and reconciles Stripe payouts against the open balance for each account.",
  "Pulls catalog deltas from the partner feed, normalises SKUs and writes the merged product graph for search.",
  "Rebuilds the inverted index in the background whenever a tenant crosses ten thousand documents.",
  "Renders transactional mail from MJML templates and retries bounces with exponential backoff for two days.",
];
const wide =
  "| Service | Owner | Description | Region | Latency ms | Status |\n|---|---|---|---|---|---|\n" +
  services.map((s, i) => `| ${s} | ${owners[i % owners.length]} | ${blurbs[i % blurbs.length]} | ${["eu-west-1", "us-east-2", "ap-south-1"][i % 3]} | ${(i * 37) % 420 + 12} | ${i % 5 === 3 ? "✗" : "✓"} |`).join("\n");
const numeric = "| Route | p50 | p95 |\n|---|---|---|\n" + ["/", "/api/runs", "/api/fleet", "/history", "/settings", "/dashboard"].map((r, i) => `| ${r} | ${(i + 1) * 12} | ${(i + 1) * 31} |`).join("\n");
const csv = "name,ms,calls\n" + Array.from({ length: 10 }, (_, i) => `route-${i},${(i + 1) * 10},${(10 - i) * 7}`).join("\n");
const log = "Here is what I found across the fleet.\n\n" + wide + "\n\nLatency by route:\n\n" + numeric + "\n\nAnd the raw samples:\n\n" + f("csv", csv) + "Done.\n";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: +w, height: 1100 }, colorScheme: dark ? "dark" : "light", deviceScaleFactor: 1, permissions: ["clipboard-read", "clipboard-write"] });
await ctx.addInitScript((dark) => {
  localStorage.setItem("asb-token", "devtoken123");
  localStorage.setItem("asb-hub-howto-done", "1");
  localStorage.setItem("asb-dark", dark ? "1" : "0");
  // A clean slate on the first load only; the reload later in the run must see what the drag stored.
  if (!sessionStorage.getItem("r4-started")) {
    sessionStorage.setItem("r4-started", "1");
    for (const k of Object.keys(localStorage)) if (k.startsWith("asb.cols.")) localStorage.removeItem(k);
  }
}, dark);
await serveWorktreeFonts(ctx);
const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const at = (path) => (u) => new URL(u).pathname === path;
await ctx.route(at("/fleet.json"), (r) => r.fulfill(json({ boxes: [meta], lifecycle })));
await ctx.route(at("/monitor.json"), (r) => r.fulfill(json({ boxes: [meta], lifecycle })));
await ctx.route("**/watch.sse*", (r) => r.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: `event: snapshot\nid: ${log.length}\ndata: ${JSON.stringify({ meta, log, from: 0 })}\n\n` }));
await ctx.route("**/watch.json*", (r) => r.fulfill(json({ ...meta, log })));
const ms = Date.now();
const runs = Array.from({ length: 6 }, (_, i) => ({ id: 40 - i, box: `asb-session-${i}`, owner: i % 2 ? "neo" : "ak", task: ["Add dark mode", "Find the slow build", "Write webhook tests", "Explain deploys", "Rename User", "Fix flaky suite"][i], state: i === 1 ? "failed" : "done", exitCode: i === 1 ? 1 : 0, startedAt: ms - (i + 1) * 86400e3, endedAt: ms - (i + 1) * 86400e3 + 900e3, archivedAt: ms - (i + 1) * 86400e3 + 1000e3, headline: "Done." }));
await ctx.route(at("/history.json"), (r) => r.fulfill(json({ runs })));
await ctx.route(at("/history/ledger.json"), (r) => r.fulfill(json({ totals: { runs: runs.length, done: 5, failed: 1, checked: 2, passed: 2, inputTokens: 412300, outputTokens: 58900, withUsage: 3, costUsd: null, withCost: 0 }, rows: runs.map((x, i) => ({ ...x, startedBy: i % 2 ? "web" : "schedule", agent: "claude", verified: i < 2 ? true : null, inputTokens: 100000, outputTokens: 15000, costUsd: null, planDone: null, planTotal: null, workflowId: null })) })));
await ctx.route(at("/history/activity.json"), (r) => r.fulfill(json({ runs: Array.from({ length: 20 }, (_, i) => ({ t: ms - i * 3.7 * 3600e3, failed: i % 7 === 0 })) })));

const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"} ${name}${extra ? ` (${extra})` : ""}`);
const frameOf = (label) => page.locator(`main [aria-label="${label}"]`).first().locator("xpath=ancestor::div[contains(@class,'group/viz')]").first();
const thWidth = (label) => page.locator(`main [aria-label="${label}"]`).first().locator("xpath=ancestor::th").evaluate((th) => th.getBoundingClientRect().width);
const dragGrip = async (label, dx, midShot) => {
  const grip = page.locator(`main [aria-label="${label}"]`).first();
  await grip.scrollIntoViewIfNeeded();
  const b = await grip.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(b.x + b.width / 2 + (dx * i) / 6, b.y + b.height / 2);
  if (midShot) await shot(midShot);
  await page.mouse.up();
  await page.waitForTimeout(250);
};
const colsKeys = () => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith("asb.cols.viz:")).map((k) => [k, localStorage.getItem(k)])));

await page.goto(`${base}/dashboard/box/${BOX}`, { waitUntil: "load" });
await page.waitForTimeout(2500);
console.log("at", page.url(), "tables", await page.locator("main table").count());
check("three rich tables", (await page.locator("main table").count()) === 3, `tables=${await page.locator("main table").count()}`);
check("unshaped table is auto layout", (await page.locator("main table").first().evaluate((t) => getComputedStyle(t).tableLayout)) === "auto");
await shot("default", { fullPage: true });

const before = await thWidth("Resize Owner");
await dragGrip("Resize Owner", 140, "mid-drag");
const after = await thWidth("Resize Owner");
check("drag widens Owner by ~140", Math.abs(after - before - 140) <= 3, `${before.toFixed(0)}→${after.toFixed(0)}`);
check("shaped table is fixed layout", (await page.locator("main table").first().evaluate((t) => getComputedStyle(t).tableLayout)) === "fixed");
const keys = await colsKeys();
check("one viz width key stored", Object.keys(keys).length === 1, JSON.stringify(keys));

await page.reload({ waitUntil: "load" });
await page.waitForTimeout(2500);
const reloaded = await thWidth("Resize Owner");
check("width survives reload", Math.abs(reloaded - after) <= 2, `${after.toFixed(0)}→${reloaded.toFixed(0)}`);
await shot("after-reload", { clip: await frameOf("Resize Description").boundingBox() });

await dragGrip("Resize Description", 360);
check("Description widened past 900px", (await thWidth("Resize Description")) > 900, (await thWidth("Resize Description")).toFixed(0));
const scroller = frameOf("Resize Description").locator(".overflow-auto").first();
const overflow = await scroller.evaluate((el) => el.scrollWidth - el.clientWidth);
check("widened table overflows the card", overflow > 100, `overflow=${overflow.toFixed(0)}`);
check("right edge fade is on before scrolling", await scroller.evaluate((el) => el.parentElement.hasAttribute("data-scrolled-end")));
await scroller.evaluate((el) => (el.scrollLeft = 260));
await page.waitForTimeout(300);
const sticky = await scroller.evaluate((el) => {
  const box = el.getBoundingClientRect();
  const cell = el.querySelector("tbody tr td");
  const th = el.querySelector("thead th");
  return { cellLeft: cell.getBoundingClientRect().left - box.left, thLeft: th.getBoundingClientRect().left - box.left, start: el.parentElement.hasAttribute("data-scrolled-start"), shadow: getComputedStyle(cell).boxShadow !== "none" };
});
check("first column sticks while scrolled", sticky.cellLeft < 1 && sticky.thLeft < 1 && sticky.start && sticky.shadow, JSON.stringify(sticky));
await shot("scrolled-sticky", { clip: await frameOf("Resize Description").boundingBox() });
await scroller.evaluate((el) => (el.scrollLeft = 0));

const region = page.locator('main [aria-label="Resize Region"]').first();
const v0 = Number(await region.getAttribute("aria-valuenow"));
await region.focus();
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(200);
const v1 = Number(await region.getAttribute("aria-valuenow"));
check("ArrowRight nudges 16px", v1 - v0 === 16, `${v0}→${v1}`);
await region.dblclick();
await page.waitForTimeout(200);
const stored = JSON.parse(Object.values(await colsKeys())[0] ?? "{}");
check("double-click resets Region (col 3) only", !("3" in stored) && "2" in stored && "1" in stored, JSON.stringify(stored));

const footer = frameOf("Resize Description").locator('[aria-live="polite"]').first();
check("footer counts rows", (await footer.innerText()).trim() === "14 rows", await footer.innerText());
await frameOf("Resize Description").locator('input[aria-label="Filter rows"]').fill("eu-west");
await page.waitForTimeout(200);
check("footer shows filtered count", /14 rows · 5 shown/.test(await footer.innerText()), await footer.innerText());
await frameOf("Resize Description").locator('input[aria-label="Filter rows"]').fill("");

const selBefore = await page.evaluate(() => String(window.getSelection()));
await frameOf("Resize Description").locator("tbody tr").nth(2).locator("td").first().click();
await page.waitForTimeout(200);
const pinnedRows = await frameOf("Resize Description").locator("tbody tr[data-pinned]").count();
check("row click pins and lifts the row to the top", (await frameOf("Resize Description").locator("tbody tr").first().getAttribute("data-pinned")) !== null, `pinned=${pinnedRows} selectionBefore=${JSON.stringify(selBefore.slice(0, 30))}`);
await shot("pinned", { clip: await frameOf("Resize Description").boundingBox() });
await frameOf("Resize Description").locator("tbody tr").first().locator("td").first().click();

await frameOf("Resize Description").locator('button[aria-label="Copy source"]').click();
const clip = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n");
check("copy CSV", clip.startsWith("Service,Owner,Description,Region,Latency ms,Status\nalpha-gateway"), JSON.stringify(clip.slice(0, 60)));

const chartFrame = frameOf("Resize Route");
await chartFrame.locator('[aria-label="View as"] >> text=Chart').click();
await page.waitForTimeout(500);
check("Table→Chart draws an svg", (await page.locator("main svg.viz-chart, main [data-viz-scrub], main svg[role='img']").count()) >= 1 || (await page.locator("main svg").count()) > 6);
await shot("chart-view", { fullPage: true });
await page.locator('main [aria-label="View as"] >> text=Table').first().click();
await page.waitForTimeout(400);
check("Chart→Table restores the grid", (await page.locator('main [aria-label="Resize Route"]').count()) === 1);
await shot("final", { fullPage: true });

await page.goto(`${base}/dashboard/history`, { waitUntil: "load" });
await page.waitForTimeout(2000);
const hg = page.locator('main th [aria-label^="Resize"]').first();
check("history table has grips", (await hg.count()) === 1);
const hLabel = await hg.getAttribute("aria-label");
const hBefore = await thWidth(hLabel);
await dragGrip(hLabel, 90);
const hAfter = await thWidth(hLabel);
check(`history ${hLabel} drags`, Math.abs(hAfter - hBefore - 90) <= 3, `${hBefore.toFixed(0)}→${hAfter.toFixed(0)}`);
await shot("history", { fullPage: true });

console.log(results.join("\n"));
const net = errors.filter((e) => e.startsWith("Failed to load resource"));
const real = errors.filter((e) => !e.startsWith("Failed to load resource"));
console.log(`console errors: ${real.length} (plus ${net.length} unmocked-endpoint 4xx/5xx)`, real.slice(0, 5).join(" | "));
await browser.close();
