// Landing demo recorder. Run from PowerShell with the Vite dev server up (ASB_UI, default :5173) and a local controller behind it:
//   node .shots/demo-video.mjs [--dark] [--w=1280 --h=800]   → .shots/demo/raw.webm (+ poster.png), then see the ffmpeg line at the bottom.
// The real dashboard UI, driven with MOCKED run data (page.route + a local SSE stream): a UI walkthrough, not a real run's result.
// Loop shown: GitHub-labelled automation → Run now → box boots and works → stops and asks → answered → done with receipt + PR.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";

const flags = process.argv.slice(2);
const flag = (k, d) => flags.find((f) => f.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const dark = flags.includes("--dark");
const W = Number(flag("w", 1280));
const H = Number(flag("h", 800));
const token = process.env.ASB_DEV_TOKEN || "devtoken123";
const base = process.env.ASB_UI || "http://localhost:5173";
const OUT = ".shots/demo";
fs.mkdirSync(OUT, { recursive: true });

const NAME = "quiet-otter";
const REPO = "acme/queue";
const TASK = "Issue #211 (label: agent): the retry test in packages/queue fails intermittently on CI. Find the cause, fix it with a regression test, and open a PR.";
const T0 = Date.now();
const at = (s) => `⟦at⟧ ${T0 + s * 1000}`;

const QUESTION = [
  "The retry test asserts on wall-clock time. Which fix should I apply?",
  "",
  "Faking the clock makes the test deterministic; widening the tolerance keeps real timers but can still flake on a loaded runner.",
  "",
  "Options:",
  "- Fake the clock with vi.useFakeTimers()",
  "- Widen the tolerance to 200ms",
].join("\n");

// The log is delivered in chunks, each after a pause, so the thread visibly builds up.
const PART1 = [
  at(0), "● session started (model ak-claude-sonnet-4.8)",
  at(1), "Reading the failing test and the retry helper first.",
  `⟦plan⟧ ${T0 + 1500}`, "[>] Reproduce the flake", "[ ] Find the timing assumption", "[ ] Fix + regression test", "[ ] Open a pull request", "⟦/plan⟧",
  "",
].join("\n");
const PART2 = [
  at(3), "→ Read: packages/queue/test/retry.test.ts ⟦#r1⟧", at(3),
  "  ⟦#r1⟧ 12\t  it('backs off between attempts', async () => {",
  "  13\t    const t0 = Date.now();",
  "  14\t    await retry(flaky, { attempts: 3, delay: 50 });",
  "  15\t    expect(Date.now() - t0).toBeLessThan(160);",
  "  16\t  });",
  at(4), "→ Bash: for i in $(seq 20); do npx vitest run test/retry.test.ts; done ⟦#b1⟧", at(6),
  "  ⟦#b1⟧  ✓ test/retry.test.ts (4 tests)",
  "   × test/retry.test.ts > backs off between attempts",
  "     AssertionError: expected 171 to be less than 160",
  `⟦plan⟧ ${T0 + 6500}`, "[x] Reproduce the flake", "[x] Find the timing assumption", "[>] Fix + regression test", "[ ] Open a pull request", "⟦/plan⟧",
  at(7), "Reproduced: the assertion measures real elapsed time, so a slow runner fails it. There are two reasonable fixes and they change what the test proves, so I will not pick one silently.",
  "⟦ask⟧", QUESTION, "⟦/ask⟧",
  "",
].join("\n");
const PART3 = [
  at(20), "⟦you⟧", "Fake the clock with vi.useFakeTimers()", "⟦/you⟧",
  at(21), "→ Edit: packages/queue/test/retry.test.ts ⟦#e1⟧", at(21), "  ⟦#e1⟧ The file packages/queue/test/retry.test.ts has been updated.",
  "⟦diff⟧",
  "-    const t0 = Date.now();",
  "-    await retry(flaky, { attempts: 3, delay: 50 });",
  "-    expect(Date.now() - t0).toBeLessThan(160);",
  "+    vi.useFakeTimers();",
  "+    const p = retry(flaky, { attempts: 3, delay: 50 });",
  "+    await vi.advanceTimersByTimeAsync(150);",
  "+    await expect(p).resolves.toBe('ok');",
  "⟦/diff⟧",
  at(23), "→ Bash: npx vitest run ⟦#b2⟧", at(24), "  ⟦#b2⟧  ✓ test/retry.test.ts (5 tests)", "   ✓ test/queue.test.ts (11 tests)", "   Test Files  2 passed (2)",
  at(25), "→ Bash: gh pr create --fill ⟦#b3⟧", at(26), `  ⟦#b3⟧ https://github.com/${REPO}/pull/212`,
  `⟦plan⟧ ${T0 + 26500}`, "[x] Reproduce the flake", "[x] Find the timing assumption", "[x] Fix + regression test", "[x] Open a pull request", "⟦/plan⟧",
  at(27),
  "The retry test now runs on a fake clock, so it proves the backoff schedule instead of the runner's speed. Added a regression case for the third attempt.",
  "",
  `PR: https://github.com/${REPO}/pull/212`,
  "",
].join("\n");

const baseBox = {
  name: NAME, role: "session", boxStatus: "running", task: TASK, uptime: "1m", cpu: "9%", mem: "0.8G/4G",
  memUsage: { usedMib: 820, totalMib: 4096 }, disk: { usedMib: 2100, totalMib: 20480 }, lastOutputAt: Date.now(),
  title: "Fix flaky retry test (#211)", repos: [{ name: "queue", branch: "fix/retry-fake-timers" }], agent: "claude",
};
let phase = "automations"; // automations → running → waiting → done
const boxNow = () =>
  phase === "waiting" ? { ...baseBox, runState: "waiting", question: QUESTION }
  : phase === "done" ? { ...baseBox, runState: "done", exitCode: 0 }
  : { ...baseBox, runState: "running" };
const metaNow = () => { const { role: _r, ...m } = boxNow(); return m; };
const LIFECYCLE = { idleTimeoutSec: 1800, maxDurationSec: 4 * 3600, capacity: 8, poolSize: 2, sleepTtlSec: 7 * 86400, memoryTiers: ["2G", "4G", "8G"], memoryDefault: "4G", diskTiers: ["20G", "40G"] };

const TRIGGER = {
  id: "trg_issues", name: "Fix issues labelled agent", kind: "github", spec: { event: "issue_labeled", label: "agent" }, repo: REPO,
  taskTemplate: "Issue #{{issue.number}} (label: agent): {{issue.title}}. Find the cause, fix it with a regression test, and open a PR.",
  enabled: true, concurrency: 1, budget: { maxMinutes: 30 }, prComment: true, agent: "claude",
  when: "when an issue is labelled agent", lastFired: null, nextFire: null, lastResult: null, hasPayload: false, active: 0, createdAt: T0 - 86400000, updatedAt: T0 - 86400000,
};
const CHANGES = [{ path: "queue/packages/queue/test/retry.test.ts", repo: "queue", status: "modified", additions: 9, deletions: 3 }];
const DIGEST = {
  box: NAME, task: TASK, state: "done", exitCode: 0,
  plan: ["Reproduce the flake", "Find the timing assumption", "Fix + regression test", "Open a pull request"].map((text) => ({ text, state: "done" })),
  files: CHANGES, failedCommands: [],
  questions: [{ question: "Which fix should I apply?", answer: "Fake the clock with vi.useFakeTimers()" }],
  headline: "Retry test moved to a fake clock; suite green; PR #212 opened.",
};
const PR = { repo: REPO, number: 212, title: "test(queue): run the retry test on a fake clock", state: "open", additions: 9, deletions: 3, changedFiles: 1, head: "fix/retry-fake-timers", base: "main", author: "agent-sandbox[bot]", url: `https://github.com/${REPO}/pull/212`, mergeable: true, reviewDecision: "review_required", reviewers: [], checks: { total: 2, success: 2, failure: 0, pending: 0 } };

/* ── the live stream: one long-lived SSE connection the script drives ── */
const frame = (event, data, id) => `event: ${event}\n${id !== undefined ? `id: ${id}\n` : ""}data: ${JSON.stringify(data)}\n\n`;
let sent = 0;
const clients = new Set();
const push = (event, data) => { for (const c of clients) c.write(frame(event, data, sent)); };
const appendSlow = async (text, ms) => {
  // Drip by line groups so tool rows and prose arrive the way a real run streams.
  const lines = text.split(/(?<=\n)/);
  for (const l of lines) { sent += l.length; push("append", { chunk: l }); await sleep(ms); }
};
let logSoFar = "";
const sse = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", "access-control-allow-origin": "*" });
  res.write("retry: 1000\n\n");
  res.write(frame("snapshot", { meta: metaNow(), log: logSoFar, from: 0 }, logSoFar.length));
  clients.add(res);
  req.on("close", () => clients.delete(res));
});
await new Promise((r) => sse.listen(0, "127.0.0.1", r));
const ssePort = sse.address().port;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = async (text, ms = 60) => { logSoFar += text; await appendSlow(text, ms); };

