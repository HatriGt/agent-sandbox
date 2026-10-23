// Round 6 transcript fixture: the thread reads as one calm column. Tool rows are flat, the
// "Worked for" group is not a bordered card holding bordered cards, and the changes dock's file
// marks are low-chroma. Run from PowerShell:
//
//   node .shots/r6-trace.mjs [--shots] [--tag=after]
//
// Measures, in the done and running scenarios, light and dark, with every fold open (Trace density):
//   · elements inside the conversation column with a visible border (reported, and capped)
//   · the deepest count of bordered ancestors above anything inside a tool step (<= 1)
//   · the chroma of every file mark in the changes dock (<= 0.06)
//   · no page errors
import { serveWorktreeFonts } from "./overflow-probe.mjs";
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";

const args = process.argv.slice(2);
const shots = args.includes("--shots");
const tag = args.find((a) => a.startsWith("--tag="))?.slice(6) ?? "after";
const base = process.env.ASB_UI || "http://localhost:5173";
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? "  " + detail : ""}`); };

/* ───────────── the box: two turns of reads, edits, commands, an external call, a failure ───────────── */
const NAME = "quiet-otter";
const REPO = "acme/orders-api";
const T0 = Date.now() - 14 * 60_000;
const at = (m, s = 0) => `⟦at⟧ ${T0 + m * 60_000 + s * 1000}`;
const TASK = "Replace the fixed-window rate limiter in the orders API with a sliding-window one backed by Redis, keep the public middleware signature, add tests for burst and steady traffic, and open a PR.";
const VITEST = ["RUN  v2.1.3 /workspace/orders-api", "", " ✓ test/rateLimit.test.ts (9 tests) 212ms", " ✓ test/orders.test.ts (14 tests) 488ms", "", " Test Files  2 passed (2)", "      Tests  23 passed (23)", "   Duration  1.42s"];
const ANSWER = ["## Sliding-window limiter is in", "", "The limiter now keeps **six 10-second buckets** per key in a Redis hash. The middleware signature is unchanged.", "", "PR: https://github.com/acme/orders-api/pull/482"];
function log(kind) {
  const L = [at(0), "● session started (model ak-claude-opus-4.8)"];
  L.push(at(0, 4), "⟦think⟧", "The task names the orders API's rate limiter. Read the current implementation and its tests first so the new limiter keeps the same middleware contract.", "⟦/think⟧");
  L.push(at(0, 9), "I'll start by reading how the limiter is wired today, then swap the implementation behind the same signature.");
  L.push(at(0, 12), "→ Read: src/middleware/rateLimit.ts ⟦#r1⟧", at(0, 13), "  ⟦#r1⟧ 1\tconst WINDOW = 60_000;", "  2\texport function rateLimit({ limit }: { limit: number }) {");
  L.push(at(0, 14), "→ Grep: rateLimit( src ⟦#r2⟧", at(0, 14), "  ⟦#r2⟧ src/app.ts:18:app.use('/orders', rateLimit({ limit: 100 }), ordersRouter);");
  L.push(at(0, 15), "→ Glob: test/**/*.test.ts ⟦#r3⟧", at(0, 15), "  ⟦#r3⟧ test/rateLimit.test.ts", "  test/app.test.ts");
  L.push(at(0, 15), "→ Read: test/rateLimit.test.ts ⟦#r4⟧", at(0, 16), "  ⟦#r4⟧ 1\timport { describe, it, expect } from 'vitest';");
  L.push(at(0, 16), "→ Bash: npx vitest run test/rateLimit.test.ts ⟦#b1⟧", at(0, 19), "  ⟦#b1⟧ RUN  v2.1.3 /workspace/orders-api", "  ", "   ✓ test/rateLimit.test.ts (5 tests) 140ms", "  ", "   Test Files  1 passed (1)", "        Tests  5 passed (5)", "     Duration  0.91s");
  L.push(at(0, 22), "The current limiter is a fixed window keyed on the minute. Writing the sliding version now.");
  L.push(at(0, 30), "→ Write: src/middleware/rateLimit.ts ⟦#w1⟧", at(0, 31), "  ⟦#w1⟧ File updated: src/middleware/rateLimit.ts (41 lines)", "⟦diff⟧", "-const WINDOW = 60_000;", "+const BUCKETS = 6;", "+interface Options { limit: number; window?: number }", "⟦/diff⟧");
  L.push(at(0, 40), "→ mcp__redis-dev__execute_command ⟦#m1⟧", at(0, 41), '  ⟦#m1⟧ {"command":"HGETALL rl:10.0.0.4","result":{"172950":"41","172951":"59"},"ms":3}');
  L.push(at(0, 50), "→ Bash: npx vitest run ⟦#b2⟧", at(0, 52), ...VITEST.map((l, i) => (i === 0 ? `  ⟦#b2⟧ ${l}` : `  ${l}`)));
  L.push(at(1, 0), "⟦you⟧", "Looks good so far. Fail open when Redis is down, and add a Retry-After header.", "⟦/you⟧");
  L.push(at(1, 4), "● session started (model ak-claude-opus-4.8)");
  L.push(at(1, 6), "→ Edit: src/middleware/rateLimit.ts ⟦#e2⟧", at(1, 7), "  ⟦#e2⟧ The file src/middleware/rateLimit.ts has been updated.", "⟦diff⟧", "-    if (total > limit) return res.status(429).end();", "+    if (total > limit) return res.status(429).set('Retry-After', String(slice / 1000)).end();", "⟦/diff⟧");
  L.push(at(1, 14), "→ Bash: git checkout -b feat/sliding-window-limiter && git commit -am 'feat: sliding-window rate limiter' && git push -u origin HEAD ⟦#b4⟧", at(1, 20), "  ⟦#b4⟧ Switched to a new branch 'feat/sliding-window-limiter'", "  [feat/sliding-window-limiter 3f9c1a2] feat: sliding-window rate limiter", "   2 files changed, 58 insertions(+), 11 deletions(-)", "  To github.com:acme/orders-api.git", "   * [new branch]      HEAD -> feat/sliding-window-limiter");
  L.push(at(1, 22), "→ Bash: gh pr create --fill ⟦#b5⟧", at(1, 25), "  ⟦#b5⟧ https://github.com/acme/orders-api/pull/482");
  L.push(at(1, 26), "→ Bash: ./scripts/deploy-preview.sh ⟦#b6⟧", at(1, 27), "  ⟦#b6⟧ ⟦err⟧ Exit code 1", "  deploy-preview: DEPLOY_TOKEN is not set", "  Set it in the environment and re-run.");
  L.push(at(1, 30), ...(kind === "running" ? ANSWER.slice(0, 3) : ANSWER));
  return L.join("\n");
}
const CHANGES = [
  { path: "orders-api/src/middleware/rateLimit.ts", repo: "orders-api", status: "modified", additions: 34, deletions: 11 },
  { path: "orders-api/test/rateLimit.test.ts", repo: "orders-api", status: "modified", additions: 24, deletions: 0 },
  { path: "orders-api/docs/rate-limits.md", repo: "orders-api", status: "added", additions: 18, deletions: 0 },
  { path: "orders-api/package.json", repo: "orders-api", status: "modified", additions: 1, deletions: 1 },
];
const PR = { repo: REPO, number: 482, title: "feat: sliding-window rate limiter", state: "open", additions: 58, deletions: 11, changedFiles: 2, head: "feat/sliding-window-limiter", base: "main", author: "agent-sandbox[bot]", url: `https://github.com/${REPO}/pull/482`, mergeable: true, reviewDecision: "review_required", reviewers: [], checks: { total: 3, success: 2, failure: 0, pending: 1 } };
const LIFECYCLE = { idleTimeoutSec: 1800, maxDurationSec: 4 * 3600, capacity: 8, poolSize: 2, sleepTtlSec: 7 * 86400, memoryTiers: ["2G", "4G", "8G"], memoryDefault: "4G" };
const ME = { kind: "user", mode: "saas", id: "u_1", login: "ak", name: "Arun K", role: "admin", via: "session", email: "ak@example.com", avatarUrl: null, github: true, hasPassword: true, maxBoxes: 8, plan: "trial", trialEndsAt: new Date(Date.now() + 9 * 86400e3).toISOString(), daysLeft: 9, expired: false, billingUrl: null };
const boxFor = (s) => ({ name: NAME, role: "session", boxStatus: "running", task: TASK, uptime: "14m", cpu: "12%", mem: "1.1G/4G", lastOutputAt: Date.now() - 4000, title: "Sliding-window rate limiter", repos: [{ name: "orders-api", branch: "feat/sliding-window-limiter" }], agent: "claude", ...(s === "done" ? { runState: "done", exitCode: 0 } : { runState: "running" }) });
const frame = (event, data, id) => `event: ${event}\n${id !== undefined ? `id: ${id}\n` : ""}data: ${JSON.stringify(data)}\n\n`;

