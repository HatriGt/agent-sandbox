// The Hub's run-settings menu: the list, the box-host panel, the agent panel, the chip.
// Usage: node .shots/hub-settings-shot.mjs [--dark] [--w=1280]   (Vite on :5173; data routes mocked)
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";

const dark = process.argv.includes("--dark");
const W = Number((process.argv.find((a) => a.startsWith("--w=")) ?? "--w=1280").slice(4));
const base = process.env.ASB_UI || "http://localhost:5173";
const browser = await chromium.launch();
const fleet = { boxes: [], lifecycle: { capacity: 4, maxDurationSec: 3600, idleTimeoutSec: 900 } };
const models = { default: "ak-claude-opus-4.8", current: "ak-claude-opus-4.8", models: [{ id: "ak-claude-opus-4.8", label: "Opus 5.5", tier: "opus" }] };
const prefs = {
  defaultAgent: "claude",
  agents: [
    { id: "claude", label: "Claude Code", supervised: true },
    { id: "omp", label: "oh-my-pi", supervised: true },
    { id: "codex", label: "Codex CLI", supervised: false },
    { id: "opencode", label: "OpenCode", supervised: true },
  ],
};
const host = (id, name, extra) => ({ id, name, provider: "freestyle", primary: false, ssh: "a+root:…@beta-ssh.freestyle.sh", enabled: true, warm: false, priority: 0, sleepAfterMs: 300000, maxBoxes: 4, running: 0, reserved: 0, asleep: true, sleepSince: 0, unreachable: false, lastSweepAt: Date.now(), ...extra });
const hosts = {
  capacity: 16,
  providers: [],
  hosts: [
    host("freestyle-a", "Freestyle account A", {}),
    host("freestyle-b", "Freestyle account B", { asleep: false, running: 1 }),
    host("instabox-a", "instabox-a", { provider: "instabox", ssh: "ibssh_…@ssh.instabox.sh", maxBoxes: 3 }),
    host("primary", "Primary host", { primary: true, provider: "static", ssh: "root@host.docker.internal", priority: 10, asleep: false, maxBoxes: 5, running: 2 }),
    host("old-box", "Old box", { priority: 20, asleep: false, unreachable: true }),
  ],
};
const ctx = await browser.newContext({ viewport: { width: W, height: 860 }, colorScheme: dark ? "dark" : "light" });
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
await page.route("**/agent-prefs.json*", (r) => r.fulfill({ json: prefs }));
await page.route("**/hosts.json*", (r) => r.fulfill({ json: hosts }));
await page.route("**/harnesses.json*", (r) => r.fulfill({ json: { harnesses: [] } }));
await page.route("**/workflows.json*", (r) => r.fulfill({ json: { workflows: [] } }));
await page.goto(base + "/dashboard/", { waitUntil: "load" });
await page.waitForTimeout(1800);
const tag = `hub-settings${dark ? "-dark" : ""}`;
const shot = (name) => page.screenshot({ path: `.shots/out/${tag}-${name}.png`, clip: { x: 420, y: 180, width: 860, height: 620 } });
const more = page.locator("[data-composer-menu=more]").first();
if (!(await more.count())) {
  console.log("no run-settings trigger found");
  await browser.close();
  process.exit(1);
}
await more.click();
await page.waitForTimeout(400);
await shot("list");
await page.getByRole("button", { name: /^Box host/ }).click();
await page.waitForTimeout(350);
await shot("host");
await page.getByRole("radio", { name: /instabox-a/ }).click();
await page.waitForTimeout(350);
await shot("list-after-pick");
await page.getByRole("button", { name: /^Agent/ }).click();
await page.waitForTimeout(350);
await shot("agent");
await page.keyboard.press("Escape");
await page.waitForTimeout(350);
await shot("chip");
// The chip opens the menu straight on its panel.
await page.getByRole("button", { name: /^on instabox-a/ }).click();
await page.waitForTimeout(400);
await shot("chip-opens-panel");
const panel = page.getByRole("dialog", { name: "Run settings" });
const box = await panel.boundingBox();
const scroll = await panel.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight }));
console.log("saved", tag, "panel", box && { w: Math.round(box.width), h: Math.round(box.height) }, "overflow", scroll, errors.length ? `errors: ${errors.join(" | ")}` : "no page errors");
await browser.close();
