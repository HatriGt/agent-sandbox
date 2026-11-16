// Organisation pages over the local controller + Vite with the org API mocked (the local controller
// runs on the operator token, and orgs are a signed-in-person thing).
//   node .shots/org-fixture.mjs [--dark] [--role=owner|admin|member] [--only=org,account,memory,skills,integrations,org-empty] [--tag=x]
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";
import { serveWorktreeFonts } from "./overflow-probe.mjs";

const flags = process.argv.slice(2);
const flag = (k, d) => flags.find((f) => f.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const dark = flags.includes("--dark");
const role = flag("role", "owner");
const tag = flag("tag", "");
const only = flag("only", "").split(",").filter(Boolean);
const base = process.env.ASB_UI || "http://localhost:5173";
const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();

const me = { kind: "user", mode: "saas", id: "u_ann", login: "ann", name: "Ann Park", role: "user", via: "session", email: "ann@acme.dev", avatarUrl: null, github: true, hasPassword: true, maxBoxes: 4, plan: "pro", trialEndsAt: null, daysLeft: null, expired: false, billingUrl: null };
const orgRef = { id: "org_acme", name: "Acme Robotics", role };
const orgs = [
  { ...orgRef, ownerId: role === "owner" ? "u_ann" : "u_sam", ownerLogin: role === "owner" ? "ann" : "sam", createdAt: iso(now - 30 * 864e5), members: 4, pending: 2 },
  { id: "org_side", name: "Weekend Lab", role: "member", ownerId: "u_lee", ownerLogin: "lee", createdAt: iso(now - 90 * 864e5), members: 2, pending: 0 },
];
me.orgs = orgs.map((o) => ({ id: o.id, name: o.name, role: o.role, members: o.members, pending: o.pending }));
const members = [
  { email: role === "owner" ? "ann@acme.dev" : "sam@acme.dev", userId: role === "owner" ? "u_ann" : "u_sam", login: role === "owner" ? "ann" : "sam", name: null, avatarUrl: null, role: "owner", status: "joined", invitedAt: null, joinedAt: iso(now - 30 * 864e5) },
  ...(role === "owner" ? [] : [{ email: "ann@acme.dev", userId: "u_ann", login: "ann", name: "Ann Park", avatarUrl: null, role, status: "joined", invitedAt: iso(now - 20 * 864e5), joinedAt: iso(now - 19 * 864e5) }]),
  { email: "priya@acme.dev", userId: "u_priya", login: "priya", name: "Priya N", avatarUrl: null, role: "admin", status: "joined", invitedAt: iso(now - 12 * 864e5), joinedAt: iso(now - 11 * 864e5) },
  { email: "tomas@acme.dev", userId: "u_tomas", login: "tomas", name: null, avatarUrl: null, role: "member", status: "joined", invitedAt: iso(now - 6 * 864e5), joinedAt: iso(now - 5 * 864e5) },
  { email: "mei@acme.dev", userId: null, login: null, name: null, avatarUrl: null, role: "member", status: "invited", invitedAt: iso(now - 2 * 864e5), joinedAt: null },
  { email: "jules@contractor.io", userId: null, login: null, name: null, avatarUrl: null, role: "member", status: "invited", invitedAt: iso(now - 3600e3), joinedAt: null },
].slice(0, role === "owner" ? 5 : 6);

const orgServers = [
  { name: "linear", type: "http", url: "https://mcp.linear.app/mcp", headers: { Authorization: "Bearer ••••" }, enabled: true, addedAt: now - 9 * 864e5 },
  { name: "acme-docs", type: "stdio", command: "npx", args: ["-y", "@acme/docs-mcp"], enabled: true, addedAt: now - 4 * 864e5, provision: "per-run" },
  { name: "sentry", type: "http", url: "https://mcp.sentry.dev/mcp", enabled: false, addedAt: now - 20 * 864e5 },
];
const orgSkills = [
  { name: "release-notes", description: "Write the week's release notes from merged PRs in Acme's house style.", content: "# Release notes\n\n1. List merged PRs since the last tag.\n2. Group by product area.\n", enabled: true, addedAt: now - 8 * 864e5, updatedAt: now - 2 * 864e5 },
  { name: "incident-review", description: "Draft a blameless postmortem from a Sentry issue and the fix PR.", content: "# Incident review\n", enabled: true, addedAt: now - 15 * 864e5, updatedAt: now - 15 * 864e5 },
  { name: "schema-change", description: "Checklist for a migration touching the orders database.", content: "# Schema change\n", enabled: false, addedAt: now - 20 * 864e5, updatedAt: now - 20 * 864e5 },
];
const orgNotes = [
  { id: "on1", kind: "rule", scope: "operator", status: "kept", text: "Never push to main directly — every change goes through a PR with at least one review.", at: now - 7 * 864e5, source: "you" },
  { id: "on2", kind: "preference", scope: "operator", status: "kept", text: "Commit messages are one sentence in the imperative, no ticket prefix.", at: now - 6 * 864e5, source: "you" },
  { id: "on3", kind: "domain", scope: "repo", status: "kept", text: "orders-api owns the ledger; invoices are derived from it and never written by hand.", why: "Two services wrote invoices in 2025 and the totals drifted.", at: now - 3 * 864e5, source: "you", repo: "acme/orders-api", area: "ledger" },
];
const ownServers = [{ name: "github", type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: { GITHUB_TOKEN: "••••" }, enabled: true, addedAt: now - 40 * 864e5, provision: "baked" }];
const ownSkills = [{ name: "review-pr", description: "Review a pull request the way this team likes.", content: "# Review PR\n", enabled: true, addedAt: now - 40 * 864e5, updatedAt: now - 40 * 864e5 }];
const ownNotes = [{ id: "n1", kind: "preference", scope: "operator", status: "kept", text: "Prefer small PRs; split anything over 400 lines.", at: now - 10 * 864e5, source: "you", uses: 3 }];
const shared = (k) => [{ org: orgRef, ...(k === "servers" ? { servers: orgServers.filter((s) => s.enabled) } : k === "skills" ? { skills: orgSkills.filter((s) => s.enabled) } : { enabled: true, notes: orgNotes }) }];

const mk = (name, runState, title, extra = {}) => ({ name, boxStatus: "running", task: title, runState, uptime: "12m", cpu: "14%", mem: "1.2G/4G", memUsage: { usedMib: 1200, totalMib: 4096 }, disk: { usedMib: 3000, totalMib: 20480 }, lastOutputAt: now - 20_000, title, repos: [{ name: "orders-api", branch: "main" }], agent: "claude", ...extra });
const boxes = [mk("quiet-otter", "running", "Claims audit"), mk("brave-heron", "running", "Migrate the invoice worker")];
const lifecycle = { idleTimeoutSec: 1800, maxDurationSec: 14400, capacity: 8, poolSize: 2, sleepTtlSec: 604800, memoryTiers: ["4G"], memoryDefault: "4G", diskTiers: ["20G"] };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: dark ? "dark" : "light", deviceScaleFactor: 1 });
await ctx.addInitScript((d) => { localStorage.setItem("asb-token", "devtoken123"); localStorage.setItem("asb-dark", d ? "1" : "0"); localStorage.setItem("asb-hub-howto-done", "1"); }, dark);
await serveWorktreeFonts(ctx);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const json = (route, body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
let empty = false;
await page.route("**/*", (route) => {
  const u = new URL(route.request().url());
  const org = u.searchParams.get("org");
  const p = u.pathname;
  if (p === "/fleet.json") return json(route, { boxes, lifecycle, at: now });
  if (p === "/monitor.json") return json(route, { boxes, lifecycle });
  if (p === "/me.json") return json(route, empty ? { ...me, orgs: [] } : me);
  if (p === "/auth/config.json") return json(route, { mode: "saas", providers: ["github"], tokenLogin: false, password: true, signup: true, passwordMin: 10, trialDays: 14, billingUrl: null, beta: true });
  if (p === "/api-keys.json") return json(route, { keys: [] });
  if (p === "/devices.json") return json(route, { sessions: [] });
  if (p === "/orgs.json") return json(route, { orgs: empty ? [] : orgs });
  if (p === "/orgs/members.json") return json(route, { org: { id: orgRef.id, name: orgRef.name, role, ownerId: orgs[0].ownerId }, members });
  if (p === "/mcp-servers.json") return json(route, org ? { servers: orgServers, config: { mcpServers: {} } } : { servers: ownServers, shared: shared("servers"), config: { mcpServers: {} }, baked: { "@modelcontextprotocol/server-github": "1.2.0" } });
  if (p === "/skills.json") return json(route, org ? { skills: orgSkills } : { skills: ownSkills, shared: shared("skills") });
  if (p === "/memory-notes.json") return json(route, org ? { enabled: true, notes: orgNotes } : { enabled: true, notes: ownNotes, shared: shared("notes"), episodes: [], receipts: [] });
  return route.continue();
});
const pages = [
  ["org", "/dashboard/org/org_acme"],
  ["org-empty", "/dashboard/org"],
  ["account", "/dashboard/account"],
  ["integrations", "/dashboard/integrations"],
  ["skills", "/dashboard/skills"],
  ["memory", "/dashboard/memory"],
];
for (const [name, path] of pages) {
  if (only.length && !only.includes(name)) continue;
  empty = name === "org-empty";
  await page.goto(`${base}${path}`, { waitUntil: "load", timeout: 30000 }).catch((e) => errors.push(`${name}: ${e.message}`));
  await page.waitForTimeout(3200);
  if (name === "memory") await page.locator("#sec-memory-you").scrollIntoViewIfNeeded().catch(() => {});
  const file = `.shots/out/org-${name}-${role}${dark ? "-dark" : ""}${tag ? "-" + tag : ""}.png`;
  await page.screenshot({ path: file });
  console.log(name, file);
  if (name !== "org-empty" && name !== "account") {
    if (name === "memory") {
      const you = page.locator("section[aria-labelledby='memory-you-h']");
      console.log("memory-you count", await you.count(), await page.evaluate(() => [...document.querySelectorAll("[id]")].map((e) => e.id).filter((i) => /mem|you|shared/i.test(i)).join(",")));
      console.log("shared text", await page.evaluate(() => document.body.innerText.includes("Shared by Acme")));
      if (await you.count()) await you.screenshot({ path: file.replace(".png", "-you.png") });
    }
    await page.mouse.move(name === "memory" ? 400 : 900, name === "memory" ? 100 : 500);
    await page.mouse.wheel(0, name === "memory" ? 0 : 900);
    await page.waitForTimeout(900);
    await page.screenshot({ path: file.replace(".png", "-2.png") });
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(900);
    await page.screenshot({ path: file.replace(".png", "-3.png") });
  }
}
console.log("errors:", errors.filter((e) => !/404/.test(e)).join(" | ") || "none");
await browser.close();
