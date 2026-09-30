// Drives the MCP servers UI through its flows and screenshots each. Usage:
//   node .shots/mcp-flows.mjs [--dark] [--w=1440 --h=900] [--only=list,sheet,...]
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";

const flags = process.argv.slice(2);
const dark = flags.includes("--dark");
const w = Number(flags.find((f) => f.startsWith("--w="))?.slice(4) ?? 1440);
const h = Number(flags.find((f) => f.startsWith("--h="))?.slice(4) ?? 900);
const only = flags.find((f) => f.startsWith("--only="))?.slice(7).split(",");
const tag = `${dark ? "dark" : "light"}-${w}`;
const base = "http://localhost:5173";
const errors = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
await ctx.addInitScript((d) => {
  localStorage.setItem("asb-token", "devtoken123");
  localStorage.setItem("asb-dark", d ? "1" : "0");
}, dark);
const page = await ctx.newPage();
page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

const shot = async (name, opts = {}) => {
  await page.waitForTimeout(opts.wait ?? 450);
  const path = `.shots/mcp-${name}-${tag}.png`;
  await page.screenshot({ path, fullPage: opts.full ?? false });
  console.log("saved", path);
};
const want = (n) => !only || only.includes(n);
const goto = async () => {
  await page.goto(base + "/dashboard/integrations", { waitUntil: "load" });
  await page.waitForSelector("text=MCP servers");
  await page.waitForTimeout(700);
};

// Fake a probe so the verdict UI can be seen locally: linear → connected with tools, others → the real controller.
let probeMode = "real";
await page.route("**/mcp-servers/test.json", async (route) => {
  if (probeMode === "real") return route.continue();
  const body = JSON.parse(route.request().postData() || "{}");
  await new Promise((r) => setTimeout(r, 600));
  if (probeMode === "ok")
    return route.fulfill({ json: { ok: true, status: 200, detail: "Connected — 12 tools advertised.", tools: ["list_issues", "get_issue", "create_issue", "update_issue", "list_projects", "get_project", "list_teams", "search", "list_comments", "create_comment", "list_cycles", "get_viewer"] } });
  return route.fulfill({ json: { ok: false, status: 401, detail: `401 unauthorized — {"error":"invalid token"}. Check the Authorization header.` } });
});

await goto();
if (want("list")) {
  const sec = page.locator("section[aria-labelledby=mcp-h]");
  await sec.scrollIntoViewIfNeeded();
  await shot("list", { full: true });
  await page.hover("li >> text=jira");
  await shot("list-hover");
}

if (want("test")) {
  // Real probe (fails locally: not public / unreachable), then a faked success, then a faked 401.
  await page.click("li:has-text('linear') >> button:has-text('Test')");
  await page.waitForSelector("li:has-text('linear') [role=status]", { timeout: 15000 });
  await shot("test-real", { wait: 900, full: true });
  probeMode = "ok";
  await page.click("li:has-text('linear') >> [aria-label='Test again']");
  await page.waitForTimeout(300);
  await shot("test-checking");
  await page.waitForTimeout(800);
  await shot("test-ok", { full: true });
  probeMode = "fail";
  await page.click("li:has-text('linear') >> [aria-label='Test again']");
  await page.waitForTimeout(1100);
  await shot("test-fail", { full: true });
  await page.click("li:has-text('linear') >> [aria-label='Dismiss result']");
  probeMode = "real";
}

if (want("toggle")) {
  await page.click("[aria-label='Enable postgres']");
  await page.waitForTimeout(600);
  await shot("toggle-on");
  await page.click("[aria-label='Disable postgres']");
  await page.waitForTimeout(600);
}

if (want("filter")) {
  await page.click("[role=radio]:has-text('Off')");
  await shot("filter-off");
  await page.click("[role=radio]:has-text('All')");
  await page.fill("[aria-label='Search servers']", "zzz");
  await shot("filter-nomatch");
  await page.fill("[aria-label='Search servers']", "");
}

