// The conversation column after the premium pass. Mocks copied from r3-select.mjs (the `done`
// scenario) with ONE turn and a long answer, so the thread is taller than two viewports. Run from
// PowerShell:
//
//   node .shots/r5-chat.mjs [--dark]
//
// Proves: no minimap for a one-turn thread; the plan board never intersects answer prose at 1100,
// 1280 and 1440; a long code line is reachable by horizontal scroll and the edge fades track the
// scroll position; the jump button is hidden at the bottom and within a viewport of it, appears
// once the reader is further up, and sits above the composer; the changes dock is inside the
// composer's surface.
import { serveWorktreeFonts } from "./overflow-probe.mjs";
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";

const args = process.argv.slice(2);
const dark = args.includes("--dark");
const H = 900;
const token = process.env.ASB_DEV_TOKEN || "devtoken123";
const base = process.env.ASB_UI || "http://localhost:5173";
const outPrefix = `.shots/r5-chat`;

/* ───────────── the box: one turn, a plan, a long answer with a wide code line ───────────── */
const NAME = "quiet-otter";
const REPO = "acme/orders-api";
const T0 = Date.now() - 14 * 60_000;
const at = (m, s = 0) => `⟦at⟧ ${T0 + m * 60_000 + s * 1000}`;
const TASK = "Replace the fixed-window rate limiter in the orders API with a sliding-window one backed by Redis, keep the public middleware signature, add tests for burst and steady traffic, and open a PR.";
const NOTES = [
  "The hash key is `rl:<client>` and each field is a bucket index, so a key holds at most six fields and expires with the window; nothing accumulates across windows.",
  "Burst traffic lands in one bucket and is counted against the whole window immediately, which is the behaviour the fixed window could not give you.",
  "Steady traffic spreads across buckets and the sum stays flat, so a client at exactly the limit is never rejected by rounding.",
  "The window slide happens on read, not on a timer: an idle key costs nothing and the first request after a quiet spell sees a fresh window.",
  "Redis round trips are two per request (`HINCRBY`, `HGETALL`); the pipeline in `windowTotal` keeps them in one flight.",
  "Clock skew between API nodes moves a request by at most one bucket, which the tests cover with a stubbed clock.",
  "The middleware still reads `limit` and `window` from the same options object, so no call site changed.",
  "Error handling fails open: a Redis timeout logs once per minute and lets the request through rather than taking the API down with the cache.",
  "The `Retry-After` header now says the bucket size, which is the soonest the client can expect headroom.",
  "The old fixed-window implementation is deleted rather than kept behind a flag; the tests that pinned its behaviour were rewritten for the sliding window.",
];
const ANSWER = [
  "## Sliding-window limiter is in",
  "",
  "The limiter now keeps **six 10-second buckets** per key in a Redis hash and sums them on each request, so a client that burns its quota at `:59` no longer gets a fresh allowance at `:00`. The middleware signature is unchanged — callers still pass `{ limit, window }`.",
  "",
  "```ts",
  "export function rateLimit({ limit, window = 60_000 }: Options) {",
  "  const buckets = 6;",
  "  const slice = window / buckets;",
  "  return async (req: Request, res: Response, next: NextFunction) => {",
  "    const key = `rl:${clientKey(req)}`;",
  "    const now = Math.floor(Date.now() / slice);",
  "    const hits = await redis.hincrby(key, String(now), 1);",
  "    const total = await windowTotal(key, now, buckets);",
  "    if (total > limit) return res.status(429).set('Retry-After', String(slice / 1000)).set('X-RateLimit-Limit', String(limit)).end();",
  "    next();",
  "  };",
  "}",
  "```",
  "",
  "Two things worth your eyes before merging: the limiter fails open on Redis errors, and the Retry-After header is now the bucket size rather than the full window.",
  "",
  ...NOTES.flatMap((n) => [n, ""]),
  "PR: https://github.com/acme/orders-api/pull/482",
];
const LOG = [
  at(0),
  "● session started (model ak-claude-opus-4.8)",
  at(0, 9),
  "I'll start by reading how the limiter is wired today, then swap the implementation behind the same signature.",
  `⟦plan⟧ ${T0 + 10_000}`,
  "[x] Read the current limiter and its tests",
  "[x] Implement a sliding-window limiter on Redis",
  "[x] Add burst and steady-traffic tests",
  "[x] Open a pull request",
  "⟦/plan⟧",
  at(1, 22),
  "→ Bash: gh pr create --fill ⟦#b5⟧",
  at(1, 25),
  "  ⟦#b5⟧ https://github.com/acme/orders-api/pull/482",
  at(1, 30),
  ...ANSWER,
  "⟦usage⟧ in=91320 out=12880 ctx=88200",
].join("\n");
const box = {
  name: NAME,
  role: "session",
  boxStatus: "running",
  runState: "done",
  exitCode: 0,
  task: TASK,
  uptime: "14m",
  cpu: "12%",
  mem: "1.1G/4G",
  memUsage: { usedMib: 1130, totalMib: 4096 },
  disk: { usedMib: 3800, totalMib: 20480 },
  lastOutputAt: Date.now() - 4000,
  title: "Sliding-window rate limiter",
  repos: [{ name: "orders-api", branch: "feat/sliding-window-limiter" }],
  agent: "claude",
};
const { role: _r, ...meta } = box;
const LIFECYCLE = { idleTimeoutSec: 1800, maxDurationSec: 4 * 3600, capacity: 8, poolSize: 2, sleepTtlSec: 7 * 86400, memoryTiers: ["2G", "4G", "8G"], memoryDefault: "4G", diskTiers: ["20G", "40G"] };
const CHANGES = [
  { path: "orders-api/src/middleware/rateLimit.ts", repo: "orders-api", status: "modified", additions: 34, deletions: 11 },
  { path: "orders-api/test/rateLimit.test.ts", repo: "orders-api", status: "modified", additions: 24, deletions: 0 },
];
const PR = { repo: REPO, number: 482, title: "feat: sliding-window rate limiter", state: "open", additions: 58, deletions: 11, changedFiles: 2, head: "feat/sliding-window-limiter", base: "main", author: "agent-sandbox[bot]", url: `https://github.com/${REPO}/pull/482`, mergeable: true, reviewDecision: "review_required", reviewers: [], checks: { total: 3, success: 2, failure: 0, pending: 1 } };
const MODELS = { default: "ak-claude-opus-4.8", current: "ak-claude-opus-4.8", models: [{ id: "ak-claude-opus-4.8", label: "Opus 4.8", tier: "opus" }] };
const TREE = ["orders-api/src/app.ts", "orders-api/src/middleware/rateLimit.ts", "orders-api/test/rateLimit.test.ts"];
const frame = (event, data, id) => `event: ${event}\n${id !== undefined ? `id: ${id}\n` : ""}data: ${JSON.stringify(data)}\n\n`;

