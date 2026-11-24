// Live history page: open the newest run's receipt sheet and screenshot it in both schemes.
// Usage: ASB_TOKEN=… node .shots/cm-2b/live-receipt-shot.mjs <row-text> [--out=.shots/cm-2b/live-receipt]
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";
const flags = process.argv.slice(2);
const rowText = flags.find((f) => !f.startsWith("--")) ?? "MCP server";
const flag = (k, d) => flags.find((f) => f.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const outBase = flag("out", ".shots/cm-2b/live-receipt");
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
  await page.goto(`${base}/dashboard/history`, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(4000);
  const row = page.locator("tr", { hasText: rowText }).first();
  await row.click({ timeout: 10000 }).catch((e) => errors.push("row: " + e.message));
  await page.waitForTimeout(3500);
  const out = `${outBase}-${dark ? "dark" : "light"}.png`;
  await page.screenshot({ path: out });
  const facts = await page.locator('[role="dialog"]').innerText().then((t) => t.split("\n").filter((l) => /code mode|scripts|calls/i.test(l))).catch(() => []);
  console.log("saved", out, "| facts:", facts.join(" | "));
  if (errors.length) console.log("errors:\n" + errors.join("\n"));
  await ctx.close();
}
await browser.close();
