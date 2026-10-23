// Go to symbol (⌘⇧O) in the workspace pane, against a mocked box. Run from PowerShell:
//
//   node .shots/r5-symbols.mjs [--dark] [--w=1440 --h=900]
//
// Proves: ⌘⇧O from the composer opens quick open prefilled with "@" listing the TS file's outline,
// typing filters it, Enter puts the caret on the symbol (name selected, editor focused), arrowing
// previews (scrolls and tints the line) and Esc puts scroll and caret back, the chord stays quiet
// behind a Radix dialog, and with no file open the list is one quiet row.
// Screenshots: .shots/out/r5-symbols-{list,filter,empty}[-dark]-<w>.png
import fs from "node:fs";
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
const CHANGED = "orders-api/src/middleware/rateLimit.ts";
const BUCKET = "orders-api/src/lib/bucket.ts";
const TREE = ["orders-api/src/app.ts", CHANGED, BUCKET, "orders-api/src/lib/redis.ts", "orders-api/test/rateLimit.test.ts", "orders-api/docs/rate-limits.md", "orders-api/package.json", "orders-api/README.md"];
const SOURCE_CHANGED = "import { redis } from '../lib/redis';\n\nconst BUCKETS = 6;\n\nexport function rateLimit(limit: number) {\n  return limit / BUCKETS;\n}\n";
// Long enough to scroll at 900px tall: 40 filler functions after the real declarations.
const FILL = Array.from({ length: 40 }, (_, i) => `function step${String(i + 1).padStart(2, "0")}(n: number): number {\n  return n + ${i + 1};\n}\n`).join("\n");
const SOURCE_TS = `import { redis } from './redis';\n\nexport const BUCKETS = 6;\nexport type Window = { size: number; slice: number };\n\nexport interface Options {\n  limit: number;\n  window?: number;\n}\n\nexport function windowFor(limit: number): Window {\n  return { size: limit, slice: limit / BUCKETS };\n}\n\nexport class TokenBucket {\n  private hits = 0;\n  constructor(private readonly limit: number) {}\n  take(n = 1): boolean {\n    this.hits += n;\n    return this.hits <= this.limit;\n  }\n  reset(): void {\n    this.hits = 0;\n  }\n}\n\nexport const parseKey = (ip: string) => \`rl:\${ip}\`;\n\n${FILL}`;
const SOURCES = { [CHANGED]: SOURCE_CHANGED, [BUCKET]: SOURCE_TS };
const lineOf = (needle) => SOURCE_TS.split("\n").findIndex((l) => l.includes(needle)) + 1;
const T0 = Date.now() - 14 * 60_000;
const box = { name: NAME, role: "session", boxStatus: "running", runState: "running", task: "Replace the fixed-window rate limiter in the orders API with a sliding-window one backed by Redis.", uptime: "14m", cpu: "12%", mem: "1.1G/4G", memUsage: { usedMib: 1130, totalMib: 4096 }, disk: { usedMib: 3800, totalMib: 20480 }, lastOutputAt: Date.now() - 4000, title: "Sliding-window rate limiter", repos: [{ name: "orders-api", branch: "feat/sliding-window-limiter" }], agent: "claude" };
const { role: _r, ...meta } = box;
const LOG = [`⟦at⟧ ${T0}`, "● session started (model ak-claude-opus-4.8)", `⟦at⟧ ${T0 + 9000}`, "I'll start by reading how the limiter is wired today, then swap the implementation behind the same signature."].join("\n");
const CHANGES = [{ path: CHANGED, repo: "orders-api", status: "modified", additions: 34, deletions: 11 }];

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
    case "/artifact": return route.fulfill({ status: 200, contentType: "text/plain", body: SOURCES[u.searchParams.get("path")] ?? "" });
    case "/diff.json": return json(route, { path: CHANGED, untracked: false, binary: false, original: "", diff: "@@ -1,2 +1,3 @@\n-const WINDOW = 60_000;\n+const BUCKETS = 6;\n" });
    case "/file.json": { const p = u.searchParams.get("path"); const content = SOURCES[p] ?? ""; return json(route, { path: p, content, bytes: content.length, mtime: Date.now() }); }
    case "/memory.json": case "/resume.json": case "/title.json": case "/wake.json": return json(route, { ok: true });
    default: return route.fallback();
  }
});

