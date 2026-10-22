// Workspace pane checks: explorer keyboard + mouse, preview/pinned tabs, context menu, inline
// new/rename through a mocked /fs.json, quick open, search in files, split groups, tab drag and
// word wrap. Every per-box endpoint is mocked with page.route() (same shape as thread-fixture.mjs).
// Run from PowerShell:
//
//   node .shots/workspace-pane.mjs [--dark] [--w=1440 --h=900]
//
// Prints one "ok"/"FAIL" line per check and saves .shots/ws-explorer.png, ws-split.png, ws-search.png.
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";

const flags = process.argv.slice(2).filter((a) => a.startsWith("--"));
const flag = (k, d) => flags.find((f) => f.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const dark = flags.includes("--dark");
const W = Number(flag("w", 1440));
const H = Number(flag("h", 900));
const token = process.env.ASB_DEV_TOKEN || "devtoken123";
const base = process.env.ASB_UI || "http://localhost:5173";

/* ───────────────────────────── the box ───────────────────────────── */
const NAME = "quiet-otter";
const REPO = "acme/orders-api";
const T0 = Date.now() - 14 * 60_000;
const TASK = "Replace the fixed-window rate limiter in the orders API with a sliding-window one backed by Redis.";
const box = {
  name: NAME,
  boxStatus: "running",
  task: TASK,
  uptime: "14m",
  cpu: "2%",
  mem: "1.1G/4G",
  memUsage: { usedMib: 1130, totalMib: 4096 },
  disk: { usedMib: 3800, totalMib: 20480 },
  lastOutputAt: Date.now() - 4000,
  title: "Sliding-window rate limiter",
  repos: [{ name: "orders-api", branch: "feat/sliding-window-limiter" }],
  agent: "claude",
  runState: "done",
  exitCode: 0,
};
const LOG = [`⟦at⟧ ${T0}`, "● session started (model ak-claude-opus-4.8)", `⟦at⟧ ${T0 + 60_000}`, "Replaced the limiter and added tests; 25 tests green.", "⟦usage⟧ in=91320 out=12880 ctx=88200"].join("\n");
const LIFECYCLE = { idleTimeoutSec: 1800, maxDurationSec: 4 * 3600, capacity: 8, poolSize: 2, sleepTtlSec: 7 * 86400, memoryTiers: ["2G", "4G", "8G"], memoryDefault: "4G", diskTiers: ["20G", "40G"] };
const CHANGES = [
  { path: "orders-api/src/middleware/rateLimit.ts", repo: "orders-api", status: "modified", additions: 34, deletions: 11 },
  { path: "orders-api/test/rateLimit.test.ts", repo: "orders-api", status: "modified", additions: 24, deletions: 0 },
  { path: "orders-api/docs/rate-limits.md", repo: "orders-api", status: "added", additions: 18, deletions: 0 },
];
// Mutable: /fs.json creates, renames, moves and deletes against it.
let FILES = ["orders-api/src/app.ts", "orders-api/src/middleware/rateLimit.ts", "orders-api/src/lib/redis.ts", "orders-api/test/rateLimit.test.ts", "orders-api/test/orders.test.ts", "orders-api/docs/rate-limits.md", "orders-api/package.json", "orders-api/README.md"];
const SOURCE = Array.from({ length: 20 }, (_, i) => `const line${i + 1} = ${i + 1}; // redis is mentioned on line ${i + 1} so that content search has hits`).join("\n") + "\n";
const SEARCH = [
  { path: "orders-api/src/lib/redis.ts", line: 3, text: "export const redis = new Redis(process.env.REDIS_URL);" },
  { path: "orders-api/src/lib/redis.ts", line: 9, text: "  redis.on('error', (e) => log.warn('redis', e));" },
  { path: "orders-api/src/middleware/rateLimit.ts", line: 2, text: "import { redis } from '../lib/redis';" },
  { path: "orders-api/src/middleware/rateLimit.ts", line: 14, text: "    const hits = await redis.hincrby(key, String(now), 1);" },
];
const frame = (event, data, id) => `event: ${event}\n${id !== undefined ? `id: ${id}\n` : ""}data: ${JSON.stringify(data)}\n\n`;

/* ───────────────────────────── browser ───────────────────────────── */
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: dark ? "dark" : "light", deviceScaleFactor: 1 });
await ctx.addInitScript(
  ([t, d]) => {
    localStorage.setItem("asb-token", t);
    localStorage.setItem("asb-dark", d ? "1" : "0");
    localStorage.setItem("asb-workspace-w", "980");
  },
  [token, dark]
);
const page = await ctx.newPage();
const errors = [];
// "Failed to load resource" is the response listener's job; it skips the dev server refusing the worktree's
// font files (@fs allow list) and the outcome 404 that means "no archived run yet".
page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
page.on("response", (r) => r.status() >= 400 && !/.woff2?$/.test(r.url()) && !(r.status() === 404 && r.url().includes("/history/outcome.json")) && errors.push(`${r.status()} ${r.url()}`));