/* ── browser ── */
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: W, height: H }, colorScheme: dark ? "dark" : "light", deviceScaleFactor: 1,
  recordVideo: { dir: OUT, size: { width: W, height: H } },
});
await ctx.addInitScript(([t, d]) => { localStorage.setItem("asb-token", t); localStorage.setItem("asb-dark", d ? "1" : "0"); }, [token, dark]);
// A visible pointer: headless recordings have no cursor.
await ctx.addInitScript(() => {
  addEventListener("DOMContentLoaded", () => {
    const d = document.createElement("div");
    d.style.cssText = "position:fixed;z-index:99999;left:0;top:0;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(120,120,130,.35);border:2px solid rgba(255,255,255,.9);box-shadow:0 1px 4px rgba(0,0,0,.35);pointer-events:none;transform:translate(-40px,-40px)";
    document.body.appendChild(d);
    addEventListener("mousemove", (e) => (d.style.transform = `translate(${e.clientX}px,${e.clientY}px)`), true);
    addEventListener("mousedown", () => (d.style.scale = "0.8"), true);
    addEventListener("mouseup", () => (d.style.scale = "1"), true);
  });
});
const page = await ctx.newPage();
let mx = W / 2, my = H / 2;
async function clickEl(loc) {
  const b = await loc.boundingBox({ timeout: 10000 });
  const tx = b.x + b.width / 2, ty = b.y + b.height / 2;
  const steps = 18;
  for (let i = 1; i <= steps; i++) { const k = 1 - Math.pow(1 - i / steps, 3); await page.mouse.move(mx + (tx - mx) * k, my + (ty - my) * k); await sleep(22); }
  mx = tx; my = ty;
  await sleep(250);
  await page.mouse.down(); await sleep(90); await page.mouse.up();
}
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
await page.route("**/*", async (route) => {
  const u = new URL(route.request().url());
  const p = u.pathname;
  const onBox = phase !== "automations";
  switch (p) {
    case "/fleet.json": return json(route, { boxes: onBox ? [boxNow()] : [], lifecycle: LIFECYCLE, at: Date.now() });
    case "/monitor.json": return json(route, { boxes: onBox ? [boxNow()] : [] });
    case "/watch.json": return json(route, { ...metaNow(), log: logSoFar });
    case "/watch.sse": return route.continue({ url: `http://127.0.0.1:${ssePort}/watch.sse` });
    case "/triggers.json": return json(route, { triggers: [TRIGGER] });
    case `/triggers/${TRIGGER.id}/run.json`: return json(route, { result: { at: Date.now(), outcome: "started", box: NAME } });
    case "/changes.json": return json(route, { files: phase === "done" ? CHANGES : [] });
    case "/digest.json": return phase === "done" ? json(route, DIGEST) : json(route, { error: "not finished" }, 404);
    case "/pr.json": return phase === "done" ? json(route, PR) : json(route, { error: "no pr" }, 404);
    case "/inbox.json": return json(route, { queued: [] });
    case "/revert-points.json": return json(route, { messages: [] });
    case "/resume.json": {
      phase = "running-2";
      setTimeout(() => void finish(), 300);
      return json(route, { output: "" });
    }
    case "/title.json": case "/wake.json": case "/memory.json": return json(route, { ok: true });
    default: return route.continue();
  }
});

