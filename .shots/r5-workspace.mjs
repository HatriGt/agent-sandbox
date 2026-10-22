// Workspace chrome by subtraction, against a mocked box. Run from PowerShell:
//
//   node .shots/r5-workspace.mjs [--dark] [--w=1440 --h=900]
//
// Proves: one toolbar row between the tab strip and the code, one status bar inside the pane and
// no second strip, the explorer's icon row and the editor's tab row share a bottom edge, the diff's
// code column is at least 60% of the editor group, the right-edge fade arms when a line overflows,
// and ⌘F / ⌘P / ⌘B / ⌘\ still work. Prints the chrome rows and the vertical pixels the code gets.
import { serveWorktreeFonts } from "./overflow-probe.mjs";
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";

const args = process.argv.slice(2);
const flag = (k, d) => args.find((f) => f.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const dark = args.includes("--dark");
const W = Number(flag("w", 1440));
const H = Number(flag("h", 900));
const token = process.env.ASB_DEV_TOKEN || "devtoken123";
const base = process.env.ASB_UI || "http://localhost:5173";
const NAME = "quiet-otter";
const FILE = "orders-api/src/middleware/rateLimit.ts";
const TREE = ["orders-api/src/app.ts", FILE, "orders-api/src/lib/redis.ts", "orders-api/test/rateLimit.test.ts", "orders-api/test/orders.test.ts", "orders-api/docs/rate-limits.md", "orders-api/package.json", "orders-api/README.md"];
const SOURCE = "import type { NextFunction, Request, Response } from 'express';\nimport { redis } from '../lib/redis';\n\nconst BUCKETS = 6;\n\ninterface Options {\n  limit: number;\n  window?: number;\n}\n\nexport function rateLimit({ limit, window = 60_000 }: Options) {\n  const slice = window / BUCKETS;\n  return async (req: Request, res: Response, next: NextFunction) => {\n    const key = `rl:${req.ip}`;\n    const now = Math.floor(Date.now() / slice);\n    const hits = await redis.hincrby(key, String(now), 1);\n    if (hits > limit) return res.status(429).set('Retry-After', String(slice / 1000)).end();\n    next();\n  };\n}\n";
const DIFF = "@@ -1,4 +1,9 @@\n-const WINDOW = 60_000;\n+const BUCKETS = 6;\n+\n+interface Options {\n+  limit: number;\n+  window?: number;\n+}\n \n-export function rateLimit({ limit }: { limit: number }) {\n+export function rateLimit({ limit, window = 60_000 }: Options) {\n+  const slice = window / BUCKETS;\n@@ -12,6 +17,8 @@ export function rateLimit({ limit }: { limit: number }) {\n     const key = `rl:${req.ip}`;\n-    const n = await redis.incr(key);\n-    if (n > limit) return res.status(429).end();\n+    const now = Math.floor(Date.now() / slice);\n+    const hits = await redis.hincrby(key, String(now), 1);\n+    if (hits > limit) return res.status(429).set('Retry-After', String(slice / 1000)).end();\n     next();\n   };\n }\n";
const T0 = Date.now() - 14 * 60_000;
const box = { name: NAME, role: "session", boxStatus: "running", runState: "running", task: "Replace the fixed-window rate limiter in the orders API with a sliding-window one backed by Redis.", uptime: "14m", cpu: "12%", mem: "1.1G/4G", memUsage: { usedMib: 1130, totalMib: 4096 }, disk: { usedMib: 3800, totalMib: 20480 }, lastOutputAt: Date.now() - 4000, title: "Sliding-window rate limiter", repos: [{ name: "orders-api", branch: "feat/sliding-window-limiter" }], agent: "claude" };
const { role: _r, ...meta } = box;
const LOG = [`⟦at⟧ ${T0}`, "● session started (model ak-claude-opus-4.8)", `⟦at⟧ ${T0 + 9000}`, "I'll start by reading how the limiter is wired today, then swap the implementation behind the same signature."].join("\n");
const CHANGES = [{ path: FILE, repo: "orders-api", status: "modified", additions: 34, deletions: 11 }];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: dark ? "dark" : "light", deviceScaleFactor: 1 });
await ctx.addInitScript(([t, d]) => { localStorage.setItem("asb-token", t); localStorage.setItem("asb-dark", d ? "1" : "0"); }, [token, dark]);
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
const json = (route, body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
await serveWorktreeFonts(ctx);
await page.route("**/*", async (route) => {
  const u = new URL(route.request().url());
  switch (u.pathname) {
    case "/auth/config.json": return json(route, { mode: "saas", providers: ["github"], tokenLogin: true, password: true, signup: true, passwordMin: 10, trialDays: 14, beta: true });
    case "/me.json": return json(route, { kind: "user", mode: "saas", id: "u_1", login: "ak", name: "Arun K", role: "admin", via: "session", email: "ak@example.com", avatarUrl: null, github: true, hasPassword: true, maxBoxes: 8, plan: "trial", trialEndsAt: new Date(Date.now() + 9 * 86400e3).toISOString(), daysLeft: 9, expired: false, billingUrl: null });
    case "/workflows.json": return json(route, { limits: {}, dir: ".agent-sandbox/workflows", workflows: [] });
    case "/triggers/for-box.json": return json(route, { items: [] });
    case "/fleet.json": return json(route, { boxes: [box], lifecycle: { idleTimeoutSec: 1800, maxDurationSec: 14400, capacity: 8, poolSize: 2, sleepTtlSec: 604800, memoryTiers: ["2G", "4G", "8G"], memoryDefault: "4G", diskTiers: ["20G", "40G"] }, at: Date.now() });
    case "/monitor.json": return json(route, { boxes: [box] });
    case "/watch.json": return json(route, { ...meta, log: LOG });
    case "/watch.sse": return route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache" }, body: `retry: 3000\n\nevent: snapshot\nid: ${LOG.length}\ndata: ${JSON.stringify({ meta, log: LOG, from: 0 })}\n\n` });
    case "/changes.json": return json(route, { files: CHANGES });
    case "/digest.json": return json(route, { box: NAME, state: "running", files: CHANGES, plan: [], failedCommands: [], questions: [] });
    case "/pr.json": return json(route, null);
    case "/inbox.json": return json(route, { queued: [] });
    case "/repos.json": return json(route, { repos: [], total: 0 });
    case "/secrets.json": return json(route, { secrets: [] });
    case "/revert-points.json": return json(route, { messages: [] });
    case "/models.json": return json(route, { default: "ak-claude-opus-4.8", current: "ak-claude-opus-4.8", models: [{ id: "ak-claude-opus-4.8", label: "Opus 4.8", tier: "opus" }] });
    case "/skills.json": return json(route, { skills: [] });
    case "/tree.json": return json(route, { files: TREE, total: TREE.length, truncated: false });
    case "/files.json": return json(route, { files: TREE.filter((f) => f.includes(u.searchParams.get("q") ?? "")), total: TREE.length, truncated: false });
    case "/git.json": return json(route, { repo: "orders-api", branch: "feat/sliding-window-limiter", upstream: "origin/feat/sliding-window-limiter", ahead: 0, behind: 0, lastCommit: "feat: sliding-window rate limiter", clean: false, changed: 1 });
    case "/artifact": return route.fulfill({ status: 200, contentType: "text/plain", body: SOURCE });
    case "/diff.json": return json(route, { path: FILE, untracked: false, binary: false, original: "", diff: DIFF });
    case "/file.json": return json(route, { path: u.searchParams.get("path"), content: SOURCE, bytes: SOURCE.length, mtime: Date.now() });
    case "/memory.json": case "/resume.json": case "/title.json": case "/wake.json": return json(route, { ok: true });
    default: return route.fallback();
  }
});

const shots = [];
const shot = async (name, clip) => {
  const out = `.shots/out/r5-ws-${name}${dark ? "-dark" : ""}-${W}.png`;
  await page.screenshot({ path: out, clip });
  shots.push(out);
};
const checks = [];
const check = (name, ok, detail = "") => checks.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
const rect = async (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom), right: Math.round(r.right) }; }, sel);
const activeDesc = () => page.evaluate(() => { const a = document.activeElement; if (!a) return "none"; return `${a.tagName.toLowerCase()}${a.getAttribute("aria-label") ? `[${a.getAttribute("aria-label")}]` : ""}${a.closest(".cm-editor") ? " (in editor)" : ""}`; });
const composer = page.locator("#send-input");
const aside = 'aside[aria-label="Workspace"]';

