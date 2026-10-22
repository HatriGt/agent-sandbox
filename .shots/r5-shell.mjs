// Round 5 shell: the Hub and History at 1280 and 1440, proving the app-shell rules hold — no table
// header clipped and no table past its card, surface buttons press (transform transition + scale
// 0.96 while :active), sidebar machine rows are 36px, the History toolbar is one row at 1280, and
// the activity card is a strip for a sparse archive and a grid for a dense one.
//
//   node .shots/r5-shell.mjs [--dark]        (ASB_UI defaults to http://localhost:5173)
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";
import { serveWorktreeFonts } from "./overflow-probe.mjs";

const flags = process.argv.slice(2);
const dark = flags.includes("--dark");
const base = process.env.ASB_UI || "http://localhost:5173";
const ms = Date.now();
const now = Math.floor(ms / 1000);

const box = (name, role, boxStatus, runState, title, extra = {}) => ({ name, role, boxStatus, runState, title, task: title, uptime: "6m", cpu: "1%", mem: "640MiB / 4GiB", lastOutputAt: now - 4, agent: "claude", ...extra });
const boxes = [
  box("asb-session-a91b0e44", "session", "Running", "running", "Auth middleware walkthrough"),
  box("asb-pool-c22de9f1", "pool-claimed", "Running", "running", "Fix flaky MCP probe tests", { lastOutputAt: now - 1 }),
  box("asb-session-5510beef", "session", "Running", "done", "Bump Vite to 6", { exitCode: 0, lastOutputAt: now - 1260 }),
  box("asb-session-0d0d1e2f", "session", "Stopped", "done", "Review PR #142", { exitCode: 0, lastOutputAt: now - 7200, asleepSec: 3600, kept: true }),
  box("asb-session-e7e7a0b9", "session", "Stopped", "done", "Rate limiter (TDD)", { exitCode: 1, lastOutputAt: now - 20000, asleepSec: 15000 }),
  { name: "asb-pool-ffee0011", role: "pool-free", boxStatus: "Running", runState: "idle", uptime: "1h 2m", cpu: "0%", mem: "310MiB / 4GiB" },
];
const lifecycle = { capacity: 8, poolSize: 1, idleTimeoutSec: 900, maxDurationSec: 7200, sleepTtlSec: 86400, memoryTiers: ["2G", "4G", "8G"], memoryDefault: "4G" };
const runs = Array.from({ length: 6 }, (_, i) => ({ id: 31 - i, box: `asb-session-dead000${i}`, owner: "ak", task: ["Add dark mode to the marketing site", "Find why the nightly build is slow", "Write integration tests for the webhook receiver", "Explain the deploy pipeline", "Rename the User model to Account", "Fix the flaky suite"][i], state: i === 1 ? "failed" : "done", exitCode: i === 1 ? 1 : 0, startedAt: ms - (i + 1) * 86400e3, endedAt: ms - (i + 1) * 86400e3 + 1500e3, archivedAt: ms - (i + 1) * 86400e3 + 1600e3, headline: "Added a theme toggle and dark palette; PR #88 opened." }));
const ledger = {
  totals: { runs: runs.length, done: 5, failed: 1, checked: 2, passed: 2, inputTokens: 412_300, outputTokens: 58_900, withUsage: 3, costUsd: null, withCost: 0 },
  rows: runs.map((r, i) => ({ ...r, startedBy: i % 2 ? "web" : "schedule", agent: "claude", verified: i < 2 ? true : null, inputTokens: 100_000, outputTokens: 15_000, costUsd: i === 0 ? 0.42 : null, planDone: null, planTotal: null, workflowId: null })),
};
// Sparse: 40 runs over ~6 days. Dense: one run a day for 60 days.
const sparse = { runs: Array.from({ length: 40 }, (_, i) => ({ t: ms - i * 3.7 * 3600e3, failed: i % 7 === 0 })) };
const dense = { runs: Array.from({ length: 60 }, (_, i) => ({ t: ms - i * 86400e3, failed: i % 9 === 0 })) };
const me = { kind: "user", mode: "saas", id: "u_1", login: "ak", name: "Arun K", role: "admin", via: "session", email: "ak@example.com", avatarUrl: null, github: true, hasPassword: true, maxBoxes: 8, plan: "trial", trialEndsAt: new Date(ms + 9 * 86400e3).toISOString(), daysLeft: 9, expired: false, billingUrl: null };

