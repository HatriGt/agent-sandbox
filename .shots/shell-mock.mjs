// Shared shell mock for shell-level fixtures: a Hub with five machines, six archived runs and a saas
// admin user, every controller endpoint answered locally. openShell() returns a page on `route`; a
// `/dashboard/box/<name>` route also gets a short thread (watch.sse, changes, pr, digest).
// Theme: `theme` writes `asb-theme` (any id in lib/theme.ts); without it, `dark` writes the legacy
// `asb-dark` key, which the app migrates (true → Black, false → Light).
import { serveWorktreeFonts } from "./overflow-probe.mjs";

const ms = Date.now();
const now = Math.floor(ms / 1000);
const box = (name, role, boxStatus, runState, title, extra = {}) => ({ name, role, boxStatus, runState, title, task: title, uptime: "6m", cpu: "1%", mem: "640MiB / 4GiB", lastOutputAt: now - 4, agent: "claude", ...extra });
export const boxes = [
  box("asb-session-a91b0e44", "session", "Running", "running", "Auth middleware walkthrough"),
  box("asb-pool-c22de9f1", "pool-claimed", "Running", "running", "Fix flaky MCP probe tests", { lastOutputAt: now - 1 }),
  box("asb-session-5510beef", "session", "Running", "done", "Bump Vite to 6", { exitCode: 0, lastOutputAt: now - 1260 }),
  box("asb-session-0d0d1e2f", "session", "Stopped", "done", "Review PR #142", { exitCode: 0, lastOutputAt: now - 7200, asleepSec: 3600, kept: true }),
  box("asb-session-e7e7a0b9", "session", "Stopped", "done", "Rate limiter (TDD)", { exitCode: 1, lastOutputAt: now - 20000, asleepSec: 15000 }),
  { name: "asb-pool-ffee0011", role: "pool-free", boxStatus: "Running", runState: "idle", uptime: "1h 2m", cpu: "0%", mem: "310MiB / 4GiB" },
];
const lifecycle = { capacity: 8, poolSize: 1, idleTimeoutSec: 900, maxDurationSec: 7200, sleepTtlSec: 86400, memoryTiers: ["2G", "4G", "8G"], memoryDefault: "4G" };
const runs = Array.from({ length: 6 }, (_, i) => ({ id: 31 - i, box: `asb-session-dead000${i}`, owner: "ak", task: ["Add dark mode to the marketing site", "Find why the nightly build is slow", "Write integration tests for the webhook receiver", "Explain the deploy pipeline", "Rename the User model to Account", "Fix the flaky suite"][i], state: i === 1 ? "failed" : "done", exitCode: i === 1 ? 1 : 0, startedAt: ms - (i + 1) * 86400e3, endedAt: ms - (i + 1) * 86400e3 + 1500e3, archivedAt: ms - (i + 1) * 86400e3 + 1600e3, headline: "Added a theme toggle and dark palette; PR #88 opened." }));
const ledger = {
  totals: { runs: runs.length, done: 5, failed: 1, checked: 2, passed: 2, inputTokens: 412_300, outputTokens: 58_900, withUsage: 3, costUsd: null, withCost: 0 },
  rows: runs.map((r, i) => ({ ...r, startedBy: i % 2 ? "web" : "schedule", agent: "claude", verified: i < 2 ? true : null, inputTokens: 100_000, outputTokens: 15_000, costUsd: i === 0 ? 0.42 : null, planDone: null, planTotal: null, workflowId: null })),
};
const activity = { runs: Array.from({ length: 40 }, (_, i) => ({ t: ms - i * 3.7 * 3600e3, failed: i % 7 === 0 })) };
const T0 = ms - 14 * 60_000;
const at = (m, s = 0) => `⟦at⟧ ${T0 + m * 60_000 + s * 1000}`;
const THREAD_LOG = [
  at(0), "● session started (model ak-claude-opus-4.8)",
  at(0, 4), "⟦think⟧", "Read the current middleware and its tests first so the new limiter keeps the same contract.", "⟦/think⟧",
  at(0, 9), "I'll read how the limiter is wired today, then swap the implementation behind the same signature.",
  at(0, 12), "→ Read: src/middleware/rateLimit.ts ⟦#r1⟧", at(0, 13), "  ⟦#r1⟧ 1	const WINDOW = 60_000;", "  2	export function rateLimit({ limit }: { limit: number }) {",
  at(0, 16), "→ Bash: npx vitest run test/rateLimit.test.ts ⟦#b1⟧", at(0, 19), "  ⟦#b1⟧ RUN  v2.1.3 /workspace/orders-api", "  ", "   ✓ test/rateLimit.test.ts (5 tests) 140ms", "  ", "   Test Files  1 passed (1)", "        Tests  5 passed (5)", "     Duration  0.91s",
  at(0, 30), "→ Write: src/middleware/rateLimit.ts ⟦#w1⟧", at(0, 31), "  ⟦#w1⟧ File updated: src/middleware/rateLimit.ts (41 lines)", "⟦diff⟧", "-const WINDOW = 60_000;", "+const BUCKETS = 6;", "⟦/diff⟧",
  at(1, 2), "## Sliding-window limiter is in", "", "The limiter now keeps **six 10-second buckets** per key in a Redis hash. The middleware signature is unchanged.", "", "```ts", "export function rateLimit({ limit, window = 60_000 }: Options) {", "  const bucket = Math.floor(Date.now() / (window / BUCKETS));", "}", "```", "", "PR: https://github.com/acme/orders-api/pull/482",
].join("\n");
const THREAD_CHANGES = [{ path: "orders-api/src/middleware/rateLimit.ts", repo: "orders-api", status: "modified", additions: 34, deletions: 11 }, { path: "orders-api/test/rateLimit.test.ts", repo: "orders-api", status: "modified", additions: 24, deletions: 0 }];
const frame = (event, data, id) => `event: ${event}
${id !== undefined ? `id: ${id}
` : ""}data: ${JSON.stringify(data)}

`;
const me = { kind: "user", mode: "saas", id: "u_1", login: "ak", name: "Arun K", role: "admin", via: "session", email: "ak@example.com", avatarUrl: null, github: true, hasPassword: true, maxBoxes: 8, plan: "trial", trialEndsAt: new Date(ms + 9 * 86400e3).toISOString(), daysLeft: 9, expired: false, billingUrl: null };

