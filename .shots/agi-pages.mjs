// Memory page + Automations (proposed / quiet) with mocked routes — screenshots for a visual check.
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";
const base = process.env.ASB_UI || "http://localhost:5187";
const dark = process.argv.includes("dark");
const lifecycle = { capacity: 4, maxDurationSec: 3600, idleTimeoutSec: 900 };
const now = Date.now();
const notes = [
  { id: "n1", text: "Tests run with `npx tsx --test test/*.test.ts` from PowerShell; 16 Windows failures are expected", at: now - 3600e3, source: "pool-1", repo: "HatriGt/agent-sandbox", pinned: true },
  { id: "n2", text: "asked which chart library → operator chose pure SVG, no library", at: now - 7200e3, source: "pool-1", repo: "HatriGt/agent-sandbox" },
  { id: "n3", text: "Operator prefers short replies and no card layouts", at: now - 86400e3, source: "pool-0" },
];
const trig = (o) => ({ id: o.id, owner: "me", kind: "schedule", name: o.name, taskTemplate: o.task, concurrency: 1, prComment: false, enabled: o.enabled ?? true, quiet: o.quiet ?? false, proposed: o.proposed ?? false, spec: { cron: o.cron ?? "*/30 * * * *", tz: "UTC" }, lastFired: o.lastFired ?? null, nextFire: now + 600e3, lastResult: null, hasPayload: false, hasSigningSecret: false, createdAt: now - 1e6, updatedAt: now - 1e5, when: o.when ?? "every 30 min", active: 0, ...(o.counts ? { counts: o.counts } : {}) });
const triggers = [
  trig({ id: "t1", name: "Re-check LORO sync every hour", task: "Check runLoroSync errors in aqa02 logs", cron: "0 * * * *", when: "hourly", enabled: false, proposed: true, quiet: true }),
  trig({ id: "t2", name: "Failing CI on main", task: "gh run list --branch main --status failure --limit 5 …", quiet: true, lastFired: now - 1800e3, counts: { checked: 12, reports: 1 } }),
  trig({ id: "t3", name: "Nightly deps report", task: "npm outdated and summarise", cron: "0 3 * * *", when: "daily 03:00" }),
];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: dark ? "dark" : "light" });
await ctx.addInitScript(() => { localStorage.setItem("asb-token", "devtoken123"); localStorage.setItem("asb-hub-howto-done", "1"); });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.route("**/fleet.json*", (r) => r.fulfill({ json: { boxes: [], lifecycle } }));
await page.route("**/monitor.json*", (r) => r.fulfill({ json: { boxes: [], lifecycle } }));
await page.route("**/memory-notes.json*", (r) => r.fulfill({ json: { enabled: true, notes } }));
await page.route("**/triggers.json*", (r) => r.fulfill({ json: { triggers } }));
await page.route("**/harnesses.json*", (r) => r.fulfill({ json: { harnesses: [] } }));
await page.route("**/trigger-deliveries.json*", (r) => r.fulfill({ json: { deliveries: [] } }));
await page.goto(`${base}/dashboard/memory`, { waitUntil: "load" });
await page.waitForTimeout(1200);
await page.screenshot({ path: `.shots/out/memory${dark ? "-dark" : ""}.png` });
const memText = await page.locator("main").innerText().catch(() => "");
await page.goto(`${base}/dashboard/automations`, { waitUntil: "load" });
await page.waitForTimeout(1200);
await page.screenshot({ path: `.shots/out/automations${dark ? "-dark" : ""}.png` });
const autoText = await page.locator("main").innerText().catch(() => "");
const ok = /Remember|Memory/i.test(memText) && /pure SVG/.test(memText) && /Proposed/i.test(autoText) && /checked 12/.test(autoText);
console.log(ok ? "PASS" : "FAIL", "| memory:", /pure SVG/.test(memText), "| proposed:", /Proposed/i.test(autoText), "| counts:", /checked 12/.test(autoText));
console.log("errors:", errors.length ? errors.join(" | ") : "none");
await browser.close();
