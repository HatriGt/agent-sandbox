// Drives the workspace pane's resize handles on the real Vite surface and measures them.
//   ASB_UI=http://localhost:5174 node .shots/workspace-resize.mjs --w=1440 --h=900 [--dark] [--out=.shots/ux]
// Asserts: the handle is visible, the pane width tracks the pointer with no lag, both widths persist
// across a reload, double-click resets, arrow keys resize, the clamps hold at 1280/1440/1920.
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";

const flags = process.argv.slice(2).filter((a) => a.startsWith("--"));
const flag = (k, d) => flags.find((f) => f.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const dark = flags.includes("--dark");
const W = Number(flag("w", 1440));
const H = Number(flag("h", 900));
const OUT = flag("out", ".shots/ux");
const token = process.env.ASB_DEV_TOKEN || "devtoken123";
const base = process.env.ASB_UI || "http://localhost:5173";

const NAME = "quiet-otter";
const REPO = "acme/orders-api";
const T0 = Date.now() - 14 * 60_000;
const TASK = "Replace the fixed-window rate limiter in the orders API with a sliding-window one backed by Redis.";
const box = { name: NAME, boxStatus: "running", task: TASK, uptime: "14m", cpu: "2%", mem: "1.1G/4G", memUsage: { usedMib: 1130, totalMib: 4096 }, disk: { usedMib: 3800, totalMib: 20480 }, lastOutputAt: Date.now() - 4000, title: "Sliding-window rate limiter", repos: [{ name: "orders-api", branch: "feat/sliding-window-limiter" }], agent: "claude", runState: "done", exitCode: 0 };
const LOG = [`⟦at⟧ ${T0}`, "● session started (model ak-claude-opus-4.8)", `⟦at⟧ ${T0 + 60_000}`, "Replaced the limiter and added tests; 25 tests green.", "⟦usage⟧ in=91320 out=12880 ctx=88200"].join("\n");
const LIFECYCLE = { idleTimeoutSec: 1800, maxDurationSec: 4 * 3600, capacity: 8, poolSize: 2, sleepTtlSec: 7 * 86400, memoryTiers: ["2G", "4G", "8G"], memoryDefault: "4G", diskTiers: ["20G", "40G"] };
const CHANGES = [
  { path: "orders-api/src/middleware/rateLimit.ts", repo: "orders-api", status: "modified", additions: 34, deletions: 11 },
  { path: "orders-api/test/rateLimit.test.ts", repo: "orders-api", status: "modified", additions: 24, deletions: 0 },
  { path: "orders-api/docs/rate-limits.md", repo: "orders-api", status: "added", additions: 18, deletions: 0 },
];
const FILES = ["orders-api/src/app.ts", "orders-api/src/middleware/rateLimit.ts", "orders-api/src/lib/redis.ts", "orders-api/test/rateLimit.test.ts", "orders-api/test/orders.test.ts", "orders-api/docs/rate-limits.md", "orders-api/package.json", "orders-api/README.md"];
const SOURCE = Array.from({ length: 20 }, (_, i) => `const line${i + 1} = ${i + 1}; // redis is mentioned on line ${i + 1} so that content search has hits`).join("\n") + "\n";
const frame = (event, data, id) => `event: ${event}\n${id !== undefined ? `id: ${id}\n` : ""}data: ${JSON.stringify(data)}\n\n`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: dark ? "dark" : "light", deviceScaleFactor: 1 });
await ctx.addInitScript(
  ([t, d]) => {
    localStorage.setItem("asb-token", t);
    localStorage.setItem("asb-dark", d ? "1" : "0");
  },
  [token, dark]
);
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
page.on("response", (r) => r.status() >= 400 && !/.woff2?$/.test(r.url()) && !(r.status() === 404 && r.url().includes("/history/outcome.json")) && errors.push(`${r.status()} ${r.url()}`));

