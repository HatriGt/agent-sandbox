// MCP page with the three-way Code mode control and the per-server words, mocked over Vite (no
// local controller). Usage: node .shots/cm-2b/mcp-auto-shot.mjs [--dark] [--out=.shots/cm-2b/mcp-auto] [--setting=auto|on|off|none] [--fallback]
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";
const flags = process.argv.slice(2);
const flag = (k, d) => flags.find((f) => f.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const dark = flags.includes("--dark");
const setting = flag("setting", "auto");
const fallback = flags.includes("--fallback");
const out = flag("out", ".shots/cm-2b/mcp-auto") + (dark ? "-dark" : "-light") + ".png";
const token = process.env.ASB_DEV_TOKEN || "devtoken123";
const base = process.env.ASB_UI || "http://localhost:5181";
const now = Date.now();

const servers = [
  { name: "jira", type: "http", url: "https://mcp.atlassian.com/v1/mcp", headers: { Authorization: "••••" }, enabled: true, addedAt: now - 40 * 86400000 },
  { name: "hana", type: "stdio", command: "npx", args: ["-y", "hana-mcp-server"], env: { HANA_HOST: "••••", HANA_PASSWORD: "••••" }, enabled: true, addedAt: now - 30 * 86400000, provision: "baked" },
  { name: "github", type: "http", url: "https://api.githubcopilot.com/mcp/", headers: { Authorization: "••••" }, enabled: true, addedAt: now - 20 * 86400000 },
  { name: "chrome", type: "stdio", command: "npx", args: ["-y", "chrome-devtools-mcp@latest"], enabled: true, addedAt: now - 10 * 86400000, provision: "baked" },
  { name: "sequential-thinking", type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-sequential-thinking"], enabled: true, addedAt: now - 9 * 86400000, provision: "baked", codeMode: "direct" },
  { name: "context7", type: "stdio", command: "npx", args: ["-y", "@upstash/context7-mcp"], enabled: false, addedAt: now - 5 * 86400000, provision: "baked" },
];
const split = { wrapped: ["github", "hana", "jira"], direct: ["chrome", "sequential-thinking"] };
const mcp = {
  servers,
  config: { mcpServers: Object.fromEntries(servers.map((s) => [s.name, s.type === "stdio" ? { command: s.command, args: s.args, ...(s.codeMode ? { codeMode: s.codeMode } : {}) } : { type: s.type, url: s.url }])) },
  baked: { "mcp-remote": "0.16.6", "@upstash/context7-mcp": "4.6.0", "@modelcontextprotocol/server-sequential-thinking": "2.1.1", "@modelcontextprotocol/sdk": "1.32.2", "hana-mcp-server": "1.4.0", "chrome-devtools-mcp": "0.9.0" },
  lastProvision: {
    at: now - 6 * 60_000,
    box: "quiet-otter",
    skipped: [],
    failed: [],
    dropped: [],
    ...(fallback ? { codeModeFallback: "sdk: missing — @modelcontextprotocol/sdk is not installed looked next to the server" } : { codeMode: split }),
  },
};
const prefs = {
  defaultAgent: "claude",
  ...(setting === "none" ? {} : { codeMode: setting }),
  codeModeDefault: "off",
  agents: [
    { id: "claude", label: "Claude Code", supervised: true },
    { id: "omp", label: "oh-my-pi", supervised: true },
  ],
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1040 }, colorScheme: dark ? "dark" : "light", deviceScaleFactor: 1 });
await ctx.addInitScript((t) => localStorage.setItem("asb-token", t), token);
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
const json = (r, body, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
await page.route("**/*", async (r) => {
  const p = new URL(r.request().url()).pathname;
  const m = r.request().method();
  switch (p) {
    case "/mcp-servers.json": {
      if (m === "GET") return json(r, mcp);
      const body = r.request().postDataJSON() ?? {};
      if (body.action === "test") return json(r, { ok: true, status: 200, detail: "tools/list answered", tools: ["a", "b"] });
      return json(r, mcp);
    }
    case "/agent-prefs.json": {
      if (m === "GET") return json(r, prefs);
      const body = r.request().postDataJSON() ?? {};
      return json(r, { ...prefs, codeMode: body.codeMode });
    }
    case "/skills.json":
      return json(r, { skills: [] });
    case "/accounts.json":
      return json(r, { accounts: [] });
    case "/providers.json":
      return json(r, { providers: [] });
    case "/secrets.json":
      return json(r, { secrets: [] });
    case "/fleet.json":
      return json(r, { boxes: [], lifecycle: { idleTimeoutSec: 1800, maxDurationSec: 14400, capacity: 8, poolSize: 2, sleepTtlSec: 7 * 86400, memoryTiers: ["4G"], memoryDefault: "4G", diskTiers: ["20G"] }, at: now });
    case "/monitor.json":
      return json(r, { boxes: [] });
    case "/inbox.json":
      return json(r, { items: [] });
    case "/orgs.json":
      return json(r, { orgs: [] });
    case "/health.json":
      return r.fulfill({ status: 500, body: "no" });
    default:
      return r.fallback();
  }
});
await page.goto(`${base}/dashboard/integrations`, { waitUntil: "load", timeout: 20000 }).catch((e) => errors.push("goto: " + e.message));
await page.waitForTimeout(2500);
await page.getByText("MCP servers", { exact: false }).first().scrollIntoViewIfNeeded().catch((e) => errors.push("scroll: " + e.message));
await page.evaluate(() => window.scrollBy(0, -24));
await page.waitForTimeout(400);
await page.screenshot({ path: out });
const checked = await page.locator('[role="radiogroup"][aria-label="Code mode"] [role="radio"][aria-checked="true"]').textContent().catch(() => "missing");
const words = await page.locator("table").first().innerText().then((t) => t.split("\n").filter((l) => /code mode|direct/.test(l))).catch(() => []);
console.log("saved", out, "checked:", checked, "| words:", words.join(" | "));
if (errors.length) console.log("console errors:\n" + errors.slice(0, 10).join("\n"));
await browser.close();
