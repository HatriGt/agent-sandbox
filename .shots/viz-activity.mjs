// Activity cards (web/src/components/viz/ActivityBlocks.tsx) rendered in a real thread over Vite,
// every fleet/box route mocked. No controller needed.
//
//   node .shots/viz-activity.mjs [--dark] [--w=1100] [--live] [--video]
//
//   default : one reply with every activity card, full-page screenshot → .shots/out/viz-activity[-dark]-<w>.png
//   --frames [--slow]: with --live, eight viewport frames while the second version lands (--slow runs
//             the page animations at 1/8 speed through CDP so the one-shots are caught).
//   --live  : the run is still working; /watch.sse streams a second version of every card 1.6 s in,
//             so the first copies update in place (values roll, tracks tween) and the re-emits
//             collapse to "updated" rows. Screenshots before and after; --video records the gap.
import http from "node:http";
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";

const args = process.argv.slice(2);
const flag = (k, d) => args.find((f) => f.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const dark = args.includes("--dark");
const live = args.includes("--live");
const video = args.includes("--video");
const W = Number(flag("w", 1100));
const base = process.env.ASB_UI || "http://localhost:5181";
const BOX = "asb-activity";
const meta = { name: BOX, boxStatus: "running", runState: live ? "running" : "idle", task: "Ship v2.4.1 and watch the rollout", role: "cold", agent: "claude" };
const lifecycle = { capacity: 4, maxDurationSec: 3600, idleTimeoutSec: 900 };
const f = (lang, body) => "```" + lang + "\n" + body.trim() + "\n```\n\n";

/* Version 1: what the agent said first. */
const V1 = {
  timer: f("timer", `
title: Build · orders-api
status: Compiling TypeScript
left: 2:48
total: 4:00
started: 09:27
ends: 09:31`),
  expired: f("countdown", `
title: Run cap · quiet-otter
left: 0:00
total: 60 min
ends: 09:40`),
  queue: f("queue", `
title: Merge queue · main
status: In line
position: #12
of: 40
wait: 2 min
end: Merge`),
  merged: f("queue", `
title: Merge queue · release
status: Merged
position: 1
end: Merge`),
  journey: f("journey", `
title: Deploy · orders-api v2.4.1
status: Rolling out
stops: Build, Test, Canary, Production
progress: Canary
remaining: 6 min
departed: 09:14
arrives: 09:31
by: freestyle-a · 2 vCPU · eu-west`),
  transfer: f("transfer", `
title: Thread move · jrrrly
status: Copying the transcript
from: VPS
to: FS-A
progress: 62%
tag: rsync
departed: 09:05
arrives: in 35 s`),
  versus: f("versus", `
title: Benchmark · p95 latency (ms)
score: main 182 - 176 feature
status: live
event: run 72
clock: 72 / 100
samples: 4,000`),
  ring: f("ring", `
title: Retry · fetch upstream
status: Attempt 3 of 5 · backoff 60 s
value: 3
max: 5
time: 0:36`),
  stages: f("stages", `
title: Pipeline · nightly
stages: Install ✓, Build ✓, Test (40%), Package, Publish
remaining: 16 min`),
};

/* Version 2: the same blocks a minute later. */
const V2 = {
  timer: V1.timer.replace("left: 2:48", "left: 1:12").replace("Compiling TypeScript", "Bundling"),
  queue: V1.queue.replace("position: #12", "position: #7").replace("wait: 2 min", "wait: 1 min"),
  journey: V1.journey.replace("progress: Canary", "progress: 85%").replace("remaining: 6 min", "remaining: 2 min").replace("Rolling out", "Production at 85%"),
  transfer: V1.transfer.replace("progress: 62%", "progress: 94%").replace("in 35 s", "in 6 s"),
  versus: V1.versus.replace("182 - 176", "182 - 171").replace("event: run 72", "event: new low").replace("72 / 100", "88 / 100"),
  ring: V1.ring.replace("value: 3", "value: 4").replace("Attempt 3", "Attempt 4").replace("0:36", "1:02"),
  stages: V1.stages.replace("Test (40%), Package", "Test ✓, Package (30%)").replace("16 min", "11 min"),
};

const head =
  "Here is where the release stands. Each card updates in place as I re-emit it.\n\n" +
  "**Build**\n\n" + V1.timer +
  "**Merge queue**\n\n" + V1.queue + V1.merged +
  "**Rollout**\n\n" + V1.journey +
  "**Thread move**\n\n" + V1.transfer +
  "**Benchmark**\n\n" + V1.versus +
  "**Retries**\n\n" + V1.ring +
  "**Nightly pipeline**\n\n" + V1.stages +
  "**Run cap**\n\n" + V1.expired;
const tail = "\nOne minute later:\n\n" + V2.timer + V2.queue + V2.journey + V2.transfer + V2.versus + V2.ring + V2.stages + "That is the whole set.\n";
const log = live ? head : head + "\nThat is the whole set.\n";

const frame = (event, data, id) => `event: ${event}\n${id !== undefined ? `id: ${id}\n` : ""}data: ${JSON.stringify(data)}\n\n`;

/* --live: a local SSE server that holds the stream open and appends version 2 after a beat. */
let streamer = null;
let streamPort = 0;
if (live) {
  streamer = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", "access-control-allow-origin": "*" });
    res.write("retry: 3000\n\n");
    res.write(frame("snapshot", { meta, log: head, from: 0 }, head.length));
    let i = 0;
    let sent = head.length;
    const tick = () => {
      if (i >= tail.length) return;
      const n = 24 + Math.floor(Math.random() * 24);
      const chunk = tail.slice(i, i + n);
      i += n;
      sent += chunk.length;
      res.write(frame("append", { chunk }, sent));
      setTimeout(tick, 20 + Math.random() * 30);
    };
    setTimeout(tick, 1600);
    req.on("close", () => {});
  });
  await new Promise((r) => streamer.listen(0, "127.0.0.1", r));
  streamPort = streamer.address().port;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: W, height: Number(flag("h", live ? 900 : 2700)) },
  colorScheme: dark ? "dark" : "light",
  ...(video ? { recordVideo: { dir: ".shots/out/video", size: { width: W, height: 900 } } } : {}),
});
await ctx.addInitScript(
  ([d]) => {
    localStorage.setItem("asb-token", "devtoken123");
    localStorage.setItem("asb-hub-howto-done", "1");
    localStorage.setItem("asb-dark", d ? "1" : "0");
    localStorage.setItem("asb-theme", d ? "dark" : "light");
  },
  [dark]
);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const json = (r, body) => r.fulfill({ json: body });
await page.route("**/*.json*", (r) => {
  const p = new URL(r.request().url()).pathname;
  if (p.endsWith("/fleet.json") || p.endsWith("/monitor.json")) return json(r, { boxes: [meta], lifecycle, at: Date.now() });
  if (p.endsWith("/watch.json")) return json(r, { ...meta, log });
  if (p.endsWith("/health.json")) return json(r, { ok: true, checks: [] });
  if (p.endsWith("/changes.json")) return json(r, { files: [] });
  if (p.endsWith("/inbox.json")) return json(r, { queued: [] });
  if (p.endsWith("/pr.json")) return json(r, {});
  return r.continue();
});
page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text().slice(0, 300)));
await page.route("**/watch.sse*", (r) => {
  if (streamer) return r.continue({ url: `http://127.0.0.1:${streamPort}/watch.sse` });
  return r.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache" }, body: "retry: 3000\n\n" + frame("snapshot", { meta, log, from: 0 }, log.length) });
});
await page.goto(`${base}/dashboard/box/${BOX}`, { waitUntil: "load" });
await page.waitForTimeout(2200);