export async function openShell(browser, { width = 1440, height = 900, route = "/dashboard/", dark = false, theme = null, collapsed = false, base = process.env.ASB_UI || "http://localhost:5173" } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: dark ? "dark" : "light", deviceScaleFactor: 1 });
  await ctx.addInitScript(({ dark, theme, collapsed }) => {
    localStorage.setItem("asb-token", "devtoken123");
    localStorage.setItem("asb-hub-howto-done", "1");
    if (theme) localStorage.setItem("asb-theme", theme);
    else localStorage.setItem("asb-dark", dark ? "1" : "0");
    if (collapsed) localStorage.setItem("asb-collapsed", "1");
    for (const k of Object.keys(localStorage)) if (k.startsWith("asb.cols.")) localStorage.removeItem(k);
    sessionStorage.setItem("asb-session-runs", JSON.stringify([{ box: "asb-pool-c22de9f1", task: "Fix flaky MCP probe tests", startedAt: Date.now() - 120e3 }]));
  }, { dark, theme, collapsed });
  await serveWorktreeFonts(ctx);
  const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  await ctx.route((u) => new URL(u).pathname.endsWith(".json"), (r) => r.fulfill(json({})));
  const mock = (path, body) => ctx.route((u) => new URL(u).pathname === path, (r) => r.fulfill(json(body)));
  await mock("/fleet.json", { boxes, lifecycle, at: ms });
  await mock("/monitor.json", boxes);
  await mock("/auth/config.json", { mode: "saas", providers: ["github"], tokenLogin: true, password: true, signup: true, passwordMin: 10, trialDays: 14, beta: true });
  await mock("/me.json", me);
  await mock("/account.json", me);
  await mock("/history.json", { runs });
  await mock("/history/ledger.json", ledger);
  await mock("/history/activity.json", activity);
  await mock("/triggers.json", { triggers: [] });
  await mock("/agent-prefs.json", { defaultAgent: "claude", agents: [{ id: "claude", label: "Claude Code" }] });
  await mock("/models.json", { models: [{ id: "claude-sonnet-4-5", label: "Sonnet 4.5" }], default: "claude-sonnet-4-5" });
  const boxName = route.match(/\/dashboard\/box\/([^/?#]+)/)?.[1];
  if (boxName) {
    const thread = boxes.find((b) => b.name === boxName) ?? boxes[0];
    const { role: _r, ...meta } = { ...thread, repos: [{ name: "orders-api", branch: "feat/sliding-window-limiter" }] };
    await ctx.route((u) => new URL(u).pathname === "/watch.sse", (r) =>
      r.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache" }, body: "retry: 3000\n\n" + frame("snapshot", { meta, log: THREAD_LOG, from: 0 }, THREAD_LOG.length) + (meta.runState === "done" ? frame("done", { meta }) : "") })
    );
    for (const [path, body] of Object.entries({
      "/watch.json": { ...meta, log: THREAD_LOG }, "/changes.json": { files: THREAD_CHANGES }, "/inbox.json": { queued: [] }, "/revert-points.json": { messages: [2] },
      "/pr.json": { repo: "acme/orders-api", number: 482, title: "feat: sliding-window rate limiter", state: "open", additions: 58, deletions: 11, changedFiles: 2, head: "feat/sliding-window-limiter", base: "main", author: "agent-sandbox[bot]", url: "https://github.com/acme/orders-api/pull/482", mergeable: true, reviewDecision: "review_required", reviewers: [], checks: { total: 3, success: 2, failure: 0, pending: 1 } },
      "/tree.json": { files: THREAD_CHANGES.map((f) => f.path), total: THREAD_CHANGES.length, truncated: false },
      "/git.json": { repo: "orders-api", branch: "feat/sliding-window-limiter", upstream: null, ahead: 0, behind: 0, lastCommit: "feat", clean: false, changed: 2 },
      "/digest.json": { box: boxName, task: meta.task, state: meta.runState, exitCode: 0, startedAt: T0, endedAt: T0 + 92_000, plan: [], files: THREAD_CHANGES, failedCommands: [], questions: [], usage: null, headline: "" },
      "/triggers/for-box.json": { items: [] },
    })) await mock(path, body);
  }
  for (const [path, body] of Object.entries({
    "/skills.json": { skills: [] }, "/harnesses.json": { harnesses: [], limits: {} }, "/workflows.json": { limits: {}, dir: "", workflows: [] }, "/repos.json": { repos: [] },
    "/accounts.json": { accounts: [], oauth: true }, "/audit.json": { events: [] }, "/intake.json": { items: [] }, "/memory-notes.json": { enabled: true, notes: [] },
    "/pr-followups.json": { prefs: {}, hook: null, installs: [] }, "/secrets.json": { secrets: [] }, "/providers.json": { providers: [] }, "/mcp-servers.json": { servers: [], config: { mcpServers: {} } },
    "/repo-setup.json": { profiles: [] }, "/notify.json": { url: "", events: {}, fallbackConfigured: true }, "/users.json": { users: [] }, "/api-keys.json": { keys: [] }, "/sessions.json": { sessions: [] }, "/devices.json": { sessions: [] },
  })) await mock(path, body);
  // The dev server's base is /dashboard/, so it redirects "/" there; serving the same document at "/"
  // lets the router render the landing page (its asset URLs are absolute).
  if (route === "/") await ctx.route((u) => new URL(u).pathname === "/", async (r) => r.fulfill({ response: await r.fetch({ url: base + "/dashboard/" }) }));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/favicon|net::|\[vite\]/.test(m.text()) && errors.push(m.text().slice(0, 160)));
  await page.goto(base + route, { waitUntil: "load", timeout: 20000 });
  await page.waitForTimeout(1200);
  return { ctx, page, errors };
}
