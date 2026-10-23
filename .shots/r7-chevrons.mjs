// Round 7 chevrons: the editor's fold gutter and the explorer's twisties drawn the way VS Code draws
// them. Run from PowerShell: node .shots/r7-chevrons.mjs [--shots] [--tag=before|after]
//
// Proves, light and dark: every fold marker is a 16x16 SVG, open markers hide until the gutter is
// hovered, a folded marker stays visible, clicking a marker folds (a placeholder appears and the line
// count drops), the placeholder is a rounded muted pill; explorer twisties are 16x16 SVGs at 1.5
// stroke in 22px rows, rotate 90deg when open, no rotation transition under reduced motion, and file
// names align with folder names at the same depth. Prints the measured sizes either way.
import { serveWorktreeFonts } from "./overflow-probe.mjs";
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";

const args = process.argv.slice(2);
const flag = (k, d) => args.find((f) => f.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const shots = args.includes("--shots");
const tag = flag("tag", "after");
const W = 1440;
const H = 900;
const base = process.env.ASB_UI || "http://localhost:5173";
const NAME = "quiet-otter";
const FILE = "orders-api/src/middleware/rateLimit.ts";
const TREE = ["orders-api/src/app.ts", FILE, "orders-api/src/lib/redis.ts", "orders-api/test/rateLimit.test.ts", "orders-api/test/orders.test.ts", "orders-api/docs/rate-limits.md", "orders-api/package.json", "orders-api/README.md"];
const SOURCE = "import type { NextFunction, Request, Response } from 'express';\nimport { redis } from '../lib/redis';\n\nconst BUCKETS = 6;\n\ninterface Options {\n  limit: number;\n  window?: number;\n}\n\nexport function rateLimit({ limit, window = 60_000 }: Options) {\n  const slice = window / BUCKETS;\n  return async (req: Request, res: Response, next: NextFunction) => {\n    const key = `rl:${req.ip}`;\n    const now = Math.floor(Date.now() / slice);\n    const hits = await redis.hincrby(key, String(now), 1);\n    if (hits > limit) return res.status(429).set('Retry-After', String(slice / 1000)).end();\n    next();\n  };\n}\n";
const DIFF = "@@ -1,4 +1,9 @@\n-const WINDOW = 60_000;\n+const BUCKETS = 6;\n+\n+interface Options {\n+  limit: number;\n+  window?: number;\n+}\n \n-export function rateLimit({ limit }: { limit: number }) {\n+export function rateLimit({ limit, window = 60_000 }: Options) {\n+  const slice = window / BUCKETS;\n";
const T0 = Date.now() - 14 * 60_000;
const box = { name: NAME, role: "session", boxStatus: "running", runState: "running", task: "Replace the fixed-window rate limiter in the orders API with a sliding-window one backed by Redis.", uptime: "14m", cpu: "12%", mem: "1.1G/4G", memUsage: { usedMib: 1130, totalMib: 4096 }, disk: { usedMib: 3800, totalMib: 20480 }, lastOutputAt: Date.now() - 4000, title: "Sliding-window rate limiter", repos: [{ name: "orders-api", branch: "feat/sliding-window-limiter" }], agent: "claude" };
const { role: _r, ...meta } = box;
const LOG = [`⟦at⟧ ${T0}`, "● session started (model ak-claude-opus-4.8)", `⟦at⟧ ${T0 + 9000}`, "I'll start by reading how the limiter is wired today."].join("\n");
const CHANGES = [{ path: FILE, repo: "orders-api", status: "modified", additions: 34, deletions: 11 }];

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? "  " + detail : ""}`); };
const round = (n) => Math.round(n * 100) / 100;

async function openEditor(browser, dark) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: dark ? "dark" : "light", deviceScaleFactor: 1 });
  await ctx.addInitScript((d) => { localStorage.setItem("asb-token", "devtoken123"); localStorage.setItem("asb-dark", d ? "1" : "0"); }, dark);
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
  await quick.type("rateLimit.ts");
  await page.waitForTimeout(250);
  await page.keyboard.press("Enter");
  const modes = page.locator('[role=radiogroup][aria-label="View mode"]');
  await modes.waitFor({ timeout: 8000 });
  await modes.getByRole("radio", { name: "File" }).click();
  await page.locator(".cm-foldGutter").waitFor({ timeout: 8000 });
  await page.waitForTimeout(500);
  return { ctx, page, errors, aside };
}

// Fold markers the reader can see: the gutter's spacer is visibility:hidden and is skipped.
const markers = (page) => page.evaluate(() => Array.from(document.querySelectorAll(".cm-foldGutter .cm-gutterElement")).filter((el) => el.firstChild && getComputedStyle(el).visibility !== "hidden").map((el) => {
  const svg = el.querySelector("svg");
  const node = svg ?? el.firstElementChild ?? el;
  const r = (svg ?? el).getBoundingClientRect();
  const text = el.textContent?.trim() ?? "";
  const holder = svg?.parentElement ?? el.firstElementChild ?? el;
  const open = holder.getAttribute("data-fold") === "open" || text === "▾";
  const opacity = Math.min(parseFloat(getComputedStyle(el).opacity), parseFloat(getComputedStyle(holder).opacity));
  return { tag: node.tagName.toLowerCase(), w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100, open, opacity, text, cell: Math.round(el.getBoundingClientRect().width) };
}));

const browser = await chromium.launch();
try {
  for (const dark of [false, true]) {
    const mode = dark ? "dark" : "light";
    const { ctx, page, errors, aside } = await openEditor(browser, dark);
    const shot = async (name, sel) => {
      if (!shots) return;
      const clip = await page.locator(sel).first().boundingBox();
      await page.screenshot({ path: `.shots/r7/chev-${tag}-${name}-${mode}.png`, clip });
    };

    await page.mouse.move(W / 2, H - 20);
    await page.waitForTimeout(200);
    let m = await markers(page);
    console.log(`${mode}: ${m.length} fold markers, first ${JSON.stringify(m[0])}`);
    check(`${mode}: fold markers exist`, m.length >= 2, `${m.length}`);
    check(`${mode}: every fold marker is a 16x16 svg`, m.every((x) => x.tag === "svg" && x.w === 16 && x.h === 16), m.map((x) => `${x.tag} ${x.w}x${x.h}`).join(", "));
    check(`${mode}: open markers hidden before the gutter is hovered`, m.filter((x) => x.open).every((x) => x.opacity === 0), m.filter((x) => x.open).map((x) => x.opacity).join(","));
    const lines = await page.locator(".cm-line").count();

    await page.hover(".cm-gutters");
    await page.waitForTimeout(250);
    m = await markers(page);
    check(`${mode}: open markers shown while the gutter is hovered`, m.filter((x) => x.open).every((x) => x.opacity === 1), m.filter((x) => x.open).map((x) => x.opacity).join(","));

    const target = page.locator(".cm-foldGutter .cm-gutterElement:visible").filter({ has: page.locator("[data-fold=open]") }).first();
    const targetText = page.locator(".cm-foldGutter .cm-gutterElement:visible").filter({ hasText: "▾" }).first();
    const clickable = (await target.count()) ? target : targetText;
    await clickable.click();
    await page.waitForTimeout(300);
    const placeholders = await page.locator(".cm-foldPlaceholder").count();
    const linesAfter = await page.locator(".cm-line").count();
    check(`${mode}: clicking a marker folds the region`, placeholders >= 1 && linesAfter < lines, `placeholders=${placeholders} lines ${lines} -> ${linesAfter}`);

    await page.mouse.move(W / 2, H - 20);
    await page.waitForTimeout(250);
    m = await markers(page);
    const folded = m.filter((x) => !x.open);
    check(`${mode}: a folded marker stays visible without hover`, folded.length >= 1 && folded.every((x) => x.opacity === 1), folded.map((x) => x.opacity).join(","));
    check(`${mode}: open markers hide again when the pointer leaves`, m.filter((x) => x.open).every((x) => x.opacity === 0));

    const ph = await page.evaluate(() => {
      const el = document.querySelector(".cm-foldPlaceholder");
      if (!el) return null;
      const probe = document.createElement("span");
      probe.className = "text-muted-foreground";
      document.body.appendChild(probe);
      const muted = getComputedStyle(probe).color;
      probe.remove();
      const cs = getComputedStyle(el);
      return { radius: parseFloat(cs.borderRadius), color: cs.color, muted, bg: cs.backgroundColor, text: el.textContent, border: cs.borderWidth };
    });
    check(`${mode}: fold placeholder is a rounded muted pill`, !!ph && ph.radius >= 2 && ph.color === ph.muted && ph.bg !== "rgb(238, 238, 238)", JSON.stringify(ph));

    await page.hover(".cm-gutters");
    await page.waitForTimeout(250);
    await shot("editor", '[data-group="0"]');

    const rows = await page.evaluate(() => Array.from(document.querySelectorAll('[role=tree][aria-label="Files"] [role=treeitem][data-kind]')).map((li) => {
      const svg = li.getAttribute("data-kind") === "dir" ? li.querySelector("svg") : null;
      const r = li.getBoundingClientRect();
      const name = li.querySelector("span.truncate");
      const sr = svg?.getBoundingClientRect();
      const cs = svg ? getComputedStyle(svg) : null;
      return { kind: li.getAttribute("data-kind"), level: Number(li.getAttribute("aria-level")), expanded: li.getAttribute("aria-expanded"), h: r.height, nameX: name ? Math.round(name.getBoundingClientRect().x) : null, twistie: svg ? { w: sr.width, h: sr.height, stroke: svg.getAttribute("stroke-width"), transform: cs.transform, rotate: cs.rotate, color: cs.color, duration: cs.transitionDuration } : null };
    }));
    const dirs = rows.filter((r) => r.kind === "dir");
    const files = rows.filter((r) => r.kind === "file");
    console.log(`${mode}: ${dirs.length} folders, ${files.length} files, row heights ${[...new Set(rows.map((r) => r.h))].join("/")}, twistie ${JSON.stringify(dirs[0]?.twistie)}`);
    check(`${mode}: explorer rows are 22px`, rows.length > 0 && rows.every((r) => r.h === 22), [...new Set(rows.map((r) => r.h))].join("/"));
    check(`${mode}: twisties are 16x16 svgs at 1.5 stroke`, dirs.every((r) => r.twistie && r.twistie.w === 16 && r.twistie.h === 16 && r.twistie.stroke === "1.5"), dirs.map((r) => `${r.twistie?.w}x${r.twistie?.h}@${r.twistie?.stroke}`).join(", "));
    const openDirs = dirs.filter((r) => r.expanded === "true");
    const closedDirs = dirs.filter((r) => r.expanded === "false");
    // Tailwind 4 rotates through the rotate property, so the turn lives there rather than in transform.
    const turned = (t) => t.rotate === "90deg" || /^matrix\(0, 1, -1, 0, 0, 0\)$/.test(t.transform);
    const flat = (t) => (t.rotate === "none" || t.rotate === "0deg") && t.transform === "none";
    check(`${mode}: open folder twisties rotate 90deg, closed ones do not`, openDirs.length >= 1 && closedDirs.length >= 1 && openDirs.every((r) => turned(r.twistie)) && closedDirs.every((r) => flat(r.twistie)), `${openDirs.map((r) => r.twistie.rotate).join(" | ")} vs ${closedDirs.map((r) => r.twistie.rotate).join(" | ")}`);
    check(`${mode}: twistie is the row foreground at 80%`, dirs.every((r) => /\/ 0\.8\)$/.test(r.twistie.color)), dirs[0]?.twistie.color);
    const aligned = files.every((f) => { const d = dirs.find((x) => x.level === f.level); return !d || d.nameX === f.nameX; });
    check(`${mode}: file names align with folder names at the same depth`, aligned && files.some((f) => dirs.some((d) => d.level === f.level)), files.map((f) => `L${f.level}:${f.nameX}`).join(",") + " vs " + dirs.map((d) => `L${d.level}:${d.nameX}`).join(","));

    await page.locator('[role=tree][aria-label="Files"] [data-kind=dir][aria-expanded=true]').last().hover();
    await page.waitForTimeout(200);
    await shot("explorer", 'aside[aria-label="Workspace"] section[aria-label]');

    const reduced = await page.evaluate(() => {
      document.documentElement.dataset.motion = "reduced";
      const svg = document.querySelector('[role=tree][aria-label="Files"] [data-kind=dir] svg');
      const cs = svg ? getComputedStyle(svg) : null;
      const d = cs ? { duration: parseFloat(cs.transitionDuration), property: cs.transitionProperty } : null;
      delete document.documentElement.dataset.motion;
      return d;
    });
    // The root rule clamps every transition to 0.01ms and the twistie also drops its transition property.
    check(`${mode}: twistie rotation has no transition under reduced motion`, !!reduced && (reduced.property === "none" || reduced.duration <= 0.001), JSON.stringify(reduced));
    check(`${mode}: no page errors`, errors.length === 0, errors.slice(0, 3).join(" | "));
    await ctx.close();
  }
} finally { await browser.close(); }
const pass = results.filter((r) => r.ok).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
