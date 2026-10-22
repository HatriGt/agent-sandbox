// Prose code refs on the box page: a finished reply whose plain text names files and lines, with
// every per-box endpoint mocked like .shots/thread-fixture.mjs. Asserts which phrases became
// [data-code-ref] links and that clicking them reveals the right lines in the workspace editor.
// Run from PowerShell (bash mangles the leading slashes):
//
//   node .shots/prose-refs.mjs [--dark]
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";

const dark = process.argv.includes("--dark");
const token = process.env.ASB_DEV_TOKEN || "devtoken123";
const base = process.env.ASB_UI || "http://localhost:5173";
const OUT = ".shots/prose-refs.png";

const NAME = "quiet-otter";
const REPO = "acme/orders-api";
const T0 = Date.now() - 14 * 60_000;
const at = (m, s = 0) => `⟦at⟧ ${T0 + m * 60_000 + s * 1000}`;
const TASK = "Explain where the rate limiter lives.";

const ANSWER = [
  "## Where the limiter lives",
  "",
  "The middleware is in src/middleware/rateLimit.ts:12 (the `next()` call). rateLimit.ts line 7 is the blank line before the export. The options interface is lines 3-5 of `orders-api/src/middleware/rateLimit.ts`, e.g. Node.js callers pass `{ limit }`.",
  "",
  "PR: https://github.com/acme/orders-api/pull/482",
];
const LOG = [at(0), "● session started (model ak-claude-opus-4.8)", at(0, 4), "Reading the limiter now.", at(0, 30), ...ANSWER, "⟦usage⟧ in=9132 out=1288 ctx=8820"].join("\n");

const box = { name: NAME, role: "session", boxStatus: "running", task: TASK, uptime: "14m", cpu: "2%", mem: "1.1G/4G", memUsage: { usedMib: 1130, totalMib: 4096 }, disk: { usedMib: 3800, totalMib: 20480 }, lastOutputAt: Date.now() - 4000, title: "Where the limiter lives", repos: [{ name: "orders-api", branch: "main" }], agent: "claude", runState: "done", exitCode: 0 };
const { role: _r, ...meta } = box;
const LIFECYCLE = { idleTimeoutSec: 1800, maxDurationSec: 4 * 3600, capacity: 8, poolSize: 2, sleepTtlSec: 7 * 86400, memoryTiers: ["2G", "4G", "8G"], memoryDefault: "4G", diskTiers: ["20G", "40G"] };
const CHANGES = [{ path: "orders-api/src/middleware/rateLimit.ts", repo: "orders-api", status: "modified", additions: 34, deletions: 11 }];
const TREE = ["orders-api/src/app.ts", "orders-api/src/middleware/rateLimit.ts", "orders-api/src/lib/redis.ts", "orders-api/test/rateLimit.test.ts", "orders-api/test/orders.test.ts", "orders-api/docs/rate-limits.md", "orders-api/package.json", "orders-api/README.md"];
const FILE_LINES = [
  "const BUCKETS = 6;",
  "",
  "interface Options {",
  "  limit: number;",
  "  window?: number;",
  "}",
  "",
  "export function rateLimit({ limit, window = 60_000 }: Options) {",
  "  const slice = window / BUCKETS;",
  "  return async (req, res, next) => {",
  "    next();",
  "  };",
  "}",
  ...Array.from({ length: 60 }, (_, i) => `// padding line ${i + 14}`),
];
const FILE = FILE_LINES.join("\n") + "\n";
const frame = (event, data, id) => `event: ${event}\n${id !== undefined ? `id: ${id}\n` : ""}data: ${JSON.stringify(data)}\n\n`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: dark ? "dark" : "light", deviceScaleFactor: 1 });
await ctx.addInitScript(
  ([t, d]) => {
    localStorage.setItem("asb-token", t);
    localStorage.setItem("asb-dark", d ? "1" : "0");
  },
  [token, dark]
);
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
page.on("response", (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));

