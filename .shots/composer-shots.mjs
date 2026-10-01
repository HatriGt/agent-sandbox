// Composer screenshots: Hub composer at 390/1280 in light/dark, plus the `/` skill menu and
// (when present) the toolbar menus. Usage: node .shots/composer-shots.mjs <prefix>
// Writes .shots/out/<prefix>-<width>-<theme>[-state].png. Needs Vite on :5173 + a local controller.
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";

const prefix = process.argv[2] || "composer";
const base = process.env.ASB_UI || "http://localhost:5173";
const browser = await chromium.launch();
const fleet = { boxes: [], lifecycle: { capacity: 4, maxDurationSec: 3600, idleTimeoutSec: 900 } };
const models = { default: "ak-claude-opus-4.8", current: "ak-claude-opus-4.8", models: [
  { id: "ak-claude-opus-4.8", label: "Claude Opus 4.8", tier: "opus" },
  { id: "ak-claude-sonnet-4.5", label: "Claude Sonnet 4.5", tier: "sonnet" },
  { id: "ak-claude-haiku-4.5", label: "Claude Haiku 4.5", tier: "haiku" },
] };
const harnesses = [
  { id: "careful", name: "Careful reviewer", description: "Plans first, runs tests, small PRs", builtin: true, rules: {} },
  { id: "fast", name: "Fast fixer", description: "Sonnet, no plan step", builtin: true, rules: {} },
];
// Optional menu states: [name, trigger selector]. Missing triggers are skipped (the "before" UI).
const menus = [
  ["plus", "[data-composer-menu=plus]"],
  ["skills", "[data-composer-menu=skills]"],
  ["model", "[data-composer-menu=model]"],
  ["harness", "[data-composer-menu=harness]"],
  ["more", "[data-composer-menu=more]"],
];
for (const dark of [false, true]) {
  for (const w of [390, 1280]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 820 }, colorScheme: dark ? "dark" : "light" });
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
    await page.route("**/harnesses.json*", (r) => r.fulfill({ json: { harnesses } }));
    await page.goto(base + "/dashboard/", { waitUntil: "load" });
    await page.waitForTimeout(1800);
    const tag = `${prefix}-${w}-${dark ? "dark" : "light"}`;
    await page.screenshot({ path: `.shots/out/${tag}.png` });
    const ta = page.locator("#new-task");
    await ta.click();
    await ta.fill("");
    await ta.type("/");
    await page.waitForTimeout(500);
    await page.screenshot({ path: `.shots/out/${tag}-slash.png` });
    await page.keyboard.press("Enter");
    await ta.type("tidy the README");
    await page.waitForTimeout(400);
    await page.screenshot({ path: `.shots/out/${tag}-skill-chip.png` });
    for (const [name, sel] of menus) {
      const t = page.locator(sel).first();
      if (!(await t.count()) || !(await t.isVisible())) continue;
      await t.click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `.shots/out/${tag}-${name}.png` });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(250);
    }
    console.log("saved", tag, errors.slice(0, 3).join(" | "));
    await ctx.close();
  }
}
await browser.close();

