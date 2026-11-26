// The Memory › Repo setup view over the built console and test/ui-mock-server.mjs, with the notes
// and the setup profiles mocked: three ATOM services with different command sets (one with a long
// build line, one without lint, one without runtimes) and one auto-detected, one agent-confirmed,
// one edited by hand.
//
//   node .shots/memory-setup.mjs [--dark] [--w=1760] [--port=8799]
//
// Shots: the view (full), a hovered row, a search, the editor sheet, a phone width. Prints the rail,
// the header row and one line per row, plus the column widths.
import { spawn } from "node:child_process";
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";

const args = process.argv.slice(2);
const dark = args.includes("--dark");
const W = Number(args.find((a) => a.startsWith("--w="))?.slice(4) ?? 1760);
const port = Number(args.find((a) => a.startsWith("--port="))?.slice(7) ?? 8799);
const suffix = dark ? "dark" : "light";
const out = (name) => `.shots/memory-setup-${name}${W === 1760 ? "" : `-${W}`}-${suffix}.png`;

const now = Date.now();
const H = 3_600_000;
const D = 24 * H;
const profiles = [
  {
    repo: "atom-insurance/atom-capacity-service",
    updatedAt: now - 2 * D,
    profile: { v: 1, install: "npm install", build: "npm run build", test: "npm run test", runtimes: { node: "^22" }, envVars: ["NPM_AUTH_TOKEN"], notes: "Detected from package.json, .github/workflows/build-check.yml, .github/workflows/cds-capm-test.yaml.", detectedAt: now - 2 * D, confirmedBy: "detected" },
  },
  {
    repo: "atom-insurance/atom-claimmgmt-service",
    updatedAt: now - 5 * H,
    profile: { v: 1, install: "npm install", build: "npm run build", test: "npm run test", lint: "npm run lint", runtimes: {}, envVars: ["NPM_AUTH_TOKEN"], notes: "Detected from package.json, .github/workflows/code-quality.yml.", detectedAt: now - 3 * D, confirmedBy: "agent" },
  },
  {
    repo: "atom-insurance/atom-deal-service",
    updatedAt: now - 40 * 60_000,
    profile: { v: 1, install: "npm install", build: 'npm run build --if-present && echo "✅ Completed"', test: "npm run test", lint: "npm run lint", runtimes: { node: "^18" }, envVars: ["NPM_AUTH_TOKEN", "CDSRC_PRIVATE_DEV"], notes: "Detected from package.json and eleven workflow files.", detectedAt: now - 6 * D, confirmedBy: "user" },
  },
];
const notes = [
  { id: "p1", kind: "preference", scope: "operator", status: "kept", text: "Keep replies short; no card layouts, lists with dividers instead", at: now - D, source: "pool-0", pinned: true },
  { id: "f2", kind: "fact", scope: "repo", status: "kept", repo: "atom-insurance/atom-deal-service", area: "deals/promotion", text: "Promotion goes dev → qa → preprod; the release-source guard refuses a PR from any other branch", at: now - 3600e3, source: "pool-1" },
  { id: "l2", kind: "lesson", scope: "repo", status: "kept", repo: "atom-insurance/atom-deal-service", area: "deals/promotion", text: "cds-capm-test needs CDSRC_PRIVATE_DEV set or every test is skipped as passed", why: "a green run with zero assertions", at: now - 5 * 3600e3, source: "pool-2" },
];

const server = spawn(process.execPath, ["test/ui-mock-server.mjs", String(port)], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise((r) => server.stdout.once("data", r));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: 1800 }, colorScheme: dark ? "dark" : "light", deviceScaleFactor: 2, locale: "en-GB" });
await ctx.addInitScript((d) => {
  localStorage.setItem("asb-token", "devtoken123");
  localStorage.setItem("asb-dark", d ? "1" : "0");
  localStorage.setItem("asb-hub-howto-done", "1");
}, dark);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
let current = profiles;
await page.route("**/memory-notes.json*", (r) => r.fulfill({ json: { enabled: true, notes, episodes: [], receipts: [] } }));
await page.route("**/repo-setup.json*", async (r) => {
  if (r.request().method() === "POST") {
    const b = r.request().postDataJSON();
    current = current.map((p) => (p.repo === b.repo ? { ...p, updatedAt: Date.now(), profile: { ...p.profile, ...b.profile, confirmedBy: "user" } } : p));
  }
  await r.fulfill({ json: { profiles: current } });
});
await page.route("**/repo-setup/delete.json*", async (r) => {
  const b = r.request().postDataJSON();
  current = current.filter((p) => p.repo !== b.repo);
  await r.fulfill({ json: { profiles: current } });
});
await page.route("**/titles.json*", (r) => r.fulfill({ json: { titles: {} } }));

