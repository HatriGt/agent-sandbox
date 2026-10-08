// Shell/Hub/settings fixture: renders the dashboard against MOCKED controller data so the shell can be
// seen with running/sleeping machines, the Hub with recent runs, History with rows, Admin with users.
//
//   node .shots/shell-fixture.mjs <route> <out.png> [width] [height] [flags]
//
// Flags:
//   --full            full-page screenshot
//   --dark            dark theme (sets the app's own localStorage flag, not just prefers-color-scheme)
//   --offline         do NOT mock /fleet.json + /monitor.json (see the "Can't reach the fleet" state)
//   --stale           fleet succeeds once, then fails (the "Connection lost — showing last snapshot" state)
//   --operator        token-mode operator identity instead of a saas admin user
//   --collapsed       sidebar collapsed
//   --empty           no machines, no history, no session runs (first-run Hub)
//   --waiting         one machine halted on a question (attention states)
//   --click="css"     click a selector before the shot
//   --key="Control+k" press a key chord before the shot (after --click)
//   --type="text"     type into the focused element (after --key)
//   --hover="css"     hover a selector before the shot
//   --wait=ms         settle time before the shot (default 1200)
//   --scroll="css"    scroll a container to its bottom before the shot
//
// Run from PowerShell (bash mangles the leading slash of the route).
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";

const [route = "/dashboard", out = ".shots/out.png", w = "1440", h = "900", ...flags] = process.argv.slice(2);
const has = (f) => flags.includes(f);
const val = (k) => flags.find((f) => f.startsWith(`--${k}=`))?.slice(k.length + 3);
const full = has("--full");
const dark = has("--dark");
const wait = Number(val("wait") ?? 1200);
const token = process.env.ASB_DEV_TOKEN || "devtoken123";
const base = process.env.ASB_UI || "http://localhost:5173";

const now = Math.floor(Date.now() / 1000);
const ms = Date.now();

const boxes = has("--empty")
  ? []
  : [
      ...(has("--waiting")
        ? [
            {
              name: "asb-session-7f3a2c1d",
              role: "session",
              boxStatus: "Running",
              runState: "waiting",
              task: "Migrate the billing webhooks to the new Stripe API version and add retries",
              question: "The webhook secret in .env.example is a placeholder. Should I read it from STRIPE_WEBHOOK_SECRET or keep the file-based config?",
              uptime: "14m",
              cpu: "3%",
              mem: "812MiB / 4GiB",
              lastOutputAt: now - 95,
              title: "Stripe webhook migration",
              repos: [{ name: "billing", branch: "main" }],
              agent: "claude",
            },
          ]
        : []),
      {
        name: "asb-session-a91b0e44",
        role: "session",
        boxStatus: "Running",
        runState: "running",
        task: "Explain how the auth middleware works and write an ARCHITECTURE.md for it",
        uptime: "6m",
        cpu: "41%",
        mem: "1.4GiB / 4GiB",
        memUsage: { usedMib: 1433, totalMib: 4096 },
        lastOutputAt: now - 4,
        title: "Auth middleware walkthrough",
        repos: [{ name: "agent-sandbox", branch: "main" }],
        agent: "claude",
        workflow: { id: "w2", name: "Fix flaky test", line: "Fix flaky test · step 1/2", state: "running", step: 1, total: 2, history: [] },
      },
      {
        name: "asb-pool-c22de9f1",
        role: "pool-claimed",
        boxStatus: "Running",
        runState: "running",
        task: "Run the test suite and fix the two flaky integration tests in test/mcp-probe.test.ts",
        uptime: "2m",
        cpu: "88%",
        mem: "2.1GiB / 4GiB",
        lastOutputAt: now - 1,
        title: "Fix flaky MCP probe tests",
        repos: [{ name: "agent-sandbox", branch: "fix/flaky-probe" }],
        agent: "claude",
      },
      {
        name: "asb-session-5510beef",
        role: "session",
        boxStatus: "Running",
        runState: "done",
        exitCode: 0,
        task: "Open a PR that bumps Vite to 6 and fixes the resulting type errors",
        uptime: "31m",
        cpu: "0%",
        mem: "640MiB / 4GiB",
        lastOutputAt: now - 1260,
        title: "Bump Vite to 6",
        repos: [{ name: "web-console", branch: "chore/vite-6" }],
        agent: "claude",
      },
      {
        name: "asb-session-0d0d1e2f",
        role: "session",
        boxStatus: "Stopped",
        runState: "done",
        exitCode: 0,
        task: "Review PR #142 and leave line comments on anything risky",
        uptime: "48m",
        lastOutputAt: now - 7200,
        title: "Review PR #142",
        asleepSec: 3600,
        kept: true,
        agent: "claude",
      },
      {
        name: "asb-session-e7e7a0b9",
        role: "session",
        boxStatus: "Stopped",
        runState: "done",
        exitCode: 1,
        task: "TDD a rate limiter for the /delegate endpoint",
        uptime: "12m",
        lastOutputAt: now - 20000,
        title: "Rate limiter (TDD)",
        asleepSec: 15000,
        agent: "claude",
      },
      { name: "asb-pool-ffee0011", role: "pool-free", boxStatus: "Running", runState: "idle", uptime: "1h 2m", cpu: "0%", mem: "310MiB / 4GiB" },
    ];