const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"} ${name}${extra ? ` (${extra})` : ""}`);

const browser = await chromium.launch();
let activity = sparse;
async function open(width, route) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: dark ? "dark" : "light", deviceScaleFactor: 1 });
  await ctx.addInitScript((dark) => {
    localStorage.setItem("asb-token", "devtoken123");
    localStorage.setItem("asb-hub-howto-done", "1");
    localStorage.setItem("asb-dark", dark ? "1" : "0");
    for (const k of Object.keys(localStorage)) if (k.startsWith("asb.cols.")) localStorage.removeItem(k);
    sessionStorage.setItem("asb-session-runs", JSON.stringify([{ box: "asb-pool-c22de9f1", task: "Fix flaky MCP probe tests", startedAt: Date.now() - 120e3 }]));
  }, dark);
  await serveWorktreeFonts(ctx);
  const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  // Everything the page asks for and this fixture does not model answers empty rather than 404.
  await ctx.route((u) => new URL(u).pathname.endsWith(".json"), (r) => r.fulfill(json({})));
  const mock = (path, body) => ctx.route((u) => new URL(u).pathname === path, (r) => r.fulfill(json(typeof body === "function" ? body() : body)));
  await mock("/fleet.json", { boxes, lifecycle, at: ms });
  await mock("/monitor.json", boxes);
  await mock("/auth/config.json", { mode: "saas", providers: ["github"], tokenLogin: true, password: true, signup: true, passwordMin: 10, trialDays: 14, beta: true });
  await mock("/me.json", me);
  await mock("/account.json", me);
  await mock("/history.json", { runs });
  await mock("/history/ledger.json", ledger);
  await mock("/history/activity.json", () => activity);
  await mock("/triggers.json", { triggers: [] });
  await mock("/agent-prefs.json", { defaultAgent: "claude", agents: [{ id: "claude", label: "Claude Code" }] });
  await mock("/models.json", { models: [{ id: "claude-sonnet-4-5", label: "Sonnet 4.5" }], default: "claude-sonnet-4-5" });
  // The Hub's shelves: present and empty, in the shapes the app expects.
  for (const [path, body] of Object.entries({
    "/skills.json": { skills: [] }, "/harnesses.json": { harnesses: [], limits: {} }, "/workflows.json": { limits: {}, dir: "", workflows: [] }, "/repos.json": { repos: [] },
    "/accounts.json": { accounts: [], oauth: true }, "/audit.json": { events: [] }, "/intake.json": { items: [] }, "/memory-notes.json": { enabled: true, notes: [] },
    "/pr-followups.json": { prefs: {}, hook: null, installs: [] }, "/secrets.json": { secrets: [] }, "/providers.json": { providers: [] }, "/mcp-servers.json": { servers: [], config: { mcpServers: {} } },
    "/repo-setup.json": { profiles: [] }, "/notify.json": { url: "", events: {}, fallbackConfigured: true }, "/users.json": { users: [] }, "/api-keys.json": { keys: [] }, "/sessions.json": { sessions: [] }, "/devices.json": { sessions: [] },
  })) await mock(path, body);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/favicon|net::/.test(m.text()) && errors.push(m.text().slice(0, 160)));
  await page.goto(base + route, { waitUntil: "load", timeout: 20000 });
  await page.waitForTimeout(1200);
  return { ctx, page, errors };
}

