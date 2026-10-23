// Round 8 icons: the explorer's file and folder icons as one inline-SVG set with a restrained
// per-family hue. Run from PowerShell: node .shots/r8-icons.mjs [--shots] [--tag=before|after] [--zoom=2]
//
// Proves, light and dark: every tree row icon is a 16x16 inline SVG; folders use the folder glyph
// and the open and closed variants differ; each sample file resolves to its family (data-file-kind)
// and a chromatic family's ink sits at the scheme's lightness within ±0.05 and chroma 0.10-0.16
// while a mono family's ink is --muted-foreground; test files carry the check badge; hovering a row
// does not recolour its icon; icons carry no transition; file names align with folder names at the
// same depth; the open tab, the changes dock and the @ menu resolve a file to the same kind; no
// page errors. Prints name x positions per depth either way so before/after can be compared.
import { serveWorktreeFonts } from "./overflow-probe.mjs";
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";

const args = process.argv.slice(2);
const flag = (k, d) => args.find((f) => f.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const shots = args.includes("--shots");
const tag = flag("tag", "after");
const zoom = Number(flag("zoom", 1));
const W = 1440;
const H = 900;
const base = process.env.ASB_UI || "http://localhost:5173";
const NAME = "quiet-otter";
const FILE = "orders-api/src/middleware/rateLimit.ts";

// name → expected family (kind). Mirrors thread-fixture.mjs's TREE.
const SAMPLE = {
  "orders-api/.env": "config", "orders-api/.gitignore": "gitignore", "orders-api/Dockerfile": "dockerfile", "orders-api/LICENSE": "license", "orders-api/Makefile": "shell", "orders-api/README.md": "readme",
  "orders-api/brand.woff2": "media", "orders-api/config.yaml": "data", "orders-api/deploy.sh": "shell", "orders-api/notes.txt": "doc", "orders-api/openapi.json": "data", "orders-api/package-lock.json": "lock", "orders-api/package.json": "package", "orders-api/schema.sql": "data", "orders-api/tsconfig.json": "tsconfig",
  "orders-api/src/App.tsx": "ts", "orders-api/src/App.vue": "markup", "orders-api/src/app.ts": "ts", "orders-api/src/app.test.ts": "ts", "orders-api/src/hero.png": "media", "orders-api/src/index.css": "style", "orders-api/src/index.html": "markup", "orders-api/src/legacy.js": "js", "orders-api/src/lib.rs": "compiled", "orders-api/src/logo.svg": "media", "orders-api/src/main.go": "compiled", "orders-api/src/worker.py": "python",
  [FILE]: "ts", "orders-api/src/lib/redis.ts": "ts", "orders-api/test/rateLimit.test.ts": "ts", "orders-api/test/orders.test.ts": "ts", "orders-api/docs/rate-limits.md": "doc",
};
const TREE = Object.keys(SAMPLE);
const MONO = new Set(["doc", "readme", "license", "shell", "dockerfile", "config", "lock", "gitignore"]);
const TARGET = { light: 0.62, dark: 0.72 };

const SOURCE = "import { redis } from '../lib/redis';\n\nconst BUCKETS = 6;\n\nexport function rateLimit({ limit, window = 60_000 }) {\n  const slice = window / BUCKETS;\n  return async (req, res, next) => {\n    next();\n  };\n}\n";
const DIFF = "@@ -1,4 +1,6 @@\n-const WINDOW = 60_000;\n+const BUCKETS = 6;\n+\n export function rateLimit({ limit }) {\n+  const slice = window / BUCKETS;\n";
const T0 = Date.now() - 14 * 60_000;
const box = { name: NAME, role: "session", boxStatus: "running", runState: "running", task: "Replace the fixed-window rate limiter in the orders API with a sliding-window one backed by Redis.", uptime: "14m", cpu: "12%", mem: "1.1G/4G", memUsage: { usedMib: 1130, totalMib: 4096 }, disk: { usedMib: 3800, totalMib: 20480 }, lastOutputAt: Date.now() - 4000, title: "Sliding-window rate limiter", repos: [{ name: "orders-api", branch: "feat/sliding-window-limiter" }], agent: "claude" };
const { role: _r, ...meta } = box;
const LOG = [`⟦at⟧ ${T0}`, "● session started (model ak-claude-opus-4.8)", `⟦at⟧ ${T0 + 9000}`, "I'll start by reading how the limiter is wired today."].join("\n");
const CHANGES = [
  { path: FILE, repo: "orders-api", status: "modified", additions: 34, deletions: 11 },
  { path: "orders-api/test/rateLimit.test.ts", repo: "orders-api", status: "modified", additions: 24, deletions: 0 },
  { path: "orders-api/docs/rate-limits.md", repo: "orders-api", status: "added", additions: 18, deletions: 0 },
];

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? "  " + detail : ""}`); };
const r2 = (n) => Math.round(n * 100) / 100;

/* ───────────── colour → oklch ───────────── */
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function oklchOf(c) {
  let m;
  if ((m = c.match(/^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)/))) return { l: parseFloat(m[1]) / (m[2] ? 100 : 1), c: parseFloat(m[3]), h: parseFloat(m[4]) };
  if ((m = c.match(/^oklab\(\s*([\d.]+)(%?)\s+(-?[\d.]+)\s+(-?[\d.]+)/))) return { l: parseFloat(m[1]) / (m[2] ? 100 : 1), c: Math.hypot(parseFloat(m[3]), parseFloat(m[4])), h: 0 };
  if (!(m = c.match(/^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/))) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((v) => lin(Number(v) / 255));
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  return { l: L, c: Math.hypot(a, bb), h: ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360 };
}

async function openEditor(browser, dark) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: dark ? "dark" : "light", deviceScaleFactor: zoom });
  await ctx.addInitScript((d) => { localStorage.setItem("asb-token", "devtoken123"); localStorage.setItem("asb-theme", d ? "graphite" : "light"); }, dark);
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
      case "/git.json": return json(route, { repo: "orders-api", branch: "feat/sliding-window-limiter", upstream: "origin/feat/sliding-window-limiter", ahead: 0, behind: 0, lastCommit: "feat: sliding-window rate limiter", clean: false, changed: 3 });
      case "/artifact": return route.fulfill({ status: 200, contentType: "text/plain", body: SOURCE });
      case "/diff.json": return json(route, { path: FILE, untracked: false, binary: false, original: "", diff: DIFF });
      case "/file.json": return json(route, { path: u.searchParams.get("path"), content: SOURCE, bytes: SOURCE.length, mtime: Date.now() });
      case "/memory.json": case "/resume.json": case "/title.json": case "/wake.json": return json(route, { ok: true });
      default: return route.fallback();
    }
  });
  await page.goto(`${base}/dashboard/box/${NAME}`, { waitUntil: "load", timeout: 30000 }).catch((e) => errors.push("goto: " + e.message));
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: /files/i }).first().click();
  const aside = page.locator('aside[aria-label="Workspace"]');
  await aside.waitFor({ timeout: 8000 });
  await page.waitForTimeout(600);
  await page.locator("#send-input").click();
  await page.keyboard.press("Control+P");
  const quick = page.getByRole("textbox", { name: "Go to file" });
  await quick.waitFor({ timeout: 3000 });
  await quick.type("middleware/rateLimit.ts");
  await page.waitForTimeout(250);
  await page.keyboard.press("Enter");
  await page.locator('[role=radiogroup][aria-label="View mode"]').waitFor({ timeout: 8000 });
  await page.waitForTimeout(500);
  return { ctx, page, errors, aside };
}

const ROWS = '[role=tree][aria-label="Files"] [role=treeitem][data-kind]';
const rowsOf = (page) => page.evaluate((sel) => Array.from(document.querySelectorAll(sel)).map((li) => {
  const icon = li.querySelector("svg[data-file-kind], svg[data-folder]") ?? li.querySelector("svg:not(.lucide), [data-file-mark]");
  const r = icon?.getBoundingClientRect();
  const name = li.querySelector("span.truncate");
  const cs = icon ? getComputedStyle(icon) : null;
  return {
    path: li.getAttribute("data-path"), kind: li.getAttribute("data-kind"), level: Number(li.getAttribute("aria-level")), expanded: li.getAttribute("aria-expanded"), h: li.getBoundingClientRect().height,
    nameX: name ? Math.round(name.getBoundingClientRect().x) : null,
    icon: icon ? { tag: icon.tagName.toLowerCase(), w: r.width, h: r.height, fileKind: icon.getAttribute("data-file-kind"), test: icon.getAttribute("data-file-test"), folder: icon.getAttribute("data-folder"), root: icon.getAttribute("data-folder-root"), changed: icon.getAttribute("data-folder-changed"), color: cs.color, transition: cs.transitionDuration, d: Array.from(icon.querySelectorAll("path")).map((p) => p.getAttribute("d")).join("|"), tab: icon.querySelector("[data-folder-tab]") ? getComputedStyle(icon.querySelector("[data-folder-tab]")).color : null, body: icon.querySelector("[data-folder-body]") ? getComputedStyle(icon.querySelector("[data-folder-body]")).fill : null } : null,
  };
}), ROWS);
const probe = (page, cls) => page.evaluate((cls) => { const s = document.createElement("span"); s.className = cls; document.body.appendChild(s); const c = getComputedStyle(s).color; s.remove(); return c; }, cls);

const browser = await chromium.launch();
try {
  for (const dark of [false, true]) {
    const mode = dark ? "dark" : "light";
    const { ctx, page, errors, aside } = await openEditor(browser, dark);
    const shot = async (name, sel) => {
      if (!shots) return;
      const clip = await page.locator(sel).first().boundingBox();
      await page.screenshot({ path: `.shots/r8/icons-${tag}-${name}-${mode}.png`, clip });
    };
    const muted = await probe(page, "text-muted-foreground");
    const live = await probe(page, "text-live");

    const rows = await rowsOf(page);
    const dirs = rows.filter((r) => r.kind === "dir");
    const files = rows.filter((r) => r.kind === "file");
    console.log(`${mode}: ${dirs.length} folders, ${files.length} files; name x by depth: ` + [...new Set(rows.map((r) => r.level))].sort().map((l) => `L${l} dir=${dirs.find((d) => d.level === l)?.nameX ?? "-"} file=${files.find((f) => f.level === l)?.nameX ?? "-"}`).join(", "));
    check(`${mode}: explorer rows are 22px`, rows.length > 0 && rows.every((r) => r.h === 22), [...new Set(rows.map((r) => r.h))].join("/"));
    check(`${mode}: every row icon is a 16x16 inline svg`, rows.every((r) => r.icon && r.icon.tag === "svg" && r.icon.w === 16 && r.icon.h === 16), rows.filter((r) => !(r.icon && r.icon.tag === "svg" && r.icon.w === 16 && r.icon.h === 16)).map((r) => `${r.path}: ${r.icon ? `${r.icon.tag} ${r2(r.icon.w)}x${r2(r.icon.h)}` : "none"}`).slice(0, 4).join(", "));
    const open = dirs.filter((d) => d.expanded === "true");
    const closed = dirs.filter((d) => d.expanded === "false");
    check(`${mode}: folders use the folder glyph, open and closed differ`, open.length >= 1 && closed.length >= 1 && open.every((d) => d.icon?.folder === "open") && closed.every((d) => d.icon?.folder === "closed") && open[0].icon.d !== closed[0].icon.d, dirs.map((d) => `${d.path.split("/").pop()}:${d.icon?.folder ?? "-"}`).join(", "));
    const root = dirs.find((d) => d.level === 1);
    check(`${mode}: the repo root folder is the root glyph`, !!root && root.icon?.root === "true" && dirs.filter((d) => d.level > 1).every((d) => d.icon?.root !== "true"), root?.icon?.root ?? "-");
    const withChanges = dirs.filter((d) => /\/(test|docs)$/.test(d.path));
    const without = dirs.filter((d) => /\/lib$/.test(d.path));
    check(`${mode}: a folder with changes inside tints its tab live, others do not`, withChanges.length === 2 && withChanges.every((d) => d.icon?.changed === "true" && d.icon?.tab === live) && without.every((d) => d.icon?.changed !== "true" && d.icon?.tab !== live), `${withChanges.map((d) => d.icon?.tab).join(" | ")} vs ${without.map((d) => d.icon?.tab).join(" | ")}; live ${live}`);
    check(`${mode}: folder ink is the muted foreground`, dirs.every((d) => d.icon?.color === muted), dirs[0]?.icon?.color);
    const bodies = dirs.map((d) => ({ d, o: oklchOf(d.icon?.body ?? "") }));
    const mutedL = oklchOf(muted).l;
    check(`${mode}: the folder body paints as an opaque ink between the plate and the page`, bodies.every(({ o }) => o && o.c < 0.05 && (dark ? o.l < mutedL - 0.02 && o.l > 0.3 : o.l > mutedL + 0.02 && o.l < 0.9)), `${dirs[0]?.icon?.body} vs plate ${muted}`);

    const wrong = files.filter((f) => SAMPLE[f.path] && f.icon?.fileKind !== SAMPLE[f.path]);
    check(`${mode}: every sample file resolves to its family`, files.length >= 25 && wrong.length === 0, wrong.map((f) => `${f.path.split("/").pop()}→${f.icon?.fileKind ?? "-"} (want ${SAMPLE[f.path]})`).slice(0, 6).join(", "));
    const tests = files.filter((f) => /\.test\./.test(f.path));
    check(`${mode}: .test. files carry the check badge, others do not`, tests.length >= 1 && tests.every((f) => f.icon?.test === "true") && files.filter((f) => !/\.test\./.test(f.path)).every((f) => !f.icon?.test), tests.map((f) => f.icon?.test).join(","));
    const chroma = files.filter((f) => SAMPLE[f.path] && !MONO.has(SAMPLE[f.path])).map((f) => ({ f, ok: oklchOf(f.icon?.color ?? "") }));
    const offTone = chroma.filter(({ ok }) => !ok || ok.c < 0.1 || ok.c > 0.16 || Math.abs(ok.l - TARGET[mode]) > 0.05);
    check(`${mode}: chromatic marks sit at L ${TARGET[mode]}±0.05, C 0.10-0.16`, chroma.length >= 12 && offTone.length === 0, offTone.map(({ f, ok }) => `${f.path.split("/").pop()} ${ok ? `L${r2(ok.l)} C${r2(ok.c)}` : f.icon?.color}`).slice(0, 5).join(", ") || `${chroma.length} marks, e.g. ${chroma[0].f.icon.color}`);
    const hues = new Set(chroma.map(({ ok }) => ok && Math.round(ok.h / 10)));
    check(`${mode}: the chromatic palette uses 6-9 hues`, hues.size >= 6 && hues.size <= 9, `${hues.size} hues`);
    const mono = files.filter((f) => MONO.has(SAMPLE[f.path]));
    check(`${mode}: mono families use the muted foreground`, mono.length >= 6 && mono.every((f) => f.icon?.color === muted), mono.filter((f) => f.icon?.color !== muted).map((f) => `${f.path.split("/").pop()} ${f.icon?.color}`).slice(0, 4).join(", "));
    check(`${mode}: icons carry no transition`, rows.every((r) => parseFloat(r.icon?.transition ?? "1") === 0), [...new Set(rows.map((r) => r.icon?.transition))].join("/"));

    const aligned = files.every((f) => { const d = dirs.find((x) => x.level === f.level); return !d || d.nameX === f.nameX; });
    check(`${mode}: file names align with folder names at the same depth`, aligned && files.some((f) => dirs.some((d) => d.level === f.level)), [...new Set(files.map((f) => `L${f.level}:${f.nameX}`))].join(",") + " vs " + [...new Set(dirs.map((d) => `L${d.level}:${d.nameX}`))].join(","));

    const target = page.locator(`${ROWS}[data-path="orders-api/src/App.tsx"]`);
    const before = (await rowsOf(page)).find((r) => r.path === "orders-api/src/App.tsx")?.icon?.color;
    await target.hover();
    await page.waitForTimeout(200);
    const hovered = (await rowsOf(page)).find((r) => r.path === "orders-api/src/App.tsx")?.icon?.color;
    await target.click();
    await page.waitForTimeout(200);
    const selected = (await rowsOf(page)).find((r) => r.path === "orders-api/src/App.tsx")?.icon?.color;
    check(`${mode}: hover and selection do not recolour the icon`, !!before && before === hovered && before === selected, `${before} / ${hovered} / ${selected}`);

    const tabKind = await page.evaluate(() => document.querySelector('[role=tab][aria-selected=true] svg[data-file-kind]')?.getAttribute("data-file-kind") ?? null);
    const tabSize = await page.evaluate(() => { const s = document.querySelector('[role=tab][aria-selected=true] svg[data-file-kind]'); const r = s?.getBoundingClientRect(); return r ? `${r.width}x${r.height}` : null; });
    check(`${mode}: the open tab's icon is a 16px svg of the file's kind`, tabKind === "ts" && tabSize === "16x16", `${tabKind} ${tabSize}`);

    await page.mouse.move(W / 2, H - 20);
    await page.locator(`${ROWS}[data-path="orders-api/src"]`).hover();
    await page.waitForTimeout(200);
    await shot("explorer", 'aside[aria-label="Workspace"] section[aria-label]');
    if (shots) { const b = await page.locator('[role=tree][aria-label="Files"]').boundingBox(); await page.screenshot({ path: `.shots/r8/icons-${tag}-tree-head-${mode}.png`, clip: { x: b.x, y: b.y, width: 180, height: 110 } }); }
    console.log(`${mode}: docs folder tab ${dirs.find((d) => /docs$/.test(d.path))?.icon?.tab} body ${dirs.find((d) => /docs$/.test(d.path))?.icon?.body}`);
    await page.locator("#send-input").click();
    await shot("pane", 'aside[aria-label="Workspace"]');

    await page.getByRole("button", { name: /show the changed files/i }).click();
    const dockRows = page.getByRole("list", { name: "Changed files" });
    await dockRows.waitFor({ timeout: 4000 });
    await page.waitForTimeout(400);
    const dock = await page.evaluate((file) => Array.from(document.querySelectorAll('[aria-label="Changed files"] [data-file-mark]')).map((m) => ({ path: m.closest("button")?.textContent ?? "", kind: m.getAttribute("data-file-kind"), bg: getComputedStyle(m).backgroundColor })).filter((m) => m.path.includes("rateLimit.ts")), FILE);
    check(`${mode}: the changes dock resolves the same file to the same kind`, dock.length >= 1 && dock.every((m) => m.kind === tabKind), JSON.stringify(dock.map((m) => m.kind)));
    check(`${mode}: the dock keeps the round-4 mono square`, dock.every((m) => { const o = oklchOf(m.bg); return o && o.c < 0.05; }), dock[0]?.bg);
    await shot("dock", '[aria-label="Changed files"]');

    await page.locator("#send-input").click();
    await page.keyboard.type("@App");
    await page.locator('[role=listbox] [role=option]').first().waitFor({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(300);
    const mention = await page.evaluate(() => Array.from(document.querySelectorAll('[role=listbox] svg[data-file-kind], [role=option] svg[data-file-kind]')).map((s) => { const r = s.getBoundingClientRect(); return { kind: s.getAttribute("data-file-kind"), size: `${r.width}x${r.height}` }; }));
    check(`${mode}: the @ menu shows the icon set at 16px`, mention.length >= 1 && mention.every((m) => m.size === "16x16") && mention.some((m) => m.kind === "ts"), JSON.stringify(mention.slice(0, 3)));
    await shot("mention", '[role=listbox]');
    await page.keyboard.press("Escape");

    check(`${mode}: no page errors`, errors.length === 0, errors.slice(0, 3).join(" | "));
    await ctx.close();
  }
} finally { await browser.close(); }
const pass = results.filter((r) => r.ok).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
