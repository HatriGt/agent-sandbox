// The Automations editor's "Follow each reviewed PR until it merges" options, on the live dashboard.
//   node .shots/automation-follow-shot.mjs [--dark] [--name="Deal Reviewer"]
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";
import fs from "node:fs";
const flags = process.argv.slice(2);
const dark = flags.includes("--dark");
const name = flags.find((f) => f.startsWith("--name="))?.slice(7) ?? "Deal Reviewer";
const base = process.env.ASB_UI || "https://agent-sandbox.ajeethkumar.dev";
const token = (process.env.ASB_TOKEN || fs.readFileSync(".shots/.asb-token", "utf8")).trim();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: dark ? "dark" : "light", deviceScaleFactor: 1 });
await ctx.addInitScript(({ t, d }) => { localStorage.setItem("asb-token", t); localStorage.setItem("asb-dark", d ? "1" : "0"); }, { t: token, d: dark });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`${base}/dashboard/autopilot`, { waitUntil: "load", timeout: 30000 });
await page.waitForTimeout(2500);
await page.getByText(name, { exact: true }).first().click();
await page.waitForTimeout(1200);
const view = page.getByRole("button", { name: /^View$/ });
if (await view.count()) { await view.first().click(); await page.waitForTimeout(1000); }
const tile = page.getByText("Follow each reviewed PR until it merges").first().locator("xpath=ancestor::div[contains(@class,'surface')][1]");
await tile.evaluate((el) => el.scrollIntoView({ block: "start" }));
await page.waitForTimeout(800);
// Toasts (asks, run reports) overlay the sheet's corner: hide them for the shot.
await page.addStyleTag({ content: "[data-sonner-toaster]{display:none !important}" });
const out = `.shots/automation-follow${dark ? "-dark" : ""}.png`;
const sheet = page.locator("[role=dialog]").first();
if (await sheet.count()) await sheet.screenshot({ path: out }); else await page.screenshot({ path: out });
console.log("saved", out, page.url());
if (errors.length) console.log("page errors:\n" + errors.join("\n"));
await browser.close();
