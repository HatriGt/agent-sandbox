import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("https://amicro.dev/mono-charts", { waitUntil: "networkidle", timeout: 60000 }).catch((e) => console.log("nav:", e.message));
await page.waitForTimeout(2500);
const h = await page.evaluate(() => document.documentElement.scrollHeight);
console.log("height", h);
for (let i = 0; i < Math.min(6, Math.ceil(h / 900)); i++) {
  await page.evaluate((y) => window.scrollTo(0, y), i * 900);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `.shots/out/ref-mono-${i}.png` });
}
console.log(await page.evaluate(() => document.body.innerText.slice(0, 1500)));
await browser.close();