// Every visible header's label sits inside its cell, and the table's right edge sits inside the card.
const tableFit = async (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("[data-slot=table]")]
      .filter((t) => t.offsetParent)
      .map((t) => {
        const scroller = t.closest("[data-slot=table-container]") ?? t.parentElement;
        const heads = [...t.tHead.rows[0].cells].filter((th) => th.offsetParent && !th.querySelector(".sr-only"));
        // The label (sort button or text) must end inside the cell and not truncate; the resize grip straddles the edge on purpose.
        const clipped = heads
          .filter((th) => {
            let right = -Infinity;
            let truncated = false;
            for (const node of th.childNodes) {
              if (node instanceof HTMLElement && node.classList.contains("dt-resize")) continue;
              const r = document.createRange();
              r.selectNode(node);
              for (const box of r.getClientRects()) if (box.width) right = Math.max(right, box.right);
              if (node instanceof HTMLElement && node.scrollWidth > node.clientWidth + 1) truncated = true;
            }
            return right > th.getBoundingClientRect().right + 0.5 || truncated;
          })
          .map((th) => th.innerText.trim());
        return { table: Math.round(t.getBoundingClientRect().width), box: Math.round(scroller.getBoundingClientRect().width), over: t.getBoundingClientRect().right - scroller.getBoundingClientRect().right, clipped };
      })
  );

