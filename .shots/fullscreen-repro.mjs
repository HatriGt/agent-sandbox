// Repro for "fullscreen viz closes and the page jumps while the agent streams".
// Streams new say/tool groups after a rich table in an earlier message, opens that table's
// fullscreen, then samples the dialog's presence and the scroller position every 400ms.
//   node .shots/fullscreen-repro.mjs [--w=1440 --h=900] [--shots]
import http from "node:http";
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";

const flags = process.argv.slice(2);
const flag = (k, d) => flags.find((f) => f.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const W = Number(flag("w", 1440));
const H = Number(flag("h", 900));
const shots = flags.includes("--shots");
const base = process.env.ASB_UI || "http://localhost:5173";
const NAME = "quiet-otter";
const T0 = Date.now() - 5 * 60_000;
const at = (s) => `⟦at⟧ ${T0 + s * 1000}`;

const TABLE = [
  "| Scenario | Before | After |",
  "| --- | --- | --- |",
  "| 100 req burst at :59 then 100 at :00 | 200 allowed | 100 allowed, 100 rejected |",
  "| Steady 90 req/min | allowed | allowed |",
  "| Redis unavailable | 500 | fails open, logs once |",
].join("\n");
const CHART = [
  "```chart",
  "{",
  '  "type": "bar",',
  '  "title": "Requests by route",',
  '  "data": [',
  '    { "label": "/api/users", "value": 120 },',
  '    { "label": "/api/orders", "value": 80 },',
  '    { "label": "/api/items", "value": 45 },',
  '    { "label": "/api/carts", "value": 32 },',
  '    { "label": "/api/search", "value": 28 },',
  '    { "label": "/api/auth", "value": 19 },',
  '    { "label": "/api/health", "value": 11 }',
  "  ]",
  "}",
  "```",
].join("\n");
const useChart = flags.includes("--chart");
const liveLast = flags.includes("--live");
const COMPONENT = useChart ? CHART : TABLE;
const intro = useChart ? "Here is the breakdown of requests by route over the last hour." : "Here is how the limiter behaves before and after the change.";

const head = (liveLast
  ? [
      at(0), "● session started (model ak-claude-opus-4.8)",
      at(2), "Checking the Retry-After header first.",
      at(5), "→ Bash: npx vitest run ⟦#b1⟧", at(7), "  ⟦#b1⟧ Tests 25 passed (25)",
      at(9), intro, "", COMPONENT,
    ]
  : [
      at(0), "● session started (model ak-claude-opus-4.8)",
      at(2), intro, "", COMPONENT, "",
      at(5), "→ Bash: npx vitest run ⟦#b1⟧", at(7), "  ⟦#b1⟧ Tests 25 passed (25)",
      at(9), "Now the second pass. Checking the Retry-After header next.",
    ]).join("\n") + "\n";

const tail = [];
for (let i = 0; i < 6; i++) {
  tail.push(at(12 + i * 3), `→ Read: src/file${i}.ts ⟦#r${i}⟧`, at(13 + i * 3), `  ⟦#r${i}⟧ 1\tconst x${i} = ${i};`);
  tail.push(at(14 + i * 3), `Pass ${i + 1} done. The header is set on the ${i}th branch and the next branch follows the same shape, so the test for it lands in the same file as the others.`);
}
const tailText = tail.join("\n") + "\n";

const box = { name: NAME, role: "session", boxStatus: "running", task: "Replace the limiter", runState: "running", uptime: "5m", cpu: "10%", mem: "1G/4G", memUsage: { usedMib: 1000, totalMib: 4096 }, disk: { usedMib: 3000, totalMib: 20480 }, lastOutputAt: Date.now(), title: "Limiter", repos: [{ name: "orders-api", branch: "main" }], agent: "claude" };
const { role: _r, ...meta } = box;
const frame = (event, data, id) => `event: ${event}\n${id !== undefined ? `id: ${id}\n` : ""}data: ${JSON.stringify(data)}\n\n`;

const streamer = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", "access-control-allow-origin": "*" });
  res.write("retry: 3000\n\n");
  res.write(frame("snapshot", { meta, log: head, from: 0 }, head.length));
  let i = 0;
  let sent = head.length;
  const tick = () => {
    if (i >= tailText.length) return;
    const n = 8 + Math.floor(Math.random() * 16);
    const chunk = tailText.slice(i, i + n);
    i += n;
    sent += chunk.length;
    res.write(frame("append", { chunk }, sent));
    setTimeout(tick, 40 + Math.random() * 50);
  };
  if (flags.includes("--reset")) {
    // The server's log window slid: the first lines fell off, so the whole buffer is re-sent.
    const slid = head.split("\n").slice(2).join("\n");
    setTimeout(() => { res.write(frame("reset", { chunk: slid }, slid.length)); setTimeout(tick, 600); }, 2500);
  } else setTimeout(tick, 2500);
});
await new Promise((r) => streamer.listen(0, "127.0.0.1", r));
const port = streamer.address().port;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await ctx.addInitScript(() => { localStorage.setItem("asb-token", "devtoken123"); localStorage.setItem("asb-dark", "0"); });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const json = (route, body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
await page.route("**/*", async (route) => {
  const u = new URL(route.request().url());
  switch (u.pathname) {
    case "/fleet.json": return json(route, { boxes: [box], lifecycle: { idleTimeoutSec: 1800, maxDurationSec: 14400, capacity: 8, poolSize: 2, sleepTtlSec: 604800, memoryTiers: ["4G"], memoryDefault: "4G", diskTiers: ["20G"] }, at: Date.now() });
    case "/monitor.json": return json(route, { boxes: [box] });
    case "/watch.json": return json(route, { ...meta, log: head });
    case "/watch.sse": return route.continue({ url: `http://127.0.0.1:${port}/watch.sse` });
    case "/changes.json": return json(route, { files: [] });
    case "/pr.json": return json(route, null);
    case "/inbox.json": return json(route, { queued: [] });
    case "/repos.json": return json(route, { repos: [], total: 0 });
    case "/secrets.json": return json(route, { secrets: [] });
    case "/revert-points.json": return json(route, { messages: [] });
    case "/models.json": return json(route, { default: "m", current: "m", models: [{ id: "m", label: "M", tier: "opus" }] });
    case "/skills.json": return json(route, { skills: [] });
    case "/tree.json": case "/files.json": return json(route, { files: ["orders-api/src/app.ts"], total: 1, truncated: false });
    case "/git.json": return json(route, { repo: "orders-api", branch: "main", ahead: 0, behind: 0, clean: true, changed: 0 });
    default: return route.continue();
  }
});

await page.goto(`${base}/dashboard/box/${NAME}`, { waitUntil: "load", timeout: 30000 });
await page.waitForTimeout(1200);
const scroller = "[aria-label='Conversation'] > div";
const pos = () => page.evaluate((s) => { const el = document.querySelector(s); return el ? { top: Math.round(el.scrollTop), max: Math.round(el.scrollHeight - el.clientHeight) } : null; }, scroller);
const state = () => page.evaluate(() => ({ dialog: !!document.querySelector("[data-viz-fullscreen]"), says: document.querySelectorAll("[data-say]").length, frames: document.querySelectorAll("[data-viz-maximize]").length, dumps: [...document.querySelectorAll("button[aria-expanded] span")].filter((e) => e.textContent === "Raw output").length }));

const max = page.locator("[data-viz-maximize]").first();
await max.waitFor({ timeout: 10000 });
await max.hover();
await max.click();
await page.waitForTimeout(300);
console.log("after open:", JSON.stringify({ ...(await state()), pos: await pos() }));
if (shots) await page.screenshot({ path: ".shots/fs-open.png" });
const t0 = Date.now();
let closedAt = null;
for (let k = 0; k < 22; k++) {
  await page.waitForTimeout(400);
  const s = await state();
  const p = await pos();
  console.log(`t+${((Date.now() - t0) / 1000).toFixed(1)}s`, JSON.stringify({ ...s, pos: p }));
  if (!s.dialog && closedAt === null) { closedAt = Date.now() - t0; if (shots) await page.screenshot({ path: ".shots/fs-closed.png" }); }
}
console.log(closedAt === null ? "RESULT: dialog stayed open" : `RESULT: dialog closed after ${closedAt}ms`);
if (errors.length) console.log("page errors:", errors);
await browser.close();
streamer.close();
