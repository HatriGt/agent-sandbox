// Round 8 wording: measures the top-bar fleet chip ("N working · N action needed") and the collapsed
// rail tooltip before and after the "need you" → "action needed" rename, so the width delta and any
// truncation, wrapping or collision with the search field are numbers, not an eyeball.
//
//   node .shots/r8-wording.mjs --tag before|after      (ASB_UI defaults to http://localhost:5173)
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";
import { openShell, boxes } from "./shell-mock.mjs";

const tag = process.argv[process.argv.indexOf("--tag") + 1] || "now";
const out = (name) => `.shots/r8/wording-${tag}-${name}.png`;
const now = Math.floor(Date.now() / 1000);
const waitingBoxes = [{ ...boxes[0], runState: "waiting", question: "Patch the retry path or revert the whole commit?", lastOutputAt: now - 30 }, ...boxes.slice(1)];

const browser = await chromium.launch();
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"} ${name}${extra ? ` (${extra})` : ""}`);

const measure = (page) =>
  page.evaluate(() => {
    const chip = [...document.querySelectorAll('[aria-live="polite"]')].find((e) => /working/.test(e.textContent || ""));
    const search = [...document.querySelectorAll("button")].find((b) => /Search or jump to/.test(b.textContent || ""));
    const r = (e) => (e ? e.getBoundingClientRect() : null);
    const c = r(chip);
    const s = r(search);
    const last = chip?.lastElementChild;
    const tabs = search?.previousElementSibling;
    const t = r(tabs);
    return {
      text: chip?.textContent?.replace(/\s+/g, " ").trim(),
      width: c && Math.round(c.width),
      height: c && Math.round(c.height),
      wrapped: chip ? chip.scrollHeight > chip.clientHeight + 2 : null,
      truncated: last ? last.scrollWidth > last.clientWidth + 1 : null,
      overflowsViewport: c ? Math.round(c.right) > window.innerWidth : null,
      searchWidth: s && Math.round(s.width),
      tabStripWidth: t && Math.round(t.width),
    };
  });

for (const width of [1440, 1280]) {
  const { ctx, page, errors } = await openShell(browser, { width });
  const zero = await measure(page);
  console.log(`${width} zero:`, JSON.stringify(zero));
  check(`${width} chip renders one line`, zero.wrapped === false && zero.height <= 30, `h=${zero.height}`);
  check(`${width} chip text not truncated`, zero.truncated === false);
  check(`${width} chip stays inside the bar, search keeps w-56`, zero.overflowsViewport === false && zero.searchWidth === 224, `tabs=${zero.tabStripWidth}px`);
  await page.screenshot({ path: out(`topbar-${width}`), clip: { x: 0, y: 0, width, height: 56 } });
  if (width === 1440) await page.screenshot({ path: out("sidebar-1440"), clip: { x: 0, y: 0, width: 280, height: 900 } });

  await ctx.route((u) => new URL(u).pathname === "/fleet.json", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ boxes: waitingBoxes, lifecycle: { capacity: 8, poolSize: 1 }, at: Date.now() }) }));
  await ctx.route((u) => new URL(u).pathname === "/monitor.json", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(waitingBoxes) }));
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(1500);
  const one = await measure(page);
  console.log(`${width} one waiting:`, JSON.stringify(one));
  check(`${width} waiting chip renders one line`, one.wrapped === false && one.height <= 30, `h=${one.height}`);
  check(`${width} waiting chip stays inside the bar, search keeps w-56`, one.overflowsViewport === false && one.searchWidth === 224, `tabs=${one.tabStripWidth}px`);
  await page.screenshot({ path: out(`topbar-waiting-${width}`), clip: { x: 0, y: 0, width, height: 56 } });
  if (width === 1440) {
    const side = await page.evaluate(() => {
      const el = [...document.querySelectorAll("aside span")].filter((e) => /^\d+ (need you|action needed)$/.test((e.textContent || "").trim())).sort((a, b) => a.textContent.length - b.textContent.length)[0];
      const r = el?.getBoundingClientRect();
      const label = el?.parentElement?.querySelector("span.truncate");
      return el ? { text: el.textContent.replace(/\s+/g, " ").trim(), width: Math.round(r.width), truncated: el.scrollWidth > el.clientWidth + 1, rowLabel: label?.textContent, rowLabelTruncated: label ? label.scrollWidth > label.clientWidth + 1 : null } : null;
    });
    console.log("1440 sidebar count label:", JSON.stringify(side));
    check("sidebar count label not truncated", side && side.truncated === false, side?.text);
    check("sidebar row label still reads in full beside the count", side && side.rowLabelTruncated === false, side?.rowLabel);
    await page.screenshot({ path: out("sidebar-waiting-1440"), clip: { x: 0, y: 0, width: 280, height: 900 } });
  }
  check(`${width} no page errors`, errors.length === 0, errors.join(" | ").slice(0, 200));
  await ctx.close();
}

{
  const { ctx, page, errors } = await openShell(browser, { width: 1440, collapsed: true });
  await ctx.route((u) => new URL(u).pathname === "/fleet.json", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ boxes: waitingBoxes, lifecycle: { capacity: 8, poolSize: 1 }, at: Date.now() }) }));
  await ctx.route((u) => new URL(u).pathname === "/monitor.json", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(waitingBoxes) }));
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(1500);
  const rail = page.locator('button[aria-label^="Fleet view"]').first();
  await rail.hover();
  await page.waitForTimeout(700);
  const tip = await page.evaluate(() => {
    const t = [...document.querySelectorAll('[role="tooltip"], [data-slot="tooltip-content"]')].find((e) => /Fleet view/.test(e.textContent || ""));
    const r = t?.getBoundingClientRect();
    return t ? { text: t.textContent.replace(/\s+/g, " ").trim(), width: Math.round(r.width), height: Math.round(r.height) } : null;
  });
  console.log("collapsed rail tooltip:", JSON.stringify(tip));
  check("rail tooltip shows the count", !!tip && /1 /.test(tip.text), tip?.text);
  check("rail tooltip is one line", !!tip && tip.height <= 32, `h=${tip?.height}`);
  await page.screenshot({ path: out("rail-tooltip-1440"), clip: { x: 0, y: 0, width: 420, height: 320 } });
  check("collapsed: no page errors", errors.length === 0, errors.join(" | ").slice(0, 200));
  await ctx.close();
}

await browser.close();
console.log(results.join("\n"));
console.log(`${results.filter((r) => r.startsWith("PASS")).length}/${results.length} pass`);