for (const width of [1280, 1440]) {
  for (const route of ["/dashboard/", "/dashboard/history"]) {
    const { ctx, page, errors } = await open(width, route);
    const tables = await tableFit(page);
    const name = route === "/dashboard/" ? "hub" : "history";
    check(`${name}@${width}: table inside its card`, tables.length > 0 && tables.every((t) => t.over <= 0.5), tables.map((t) => `${t.table}/${t.box}`).join(" "));
    check(`${name}@${width}: no clipped header`, tables.every((t) => !t.clipped.length), tables.flatMap((t) => t.clipped).join(",") || "none");
    if (route === "/dashboard/") {
      const rows = await page.$$eval('nav[aria-label="Machines"] ul li button', (els) => els.map((b) => Math.round(b.getBoundingClientRect().height)));
      check(`hub@${width}: sidebar machine rows are 36px`, rows.length > 0 && rows.every((h) => h === 36), `rows=${rows.join(",")}`);
      const states = await page.$$eval('nav[aria-label="Machines"] ul li button', (els) => els.map((b) => [...b.querySelectorAll("span")].some((s) => s.className.includes("rounded-full") && s.className.includes("size-1.5"))));
      check(`hub@${width}: every machine row carries a dot + word state`, states.every(Boolean), `${states.filter(Boolean).length}/${states.length}`);
      // The trailing "last action" and machine columns line up down the list.
      const trailing = await page.$$eval('[aria-labelledby="live-now"] ul > li > button', (els) => els.map((b) => { const s = b.querySelectorAll(":scope > span"); return [Math.round(s[s.length - 2].getBoundingClientRect().left), Math.round(s[s.length - 1].getBoundingClientRect().left)].join(":"); }));
      check(`hub@${width}: live rows share one column grid`, trailing.length > 1 && new Set(trailing).size === 1, `${trailing.join(" ")}`);
      const press = await page.evaluate(() => {
        const btns = [...document.querySelectorAll("[data-slot=button]")].filter((b) => b.offsetParent);
        const surface = btns.filter((b) => !["ghost", "link"].includes(b.dataset.variant));
        const bad = surface.filter((b) => !/\b(transform|scale)\b/.test(getComputedStyle(b).transitionProperty)).map((b) => b.innerText.trim() || b.getAttribute("aria-label"));
        return { surface: surface.length, bad };
      });
      check(`hub@${width}: every surface button transitions its transform`, press.surface > 0 && !press.bad.length, `surface=${press.surface} bad=${press.bad.join("|")}`);
      const held = page.locator('[data-slot=button]:not([data-variant="ghost"]):not([data-variant="link"]):visible').first();
      const b = await held.boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(200);
      const pressed = await held.evaluate((el) => ({ variant: el.dataset.variant, scale: getComputedStyle(el).scale, transform: getComputedStyle(el).transform }));
      await page.mouse.up();
      check(`hub@${width}: a held surface button sits at scale 0.96`, pressed.scale === "0.96" && pressed.transform === "none", JSON.stringify(pressed));
      const ghost = await page.evaluate(() => [...document.querySelectorAll('[data-slot=button][data-variant="ghost"]')].filter((b) => b.offsetParent).some((b) => b.className.includes("active:scale")));
      check(`hub@${width}: ghost buttons do not press`, !ghost);
      const warm = await page.evaluate(() => { const b = [...document.querySelectorAll("aside button, nav ~ * button")].find((x) => /warm machine/.test(x.innerText)); return b && { h: Math.round(b.getBoundingClientRect().height), text: b.innerText.trim() }; });
      check(`hub@${width}: warm callout is one 28px line`, warm?.h === 28 && /^1 warm machine ready · starts in seconds$/.test(warm.text), JSON.stringify(warm));
    } else {
      const toolbar = await page.$$eval("[data-slot=data-table] > div:first-child > *, [data-slot=data-table] > div:first-child > div > *", (els) => els.filter((e) => e.offsetParent).map((e) => Math.round(e.getBoundingClientRect().top)));
      check(`history@${width}: toolbar is one row`, toolbar.length > 3 && new Set(toolbar).size === 1, `tops=${[...new Set(toolbar)].join(",")} controls=${toolbar.length}`);
      const heights = await page.$$eval("[data-slot=data-table] > div:first-child label, [data-slot=data-table] > div:first-child [role=radio], [data-slot=data-table] > div:first-child select", (els) => els.map((e) => Math.round(e.closest("label, [role=radio]").getBoundingClientRect().height)));
      check(`history@${width}: controls share a 32px height`, heights.length > 0 && heights.every((h) => h === 32), `heights=${[...new Set(heights)].join(",")}`);
      check(`history@${width}: agent select hidden with one agent`, (await page.locator('select[aria-label="Agent"]').count()) === 0);
      const grid = await page.$eval('[aria-label="Run activity"] [role=grid]', (g) => ({ label: g.getAttribute("aria-label"), rows: g.querySelectorAll("[role=row]").length, perRow: g.querySelector("[role=row]").children.length, cell: g.querySelector("[role=gridcell]")?.getBoundingClientRect().width }));
      check(`history@${width}: sparse archive draws a strip`, grid.perRow === 1 && grid.rows === 42 && /42 days/.test(grid.label) && Math.round(grid.cell) === 12, JSON.stringify(grid));
      const card = await page.$eval('[aria-label="Run activity"]', (s) => Math.round(s.getBoundingClientRect().height));
      check(`history@${width}: strip card under 130px`, card < 130, `h=${card}`);
      const shadows = await page.$$eval('[aria-label="Run activity"], [aria-labelledby="live-now"] ul', (els) => els.map((e) => getComputedStyle(e).boxShadow));
      check(`history@${width}: activity card has no shadow`, shadows.every((s) => s === "none"), shadows.join("|"));
      if (width === 1440) await page.screenshot({ path: `.shots/out/r5-shell-history-strip${dark ? "-dark" : ""}.png` });
    }
    check(`${name}@${width}: no page errors`, !errors.length, errors.join("|"));
    await ctx.close();
  }
}

// A dense archive keeps the week grid.
activity = dense;
{
  const { ctx, page } = await open(1440, "/dashboard/history");
  const grid = await page.$eval('[aria-label="Run activity"] [role=grid]', (g) => ({ label: g.getAttribute("aria-label"), rows: g.querySelectorAll("[role=row]").length, perRow: g.querySelector("[role=row]").children.length }));
  check("history dense: 13-week grid", grid.rows === 13 && grid.perRow === 7 && /13 weeks/.test(grid.label), JSON.stringify(grid));
  await page.screenshot({ path: `.shots/out/r5-shell-history-grid${dark ? "-dark" : ""}.png` });
  await ctx.close();
}

console.log(results.join("\n"));
const pass = results.filter((r) => r.startsWith("PASS")).length;
console.log(`${pass}/${results.length} passed`);
await browser.close();
process.exit(pass === results.length ? 0 : 1);
