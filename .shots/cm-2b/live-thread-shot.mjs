// Live thread page: screenshot a box's conversation in both schemes, scrolled to the end (or to the
// first text matching --find=…). Usage: ASB_TOKEN=… node .shots/cm-2b/live-thread-shot.mjs <box> [--out=.shots/cm-2b/thread] [--find=text] [--tall=1]
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";
const flags = process.argv.slice(2);
const box = flags.find((f) => !f.startsWith("--"));
const flag = (k, d) => flags.find((f) => f.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const outBase = flag("out", ".shots/cm-2b/thread");
const find = flag("find", "");
const tall = flag("tall", "") === "1";
const token = process.env.ASB_TOKEN;
const base = process.env.ASB_UI || "https://agent-sandbox.ajeethkumar.dev";
if (!token || !box) throw new Error("ASB_TOKEN and <box> are required");

const browser = await chromium.launch();
for (const dark of [false, true]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: tall ? 1600 : 1040 }, colorScheme: dark ? "dark" : "light", deviceScaleFactor: 1 });
  await ctx.addInitScript((t) => localStorage.setItem("asb-token", t), token);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${base}/dashboard/box/${box}`, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(6000);
  if (find) {
    const hit = page.getByText(find, { exact: false }).first();
    await hit.scrollIntoViewIfNeeded({ timeout: 8000 }).catch((e) => errors.push("find: " + e.message));
    await page.waitForTimeout(800);
  } else {
    // The conversation pane scrolls on its own: push every scrollable element to the bottom.
    await page.evaluate(() => {
      for (const el of document.querySelectorAll("*")) {
        const s = getComputedStyle(el);
        if ((s.overflowY === "auto" || s.overflowY === "scroll") && el.scrollHeight > el.clientHeight) el.scrollTop = el.scrollHeight;
      }
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(1200);
  }
  const out = `${outBase}-${dark ? "dark" : "light"}.png`;
  await page.screenshot({ path: out });
  console.log("saved", out);
  if (errors.length) console.log("errors:\n" + errors.join("\n"));
  await ctx.close();
}
await browser.close();
