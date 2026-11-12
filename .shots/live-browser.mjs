// Drive the LIVE dashboard as a person would: open a finished run, click the localhost link the
// agent wrote, pick an element in the Browser pane, comment, send, and watch the change arrive.
//   ASB_SESS=<session id> node .shots/live-browser.mjs <box> <out-prefix> <step> [--hx= --hy=] [--msg="..."]
// step: look (open + pane via link) · pick (select, hover at hx/hy, click) · send (pick + comment + send + wait)
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";
const [box, out, step] = process.argv.slice(2);
const flag = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
const W = Number(flag("w", "1440")), H = Number(flag("h", "900"));
const sess = process.env.ASB_SESS;
if (!sess) throw new Error("no session");
const ORIGIN = "https://agent-sandbox.ajeethkumar.dev";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: W < 500, isMobile: W < 500 });
await ctx.addCookies([{ name: "asb_session", value: sess, domain: "agent-sandbox.ajeethkumar.dev", path: "/", secure: true, httpOnly: true, sameSite: "Lax" }]);
const page = await ctx.newPage();
const errors = [];
page.on("response", (r) => r.status() >= 400 && errors.push(r.status() + " " + r.url().replace(ORIGIN, "").slice(0, 120)));
page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
const shot = async (name) => { await page.screenshot({ path: `${out}-${name}.png` }); console.log("saved", `${out}-${name}.png`); };
const t = (ms) => page.waitForTimeout(ms);

await page.goto(`${ORIGIN}/dashboard/box/${box}`, { waitUntil: "domcontentloaded" });
await t(6000);
await shot("1-thread");
const pane = page.locator('aside[aria-label="Browser"]');
if (!(await pane.count())) {
  // The address the agent wrote, as a person would click it.
  const link = page.locator('[data-thread] a[href*="localhost:"], [data-thread] :not(pre) > code:text-matches("^(https?://)?localhost:\\\\d+/?$")').last();
  console.log("localhost mentions:", await link.count());
  if (W < 768) { await page.getByRole("button", { name: "More actions" }).click(); await page.getByRole("menuitem", { name: /browser/i }).click(); }
  else if (await link.count()) { await link.scrollIntoViewIfNeeded(); await link.click(); }
  else await page.getByRole("button", { name: "Browser", exact: true }).click();
}
await pane.waitFor({ timeout: 15000 });
const t0 = Date.now();
await pane.locator(".browser-stage img").first().waitFor({ timeout: 40000 }).catch(() => console.log("no picture yet"));
console.log("first picture after", Date.now() - t0, "ms; address:", await page.getByLabel("Address").inputValue().catch(() => "?"));
await t(1500);
await shot("2-pane");

if (step !== "look") {
  const stage = page.locator(".browser-stage");
  const bb = await stage.boundingBox();
  await page.getByRole("button", { name: "Select an element" }).click();
  await t(2500);
  const hx = bb.x + Number(flag("hx", "200")), hy = bb.y + Number(flag("hy", "300"));
  await page.mouse.move(hx - 30, hy - 10); await t(150);
  await page.mouse.move(hx, hy); await t(400);
  await shot("3-hover");
  if (step === "send" || step === "pick") {
    await page.mouse.down(); await page.mouse.up();
    await t(2500);
    await shot("4-picked");
  }
  if (step === "send") {
    const input = page.locator("#send-input");
    await input.click();
    await input.pressSequentially(flag("msg", "Make this say Start my ritual."), { delay: 8 });
    await t(400);
    await shot("5-comment");
    await page.getByRole("button", { name: /Send to the agent|Queue for the agent/ }).click();
    await t(5000);
    await shot("6-sent");
    // Watch the agent work: the pane re-reads the page while it runs, and reloads when it ends.
    const start = Date.now();
    let n = 0;
    while (Date.now() - start < 420000) {
      await t(15000);
      const working = await page.getByText(/^Working/).first().isVisible().catch(() => false);
      if (++n % 2 === 0) await shot(`7-working-${n}`);
      if (!working && Date.now() - start > 30000) break;
    }
    console.log("turn took about", Math.round((Date.now() - start) / 1000), "s");
    await t(6000);
    await shot("8-after");
  }
}
console.log("page errors:", errors.length ? errors.slice(0, 6) : "none");
await browser.close();