const fsCalls = [];
const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
await page.route("**/*", async (route) => {
  const u = new URL(route.request().url());
  switch (u.pathname) {
    case "/fleet.json":
      return json(route, { boxes: [box], lifecycle: LIFECYCLE, at: Date.now() });
    case "/monitor.json":
      return json(route, { boxes: [box] });
    case "/watch.json":
      return json(route, { ...box, log: LOG });
    case "/watch.sse":
      return route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache" }, body: "retry: 3000\n\n" + frame("snapshot", { meta: box, log: LOG, from: 0 }, LOG.length) + frame("done", { meta: box }) });
    case "/changes.json":
      return json(route, { files: CHANGES });
    case "/digest.json":
      return json(route, { box: NAME, task: TASK, state: "done", exitCode: 0, startedAt: T0, endedAt: T0 + 92_000, plan: [], files: CHANGES, failedCommands: [], questions: [], usage: { inputTokens: 1, outputTokens: 1, contextTokens: 1 }, headline: "Done." });
    case "/pr.json":
      return json(route, { repo: REPO, number: 482, title: "feat: sliding-window rate limiter", state: "open", additions: 58, deletions: 11, changedFiles: 2, head: "feat/sliding-window-limiter", base: "main", author: "bot", url: `https://github.com/${REPO}/pull/482`, mergeable: true, reviewDecision: "review_required", reviewers: [], checks: { total: 3, success: 3, failure: 0, pending: 0 } });
    case "/inbox.json":
      return json(route, { queued: [] });
    case "/repos.json":
      return json(route, { repos: [{ fullName: REPO, private: true, defaultBranch: "main", logins: ["acme"] }], total: 1 });
    case "/secrets.json":
      return json(route, { secrets: [] });
    case "/revert-points.json":
      return json(route, { messages: [] });
    case "/models.json":
      return json(route, { default: "ak-claude-opus-4.8", current: "ak-claude-opus-4.8", models: [{ id: "ak-claude-opus-4.8", label: "Opus 4.8", tier: "opus" }] });
    case "/skills.json":
      return json(route, { skills: [] });
    case "/tree.json":
      return json(route, { files: FILES, total: FILES.length, truncated: false });
    case "/files.json":
      return json(route, { files: FILES.filter((f) => f.includes(u.searchParams.get("q") ?? "")), total: FILES.length, truncated: false });
    case "/git.json":
      return json(route, { repo: "orders-api", branch: "feat/sliding-window-limiter", upstream: "origin/feat/sliding-window-limiter", ahead: 0, behind: 0, lastCommit: "feat: sliding-window rate limiter", clean: false, changed: 3 });
    case "/artifact":
      return route.fulfill({ status: 200, contentType: "text/plain", body: SOURCE });
    case "/diff.json":
      return json(route, { path: u.searchParams.get("path") ?? CHANGES[0].path, untracked: false, binary: false, original: "const WINDOW = 60_000;\n", diff: "@@ -1,1 +1,2 @@\n-const WINDOW = 60_000;\n+const BUCKETS = 6;\n+const WINDOW = 60_000;\n" });
    case "/rundiff.json":
      return json(route, { diff: "" });
    case "/file.json": {
      if (route.request().method() === "POST") return json(route, { ok: true });
      return json(route, { path: u.searchParams.get("path"), content: SOURCE, bytes: SOURCE.length, mtime: Date.now() });
    }
    case "/fs.json": {
      const b = route.request().postDataJSON();
      fsCalls.push(b);
      const under = (p, dir) => p === dir || p.startsWith(dir + "/");
      if (b.op === "create") FILES = [...FILES, b.path];
      else if (b.op === "mkdir") FILES = [...FILES, `${b.path}/.keep`];
      else if (b.op === "delete") FILES = FILES.filter((p) => !under(p, b.path));
      else if (b.op === "move") FILES = FILES.map((p) => (under(p, b.path) ? b.to + p.slice(b.path.length) : p));
      else if (b.op === "copy") FILES = [...FILES, ...FILES.filter((p) => under(p, b.path)).map((p) => b.to + p.slice(b.path.length))];
      return json(route, { ok: true, files: FILES });
    }
    case "/search.json": {
      const q = u.searchParams.get("q") ?? "";
      const cs = u.searchParams.get("case") === "1";
      const hit = (t) => (cs ? t.includes(q) : t.toLowerCase().includes(q.toLowerCase()));
      return json(route, { matches: SEARCH.filter((m) => hit(m.text)), truncated: q === "redis" });
    }
    case "/triggers/for-box.json":
      return json(route, { items: [] });
    case "/auth/config.json":
      return json(route, { mode: "token", providers: [], tokenLogin: true });
    case "/workflows.json":
      return json(route, { workflows: [], limits: {}, dir: ".agent-sandbox/workflows" });
    case "/memory.json":
    case "/resume.json":
    case "/title.json":
    case "/wake.json":
      return json(route, { ok: true });
    default:
      return route.continue();
  }
});