const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
await page.route("**/*", async (route) => {
  const u = new URL(route.request().url());
  switch (u.pathname) {
    case "/fleet.json":
      return json(route, { boxes: [box], lifecycle: LIFECYCLE, at: Date.now() });
    case "/monitor.json":
      return json(route, { boxes: [box] });
    case "/watch.json":
      return json(route, { ...box, log: LOG });
    case "/watch.sse":
      return route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache" }, body: "retry: 3000\n\n" + frame("snapshot", { meta: box, log: LOG, from: 0 }, LOG.length) + frame("done", { meta: box }) });
    case "/changes.json":
      return json(route, { files: CHANGES });
    case "/digest.json":
      return json(route, { box: NAME, task: TASK, state: "done", exitCode: 0, startedAt: T0, endedAt: T0 + 92_000, plan: [], files: CHANGES, failedCommands: [], questions: [], usage: { inputTokens: 1, outputTokens: 1, contextTokens: 1 }, headline: "Done." });
    case "/pr.json":
      return json(route, { repo: REPO, number: 482, title: "feat: sliding-window rate limiter", state: "open", additions: 58, deletions: 11, changedFiles: 2, head: "feat/sliding-window-limiter", base: "main", author: "bot", url: `https://github.com/${REPO}/pull/482`, mergeable: true, reviewDecision: "review_required", reviewers: [], checks: { total: 3, success: 3, failure: 0, pending: 0 } });
    case "/inbox.json":
      return json(route, { queued: [] });
    case "/repos.json":
      return json(route, { repos: [{ fullName: REPO, private: true, defaultBranch: "main", logins: ["acme"] }], total: 1 });
    case "/secrets.json":
      return json(route, { secrets: [] });
    case "/revert-points.json":
      return json(route, { messages: [] });
    case "/models.json":
      return json(route, { default: "ak-claude-opus-4.8", current: "ak-claude-opus-4.8", models: [{ id: "ak-claude-opus-4.8", label: "Opus 4.8", tier: "opus" }] });
    case "/skills.json":
      return json(route, { skills: [] });
    case "/tree.json":
      return json(route, { files: FILES, total: FILES.length, truncated: false });
    case "/files.json":
      return json(route, { files: FILES.filter((f) => f.includes(u.searchParams.get("q") ?? "")), total: FILES.length, truncated: false });
    case "/git.json":
      return json(route, { repo: "orders-api", branch: "feat/sliding-window-limiter", upstream: "origin/feat/sliding-window-limiter", ahead: 0, behind: 0, lastCommit: "feat: sliding-window rate limiter", clean: false, changed: 3 });
    case "/artifact":
      return route.fulfill({ status: 200, contentType: "text/plain", body: SOURCE });
    case "/diff.json":
      return json(route, { path: u.searchParams.get("path") ?? CHANGES[0].path, untracked: false, binary: false, original: "const WINDOW = 60_000;\n", diff: "@@ -1,1 +1,2 @@\n-const WINDOW = 60_000;\n+const BUCKETS = 6;\n+const WINDOW = 60_000;\n" });
    case "/rundiff.json":
      return json(route, { diff: "" });
    case "/file.json":
      if (route.request().method() === "POST") return json(route, { ok: true });
      return json(route, { path: u.searchParams.get("path"), content: SOURCE, bytes: SOURCE.length, mtime: Date.now() });
    case "/search.json":
      return json(route, { matches: [], truncated: false });
    case "/triggers/for-box.json":
      return json(route, { items: [] });
    case "/auth/config.json":
      return json(route, { mode: "token", providers: [], tokenLogin: true });
    case "/workflows.json":
      return json(route, { workflows: [], limits: {}, dir: ".agent-sandbox/workflows" });
    case "/memory.json":
    case "/resume.json":
    case "/title.json":
    case "/wake.json":
      return json(route, { ok: true });
    default:
      return route.continue();
  }
});

