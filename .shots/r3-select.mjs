// Select text in the conversation → the floating "Ask in side chat · Quote in reply · Copy" pill.
// Mocks copied from thread-fixture.mjs (the `done` scenario, trimmed). Run from PowerShell:
//
//   node .shots/r3-select.mjs [--dark] [--w=1440 --h=900]
//
// Proves: no pill while the mouse button is still down; the pill above a mouse-drag selection; "Ask in
// side chat" attaches the quote (chip, focus, "Explain this." placeholder) and the wire question is
// `> line…\n\n<text>`; an empty draft sends "Explain this."; the bubble renders the quote as a block;
// "Quote in reply" lands in the composer and appends to a non-empty draft; Copy writes the clipboard
// and flips to Copied; Escape hides; no pill for a selection in the composer or in the side chat; no
// pill on a phone viewport.
import { serveWorktreeFonts } from "./overflow-probe.mjs";
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";

const args = process.argv.slice(2);
const flag = (k, d) => args.find((f) => f.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const dark = args.includes("--dark");
const W = Number(flag("w", 1440));
const H = Number(flag("h", 900));
const phone = W < 500;
const token = process.env.ASB_DEV_TOKEN || "devtoken123";
const base = process.env.ASB_UI || "http://localhost:5173";
const outPrefix = `.shots/r3-select`;

/* ───────────── the box: thread-fixture.mjs `done`, trimmed to the turns this proof selects in ───────────── */
const NAME = "quiet-otter";
const REPO = "acme/orders-api";
const T0 = Date.now() - 14 * 60_000;
const at = (m, s = 0) => `⟦at⟧ ${T0 + m * 60_000 + s * 1000}`;
const TASK = "Replace the fixed-window rate limiter in the orders API with a sliding-window one backed by Redis, keep the public middleware signature, add tests for burst and steady traffic, and open a PR.";
const SIDE_ANSWER = [
  "Six fixed buckets cost one `HINCRBY` and one `HGETALL` per request and expire together, so the hash stays small.",
  "",
  "A sorted set is exact but needs `ZADD` + `ZREMRANGEBYSCORE` + `ZCARD` per request and grows with traffic. For API quotas the bucket error (at most one slice, 10s) is acceptable.",
].join("\n");
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
  "    if (total > limit) return res.status(429).set('Retry-After', String(slice / 1000)).end();",
  "    next();",
  "  };",
  "}",
  "```",
  "",
  "Two things worth your eyes before merging: the limiter fails open on Redis errors, and the Retry-After header is now the bucket size rather than the full window.",
  "",
  "1. **Fail-open on Redis errors** — I chose availability over strictness; flip `FAIL_CLOSED=1` if you prefer the opposite.",
  "2. The `Retry-After` header is now the bucket size (10s), not the full window.",
  "",
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
  at(1, 0),
  "⟦you⟧",
  "Looks good so far. Fail open when Redis is down, and add a Retry-After header.",
  "⟦/you⟧",
  at(1, 4),
  "● session started (model ak-claude-opus-4.8)",
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
const ctx = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: dark ? "dark" : "light", deviceScaleFactor: 1, hasTouch: phone, isMobile: phone, permissions: ["clipboard-read", "clipboard-write"] });
await ctx.addInitScript(
  ([t, d]) => {
    localStorage.setItem("asb-token", t);
    localStorage.setItem("asb-dark", d ? "1" : "0");
    localStorage.removeItem("asb-sidechat:quiet-otter");
  },
  [token, dark]
);
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
page.on("response", (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
const json = (route, body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const asked = [];
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
      return json(route, { messages: [2] });
    case "/models.json":
      return json(route, MODELS);
    case "/skills.json":
      return json(route, { skills: [] });
    case "/tree.json":
      return json(route, { files: TREE, total: TREE.length, truncated: false });
    case "/files.json":
      return json(route, { files: TREE, total: TREE.length, truncated: false });
    case "/git.json":
      return json(route, { repo: "orders-api", branch: "feat/sliding-window-limiter", upstream: "origin/feat/sliding-window-limiter", ahead: 0, behind: 0, lastCommit: "feat: sliding-window rate limiter", clean: false, changed: 2 });
    case "/memory.json":
    case "/resume.json":
    case "/title.json":
    case "/wake.json":
      return json(route, { ok: true });
    case "/ask.json": {
      asked.push(route.request().postDataJSON());
      await new Promise((r) => setTimeout(r, 400));
      return json(route, { answer: SIDE_ANSWER, timedOut: false, continued: true, driverState: "done" });
    }
    case "/me.json":
      return json(route, { kind: "user", mode: "saas", id: "u_1", login: "ak", name: "Arun K", role: "admin", via: "session", email: "ak@example.com", avatarUrl: null, github: true, hasPassword: true, maxBoxes: 8, plan: "trial", trialEndsAt: new Date(Date.now() + 9 * 86400e3).toISOString(), daysLeft: 9, expired: false, billingUrl: null });
    case "/history/outcome.json":
      return json(route, { id: 31, box: NAME, outcome: { v: 1, state: "done", header: { startedBy: { kind: "web" }, label: null, link: null }, result: { prs: [{ url: PR.url, repo: REPO, number: 482 }], diff: { files: 2, additions: 58, deletions: 11 } }, trust: { tests: { runner: "vitest", passed: 25, failed: 0, skipped: 0, source: "trace" }, exitCode: 0, verified: null, prOnly: false, questions: 0, openQuestions: 0, blocked: 0 }, cost: { durationMs: 92_000, tokens: { input: 91320, output: 12880 }, usd: null, model: "ak-claude-opus-4.8" } } });
    default:
      return route.fallback();
  }
});

