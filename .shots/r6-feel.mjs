// Round 6 feel fixture: press feedback is transform-only and visible while held, tooltips wait
// once and then follow the pointer instantly, the palette does not scale in on Ctrl+K, the focus
// ring shows on Tab and not on click, live numbers are tabular, icon hit areas reach 40px.
// Run from PowerShell: node .shots/r6-feel.mjs [--shots=before|after]
// Prints the counts the round is judged by: transition:all elements, pressables without an
// :active transform rule, tooltip triggers, numbers without tabular figures.
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";
import { openShell } from "./shell-mock.mjs";
import fs from "node:fs";

const shotArg = process.argv.find((a) => a.startsWith("--shots="));
const shots = shotArg ? shotArg.slice(8) : null;
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? "  " + detail : ""}`); };
const info = (name, detail) => console.log(`INFO ${name}  ${detail}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Static audit of the page: which pressables have an :active rule that sets transform/scale, and
// which elements transition "all". Walks every stylesheet (Vite injects them inline, same-origin).
const AUDIT = () => {
  const rules = [];
  const walk = (list) => { for (const r of list) { if (r.selectorText) { if (r.selectorText.includes(":active") && (r.style.transform || r.style.scale)) rules.push(r.selectorText); } else if (r.cssRules) walk(r.cssRules); } };
  for (const s of document.styleSheets) { try { walk(s.cssRules); } catch {} }
  const sels = rules.flatMap((t) => t.split(",").map((s) => s.replace(/:active/g, "").trim())).filter(Boolean);
  const visible = (el) => !!el.offsetParent || getComputedStyle(el).position === "fixed";
  const pressable = [...document.querySelectorAll("button:not(:disabled), [role=tab], [role=radio], [role=option], a[href], [data-clickable], summary")].filter(visible);
  const name = (el) => (el.getAttribute("aria-label") || el.innerText || el.tagName).trim().slice(0, 28).replace(/\s+/g, " ");
  const noPress = pressable.filter((el) => !sels.some((s) => { try { return el.matches(s); } catch { return false; } }));
  const outOfScope = (el) => el.matches("tr, a[href], [data-variant=ghost]:not([data-size^=icon]), [data-variant=link]");
  const noPressInScope = noPress.filter((el) => !outOfScope(el)).map(name);
  const all = [...document.querySelectorAll("*")].filter((el) => visible(el) && /(^|,\s*)all(,|$)/.test(getComputedStyle(el).transitionProperty) && getComputedStyle(el).transitionDuration !== "0s");
  const nums = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const t = walker.currentNode.textContent.trim();
    const el = walker.currentNode.parentElement;
    if (!t || !/^\d|\d+\/\d+/.test(t) || t.length > 24 || !el || !visible(el)) continue;
    const words = t.replace(/[\d,.:/%·×+\-–]+/g, " ").trim().split(/\s+/).filter(Boolean);
    if (words.length > 2) continue;
    if (!getComputedStyle(el).fontVariantNumeric.includes("tabular-nums")) nums.push(`${el.tagName.toLowerCase()}:${t}`);
  }
  return { pressable: pressable.length, noPress: noPress.map(name), noPressInScope, all: all.map(name), tooltips: document.querySelectorAll("[data-slot=tooltip-trigger]").length, nums };
};

