// Hub composer with attachments: a long paste → "Pasted text" chip, a dropped PDF card, the + menu.
// Usage: node .shots/hub-attach-shot.mjs [--dark] [--w=1280]   (Vite on :5173; fleet/models mocked)
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";

const dark = process.argv.includes("--dark");
const W = Number((process.argv.find((a) => a.startsWith("--w=")) ?? "--w=1280").slice(4));
const base = process.env.ASB_UI || "http://localhost:5173";
const browser = await chromium.launch();
const fleet = { boxes: [], lifecycle: { capacity: 4, maxDurationSec: 3600, idleTimeoutSec: 900 } };
const models = { default: "ak-claude-opus-4.8", current: "ak-claude-opus-4.8", models: [{ id: "ak-claude-opus-4.8", label: "Claude Opus 4.8", tier: "opus" }] };
const ctx = await browser.newContext({ viewport: { width: W, height: 820 }, colorScheme: dark ? "dark" : "light", hasTouch: W < 500, isMobile: W < 500 });
await ctx.addInitScript((d) => {
  localStorage.setItem("asb-token", "devtoken123");
  localStorage.setItem("asb-hub-howto-done", "1");
  localStorage.setItem("asb-dark", d ? "1" : "0");
}, dark);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.route("**/fleet.json*", (r) => r.fulfill({ json: fleet }));
await page.route("**/monitor.json*", (r) => r.fulfill({ json: fleet }));
await page.route("**/models.json*", (r) => r.fulfill({ json: models }));
await page.goto(base + "/dashboard/", { waitUntil: "load" });
await page.waitForTimeout(1800);
const tag = `hub-attach-${W}${dark ? "-dark" : ""}`;
const ta = page.locator("#new-task");
await ta.click();
await ta.fill("");
await ta.type("Summarise the spec and list what the limiter must change.");
await page.evaluate(() => {
  const el = document.getElementById("new-task");
  const text = Array.from({ length: 45 }, (_, i) => `${i + 1}. Requirement ${i + 1}: clients above the limit receive 429 with Retry-After set to the bucket size.`).join("\n");
  const dt = new DataTransfer();
  dt.setData("text/plain", text);
  el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
});
await page.waitForTimeout(300);
await page.evaluate(() => {
  const root = document.getElementById("new-task").closest("[class*='composer-depth']");
  const dt = new DataTransfer();
  dt.items.add(new File(["%PDF-1.4 probe".repeat(9000)], "Limiter spec v2.pdf", { type: "application/pdf" }));
  dt.items.add(new File([JSON.stringify({ window: 60000, buckets: 6 }, null, 2)], "config.json", { type: "application/json" }));
  root.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
});
await page.waitForTimeout(600);
await page.screenshot({ path: `.shots/out/${tag}-chips.png` });
const plus = page.locator("[data-composer-menu=plus]").first();
if (await plus.count()) {
  await plus.click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `.shots/out/${tag}-plus.png` });
  await page.keyboard.press("Escape");
}
await page.getByRole("button", { name: /^Preview Limiter spec/ }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `.shots/out/${tag}-pdf-preview.png` });
console.log("saved", tag, errors.length ? `errors: ${errors.join(" | ")}` : "no page errors");
await browser.close();