async function openThread(browser, scenario, dark) {
  const box = boxFor(scenario);
  const text = log(scenario);
  const { role: _r, ...meta } = box;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: dark ? "dark" : "light", deviceScaleFactor: 1 });
  await ctx.addInitScript((d) => { localStorage.setItem("asb-token", "devtoken123"); localStorage.setItem("asb-dark", d ? "1" : "0"); }, dark);
  await serveWorktreeFonts(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/favicon|net::/.test(m.text()) && errors.push(m.text().slice(0, 160)));
  const json = (route, body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  const bodies = {
    "/auth/config.json": { mode: "saas", providers: ["github"], tokenLogin: true, password: true, signup: true, passwordMin: 10, trialDays: 14, beta: true },
    "/me.json": ME, "/account.json": ME,
    "/fleet.json": { boxes: [box], lifecycle: LIFECYCLE, at: Date.now() }, "/monitor.json": { boxes: [box] },
    "/watch.json": { ...meta, log: text },
    "/changes.json": { files: CHANGES }, "/pr.json": PR, "/inbox.json": { queued: [] },
    "/repos.json": { repos: [{ fullName: REPO, private: true, defaultBranch: "main", logins: ["acme"] }], total: 1 },
    "/secrets.json": { secrets: [] }, "/revert-points.json": { messages: [2] },
    "/models.json": { default: "m", current: "m", models: [{ id: "m", label: "Opus 4.8", tier: "opus" }] },
    "/skills.json": { skills: [] }, "/workflows.json": { limits: {}, dir: "", workflows: [] }, "/triggers/for-box.json": { items: [] },
    "/tree.json": { files: CHANGES.map((f) => f.path), total: CHANGES.length, truncated: false },
    "/git.json": { repo: "orders-api", branch: "feat/sliding-window-limiter", upstream: null, ahead: 0, behind: 0, lastCommit: "feat", clean: false, changed: 3 },
    "/digest.json": { box: NAME, task: TASK, state: scenario, exitCode: 0, startedAt: T0, endedAt: T0 + 92_000, plan: [], files: CHANGES, failedCommands: [], questions: [], usage: null, headline: "" },
  };
  await page.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === "/watch.sse") {
      const body = "retry: 3000\n\n" + frame("snapshot", { meta, log: text, from: 0 }, text.length) + (scenario === "done" ? frame("done", { meta }) : "");
      return route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache" }, body });
    }
    if (u.pathname in bodies) return json(route, bodies[u.pathname]);
    if (u.pathname.endsWith(".json")) return json(route, {});
    return route.fallback();
  });
  await page.goto(`${base}/dashboard/box/${NAME}`, { waitUntil: "load", timeout: 30000 }).catch((e) => errors.push("goto: " + e.message));
  await page.waitForTimeout(1500);
  return { ctx, page, errors };
}