const results = [];
process.on("uncaughtException", (e) => {
  console.log(results.join("\n"));
  console.log("CRASH " + String(e.message ?? e).split("\n")[0]);
  process.exit(1);
});
const check = async (name, fn) => {
  try {
    const r = await fn();
    results.push(r === true ? `ok   ${name}` : `FAIL ${name} — ${typeof r === "string" ? r : JSON.stringify(r)}`);
  } catch (e) {
    results.push(`FAIL ${name} — ${e.message.split("\n")[0]}`);
  }
};
const note = (s) => results.push(`note ${s}`);
const pane = () => page.getByRole("complementary", { name: "Workspace" });
const paneW = () => pane().evaluate((el) => el.getBoundingClientRect().width);
const boxW = () => pane().evaluate((el) => el.parentElement.getBoundingClientRect().width);
const expectDefault = (box) => Math.min(Math.round(box) - 480, Math.max(480, Math.round(box * 0.58)));
const files = () => pane().locator("section[aria-label=Files]");
const filesW = () => files().evaluate((el) => el.getBoundingClientRect().width);
const paneHandle = () => pane().locator("[role=separator][aria-orientation=vertical]").first();
const filesHandle = () => files().locator("[role=separator][aria-orientation=vertical]").first();
const settle = (ms = 350) => page.waitForTimeout(ms);
const shot = (name) => page.screenshot({ path: `${OUT}/ws-resize-${W}-${name}.png` });
const aria = async (h) => ({ now: Number(await h.getAttribute("aria-valuenow")), min: Number(await h.getAttribute("aria-valuemin")), max: Number(await h.getAttribute("aria-valuemax")) });

const openPane = async () => {
  await page.goto(`${base}/dashboard/box/${NAME}`, { waitUntil: "load", timeout: 30000 }).catch((e) => errors.push("goto: " + e.message));
  await page.waitForTimeout(1200);
  if ((await pane().count()) === 0) await page.getByRole("button", { name: /files|workspace/i }).first().click();
  await pane().locator("[role=tree] [role=treeitem]").first().waitFor({ timeout: 10000 });
  await settle(700);
};

// Drags a handle `steps` moves of `dx` px each, measuring the target right after every move with no wait.
// A width that trails the pointer by more than a few px at any step means the move is animated, not tracked.
const dragSteps = async (handle, measure, dx, steps) => {
  const b = await handle.boundingBox();
  const x0 = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await page.mouse.move(x0, y);
  await page.mouse.down();
  const start = await measure();
  const devs = [];
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x0 + dx * i, y);
    const got = await measure();
    devs.push(Math.round(Math.abs(got - (start - dx * i))));
  }
  const mid = await page.screenshot({ path: `${OUT}/ws-resize-${W}-drag.png` }).then(() => true);
  const selection = await page.evaluate(() => getComputedStyle(document.body).userSelect);
  await page.mouse.up();
  await settle(100);
  return { start, end: await measure(), devs, mid, selection };
};

await openPane();
await shot("before");

const h0 = paneHandle();
await check("pane handle exists", async () => (await h0.count()) === 1);
const hb = await h0.boundingBox().catch(() => null);
const rest = await h0.evaluate((el) => {
  const vis = (n) => {
    const s = getComputedStyle(n);
    return s.backgroundColor !== "rgba(0, 0, 0, 0)" && s.opacity !== "0" && n.getBoundingClientRect().width > 0;
  };
  return { bg: getComputedStyle(el).backgroundColor, cursor: getComputedStyle(el).cursor, painted: [el, ...el.querySelectorAll("*")].filter(vis).length };
});
note(`handle at rest: hit ${hb ? Math.round(hb.width) : 0}px wide, bg ${rest.bg}, cursor ${rest.cursor}, painted nodes ${rest.painted}`);
await check("pane handle has a 6-8px hit area", async () => hb && hb.width >= 6 && hb.width <= 8);
await check("pane handle paints something at rest (grip or hairline)", async () => rest.painted >= 1);
await check("pane handle cursor is col-resize", async () => rest.cursor === "col-resize");
const w0 = await paneW();
const b0 = await boxW();
note(`pane default width ${Math.round(w0)} in a ${Math.round(b0)} container (${((w0 / b0) * 100).toFixed(1)}%), window ${W}`);
await check("pane defaults to 58% of its container, clamped", async () => Math.abs(w0 - expectDefault(b0)) <= 1 || `${Math.round(w0)} vs ${expectDefault(b0)}`);
const a0 = await aria(h0).catch(() => null);
note(`pane separator aria now/min/max ${a0 ? `${a0.now}/${a0.min}/${a0.max}` : "missing"}`);
await check("pane separator exposes aria-valuenow/min/max", async () => a0 && a0.now > 0 && a0.min > 0 && a0.max > a0.min);
await h0.hover();
await settle(250);
await shot("hover");
const hov = await h0.evaluate((el) => [el, ...el.querySelectorAll("*")].map((n) => getComputedStyle(n).backgroundColor).filter((c) => c !== "rgba(0, 0, 0, 0)").length);
await check("hovering brightens the handle", async () => hov >= 1 || `painted nodes on hover ${hov}`);