const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
await page.route("**/*", async (route) => {
  const u = new URL(route.request().url());
  switch (u.pathname) {
    case "/fleet.json":
      return json(route, { boxes: [box], lifecycle: LIFECYCLE, at: Date.now() });
    case "/monitor.json":
      return json(route, { boxes: [box] });
    case "/watch.json":
      return json(route, { ...meta, log: LOG });
    case "/watch.sse":
      return route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache" }, body: "retry: 3000\n\n" + frame("snapshot", { meta, log: LOG, from: 0 }, LOG.length) + frame("done", { meta }) });
    case "/changes.json":
      return json(route, { files: CHANGES });
    case "/digest.json":
      return json(route, { box: NAME, task: TASK, state: "done", exitCode: 0, startedAt: T0, endedAt: T0 + 92_000, plan: [], files: CHANGES, failedCommands: [], questions: [], usage: { inputTokens: 9132, outputTokens: 1288, contextTokens: 8820 }, headline: "Explained." });
    case "/pr.json":
      return json(route, { error: "no pr" }, 404);
    case "/inbox.json":
      return json(route, { queued: [] });
    case "/repos.json":
      return json(route, { repos: [{ fullName: REPO, private: true, defaultBranch: "main", logins: ["acme"] }], total: 1 });
    case "/secrets.json":
      return json(route, { secrets: [] });
    case "/revert-points.json":
      return json(route, { messages: [] });
    case "/models.json":
      return json(route, { default: "ak-claude-opus-4.8", current: "ak-claude-opus-4.8", models: [{ id: "ak-claude-opus-4.8", label: "Opus 4.8", tier: "opus" }] });
    case "/skills.json":
      return json(route, { skills: [] });
    case "/tree.json":
      return json(route, { files: TREE, total: TREE.length, truncated: false });
    case "/files.json":
      return json(route, { files: TREE.filter((f) => f.includes(u.searchParams.get("q") ?? "")), total: TREE.length, truncated: false });
    case "/git.json":
      return json(route, { repo: "orders-api", branch: "main", upstream: "origin/main", ahead: 0, behind: 0, lastCommit: "init", clean: false, changed: 1 });
    case "/artifact":
      return route.fulfill({ status: 200, contentType: "text/plain", body: FILE });
    case "/diff.json":
      return json(route, { path: u.searchParams.get("path") ?? CHANGES[0].path, untracked: false, binary: false, original: FILE, diff: "" });
    case "/rundiff.json":
      return json(route, { diff: "" });
    case "/file.json":
      return json(route, { path: u.searchParams.get("path"), content: FILE, bytes: FILE.length, mtime: Date.now() });
    case "/memory.json":
    case "/resume.json":
    case "/title.json":
    case "/wake.json":
      return json(route, { ok: true });
    default:
      return route.continue();
  }
});

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  [${detail}]` : ""}`);
};
const editorState = () =>
  page.evaluate(() => {
    const gutter = document.querySelector(".cm-lineNumbers .cm-activeLineGutter")?.textContent?.trim() ?? null;
    const active = document.querySelector(".cm-activeLine")?.textContent ?? null;
    const reveal = [...document.querySelectorAll(".cm-reveal-line")].map((el) => el.textContent);
    const scrollTop = document.querySelector(".cm-scroller")?.scrollTop ?? null;
    const selected = document.querySelectorAll(".cm-selectionBackground").length;
    return { gutter, active, reveal, scrollTop, selected };
  });

await page.goto(`${base}/dashboard/box/${NAME}`, { waitUntil: "load", timeout: 30000 }).catch((e) => errors.push("goto: " + e.message));
await page
  .locator("[aria-label='Conversation'] [data-code-ref]")
  .first()
  .waitFor({ state: "visible", timeout: 8000 })
  .catch(() => {});
await page.waitForTimeout(600);