/* ───────────── measurements, in the page ───────────── */
const measure = () => {
  const root = document.querySelector('[aria-label="Conversation"]');
  const alpha = (c) => {
    if (!c || c === "transparent") return 0;
    const slash = c.match(/\/\s*([\d.]+%?)\s*\)$/);
    if (slash) return slash[1].endsWith("%") ? parseFloat(slash[1]) / 100 : parseFloat(slash[1]);
    const rgba = c.match(/^rgba\(([^)]+)\)/);
    if (rgba) return parseFloat(rgba[1].split(",")[3] ?? "1");
    return 1;
  };
  const bordered = (el) => {
    const cs = getComputedStyle(el);
    return ["Top", "Right", "Bottom", "Left"].some((s) => cs[`border${s}Style`] !== "none" && parseFloat(cs[`border${s}Width`]) > 0 && alpha(cs[`border${s}Color`]) > 0);
  };
  const sides = (el) => {
    const cs = getComputedStyle(el);
    return ["Top", "Right", "Bottom", "Left"].filter((s) => cs[`border${s}Style`] !== "none" && parseFloat(cs[`border${s}Width`]) > 0 && alpha(cs[`border${s}Color`]) > 0).length;
  };
  // "boxed": a border on all four sides at surface size, i.e. a card or panel. A hairline on one
  // side is structure, and a 14px glyph ring is a mark, not a box.
  const boxed = (el) => sides(el) === 4 && el.getBoundingClientRect().height >= 24;
  const all = [...root.querySelectorAll("*")];
  const borderedEls = all.filter((el) => sides(el) > 0);
  const boxedEls = all.filter(boxed);
  let steps = [...root.querySelectorAll("[data-step]")];
  if (!steps.length) steps = [...root.querySelectorAll("ol > li")];
  const boxedAbove = (el) => { let d = 0; for (let p = el.parentElement; p && p !== root; p = p.parentElement) if (boxed(p)) d++; return d; };
  let itemDepth = 0;
  let depth = 0;
  let deepest = "";
  for (const s of steps) {
    itemDepth = Math.max(itemDepth, boxedAbove(s));
    for (const el of s.querySelectorAll("*")) {
      const d = boxedAbove(el);
      if (d > depth) { depth = d; deepest = el.tagName.toLowerCase() + "." + [...el.classList].slice(0, 3).join("."); }
    }
  }
  const dock = document.querySelector('[aria-label="Show the changed files"], [aria-label="Hide the changed files"]');
  const marks = dock ? [...dock.querySelectorAll("[data-file-mark], svg:not(.lucide)")] : [];
  const colours = marks.map((m) => (m.tagName.toLowerCase() === "svg" ? getComputedStyle(m.querySelector("path")).fill : getComputedStyle(m).backgroundColor));
  const list = boxedEls.map((el) => el.tagName.toLowerCase() + "." + [...el.classList].slice(0, 4).join(".") + " h" + Math.round(el.getBoundingClientRect().height));
  return { list, bordered: borderedEls.length, boxed: boxedEls.length, itemDepth, depth, deepest, steps: steps.length, workSurface: !!root.querySelector(".work-surface"), marks: colours };
};

