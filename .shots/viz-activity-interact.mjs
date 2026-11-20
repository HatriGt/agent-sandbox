// Interaction pass on the activity cards: the tooltip cards on the timer bar, the queue pillars,
// the journey's stop and the transfer bar; the segmented toggle on the timer (left → done); a
// hovered scoreboard row, pipeline row and retry bead taking the head over (peek). Writes
// .shots/out/viz-activity-ix-<n>.png at 2x, dark with --dark. Prints the head and tooltip text at
// each step so the pass can be read without the pictures.
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";
const dark = process.argv.includes("--dark");
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1100, height: 1400 }, deviceScaleFactor: 2, colorScheme: dark ? "dark" : "light" });
await ctx.addInitScript((dark) => {
  localStorage.setItem("asb-token", "devtoken123");
  localStorage.setItem("asb-hub-howto-done", "1");
  localStorage.setItem("asb-dark", dark ? "1" : "0");
  localStorage.setItem("asb-theme", dark ? "dark" : "light");
}, dark);
const page = await ctx.newPage();
const meta = { name: "asb-activity", boxStatus: "running", runState: "idle", task: "t", role: "cold", agent: "claude" };
const NL = String.fromCharCode(10);
const fence = (k, lines) => "```" + k + NL + lines.join(NL) + NL + "```" + NL + NL;
const log =
  fence("timer", ["title: Build · orders-api", "status: Compiling TypeScript", "left: 2:48", "total: 4:00", "started: 09:27", "ends: 09:31"]) +
  fence("queue", ["title: Merge queue · main", "status: In line", "position: #12", "of: 40", "wait: 2 min", "end: Merge"]) +
  fence("journey", ["title: Deploy · orders-api v2.4.1", "status: Rolling out", "stops: Build, Test, Canary, Production", "progress: Canary", "remaining: 6 min", "departed: 09:14", "arrives: 09:31"]) +
  fence("transfer", ["title: Thread move · jrrrly", "status: Copying the transcript", "from: VPS", "to: FS-A", "progress: 62%", "tag: rsync", "departed: 09:05", "arrives: in 35 s", "remaining: 35 s"]) +
  fence("versus", ["title: Benchmark · p95 latency (ms)", "status: live", "score: main 182 - 176 feature", "clock: 72 / 100", "samples: 4,000"]) +
  fence("ring", ["title: Retry · fetch upstream", "status: Attempt 3 of 5 · backoff 60 s", "value: 3", "max: 5", "time: 0:36"]) +
  fence("stages", ["title: Pipeline · nightly", "stages: Install ✓, Build ✓, Test (40%), Package, Publish", "remaining: 16 min"]);
