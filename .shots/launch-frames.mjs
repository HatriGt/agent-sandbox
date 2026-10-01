// Launch continuity check: send a task with a delayed /delegate and a delayed (first-empty) stream,
// sample the page every ~100 ms, and assert the Task bubble never moves and no frame is blank.
// Usage: node .shots/launch-frames.mjs [ok|fail] [reduce]   (ASB_UI defaults to http://localhost:5181)
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";

const base = process.env.ASB_UI || "http://localhost:5181";
const mode = process.argv[2] || "ok";
const reduce = process.argv.includes("reduce");
const TASK = "Fix the flaky login test in orders-api and open a PR";
const BOX = "asb-launch-test";
const lifecycle = { capacity: 4, maxDurationSec: 3600, idleTimeoutSec: 900 };
let t0 = 0;
const since = () => (t0 ? Date.now() - t0 : -1);
const DELEGATE_MS = 1500, FLEET_AT = 2600, SSE_DELAY = 900;
const meta = (runState) => ({ name: BOX, boxStatus: "running", runState, task: TASK, role: "cold" });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 }, reducedMotion: reduce ? "reduce" : "no-preference" });
await ctx.addInitScript(() => {
  localStorage.setItem("asb-token", "devtoken123");
  localStorage.setItem("asb-hub-howto-done", "1");
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
// The box surfaces in the fleet at FLEET_AT, first WITHOUT its task (as a fresh claim can).
const fleet = () => ({ boxes: t0 && since() > FLEET_AT && mode === "ok" ? [{ ...meta("running"), task: since() > FLEET_AT + 1500 ? TASK : undefined }] : [], lifecycle });
await page.route("**/fleet.json*", (r) => r.fulfill({ json: fleet() }));
await page.route("**/monitor.json*", (r) => r.fulfill({ json: fleet() }));
await page.route("**/delegate.json*", async (r) => {
  await new Promise((res) => setTimeout(res, DELEGATE_MS));
  if (mode === "fail") return r.fulfill({ status: 500, json: { error: "no capacity (test)" } });
  r.fulfill({ json: { ok: true, box: BOX, warm: false, output: "" } });
});
let sseHits = 0;
await page.route("**/watch.sse*", async (r) => {
  sseHits++;
  await new Promise((res) => setTimeout(res, SSE_DELAY));
  // First connection: an EMPTY snapshot, then the stream drops. Second: real output.
  const log = sseHits === 1 ? "" : "I'll start by reproducing the flaky login test.\n\nRunning the suite now.\n";
  const body = `event: snapshot\nid: ${log.length}\ndata: ${JSON.stringify({ meta: meta("running"), log, from: 0 })}\n\n`;
  r.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body });
});
await page.route("**/watch.json*", async (r) => {
  await new Promise((res) => setTimeout(res, SSE_DELAY));
  r.fulfill({ json: { ...meta("running"), log: "" } });
});

await page.goto(base + "/dashboard/", { waitUntil: "load" });
await page.waitForTimeout(1500);
const ta = page.locator("#new-task");
await ta.click();
await ta.fill(TASK);
t0 = Date.now();
await page.keyboard.press("Enter");

const frames = [];
const N = mode === "fail" ? 30 : 90;
for (let i = 0; i < N; i++) {
  const at = since();
  const f = await page.evaluate(() => {
    const main = document.querySelector("main");
    const bubble = [...document.querySelectorAll("main [data-turn=task]")].find((el) => el.offsetParent !== null);
    const r = bubble?.getBoundingClientRect();
    let op = 1;
    for (let el = bubble; el; el = el.parentElement) op *= parseFloat(getComputedStyle(el).opacity || "1");
    const text = (main?.innerText || "").trim();
    const ta = document.querySelector("#new-task");
    return {
      url: location.pathname,
      bubble: r ? [Math.round(r.x * 10) / 10, Math.round(r.y * 10) / 10, Math.round(r.width), Math.round(r.height)] : null,
      opacity: bubble ? Math.round(op * 100) / 100 : 0,
      skeleton: !!document.querySelector("main [aria-label='Loading the conversation']"),
      prose: text.includes("reproducing the flaky"),
      hub: !!ta,
      hubText: ta ? ta.value : null,
      empty: /Nothing has run here yet/.test(text),
    };
  });
  frames.push({ at, ...f });
  await page.screenshot({ path: `.shots/out/launch-${mode}${reduce ? "-reduce" : ""}-${String(i).padStart(3, "0")}.png` });
  await page.waitForTimeout(Math.max(0, 100 - (since() - at)));
}
for (const f of frames) console.log(JSON.stringify(f));
if (mode === "ok") {
  const firstBubble = frames.findIndex((f) => f.bubble);
  const after = frames.slice(firstBubble);
  const positions = new Set(after.filter((f) => f.bubble).map((f) => f.bubble.slice(0, 3).join(",")));
  const bad = after.filter((f) => !f.bubble || (f.opacity < 0.99 && f.at > 400) || (!f.skeleton && !f.prose) || f.empty || f.hub);
  console.log(`first bubble at frame ${firstBubble} (${frames[firstBubble]?.at} ms); distinct bubble x,y,w: ${positions.size} -> ${[...positions].join(" | ")}`);
  console.log(`bad frames after launch (no bubble / faded / neither skeleton nor content / empty card / hub): ${bad.length}`);
  console.log(`first prose frame at ${frames.find((f) => f.prose)?.at} ms; urls: ${[...new Set(frames.map((f) => f.url))].join(" -> ")}`);
} else {
  const last = frames[frames.length - 1];
  console.log(`fail mode: back on hub=${last.hub}, text restored=${last.hubText === TASK}`);
}
console.log("page errors:", errors.slice(0, 3).join(" | ") || "none");
await browser.close();
