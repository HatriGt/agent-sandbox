// Watch-mode check: a running box whose agent emitted the watch marker shows the live "Watching …"
// pill with a Stop button; clicking Stop POSTs /interrupt.json; once the run ends the receipt pill
// reads "Stopped watching …". Mocked routes, no controller needed.
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";
const base = process.env.ASB_UI || "http://localhost:5187";
const BOX = "asb-watch-mode";
const lifecycle = { capacity: 4, maxDurationSec: 3600, idleTimeoutSec: 900 };
const reduce = process.argv.includes("reduce"), dark = process.argv.includes("dark");
const t0 = Date.now() - 125_000;
const stats = (n) => "```stats id=calls\nCalls: " + n + "\n5xx: 1\np95: 180ms\n```";
const at = (s) => `⟦at⟧ ${t0 + s * 1000}`;
const tail = (s, id) => [at(s), `→ Bash: timeout 30 tail -n 200 -f /var/log/app.log ⟦#${id}⟧`, at(s + 30), `  ⟦#${id}⟧ GET /api/orders 200`];
const log = [
  at(0), "⟦you⟧", "keep listening to the backend logs and tell me what calls come in", "⟦/you⟧",
  at(1), "Watching the backend logs.", "<!-- watch: backend logs | every 30s -->", "", ...stats(4).split("\n"),
  ...tail(2, "t1"), at(32), ...stats(9).split("\n"),
  ...tail(33, "t2"), at(63), "New 500 on /login.", "", ...stats(15).split("\n"),
  ...tail(64, "t3"),
].join("\n") + "\n";
let stopped = false, interruptCalls = 0;
const meta = () => ({ name: BOX, boxStatus: "running", runState: stopped ? "done" : "running", exitCode: stopped ? 253 : null, task: "Watch backend logs", role: "cold" });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: reduce ? "reduce" : "no-preference", colorScheme: dark ? "dark" : "light" });
await ctx.addInitScript(() => { localStorage.setItem("asb-token", "devtoken123"); localStorage.setItem("asb-hub-howto-done", "1"); });
const page = await ctx.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
await page.route("**/fleet.json*", (r) => r.fulfill({ json: { boxes: [meta()], lifecycle } }));
await page.route("**/monitor.json*", (r) => r.fulfill({ json: { boxes: [meta()], lifecycle } }));
await page.route("**/watch.sse*", (r) =>
  r.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: `event: snapshot\nid: ${log.length}\ndata: ${JSON.stringify({ meta: meta(), log, from: 0 })}\n\nevent: state\ndata: ${JSON.stringify(meta())}\n\n` }));
await page.route("**/watch.json*", (r) => r.fulfill({ json: { ...meta(), log } }));
await page.route("**/interrupt.json*", (r) => {
  interruptCalls++;
  stopped = true;
  r.fulfill({ json: { ok: true, stopped: true } });
});
await page.goto(`${base}/dashboard/box/${BOX}`, { waitUntil: "load" });
const bad = [];
const pill = page.locator("[data-watch-pill]");
try { await pill.waitFor({ timeout: 15000 }); } catch { bad.push("watching pill never appeared"); }
const text = (await pill.count()) ? await pill.innerText() : "";
console.log("live pill:", JSON.stringify(text));
if (!/Watching backend logs/.test(text)) bad.push("pill does not say Watching backend logs");
if (!/3 updates/.test(text)) bad.push("pill does not count 3 updates");
await page.screenshot({ path: `.shots/out/watch-live${dark ? "-dark" : ""}${reduce ? "-reduce" : ""}.png` });
const stop = page.locator("[data-watch-stop]");
if (!(await stop.count())) bad.push("no Stop button");
else {
  await stop.focus();
  await page.keyboard.press("Enter");
  for (let i = 0; i < 50 && !interruptCalls; i++) await page.waitForTimeout(100);
  if (interruptCalls !== 1) bad.push(`Stop called /interrupt.json ${interruptCalls} times`);
  // The mocked box now reports done (exit 253): reconnect delivers it.
  await page.reload({ waitUntil: "load" });
  const done = page.locator("[data-run-pill='watch-stopped']");
  try { await done.waitFor({ timeout: 15000 }); console.log("stopped pill:", JSON.stringify(await done.innerText())); }
  catch { bad.push("no 'Stopped watching' pill after stop"); }
  await page.screenshot({ path: `.shots/out/watch-stopped${dark ? "-dark" : ""}${reduce ? "-reduce" : ""}.png` });
}
console.log(bad.length ? "FAIL\n" + bad.join("\n") : "PASS");
console.log("errors:", errors.slice(0, 3).join(" | ") || "none");
await browser.close();