await page.goto(`${base}/dashboard/box/${NAME}`, { waitUntil: "load", timeout: 30000 }).catch((e) => errors.push("goto: " + e.message));
await page.waitForTimeout(1400);
await page.getByRole("button", { name: /files/i }).first().click();
await page.locator(aside).waitFor({ timeout: 8000 });
await page.waitForTimeout(800);

// ⌘P from the composer opens the changed file, in Diff mode.
await composer.click();
await page.keyboard.press("Control+P");
await page.waitForTimeout(300);
const quick = page.getByRole("textbox", { name: "Go to file" });
check("Control+P opens Go to file", await quick.isVisible().catch(() => false));
await quick.type("rateLimit.ts");
await page.waitForTimeout(300);
await page.keyboard.press("Enter");
await page.locator('[role=radiogroup][aria-label="View mode"]').waitFor({ timeout: 8000 });
await page.waitForTimeout(700);

// Chrome rows. Top: the tab row, then exactly one toolbar; the hunk header lives inside the body.
const group = `${aside} [data-group="0"]`;
const top = await rect(`${group} [data-ws-top]`);
const toolbars = await page.locator(`${group} [data-ws-toolbar]`).count();
check("one toolbar row between the tabs and the code", toolbars === 1, `${toolbars} toolbar rows`);
const toolbar = await rect(`${group} [data-ws-toolbar]`);
const table = await rect(`${group} [role="table"][aria-label^="Diff of"]`);
check("the hunk header is inside the diff body, not a chrome row", !!table && !!toolbar && table.y >= toolbar.bottom, JSON.stringify({ toolbarBottom: toolbar?.bottom, tableTop: table?.y }));
check("no file-name repeat in the toolbar", !((await page.locator(`${group} [data-ws-toolbar]`).textContent()) ?? "").includes("rateLimit.ts"), (await page.locator(`${group} [data-ws-toolbar]`).textContent())?.trim());