const fleet = {
  boxes,
  lifecycle: { capacity: 8, poolSize: 1, idleTimeoutSec: 900, maxDurationSec: 7200, sleepTtlSec: 86400, memoryTiers: ["2G", "4G", "8G"], memoryDefault: "4G" },
  at: ms,
};

const me = has("--operator")
  ? { kind: "operator", mode: "token", role: "admin" }
  : {
      kind: "user",
      mode: "saas",
      id: "u_1",
      login: "ak",
      name: "Arun K",
      role: "admin",
      via: "session",
      email: "ak@example.com",
      avatarUrl: null,
      github: true,
      hasPassword: true,
      maxBoxes: 8,
      plan: "trial",
      trialEndsAt: new Date(ms + 9 * 86400e3).toISOString(),
      daysLeft: 9,
      expired: false,
      billingUrl: null,
    };

const iso = (ago) => new Date(ms - ago * 1000).toISOString();
const users = {
  users: [
    { id: "u_1", login: "ak", email: "ak@example.com", role: "admin", maxBoxes: 8, createdAt: iso(86400 * 40), lastSeenAt: iso(30), github: true, keys: 2, boxes: 3, name: "Arun K", plan: "trial", trialEndsAt: iso(-9 * 86400), daysLeft: 9, expired: false },
    { id: "u_2", login: "neo", email: null, role: "user", maxBoxes: 2, createdAt: iso(86400 * 12), lastSeenAt: iso(3600 * 5), github: false, keys: 1, boxes: 1, name: null, plan: "pro", trialEndsAt: null, daysLeft: null, expired: false },
    { id: "u_3", login: "trinity", email: "t@zion.io", role: "user", maxBoxes: 2, createdAt: iso(86400 * 3), lastSeenAt: null, github: true, keys: 0, boxes: 0, name: "Trinity", plan: "trial", trialEndsAt: iso(-1 * 86400), daysLeft: 1, expired: false },
    { id: "u_4", login: "cypher", email: null, role: "user", maxBoxes: 2, createdAt: iso(86400 * 30), lastSeenAt: iso(86400 * 20), github: false, keys: 0, boxes: 0, name: null, plan: "trial", trialEndsAt: iso(86400 * 16), daysLeft: 0, expired: true },
  ],
};
const apiKeys = {
  keys: [
    { id: "k_1", name: "Cursor on laptop", prefix: "asb_9f2k", created_at: iso(86400 * 10), last_used_at: iso(600), revoked_at: null },
    { id: "k_2", name: "CI (GitHub Actions)", prefix: "asb_ab12", created_at: iso(86400 * 30), last_used_at: null, revoked_at: null },
  ],
};
const sessions = {
  sessions: [
    { id: "s_1", current: true, createdAt: iso(86400 * 2), lastSeenAt: iso(5), ip: "203.0.113.4", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130" },
    { id: "s_2", current: false, createdAt: iso(86400 * 9), lastSeenAt: iso(3600 * 26), ip: "198.51.100.7", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/605.1" },
  ],
};
const audit = {
  events: [
    { id: 9, at: iso(120), method: "POST", path: "/delegate", status: 200, session: "asb-pool-c22de9f1", action: "delegate", client: "web" },
    { id: 8, at: iso(900), method: "POST", path: "/reply", status: 200, session: "asb-session-a91b0e44", action: "reply", client: "web" },
    { id: 7, at: iso(3600), method: "DELETE", path: "/api-keys.json", status: 200, session: null, action: "apikey.revoke", client: "web" },
    { id: 6, at: iso(7200), method: "POST", path: "/delegate", status: 200, session: "asb-session-5510beef", action: "delegate", client: "mcp" },
    { id: 5, at: iso(86400), method: "POST", path: "/destroy", status: 200, session: "asb-session-dead0001", action: "destroy", client: "web" },
  ],
};
const history = has("--empty")
  ? { runs: [] }
  : {
      runs: [
        { id: 31, box: "asb-session-dead0001", owner: "ak", task: "Add dark mode to the marketing site", state: "done", exitCode: 0, startedAt: ms - 86400e3, endedAt: ms - 86400e3 + 1500e3, archivedAt: ms - 86400e3 + 1600e3, headline: "Added a theme toggle and dark palette; PR #88 opened." },
        { id: 30, box: "asb-session-dead0002", owner: "ak", task: "Find why the nightly build is slow", state: "failed", exitCode: 1, startedAt: ms - 2 * 86400e3, endedAt: ms - 2 * 86400e3 + 800e3, archivedAt: ms - 2 * 86400e3 + 900e3, headline: "Could not reproduce: the CI runner has no cache mounted." },
        { id: 29, box: "asb-session-dead0003", owner: "neo", task: "Write integration tests for the webhook receiver", state: "done", exitCode: 0, startedAt: ms - 3 * 86400e3, endedAt: ms - 3 * 86400e3 + 2400e3, archivedAt: ms - 3 * 86400e3 + 2500e3, headline: "12 tests added, all green." },
        { id: 28, box: "asb-session-dead0004", owner: "ak", task: "Explain the deploy pipeline", state: "done", exitCode: 0, startedAt: ms - 6 * 86400e3, endedAt: ms - 6 * 86400e3 + 300e3, archivedAt: ms - 6 * 86400e3 + 400e3, headline: "Wrote docs/deploy.md with a diagram of the three stages." },
      ],
    };
const activity = { runs: Array.from({ length: 40 }, (_, i) => ({ t: ms - i * 3.7 * 3600e3, failed: i % 7 === 0 })) };
const accounts = { accounts: [{ login: "HatriGt", type: "fine-grained", orgs: ["hatrigt-atom"], verifiedRepos: ["HatriGt/agent-sandbox", "HatriGt/web-console"], tokenHint: "github_pat_…Qx9", isDefault: true }], oauth: true };
const notify = { url: "", events: { waiting: true, done: true, failed: true }, fallbackConfigured: true };
const agentPrefs = { defaultAgent: "claude", agents: [{ id: "claude", label: "Claude Code" }, { id: "omp", label: "oh-my-pi" }] };
const models = { models: [{ id: "claude-sonnet-4-5", label: "Sonnet 4.5" }, { id: "claude-opus-4-1", label: "Opus 4.1" }], default: "claude-sonnet-4-5" };
const repos = { repos: [
  { fullName: "HatriGt/agent-sandbox", private: false, defaultBranch: "main", pushedAt: iso(3600), logins: ["HatriGt"], description: "Ephemeral microVMs for coding agents" },
  { fullName: "HatriGt/web-console", private: true, defaultBranch: "main", pushedAt: iso(86400), logins: ["HatriGt"] },
  { fullName: "hatrigt-atom/billing", private: true, defaultBranch: "develop", pushedAt: iso(86400 * 3), logins: ["HatriGt"] },
] };
const skills = { skills: [] };
const mcp = { servers: [], config: { mcpServers: {} } };
const harnesses = {
  harnesses: [
    { id: "h_best", name: "Best practice", description: "Plan first, test before PR, strict egress.", builtin: "best-practice", rules: {}, createdAt: ms - 9e8, updatedAt: ms - 9e8 },
    { id: "h_review", name: "Careful reviewer", description: "Read-only review with line comments; never pushes.", builtin: "reviewer", rules: {}, createdAt: ms - 9e8, updatedAt: ms - 9e8 },
    { id: "h_mine", name: "Billing service", description: "Sonnet, /write-tests skill, allowlisted Stripe egress.", rules: {}, model: "claude-sonnet-4-5", createdAt: ms - 8e7, updatedAt: ms - 7e7 },
    { id: "h_import", name: "Imported from gist", description: "Needs a look before it can run.", needsReview: true, rules: {}, createdAt: ms - 1e7, updatedAt: ms - 1e7 },
  ],
  limits: {},
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, colorScheme: dark ? "dark" : "light", deviceScaleFactor: 1, reducedMotion: has("--os-reduced") ? "reduce" : "no-preference" });
if (val("motion")) await ctx.addInitScript((m) => localStorage.setItem("asb.motion", m), val("motion"));
await ctx.addInitScript(
  ({ t, dark, collapsed, empty }) => {
    localStorage.setItem("asb-token", t);
    localStorage.setItem("asb-dark", dark ? "1" : "0");
    localStorage.setItem("asb-collapsed", collapsed ? "1" : "0");
    if (!empty) localStorage.setItem("asb-hub-howto-done", "1");
    else localStorage.removeItem("asb-hub-howto-done");
    if (!empty)
      sessionStorage.setItem(
        "asb-session-runs",
        JSON.stringify([
          { box: "asb-pool-c22de9f1", task: "Run the test suite and fix the two flaky integration tests", startedAt: Date.now() - 120e3 },
          { box: "asb-session-a91b0e44", task: "Explain how the auth middleware works", startedAt: Date.now() - 400e3 },
          { box: "asb-session-gone0000", task: "Rename the User model to Account across the codebase", startedAt: Date.now() - 9000e3 },
        ])
      );
  },
  { t: token, dark, collapsed: has("--collapsed"), empty: has("--empty") }
);

let fleetCalls = 0;
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const mock = (path, body) => ctx.route((u) => new URL(u).pathname === path, (r) => (r.request().method() === "GET" ? r.fulfill(json(body)) : r.fulfill(json({ ok: true }))));

if (!has("--offline")) {
  await ctx.route((u) => new URL(u).pathname === "/fleet.json", (r) => {
    fleetCalls++;
    // Call 1 is the auth bootstrap, call 2 the first poll; every later poll fails.
    if (has("--stale") && fleetCalls > 2) return r.fulfill(json({ error: "msb ls failed (exit 255): Host key verification failed." }, 500));
    return r.fulfill(json(fleet));
  });
  await mock("/monitor.json", boxes);
}
await mock("/auth/config.json", { mode: has("--operator") ? "token" : "saas", providers: ["github"], tokenLogin: true, password: true, signup: true, passwordMin: 10, trialDays: 14, beta: true });
await mock("/me.json", me);
await mock("/users.json", users);
await mock("/api-keys.json", apiKeys);
await mock("/sessions.json", sessions);
await mock("/audit.json", audit);
await mock("/account.json", me);
await mock("/accounts.json", accounts);
await mock("/notify.json", notify);
await mock("/agent-prefs.json", agentPrefs);
await mock("/models.json", models);
await mock("/history.json", history);
await mock("/history/ledger.json", {
  totals: { runs: history.runs.length, done: history.runs.filter((r) => r.state === "done").length, failed: history.runs.filter((r) => r.state === "failed").length, checked: 2, passed: 2, inputTokens: 412_300, outputTokens: 58_900, withUsage: 3, costUsd: null, withCost: 0 },
  rows: history.runs.map((r, i) => ({ ...r, startedBy: i % 2 ? "web" : "schedule", agent: "claude", verified: i < 2 ? true : null, inputTokens: 100_000, outputTokens: 15_000, costUsd: i === 0 ? 0.42 : null, planDone: i === 0 ? 3 : null, planTotal: i === 0 ? 3 : null, workflowId: i === 1 ? "w1" : null })),
});
await mock("/history/activity.json", activity);
await mock("/repos.json", repos);
await mock("/skills.json", skills);
await mock("/mcp-servers.json", mcp);
await mock("/harnesses.json", harnesses);
await mock("/providers.json", { providers: [] });
await mock("/repo-setup.json", { profiles: [
  { repo: "hatrigt/agent-sandbox", updatedAt: ms - 3e6, profile: { v: 1, install: "npm ci", test: "npm test", runtimes: { node: "22" }, envVars: ["DEPLOY_TOKEN", "SENTRY_DSN"], detectedAt: ms - 9e6, confirmedBy: "agent" } },
  { repo: "hatrigt-atom/billing", updatedAt: ms - 8e7, profile: { v: 1, install: "pnpm i", test: "pnpm test", runtimes: { node: "20" }, envVars: ["STRIPE_KEY"], detectedAt: ms - 9e7, confirmedBy: "detected" } },
] });
await mock("/secrets.json", { secrets: [
  { name: "DEPLOY_TOKEN", createdAt: ms - 9e8, updatedAt: ms - 3e6, grantedTo: [{ kind: "harness", id: "h_mine", label: "Billing service" }, { kind: "repo", id: "hatrigt/agent-sandbox", label: "hatrigt/agent-sandbox" }] },
  { name: "STRIPE_KEY", createdAt: ms - 5e8, updatedAt: ms - 8e7, grantedTo: [{ kind: "repo", id: "hatrigt-atom/billing", label: "hatrigt-atom/billing" }] },
  { name: "NPM_TOKEN", createdAt: ms - 2e8, updatedAt: ms - 2e8, grantedTo: [] },
] });
const T0 = Date.now();
const trig = (o) => ({ repos: [], taskTemplate: "", enabled: true, prComment: false, spec: {}, scope: "automation", status: "waiting", lastFired: null, nextFire: null, lastResult: null, hasPayload: false, active: 0, createdAt: T0 - 9e8, updatedAt: T0 - 9e6, ...o });
const triggers = [
  trig({ id: "t1", name: "Review new PRs on elseco-deal-service", kind: "github", when: "pull request opened on atom-insurance/elseco-deal-service", spec: { event: "pr_opened" }, repos: ["atom-insurance/elseco-deal-service"], prComment: true, lastFired: T0 - 3.6e6, lastResult: { at: T0 - 3.6e6, outcome: "started", box: "asb-pool-c22de9f1", finished: { state: "done", headline: "Approved, 2 low findings" } } }),
  trig({ id: "t2", name: "Nightly dependency audit", kind: "schedule", when: "Weekdays 02:00 (Europe/Berlin)", spec: { cron: "0 2 * * 1-5" }, nextFire: T0 + 5.4e7, quiet: true, counts: { checked: 12, reports: 1 }, lastFired: T0 - 3e7, lastResult: { at: T0 - 3e7, outcome: "started", finished: { state: "done", headline: "nothing new" } } }),
  trig({ id: "t3", name: "Sentry → triage", kind: "webhook", when: "webhook (sentry)", spec: { preset: "sentry" }, enabled: false, status: "paused", lastFired: T0 - 2e8, lastResult: { at: T0 - 2e8, outcome: "failed", reason: "box limit" } }),
  trig({ id: "t4", name: "Flaky test sweeper", kind: "schedule", when: "Sundays 06:00 UTC", proposed: true, enabled: false, status: "needs-ok" }),
  trig({ id: "s1", name: "Re-run the migration check", kind: "schedule", scope: "scheduled", when: "once, tomorrow 09:00", spec: { at: T0 + 8e7 }, nextFire: T0 + 8e7, sourceBox: "asb-session-a91b0e44", sourceTitle: "Auth middleware docs", repos: ["acme/api"], taskTemplate: "Re-run the migration check and report" }),
  trig({ id: "s2", name: "Watch deploy health", kind: "schedule", scope: "scheduled", when: "every hour", status: "running", nextFire: T0 + 2e6, sourceBox: "asb-pool-c22de9f1", taskTemplate: "Check /healthz and error rate" }),
  trig({ id: "s3", name: "Ping on PR merge", kind: "schedule", scope: "scheduled", when: "once", status: "done", lastFired: T0 - 5e6, taskTemplate: "Tell me when #142 merges" }),
];
await mock("/triggers.json", { triggers });
const deliveries = [0, 1, 2, 3, 4].map((i) => ({ id: 100 - i, at: T0 - i * 7.2e6, outcome: i === 3 ? "skipped" : i === 4 ? "failed" : "fired", reason: i === 3 ? "dedupe" : i === 4 ? "error" : undefined, box: i < 3 ? `asb-pool-${i}abc` : undefined, facts: { v: 1, subject: { kind: "pr", number: 210 - i, repo: "atom-insurance/elseco-deal-service", url: "https://github.com/x", title: ["Add deal pricing cache", "Fix broker lookup", "Bump deps", "Refactor quotes", "Docs"][i] }, state: i === 0 ? "running" : "done", review: i ? { verdict: i === 2 ? "needs-work" : "approve", findings: { high: i === 2 ? 1 : 0, medium: 1, low: 2, info: 0 }, blocking: i === 2 ? 1 : 0 } : null, receiptUrl: i && i < 3 ? "https://github.com/x#c" : undefined, durationMs: i ? 90_000 * i : null } }));
await ctx.route((u) => /^\/triggers\/[^/]+\/deliveries\.json$/.test(new URL(u).pathname), (r) => r.fulfill(json({ deliveries })));
await mock("/workflows.json", { limits: {}, dir: ".agent-sandbox/workflows", workflows: [
  { id: "w1", name: "Review a PR", description: "Read the diff, run tests, comment", steps: [{ kind: "agent", prompt: "Review" }, { kind: "check", command: "npm test", retry: 1 }], origin: { kind: "manual" }, createdAt: T0 - 9e8, updatedAt: T0 - 9e6 },
  { id: "w2", name: "Fix flaky test", steps: [{ kind: "agent", prompt: "Fix" }], origin: { kind: "repo", repo: "acme/api", path: ".agent-sandbox/workflows/flaky.yaml" }, createdAt: T0 - 9e8, updatedAt: T0 - 9e6 },
] });
await ctx.route((u) => new URL(u).pathname === "/watch.json", (r) =>
  r.fulfill(json({ name: "x", boxStatus: "Running", runState: "running", log: "" }))
);

const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
const target = route === "/dashboard" ? "/dashboard/" : route;
await page.goto(base + target, { waitUntil: "load", timeout: 20000 }).catch((e) => errors.push("goto: " + e.message));
await page.waitForTimeout(600);
if (has("--stale")) {
  // Force a second poll quickly: the app polls on an interval, so nudge by waiting for it.
  await page.waitForTimeout(Math.max(wait, 6500));
}
const hover = val("hover");
if (hover) await page.hover(hover).catch((e) => errors.push("hover: " + e.message));
// `--click="a;;b;;c"` clicks several selectors in order (a flow: open a panel, pick a row, …).
const click = val("click");
for (const sel of click ? click.split(";;") : []) {
  await page.click(sel).catch((e) => errors.push("click: " + e.message));
  await page.waitForTimeout(250);
}
// `--scroll="css"` scrolls an inner scroller to its bottom (pages scroll inside the pane, not the window).
const scroll = val("scroll");
if (scroll) {
  await page.evaluate((sel) => document.querySelector(sel)?.scrollTo(0, 1e6), scroll).catch((e) => errors.push("scroll: " + e.message));
  await page.waitForTimeout(400);
}
// `--to="css"` brings an element to the top of its scroller (a settings section: `[aria-labelledby='<id>-h']`).
const to = val("to");
if (to) {
  await page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ block: "start", behavior: "instant" }), to).catch((e) => errors.push("to: " + e.message));
  await page.waitForTimeout(400);
}
const key = val("key");
if (key) await page.keyboard.press(key).catch((e) => errors.push("key: " + e.message));
const type = val("type");
if (type) await page.keyboard.type(type, { delay: 20 }).catch((e) => errors.push("type: " + e.message));
await page.waitForTimeout(wait);
if (has("--drag")) {
  const h = page.locator("th .dt-resize").first();
  const b = await h.boundingBox();
  const before = await page.evaluate(() => document.querySelector("th").getBoundingClientRect().width);
  await page.mouse.move(b.x + 4, b.y + 10); await page.mouse.down(); await page.mouse.move(b.x + 124, b.y + 10, { steps: 6 }); await page.mouse.up();
  await page.waitForTimeout(300);
  console.log("drag:", before, "->", await page.evaluate(() => document.querySelector("th").getBoundingClientRect().width), await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("asb.cols")).map((k) => k + "=" + localStorage.getItem(k)).join(" ")));
  console.log("cols:", await page.evaluate(() => [...document.querySelectorAll("col")].map((c) => `${c.dataset.col}:${Math.round(c.getBoundingClientRect().width)}${c.style.width ? "(" + c.style.width + ")" : ""}`).join(" ")));
}
if (has("--clip")) console.log("clip:", await page.evaluate(() => [...document.querySelectorAll("[data-slot=table] th")].filter((h) => h.offsetParent && h.innerText.trim()).map((h) => { const s = getComputedStyle(h); const box = h.getBoundingClientRect(); const avail = box.right - parseFloat(s.paddingRight); const r = document.createRange(); const label = h.querySelector("button") ?? h.firstChild; r.selectNodeContents(label); const rects = [...r.getClientRects()]; const right = rects.length ? Math.max(...rects.map((x) => x.right)) : 0; return `${h.innerText.trim()}:${Math.round(box.width)}${right > avail + 0.5 ? " CLIPPED(" + Math.round(right - avail) + ")" : ""}`; }).join("  ")));
if (has("--tbl")) console.log("tbl:", await page.evaluate(() => [...document.querySelectorAll("[data-slot=table]")].map((t) => { const s = getComputedStyle(t); return `w=${Math.round(t.getBoundingClientRect().width)} layout=${s.tableLayout} minW=${s.minWidth} styleMin=${t.style.minWidth} parent=${Math.round(t.parentElement.getBoundingClientRect().width)} cols=${[...t.querySelectorAll("col")].map((c) => getComputedStyle(c).display + ":" + getComputedStyle(c).width).join(",")}`; }).join("\n")));
if (has("--rows")) console.log("rows:", await page.evaluate(() => [...document.querySelectorAll("[data-slot=table]")].map((t) => `${t.getAttribute("aria-label")}: head=${[...t.querySelectorAll("th")].map((h) => h.innerText.trim()).join("|")} body=${t.querySelectorAll("tbody tr").length} clickable=${t.querySelectorAll("tbody tr[data-clickable]").length}\n  ` + [...t.querySelectorAll("tbody tr")].map((r) => r.innerText.replace(/\s+/g, " ").slice(0, 70)).join("\n  ")).join("\n")));
if (has("--anim")) console.log("anim:", await page.evaluate(() => [...document.querySelectorAll("[data-slot=table-row][data-enter],[data-slot=table-row][data-new]")].slice(0, 6).map((r) => `${r.dataset.enter ?? "new"} i=${r.style.getPropertyValue("--i")} ${getComputedStyle(r).animationName} ${getComputedStyle(r).animationDelay} op=${(+getComputedStyle(r).opacity).toFixed(2)}`).join("\n  ") + "\n  pings=" + document.querySelectorAll(".dt-ping").length));
if (has("--shim")) console.log("shim:", await page.evaluate(() => [...document.querySelectorAll(".shimmer-text")].slice(0, 4).map((e) => { const s = getComputedStyle(e); return `${e.textContent} ${s.animationName} ${s.animationDuration} pos=${s.backgroundPosition} size=${s.backgroundSize} img=${s.backgroundImage.slice(0, 90)}`; }).join("\n  ")));
if (has("--probe")) console.log("probe:", await page.evaluate(() => ({ toasts: [...document.querySelectorAll("[data-attention-toast]")].map((t) => t.innerText.replace(/\s+/g, " ")), status: document.querySelector("[aria-label=Status]")?.innerText.replace(/\s+/g, " "), palette: [...document.querySelectorAll("dialog[open] [role=option], dialog[open] .label")].map((e) => e.innerText.replace(/\s+/g, " ")).join(" | "), footer: document.querySelector("dialog[open] .border-t:last-child")?.innerText.replace(/\s+/g, " ") })));
await page.screenshot({ path: out, fullPage: full });
console.log("saved", out, page.url());
if (errors.length) console.log("console errors:\n" + errors.slice(0, 10).join("\n"));
await browser.close();
