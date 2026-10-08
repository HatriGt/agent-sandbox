// Thread fixture + screenshot runner. The local controller has no sandboxes, so every per-box
// endpoint is mocked with page.route() and served from realistic fixtures derived from
// web/src/lib/api.ts and src/trace.ts. Run from PowerShell (bash mangles the leading slashes):
//
//   node .shots/thread-fixture.mjs [scenario] [out-prefix] [--dark] [--w=1440 --h=900] [--full]
//                                  [--stream] [--interact=<name>] [--wait=ms]
//
// scenarios : running (default) · question · done · booting · sleeping · idle
// interact  : scrolled · slash · mention · model · multiline · workspace · minimap · question-kbd
// --stream  : serve /watch.sse from a local server that drips the final answer in over ~6s
//             (screenshot mid-stream) instead of one full snapshot.
//
// Examples:
//   node .shots/thread-fixture.mjs running .shots/thread-running
//   node .shots/thread-fixture.mjs question .shots/thread-q --dark --w=390 --h=844
//   node .shots/thread-fixture.mjs running .shots/thread-slash --interact=slash
import http from "node:http";
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith("--"));
const pos = args.filter((a) => !a.startsWith("--"));
const scenario = pos[0] ?? "running";
const outPrefix = pos[1] ?? `.shots/thread-${scenario}`;
const flag = (k, d) => flags.find((f) => f.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const dark = flags.includes("--dark");
const full = flags.includes("--full");
const stream = flags.includes("--stream");
const W = Number(flag("w", 1440));
const H = Number(flag("h", 900));
const wait = Number(flag("wait", 1400));
const interact = flag("interact", null);
const token = process.env.ASB_DEV_TOKEN || "devtoken123";
const base = process.env.ASB_UI || "http://localhost:5173";

/* ───────────────────────────── the box ───────────────────────────── */
const NAME = "quiet-otter";
const REPO = "acme/orders-api";
const T0 = Date.now() - 14 * 60_000;
const at = (m, s = 0) => `⟦at⟧ ${T0 + m * 60_000 + s * 1000}`;

const TASK = "Replace the fixed-window rate limiter in the orders API with a sliding-window one backed by Redis, keep the public middleware signature, add tests for burst and steady traffic, and open a PR.";

const VITEST = [
  "RUN  v2.1.3 /workspace/orders-api",
  "",
  " ✓ test/rateLimit.test.ts (9 tests) 212ms",
  "   ✓ allows a burst under the limit",
  "   ✓ rejects the request that crosses the limit",
  "   ✓ slides the window instead of resetting it",
  "   ✓ keeps the public middleware signature",
  " ✓ test/orders.test.ts (14 tests) 488ms",
  " ✓ test/health.test.ts (2 tests) 31ms",
  "",
  " Test Files  3 passed (3)",
  "      Tests  25 passed (25)",
  "   Start at  09:14:02",
  "   Duration  1.42s (transform 210ms, setup 0ms, collect 380ms, tests 731ms)",
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
  "    if (total > limit) return res.status(429).set('Retry-After', String(slice / 1000)).end();",
  "    next();",
  "  };",
  "}",
  "```",
  "",
  "| Scenario | Before | After |",
  "| --- | --- | --- |",
  "| 100 req burst at :59 then 100 at :00 | 200 allowed | 100 allowed, 100 rejected |",
  "| Steady 90 req/min | allowed | allowed |",
  "| Redis unavailable | 500 | fails open, logs once |",
  "",
  "Two things worth your eyes:",
  "",
  "1. **Fail-open on Redis errors** — I chose availability over strictness; flip `FAIL_CLOSED=1` if you prefer the opposite.",
  "2. The `Retry-After` header is now the bucket size (10s), not the full window.",
  "",
  "PR: https://github.com/acme/orders-api/pull/482",
];

const QUESTION = [
  "Should the limiter fail open or closed when Redis is unreachable?",
  "",
  "Failing open keeps the API available under an outage but removes protection; failing closed returns 503s until Redis is back.",
  "",
  "Options:",
  "- Fail open (log once, allow traffic)",
  "- Fail closed (503 until Redis returns)",
  "- Fail open, but alert via the ops webhook",
].join("\n");

function log(kind) {
  const L = [];
  L.push(at(0), "● session started (model ak-claude-opus-4.8)");
  L.push(at(0, 4), "⟦think⟧",
    "The task names the orders API's rate limiter. Before changing anything I should read the current implementation and its tests, so the new limiter keeps the same middleware contract. A sliding window can be approximated with N buckets in a Redis hash — cheaper than a sorted set per client and accurate enough for API quotas.",
    "⟦/think⟧");
  L.push(at(0, 9), "I'll start by reading how the limiter is wired today, then swap the implementation behind the same signature.");
  L.push(`⟦plan⟧ ${T0 + 10_000}`, "[x] Read the current limiter and its tests", "[>] Implement a sliding-window limiter on Redis", "[ ] Add burst and steady-traffic tests", "[ ] Open a pull request", "⟦/plan⟧");
  L.push(at(0, 12), "→ Read: src/middleware/rateLimit.ts ⟦#r1⟧", at(0, 13),
    "  ⟦#r1⟧ 1\timport type { NextFunction, Request, Response } from 'express';",
    "  2\timport { redis } from '../lib/redis';",
    "  3\t",
    "  4\tconst WINDOW = 60_000;",
    "  5\t",
    "  6\texport function rateLimit({ limit }: { limit: number }) {",
    "  7\t  return async (req: Request, res: Response, next: NextFunction) => {",
    "  8\t    const key = `rl:${req.ip}:${Math.floor(Date.now() / WINDOW)}`;",
    "  9\t    const n = await redis.incr(key);",
    "  10\t    if (n === 1) await redis.expire(key, 60);",
    "  11\t    if (n > limit) return res.status(429).end();",
    "  12\t    next();",
    "  13\t  };",
    "  14\t}");
  L.push(at(0, 14), "→ Grep: rateLimit( src ⟦#r2⟧", at(0, 14),
    "  ⟦#r2⟧ src/app.ts:18:app.use('/orders', rateLimit({ limit: 100 }), ordersRouter);",
    "  src/app.ts:19:app.use('/health', rateLimit({ limit: 1000 }), healthRouter);");
  L.push(at(0, 16), "→ Bash: npx vitest run test/rateLimit.test.ts ⟦#b1⟧", at(0, 19),
    "  ⟦#b1⟧ RUN  v2.1.3 /workspace/orders-api",
    "  ",
    "   ✓ test/rateLimit.test.ts (5 tests) 140ms",
    "  ",
    "   Test Files  1 passed (1)",
    "        Tests  5 passed (5)",
    "     Duration  0.91s");
  L.push(at(0, 22), "The current limiter is a fixed window keyed on the minute. Five tests cover it; none cover the boundary. Writing the sliding version now.");
  L.push(at(0, 30), "→ Write: src/middleware/rateLimit.ts ⟦#w1⟧", at(0, 31), "  ⟦#w1⟧ File updated: src/middleware/rateLimit.ts (41 lines)",
    "⟦diff⟧",
    "-const WINDOW = 60_000;",
    "+const BUCKETS = 6;",
    "+",
    "+interface Options {",
    "+  limit: number;",
    "+  window?: number;",
    "+}",
    " ",
    "-export function rateLimit({ limit }: { limit: number }) {",
    "+export function rateLimit({ limit, window = 60_000 }: Options) {",
    "+  const slice = window / BUCKETS;",
    "⟦/diff⟧");
  L.push(at(0, 34), "→ Edit: test/rateLimit.test.ts ⟦#e1⟧", at(0, 35), "  ⟦#e1⟧ The file test/rateLimit.test.ts has been updated.",
    "⟦diff⟧",
    "+  it('slides the window instead of resetting it', async () => {",
    "+    await burst(100, at('00:59'));",
    "+    expect(await hit(at('01:00'))).toBe(429);",
    "+  });",
    "⟦/diff⟧");
  L.push(at(0, 40), "→ mcp__redis-dev__execute_command ⟦#m1⟧", at(0, 41),
    '  ⟦#m1⟧ {"command":"HGETALL rl:10.0.0.4","result":{"172950":"41","172951":"59","172952":"12"},"ms":3}');
  L.push(at(0, 50), "→ Bash: npx vitest run ⟦#b2⟧", at(0, 52), ...VITEST.map((l, i) => (i === 0 ? `  ⟦#b2⟧ ${l}` : `  ${l}`)));
  L.push("⟦usage⟧ in=48210 out=6120 ctx=61400");
  if (kind === "question") {
    L.push(at(1, 0), "Before I open the PR there is one behaviour I do not want to guess at.");
    L.push("⟦ask⟧", QUESTION, "⟦/ask⟧");
    return L.join("\n");
  }
  // A follow-up from the operator, answered, then the final turn.
  L.push(at(1, 0), "⟦you⟧", "Looks good so far. Fail open when Redis is down, and add a Retry-After header.", "⟦/you⟧");
  L.push(at(1, 4), "● session started (model ak-claude-opus-4.8)");
  L.push(at(1, 6), "→ Edit: src/middleware/rateLimit.ts ⟦#e2⟧", at(1, 7), "  ⟦#e2⟧ The file src/middleware/rateLimit.ts has been updated.",
    "⟦diff⟧",
    "-    if (total > limit) return res.status(429).end();",
    "+    if (total > limit) return res.status(429).set('Retry-After', String(slice / 1000)).end();",
    "⟦/diff⟧");
  L.push(at(1, 9), "→ Bash: npx vitest run ⟦#b3⟧", at(1, 11), ...VITEST.map((l, i) => (i === 0 ? `  ⟦#b3⟧ ${l}` : `  ${l}`)));
  L.push(at(1, 14), "→ Bash: git checkout -b feat/sliding-window-limiter && git commit -am 'feat: sliding-window rate limiter' && git push -u origin HEAD ⟦#b4⟧", at(1, 20),
    "  ⟦#b4⟧ Switched to a new branch 'feat/sliding-window-limiter'",
    "  [feat/sliding-window-limiter 3f9c1a2] feat: sliding-window rate limiter",
    "   2 files changed, 58 insertions(+), 11 deletions(-)",
    "  remote: Create a pull request for 'feat/sliding-window-limiter' on GitHub by visiting:",
    "  remote:      https://github.com/acme/orders-api/pull/new/feat/sliding-window-limiter",
    "  To github.com:acme/orders-api.git",
    "   * [new branch]      HEAD -> feat/sliding-window-limiter");
  L.push(at(1, 22), "→ Bash: gh pr create --fill ⟦#b5⟧", at(1, 25), "  ⟦#b5⟧ https://github.com/acme/orders-api/pull/482");
  L.push(at(1, 26), "→ Bash: ./scripts/deploy-preview.sh ⟦#b6⟧", at(1, 27),
    "  ⟦#b6⟧ ⟦err⟧ Exit code 1",
    "  deploy-preview: DEPLOY_TOKEN is not set",
    "  Set it in the environment and re-run.");
  L.push(`⟦plan⟧ ${T0 + 85_000}`, "[x] Read the current limiter and its tests", "[x] Implement a sliding-window limiter on Redis", "[x] Add burst and steady-traffic tests", kind === "done" ? "[x] Open a pull request" : "[>] Open a pull request", "⟦/plan⟧");
  L.push(at(1, 30));
  if (kind === "running") {
    // Mid-answer: the client sees a `say` as the last event of a running box → streaming render.
    L.push(...ANSWER.slice(0, 20));
  } else {
    L.push(...ANSWER);
    L.push("⟦usage⟧ in=91320 out=12880 ctx=88200");
  }
  return L.join("\n");
}

const RUNNING = ["running", "question", "done", "idle"].includes(scenario);
const boxFor = (s) => {
  const common = {
    name: NAME,
    role: "session",
    boxStatus: s === "sleeping" ? "stopped" : "running",
    task: s === "idle" ? undefined : TASK,
    uptime: "14m",
    cpu: "12%",
    mem: "1.1G/4G",
    memUsage: { usedMib: 1130, totalMib: 4096 },
    disk: { usedMib: 3800, totalMib: 20480 },
    lastOutputAt: Date.now() - 4000,
    title: s === "idle" ? undefined : "Sliding-window rate limiter",
    repos: [{ name: "orders-api", branch: "feat/sliding-window-limiter" }],
    agent: "claude",
  };
  switch (s) {
    case "question":
      return { ...common, runState: "waiting", question: QUESTION };
    case "done":
      return { ...common, runState: "done", exitCode: 0 };
    case "sleeping":
      return { ...common, runState: "done", exitCode: 0, asleepSec: 3600 * 5 };
    case "booting":
      // A just-claimed box: up, but the run sentinel is not written yet → Thread's "starting" state.
      return { ...common, role: "pool-claimed", runState: "idle", uptime: "8s", lastOutputAt: undefined };
    case "idle":
      return { ...common, runState: "idle" };
    default:
      return { ...common, runState: "running" };
  }
};

const LIFECYCLE = { idleTimeoutSec: 1800, maxDurationSec: 4 * 3600, capacity: 8, poolSize: 2, sleepTtlSec: 7 * 86400, memoryTiers: ["2G", "4G", "8G"], memoryDefault: "4G", diskTiers: ["20G", "40G"] };

const CHANGES = [
  { path: "orders-api/src/middleware/rateLimit.ts", repo: "orders-api", status: "modified", additions: 34, deletions: 11 },
  { path: "orders-api/test/rateLimit.test.ts", repo: "orders-api", status: "modified", additions: 24, deletions: 0 },
  { path: "orders-api/docs/rate-limits.md", repo: "orders-api", status: "added", additions: 18, deletions: 0 },
];

const PR = {
  repo: REPO,
  number: 482,
  title: "feat: sliding-window rate limiter",
  state: "open",
  additions: 58,
  deletions: 11,
  changedFiles: 2,
  head: "feat/sliding-window-limiter",
  base: "main",
  author: "agent-sandbox[bot]",
  url: `https://github.com/${REPO}/pull/482`,
  mergeable: true,
  reviewDecision: "review_required",
  reviewers: [],
  checks: { total: 3, success: 2, failure: 0, pending: 1 },
};

const DIGEST = {
  box: NAME,
  task: TASK,
  state: "done",
  exitCode: 0,
  startedAt: T0,
  endedAt: T0 + 92_000,
  plan: [
    { text: "Read the current limiter and its tests", state: "done" },
    { text: "Implement a sliding-window limiter on Redis", state: "done" },
    { text: "Add burst and steady-traffic tests", state: "done" },
    { text: "Open a pull request", state: "done" },
  ],
  files: CHANGES,
  failedCommands: [],
  questions: [{ question: "Fail open or closed when Redis is unreachable?", answer: "Fail open" }],
  usage: { inputTokens: 91320, outputTokens: 12880, contextTokens: 88200 },
  headline: "Sliding-window limiter shipped behind the same middleware signature; 25 tests green; PR #482 opened.",
};

const SKILLS = {
  skills: [
    { name: "review-pr", description: "Review a pull request for bugs, risk and missing tests.", content: "", enabled: true, addedAt: 1, updatedAt: 1 },
    { name: "write-tests", description: "Add focused tests around a change, run them, and report.", content: "", enabled: true, addedAt: 1, updatedAt: 1 },
    { name: "release-notes", description: "Draft release notes from the commits since the last tag.", content: "", enabled: true, addedAt: 1, updatedAt: 1 },
  ],
};

const MODELS = {
  default: "ak-claude-opus-4.8",
  current: "ak-claude-opus-4.8",
  models: [
    { id: "ak-claude-opus-4.8", label: "Opus 4.8", tier: "opus" },
    { id: "ak-claude-sonnet-4.8", label: "Sonnet 4.8", tier: "sonnet" },
    { id: "ak-claude-haiku-4.5", label: "Haiku 4.5", tier: "haiku" },
  ],
};

const TREE = ["orders-api/src/app.ts", "orders-api/src/middleware/rateLimit.ts", "orders-api/src/lib/redis.ts", "orders-api/test/rateLimit.test.ts", "orders-api/test/orders.test.ts", "orders-api/docs/rate-limits.md", "orders-api/package.json", "orders-api/README.md"];

/* ───────────────────────────── SSE ───────────────────────────── */
const box = boxFor(scenario);
let fullLog = scenario === "booting" || scenario === "idle" ? "" : log(scenario === "sleeping" ? "done" : scenario);
// --cut=<text>: stop the log just before the first line containing <text> (a run caught mid-work:
// mid-thought with --cut=⟦/think⟧, mid-command with --cut=⟦#b1⟧).
const cut = flag("cut", null);
if (cut) {
  const i = fullLog.indexOf(cut);
  if (i >= 0) fullLog = fullLog.slice(0, i).replace(/[^\n]*$/, "");
}
const meta = (() => {
  const { role: _r, ...m } = box;
  return m;
})();
const frame = (event, data, id) => `event: ${event}\n${id !== undefined ? `id: ${id}\n` : ""}data: ${JSON.stringify(data)}\n\n`;

// Optional local streamer: drips the tail of the answer in so the streaming render is real.
let streamer = null;
let streamPort = 0;
if (stream) {
  const cut = fullLog.lastIndexOf("## Sliding-window");
  const head = fullLog.slice(0, cut);
  const tail = fullLog.slice(cut);
  streamer = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", "access-control-allow-origin": "*" });
    res.write("retry: 3000\n\n");
    res.write(frame("snapshot", { meta, log: head, from: 0 }, head.length));
    let i = 0;
    let sent = head.length;
    const tick = () => {
      if (i >= tail.length) return;
      const n = 6 + Math.floor(Math.random() * 14);
      const chunk = tail.slice(i, i + n);
      i += n;
      sent += chunk.length;
      res.write(frame("append", { chunk }, sent));
      setTimeout(tick, 40 + Math.random() * 60);
    };
    // Hold the first delta for a beat longer than any --interact prelude needs (a reader scrolling
    // up before the text arrives), then drip.
    setTimeout(tick, interact === "scrolled" ? 5200 : 600);
    req.on("close", () => {});
  });
  await new Promise((r) => streamer.listen(0, "127.0.0.1", r));
  streamPort = streamer.address().port;
}

