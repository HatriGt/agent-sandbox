// Screenshot every console page over the local controller + Vite, fleet mocked with three boxes.
//   node .shots/pages-tour.mjs [--dark] [--only=fleet,account] [--tag=before]
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";
import { serveWorktreeFonts } from "./overflow-probe.mjs";

const flags = process.argv.slice(2);
const flag = (k, d) => flags.find((f) => f.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const dark = flags.includes("--dark");
const tag = flag("tag", "");
const only = flag("only", "").split(",").filter(Boolean);
const base = process.env.ASB_UI || "http://localhost:5173";
const now = Date.now();
const mk = (name, runState, title, extra = {}) => ({ name, boxStatus: "running", task: title, runState, uptime: "12m", cpu: "14%", mem: "1.2G/4G", memUsage: { usedMib: 1200, totalMib: 4096 }, disk: { usedMib: 3000, totalMib: 20480 }, lastOutputAt: now - 20_000, title, repos: [{ name: "orders-api", branch: "main" }], agent: "claude", ...extra });
const boxes = [
  mk("quiet-otter", "waiting", "Claims audit: fix the member split", { question: "Fail open or closed when Redis is unreachable?" }),
  mk("brave-heron", "running", "Migrate the invoice worker to the new queue"),
  mk("calm-finch", "done", "Nightly dependency report", { boxStatus: "sleeping" }),
];
const lifecycle = { idleTimeoutSec: 1800, maxDurationSec: 14400, capacity: 8, poolSize: 2, sleepTtlSec: 604800, memoryTiers: ["4G"], memoryDefault: "4G", diskTiers: ["20G"] };
const pages = ["hub", "fleet", "account", "integrations", "memory", "automations", "skills", "harnesses", "playbooks", "history", "activity", "admin", "connect"];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: dark ? "dark" : "light", deviceScaleFactor: 1 });
await ctx.addInitScript((d) => { localStorage.setItem("asb-token", "devtoken123"); localStorage.setItem("asb-dark", d ? "1" : "0"); localStorage.setItem("asb-hub-howto-done", "1"); }, dark);
await serveWorktreeFonts(ctx);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const json = (route, body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
await page.route("**/*", (route) => {
  const u = new URL(route.request().url());
  if (u.pathname === "/fleet.json") return json(route, { boxes, lifecycle, at: now });
  if (u.pathname === "/monitor.json") return json(route, { boxes, lifecycle });
  return route.continue();
});
for (const p of pages) {
  if (only.length && !only.includes(p)) continue;
  const path = p === "hub" ? "/dashboard/" : `/dashboard/${p}`;
  await page.goto(`${base}${path}`, { waitUntil: "load", timeout: 30000 }).catch((e) => errors.push(`${p}: ${e.message}`));
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `.shots/out/page-${p}${dark ? "-dark" : ""}${tag ? "-" + tag : ""}.png` });
  console.log(p, (await page.title()).slice(0, 40));
}
console.log("errors:", errors.filter((e) => !/404/.test(e)).join(" | ") || "none");
await browser.close();