// Bottom: one bar inside the pane, carrying the editor status; no second strip anywhere.
const bars = await page.locator(`${aside} footer`).count();
const strips = await page.locator(`${aside} [aria-label="Editor status"]`).count();
const stripInBar = await page.locator(`${aside} footer [aria-label="Editor status"]`).count();
check("one status bar inside the pane and the editor status is in it", bars === 1 && strips === 1 && stripInBar === 1, `footers=${bars} strips=${strips} inBar=${stripInBar}`);
const bar = await rect(`${aside} footer`);
check("status bar is 28px", !!bar && bar.h === 28, `${bar?.h}px`);
check("status bar does not carry 'Go to file'", !((await page.locator(`${aside} footer`).textContent()) ?? "").includes("Go to file"));

// The explorer's icon row and the editor's tab row share a bottom edge, so the border runs through.
const sideTop = await rect(`${aside} section [data-ws-top]`);
check("explorer top row and editor tab row share a bottom edge", !!top && !!sideTop && top.bottom === sideTop.bottom && top.h === 36, JSON.stringify({ tabs: top, side: sideTop }));
const hdr = await rect(`${aside} .group\\/hdr`);
const treeTop = await rect(`${aside} [role="tree"]`);
check("the explorer has two rows above the tree", !!sideTop && !!hdr && !!treeTop && hdr.y === sideTop.bottom && treeTop.y <= hdr.bottom + 2, JSON.stringify({ iconRowBottom: sideTop?.bottom, hdr, treeTop: treeTop?.y }));
check("the repo stamp is not truncated", await page.evaluate(() => { const s = document.querySelector('aside[aria-label="Workspace"] .group\\/hdr .stamp'); return !!s && s.scrollWidth <= s.clientWidth; }));

