// Round 7: Go to Symbol in Editor (⌘⇧O / Ctrl+Shift+O) against VS Code's behaviour, on a mocked box.
// Run from PowerShell:  node .shots/r7-symbols.mjs [--phase=before|after] [--w=1440 --h=900] [--probe]
//
// --probe logs every programmatic scrollTop write on the editor's scroller, with its stack, around
// the Escape step; it is how the CodeMirror focus-handler scroll bounce was found.
//
// Both themes run the same script. Proves: the chord opens from the editor, the composer and the
// tree (Control and Meta); the row under the caret is selected on open without the editor
// scrolling; a query bolds the matched characters, prefix before substring; "@:" groups by kind in
// VS Code's order with counted separators and filters inside the groups; arrowing bands every line
// of the candidate and scrolls without moving the caret; Escape and backspacing past "@" both put
// scroll and selection back; Enter selects the name with the caret at its start and focuses the
// editor; Markdown headings and JSON keys work; empty states read like VS Code; the shortcuts dialog
// shows the platform's caps; the palette's width and row metrics match the quick input.
// Screenshots: .shots/r7/sym-<phase>-{plain,query,grouped}-{light,dark}.png
import fs from "node:fs";
import { serveWorktreeFonts } from "./overflow-probe.mjs";
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";

