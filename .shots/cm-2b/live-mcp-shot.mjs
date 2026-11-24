// Live MCP page: the Code mode card with its saved scripts, both schemes.
// Usage: ASB_TOKEN=… node .shots/cm-2b/live-mcp-shot.mjs [--out=.shots/cm-2b/live-mcp-scripts]
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";
const flags = process.argv.slice(2);
const flag = (k, d) => flags.find((f) => f.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const outBase = flag("out", ".shots/cm-2b/live-mcp-scripts");
const token = process.env.ASB_TOKEN;
const base = process.env.ASB_UI || "https://agent-sandbox.ajeethkumar.dev";
if (!token) throw new Error("ASB_TOKEN is required");

const browser = await chromium.launch();
for (const dark of [false, true]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1040 }, colorScheme: dark ? "dark" : "light", deviceScaleFactor: 1 });
  await ctx.addInitScript((t) => localStorage.setItem("asb-token", t), token);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${base}/dashboard/integrations`, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(4000);
  await page.locator("#code-mode-h").scrollIntoViewIfNeeded().catch((e) => errors.push("scroll: " + e.message));
  await page.evaluate(() => window.scrollBy(0, -80));
  await page.waitForTimeout(500);
  const out = `${outBase}-${dark ? "dark" : "light"}.png`;
  await page.screenshot({ path: out });
  const scripts = await page.locator("text=Saved scripts").locator("..").innerText().then((t) => t.split("\n").slice(0, 8).join(" | ")).catch(() => "no saved scripts block");
  console.log("saved", out, "|", scripts);
  if (errors.length) console.log("errors:\n" + errors.join("\n"));
  await ctx.close();
}
await browser.close();