if (want("remove")) {
  await page.click("li:has-text('playwright') >> [aria-label='Remove playwright']");
  await shot("remove-armed");
  await page.keyboard.press("Escape");
}

if (want("sheet")) {
  await page.click("button:has-text('Add server')");
  await page.waitForSelector("[role=dialog]");
  await shot("add-empty", { wait: 600 });
  await page.fill("[role=dialog] input[placeholder=postgres]", "postgres");
  await page.fill("[role=dialog] input[placeholder^='npx -y']", 'npx -y @modelcontextprotocol/server-postgres "postgresql://user:pw@db.internal:5432/app"');
  await page.click("[role=dialog] button:has-text('Add variable')");
  await page.fill("[role=dialog] [aria-label='Environment name 1']", "PG_PASSWORD");
  await page.fill("[role=dialog] [aria-label='Environment value 1']", "hunter2-secret");
  await page.click("[role=dialog] button:has-text('What the agent sees')");
  await shot("add-stdio-filled", { wait: 600 });
  await page.click("[role=dialog] [role=radio]:has-text('HTTP')");
  await page.fill("[role=dialog] input[placeholder^='https://']", "https://mcp.notion.com/mcp");
  await page.click("[role=dialog] button:has-text('Add header')");
  await page.fill("[role=dialog] [aria-label='Headers name 1']", "Authorization");
  await page.fill("[role=dialog] [aria-label='Headers value 1']", "Bearer ntn_secret_token_1234");
  await shot("add-http-filled", { wait: 500 });
  // Validation: clear the URL and submit.
  await page.fill("[role=dialog] input[placeholder^='https://']", "notaurl");
  await page.fill("[role=dialog] input[placeholder=postgres]", "");
  await page.click("[role=dialog] button[type=submit]");
  await shot("add-invalid", { wait: 400 });
  await page.fill("[role=dialog] input[placeholder=postgres]", "notion");
  await page.fill("[role=dialog] input[placeholder^='https://']", "https://mcp.notion.com/mcp");
  await page.click("[role=dialog] [role=tab]:has-text('JSON')");
  await shot("add-json", { wait: 500 });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // Edit an existing remote server — the connection block.
  await page.click("li >> [aria-label='Open linear']");
  await page.waitForSelector("[role=dialog]");
  probeMode = "ok";
  await page.click("[role=dialog] button:has-text('Test')");
  await page.waitForTimeout(1200);
  await shot("edit-linear", { wait: 300 });
  probeMode = "real";
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  await page.click("li >> [aria-label='Open jira']");
  await page.waitForSelector("[role=dialog]");
  await shot("edit-jira", { wait: 600 });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
}

if (want("paste")) {
  await page.click("[aria-label='Paste config']");
  await page.waitForSelector("[role=dialog]");
  await page.click("[role=dialog] .cm-content, [role=dialog] textarea").catch(() => {});
  await page.keyboard.type('{"mcpServers":{"github":{"command":"npx","args":["-y","@modelcontextprotocol/server-github"]},"sentry":{"url":"https://mcp.sentry.dev/mcp"}}}');
  await shot("paste", { wait: 500 });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
}

if (want("json")) {
  await page.click("[role=tab]:has-text('JSON')");
  await shot("json-view", { wait: 600, full: true });
  await page.click("[role=tab]:has-text('List')");
}

if (want("empty")) {
  await page.route("**/mcp-servers.json", (route) => (route.request().method() === "GET" ? route.fulfill({ json: { servers: [], config: { mcpServers: {} } } }) : route.continue()));
  await page.addInitScript(() => {
    for (const k of Object.keys(localStorage)) if (/mcp/i.test(k)) localStorage.removeItem(k);
  });
  await goto();
  await page.locator("section[aria-labelledby=mcp-h]").scrollIntoViewIfNeeded();
  await shot("empty", { wait: 800 });
}

if (errors.length) console.log("console errors:\n" + errors.slice(0, 12).join("\n"));
await browser.close();