const held = async (page, sel) => {
  const el = await page.$(sel);
  if (!el) return null;
  const box = await el.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await sleep(220);
  const r = await el.evaluate((n) => { const cs = getComputedStyle(n); return { scale: cs.scale, transform: cs.transform, prop: cs.transitionProperty, dur: cs.transitionDuration, bg: cs.backgroundColor }; });
  // Leave before releasing so no click fires (a click would toggle, navigate or prefill).
  await page.mouse.move(5, 5);
  await page.mouse.up();
  const m = /matrix\(([-\d.]+)/.exec(r.transform);
  r.shrunk = (r.scale !== "none" && parseFloat(r.scale) < 1) || (m && parseFloat(m[1]) < 1);
  return r;
};
// A ring is an outline or a box-shadow that is present with :focus-visible and absent without it.
const RING = () => { const el = document.activeElement; const cs = getComputedStyle(el); const fv = el.matches(":focus-visible"); return { fv, outline: fv && cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0, shadow: fv && cs.boxShadow !== "none", tag: `${el.tagName.toLowerCase()}[${el.getAttribute("aria-label") || (el.innerText || "").trim().slice(0, 16)}]` }; };

const browser = await chromium.launch();
try {
  for (const dark of [false, true]) {
    const tag = dark ? "dark" : "light";
    const { ctx, page, errors } = await openShell(browser, { width: 1440, route: "/dashboard/", dark });
    await page.waitForSelector("[data-slot=tooltip-trigger]");
    await sleep(600);
    const a = await page.evaluate(AUDIT);
    info(`${tag} hub audit`, `pressable=${a.pressable} noPress=${a.noPress.length} [${a.noPress.join("|")}] transitionAll=${a.all.length} [${a.all.join("|")}] tooltips=${a.tooltips} nonTabular=${a.nums.length} [${a.nums.join("|")}]`);
    check(`${tag}: nothing in the shell transitions "all"`, a.all.length === 0, a.all.join("|"));
    // Table rows tint instead of scaling, text ghost buttons stay still (r5-shell), and the
    // sidebar brand/trial links live in App.tsx and TrialBadge.tsx, outside this round.
    check(`${tag}: every in-scope pressable has an :active transform rule`, a.noPressInScope.length === 0, a.noPressInScope.join("|"));
    check(`${tag}: live numbers on the hub are tabular`, a.nums.length === 0, a.nums.join("|"));

    // 1. Press feedback, measured while the mouse is held down.
    for (const [label, sel] of [["sidebar toggle (ghost icon)", "[data-shell-bar] button[aria-label$='sidebar']"], ["hub starter chip", "[aria-label='Task starters'] button"], ["hub live-now row", "main button.h-11"], ["status bar section", "[data-status-bar] button"]]) {
      const r = await held(page, sel);
      if (!r) { check(`${tag}: ${label} present`, false, sel); continue; }
      check(`${tag}: ${label} shrinks while held, transform-only transition`, r.shrunk && !/\ball\b/.test(r.prop) && /transform|scale/.test(r.prop), JSON.stringify(r));
    }
    // 1b. Hover tone and pointer on the live-now row.
    const row = await page.$("main button.h-11");
    if (row) {
      const before = await row.evaluate((n) => getComputedStyle(n).backgroundColor);
      await row.hover(); await sleep(200);
      const after = await row.evaluate((n) => ({ bg: getComputedStyle(n).backgroundColor, cursor: getComputedStyle(n).cursor }));
      check(`${tag}: live-now row has a hover tone and a pointer`, before !== after.bg && after.cursor === "pointer", `${before} -> ${after.bg} ${after.cursor}`);
      await page.mouse.move(5, 5);
    }

    // 2. Tooltips: the first waits, the next follows instantly with no entry animation.
    const triggers = [await page.$("aside button[aria-label^='Theme:']"), await page.$("aside button[aria-label='Sign out']")].filter(Boolean);
    if (triggers.length >= 2) {
      const t0 = Date.now();
      await triggers[0].hover();
      await page.waitForSelector("[data-slot=tooltip-content]", { state: "visible", timeout: 2000 });
      const firstMs = Date.now() - t0;
      check(`${tag}: first tooltip waits 300-700ms`, firstMs >= 300 && firstMs <= 700, `${firstMs}ms`);
      const firstAnim = await page.$eval("[data-slot=tooltip-content]", (n) => { const cs = getComputedStyle(n); return { state: n.dataset.state, anim: cs.animationName, dur: cs.animationDuration, origin: cs.transformOrigin, transform: cs.transform }; });
      check(`${tag}: first tooltip animates 100-160ms with an origin`, firstAnim.anim !== "none" && parseFloat(firstAnim.dur) * 1000 >= 100 && parseFloat(firstAnim.dur) * 1000 <= 160 && firstAnim.origin !== "", JSON.stringify(firstAnim));
      // Hover B from inside the page so the clock and the pointermove share one thread.
      const second = await triggers[1].evaluate(async (b) => {
        const firstText = document.querySelector("[data-slot=tooltip-content]")?.textContent;
        const t = performance.now();
        b.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse", clientX: 1, clientY: 1 }));
        let el = null;
        for (let i = 0; i < 60; i++) {
          el = [...document.querySelectorAll("[data-slot=tooltip-content]")].find((n) => n.textContent !== firstText);
          if (el) break;
          await new Promise((r) => setTimeout(r, 4));
        }
        if (!el) return { ms: -1 };
        const cs = getComputedStyle(el);
        return { ms: Math.round(performance.now() - t), state: el.dataset.state, anim: cs.animationName, text: el.textContent.slice(0, 20) };
      });
      check(`${tag}: second tooltip opens under 60ms`, second.ms >= 0 && second.ms < 60, JSON.stringify(second));
      check(`${tag}: instant tooltip has no entry animation`, second.state === "instant-open" && second.anim === "none", JSON.stringify(second));
      // The synthetic pointermove never really left B, so its tooltip stays up; Escape dismisses
      // it (an open tooltip would otherwise swallow the palette's Escape below).
      await page.mouse.move(5, 5);
      await page.keyboard.press("Escape");
      await page.waitForSelector("[data-slot=tooltip-content]", { state: "detached", timeout: 2000 }).catch(() => {});
      await sleep(300);
    } else check(`${tag}: two adjacent tooltip triggers in the sidebar footer`, false, `${triggers.length}`);

    // 3. Keyboard-opened palette: no scale, opacity-only fade of 100ms or less, instant close.
    const sampler = page.evaluate(async () => {
      const out = []; const t = performance.now();
      while (performance.now() - t < 160) {
        const d = document.querySelector("dialog[aria-label='Command palette']");
        if (d) { const cs = getComputedStyle(d); out.push({ at: Math.round(performance.now() - t), open: d.open, scale: cs.scale, transform: cs.transform, opacity: cs.opacity, prop: cs.transitionProperty, dur: cs.transitionDuration }); }
        await new Promise((r) => requestAnimationFrame(r));
      }
      return out;
    });
    await page.keyboard.press("Control+k");
    const samples = await sampler;
    const opened = samples.filter((s) => s.open);
    const scaled = opened.filter((s) => (s.scale !== "none" && s.scale !== "1") || /matrix\((?!1, 0, 0, 1,)/.test(s.transform) || /scale|transform/.test(s.prop));
    check(`${tag}: palette opened by Ctrl+K never scales`, opened.length > 0 && scaled.length === 0, `open samples=${opened.length} scaled=${scaled.length} first=${JSON.stringify(opened[0])}`);
    const fade = opened.length ? Math.max(...opened.map((s) => Math.max(...s.dur.split(",").map((x) => parseFloat(x) * (x.includes("ms") ? 1 : 1000))))) : -1;
    check(`${tag}: palette open fade is 100ms or shorter`, fade >= 0 && fade <= 100, `${fade}ms ${opened[0]?.prop}`);
    const cursorAnim = await page.evaluate(() => !!document.querySelector("dialog[aria-label='Command palette'] [role=option]"));
    await page.keyboard.press("ArrowDown");
    const moved = await page.evaluate(async () => {
      const cur = document.querySelector("dialog[aria-label='Command palette'] [aria-selected=true] .bg-accent");
      if (!cur) return { found: false };
      const a = cur.getBoundingClientRect().top;
      await new Promise((r) => setTimeout(r, 40));
      const b = cur.getBoundingClientRect().top;
      await new Promise((r) => setTimeout(r, 120));
      const c = cur.getBoundingClientRect().top;
      return { found: true, settledIn40: Math.abs(a - b) < 0.5 && Math.abs(b - c) < 0.5, a, b, c };
    });
    check(`${tag}: palette cursor jumps on ArrowDown (no spring)`, !cursorAnim || !moved.found || moved.settledIn40, JSON.stringify(moved));
    // Escape, then sample at once: with no exit transition the first frame is already display:none.
    await page.keyboard.press("Escape");
    const cs = await page.evaluate(async () => {
      const d = document.querySelector("dialog[aria-label='Command palette']"); const t = performance.now(); const out = [];
      while (performance.now() - t < 250) { const s = getComputedStyle(d); out.push({ at: Math.round(performance.now() - t), open: d.open, display: s.display, opacity: s.opacity }); await new Promise((r) => requestAnimationFrame(r)); }
      return out;
    });
    const lingering = cs.filter((s) => !s.open && s.display !== "none");
    check(`${tag}: palette closes without an exit animation`, cs.some((s) => !s.open) && lingering.length === 0, `closed samples=${cs.filter((s) => !s.open).length} lingering=${lingering.length} ${JSON.stringify(lingering[0] || cs[0] || {})}`);
    await sleep(200);

    // 4. Focus ring on Tab, none on click.
    await page.mouse.click(720, 60);
    const tabbed = [];
    for (let i = 0; i < 10; i++) { await page.keyboard.press("Tab"); tabbed.push(await page.evaluate(RING)); }
    const stops = tabbed.filter((r) => !r.tag.startsWith("body"));
    const noRing = stops.filter((r) => !r.outline && !r.shadow);
    check(`${tag}: the first ${stops.length} Tab stops all show a ring`, stops.length >= 6 && noRing.length === 0, noRing.map((r) => r.tag).join("|") || stops.map((r) => r.tag).join("|"));
    // Mouse down on a chip focuses it without firing its click; the ring must not appear. The third
    // chip, because the tenth Tab stop above is the first one and a re-press of an already focused
    // element keeps whatever modality it had.
    const chip = (await page.$$("[aria-label='Task starters'] button"))[2];
    const cb = await chip.boundingBox();
    await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
    await page.mouse.down();
    const clicked = await page.evaluate(RING);
    await page.mouse.move(5, 5);
    await page.mouse.up();
    check(`${tag}: a mouse-focused chip shows no ring`, clicked.tag.startsWith("button") && !clicked.fv && !clicked.outline && !clicked.shadow, JSON.stringify(clicked));

    // 5. Hit areas: shell bar icon button is 32px visually and 40px to the pointer.
    const hit = await page.$eval("[data-shell-bar] button[aria-label$='sidebar']", (el) => {
      const r = el.getBoundingClientRect(); const cx = r.left + r.width / 2; const cy = r.top + r.height / 2;
      const inside = (x, y) => { const t = document.elementFromPoint(x, y); return !!t && (t === el || el.contains(t)); };
      return { w: r.width, h: r.height, reach: inside(cx - 19, cy) && inside(cx + 19, cy) && inside(cx, cy - 17) && inside(cx, cy + 17) };
    });
    check(`${tag}: sidebar toggle is 32px visually and reaches 40px wide`, hit.w >= 32 && hit.h >= 32 && hit.reach, JSON.stringify(hit));
    const wrap = await page.$eval("main h1", (h) => getComputedStyle(h).textWrap || getComputedStyle(h).textWrapStyle);
    check(`${tag}: hub greeting balances`, /balance/.test(wrap), wrap);
    const sub = await page.$eval("main p.text-body", (p) => getComputedStyle(p).textWrap || getComputedStyle(p).textWrapStyle);
    check(`${tag}: hub subtitle wraps pretty`, /pretty/.test(sub), sub);
    check(`${tag}: no page errors on the hub`, errors.length === 0, errors.join(" | "));
    if (shots) await page.screenshot({ path: `.shots/r6/feel-${shots}-hub-${tag}.png` });
    await ctx.close();

    // History: table rows, sort affordance, numeric columns, inset focus ring on a row.
    {
      const { ctx, page, errors } = await openShell(browser, { width: 1440, route: "/dashboard/history", dark });
      await page.waitForSelector("tr[data-clickable]");
      await sleep(600);
      const a = await page.evaluate(AUDIT);
      info(`${tag} history audit`, `pressable=${a.pressable} noPress=${a.noPress.length} [${a.noPress.join("|")}] transitionAll=${a.all.length} nonTabular=${a.nums.length} [${a.nums.join("|")}]`);
      check(`${tag}: history numbers are tabular`, a.nums.length === 0, a.nums.join("|"));
      const r1 = await page.$("tr[data-clickable]");
      const idle = await r1.evaluate((n) => getComputedStyle(n).backgroundColor);
      await r1.hover(); await sleep(200);
      const hov = await r1.evaluate((n) => ({ bg: getComputedStyle(n).backgroundColor, cursor: getComputedStyle(n).cursor }));
      check(`${tag}: table row has a hover tone and a pointer`, idle !== hov.bg && hov.cursor === "pointer", `${idle} -> ${hov.bg}`);
      const heldRow = await held(page, "tr[data-clickable]");
      check(`${tag}: held table row tints (no scale on a full-width table row)`, heldRow && heldRow.bg !== idle && !heldRow.shrunk && !/\ball\b/.test(heldRow.prop), JSON.stringify(heldRow));
      const lines = await page.evaluate(() => {
        const rows = [...document.querySelectorAll("tbody tr")];
        const bottoms = rows.map((r) => getComputedStyle(r.querySelector("td")).borderBottomWidth);
        const card = rows[rows.length - 1]?.closest("[class*=rounded]");
        return { rows: rows.length, mid: bottoms.slice(0, -1).every((b) => b === "1px"), last: bottoms[bottoms.length - 1], cardBorder: card ? getComputedStyle(card).borderBottomWidth : "none" };
      });
      check(`${tag}: 1px hairline between rows, none doubled at the card edge`, lines.rows > 1 && lines.mid && (lines.last === "0px" || lines.cardBorder === "0px"), JSON.stringify(lines));
      const sortBtn = await page.$("thead button");
      const sortBefore = sortBtn ? await sortBtn.evaluate((b) => ({ op: getComputedStyle(b.querySelector("svg")).opacity, cursor: getComputedStyle(b).cursor })) : null;
      if (sortBtn) { await sortBtn.hover(); await sleep(200); }
      const sortAfter = sortBtn ? await sortBtn.evaluate((b) => getComputedStyle(b.querySelector("svg")).opacity) : "0";
      check(`${tag}: sort chevron brightens on hover`, !!sortBefore && parseFloat(sortAfter) > parseFloat(sortBefore.op) && sortBefore.cursor === "pointer", JSON.stringify({ sortBefore, sortAfter }));
      const numeric = await page.evaluate(() => [...document.querySelector("tbody tr[data-clickable]").querySelectorAll("td[data-align=end]")].map((td) => ({ align: getComputedStyle(td).textAlign, tab: getComputedStyle(td).fontVariantNumeric })));
      check(`${tag}: numeric columns are end-aligned and tabular`, numeric.length > 0 && numeric.every((c) => c.align === "end" && c.tab.includes("tabular-nums")), JSON.stringify(numeric));
      await page.mouse.click(720, 60);
      let rowRing = null;
      for (let i = 0; i < 40 && !rowRing; i++) {
        await page.keyboard.press("Tab");
        rowRing = await page.evaluate(() => { const el = document.activeElement; if (!el || !el.matches("tr[data-clickable]")) return null; const cs = getComputedStyle(el); return { outline: cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0, offset: cs.outlineOffset, shadow: cs.boxShadow }; });
      }
      check(`${tag}: a Tab-focused table row shows an inset ring`, !!rowRing && (rowRing.outline ? parseFloat(rowRing.offset) < 0 : rowRing.shadow.includes("inset")), JSON.stringify(rowRing));
      check(`${tag}: no page errors on history`, errors.length === 0, errors.join(" | "));
      if (shots) await page.screenshot({ path: `.shots/r6/feel-${shots}-history-${tag}.png` });
      await ctx.close();
    }

    // Fleet: sidebar machine rows press at 0.98 and the row focus ring sits inside the rail.
    {
      const { ctx, page, errors } = await openShell(browser, { width: 1440, route: "/dashboard/fleet", dark });
      await page.waitForSelector("nav[aria-label='Machines'] button");
      await sleep(600);
      const a = await page.evaluate(AUDIT);
      info(`${tag} fleet audit`, `pressable=${a.pressable} noPress=${a.noPress.length} [${a.noPress.join("|")}] transitionAll=${a.all.length} nonTabular=${a.nums.length} [${a.nums.join("|")}]`);
      const r = await held(page, "nav[aria-label='Machines'] button.h-9");
      check(`${tag}: sidebar machine row shrinks slightly while held`, !!r && r.shrunk && !/\ball\b/.test(r.prop), JSON.stringify(r));
      check(`${tag}: no page errors on fleet`, errors.length === 0, errors.join(" | "));
      if (shots) await page.screenshot({ path: `.shots/r6/feel-${shots}-fleet-${tag}.png` });
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
const pass = results.filter((r) => r.ok).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
