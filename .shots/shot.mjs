// Screenshot helper for the dev dashboard. Usage:
//   node .shots/shot.mjs <route> <out.png> [width] [height] [--full] [--dark] [--click="css"] [--wait=ms]
// Example: node .shots/shot.mjs /settings/mcp .shots/mcp.png 1440 900 --full
// Prints console errors it saw. Dashboard token is injected into localStorage so the gate is skipped.
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";

const [route = "/", out = ".shots/out.png", w = "1440", h = "900", ...flags] = process.argv.slice(2);
const full = flags.includes("--full");
const dark = flags.includes("--dark");
const click = flags.find((f) => f.startsWith("--click="))?.slice(8);
const wait = Number(flags.find((f) => f.startsWith("--wait="))?.slice(7) ?? 1500);
const token = process.env.ASB_DEV_TOKEN || "devtoken123";
const base = process.env.ASB_UI || "http://localhost:5173";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, colorScheme: dark ? "dark" : "light", deviceScaleFactor: 1 });
if (!flags.includes("--anon")) await ctx.addInitScript((t) => localStorage.setItem("asb-token", t), token);
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(base + route, { waitUntil: "load", timeout: 20000 }).catch((e) => errors.push("goto: " + e.message));
if (click) { await page.click(click).catch((e) => errors.push("click: " + e.message)); }
await page.waitForTimeout(wait);
await page.screenshot({ path: out, fullPage: full });
console.log("saved", out, page.url());
if (errors.length) console.log("console errors:\n" + errors.slice(0, 10).join("\n"));
await browser.close();