const suffix = `${dark ? "-dark" : ""}-${W}`;
const report = async () => {
  const cards = await page.locator("[data-activity]").evaluateAll((els) => els.map((e) => `${e.dataset.activity}:${e.dataset.tone}`));
  const raw = await page.evaluate(() => [...document.querySelectorAll("main pre")].map((p) => p.innerText.slice(0, 40)));
  const heroes = await page.locator("[data-activity] .odometer").evaluateAll((els) => els.map((e) => (e.querySelector(".sr-only") ?? e).textContent.trim()));
  const copies = await page.locator("[data-live-copy]").count();
  console.log("cards:", cards.join(" "), "| heroes:", heroes.join(" · "), "| collapsed copies:", copies, "| raw code blocks left:", raw.length, JSON.stringify(raw));
};
await report();
if (live) {
  await page.screenshot({ path: `.shots/out/viz-activity-live-before${suffix}.png`, fullPage: true });
  // --frames: viewport frames while the second version streams in (the one-shots: sweep, wake,
  // landing pop, tick), 220 ms apart from the first append.
  if (process.argv.includes("--frames")) {
    // The first collapsed copy marks the first card's update; the one-shots (sweep, wake, landing
    // pop, burst, flash, tick) run 480-900 ms, which a screenshot round-trip alone can miss, so
    // --slow runs the page's animations at 1/8 speed through CDP while the frames are taken.
    const slow = process.argv.includes("--slow");
    const cdp = slow ? await ctx.newCDPSession(page) : null;
    if (cdp) {
      await cdp.send("Animation.enable");
      await cdp.send("Animation.setPlaybackRate", { playbackRate: 0.125 });
    }
    await page.waitForSelector("[data-live-copy]", { timeout: 8000 });
    for (let i = 0; i < 8; i++) {
      await page.screenshot({ path: `.shots/out/viz-activity-live-frame-${i}${suffix}.png` });
      await page.waitForTimeout(slow ? 400 : 90);
    }
    if (cdp) await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 });
    await page.waitForTimeout(2500);
  } else await page.waitForTimeout(3800);
  await report();
  await page.screenshot({ path: `.shots/out/viz-activity-live-after${suffix}.png`, fullPage: true });
} else {
  await page.screenshot({ path: `.shots/out/viz-activity${suffix}.png`, fullPage: true });
}
console.log("errors:", errors.slice(0, 3).join(" | ") || "none");
await ctx.close();
await browser.close();
streamer?.close();