/* ───────────────────────────── browser ───────────────────────────── */
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: dark ? "dark" : "light", deviceScaleFactor: 1, hasTouch: W < 500, isMobile: W < 500 });
await ctx.addInitScript(
  ([t, d]) => {
    localStorage.setItem("asb-token", t);
    localStorage.setItem("asb-dark", d ? "1" : "0");
  },
  [token, dark]
);
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
page.on("response", (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));

const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
await page.route("**/*", async (route) => {
  const u = new URL(route.request().url());
  const p = u.pathname;
  switch (p) {
    case "/fleet.json":
      return json(route, { boxes: [box], lifecycle: LIFECYCLE, at: Date.now() });
    case "/monitor.json":
      return json(route, { boxes: [box] });
    case "/watch.json":
      return json(route, { ...meta, log: fullLog });
    case "/watch.sse": {
      if (streamer) return route.continue({ url: `http://127.0.0.1:${streamPort}/watch.sse` });
      const body = "retry: 3000\n\n" + frame("snapshot", { meta, log: fullLog, from: 0 }, fullLog.length) + (RUNNING && box.runState !== "running" && box.runState !== "waiting" ? frame("done", { meta }) : "");
      return route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache" }, body });
    }
    case "/changes.json":
      return json(route, { files: scenario === "booting" || scenario === "idle" ? [] : CHANGES });
    case "/digest.json":
      return json(route, DIGEST);
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
      return json(route, SKILLS);
    case "/tree.json":
      return json(route, { files: TREE, total: TREE.length, truncated: false });
    case "/files.json":
      return json(route, { files: TREE.filter((f) => f.includes(u.searchParams.get("q") ?? "")), total: TREE.length, truncated: false });
    case "/git.json":
      return json(route, { repo: "orders-api", branch: "feat/sliding-window-limiter", upstream: "origin/feat/sliding-window-limiter", ahead: 0, behind: 0, lastCommit: "feat: sliding-window rate limiter", clean: false, changed: 3 });
    case "/artifact":
      return route.fulfill({
        status: 200,
        contentType: "text/plain",
        body: "import type { NextFunction, Request, Response } from 'express';\nimport { redis } from '../lib/redis';\n\nconst BUCKETS = 6;\n\ninterface Options {\n  limit: number;\n  window?: number;\n}\n\nexport function rateLimit({ limit, window = 60_000 }: Options) {\n  const slice = window / BUCKETS;\n  return async (req: Request, res: Response, next: NextFunction) => {\n    const key = `rl:${req.ip}`;\n    const now = Math.floor(Date.now() / slice);\n    const hits = await redis.hincrby(key, String(now), 1);\n    if (hits > limit) return res.status(429).set('Retry-After', String(slice / 1000)).end();\n    next();\n  };\n}\n",
      });
    case "/diff.json":
      return json(route, {
        path: u.searchParams.get("path") ?? CHANGES[0].path,
        untracked: false,
        binary: false,
        original: "const WINDOW = 60_000;\n\nexport function rateLimit({ limit }: { limit: number }) {\n  return async (req, res, next) => {\n    const key = `rl:${req.ip}:${Math.floor(Date.now() / WINDOW)}`;\n    const n = await redis.incr(key);\n    if (n > limit) return res.status(429).end();\n    next();\n  };\n}\n",
        diff: "@@ -1,9 +1,14 @@\n-const WINDOW = 60_000;\n+const BUCKETS = 6;\n+\n+interface Options {\n+  limit: number;\n+  window?: number;\n+}\n \n-export function rateLimit({ limit }: { limit: number }) {\n+export function rateLimit({ limit, window = 60_000 }: Options) {\n+  const slice = window / BUCKETS;\n",
      });
    case "/file.json":
      return json(route, { path: u.searchParams.get("path"), content: "const BUCKETS = 6;\n\ninterface Options {\n  limit: number;\n  window?: number;\n}\n\nexport function rateLimit({ limit, window = 60_000 }: Options) {\n  const slice = window / BUCKETS;\n  return async (req, res, next) => {\n    next();\n  };\n}\n", bytes: 240, mtime: Date.now() });
    case "/memory.json":
      return json(route, { ok: true });
    case "/resume.json":
    case "/title.json":
    case "/wake.json":
      return json(route, { ok: true });
    default:
      return route.continue();
  }
});

