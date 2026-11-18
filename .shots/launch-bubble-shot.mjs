// The launch bubble, mid-launch and after: send a task against a mocked controller whose launch
// feed releases one stage at a time (honouring Last-Event-ID on reconnect, like the real route),
// and shoot the pane at four moments in both colour schemes.
// Usage: node .shots/launch-bubble-shot.mjs [--dark] [--tag=x]   (ASB_UI defaults to http://localhost:5181)
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";

const base = process.env.ASB_UI || "http://localhost:5181";
const flags = process.argv.slice(2);
const dark = flags.includes("--dark");
const tag = (flags.find((f) => f.startsWith("--tag=")) || "").slice(6);
const suffix = `${dark ? "-dark" : ""}${tag ? "-" + tag : ""}`;
const TASK = "Fix the flaky login test in orders-api and open a PR";
const BOX = "asb-launch-test";
const lifecycle = { capacity: 4, maxDurationSec: 3600, idleTimeoutSec: 900 };
let t0 = 0;
const since = () => (t0 ? Date.now() - t0 : -1);
// Stage → when it starts (ms after Send). The delegate answers right after `started`.
const STEPS = [
  { phase: "accepted", at: 150, label: "Checking the task" },
  { phase: "access", at: 500, label: "Resolving repository access" },
  { phase: "host", at: 900, label: "Picking a host" },
  { phase: "clone", at: 1200, label: "Cloning acme/orders-api", detail: "acme/orders-api" },
  { phase: "sandbox", at: 3400, label: "Booting a fresh sandbox", detail: "cold" },
  { phase: "agent", at: 9000, label: "Starting the agent" },
  { phase: "started", at: 11500, label: "Agent started", detail: BOX },
];
const DELEGATE_AT = 11800, FLEET_AT = 12500, WORDS_AT = 16000;
const meta = (runState) => ({ name: BOX, boxStatus: "running", runState, task: TASK, role: "cold" });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 }, colorScheme: dark ? "dark" : "light", deviceScaleFactor: 2 });
await ctx.addInitScript((d) => {
  localStorage.setItem("asb-token", "devtoken123");
  localStorage.setItem("asb-dark", d ? "1" : "0");
  localStorage.setItem("asb-hub-howto-done", "1");
}, dark);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const fleet = () => ({ boxes: t0 && since() > FLEET_AT ? [{ ...meta("running") }] : [], lifecycle });
await page.route("**/fleet.json*", (r) => r.fulfill({ json: fleet() }));
await page.route("**/monitor.json*", (r) => r.fulfill({ json: fleet() }));
await page.route("**/delegate.json*", async (r) => {
  while (since() < DELEGATE_AT) await new Promise((res) => setTimeout(res, 50));
  r.fulfill({ json: { ok: true, box: BOX, warm: false, output: "" } });
});
// The feed: every stage that has begun since Last-Event-ID, then the connection ends (Playwright
// cannot trickle a body); the client reconnects and asks for the rest. `done` after `started`.
await page.route("**/launch.sse*", async (r) => {
  const last = Number(r.request().headers()["last-event-id"] ?? "-1");
  const from = Number.isFinite(last) ? last + 1 : 0;
  while (since() < (STEPS[from]?.at ?? Infinity) && since() < STEPS[STEPS.length - 1].at + 100) await new Promise((res) => setTimeout(res, 50));
  const ready = STEPS.map((s, i) => ({ ...s, i })).filter((s) => s.i >= from && since() >= s.at);
  let body = ready.map((s) => `event: step\nid: ${s.i}\ndata: ${JSON.stringify({ phase: s.phase, label: s.label, ...(s.detail ? { detail: s.detail } : {}), at: Date.now() })}\n\n`).join("");
  if (ready.some((s) => s.phase === "started")) body += "event: done\ndata: {}\n\n";
  r.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body });
});
let sseHits = 0;
await page.route("**/watch.sse*", async (r) => {
  sseHits++;
  while (since() < (sseHits === 1 ? FLEET_AT + 300 : WORDS_AT)) await new Promise((res) => setTimeout(res, 50));
  const log = since() < WORDS_AT ? "" : "I'll start by reproducing the flaky login test.\n\nRunning the suite now.\n";
  const body = `event: snapshot\nid: ${log.length}\ndata: ${JSON.stringify({ meta: meta("running"), log, from: 0 })}\n\n`;
  r.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body });
});
await page.route("**/watch.json*", async (r) => r.fulfill({ json: { ...meta("running"), log: "" } }));

await page.goto(base + "/dashboard/", { waitUntil: "load" });
await page.waitForTimeout(1500);
const ta = page.locator("#new-task");
await ta.click();
await ta.fill(TASK);
t0 = Date.now();
await page.keyboard.press("Enter");

const shot = async (name, atMs) => {
  while (since() < atMs) await new Promise((res) => setTimeout(res, 50));
  const rows = await page.evaluate(() => [...document.querySelectorAll("main [data-launch-steps] li, main [data-launch-receipt]")].map((li) => li.textContent.trim()));
  console.log(`${name} @${since()}ms: ${JSON.stringify(rows)}`);
  await page.screenshot({ path: `.shots/out/launch-bubble-${name}${suffix}.png` });
};
await shot("1-early", 1000);
await shot("2-booting", 5000);
await shot("3-started", 13500);
await shot("4-words", 17500);
console.log(`page errors: ${errors.length}${errors.length ? "\n" + errors.join("\n") : ""}`);
await browser.close();