fs.mkdirSync(".shots/out", { recursive: true });
const shots = [];
const shot = async (name) => {
  const out = `.shots/out/r5-symbols-${name}${dark ? "-dark" : ""}-${W}.png`;
  await page.screenshot({ path: out });
  shots.push(out);
};
const checks = [];
const check = (name, ok, detail = "") => checks.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
const activeDesc = () => page.evaluate(() => { const a = document.activeElement; if (!a) return "none"; return `${a.tagName.toLowerCase()}${a.id ? "#" + a.id : ""}${a.getAttribute("aria-label") ? `[${a.getAttribute("aria-label")}]` : ""}${a.closest(".cm-editor") ? " (in editor)" : ""}`; });
const composer = page.locator("#send-input");
const quick = page.getByRole("textbox", { name: "Go to file" });
const options = page.locator('[role="listbox"][aria-label="Symbols"] [role="option"]');
const optionNames = () => options.evaluateAll((els) => els.map((el) => el.dataset.symbol));
const strip = () => page.locator('[aria-label="Editor status"]').first().textContent().then((t) => t?.trim() ?? "");
const scrollTop = () => page.locator(".cm-editor .cm-scroller").evaluate((el) => el.scrollTop);
const tinted = () => page.locator(".cm-editor .cm-preview-line").count();
const lnOf = (s) => Number(/Ln (\d+)/.exec(s)?.[1] ?? -1);

await page.goto(`${base}/dashboard/box/${NAME}`, { waitUntil: "load", timeout: 30000 }).catch((e) => errors.push("goto: " + e.message));
await page.waitForTimeout(1400);
await page.getByRole("button", { name: /files/i }).first().click();
await page.locator('aside[aria-label="Workspace"]').waitFor({ timeout: 8000 });
await page.waitForTimeout(600);

// Open the unchanged TS file (it opens in File mode, so the editor is live).
await composer.click();
await page.keyboard.press("Control+P");
await quick.waitFor({ timeout: 3000 });
await quick.type("bucket.ts");
await page.waitForTimeout(300);
await page.keyboard.press("Enter");
await page.locator('aside[aria-label="Workspace"] .cm-editor').waitFor({ timeout: 8000 });
await page.waitForTimeout(600);
check("bucket.ts opened in the editor", (await page.locator('aside[aria-label="Workspace"] .cm-editor').count()) === 1);

// ⌘⇧O from the composer: quick open, prefilled "@", the outline listed, first row previewed.
await composer.click();
check("focus is in the composer before Control+Shift+O", (await activeDesc()).includes("send-input"), await activeDesc());
await page.keyboard.press("Control+Shift+O");
await quick.waitFor({ timeout: 3000 }).catch((e) => errors.push("quick open: " + e.message));
await page.waitForTimeout(350);
check("Control+Shift+O from the composer opens quick open prefilled with @", (await quick.isVisible().catch(() => false)) && (await quick.inputValue()) === "@", `value="${await quick.inputValue().catch(() => "")}" active=${await activeDesc()}`);
const names = await optionNames();
const expected = ["BUCKETS", "Window", "Options", "limit", "window", "windowFor", "TokenBucket", "hits", "take", "reset", "parseKey", "step01", "step40"];
check("the outline lists the fixture's declarations", expected.every((n) => names.includes(n)) && names.length >= 50, `${names.length} rows; missing: ${expected.filter((n) => !names.includes(n)).join(",") || "none"}`);
check("members indent under their class", (await options.nth(names.indexOf("take")).evaluate((el) => parseInt(getComputedStyle(el).paddingLeft))) > (await options.nth(names.indexOf("TokenBucket")).evaluate((el) => parseInt(getComputedStyle(el).paddingLeft))));
check("the first row is previewed: its line is tinted, the caret has not moved", (await tinted()) === 1 && lnOf(await strip()) === 1, `tinted=${await tinted()} strip="${await strip()}"`);
await shot("list");

// Typing filters; Enter jumps, selects the name and hands focus to the editor.
await page.keyboard.type("take");
await page.waitForTimeout(300);
check("typing after @ filters to the matching symbol", (await optionNames()).join(",") === "take", (await optionNames()).join(","));
await shot("filter");
await page.keyboard.press("Enter");
await page.waitForTimeout(400);
check("Enter closes quick open and puts the caret on take()'s line with the name selected", (await quick.count()) === 0 && lnOf(await strip()) === lineOf("take(n = 1)") && /\(4 selected\)/.test(await strip()), `strip="${await strip()}" expected Ln ${lineOf("take(n = 1)")}`);
check("the editor has focus after Enter", (await activeDesc()).includes("(in editor)"), await activeDesc());
check("no preview tint remains after the jump", (await tinted()) === 0);