/* ───────────────────────────── browser ───────────────────────────── */
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: H }, colorScheme: dark ? "dark" : "light", deviceScaleFactor: 1 });
await ctx.addInitScript(
  ([t, d]) => {
    localStorage.setItem("asb-token", t);
    localStorage.setItem("asb-dark", d ? "1" : "0");
    localStorage.removeItem("asb-sidechat:quiet-otter");
    sessionStorage.removeItem("asb-plan-dock");
  },
  [token, dark]
);
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
page.on("response", (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
const json = (route, body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
await serveWorktreeFonts(ctx);
await page.route("**/*", async (route) => {
  const u = new URL(route.request().url());
  switch (u.pathname) {
    case "/auth/config.json":
      return json(route, { mode: "saas", providers: ["github"], tokenLogin: true, password: true, signup: true, passwordMin: 10, trialDays: 14, beta: true });
    case "/workflows.json":
      return json(route, { limits: {}, dir: ".agent-sandbox/workflows", workflows: [] });
    case "/triggers/for-box.json":
      return json(route, { items: [] });
    case "/fleet.json":
      return json(route, { boxes: [box], lifecycle: LIFECYCLE, at: Date.now() });
    case "/monitor.json":
      return json(route, { boxes: [box] });
    case "/watch.json":
      return json(route, { ...meta, log: LOG });
    case "/watch.sse":
      return route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache" }, body: "retry: 3000\n\n" + frame("snapshot", { meta, log: LOG, from: 0 }, LOG.length) + frame("done", { meta }) });
    case "/changes.json":
      return json(route, { files: CHANGES });
    case "/digest.json":
      return json(route, { box: NAME, task: TASK, state: "done", exitCode: 0, startedAt: T0, endedAt: T0 + 92_000, plan: [], files: CHANGES, failedCommands: [], questions: [], usage: { inputTokens: 91320, outputTokens: 12880, contextTokens: 88200 }, headline: "Sliding-window limiter shipped; PR #482 opened." });
    case "/pr.json":
      return json(route, PR);
    case "/inbox.json":
      return json(route, { queued: [] });
    case "/repos.json":
      return json(route, { repos: [{ fullName: REPO, private: true, defaultBranch: "main", logins: ["acme"] }], total: 1 });
    case "/secrets.json":
      return json(route, { secrets: [] });
    case "/revert-points.json":
      return json(route, { messages: [] });
    case "/models.json":
      return json(route, MODELS);
    case "/skills.json":
      return json(route, { skills: [] });
    case "/tree.json":
    case "/files.json":
      return json(route, { files: TREE, total: TREE.length, truncated: false });
    case "/git.json":
      return json(route, { repo: "orders-api", branch: "feat/sliding-window-limiter", upstream: "origin/feat/sliding-window-limiter", ahead: 0, behind: 0, lastCommit: "feat: sliding-window rate limiter", clean: false, changed: 2 });
    case "/memory.json":
    case "/resume.json":
    case "/title.json":
    case "/wake.json":
      return json(route, { ok: true });
    case "/me.json":
      return json(route, { kind: "user", mode: "saas", id: "u_1", login: "ak", name: "Arun K", role: "admin", via: "session", email: "ak@example.com", avatarUrl: null, github: true, hasPassword: true, maxBoxes: 8, plan: "trial", trialEndsAt: new Date(Date.now() + 9 * 86400e3).toISOString(), daysLeft: 9, expired: false, billingUrl: null });
    case "/history/outcome.json":
      return json(route, { id: 31, box: NAME, outcome: { v: 1, state: "done", header: { startedBy: { kind: "web" }, label: null, link: null }, result: { prs: [{ url: PR.url, repo: REPO, number: 482 }], diff: { files: 2, additions: 58, deletions: 11 } }, trust: { tests: { runner: "vitest", passed: 25, failed: 0, skipped: 0, source: "trace" }, exitCode: 0, verified: null, prOnly: false, questions: 0, openQuestions: 0, blocked: 0 }, cost: { durationMs: 92_000, tokens: { input: 91320, output: 12880 }, usd: null, model: "ak-claude-opus-4.8" } } });
    default:
      return route.fallback();
  }
});

await page.goto(`${base}/dashboard/box/${NAME}`, { waitUntil: "load", timeout: 30000 }).catch((e) => errors.push("goto: " + e.message));
await page.waitForTimeout(1600);

/* ───────────────────────────── helpers ───────────────────────────── */
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  · ${detail}` : ""}`);
};
const shots = [];
const shot = async (suffix, clip) => {
  const out = `${outPrefix}${suffix}${dark ? "-dark" : ""}.png`;
  await page.screenshot({ path: out, clip });
  shots.push(out);
};
const conv = () => page.locator('[aria-label="Conversation"]');
const r = (n) => Math.round(n);
const intersects = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
/** The element under the Conversation root that actually scrolls. */
const scroller = () => conv().evaluate((root) => [root, ...root.querySelectorAll("*")].find((n) => n.scrollHeight > n.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(n).overflowY)) ? true : false);
const scrollState = () =>
  conv().evaluate((root) => {
    const el = [root, ...root.querySelectorAll("*")].find((n) => n.scrollHeight > n.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(n).overflowY));
    return el ? { top: el.scrollTop, max: el.scrollHeight - el.clientHeight, view: el.clientHeight } : null;
  });