/* ───────────────────────────── checks ───────────────────────────── */
const results = [];
// A crashed step still reports the checks that ran before it.
process.on("uncaughtException", (e) => {
  console.log(results.join(String.fromCharCode(10)));
  console.log("CRASH " + String(e.message ?? e).split(String.fromCharCode(10))[0]);
  process.exit(1);
});
const check = async (name, fn) => {
  try {
    const r = await fn();
    const ok = r === true || (r !== false && r !== undefined && r !== null);
    results.push(`${ok ? "ok  " : "FAIL"} ${name}${typeof r === "string" ? ` — ${r}` : ""}`);
    if (!ok) results[results.length - 1] += ` — got ${JSON.stringify(r)}`;
  } catch (e) {
    results.push(`FAIL ${name} — ${e.message.split("\n")[0]}`);
  }
};
const pane = () => page.getByRole("complementary", { name: "Workspace" });
const row = (p) => pane().locator(`[role=tree] [data-path="${p}"]`);
const tab = (p, g = 0) => pane().locator(`[data-group="${g}"] [role=tab][data-tab="${p}"]`);
const tabsIn = (g) => pane().locator(`[data-group="${g}"] [role=tab][data-tab]`).evaluateAll((els) => els.map((e) => e.dataset.tab));
const focusedPath = () => page.evaluate(() => document.activeElement?.closest?.("[role=treeitem]")?.getAttribute("data-path") ?? null);
const activeLine = (g = 0) => pane().locator(`[data-group="${g}"] .cm-activeLineGutter`).first().innerText();
const settle = (ms = 350) => page.waitForTimeout(ms);
const modKey = "Control";

await page.goto(`${base}/dashboard/box/${NAME}`, { waitUntil: "load", timeout: 30000 }).catch((e) => errors.push("goto: " + e.message));
await page.waitForTimeout(1400);
await page.getByRole("button", { name: /files|workspace/i }).first().click();
await pane().locator("[role=tree] [role=treeitem]").first().waitFor({ timeout: 10000 });
await settle(800);

await check("auto-opens the first change pinned in diff mode", async () => (await tabsIn(0)).join(",") === "orders-api/src/middleware/rateLimit.ts" && (await tab("orders-api/src/middleware/rateLimit.ts").getAttribute("data-preview")) === null);