// Arrowing previews (scroll + tint); Escape restores scroll and caret.
const top0 = await scrollTop();
const strip0 = await strip();
await page.keyboard.press("Control+Shift+O");
await quick.waitFor({ timeout: 3000 });
await page.keyboard.type("step3");
await page.waitForTimeout(350);
await page.keyboard.press("ArrowDown");
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(350);
check("previewing a symbol near the end scrolls the editor and tints its lines without moving the caret", (await scrollTop()) > top0 + 200 && (await tinted()) >= 1 && (await strip()) === strip0, `scroll ${top0} → ${await scrollTop()}, tinted=${await tinted()}, strip="${await strip()}"`);
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
check("Escape closes, restores the scroll position and the caret, and clears the tint", (await quick.count()) === 0 && Math.abs((await scrollTop()) - top0) <= 1 && (await strip()) === strip0 && (await tinted()) === 0, `scroll ${await scrollTop()} vs ${top0}, strip="${await strip()}", tinted=${await tinted()}`);

// Behind a Radix dialog (Keyboard shortcuts) the chord stays quiet; the dialog itself lists ⌘⇧O.
await composer.click();
await page.keyboard.press("Control+K");
await page.waitForTimeout(400);
await page.keyboard.type("Keyboard shortcuts");
await page.waitForTimeout(300);
await page.keyboard.press("Enter");
const radix = page.locator('[role="dialog"][data-state="open"]');
await radix.waitFor({ timeout: 3000 }).catch((e) => errors.push("shortcuts dialog: " + e.message));
await page.waitForTimeout(300);
check("the shortcuts dialog lists Go to symbol", /Go to symbol/.test((await radix.textContent().catch(() => "")) ?? ""));
await page.keyboard.press("Control+Shift+O");
await page.waitForTimeout(300);
check("Control+Shift+O behind a Radix dialog opens no quick open", (await radix.count()) === 1 && (await quick.count()) === 0);
await page.keyboard.press("Escape");
await page.waitForTimeout(400);

// Closing bucket.ts leaves the changed file's auto-opened Diff tab active; ⌘⇧O switches it to File
// (only the editor holds a syntax tree) and lists that file's outline.
const tabsLeft = () => page.locator('aside[aria-label="Workspace"] [role="tablist"][aria-label^="Editor group"] [role="tab"]').count();
const viewMode = () => page.locator('[role=radiogroup][aria-label="View mode"] [aria-checked=true]').textContent().then((t) => t?.trim());
await composer.click();
await page.keyboard.press("Control+W");
await page.waitForTimeout(400);
check("Control+W closed bucket.ts; the changed file's Diff tab is what is left", (await tabsLeft()) === 1 && (await page.locator('aside[aria-label="Workspace"] .cm-editor').count()) === 0 && (await viewMode()) === "Diff", `tabs=${await tabsLeft()} mode=${await viewMode()}`);
await page.keyboard.press("Control+Shift+O");
await quick.waitFor({ timeout: 3000 });
await page.waitForTimeout(400);
check("Control+Shift+O on a Diff tab switches it to File and lists that file's symbols", (await viewMode()) === "File" && (await optionNames()).join(",") === "BUCKETS,rateLimit", `mode=${await viewMode()} rows=${(await optionNames()).join(",")}`);
await page.keyboard.press("Escape");
await page.waitForTimeout(300);

// No file open: one quiet row.
await composer.click();
await page.keyboard.press("Control+W");
await page.waitForTimeout(400);
check("Control+W closed the last tab", (await tabsLeft()) === 0 && (await page.locator('aside[aria-label="Workspace"] .cm-editor').count()) === 0, `tabs=${await tabsLeft()} active=${await activeDesc()}`);
await page.keyboard.press("Control+Shift+O");
await quick.waitFor({ timeout: 3000 }).catch((e) => errors.push("quick open (no file): " + e.message));
await page.waitForTimeout(300);
const emptyRow = page.locator('[role="listbox"][aria-label="Symbols"] li');
check("with no file open the list is the single row 'Open a file first.'", (await emptyRow.count()) === 1 && (await emptyRow.textContent())?.trim() === "Open a file first.", `${await emptyRow.count()} rows: "${(await emptyRow.first().textContent().catch(() => ""))?.trim()}"`);
await shot("empty");
await page.keyboard.press("Enter");
await page.waitForTimeout(200);
check("Enter on the empty row does nothing", (await quick.count()) === 1);
await page.keyboard.press("Escape");

console.log(checks.join("\n"));
console.log("saved", shots.join(", "));
if (errors.length) console.log("console errors:\n" + errors.slice(0, 12).join("\n"));
await browser.close();
process.exitCode = checks.some((c) => c.startsWith("FAIL")) ? 1 : 0;
