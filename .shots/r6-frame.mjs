// Round 6 frame fixture: the content pane is a framed sheet on a tinted rail at desktop widths,
// and the same pane is flush at phone width. Run from PowerShell: node .shots/r6-frame.mjs [--shots]
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";
import { openShell } from "./shell-mock.mjs";
import fs from "node:fs";

const shots = process.argv.includes("--shots");
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? "  " + detail : ""}`); };
const style = (page, sel, props) => page.$eval(sel, (el, props) => { const cs = getComputedStyle(el); return Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)])); }, props);

const browser = await chromium.launch();
try {
  for (const dark of [false, true]) {
    const tag = dark ? "dark" : "light";
    const { ctx, page, errors } = await openShell(browser, { width: 1440, route: "/dashboard/", dark });
    const aside = await style(page, "aside", ["background-color"]);
    const sheet = await style(page, "[data-sheet]", ["background-color", "border-top-left-radius", "border-top-width", "border-left-width", "border-right-width", "border-bottom-width"]);
    const main = await style(page, "main", ["background-color"]);
    check(`${tag}: rail tone differs from sheet`, aside["background-color"] !== sheet["background-color"], `${aside["background-color"]} vs ${sheet["background-color"]}`);
    check(`${tag}: main behind the sheet is on the rail tone`, main["background-color"] === aside["background-color"]);
    const radius = parseFloat(sheet["border-top-left-radius"]);
    check(`${tag}: sheet corner radius 12-16px`, radius >= 12 && radius <= 16, sheet["border-top-left-radius"]);
    check(`${tag}: sheet has top and left hairlines only`, sheet["border-top-width"] === "1px" && sheet["border-left-width"] === "1px" && sheet["border-right-width"] === "0px" && sheet["border-bottom-width"] === "0px");
    const bar = await page.$eval("[data-shell-bar]", (el) => getComputedStyle(el).borderBottomWidth);
    check(`${tag}: shell bar carries no bottom border`, bar === "0px", bar);
    const status = await page.$("[data-status-bar]");
    if (status) { const s = await status.evaluate((el) => getComputedStyle(el).backgroundColor); check(`${tag}: status bar sits on the rail tone`, s === aside["background-color"], s); }
    const gap = await page.evaluate(() => { const a = document.querySelector("aside").getBoundingClientRect(); const s = document.querySelector("[data-sheet]").getBoundingClientRect(); return { x: s.left - a.right, top: s.top }; });
    check(`${tag}: sheet is inset from the rail by 0-2px and starts below the shell bar`, gap.x >= 0 && gap.x <= 2 && gap.top >= 36, JSON.stringify(gap));
    check(`${tag}: no page errors`, errors.length === 0, errors.join(" | "));
    if (shots) await page.screenshot({ path: `.shots/r6/${tag}-1440.png` });
    await ctx.close();
  }
  {
    const { ctx, page } = await openShell(browser, { width: 1440, route: "/dashboard/", collapsed: true });
    const aside = await style(page, "aside", ["background-color", "width"]);
    const sheet = await style(page, "[data-sheet]", ["border-top-left-radius"]);
    check("collapsed rail keeps the frame", parseFloat(sheet["border-top-left-radius"]) >= 12 && parseFloat(aside.width) < 80, `${aside.width} ${sheet["border-top-left-radius"]}`);
    if (shots) await page.screenshot({ path: ".shots/r6/collapsed-1440.png" });
    await ctx.close();
  }
  {
    const { ctx, page } = await openShell(browser, { width: 390, height: 844, route: "/dashboard/" });
    const sheet = await style(page, "[data-sheet]", ["border-top-left-radius", "border-top-width", "border-left-width"]);
    check("phone: pane is flush, no radius, no hairlines", sheet["border-top-left-radius"] === "0px" && sheet["border-top-width"] === "0px" && sheet["border-left-width"] === "0px", JSON.stringify(sheet));
    if (shots) await page.screenshot({ path: ".shots/r6/phone-390.png" });
    await ctx.close();
  }
} finally { await browser.close(); }
const pass = results.filter((r) => r.ok).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
