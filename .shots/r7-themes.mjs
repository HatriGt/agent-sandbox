// Round 7 theme fixture: five themes, each on the Hub, History and a thread at 1440. Run from
// PowerShell: node .shots/r7-themes.mjs [--shots]
//
// Per theme and route: <html data-theme> and the `dark` class match the registry; the page
// background equals the registry preview; the rail tone differs from the sheet; foreground,
// muted and faint text clear 4.5:1 on the page; the composer border clears 1.3:1 on the page;
// no page errors. Then the migration: a legacy `asb-dark` of 1 → black, 0 → light.
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";
import { openShell } from "./shell-mock.mjs";
import fs from "node:fs";

const shots = process.argv.includes("--shots");
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? "  " + detail : ""}`); };
const ROUTES = { hub: "/dashboard/", history: "/dashboard/history", thread: "/dashboard/box/asb-session-a91b0e44" };
fs.mkdirSync(".shots/r7", { recursive: true });

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
  const aside = document.querySelector("aside");
  const token = (name) => cs(root).getPropertyValue(name).trim();
  const tier = (name) => contrast(rgb(token(name), page), pageRgb);
  const composer = document.querySelector(".composer-depth");
  const composerBorder = composer ? contrast(rgb(cs(composer).borderTopColor, page), pageRgb) : null;
  const trace = contrast(rgb(token("--trace"), page), pageRgb);
  return {
    theme: root.dataset.theme, dark: root.classList.contains("dark"),
    page, pageRgb, rail: aside ? cs(aside).backgroundColor : null, railRgb: aside ? rgb(cs(aside).backgroundColor) : null,
    fg: tier("--foreground"), muted: tier("--muted-foreground"), faint: tier("--faint"), live: tier("--live"),
    composerBorder, trace, hex: (v) => v,
  };
};

const browser = await chromium.launch();
const table = [];
try {
  const probe = await openShell(browser, { theme: "light" });
  const THEMES = await probe.page.evaluate(() => import("/dashboard/src/lib/theme.ts").then((m) => m.THEMES));
  await probe.ctx.close();
  check("registry has five themes", THEMES.length === 5, THEMES.map((t) => t.id).join(" "));

  for (const t of THEMES) {
    for (const [name, route] of Object.entries(ROUTES)) {
      const { ctx, page, errors } = await openShell(browser, { width: 1440, route, theme: t.id, dark: t.scheme === "dark" });
      if (name === "thread") await page.waitForSelector('[aria-label="Conversation"] [data-step]', { timeout: 8000 }).catch(() => {});
      const m = await page.evaluate(measure);
      const expectBg = await page.evaluate((v) => { const cv = document.createElement("canvas"); const c = cv.getContext("2d"); c.fillStyle = v; c.fillRect(0, 0, 1, 1); return [...c.getImageData(0, 0, 1, 1).data].slice(0, 3); }, t.preview.background);
      const tag = `${t.id}/${name}`;
      check(`${tag}: data-theme and dark class`, m.theme === t.id && m.dark === (t.scheme === "dark"), `${m.theme} dark=${m.dark}`);
      check(`${tag}: page background is the registry preview`, m.pageRgb.join() === expectBg.join(), `${m.pageRgb} vs ${expectBg}`);
      check(`${tag}: rail tone differs from the sheet`, m.rail && m.rail !== m.page && m.railRgb.join() !== m.pageRgb.join(), `${m.rail} vs ${m.page}`);
      check(`${tag}: body text >= 4.5:1`, m.fg >= 4.5, m.fg.toFixed(2));
      check(`${tag}: muted text >= 4.5:1`, m.muted >= 4.5, m.muted.toFixed(2));
      check(`${tag}: faint label tier >= 4.5:1`, m.faint >= 4.5, m.faint.toFixed(2));
      if (name !== "history") check(`${tag}: composer border >= 1.3:1 on the page`, m.composerBorder != null && m.composerBorder >= 1.3, m.composerBorder?.toFixed(2) ?? "no composer");
      if (name === "thread") {
        // Syntax colours are one set per scheme (`.tok-*` / `.dark .tok-*`); each must clear AA on the
        // page and on a card, the two grounds a code block sits on.
        const toks = await page.evaluate(() => {
          const cv = document.createElement("canvas"); cv.width = cv.height = 1;
          const c = cv.getContext("2d", { willReadFrequently: true });
          const rgb = (color) => { c.clearRect(0, 0, 1, 1); c.fillStyle = color; c.fillRect(0, 0, 1, 1); return [...c.getImageData(0, 0, 1, 1).data].slice(0, 3); };
          const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
          const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
          const root = getComputedStyle(document.documentElement);
          const grounds = { page: rgb(root.getPropertyValue("--background")), card: rgb(root.getPropertyValue("--card")) };
          const out = {};
          for (const k of ["keyword", "string", "number", "function", "typeName", "propertyName", "comment", "heading"]) {
            const el = document.createElement("span"); el.className = `tok-${k}`; document.body.appendChild(el);
            const col = rgb(getComputedStyle(el).color); el.remove();
            out[k] = Math.min(contrast(col, grounds.page), contrast(col, grounds.card));
          }
          return out;
        });
        const low = Object.entries(toks).filter(([, v]) => v < 4.5);
        check(`${tag}: every syntax colour >= 4.5:1 on page and card`, low.length === 0, low.length ? low.map(([k, v]) => `${k} ${v.toFixed(2)}`).join(", ") : `min ${Math.min(...Object.values(toks)).toFixed(2)}`);
      }
      check(`${tag}: no page errors`, errors.length === 0, errors.join(" | "));
      if (name === "hub") table.push({ theme: t.id, page: m.page, rail: m.rail, body: m.fg.toFixed(2), muted: m.muted.toFixed(2), faint: m.faint.toFixed(2), live: m.live.toFixed(2), composer: m.composerBorder?.toFixed(2), trace: m.trace.toFixed(2) });
      if (shots) await page.screenshot({ path: `.shots/r7/theme-${t.id}-${name}.png` });
      await ctx.close();
    }
  }

  {
    const { ctx, page } = await openShell(browser, { theme: "graphite" });
    await page.click('aside [aria-label^="Theme:"]');
    await page.waitForSelector("[data-theme-option]");
    const rows = await page.$$eval("[data-theme-option]", (els) => els.map((e) => ({ id: e.dataset.themeOption, checked: e.getAttribute("aria-checked"), role: e.getAttribute("role") })));
    check("picker lists the five themes as menu radios", rows.length === 5 && rows.every((r) => r.role === "menuitemradio"), JSON.stringify(rows.map((r) => r.id)));
    check("picker checks the active theme", rows.find((r) => r.id === "graphite")?.checked === "true");
    if (shots) await page.screenshot({ path: ".shots/r7/theme-picker-open.png" });
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(100);
    const after = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, stored: localStorage.getItem("asb-theme"), lastDark: localStorage.getItem("asb-theme-dark") }));
    check("keyboard: arrow twice + enter switches the theme and stores it", after.theme === after.stored && after.theme !== "graphite", JSON.stringify(after));
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
    if (shots) await page.screenshot({ path: ".shots/r7/theme-midnight-landing.png" });
    await ctx.close();
  }

  for (const [legacy, expected] of [["1", "black"], ["0", "light"]]) {
    const { ctx, page } = await openShell(browser, { dark: legacy === "1" });
    const got = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, dark: document.documentElement.classList.contains("dark") }));
    check(`migration: asb-dark=${legacy} with no asb-theme → ${expected}`, got.theme === expected && got.dark === (expected === "black"), JSON.stringify(got));
    await ctx.close();
  }
} finally { await browser.close(); }

console.log("\ntheme     page                      rail                      body   muted  faint  live   composer trace");
for (const r of table) console.log(`${r.theme.padEnd(9)} ${r.page.padEnd(25)} ${String(r.rail).padEnd(25)} ${r.body.padEnd(6)} ${r.muted.padEnd(6)} ${r.faint.padEnd(6)} ${r.live.padEnd(6)} ${String(r.composer).padEnd(8)} ${r.trace}`);
const pass = results.filter((r) => r.ok).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