const jump = () => page.locator('button[aria-label="Scroll to latest"]');
const composer = () => page.locator("#send-input").locator("xpath=ancestor::div[contains(@class,'composer-depth')]");

/* 1 ─ one turn: no map */
check("no minimap for a one-turn thread", (await page.locator('nav[aria-label="Conversation map"]').count()) === 0);
check("the thread is a scroller", await scroller());

/* 2 ─ the plan never sits on the prose, at three widths */
for (const W of [1440, 1280, 1100]) {
  await page.setViewportSize({ width: W, height: H });
  await page.waitForTimeout(700);
  const plan = page.locator('[aria-label="Plan"]').first();
  const tag = await plan.evaluate((el) => el.tagName.toLowerCase());
  const pb = await plan.boundingBox();
  const paras = await conv().locator(".prose-agent p").evaluateAll((els) => els.map((el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; }).filter((b) => b.width > 0));
  const hits = pb ? paras.filter((b) => intersects(pb, b)).length : -1;
  const proseW = Math.max(0, ...paras.map((b) => b.width));
  check(`plan is clear of answer prose at ${W}`, pb !== null && hits === 0, `${tag} ${r(pb?.x ?? 0)},${r(pb?.y ?? 0)} ${r(pb?.width ?? 0)}×${r(pb?.height ?? 0)} · ${paras.length} paragraphs, widest ${r(proseW)}px · ${hits} hit`);
  if (tag === "aside") {
    // The aside is the gutter; the panel inside it is what the eye lines up with the task row.
    const panel = await plan.locator(":scope > *").first().boundingBox();
    const first = await conv().locator("[data-turn='task'] .label").first().boundingBox();
    check(`plan panel is level with the task row at ${W}`, !!first && !!panel && Math.abs(first.y - panel.y) <= 2, `panel top ${r(panel?.y ?? 0)} · task label top ${r(first?.y ?? 0)}`);
  }
  await shot(`-plan-${W}`);
}
await page.setViewportSize({ width: 1440, height: H });
await page.waitForTimeout(500);