/* ───────────── colour → OKLab chroma ───────────── */
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function chromaOf(c) {
  let m;
  if ((m = c.match(/^oklch\(\s*([\d.]+%?)\s+([\d.]+)/))) return parseFloat(m[2]);
  if ((m = c.match(/^oklab\(\s*[\d.]+%?\s+(-?[\d.]+)\s+(-?[\d.]+)/))) return Math.hypot(parseFloat(m[1]), parseFloat(m[2]));
  let rgb;
  if ((m = c.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/))) rgb = [m[1], m[2], m[3]].map(Number);
  else if ((m = c.match(/^rgba?\(([^)]+)\)/))) rgb = m[1].split(/[\s,]+/).slice(0, 3).map((v) => Number(v) / 255);
  else if ((m = c.match(/^#([0-9a-f]{6})$/i))) rgb = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  else return NaN;
  const [r, g, b] = rgb.map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const mm = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * mm + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * mm - 0.808675766 * s;
  return Math.hypot(a, bb);
}

const browser = await chromium.launch();
try {
  for (const scenario of ["done", "running"]) {
    for (const dark of [false, true]) {
      const label = `${scenario} ${dark ? "dark" : "light"}`;
      const { ctx, page, errors } = await openThread(browser, scenario, dark);
      // The transcript arrives over SSE; measure once the first turn is on the page.
      await page.waitForSelector('[aria-label="Conversation"] [data-turn]', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(400);
      const folded = await page.evaluate(measure);
      await page.locator("[data-density]").click();
      await page.waitForTimeout(900);
      const open = await page.evaluate(measure);
      console.log(`${label}: bordered ${folded.bordered} folded / ${open.bordered} open · boxed ${folded.boxed} folded / ${open.boxed} open · steps ${open.steps} · boxed ancestors of a step ${open.itemDepth} · deepest inside a step ${open.depth} (${open.deepest})`);
      if (process.env.ASB_LIST) console.log(open.list.join(" | "));
      check(`${label}: tool steps found with every fold open`, open.steps >= 8, `${open.steps}`);
      check(`${label}: the step list is not a bordered card`, !open.workSurface);
      check(`${label}: no tool step sits inside a boxed surface`, open.itemDepth === 0, `${open.itemDepth}`);
      check(`${label}: nothing inside a tool step sits under more than one boxed surface`, open.depth <= 1, `${open.depth} (${open.deepest})`);
      check(`${label}: at most 24 bordered elements in the open column`, open.bordered <= 24, `${open.bordered}`);
      // What remains boxed is out of this round's scope or marks state: the two you-bubbles, the
      // test results cards, the MCP panel, a viz card, the Resolve row and its input, two buttons.
      check(`${label}: at most 10 boxed surfaces in the open column`, open.boxed <= 10, `${open.boxed}`);
      const chromas = open.marks.map(chromaOf);
      check(`${label}: ${open.marks.length} file marks in the dock, all with chroma <= 0.06`, open.marks.length >= 3 && chromas.every((c) => c <= 0.06), chromas.map((c) => c.toFixed(3)).join(" ") + "  " + open.marks.join(" | "));
      check(`${label}: no page errors`, errors.length === 0, errors.join(" | "));
      if (shots) {
        await page.evaluate(() => document.querySelector('[aria-label="Conversation"] > div')?.scrollTo({ top: 0, behavior: "instant" }));
        await page.waitForTimeout(300);
        await page.screenshot({ path: `.shots/r6/trace-${tag}-${scenario}-${dark ? "dark" : "light"}-open.png` });
      }
      await ctx.close();
    }
  }
} finally { await browser.close(); }
const pass = results.filter((r) => r.ok).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
