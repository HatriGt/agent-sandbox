// Find widget + window-level workspace shortcuts, against a mocked box. Run from PowerShell:
//
//   node .shots/r2-find.mjs [--dark] [--w=1440 --h=900]
//
// Proves: ⌘P fires from the composer (focus outside the editor), ⌘F from the composer opens the
// floating find widget with match highlighting, Enter steps, the replace row unfolds, Escape
// returns focus to the editor, chords stay quiet behind the command palette, and ⌘F does nothing
// once the pane is closed. Screenshots: widget (light/dark), replace row, status strip, explorer header.
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
    case "/diff.json": return json(route, { path: FILE, untracked: false, binary: false, original: "", diff: "@@ -1,2 +1,3 @@\n-const WINDOW = 60_000;\n+const BUCKETS = 6;\n" });
    case "/file.json": return json(route, { path: u.searchParams.get("path"), content: SOURCE, bytes: SOURCE.length, mtime: Date.now() });
    case "/memory.json": case "/resume.json": case "/title.json": case "/wake.json": return json(route, { ok: true });
    default: return route.fallback();
  }
});

const shots = [];
const shot = async (name, clip) => {
  const out = `.shots/r2-find-${name}${dark ? "-dark" : ""}-${W}.png`;
  await page.screenshot({ path: out, clip });
  shots.push(out);
};
const checks = [];
const check = (name, ok, detail = "") => checks.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
const activeDesc = () => page.evaluate(() => { const a = document.activeElement; if (!a) return "none"; return `${a.tagName.toLowerCase()}${a.id ? "#" + a.id : ""}${a.getAttribute("aria-label") ? `[${a.getAttribute("aria-label")}]` : ""}${a.closest(".cm-editor") ? " (in editor)" : ""}`; });
const widget = page.locator('[role="search"][aria-label="Find in file"]');
const composer = page.locator("#send-input");

await page.goto(`${base}/dashboard/box/${NAME}`, { waitUntil: "load", timeout: 30000 }).catch((e) => errors.push("goto: " + e.message));
await page.waitForTimeout(1400);

// Pane closed: ⌘F from the composer is the browser's (nothing of ours fires).
await composer.click();
await page.keyboard.press("Control+F");
await page.waitForTimeout(300);
check("Control+F with the pane closed opens no widget", (await widget.count()) === 0, `active=${await activeDesc()}`);

// Open the pane; from the composer, ⌘P quick-opens the file.
await page.getByRole("button", { name: /files/i }).first().click();
await page.locator('aside[aria-label="Workspace"]').waitFor({ timeout: 8000 });
await page.waitForTimeout(800);
await composer.click();
await page.keyboard.press("Control+P");
await page.waitForTimeout(300);
const quick = page.getByRole("textbox", { name: "Go to file" });
check("Control+P from the composer opens Go to file", await quick.isVisible().catch(() => false), `active=${await activeDesc()}`);
await quick.type("rateLimit.ts");
await page.waitForTimeout(300);
await page.keyboard.press("Enter");
await page.locator("[role=radiogroup][aria-label=\"View mode\"]").waitFor({ timeout: 8000 });
await page.waitForTimeout(600);
check("the file opened as a tab (in Diff mode, since it changed)", (await page.locator('aside[aria-label="Workspace"] [role="tablist"][aria-label^="Editor group"] [role="tab"][aria-selected="true"]').first().textContent())?.includes("rateLimit.ts") === true && (await page.locator('aside[aria-label="Workspace"] .cm-editor').count()) === 0, `tab=${(await page.locator('aside[aria-label="Workspace"] [role="tablist"][aria-label^="Editor group"] [role="tab"][aria-selected="true"]').first().textContent())?.trim()} editors in pane=${await page.locator('aside[aria-label="Workspace"] .cm-editor').count()} on page=${await page.locator(".cm-editor").count()}`);

// Focus outside the editor, then ⌘F: the widget appears, focused, and the needle highlights.
await composer.click();
check("focus is in the composer before Control+F", (await activeDesc()).startsWith("textarea#send-input") || (await activeDesc()).includes("send-input"), await activeDesc());
await page.keyboard.press("Control+F");
await widget.waitFor({ timeout: 3000 }).catch((e) => errors.push("widget: " + e.message));
await page.waitForTimeout(250);
check("Control+F from the composer switches Diff to File and opens the find widget", (await widget.count()) === 1 && (await page.locator("[role=radiogroup][aria-label=\"View mode\"] [aria-checked=true]").textContent())?.trim() === "File");
check("the find input has focus", (await activeDesc()).includes("[Find]"), await activeDesc());
await page.keyboard.type("limit");
await page.waitForTimeout(350);
const countText = async () => (await widget.locator("[aria-live]").textContent())?.trim();
const highlights = async () => page.locator(".cm-editor .cm-searchMatch").count();
const geom = await page.evaluate(() => { const w = document.querySelector('[role="search"][aria-label="Find in file"]'); const e = document.querySelector(".cm-editor"); if (!w || !e) return null; const a = w.getBoundingClientRect(); const b = e.getBoundingClientRect(); return { w: Math.round(a.width), h: Math.round(a.height), top: Math.round(a.top - b.top), right: Math.round(b.right - a.right) }; });
check("widget sits top-right of the editor", !!geom && geom.top <= 12 && geom.right <= 16 && geom.w >= 300, JSON.stringify(geom));
check("matches are highlighted", (await highlights()) >= 3, `${await highlights()} .cm-searchMatch, count "${await countText()}"`);
await page.mouse.move(W - 400, 300);
await shot("widget");