/* 3 ─ code scrolls sideways; the fades follow */
const wide = conv().locator(".code-scroll").filter({ hasText: "Retry-After" }).first();
await wide.scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
const dims = await wide.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
check("the long code line overflows its block", dims.sw > dims.cw + 20, `scrollWidth ${dims.sw} · clientWidth ${dims.cw}`);
const edges = () => wide.evaluate((el) => {
  const wrap = el.parentElement;
  const [left, right] = [...wrap.querySelectorAll(":scope > [aria-hidden]")].map((f) => getComputedStyle(f).opacity);
  return { start: wrap.hasAttribute("data-scrolled-start"), end: wrap.hasAttribute("data-scrolled-end"), left, right };
});
let e = await edges();
check("right fade only, before any scroll", !e.start && e.end && e.left === "0" && e.right === "1", JSON.stringify(e));
await shot("-code-start", await wide.boundingBox().then((b) => b && { x: b.x - 8, y: b.y - 40, width: b.width + 16, height: b.height + 56 }));
const reached = await wide.evaluate((el) => {
  el.scrollLeft = el.scrollWidth;
  return el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
});
await page.waitForTimeout(300);
e = await edges();
check("the line end is reachable by horizontal scroll", reached);
check("left fade only, at the end", e.start && !e.end && e.left === "1" && e.right === "0", JSON.stringify(e));
await shot("-code-end", await wide.boundingBox().then((b) => b && { x: b.x - 8, y: b.y - 40, width: b.width + 16, height: b.height + 56 }));
await wide.evaluate((el) => { el.scrollLeft = 0; });

/* 4 ─ the jump button: hidden at the bottom and within a viewport of it, shown further up */
await conv().evaluate((root) => {
  const el = [root, ...root.querySelectorAll("*")].find((n) => n.scrollHeight > n.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(n).overflowY));
  el.scrollTop = el.scrollHeight;
});
await page.waitForTimeout(500);
let s = await scrollState();
check("thread is taller than two viewports", !!s && s.max > s.view, `max ${s?.max} · view ${s?.view}`);
check("no jump button at the bottom", (await jump().count()) === 0, `scrollTop ${s?.top}/${s?.max}`);
await page.mouse.move(700, 400);
for (let i = 0; i < 2; i++) {
  await page.mouse.wheel(0, -150);
  await page.waitForTimeout(120);
}
await page.waitForTimeout(500);
s = await scrollState();
check("no jump button within a viewport of the end", s.max - s.top < s.view && (await jump().count()) === 0, `${s.max - s.top}px from the end · view ${s.view}`);
for (let i = 0; i < 12; i++) {
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(80);
}
await page.waitForTimeout(600);
s = await scrollState();
const jb = await jump().boundingBox();
const cb = await composer().boundingBox();
const convBox = await conv().boundingBox();
check("jump button appears once more than a viewport up", s.max - s.top > s.view && !!jb, `${s.max - s.top}px from the end · view ${s.view}`);
check("jump button sits just above the composer, centred", !!jb && !!cb && cb.y - (jb.y + jb.height) >= 0 && cb.y - (jb.y + jb.height) <= 40 && Math.abs(jb.x + jb.width / 2 - (convBox.x + convBox.width / 2)) <= 2, `gap ${jb && cb ? r(cb.y - (jb.y + jb.height)) : "?"}px · button centre ${jb ? r(jb.x + jb.width / 2) : "?"} · column centre ${r(convBox.x + convBox.width / 2)}`);
await shot("-scrolled");
await shot("-scrolled-zoom", jb && { x: jb.x - 120, y: jb.y - 40, width: jb.width + 240, height: jb.height + 120 });

/* 5 ─ the changes dock lives inside the composer */
const dock = page.locator('button[aria-label^="Show the changed files"]').first();
const db = await dock.boundingBox();
check("changes dock is inside the composer surface", !!db && !!cb && db.y >= cb.y && db.y + db.height <= cb.y + cb.height && db.x >= cb.x, `dock ${r(db?.y ?? 0)}..${r((db?.y ?? 0) + (db?.height ?? 0))} · composer ${r(cb?.y ?? 0)}..${r((cb?.y ?? 0) + (cb?.height ?? 0))}`);
await shot("-composer", cb && { x: cb.x - 16, y: cb.y - 24, width: cb.width + 32, height: cb.height + 48 });
await dock.click();
await page.waitForTimeout(400);
check("clicking the dock does not focus the textarea", await page.evaluate(() => document.activeElement?.id !== "send-input"));
await shot("-dock-open", await composer().boundingBox().then((b) => b && { x: b.x - 16, y: b.y - 24, width: b.width + 32, height: b.height + 48 }));

console.log("shots:", shots.join(" "));
if (errors.length) console.log("page errors:", errors);
const failed = results.filter((x) => !x.ok).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