await page.goto(`${base}/dashboard/box/${NAME}`, { waitUntil: "load", timeout: 30000 }).catch((e) => errors.push("goto: " + e.message));
await page.waitForTimeout(wait);

const shots = [];
const shot = async (suffix = "") => {
  const out = `${outPrefix}${suffix}${dark ? "-dark" : ""}-${W}.png`;
  await page.screenshot({ path: out, fullPage: full });
  shots.push(out);
};
const input = () => page.locator("#send-input");

if (stream) {
  // Mid-stream frames: catch the answer while it is still arriving. With --interact=scrolled the
  // reader has scrolled up first, so the jump-to-latest pill should grow its "New activity" label.
  if (interact === "scrolled") {
    // A real wheel gesture, so the stick-to-bottom lock releases the way it does for a reader.
    await page.waitForTimeout(2500);
    await page.mouse.move(700, 400);
    for (let i = 0; i < 8; i++) {
      await page.mouse.wheel(0, -200);
      await page.waitForTimeout(120);
    }
    const pos = () => page.evaluate(() => {
      const el = document.querySelector("[aria-label='Conversation'] > div");
      return el ? `${el.scrollTop}/${el.scrollHeight - el.clientHeight}` : "no scroller";
    });
    console.log("scrollTop after wheel:", await pos());
    if (flags.includes("--force-scroll")) {
      await page.evaluate(() => {
        const el = document.querySelector("[aria-label='Conversation'] > div");
        if (el) el.scrollTop -= 700;
      });
      await page.waitForTimeout(1200);
      console.log("scrollTop after forced scroll + 1.2s:", await pos());
    }
  }
  await page.waitForTimeout(1800);
  await shot("-t1");
  await page.waitForTimeout(2200);
  await shot("-t2");
} else if (interact === "pages") {
  // Walk the conversation top → bottom one viewport at a time (the scroller is internal, so
  // fullPage screenshots cannot see it).
  const total = await page.evaluate(() => {
    const el = document.querySelector("[aria-label='Conversation'] > div");
    el?.scrollTo({ top: 0, behavior: "instant" });
    return el ? el.scrollHeight - el.clientHeight : 0;
  });
  const step = H - 220;
  for (let i = 0, top = 0; i < 8; i++, top += step) {
    await page.evaluate((t) => document.querySelector("[aria-label='Conversation'] > div")?.scrollTo({ top: t, behavior: "instant" }), top);
    await page.waitForTimeout(350);
    await shot(`-p${i + 1}`);
    if (top >= total) break;
  }
} else if (interact === "expand") {
  // Everything open, from the top: the reasoning trails' contents.
  await page.getByRole("button", { name: "Expand all" }).click().catch((e) => errors.push("expand: " + e.message));
  await page.waitForTimeout(600);
  await page.evaluate(() => document.querySelector("[aria-label='Conversation'] > div")?.scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForTimeout(400);
  await shot("-expand");
} else if (interact === "scrolled") {
  await page.evaluate(() => {
    const el = document.querySelector("[aria-label='Conversation'] > div");
    el?.scrollTo({ top: 200 });
  });
  await page.waitForTimeout(500);
  await shot("-scrolled");
} else if (interact === "slash") {
  await input().click();
  await input().type("/rev");
  await page.waitForTimeout(500);
  await shot("-slash");
} else if (interact === "mention") {
  await input().click();
  await input().type("Please look at @rate");
  await page.waitForTimeout(600);
  await shot("-mention");
} else if (interact === "model") {
  // The model lives behind the composer's Settings control: open it, unfold the Model row.
  await page.locator("button[aria-label^='Run settings']").click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: /^Model/ }).click();
  await page.waitForTimeout(400);
  await shot("-model");
  // Pick Haiku → the panel closes and the off-default model shows as a chip above the text.
  await page.locator("[role=radiogroup][aria-label='Model'] [role=radio]", { hasText: "Haiku" }).click();
  await page.locator("button[aria-label='Close']").click();
  await page.waitForTimeout(400);
  await shot("-model-chip");
} else if (interact === "multiline") {
  await input().click();
  for (let i = 1; i <= 10; i++) {
    await input().type(`Line ${i}: also check the retry header on the burst path and keep the middleware signature identical.`);
    if (i < 10) await input().press("Shift+Enter");
  }
  await page.waitForTimeout(300);
  await shot("-multiline");
} else if (interact === "workspace") {
  await page.getByRole("button", { name: /files|workspace/i }).first().click();
  await page.waitForTimeout(1500);
  await shot("-workspace");
} else if (interact === "minimap") {
  await page.mouse.move(W - 20, H / 2);
  await page.waitForTimeout(500);
  await shot("-minimap");
} else if (interact === "question-kbd") {
  await page.keyboard.press("2");
  await page.waitForTimeout(300);
  await shot("-question-kbd");
} else if (interact === "resolve") {
  // The failed `deploy-preview.sh` call: its Resolve row ("Provide DEPLOY_TOKEN") under the terminal panel.
  await page.locator("[data-resolve-row]").first().scrollIntoViewIfNeeded().catch((e) => errors.push("resolve: " + e.message));
  await page.waitForTimeout(500);
  await shot("-resolve");
} else {
  await shot();
}

console.log("saved", shots.join(", "));
if (errors.length) console.log("console errors:\n" + errors.slice(0, 12).join("\n"));
await browser.close();
streamer?.close();
