// Long-reply scroll check: the thread opens on a short reply, then a huge reply arrives.
// The view must stop at the reply's first line, not jump to its end. ASB_UI defaults to :5181.
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";
const base = process.env.ASB_UI || "http://localhost:5181";
const BOX = "asb-scroll-test", TASK = "Explain the codebase";
const meta = { name: BOX, boxStatus: "running", runState: "running", task: TASK, role: "cold" };
const lifecycle = { capacity: 4, maxDurationSec: 3600, idleTimeoutSec: 900 };
const short = "Looking at the repository layout first.\n\n";
const huge = short + "Here is the full walkthrough.\n\n" + Array.from({ length: 160 }, (_, i) => `Paragraph ${i + 1}: the controller routes requests through the handler table and records state.`).join("\n\n") + "\n";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } });
await ctx.addInitScript(() => { localStorage.setItem("asb-token", "devtoken123"); localStorage.setItem("asb-hub-howto-done", "1"); });
const page = await ctx.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
await page.route("**/fleet.json*", (r) => r.fulfill({ json: { boxes: [meta], lifecycle } }));
await page.route("**/monitor.json*", (r) => r.fulfill({ json: { boxes: [meta], lifecycle } }));
let hits = 0;
await page.route("**/watch.sse*", async (r) => {
  hits++;
  if (hits > 1) await new Promise((res) => setTimeout(res, 2500));
  const log = hits === 1 ? short : huge;
  r.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: `event: snapshot\nid: ${log.length}\ndata: ${JSON.stringify({ meta, log, from: 0 })}\n\n` });
});
await page.route("**/watch.json*", (r) => r.fulfill({ json: { ...meta, log: short } }));
await page.goto(`${base}/dashboard/box/${BOX}`, { waitUntil: "load" });
const sample = () => page.evaluate(() => {
  const all = [...document.querySelectorAll("main [data-say]")];
  const say = all[all.length - 1];
  let sc = say; while (sc && !(sc.scrollHeight > sc.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
  return { says: all.length, text: say?.innerText.slice(0, 30), sayTop: say ? Math.round(say.getBoundingClientRect().top) : null, scrollTop: sc ? Math.round(sc.scrollTop) : null, max: sc ? sc.scrollHeight - sc.clientHeight : null, long: /Paragraph 160/.test(document.body.innerText) };
});
for (let i = 0; i < 70; i++) { const s = await sample(); console.log(i * 100, JSON.stringify(s)); await page.waitForTimeout(100); }
await page.screenshot({ path: ".shots/out/scroll-hold.png" });
// Scrolling to the bottom by hand must work and stay.
await page.mouse.move(700, 400); for (let i = 0; i < 40; i++) await page.mouse.wheel(0, 800);
await page.waitForTimeout(800);
console.log("after wheel", JSON.stringify(await sample()));
console.log("errors:", errors.slice(0, 3).join(" | ") || "none");
await browser.close();
