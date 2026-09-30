// Harnesses page with fully mocked routes: node .shots/harness-flows.mjs [--w=1440 --h=900]
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";

const args = process.argv.slice(2);
const w = Number(args.find((a) => a.startsWith("--w="))?.slice(4) ?? 1440);
const h = Number(args.find((a) => a.startsWith("--h="))?.slice(4) ?? 900);
const now = Date.now();
const rules = (a, p, v) => ({ askBeforeGuess: a, planFirst: p, verifyOnDone: v });
const harnesses = [
  { id: "h_careful", name: "Careful reviewer", description: "Plans first, tests before done", driver: "claude", model: "claude-sonnet-4-6", skills: ["review-pr"], rules: rules(true, true, true), verifyCommand: "npm test", egress: ["registry.npmjs.org"], budget: { maxMinutes: 60, maxUsd: 2 }, createdAt: now - 864e5, updatedAt: now - 36e5 },
  { id: "h_fast", name: "Fast fixer", driver: "codex", rules: rules(false, false, false), createdAt: now - 2 * 864e5, updatedAt: now - 2 * 864e5 },
  { id: "h_import", name: "acme strict", rules: rules(true, false, true), verifyCommand: "./scripts/check.sh && npm run lint", egress: ["api.acme.dev"], rulesMd: "Never touch migrations.", needsReview: true, unresolvedProvider: { kind: "openrouter", label: "team OR" }, origin: { kind: "github", source: "acme/harnesses/strict", at: now }, createdAt: now, updatedAt: now },
];
const facts = (box, v, cost) => ({ box, state: "done", verified: v, questions: v ? 0 : 1, tokens: { input: 48210, output: 6120 }, costUsd: cost, durationMs: 412000, files: ["src/a.ts", "src/b.ts"], headline: "" });
const mocks = {
  "/harnesses.json": { harnesses, limits: { maxHarnesses: 50 } },
  "/harness-compares.json": { compares: [{ id: "c1", task: "Add input validation to the signup form", createdAt: now - 6e5, sides: [{ side: "a" }, { side: "b" }] }] },
  "/harness-compares.json?id=c1": { id: "c1", task: "x", createdAt: now, sides: [{ side: "a", harnessId: "h_careful", harnessName: "Careful reviewer", box: "box-a1", source: "archive", facts: facts("box-a1", true, 0.412) }, { side: "b", harnessId: "h_fast", harnessName: "Fast fixer", box: "box-b2", source: "live", facts: { ...facts("box-b2", null, null), tokens: null } }] },
  "/agent-prefs.json": { defaultAgent: "claude", agents: [{ id: "claude", label: "Claude Code", supervised: true }, { id: "codex", label: "Codex", supervised: false }] },
  "/skills.json": { skills: [{ name: "review-pr", description: "Review a PR", enabled: true, files: [] }, { name: "write-tests", description: "", enabled: false, files: [] }] },
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
await ctx.addInitScript(() => localStorage.setItem("asb-token", "devtoken123"));
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.route(/\.json(\?|$)/, (route) => {
  const u = new URL(route.request().url());
  const key = u.pathname.replace(/^\/dashboard/, "") + (u.searchParams.get("id") ? `?id=${u.searchParams.get("id")}` : "");
  const body = mocks[key] ?? mocks[u.pathname] ?? {};
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
});
const shot = (n) => page.screenshot({ path: `.shots/hn-${n}-${w}.png`, fullPage: true });
await page.goto("http://localhost:5173/dashboard/harnesses", { waitUntil: "load" });
await page.waitForTimeout(1800);
await shot("saved");
await page.click("button:has-text('Review')").catch((e) => errors.push("review: " + e.message));
await page.waitForTimeout(600);
await shot("review");
await page.goto("http://localhost:5173/dashboard/harnesses", { waitUntil: "load" });
await page.waitForTimeout(1500);
await page.click("button:has-text('Add input validation')").catch((e) => errors.push("compare: " + e.message));
await page.waitForTimeout(800);
await page.locator("table").scrollIntoViewIfNeeded().catch(() => {});
await shot("compare");
for (const tab of ["Drivers", "Hooks", "Egress"]) {
  await page.click(`[role=tab]:has-text('${tab}')`).catch((e) => errors.push(tab + ": " + e.message));
  await page.waitForTimeout(500);
  await shot(tab.toLowerCase());
}
console.log("done", w, errors.slice(0, 10).join("\n"));
await browser.close();