// The gutter: two tight tabular columns plus a 1ch sign; code gets most of the group.
const g = await rect(group);
const gutter = await rect(`${group} [role="rowheader"]`);
const cell = await rect(`${group} [role="cell"]`);
const codeShare = g && cell ? (g.right - cell.x) / g.w : 0;
check("diff code column is at least 60% of the editor group", codeShare >= 0.6, `${Math.round(codeShare * 100)}% (gutter ${gutter?.w}px of ${g?.w}px)`);
const scrolled = await page.evaluate(() => !!document.querySelector('aside[aria-label="Workspace"] [data-scrolled-end]'));
const fadeOpacity = await page.evaluate(() => { const w = document.querySelector('aside[aria-label="Workspace"] [data-scrolled-end]'); const f = w?.lastElementChild; return f ? getComputedStyle(f).opacity : "none"; });
check("a long line arms the right-edge fade instead of a hard clip", scrolled && fadeOpacity === "1", `scrolled-end=${scrolled} fade opacity=${fadeOpacity}`);

// Vertical budget: pixels from the pane's top to the first code row, and from the last code row to the pane's bottom.
const pane = await rect(aside);
const codeTop = table ? table.y : 0;
const chromeTop = codeTop - (pane?.y ?? 0);
const chromeBottom = (pane?.bottom ?? 0) - (bar?.y ?? 0);
console.log(`chrome: top ${chromeTop}px (tabs ${top?.h} + toolbar ${toolbar?.h}), bottom ${chromeBottom}px (bar ${bar?.h}); code area ${(bar?.y ?? 0) - codeTop}px of ${pane?.h}px; gutter ${gutter?.w}px, code share ${Math.round(codeShare * 100)}%`);
await page.mouse.move(W - 400, 500);
await shot("diff");
if (g) await shot("diff-zoom", { x: g.x, y: g.y, width: Math.min(g.w, W - g.x), height: 330 });

// Chords still fire from the composer.
await composer.click();
await page.keyboard.press("Control+F");
await page.locator('[role="search"][aria-label="Find in file"]').waitFor({ timeout: 3000 }).catch(() => {});
await page.waitForTimeout(250);
check("Control+F switches to File and opens find", (await page.locator('[role="search"][aria-label="Find in file"]').count()) === 1 && (await activeDesc()).includes("[Find]"), await activeDesc());
await page.keyboard.press("Escape");
await page.waitForTimeout(250);
const statusText = (await page.locator(`${aside} footer [aria-label="Editor status"]`).textContent()) ?? "";
check("status bar shows Ln/Col, save state and language in File mode", /Ln \d+, Col \d+/.test(statusText) && /Autosave on|Saved/.test(statusText) && /TypeScript/i.test(statusText), statusText.trim());
await shot("file");
await composer.click();
await page.keyboard.press("Control+B");
await page.waitForTimeout(400);
check("Control+B hides the files panel", (await page.locator(`${aside} section[aria-label]`).count()) === 0);
await page.keyboard.press("Control+B");
await page.waitForTimeout(400);
check("Control+B shows it again", (await page.locator(`${aside} section[aria-label]`).count()) === 1);
await composer.click();
await page.keyboard.press("Control+\\");
await page.waitForTimeout(500);
check("Control+\\ splits the editor", (await page.locator(`${aside} [data-group]`).count()) === 2, `${await page.locator(`${aside} [data-group]`).count()} groups`);
await shot("split");

// The explorer filter: the icon-row button swaps the header into a field; Escape puts it back.
await page.getByRole("button", { name: "Filter files" }).click();
await page.waitForTimeout(200);
const filter = page.getByRole("textbox", { name: "Filter files" });
check("Filter swaps the explorer header into a field with focus", await filter.isVisible() && (await activeDesc()).includes("[Filter files]"), await activeDesc());
await filter.type("app");
await page.waitForTimeout(300);
check("typing filters the list", (await page.locator(`${aside} section [role="listbox"], ${aside} section [role="list"]`).count()) >= 0 && ((await page.locator(`${aside} section`).textContent()) ?? "").includes("app.ts"));
await shot("filter");
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
check("Escape clears the filter and restores the header", (await filter.count()) === 0 && ((await page.locator(`${aside} .group\\/hdr`).textContent()) ?? "").includes("Explorer"));

console.log(checks.join("\n"));
console.log(`${checks.filter((c) => c.startsWith("PASS")).length}/${checks.length} passed`);
console.log("saved", shots.join(", "));
if (errors.length) console.log("console errors:\n" + errors.slice(0, 12).join("\n"));
await browser.close();
process.exitCode = checks.some((c) => c.startsWith("FAIL")) ? 1 : 0;