await page.keyboard.press("Enter");
await page.waitForTimeout(250);
const c1 = await countText();
await page.keyboard.press("Enter");
await page.waitForTimeout(250);
const c2 = await countText();
check("Enter steps to the next match", c1 !== c2 && /^\d+ of \d+$/.test(c2 ?? ""), `${c1} → ${c2}`);
await page.keyboard.press("Shift+Enter");
await page.waitForTimeout(250);
check("Shift+Enter steps back", (await countText()) === c1, `${await countText()}`);

// The replace row.
await widget.getByRole("button", { name: "Show replace" }).click();
await page.waitForTimeout(350);
check("replace row opens", await widget.getByRole("textbox", { name: "Replace" }).isVisible());
await shot("replace");

// Status: caret position and the file's state, on the right of the pane's one 28px status bar.
const stripBox = await page.locator('[aria-label="Workspace status"]').first().boundingBox();
check("status bar is 28px and holds the editor status", !!stripBox && Math.round(stripBox.height) === 28 && (await page.locator('[aria-label="Workspace status"] [aria-label="Editor status"]').count()) === 1, JSON.stringify(stripBox && { h: Math.round(stripBox.height), w: Math.round(stripBox.width) }));
const stripText = await page.locator('[aria-label="Editor status"]').first().textContent();
check("strip shows Ln/Col and language", /Ln \d+, Col \d+/.test(stripText ?? "") && /TypeScript/i.test(stripText ?? ""), stripText?.trim());
if (stripBox) await shot("status", { x: Math.max(0, stripBox.x - 8), y: stripBox.y - 160, width: Math.min(W - stripBox.x + 8, stripBox.width + 16), height: 182 + stripBox.height });

// Escape closes and hands focus back to the editor.
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
check("Escape closes the widget and refocuses the editor", (await widget.count()) === 0 && (await activeDesc()).includes("(in editor)"), await activeDesc());
check("highlighting stops with the widget", (await highlights()) === 0, `${await highlights()} left`);

// Explorer header actions show on hover.
const header = page.locator('aside[aria-label="Workspace"] .group\\/hdr');
await header.hover();
await page.waitForTimeout(250);
check("explorer header has hover actions", (await header.getByRole("button").count()) === 4, `${await header.getByRole("button").count()} buttons`);
const rowH = await page.locator('[role="tree"] [role="treeitem"]').first().boundingBox();
check("tree rows are 22px", !!rowH && Math.round(rowH.height) === 22, `${rowH && Math.round(rowH.height)}px`);
await shot("explorer");

// Behind the command palette, chords stay quiet; ⌘K is still the palette's.
await composer.click();
await page.keyboard.press("Control+K");
await page.waitForTimeout(400);
const palette = page.locator("dialog[open]");
check("Control+K still opens the palette", (await palette.count()) === 1);
await page.keyboard.press("Control+F");
await page.waitForTimeout(250);
check("Control+F behind the palette opens no widget", (await widget.count()) === 0);
await page.keyboard.press("Escape");
await page.waitForTimeout(400);

// ⌘S from the composer saves the active file (the mocked write succeeds).
await page.locator(".cm-editor .cm-content").click();
await page.keyboard.press("End");
await page.keyboard.type(" // x");
await page.waitForTimeout(200);
await composer.click();
await page.keyboard.press("Control+S");
await page.waitForTimeout(400);
check("Control+S from the composer saves", /Saved/.test((await page.locator('[aria-label="Editor status"]').first().textContent()) ?? ""), (await page.locator('[aria-label="Editor status"]').first().textContent())?.trim());

// Close the pane: ⌘F is the browser's again.
await page.getByRole("button", { name: "Close workspace" }).click();
await page.waitForTimeout(600);
await composer.click();
await page.keyboard.press("Control+F");
await page.waitForTimeout(300);
check("after closing the pane, Control+F opens no widget", (await widget.count()) === 0 && (await page.locator('aside[aria-label="Workspace"]').count()) === 0, `active=${await activeDesc()}`);

console.log(checks.join("\n"));
console.log("saved", shots.join(", "));
if (errors.length) console.log("console errors:\n" + errors.slice(0, 12).join("\n"));
await browser.close();
process.exitCode = checks.some((c) => c.startsWith("FAIL")) ? 1 : 0;