const json = (r, body) => r.fulfill({ json: body });
await page.route("**/*.json*", (r) => {
  const p = new URL(r.request().url()).pathname;
  if (p.endsWith("/fleet.json") || p.endsWith("/monitor.json")) return json(r, { boxes: [meta], lifecycle: { capacity: 4, maxDurationSec: 3600, idleTimeoutSec: 900 }, at: Date.now() });
  if (p.endsWith("/watch.json")) return json(r, { ...meta, log });
  if (p.endsWith("/health.json")) return json(r, { ok: true, checks: [] });
  if (p.endsWith("/changes.json")) return json(r, { files: [] });
  if (p.endsWith("/inbox.json")) return json(r, { queued: [] });
  if (p.endsWith("/pr.json")) return json(r, {});
  return r.continue();
});
const frame = (event, data, id) => `event: ${event}${NL}id: ${id}${NL}data: ${JSON.stringify(data)}${NL}${NL}`;
await page.route("**/watch.sse*", (r) => r.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache" }, body: `retry: 3000${NL}${NL}` + frame("snapshot", { meta, log, from: 0 }, log.length) }));
await page.goto("http://localhost:5181/dashboard/box/asb-activity", { waitUntil: "load" });
await page.waitForTimeout(2200);
console.log("activities:", await page.locator("[data-activity]").count());
const card = (kind) => page.locator(`[data-activity="${kind}"]`).first().locator("xpath=ancestor::div[contains(@class,'viz-card')]");
const head = async (kind) => {
  const o = card(kind).locator(".odometer").first();
  const fig = await o.locator(".sr-only").textContent().catch(() => o.textContent());
  const unit = await o.locator("xpath=following-sibling::span").first().textContent().catch(() => "");
  return `${fig.trim()} ${unit.trim()}`.trim();
};
const tip = async (kind) => {
  const t = card(kind).locator(".viz-readout");
  if ((await t.count()) === 0) return "(no tooltip)";
  const rows = await t.locator("div > div").evaluateAll((els) => els.map((e) => e.textContent.trim()));
  return `${(await t.locator("div").first().textContent()).trim()} | ${rows.join(" / ")}`;
};
// No scrolling here: hoverAt already brought the row into view, and a scroll under a resting
// pointer would move the hovered element away from it.
const shot = async (kind, n) => {
  await page.waitForTimeout(250);
  await card(kind).screenshot({ path: `.shots/out/viz-activity-ix-${n}${dark ? "-dark" : ""}.png` });
};
// The whole card comes into view first: the screenshot after would otherwise scroll it again
// and move the hovered element out from under the resting pointer.
const hoverAt = async (loc, fx, kind, fy = 0.5) => {
  if (kind) await card(kind).scrollIntoViewIfNeeded();
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  await page.mouse.move(b.x + b.width * fx, b.y + b.height * fy, { steps: 4 });
  await page.waitForTimeout(450);
};
// 1. timer: hover the bar at 70%
await hoverAt(card("timer").locator("[role=progressbar]"), 0.7, "timer");
await shot("timer", "1-timer-hover");
console.log("1 timer tip:", await tip("timer"));
// 1b. timer: the toggle, left → done
await page.mouse.move(5, 5);
console.log("1b timer head before:", await head("timer"), "| segments:", await card("timer").locator("[data-segments] button").allTextContents());
await card("timer").locator("[data-segments] button", { hasText: "done" }).click();
await page.waitForTimeout(500);
await shot("timer", "1b-timer-toggle");
console.log("1b timer head after:", await head("timer"));
// 2. queue: hover the pillars at 30%
await hoverAt(card("queue").locator("[role=progressbar]"), 0.3, "queue");
await shot("queue", "2-queue-hover");
console.log("2 queue tip:", await tip("queue"), "| segments:", await card("queue").locator("[data-segments] button").allTextContents());
// 3. journey: hover the Canary stop
await hoverAt(card("journey").locator("[role=progressbar]"), 0.665, "journey");
await shot("journey", "3-journey-stop");
console.log("3 journey tip:", await tip("journey"));
// 4. transfer: hover the bar
await hoverAt(card("transfer").locator("[role=progressbar]"), 0.5, "transfer");
await shot("transfer", "4-transfer-hover");
console.log("4 transfer tip:", await tip("transfer"));
// 5. versus: hover the second row (feature); the head should read its score
await page.mouse.move(5, 5);
console.log("5 versus head at rest:", await head("versus"));
await hoverAt(card("versus").locator("[role=listitem]").nth(1), 0.5, "versus");
await shot("versus", "5-versus-row");
console.log("5 versus head hovered:", await head("versus"), "| tip:", await tip("versus"));
// 6. ring: hover the fourth bead (pending)
await page.mouse.move(5, 5);
console.log("6 ring head at rest:", await head("ring"));
await card("ring").scrollIntoViewIfNeeded();
const svg = card("ring").locator("svg[viewBox=\"0 0 80 80\"]");
const sb = await svg.boundingBox();
// bead 4 of 5 sits around 270° from the top on a ring rotated -90°: left of centre, a little below
await page.mouse.move(sb.x + sb.width * 0.12, sb.y + sb.height * 0.62, { steps: 4 });
await page.waitForTimeout(450);
await shot("ring", "6-ring-bead");
console.log("6 ring head hovered:", await head("ring"), "| tip:", await tip("ring"));
// 7. stages: hover the Test row; the head should read 40% Test
await page.mouse.move(5, 5);
console.log("7 stages head at rest:", await head("stages"));
await hoverAt(card("stages").locator("[role=listitem]").nth(2), 0.5, "stages");
await shot("stages", "7-stages-row");
console.log("7 stages head hovered:", await head("stages"), "| tip:", await tip("stages"));
await page.mouse.move(5, 5);
await page.waitForTimeout(300);
console.log("7 stages head after leave:", await head("stages"));
await browser.close();
