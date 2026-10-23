// Round 8 theme fixture: nine themes, each on the Hub, History and a thread at 1440, and the theme
// panel. Run from PowerShell: node .shots/r8-themes.mjs [--shots]
//
// Per theme and route: <html data-theme> and the `dark` class match the registry; the page
// background equals the registry preview; the rail tone differs from the sheet; foreground, muted
// and faint text clear 4.5:1 on the page; --live clears 4.5:1 on the page and the card; every
// syntax colour clears 4.5:1 on the page and the card; the composer border clears 1.3:1; no page
// errors. Then the panel: nine cards, the active one ringed, hover previews within 300ms and
// leaving reverts, click commits and stores, arrows + Enter commit. Then the landing toggle and
// the legacy `asb-dark` migration.
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";
import { openShell } from "./shell-mock.mjs";
import fs from "node:fs";

const shots = process.argv.includes("--shots");
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? "  " + detail : ""}`); };
const ROUTES = { hub: "/dashboard/", history: "/dashboard/history", thread: "/dashboard/box/asb-session-a91b0e44" };
fs.mkdirSync(".shots/r8", { recursive: true });

/* Colour maths in the page: a canvas resolves any CSS colour (oklch, alpha) to sRGB bytes, and an
   alpha colour is composited over `over` first, so a hairline's real tone is what gets measured. */
const measure = () => {
  const cv = document.createElement("canvas"); cv.width = cv.height = 1;
  const c = cv.getContext("2d", { willReadFrequently: true });
  const rgb = (color, over) => {
    c.clearRect(0, 0, 1, 1);
    if (over) { c.fillStyle = over; c.fillRect(0, 0, 1, 1); }
    c.fillStyle = color; c.fillRect(0, 0, 1, 1);
    return [...c.getImageData(0, 0, 1, 1).data].slice(0, 3);
  };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const cs = (el) => getComputedStyle(el);
  const root = document.documentElement;
  const page = cs(document.querySelector("[data-sheet]") ?? document.body).backgroundColor;
  const pageRgb = rgb(page);
  const token = (name) => cs(root).getPropertyValue(name).trim();
  const card = token("--card");
  const cardRgb = rgb(card, page);
  const aside = document.querySelector("aside");
  const onPage = (name) => contrast(rgb(token(name), page), pageRgb);
  const onCard = (name) => contrast(rgb(token(name), card), cardRgb);
  const composer = document.querySelector(".composer-depth");
  const composerBorder = composer ? contrast(rgb(cs(composer).borderTopColor, page), pageRgb) : null;
  const toks = {};
  for (const k of ["keyword", "string", "number", "function", "typeName", "propertyName", "comment", "heading"]) {
    const el = document.createElement("span"); el.className = `tok-${k}`; document.body.appendChild(el);
    const col = rgb(cs(el).color); el.remove();
    toks[k] = Math.min(contrast(col, pageRgb), contrast(col, cardRgb));
  }
  return {
    theme: root.dataset.theme, dark: root.classList.contains("dark"),
    page, pageRgb, card, rail: aside ? cs(aside).backgroundColor : null, railRgb: aside ? rgb(cs(aside).backgroundColor) : null,
    fg: onPage("--foreground"), muted: onPage("--muted-foreground"), faint: onPage("--faint"),
    live: onPage("--live"), liveOnCard: onCard("--live"), composerBorder, trace: onPage("--trace"), toks,
  };
};
/* Other workstreams edit the same dev server; a Vite full reload mid-measure destroys the context,
   so one retry after the page settles keeps a shared-server reload from reading as a theme bug. */
const measureSettled = async (page) => {
  try { return await page.evaluate(measure); } catch (e) {
    if (!/Execution context was destroyed/.test(String(e))) throw e;
    await page.waitForLoadState("load"); await page.waitForTimeout(1500);
    return page.evaluate(measure);
  }
};
const pageBg = (page) => page.evaluate(() => getComputedStyle(document.querySelector("[data-sheet]")).backgroundColor);
const waitForBgChange = async (page, from, ms) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if ((await pageBg(page)) !== from) return Date.now() - t0; await page.waitForTimeout(16); }
  return null;
};

const browser = await chromium.launch();
const table = [];
try {
  const probe = await openShell(browser, { theme: "light" });
  const THEMES = await probe.page.evaluate(() => import("/dashboard/src/lib/theme.ts").then((m) => m.THEMES));
  await probe.ctx.close();
  check("registry has nine themes", THEMES.length === 9, THEMES.map((t) => t.id).join(" "));

  for (const t of THEMES) {
    for (const [name, route] of Object.entries(ROUTES)) {
      const { ctx, page, errors } = await openShell(browser, { width: 1440, route, theme: t.id, dark: t.scheme === "dark" });
      if (name === "thread") await page.waitForSelector('[aria-label="Conversation"] [data-step]', { timeout: 8000 }).catch(() => {});
      const m = await measureSettled(page);
      const expectBg = await page.evaluate((v) => { const cv = document.createElement("canvas"); const c = cv.getContext("2d"); c.fillStyle = v; c.fillRect(0, 0, 1, 1); return [...c.getImageData(0, 0, 1, 1).data].slice(0, 3); }, t.preview.background);
      const tag = `${t.id}/${name}`;
      check(`${tag}: data-theme and dark class`, m.theme === t.id && m.dark === (t.scheme === "dark"), `${m.theme} dark=${m.dark}`);
      check(`${tag}: page background is the registry preview`, m.pageRgb.join() === expectBg.join(), `${m.pageRgb} vs ${expectBg}`);
      check(`${tag}: rail tone differs from the sheet`, m.rail && m.railRgb.join() !== m.pageRgb.join(), `${m.rail} vs ${m.page}`);
      check(`${tag}: body text >= 4.5:1`, m.fg >= 4.5, m.fg.toFixed(2));
      check(`${tag}: muted text >= 4.5:1`, m.muted >= 4.5, m.muted.toFixed(2));
      check(`${tag}: faint label tier >= 4.5:1`, m.faint >= 4.5, m.faint.toFixed(2));
      check(`${tag}: --live >= 4.5:1 on the page and the card`, m.live >= 4.5 && m.liveOnCard >= 4.5, `${m.live.toFixed(2)} / ${m.liveOnCard.toFixed(2)}`);
      const low = Object.entries(m.toks).filter(([, v]) => v < 4.5);
      check(`${tag}: every syntax colour >= 4.5:1 on page and card`, low.length === 0, low.length ? low.map(([k, v]) => `${k} ${v.toFixed(2)}`).join(", ") : `min ${Math.min(...Object.values(m.toks)).toFixed(2)}`);
      if (name !== "history") check(`${tag}: composer border >= 1.3:1 on the page`, m.composerBorder != null && m.composerBorder >= 1.3, m.composerBorder?.toFixed(2) ?? "no composer");
      check(`${tag}: no page errors`, errors.length === 0, errors.join(" | "));
      if (name === "hub") table.push({ theme: t.id, page: m.page, rail: m.rail, body: m.fg.toFixed(2), muted: m.muted.toFixed(2), faint: m.faint.toFixed(2), live: m.live.toFixed(2), liveCard: m.liveOnCard.toFixed(2), tok: Math.min(...Object.values(m.toks)).toFixed(2), composer: m.composerBorder?.toFixed(2), trace: m.trace.toFixed(2) });
      if (shots && name === "hub") await page.screenshot({ path: `.shots/r8/theme-${t.id}-hub.png` });
      await ctx.close();
    }
  }

  for (const [start, other, shot] of [["light", "forest", "light"], ["black", "mist", "dark"]]) {
    const { ctx, page, errors } = await openShell(browser, { theme: start, dark: start === "black" });
    await page.click('aside [aria-label^="Theme:"]');
    await page.waitForSelector("[data-theme-panel]");
    await page.waitForTimeout(200);
    const cards = await page.$$eval("[data-theme-card]", (els) => els.map((e) => ({ id: e.dataset.themeCard, checked: e.getAttribute("aria-checked"), role: e.getAttribute("role"), shadow: getComputedStyle(e).boxShadow })));
    check(`panel (${start}): nine radio cards`, cards.length === 9 && cards.every((c) => c.role === "radio"), cards.map((c) => c.id).join(" "));
    const active = cards.find((c) => c.id === start);
    check(`panel (${start}): the active card is checked and ringed`, active?.checked === "true" && /2px/.test(active.shadow) && cards.filter((c) => c.shadow !== "none").length === 1, active?.shadow);
    const headers = await page.$$eval("[data-theme-panel] .label", (els) => els.map((e) => e.textContent));
    check(`panel (${start}): grouped under Light and Dark`, headers.join(",") === "Light,Dark", headers.join(","));
    if (shots) await page.screenshot({ path: `.shots/r8/theme-panel-${shot}.png` });
    const before = await pageBg(page);
    await page.hover(`[data-theme-card="${other}"]`);
    const took = await waitForBgChange(page, before, 300);
    const previewed = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, stored: localStorage.getItem("asb-theme") }));
    check(`panel (${start}): hovering ${other} previews it within 300ms without storing`, took !== null && previewed.theme === other && previewed.stored === start, `${took}ms ${JSON.stringify(previewed)}`);
    await page.mouse.move(720, 300);
    await page.waitForTimeout(100);
    const reverted = await page.evaluate(() => document.documentElement.dataset.theme);
    check(`panel (${start}): leaving the panel reverts to ${start}`, reverted === start && (await pageBg(page)) === before, reverted);
    const stillOpen = await page.$("[data-theme-panel]");
    check(`panel (${start}): still open after the pointer leaves`, !!stillOpen);
    await page.click(`[data-theme-card="${other}"]`);
    const closed = await page.waitForSelector("[data-theme-panel]", { state: "detached", timeout: 1000 }).then(() => true, () => false);
    const committed = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, stored: localStorage.getItem("asb-theme") }));
    check(`panel (${start}): clicking ${other} commits, stores and closes`, committed.theme === other && committed.stored === other && closed, JSON.stringify({ ...committed, closed }));
    check(`panel (${start}): no page errors`, errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  {
    const { ctx, page } = await openShell(browser, { theme: "graphite", dark: true });
    await page.click('aside [aria-label^="Theme:"]');
    await page.waitForSelector("[data-theme-panel]");
    await page.waitForTimeout(200);
    const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-theme-card"));
    check("keyboard: the active card has focus on open", focused === "graphite", focused);
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(50);
    const arrowed = await page.evaluate(() => ({ focus: document.activeElement?.getAttribute("data-theme-card"), theme: document.documentElement.dataset.theme, stored: localStorage.getItem("asb-theme") }));
    check("keyboard: ArrowRight moves focus and previews without storing", arrowed.focus === "midnight" && arrowed.theme === "midnight" && arrowed.stored === "graphite", JSON.stringify(arrowed));
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    const enterClosed = await page.waitForSelector("[data-theme-panel]", { state: "detached", timeout: 1000 }).then(() => true, () => false);
    const after = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, stored: localStorage.getItem("asb-theme"), lastDark: localStorage.getItem("asb-theme-dark") }));
    check("keyboard: ArrowDown + Enter commits Forest and stores it", after.theme === "forest" && after.stored === "forest" && after.lastDark === "forest" && enterClosed, JSON.stringify({ ...after, closed: enterClosed }));
    await page.click('aside [aria-label^="Theme:"]');
    await page.waitForSelector("[data-theme-panel]");
    await page.waitForTimeout(200);
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(50);
    await page.keyboard.press("Escape");
    const escClosed = await page.waitForSelector("[data-theme-panel]", { state: "detached", timeout: 1000 }).then(() => true, () => false);
    const escaped = await page.evaluate(() => document.documentElement.dataset.theme);
    check("keyboard: Escape after an arrow preview closes and reverts", escaped === "forest" && escClosed, JSON.stringify({ theme: escaped, closed: escClosed }));
    await ctx.close();
  }

  {
    const { ctx, page, errors } = await openShell(browser, { route: "/", theme: "midnight", dark: true });
    const before = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.click('header button[aria-label^="Switch to"]');
    const after = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, dark: document.documentElement.classList.contains("dark"), lastDark: localStorage.getItem("asb-theme-dark") }));
    check("landing: toggle flips Midnight to Light and remembers Midnight as the dark theme", before === "midnight" && after.theme === "light" && !after.dark && after.lastDark === "midnight", JSON.stringify({ before, ...after }));
    await page.click('header button[aria-label^="Switch to"]');
    const back = await page.evaluate(() => document.documentElement.dataset.theme);
    check("landing: toggling back returns to Midnight, not Black", back === "midnight", back);
    check("landing: no page errors", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  for (const [legacy, expected] of [["1", "black"], ["0", "light"]]) {
    const { ctx, page } = await openShell(browser, { dark: legacy === "1" });
    const got = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, dark: document.documentElement.classList.contains("dark") }));
    check(`migration: asb-dark=${legacy} with no asb-theme -> ${expected}`, got.theme === expected && got.dark === (expected === "black"), JSON.stringify(got));
    await ctx.close();
  }
} finally { await browser.close(); }

console.log("\ntheme     page                      rail                      body   muted  faint  live   live/card tok-min composer trace");
for (const r of table) console.log(`${r.theme.padEnd(9)} ${r.page.padEnd(25)} ${String(r.rail).padEnd(25)} ${r.body.padEnd(6)} ${r.muted.padEnd(6)} ${r.faint.padEnd(6)} ${r.live.padEnd(6)} ${r.liveCard.padEnd(9)} ${r.tok.padEnd(7)} ${String(r.composer).padEnd(8)} ${r.trace}`);
const pass = results.filter((r) => r.ok).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