await page.goto(`http://localhost:${port}/dashboard/memory`, { waitUntil: "load" });
await page.waitForSelector("nav[aria-label='Memory sections']", { timeout: 20000 });
await page.getByRole("button", { name: /^Repo setup/ }).click();
const T = "[aria-label='Repo setup']";
await page.waitForSelector(`${T} tbody tr`, { timeout: 20000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: out("page"), fullPage: true });

const readTable = () =>
  page.evaluate((T) => {
    const t = document.querySelector(T);
    const head = [...t.querySelectorAll("thead th")].map((th) => th.innerText.replace(/\s+/g, " ").trim());
    const rows = [...t.querySelectorAll("tbody tr")].map((tr) => [...tr.children].map((td) => td.innerText.replace(/\s+/g, " ").trim().slice(0, 50)).join(" | "));
    const rail = [...document.querySelectorAll("nav[aria-label='Memory sections'] > ul > li > button")].map((b) => `${b.innerText.replace(/\s+/g, " ").trim()}${b.getAttribute("aria-current") ? "*" : ""}`);
    const title = document.getElementById("memory-setup-h")?.closest("section")?.querySelector("h2, h3")?.innerText.replace(/\s+/g, " ").trim();
    return { rail, title, head, rows };
  }, T);
console.log(JSON.stringify(await readTable(), null, 1));

const dealRow = page.locator(`${T} tbody tr`, { hasText: "atom-deal-service" });
await dealRow.hover();
await page.waitForTimeout(400);
await dealRow.screenshot({ path: out("row-hover") });
console.log("widths:", JSON.stringify(await page.evaluate((T) => {
  const t = document.querySelector(T);
  const cols = [...t.querySelectorAll("col")].map((c) => `${c.dataset.col}:${c.style.width || c.className}`);
  const tr = [...t.querySelectorAll("tbody tr")].find((r) => r.innerText.includes("atom-deal-service"));
  const cells = [...tr.children].map((td) => `${td.clientWidth}/${td.scrollWidth}`);
  return { table: t.clientWidth, wrap: t.parentElement.clientWidth, scroll: t.parentElement.scrollWidth, cols, cells };
}, T)));
console.log("hover row buttons:", JSON.stringify(await dealRow.locator("button").evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label")))));

// The page search narrows the rows (and the rail count).
await page.getByRole("searchbox", { name: "Search notes" }).fill("lint");
await page.waitForTimeout(500);
console.log("search 'lint' →", JSON.stringify({ ...(await readTable()), head: undefined }));
await page.screenshot({ path: out("search"), fullPage: false });
await page.getByRole("searchbox", { name: "Search notes" }).fill("");
await page.waitForTimeout(400);

// The editor sheet from the row.
await dealRow.click();
await page.waitForSelector("[role=dialog]", { timeout: 10000 });
await page.waitForTimeout(900);
await page.locator("[role=dialog]").screenshot({ path: out("sheet") });
console.log("sheet:", JSON.stringify(await page.evaluate(() => ({
  title: document.querySelector("[role=dialog] h2")?.innerText,
  fields: [...document.querySelectorAll("[role=dialog] label")].map((l) => `${l.querySelector("span")?.innerText}=${l.querySelector("input")?.value ?? ""}`),
}))));
await page.locator("[role=dialog] input").nth(3).fill("npm run lint -- --max-warnings 0");
await page.getByRole("button", { name: "Save" }).click();
await page.waitForTimeout(800);
console.log("fonts:", await page.evaluate(() => document.fonts.status));
console.log("after save →", JSON.stringify((await readTable()).rows.filter((r) => r.includes("deal"))));

// Phone.
await page.setViewportSize({ width: 420, height: 900 });
await page.waitForTimeout(2500);
await page.locator(T).scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await page.screenshot({ path: out("phone") });
console.log("phone:", JSON.stringify((await readTable()).head));

console.log(JSON.stringify({ errors: errors.slice(0, 5) }));
await browser.close();
server.kill();