await page.goto(`${base}/dashboard/box/${NAME}`, { waitUntil: "load", timeout: 30000 }).catch((e) => errors.push("goto: " + e.message));
await page.waitForTimeout(1400);

/* ───────────────────────────── helpers ───────────────────────────── */
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  · ${detail}` : ""}`);
};
const shots = [];
const shot = async (suffix, clip) => {
  const out = `${outPrefix}${suffix}${dark ? "-dark" : ""}-${W}.png`;
  await page.screenshot({ path: out, clip });
  shots.push(out);
};
const pill = () => page.locator("[data-selection-toolbar]");
const conv = () => page.locator('[aria-label="Conversation"]');
const paragraph = (text) => conv().locator(".prose-agent p", { hasText: text }).first();
const sideInput = () => page.locator("#sidechat-input");
const selectedText = () => page.evaluate(() => document.getSelection()?.toString() ?? "");
/** Select a whole paragraph programmatically (fires selectionchange like a keyboard selection would). */
const selectParagraph = async (text) => {
  const p = paragraph(text);
  await p.scrollIntoViewIfNeeded();
  await p.evaluate((el) => document.getSelection().setBaseAndExtent(el, 0, el, el.childNodes.length));
  await page.waitForTimeout(250);
};
const clipAround = async (loc, pad = 24) => {
  const b = await loc.boundingBox();
  return b ? { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: Math.min(W, b.width + pad * 2), height: b.height + pad * 2 } : undefined;
};