const refs = await page.$$eval("[aria-label='Conversation'] [data-code-ref]", (els) => els.map((el) => ({ text: el.textContent, ref: el.getAttribute("data-code-ref"), inReply: !!el.closest("p") })));
console.log("rendered refs:", JSON.stringify(refs));
const byText = (t) => refs.find((r) => r.text === t);
check("token src/middleware/rateLimit.ts:12 links, resolved to the tree path", byText("src/middleware/rateLimit.ts:12")?.ref === "orders-api/src/middleware/rateLimit.ts:12", byText("src/middleware/rateLimit.ts:12")?.ref);
check("basename phrase rateLimit.ts line 7 links (unique in TREE)", byText("rateLimit.ts line 7")?.ref === "orders-api/src/middleware/rateLimit.ts:7", byText("rateLimit.ts line 7")?.ref);
check("inline code after lines 3-5 of carries the range", byText("orders-api/src/middleware/rateLimit.ts")?.ref === "orders-api/src/middleware/rateLimit.ts:3-5", byText("orders-api/src/middleware/rateLimit.ts")?.ref);
check("exactly three refs in the reply", refs.filter((r) => r.inReply).length === 3, String(refs.filter((r) => r.inReply).length));
check("e.g. / Node.js not linked", !refs.some((r) => /e\.g|Node\.js/.test(r.text ?? "")));
check("URL not a code ref", !refs.some((r) => /github|https/.test(r.text ?? "")));
check("URL rendered as an external link", (await page.locator("[aria-label='Conversation'] a[href='https://github.com/acme/orders-api/pull/482']").count()) === 1);

const refLink = (text) => page.locator("[aria-label='Conversation'] [data-code-ref]", { hasText: text }).first();

await refLink("src/middleware/rateLimit.ts:12").click();
await page
  .locator(".cm-editor")
  .waitFor({ state: "visible", timeout: 8000 })
  .catch((e) => errors.push("editor: " + e.message));
await page.waitForTimeout(900);
let s = await editorState();
console.log("after click 1:", JSON.stringify(s));
check("workspace opened the file in the editor", s.gutter !== null);
check("active line is 12", s.gutter === "12" && s.active?.trim() === "};", `${s.gutter} ${JSON.stringify(s.active)}`);
check("line 12 flashed", s.reveal.length === 1 && s.reveal[0].trim() === "};", JSON.stringify(s.reveal));
const scrollAt12 = s.scrollTop;

await page.evaluate(() => {
  const el = document.querySelector(".cm-scroller");
  if (el) el.scrollTop = el.scrollHeight;
});
await page.waitForTimeout(200);
await page.locator(".cm-line").last().click();
await page.waitForTimeout(2300);
s = await editorState();
console.log("after scrolling away:", JSON.stringify(s));
check("cursor moved off line 12 and the flash cleared", s.gutter !== "12" && s.reveal.length === 0, `${s.gutter} reveal=${s.reveal.length}`);
await refLink("src/middleware/rateLimit.ts:12").click();
await page.waitForTimeout(700);
s = await editorState();
console.log("after click 2:", JSON.stringify(s));
check("second click re-reveals line 12", s.gutter === "12" && s.reveal.length === 1, `${s.gutter} reveal=${s.reveal.length}`);
check("editor scrolled back to line 12", s.scrollTop === scrollAt12, `${s.scrollTop} vs ${scrollAt12}`);

await refLink("orders-api/src/middleware/rateLimit.ts").click();
await page.waitForTimeout(700);
s = await editorState();
console.log("after range click:", JSON.stringify(s));
check("lines 3-5 flashed", s.reveal.map((t) => t.trim()).join("|") === "interface Options {|limit: number;|window?: number;", JSON.stringify(s.reveal));
check("selection spans lines 3-5 (head on 5)", s.gutter === "5" && s.selected > 0, `${s.gutter} selected=${s.selected}`);

await page.screenshot({ path: OUT });
console.log("saved", OUT);
if (errors.length) console.log("console errors:\n" + errors.slice(0, 12).join("\n"));
console.log(failed ? `${failed} FAILED` : "all passed");
await browser.close();
process.exit(failed ? 1 : 0);