// The drags stay inside the clamp so a clamped step does not read as lag.
const room = { left: Math.min(200, (a0?.max ?? 0) - Math.round(w0)), right: Math.min(200, Math.round(w0) - (a0?.min ?? 0)) };
const d1r = await dragSteps(h0, paneW, 20, Math.floor(room.right / 20));
note(`drag ${room.right}px right: start ${Math.round(d1r.start)} end ${Math.round(d1r.end)}, per-step lag px [${d1r.devs.join(" ")}]`);
await check("pane width follows the pointer within 3px at every step (shrinking)", async () => Math.max(...d1r.devs) <= 3 || `max lag ${Math.max(...d1r.devs)}px`);
await check("text selection is suppressed during a drag", async () => d1r.selection === "none" || `body user-select ${d1r.selection}`);
const steps = Math.floor((room.left + Math.floor(room.right / 20) * 20) / 20);
const d1 = await dragSteps(h0, paneW, -20, steps);
note(`drag ${steps * 20}px left: start ${Math.round(d1.start)} end ${Math.round(d1.end)}, per-step lag px [${d1.devs.join(" ")}]`);
await check("pane width follows the pointer within 3px at every step (growing)", async () => Math.max(...d1.devs) <= 3 || `max lag ${Math.max(...d1.devs)}px`);
await check("pane grew by the dragged distance", async () => Math.abs(d1.end - (d1.start + steps * 20)) <= 3 || `grew ${Math.round(d1.end - d1.start)} of ${steps * 20}`);
const stored1 = await page.evaluate(() => localStorage.getItem("asb-workspace-w"));
note(`stored asb-workspace-w=${stored1}`);
await shot("after");

await openPane();
const w1 = await paneW();
await check("pane width restores after reload", async () => Math.abs(w1 - d1.end) <= 1 || `${Math.round(w1)} vs ${Math.round(d1.end)}`);

const h1 = paneHandle();
await h1.focus();
const a1 = await aria(h1).catch(() => null);
await page.keyboard.press("Home");
await settle(80);
const kmin = await paneW();
await page.keyboard.press("ArrowLeft");
await settle(80);
const k1 = await paneW();
await page.keyboard.press("Shift+ArrowLeft");
await settle(80);
const k2 = await paneW();
await page.keyboard.press("ArrowRight");
await settle(80);
const k3 = await paneW();
await page.keyboard.press("End");
await settle(80);
const kmax = await paneW();
note(`keys on pane separator: Home ${Math.round(kmin)} →Left ${Math.round(k1)} →Shift+Left ${Math.round(k2)} →Right ${Math.round(k3)} →End ${Math.round(kmax)}, aria min/max ${a1?.min}/${a1?.max}`);
await check("Home goes to the min width", async () => a1 && Math.round(kmin) === a1.min);
await check("ArrowLeft widens the pane by 16px", async () => Math.round(k1 - kmin) === 16);
await check("Shift+ArrowLeft widens by 64px", async () => Math.round(k2 - k1) === 64);
await check("ArrowRight narrows by 16px", async () => Math.round(k2 - k3) === 16);
await check("End goes to the max width", async () => a1 && Math.round(kmax) === a1.max);
await check("max leaves 480px of the container for the conversation", async () => Math.round(kmax) === Math.round(await boxW()) - 480 || `${Math.round(kmax)} in ${Math.round(await boxW())}`);
await shot("keys-max");