if (phone) {
  await selectParagraph("The limiter now keeps");
  check("phone: no pill for a selection", (await pill().count()) === 0, `selected ${JSON.stringify((await selectedText()).slice(0, 30))}`);
  await shot("-phone");
} else {
  /* 1 ─ mouse drag over the first line of the reply; nothing shows until the button is released */
  const target = paragraph("The limiter now keeps");
  await target.scrollIntoViewIfNeeded();
  const line = await target.evaluate((el) => {
    const r = el.getClientRects()[0];
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  // 40px in: the minimap's marker button overlaps the first pixels of the prose column.
  await page.mouse.move(line.x + 40, line.y + line.h / 2);
  await page.mouse.down();
  await page.mouse.move(line.x + 300, line.y + line.h / 2, { steps: 10 });
  await page.waitForTimeout(200);
  check("no pill while the mouse button is still down", (await pill().count()) === 0);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const dragged = await selectedText();
  check("pill after the drag ends", (await pill().count()) === 1, JSON.stringify(dragged));
  const pillBox = await pill().boundingBox();
  const selTop = await page.evaluate(() => document.getSelection().getRangeAt(0).getClientRects()[0].top);
  check("pill sits above the selection's first line", !!pillBox && pillBox.y + pillBox.height <= selTop, `pill bottom ${pillBox ? Math.round(pillBox.y + pillBox.height) : "?"} · line top ${Math.round(selTop)}`);
  await shot("-pill");
  await shot("-pill-zoom", await clipAround(pill(), 40));

  /* 2 ─ Ask in side chat: quote chip, focus, placeholder, the wire question */
  await pill().getByRole("button", { name: "Ask in side chat" }).click();
  await sideInput().waitFor({ state: "visible", timeout: 5000 });
  await page.waitForTimeout(350);
  const chip = page.locator("[data-quote-chip]");
  check("quote chip shows the selection", (await chip.count()) === 1 && (await chip.innerText()).includes(dragged.trim().slice(0, 20)), JSON.stringify(await chip.innerText().catch(() => "")));
  check("focus lands in the side chat input", await page.evaluate(() => document.activeElement?.id) === "sidechat-input");
  check("placeholder reads Explain this.", (await sideInput().getAttribute("placeholder")) === "Explain this.");
  check("the pill is gone once asked", (await pill().count()) === 0);
  await shot("-chip");
  await shot("-chip-zoom", await clipAround(page.locator('aside[aria-label="Side chat"]'), 0));
  await sideInput().type("Why six buckets and not a sorted set?");
  await sideInput().press("Enter");
  await page.locator('aside[aria-label="Side chat"] .prose-agent').first().waitFor({ state: "visible", timeout: 5000 });
  await page.waitForTimeout(400);
  const wire = asked[0]?.question ?? "";
  check("wire question is quote lines, blank line, text", wire === `> ${dragged.trim()}\n\nWhy six buckets and not a sorted set?`, JSON.stringify(wire));
  const bubbleQuote = page.locator("[data-question-quote]");
  check("bubble renders the quote as a block, not > lines", (await bubbleQuote.count()) === 1 && !(await bubbleQuote.innerText()).startsWith(">"));
  check("chip is cleared after asking", (await chip.count()) === 0);
  await shot("-asked");

  /* 3 ─ an empty draft with a quote sends "Explain this." */
  await selectParagraph("Two things worth your eyes");
  check("pill for a programmatic selection while the side chat is open", (await pill().count()) === 1);
  await pill().getByRole("button", { name: "Ask in side chat" }).click();
  await page.waitForTimeout(300);
  await sideInput().press("Enter");
  await page.waitForTimeout(900);
  const wire2 = asked[1]?.question ?? "";
  check("empty draft sends Explain this. under the quote", wire2.startsWith("> Two things worth your eyes") && wire2.endsWith("\n\nExplain this."), JSON.stringify(wire2.slice(-40)));
  await shot("-default");

  /* 4 ─ Quote in reply: into the main composer, appended when a draft exists */
  await selectParagraph("The limiter now keeps");
  await pill().getByRole("button", { name: "Quote in reply" }).click();
  await page.waitForTimeout(250);
  const v1 = await page.locator("#send-input").inputValue();
  check("Quote in reply lands in the composer", v1.startsWith("> The limiter now keeps") && v1.endsWith("\n\n"), JSON.stringify(v1.slice(0, 40)));
  check("composer is focused with the caret at the end", await page.evaluate(() => { const t = document.activeElement; return t?.id === "send-input" && t.selectionStart === t.value.length; }));
  await shot("-quote-reply");
  await page.locator("#send-input").type("Also check the tests.");
  await selectParagraph("Two things worth your eyes");
  await pill().getByRole("button", { name: "Quote in reply" }).click();
  await page.waitForTimeout(250);
  const v2 = await page.locator("#send-input").inputValue();
  check("a second quote appends after the draft", v2.startsWith("> The limiter") && v2.includes("Also check the tests.\n\n> Two things"), JSON.stringify(v2.slice(-60)));
  await shot("-quote-append");

  /* 5 ─ Copy, Escape */
  await selectParagraph("The limiter now keeps");
  const sel = await selectedText();
  await pill().getByRole("button", { name: /Copy/ }).click();
  await page.waitForTimeout(250);
  check("Copy flips to Copied", (await pill().innerText()).includes("Copied"));
  check("Copy wrote the clipboard", (await page.evaluate(() => navigator.clipboard.readText())) === sel);
  check("the selection survives the click", (await selectedText()) === sel);
  await shot("-copied-zoom", await clipAround(pill(), 40));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  check("Escape hides the pill", (await pill().count()) === 0);

  /* 6 ─ no pill for a selection in the composer or in the side chat */
  await page.locator("#send-input").evaluate((el) => {
    el.focus();
    el.select();
  });
  await page.waitForTimeout(300);
  check("no pill for a selection inside the composer", (await pill().count()) === 0, JSON.stringify((await page.evaluate(() => { const t = document.activeElement; return t.value.slice(t.selectionStart, t.selectionEnd); })).slice(0, 30)));
  const sidePara = page.locator('aside[aria-label="Side chat"] .prose-agent p').first();
  await sidePara.evaluate((el) => document.getSelection().setBaseAndExtent(el, 0, el, el.childNodes.length));
  await page.waitForTimeout(300);
  check("no pill for a selection inside the side chat", (await pill().count()) === 0, JSON.stringify((await selectedText()).slice(0, 30)));
  await shot("-negative");

  /* 7 ─ scrolling the conversation moves or hides the pill */
  await selectParagraph("The limiter now keeps");
  const before = await pill().boundingBox();
  // The scroller is the first element under the Conversation root that actually overflows.
  const scrolled = await conv().evaluate((root) => {
    const el = [root, ...root.querySelectorAll("*")].find((n) => n.scrollHeight > n.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(n).overflowY));
    if (!el) return null;
    const from = el.scrollTop;
    el.scrollTop = from - 400;
    return { from, to: el.scrollTop };
  });
  await page.waitForTimeout(200);
  const after = (await pill().count()) ? await pill().boundingBox() : null;
  check("scroll repositions or hides the pill", !!scrolled && scrolled.to !== scrolled.from && (!after || (before && Math.abs(after.y - before.y) > 100)), `scrollTop ${JSON.stringify(scrolled)} · pill y before ${before ? Math.round(before.y) : "none"} · after ${after ? Math.round(after.y) : "none"}`);
}

console.log("shots:", shots.join(" "));
if (errors.length) console.log("page errors:", errors);
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