// Keyboard: ↓ moves focus, → expands the folder under the cursor.
await row("orders-api").focus();
await page.keyboard.press("ArrowDown");
await settle(100);
const afterDown = await focusedPath();
await check("ArrowDown moves focus to the next row", async () => afterDown === "orders-api/docs");
await page.keyboard.press("ArrowRight");
await settle(300);
await check("ArrowRight expands the focused folder", async () => (await row("orders-api/docs").getAttribute("aria-expanded")) === "true" && (await row("orders-api/docs/rate-limits.md").count()) === 1);
await page.keyboard.press("End");
await settle(100);
await check("End jumps to the last row", async () => (await focusedPath()) === "orders-api/README.md");
await page.keyboard.type("pack");
await settle(100);
await check("type-ahead lands on package.json", async () => (await focusedPath()) === "orders-api/package.json");

// Mouse: single click previews (italic, replaced by the next preview), double click pins, middle click closes.
await row("orders-api/README.md").click();
await settle(300);
await check("single click opens an italic preview tab", async () => (await tab("orders-api/README.md").getAttribute("data-preview")) === "true" && (await tab("orders-api/README.md").locator("span.italic").count()) === 1);
await row("orders-api/package.json").click();
await settle(300);
await check("a second single click replaces the preview tab", async () => (await tabsIn(0)).join(",") === "orders-api/src/middleware/rateLimit.ts,orders-api/package.json");
await row("orders-api/package.json").dblclick();
await settle(300);
await check("double click pins the tab", async () => (await tab("orders-api/package.json").getAttribute("data-preview")) === null);
await tab("orders-api/package.json").click({ button: "middle" });
await settle(400);
await check("middle click closes the tab", async () => (await tabsIn(0)).join(",") === "orders-api/src/middleware/rateLimit.ts");

// Context menu on a folder.
await row("orders-api/docs").click({ button: "right" });
const menu = page.getByRole("menu", { name: /actions/ });
await menu.waitFor({ timeout: 3000 });
const items = await menu.getByRole("menuitem").allInnerTexts();
await check("right-click shows the explorer context menu", async () => {
  const want = ["New file", "New folder", "Open to the side", "Reveal active file", "Copy path", "Copy relative path", "Rename", "Duplicate", "Delete"];
  const missing = want.filter((w) => !items.some((t) => t.startsWith(w)));
  return missing.length === 0 || `missing ${missing.join(", ")}`;
});
await page.screenshot({ path: ".shots/ws-explorer.png" });

// New file through the menu → inline input → mocked /fs.json → row + pinned tab.
await menu.getByRole("menuitem", { name: /^New file/ }).click();
const nameInput = pane().getByRole("textbox", { name: "File name" });
await nameInput.waitFor({ timeout: 3000 });
await nameInput.fill("rate-limits.md");
await page.keyboard.press("Enter");
await settle(200);
await check("an existing name is refused inline", async () => (await nameInput.getAttribute("aria-invalid")) === "true" && (await pane().getByRole("alert").count()) === 1);
await nameInput.fill("notes.md");
await page.keyboard.press("Enter");
await row("orders-api/docs/notes.md").waitFor({ timeout: 3000 });
await settle(300);
await check("New file creates the row and opens a pinned tab (mocked /fs.json)", async () => fsCalls.some((c) => c.op === "create" && c.path === "orders-api/docs/notes.md") && (await tab("orders-api/docs/notes.md").count()) === 1 && (await tab("orders-api/docs/notes.md").getAttribute("data-preview")) === null);

// Rename via F2.
await row("orders-api/docs/notes.md").focus();
await page.keyboard.press("F2");
const renameInput = pane().getByRole("textbox", { name: "New name" });
await renameInput.waitFor({ timeout: 3000 });
await renameInput.fill("notes-v2.md");
await page.keyboard.press("Enter");
await row("orders-api/docs/notes-v2.md").waitFor({ timeout: 3000 });
await settle(300);
await check("F2 rename commits and follows the open tab", async () => fsCalls.some((c) => c.op === "move" && c.path === "orders-api/docs/notes.md" && c.to === "orders-api/docs/notes-v2.md") && (await tab("orders-api/docs/notes-v2.md").count()) === 1 && (await tab("orders-api/docs/notes.md").count()) === 0);

