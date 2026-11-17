// Fleet page with the box-hosts panel, every data route mocked (no controller needed).
// Run from PowerShell:  node .shots/hosts-fixture.mjs <out.png> [--dark] [--full] [--open=new|edit] [--w=1440] [--h=1100]
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";
import { serveWorktreeFonts } from "./overflow-probe.mjs";

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith("--"));
const pos = args.filter((a) => !a.startsWith("--"));
const out = pos[0] ?? ".shots/hosts.png";
const flag = (k, d) => flags.find((f) => f.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const dark = flags.includes("--dark");
const full = flags.includes("--full");
const open = flag("open", "");
const panel = flags.includes("--panel");
const W = Number(flag("w", 1440));
const H = Number(flag("h", 1100));
const base = process.env.ASB_UI || "http://localhost:5173";
const now = Date.now();

const mk = (name, extra) => ({ name, role: "session", boxStatus: "running", runState: "running", uptime: "14m", cpu: "12%", mem: "1.1G/4G", memUsage: { usedMib: 1130, totalMib: 4096 }, disk: { usedMib: 3800, totalMib: 20480 }, lastOutputAt: Math.floor(now / 1000) - 4, agent: "claude", host: "primary", ...extra });
const boxes = [
  mk("quiet-otter", { task: "Add a sliding-window rate limiter to the orders API", title: "Sliding-window rate limiter", repos: [{ name: "orders-api", branch: "feat/sliding-window-limiter" }] }),
  mk("brisk-heron", { host: "freestyle-a", runState: "waiting", question: "Should the limiter key on user id or on API key?", task: "Rate limit the public search endpoint", title: "Search rate limit", repos: [{ name: "search", branch: "main" }] }),
  mk("sleepy-lynx", { boxStatus: "stopped", runState: "done", exitCode: 0, asleepSec: 3600 * 5, task: "Fix the flaky webhook retry test", title: "Webhook retry test", repos: [{ name: "orders-api", branch: "fix/retry" }] }),
  mk("calm-finch", { host: "freestyle-b", runState: "done", exitCode: 0, task: "Write the release notes for 3.2", title: "Release notes 3.2", repos: [{ name: "docs", branch: "release/3.2" }], uptime: "27m" }),
];
const lifecycle = { idleTimeoutSec: 1800, maxDurationSec: 4 * 3600, capacity: 13, poolSize: 1, sleepTtlSec: 7 * 86400, memoryTiers: ["2G", "4G", "8G"], memoryDefault: "4G", diskTiers: ["20G", "40G"] };
const hosts = [
  { id: "primary", name: "Primary host", provider: "static", primary: true, ssh: "root@hostbrr", enabled: true, warm: true, priority: 0, sleepAfterMs: 0, maxBoxes: 5, running: 2, reserved: 0, asleep: false, sleepSince: 0, unreachable: false, lastSweepAt: now - 4000, msbHome: "/root/.microsandbox", stagingDir: "/root/agent-sandbox-staging", msb: "/root/.local/bin/msb", disk: { reading: { totalMib: 157593, usedMib: 135800, availMib: 21793, usedPct: 86 }, at: now - 60000 } },
  { id: "freestyle-a", name: "Freestyle account A", provider: "freestyle", primary: false, ssh: "asb-host+root:…@beta-ssh.freestyle.sh", enabled: true, warm: false, priority: 10, sleepAfterMs: 300000, maxBoxes: 4, running: 1, reserved: 1, asleep: false, sleepSince: 0, unreachable: false, lastSweepAt: now - 4000, allowance: { vcpuHours: 400, vcpu: 4, resetDay: 1, month: "2026-11", usedHours: 212.4, leftHours: 187.6, pct: 53 }, providerState: { state: "running", at: now - 30000 }, freestyle: { vmId: "vm-12d01977410746df", hasApiKey: true }, snapshot: "" },
  { id: "freestyle-b", name: "Freestyle account B", provider: "freestyle", primary: false, ssh: "asb-b+root:…@beta-ssh.freestyle.sh", enabled: true, warm: false, priority: 10, sleepAfterMs: 300000, maxBoxes: 4, running: 0, reserved: 0, asleep: true, sleepSince: now - 42 * 60000, unreachable: false, lastSweepAt: now - 45 * 60000, allowance: { vcpuHours: 200, vcpu: 4, resetDay: 1, month: "2026-11", usedHours: 176, leftHours: 24, pct: 88 }, providerState: { state: "paused", at: now - 40 * 60000 }, freestyle: { vmId: "vm-9a1b2c3d4e5f", hasApiKey: true } },
  { id: "freestyle-c", name: "Freestyle account C", provider: "freestyle", primary: false, ssh: "asb-c+root:…@beta-ssh.freestyle.sh", enabled: true, warm: false, priority: 10, sleepAfterMs: 300000, maxBoxes: 4, running: 0, reserved: 0, asleep: false, sleepSince: 0, sleepsAt: now + 4 * 60000 + 20000, unreachable: false, lastSweepAt: now - 4000, allowance: { vcpuHours: 200, vcpu: 4, resetDay: 1, month: "2026-11", usedHours: 31, leftHours: 169, pct: 16 }, providerState: { state: "running", at: now - 30000 }, freestyle: { vmId: "vm-7f00aa11bb22", hasApiKey: true } },
  { id: "instabox-1", name: "Instabox trial", provider: "static", primary: false, ssh: "ubuntu@instabox-1.example", enabled: true, warm: false, priority: 20, sleepAfterMs: 0, maxBoxes: 2, running: 0, reserved: 0, asleep: false, sleepSince: 0, unreachable: true, lastError: "ssh: connect to host instabox-1.example port 22: Connection timed out", lastSweepAt: now - 3 * 3600000, check: { ok: false, ms: 20010, detail: "ssh: connect to host instabox-1.example port 22: Connection timed out", at: now - 600000 } },
  { id: "old-vps", name: "Old VPS", provider: "static", primary: false, ssh: "root@203.0.113.9", enabled: false, warm: false, priority: 30, sleepAfterMs: 0, maxBoxes: 3, running: 0, reserved: 0, asleep: false, sleepSince: 0, unreachable: false, lastSweepAt: 0 },
];
const health = {
  admin: true,
  canary: { enabled: true, intervalMs: 3600000, last: { ok: true, ms: 18400, detail: "18.4s, exit 0", box: "pool-1794407972334-kgn4wk", at: now - 22 * 60000, failures: 0, lastOkAt: now - 22 * 60000 } },
  hostDisk: { reading: { totalMib: 157593, usedMib: 135800, availMib: 21793, usedPct: 86 }, at: now - 60000, alertPct: 90, home: "/root/.microsandbox" },
  hostSleep: { enabled: false, asleep: false, since: 0, lastWorkAt: now, afterMs: 0 },
  hosts,
  orphanSweep: { at: now - 3600000 * 5, removed: [], freedMib: 0 },
  startFailures: { streak: 0, alertedAt: 0 },
  baked: { "@anthropic-ai/claude-code": "2.1.273" },
  lastProvision: null,
  rebakeDue: [],
  rebakeCheckedAt: now - 3600000,
  claudeSource: { kind: "image", name: "agent-claude:202611151009" },
  imageUpdate: { phase: "idle" },
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: dark ? "dark" : "light", deviceScaleFactor: 1 });
await serveWorktreeFonts(ctx).catch(() => {});
await ctx.addInitScript(() => {
  localStorage.setItem("asb-token", "devtoken123");
  localStorage.setItem("asb-dark", "0");
});
if (dark) await ctx.addInitScript(() => localStorage.setItem("asb-dark", "1"));
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
const json = (r, body, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
await page.route("**/*", async (r) => {
  const u = new URL(r.request().url());
  const p = u.pathname;
  if (!p.endsWith(".json") && !p.startsWith("/mcp")) return r.fallback();
  switch (p) {
    case "/me.json":
      return json(r, { kind: "operator", mode: "token", role: "admin" });
    case "/fleet.json":
      return json(r, { boxes, lifecycle, at: now });
    case "/health.json":
      return json(r, health);
    case "/hosts.json":
      return json(r, { hosts, capacity: 13 });
    case "/inbox.json":
      return json(r, { items: [] });
    case "/triggers.json":
      return json(r, { triggers: [] });
    case "/skills.json":
      return json(r, { skills: [] });
    case "/prefs.json":
      return json(r, {});
    default:
      return json(r, { error: "mocked out" }, 404);
  }
});
await page.goto(base + "/dashboard/fleet", { waitUntil: "load", timeout: 20000 }).catch((e) => errors.push("goto: " + e.message));
await page.waitForTimeout(1800);
if (open === "new") await page.getByRole("button", { name: "Add host" }).click();
if (open === "edit") await page.getByRole("button", { name: "Edit Freestyle account A" }).click();
if (open) await page.waitForTimeout(600);
if (panel) {
  await page.getByRole("button", { name: /close/i }).first().click().catch(() => {});
  const el = page.locator("section", { hasText: "Box hosts" }).last();
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await el.screenshot({ path: out });
} else await page.screenshot({ path: out, fullPage: full });
console.log(JSON.stringify({ out, errors: errors.filter((e) => !/mocked out|404|Failed to load resource/.test(e)) }));
await browser.close();
