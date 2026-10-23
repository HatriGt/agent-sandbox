// Shared shell mock for shell-level fixtures: a Hub with five machines, six archived runs and a saas
// admin user, every controller endpoint answered locally. openShell() returns a page on `route`.
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
const me = { kind: "user", mode: "saas", id: "u_1", login: "ak", name: "Arun K", role: "admin", via: "session", email: "ak@example.com", avatarUrl: null, github: true, hasPassword: true, maxBoxes: 8, plan: "trial", trialEndsAt: new Date(ms + 9 * 86400e3).toISOString(), daysLeft: 9, expired: false, billingUrl: null };

export async function openShell(browser, { width = 1440, height = 900, route = "/dashboard/", dark = false, collapsed = false, base = process.env.ASB_UI || "http://localhost:5173" } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: dark ? "dark" : "light", deviceScaleFactor: 1 });
  await ctx.addInitScript(({ dark, collapsed }) => {
    localStorage.setItem("asb-token", "devtoken123");
    localStorage.setItem("asb-hub-howto-done", "1");
    localStorage.setItem("asb-dark", dark ? "1" : "0");
    if (collapsed) localStorage.setItem("asb-collapsed", "1");
    for (const k of Object.keys(localStorage)) if (k.startsWith("asb.cols.")) localStorage.removeItem(k);
    sessionStorage.setItem("asb-session-runs", JSON.stringify([{ box: "asb-pool-c22de9f1", task: "Fix flaky MCP probe tests", startedAt: Date.now() - 120e3 }]));
  }, { dark, collapsed });
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
  for (const [path, body] of Object.entries({
    "/skills.json": { skills: [] }, "/harnesses.json": { harnesses: [], limits: {} }, "/workflows.json": { limits: {}, dir: "", workflows: [] }, "/repos.json": { repos: [] },
    "/accounts.json": { accounts: [], oauth: true }, "/audit.json": { events: [] }, "/intake.json": { items: [] }, "/memory-notes.json": { enabled: true, notes: [] },
    "/pr-followups.json": { prefs: {}, hook: null, installs: [] }, "/secrets.json": { secrets: [] }, "/providers.json": { providers: [] }, "/mcp-servers.json": { servers: [], config: { mcpServers: {} } },
    "/repo-setup.json": { profiles: [] }, "/notify.json": { url: "", events: {}, fallbackConfigured: true }, "/users.json": { users: [] }, "/api-keys.json": { keys: [] }, "/sessions.json": { sessions: [] }, "/devices.json": { sessions: [] },
  })) await mock(path, body);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/favicon|net::/.test(m.text()) && errors.push(m.text().slice(0, 160)));
  await page.goto(base + route, { waitUntil: "load", timeout: 20000 });
  await page.waitForTimeout(1200);
  return { ctx, page, errors };
}