// Quick open.
await page.keyboard.press(`${modKey}+p`);
const quick = page.getByRole("dialog", { name: "Quick open" });
await quick.waitFor({ timeout: 3000 });
await check("⌘P opens quick open with recent files", async () => (await quick.getByRole("option").count()) >= 1);
await quick.getByRole("textbox").fill("redis");
await settle(150);
await page.keyboard.press("Enter");
await tab("orders-api/src/lib/redis.ts").waitFor({ timeout: 3000 });
await settle(400);
await check("Enter in quick open opens the matched file", async () => (await tab("orders-api/src/lib/redis.ts").getAttribute("aria-selected")) === "true" && (await quick.count()) === 0);
const lineBefore = await activeLine().catch(() => "?");
await page.keyboard.press(`${modKey}+p`);
await quick.getByRole("textbox").fill(":12");
await settle(100);
await page.keyboard.press("Enter");
await settle(500);
await check(":12 in quick open jumps to line 12", async () => {
  const after = await activeLine();
  return (after.trim() === "12" && after !== lineBefore) || `before ${lineBefore.trim()} after ${after.trim()}`;
});

// Search in files.
await page.keyboard.press(`${modKey}+Shift+f`);
const search = pane().getByRole("textbox", { name: "Search in files" });
await search.waitFor({ timeout: 3000 });
await search.fill("redis");
await pane().getByText("results in", { exact: false }).waitFor({ timeout: 4000 });
await check("⌘⇧F searches and groups results by file", async () => (await pane().locator("section ul button[aria-expanded]").count()) === 2 && (await pane().locator("mark").count()) >= 4 && (await pane().getByText("Showing the first").count()) === 1);
await page.screenshot({ path: ".shots/ws-search.png" });
await pane().locator('button[title="orders-api/src/middleware/rateLimit.ts:14"]').click();
await settle(600);
await check("clicking a result opens the file at that line", async () => (await tab("orders-api/src/middleware/rateLimit.ts").getAttribute("aria-selected")) === "true" && (await activeLine()).trim() === "14");

// Split.
await pane().locator('[data-group="0"] .cm-content').click();
await page.keyboard.press(`${modKey}+\\`);
await pane().locator('[data-group="1"]').waitFor({ timeout: 3000 });
await settle(500);
await check("⌘\\ splits into two groups with the active file copied", async () => (await pane().locator("[data-group]").count()) === 2 && (await tabsIn(1)).join(",") === "orders-api/src/middleware/rateLimit.ts" && (await pane().locator('[data-group="1"]').getAttribute("data-focused")) === "true");
await page.screenshot({ path: ".shots/ws-split.png" });

// Tab drag reorders within group 0.
const before = await tabsIn(0);
await tab(before[0]).dragTo(tab(before[before.length - 1]), { targetPosition: { x: 70, y: 10 } });
await settle(500);
await check("dragging a tab reorders the strip", async () => {
  const after = await tabsIn(0);
  return (after.join(",") !== before.join(",") && after.length === before.length && after[after.length - 1] === before[0]) || `before ${before.join(",")} after ${after.join(",")}`;
});

// Word wrap.
await pane().locator('[data-group="1"] .cm-content').click();
await page.keyboard.press("Alt+z");
await settle(300);
await check("⌥Z toggles line wrapping in the editor", async () => (await pane().locator("[data-group] .cm-lineWrapping").count()) >= 1);

// Delete with confirm → tabs holding the path close everywhere.
await pane().getByRole("tab", { name: /^Files$/ }).click();
await row("orders-api/docs/notes-v2.md").waitFor({ timeout: 3000 });
page.once("dialog", (d) => d.accept());
await row("orders-api/docs/notes-v2.md").click({ button: "right" });
await page.getByRole("menuitem", { name: /^Delete/ }).click();
await settle(500);
await check("Delete confirms, removes the row and closes its tabs", async () => fsCalls.some((c) => c.op === "delete" && c.path === "orders-api/docs/notes-v2.md") && (await row("orders-api/docs/notes-v2.md").count()) === 0 && (await pane().locator('[role=tab][data-tab="orders-api/docs/notes-v2.md"]').count()) === 0);

await check("nothing threw in the console", async () => errors.length === 0 || errors.slice(0, 6).join(" | "));

console.log(results.join("\n"));
await browser.close();
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