await h1.dblclick();
await settle(400);
const wr = await paneW();
await check("double-click resets the pane to the 58% default", async () => Math.abs(wr - expectDefault(await boxW())) <= 1 || `${Math.round(wr)} vs ${expectDefault(await boxW())}`);
await check("reset clears the stored width", async () => (await page.evaluate(() => localStorage.getItem("asb-workspace-w"))) === null);

const fh = filesHandle();
await check("files panel has its own handle", async () => (await fh.count()) === 1);
const f0 = await filesW();
note(`files panel default width ${Math.round(f0)}`);
if (await fh.count()) {
const d2 = await dragSteps(fh, filesW, -12, 5);
note(`files drag 60px left: start ${Math.round(d2.start)} end ${Math.round(d2.end)}, per-step lag px [${d2.devs.join(" ")}]`);
await check("files panel width follows the pointer", async () => Math.max(...d2.devs) <= 3 && Math.abs(d2.end - (d2.start + 60)) <= 3);
await fh.focus();
const fa = await aria(fh).catch(() => null);
await page.keyboard.press("Home");
await settle(80);
const fmin = await filesW();
await page.keyboard.press("End");
await settle(80);
const fmax = await filesW();
const pw = await paneW();
note(`files Home → ${Math.round(fmin)}, End → ${Math.round(fmax)}, pane ${Math.round(pw)}, aria ${fa ? `${fa.now}/${fa.min}/${fa.max}` : "missing"}`);
await check("files panel clamps to 12rem..50% of the pane", async () => Math.round(fmin) === 192 && Math.abs(fmax - pw / 2) <= 1);
await page.keyboard.press("Shift+ArrowRight");
await page.keyboard.press("Shift+ArrowRight");
await settle(100);
const fset = await filesW();
await shot("files-wide");
await openPane();
await check("files panel width restores after reload", async () => Math.abs((await filesW()) - fset) <= 1 || `${Math.round(await filesW())} vs ${Math.round(fset)}`);
await filesHandle().dblclick();
await settle(300);
await check("double-click resets the files panel to 256px", async () => Math.round(await filesW()) === 256);
}

for (const vw of [1280, 1440, 1920]) {
  await page.setViewportSize({ width: vw, height: H });
  await settle(400);
  const a = await aria(paneHandle()).catch(() => null);
  const w = await paneW();
  const b = Math.round(await boxW());
  note(`at ${vw}: container ${b}, pane ${Math.round(w)} (${((w / b) * 100).toFixed(0)}%), min ${a?.min}, max ${a?.max}, conversation ${b - Math.round(w)}`);
  await check(`at ${vw} the pane sits inside its clamp`, async () => (a && w >= a.min - 1 && w <= a.max + 1 && a.max === b - 480) || `pane ${Math.round(w)} aria ${JSON.stringify(a)} box ${b}`);
}
await page.setViewportSize({ width: 1920, height: H });
await page.evaluate(() => localStorage.setItem("asb-workspace-w", "1400"));
await page.setViewportSize({ width: 1280, height: H });
await openPane();
const wc = await paneW();
const bc = Math.round(await boxW());
note(`restoring a 1400px width at 1280 (container ${bc}) gives ${Math.round(wc)}`);
await check("a stored width is clamped against the current container on restore", async () => Math.round(wc) === bc - 480 || `${Math.round(wc)} vs ${bc - 480}`);

await check("nothing threw in the console", async () => errors.length === 0 || errors.slice(0, 6).join(" | "));

console.log(results.join("\n"));
await browser.close();
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