let finished;
const finishedP = new Promise((r) => (finished = r));
async function finish() {
  push("state", { meta: metaNow() });
  await say(PART3, 170);
  phase = "done";
  push("done", { meta: metaNow() });
  finished();
}

// 1. The automation: a GitHub trigger on issues labelled `agent`. Run now stands in for the label event.
await page.goto(`${base}/dashboard/automations`, { waitUntil: "load", timeout: 30000 });
await sleep(1800);
await clickEl(page.getByRole("button", { name: `Edit ${TRIGGER.name}` }));
await sleep(1500);
phase = "running";
await clickEl(page.getByRole("button", { name: "Run now" }));
await sleep(1300);
await page.keyboard.press("Escape");
await page.getByText(baseBox.title).first().waitFor({ timeout: 15000 });
await sleep(500);
if (flags.includes("--debug")) await page.screenshot({ path: `${OUT}/debug-trigger.png` });

// 2. The run: same SPA, navigate to the new box.
await clickEl(page.getByText(baseBox.title).first());
await sleep(1200);
await say(PART1, 250);
await sleep(600);
await say(PART2, 160);
phase = "waiting";
push("state", { meta: metaNow() });
await sleep(2600);
if (flags.includes("--debug")) await page.screenshot({ path: `${OUT}/debug-question.png` });

// 3. The answer: pick the first option, send.
await clickEl(page.getByText("Fake the clock with vi.useFakeTimers()").first()).catch((e) => errors.push("option: " + e.message));
await sleep(700);
await clickEl(page.getByRole("button", { name: "Send answer" })).catch((e) => errors.push("send: " + e.message));
await Promise.race([finishedP, sleep(25000).then(() => errors.push("resume.json never called"))]);
await sleep(3500);
await page.screenshot({ path: `${OUT}/poster${dark ? "-dark" : ""}.png` });
await sleep(800);

const video = page.video();
await ctx.close();
const raw = await video.path();
const dest = path.join(OUT, `raw${dark ? "-dark" : ""}.webm`);
fs.renameSync(raw, dest);
console.log("saved", dest);
if (errors.length) console.log("errors:\n" + errors.join("\n"));
await browser.close();
sse.close();
// Then (a full ffmpeg, e.g. ffmpeg-static; Playwright's bundled one lacks setpts/VP9), 1.3x speed:
//   ffmpeg -i .shots/demo/raw.webm -vf setpts=PTS/1.3 -c:v libvpx-vp9 -b:v 0 -crf 36 -an web/public/demo/demo.webm
//   ffmpeg -i .shots/demo/raw.webm -vf setpts=PTS/1.3 -c:v libx264 -crf 25 -pix_fmt yuv420p -movflags +faststart -an web/public/demo/demo.mp4
//   poster: the question frame, exported to web/public/demo/demo-poster.jpg (-dark variants from raw-dark.webm)