const args = process.argv.slice(2);
const flag = (k, d) => args.find((f) => f.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const PHASE = flag("phase", "after");
const PROBE = args.includes("--probe");
const W = Number(flag("w", 1440));
const H = Number(flag("h", 900));
const token = process.env.ASB_DEV_TOKEN || "devtoken123";
const base = process.env.ASB_UI || "http://localhost:5173";
const NAME = "quiet-otter";
const CHANGED = "orders-api/src/middleware/rateLimit.ts";
const BUCKET = "orders-api/src/lib/bucket.ts";
const DOC = "orders-api/docs/rate-limits.md";
const PKG = "orders-api/package.json";
const SH = "orders-api/scripts/dev.sh";
const TREE = ["orders-api/src/app.ts", CHANGED, BUCKET, "orders-api/src/lib/redis.ts", "orders-api/test/rateLimit.test.ts", DOC, PKG, SH, "orders-api/README.md"];
const FILL = Array.from({ length: 40 }, (_, i) => `function step${String(i + 1).padStart(2, "0")}(n: number): number {\n  return n + ${i + 1};\n}\n`).join("\n");
const SOURCE_TS = `import { redis } from './redis';\n\nexport const BUCKETS = 6;\nexport type Window = { size: number; slice: number };\n\nexport interface Options {\n  limit: number;\n  window?: number;\n}\n\nexport function windowFor(limit: number): Window {\n  return { size: limit, slice: limit / BUCKETS };\n}\n\nexport class TokenBucket {\n  private hits = 0;\n  constructor(private readonly limit: number) {}\n  take(n = 1): boolean {\n    this.hits += n;\n    return this.hits <= this.limit;\n  }\n  reset(): void {\n    this.hits = 0;\n  }\n}\n\nexport const parseKey = (ip: string) => \`rl:\${ip}\`;\n\n${FILL}`;
const SOURCES = {
  [CHANGED]: "import { redis } from '../lib/redis';\n\nconst BUCKETS = 6;\n\nexport function rateLimit(limit: number) {\n  return limit / BUCKETS;\n}\n",
  [BUCKET]: SOURCE_TS,
  [DOC]: "# Rate limits\n\nHow the orders API throttles.\n\n## Sliding window\n\nText.\n\n### Buckets\n\nText.\n\n## Configuration\n\nText.\n",
  [PKG]: '{\n  "name": "orders-api",\n  "scripts": {\n    "build": "tsc",\n    "test": "vitest"\n  },\n  "dependencies": {\n    "redis": "^4.6.0"\n  }\n}\n',
  [SH]: "#!/bin/sh\nnpm run dev\n",
};
const lineOf = (needle) => SOURCE_TS.split("\n").findIndex((l) => l.includes(needle)) + 1;
const T0 = Date.now() - 14 * 60_000;
const box = { name: NAME, role: "session", boxStatus: "running", runState: "running", task: "Replace the fixed-window rate limiter in the orders API with a sliding-window one backed by Redis.", uptime: "14m", cpu: "12%", mem: "1.1G/4G", memUsage: { usedMib: 1130, totalMib: 4096 }, disk: { usedMib: 3800, totalMib: 20480 }, lastOutputAt: Date.now() - 4000, title: "Sliding-window rate limiter", repos: [{ name: "orders-api", branch: "feat/sliding-window-limiter" }], agent: "claude" };
const { role: _r, ...meta } = box;
const LOG = [`⟦at⟧ ${T0}`, "● session started (model ak-claude-opus-4.8)", `⟦at⟧ ${T0 + 9000}`, "I'll start by reading how the limiter is wired today, then swap the implementation behind the same signature."].join("\n");
const CHANGES = [{ path: CHANGED, repo: "orders-api", status: "modified", additions: 34, deletions: 11 }];

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? "  " + detail : ""}`);
};

async function run(browser, dark) {
  const tag = dark ? "dark" : "light";
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

  const shot = (name) => page.screenshot({ path: `.shots/r7/sym-${PHASE}-${name}-${tag}.png` });
  const ok = (name, cond, detail) => check(`${tag}: ${name}`, cond, detail);
  const activeDesc = () => page.evaluate(() => { const a = document.activeElement; if (!a) return "none"; return `${a.tagName.toLowerCase()}${a.id ? "#" + a.id : ""}${a.getAttribute("aria-label") ? `[${a.getAttribute("aria-label")}]` : ""}${a.closest(".cm-editor") ? " (in editor)" : ""}`; });
  const composer = page.locator("#send-input");
  const quick = page.getByRole("textbox", { name: "Go to file" });
  const dialog = page.locator('[role="dialog"][aria-label="Quick open"]');
  const options = page.locator('[role="listbox"][aria-label="Symbols"] [role="option"]');
  const names = () => options.evaluateAll((els) => els.map((el) => el.dataset.symbol));
  const selected = page.locator('[role="listbox"][aria-label="Symbols"] [role="option"][aria-selected="true"]');
  const groups = () => page.locator("[data-symbol-group]").allTextContents();
  const strip = () => page.locator('[aria-label="Editor status"]').first().textContent().then((t) => t?.trim() ?? "");
  const scroller = page.locator('aside[aria-label="Workspace"] .cm-editor .cm-scroller');
  const scrollTop = () => scroller.evaluate((el) => el.scrollTop);
  const banded = () => page.locator(".cm-editor [data-range-highlight]").count();
  const docSelection = () => page.evaluate(() => document.getSelection()?.toString() ?? "");
  const lnOf = (s) => Number(/Ln (\d+)/.exec(s)?.[1] ?? -1);
  const colOf = (s) => Number(/Col (\d+)/.exec(s)?.[1] ?? -1);
  const openWith = (combo) => page.keyboard.press(combo).then(() => quick.waitFor({ timeout: 3000 })).then(() => page.waitForTimeout(350)).then(() => true, () => false);
  const close = () => page.keyboard.press("Escape").then(() => page.waitForTimeout(350));
  const openFile = async (needle) => {
    await composer.click();
    await page.keyboard.press("Control+P");
    await quick.waitFor({ timeout: 3000 });
    await quick.type(needle);
    await page.waitForTimeout(300);
    await page.keyboard.press("Enter");
    await page.locator('aside[aria-label="Workspace"] .cm-editor').waitFor({ timeout: 8000 });
    await page.waitForTimeout(600);
  };
  const retype = async (text) => {
    await page.keyboard.press("Control+A");
    await page.keyboard.type(text);
    await page.waitForTimeout(350);
  };

  await page.goto(`${base}/dashboard/box/${NAME}`, { waitUntil: "load", timeout: 30000 }).catch((e) => errors.push("goto: " + e.message));
  await page.waitForTimeout(1400);
  await page.getByRole("button", { name: /files/i }).first().click();
  await page.locator('aside[aria-label="Workspace"]').waitFor({ timeout: 8000 });
  await page.waitForTimeout(600);
  await openFile("bucket.ts");
  if (PROBE) await page.evaluate(() => {
    const el = document.querySelector('aside[aria-label="Workspace"] .cm-scroller');
    window.__log = [];
    const d = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
    Object.defineProperty(Element.prototype, "scrollTop", { get: d.get, set(v) { if (this === el) window.__log.push({ t: Math.round(performance.now()), set: v, stack: new Error().stack.split("\n").slice(2, 8).join(" <- ") }); return d.set.call(this, v); }, configurable: true });
    el.addEventListener("scroll", () => window.__log.push({ t: Math.round(performance.now()), scrolled: el.scrollTop }));
  });

  // Enter on a candidate, from the editor: the name is selected, the caret at its start, the editor focused.
  await page.locator('aside[aria-label="Workspace"] .cm-content').click();
  ok("chord opens from the editor (Control)", await openWith("Control+Shift+O") && (await quick.inputValue()) === "@", await activeDesc());
  await page.keyboard.type("take");
  await page.waitForTimeout(300);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  const takeLine = lineOf("take(n = 1)");
  ok("Enter selects exactly the name", (await quick.count()) === 0 && (await docSelection()) === "take", `selection="${await docSelection()}"`);
  ok("Enter puts the caret at the start of the name on its line", lnOf(await strip()) === takeLine && colOf(await strip()) === 3, `strip="${await strip()}" want Ln ${takeLine}, Col 3`);
  ok("Enter hands focus to the editor", (await activeDesc()).includes("(in editor)"), await activeDesc());

  // Reopen: the caret's symbol is the selected row, the editor does not scroll, the whole method is banded.
  const topBefore = await scrollTop();
  const stripBefore = await strip();
  ok("chord reopens from the editor with @ prefilled", await openWith("Control+Shift+O") && (await quick.inputValue()) === "@");
  ok("the row under the caret is selected on open", (await selected.getAttribute("data-symbol")) === "take" && (await selected.locator("[data-symbol-container]").textContent()) === "TokenBucket", `selected=${await selected.getAttribute("data-symbol").catch(() => "none")}`);
  const inList = await selected.evaluate((el) => { const r = el.getBoundingClientRect(); const l = el.closest('[role="listbox"]').getBoundingClientRect(); return r.top >= l.top && r.bottom <= l.bottom; }).catch(() => false);
  ok("the list scrolled the selected row into view", inList);
  ok("opening does not scroll the editor when the symbol is on screen", Math.abs((await scrollTop()) - topBefore) <= 1, `${topBefore} -> ${await scrollTop()}`);
  ok("every line of the caret's method is banded, the caret has not moved", (await banded()) === 4 && (await strip()) === stripBefore, `banded=${await banded()} strip="${await strip()}"`);
  const metrics = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"][aria-label="Quick open"]');
    const row = d.querySelector('[role="option"]');
    const icon = row.querySelector("svg");
    const cs = getComputedStyle(row);
    const pane = document.querySelector('aside[aria-label="Workspace"]').getBoundingClientRect();
    return { width: d.getBoundingClientRect().width, pane: pane.width, border: getComputedStyle(d).borderTopWidth, row: row.getBoundingClientRect().height, icon: icon.getBoundingClientRect().width, gap: cs.columnGap, iconColor: getComputedStyle(icon).color };
  });
  ok("palette is 600px wide (or the pane less 32px) with a 1px border", Math.abs(metrics.width - Math.min(600, metrics.pane - 32)) <= 1 && metrics.border === "1px", JSON.stringify(metrics));
  ok("rows are 26px with a 16px icon and a 6px gap", Math.abs(metrics.row - 26) <= 0.5 && Math.abs(metrics.icon - 16) <= 0.5 && metrics.gap === "6px", JSON.stringify(metrics));
  const tone = await selected.locator("svg").evaluate((el) => getComputedStyle(el).color);
  ok("a method's icon is VS Code purple", tone === (dark ? "rgb(177, 128, 215)" : "rgb(101, 45, 144)"), tone);
  await shot("plain");

  // A query bolds the matched characters; prefix before substring.
  await page.keyboard.type("Bu");
  await page.waitForTimeout(350);
  const hits = await options.evaluateAll((els) => els.map((el) => ({ name: el.dataset.symbol, lit: [...el.querySelectorAll("[data-match]")].map((m) => m.textContent).join("") })));
  ok("prefix match first, substring second, matched characters highlighted", hits.length === 2 && hits[0].name === "BUCKETS" && hits[0].lit === "BU" && hits[1].name === "TokenBucket" && hits[1].lit === "Bu", JSON.stringify(hits));
  await shot("query");

  // "@:" groups by kind with counted separators, in VS Code's order, and filters inside the groups.
  await retype("@:");
  const labels = await groups();
  const kinds = labels.map((l) => l.replace(/ \(\d+\)$/, ""));
  ok("@: groups in VS Code's order with counts", kinds.join(",") === "classes,interfaces,functions,methods,variables,properties,types" && labels[0] === "classes (1)" && labels[3] === "methods (3)", labels.join(" | "));
  ok("@: lists every symbol once", (await names()).length === 1 + 1 + 42 + 3 + 1 + 5 + 1, String((await names()).length));
  await shot("grouped");
  await page.keyboard.type("take");
  await page.waitForTimeout(350);
  ok("@:<query> filters inside the grouped view", (await groups()).join(",") === "methods (1)" && (await names()).join(",") === "take", `${(await groups()).join(",")} / ${(await names()).join(",")}`);

  // Arrowing previews: scroll plus a band over all the candidate's lines; Escape restores both.
  await retype("@step3");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(400);
  ok("ArrowDown scrolls to the candidate and bands its three lines without moving the caret", (await scrollTop()) > topBefore + 200 && (await banded()) === 3 && (await strip()) === stripBefore && (await selected.getAttribute("data-symbol")) === "step32", `scroll ${topBefore} -> ${await scrollTop()}, banded=${await banded()}, strip="${await strip()}"`);
  if (PROBE) await page.evaluate(() => window.__log.push({ mark: "ESCAPE" }));
  await close();
  if (PROBE) for (const e of (await page.evaluate(() => window.__log)).slice(-16)) console.log(JSON.stringify(e));
  ok("Escape restores scroll, selection and clears the band", (await quick.count()) === 0 && Math.abs((await scrollTop()) - topBefore) <= 1 && (await strip()) === stripBefore && (await docSelection()) === "take" && (await banded()) === 0, `scroll ${await scrollTop()} vs ${topBefore}, strip="${await strip()}", sel="${await docSelection()}"`);

  // Backspacing past "@" falls back to file mode and restores the editor right then.
  ok("chord reopens for the backspace case", await openWith("Control+Shift+O"));
  await page.keyboard.type("step3");
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(350);
  ok("preview scrolled before backspacing", (await scrollTop()) > topBefore + 200);
  for (let i = 0; i < 6; i++) await page.keyboard.press("Backspace");
  await page.waitForTimeout(400);
  ok("backspacing past @ keeps the palette open in file mode and restores the scroll at once", (await quick.count()) === 1 && (await quick.inputValue()) === "" && Math.abs((await scrollTop()) - topBefore) <= 1 && (await banded()) === 0, `value="${await quick.inputValue()}" scroll=${await scrollTop()} vs ${topBefore}`);
  await close();

  // The chord from the composer, the tree, and with Meta.
  await composer.click();
  ok("chord opens from the composer", await openWith("Control+Shift+O") && (await quick.inputValue()) === "@");
  await close();
  await page.locator('[role="treeitem"][tabindex="0"]').first().focus();
  ok("focus is in the tree", await page.evaluate(() => !!document.activeElement?.closest('[role="tree"]')), await activeDesc());
  ok("chord opens from the tree", await openWith("Control+Shift+O") && (await quick.inputValue()) === "@");
  await close();
  await page.locator('aside[aria-label="Workspace"] .cm-content').click();
  ok("Meta+Shift+O opens too", await openWith("Meta+Shift+O") && (await quick.inputValue()) === "@");
  await close();

  // Markdown headings, JSON keys, a file with no symbols.
  await openFile("rate-limits.md");
  ok("markdown: chord opens", await openWith("Control+Shift+O"));
  ok("markdown: headings in order, no container detail", (await names()).join(",") === "Rate limits,Sliding window,Buckets,Configuration" && (await page.locator("[data-symbol-container]").count()) === 0, (await names()).join(","));
  await close();
  await openFile("package.json");
  ok("json: chord opens", await openWith("Control+Shift+O"));
  const build = page.locator('[role="option"][data-symbol="build"]');
  ok("json: keys in order, a nested key names its object", (await names()).join(",") === "name,scripts,build,test,dependencies,redis" && (await build.locator("[data-symbol-container]").textContent()) === "scripts", (await names()).join(","));
  await close();
  await openFile("dev.sh");
  ok("shell: chord opens", await openWith("Control+Shift+O"));
  const emptyRow = page.locator('[role="listbox"][aria-label="Symbols"] li');
  ok("a file without symbols reads 'No editor symbols'", (await emptyRow.count()) === 1 && (await emptyRow.textContent())?.trim() === "No editor symbols", (await emptyRow.first().textContent().catch(() => ""))?.trim());
  await close();

  // The shortcuts dialog shows the platform's caps (Chromium on Windows here).
  await composer.click();
  await page.keyboard.press("Control+K");
  await page.waitForTimeout(400);
  await page.keyboard.type("Keyboard shortcuts");
  await page.waitForTimeout(300);
  await page.keyboard.press("Enter");
  const radix = page.locator('[role="dialog"][data-state="open"]');
  await radix.waitFor({ timeout: 3000 }).catch((e) => errors.push("shortcuts dialog: " + e.message));
  await page.waitForTimeout(300);
  const caps = await radix.locator("li", { hasText: "Go to symbol" }).locator("[aria-label]").first().getAttribute("aria-label").catch(() => null);
  const mac = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform));
  ok("shortcuts dialog shows the platform's caps for Go to symbol", caps === (mac ? "⌘ ⇧ O" : "Ctrl Shift O"), `caps="${caps}" mac=${mac}`);
  await close();

  // No file open.
  const tabs = page.locator('aside[aria-label="Workspace"] [role="tablist"][aria-label^="Editor group"] [role="tab"]');
  await composer.click();
  for (let i = 0; i < 8 && (await tabs.count()) > 0; i++) {
    await page.keyboard.press("Control+W");
    await page.waitForTimeout(250);
  }
  ok("all tabs closed", (await tabs.count()) === 0, String(await tabs.count()));
  ok("chord opens with no file", await openWith("Control+Shift+O"));
  ok("with no file open the row reads 'Open a file first.'", (await emptyRow.count()) === 1 && (await emptyRow.textContent())?.trim() === "Open a file first.", (await emptyRow.first().textContent().catch(() => ""))?.trim());
  await close();

  ok("no page errors", errors.length === 0, errors.slice(0, 6).join(" | "));
  await ctx.close();
}

fs.mkdirSync(".shots/r7", { recursive: true });
const browser = await chromium.launch();
try {
  for (const dark of [false, true]) await run(browser, dark);
} finally {
  await browser.close();
}
const pass = results.filter((r) => r.ok).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
