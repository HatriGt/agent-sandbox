// The Autopilot › Automations page over the built console and test/ui-mock-server.mjs, with the
// automation list mocked: one-time tasks (waiting on you, coming up, finished — with and without the
// agent's title/does/gives fields) and standing rules (watch, cron, webhook, paused).
//
//   node .shots/autopilot-page.mjs [--dark] [--w=1760] [--port=8798]
//
// Shots: the page (full), a hovered row, the One-time chip, a search, the editor sheet on a
// one-time task (the title/does/gives fields), a phone width. Prints the filter bar, the header
// row and one line per row.
import { spawn } from "node:child_process";
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";
// The structured columns come from the controller (`brief` on every row): the built module does here what viewTrigger does live.
import { briefOf } from "../dist/trigger-facts.js";

const args = process.argv.slice(2);
const dark = args.includes("--dark");
const W = Number(args.find((a) => a.startsWith("--w="))?.slice(4) ?? 1760);
const port = Number(args.find((a) => a.startsWith("--port="))?.slice(7) ?? 8798);
const suffix = dark ? "dark" : "light";
const out = (name) => `.shots/autopilot-${name}${W === 1760 ? "" : `-${W}`}-${suffix}.png`;

const now = Date.now();
const H = 3_600_000;
const D = 24 * H;
const base = (o) => ({
  owner: "me",
  kind: "schedule",
  concurrency: 1,
  prComment: false,
  enabled: true,
  quiet: false,
  proposed: false,
  spec: { cron: "0 9 * * *", timezone: "America/Los_Angeles" },
  lastFired: null,
  nextFire: null,
  lastResult: null,
  hasPayload: false,
  hasSigningSecret: false,
  createdAt: now - 3 * D,
  updatedAt: now - D,
  active: 0,
  scope: "automation",
  status: "waiting",
  when: "Every day 09:00 (America/Los_Angeles)",
  ...o,
});
const chat = "pool-1791864841224-omp-qyt2hi";
const triggers = [
  // One-time, the new form: title / does / repo / gives plus the agent's own column values (target / into), waiting for its moment.
  base({
    id: "t-once-wait",
    name: "Force-merge 3 production PRs",
    summary: "Merges #2910, #2911 and #2912 with admin override once their checks are green",
    outcome: "Three merged PRs",
    facts: { target: "PRs #2910–#2912", into: "main" },
    taskTemplate: "Merge PRs #2910, #2911 and #2912 in atom-insurance/elseco-deal-service with `gh pr merge --admin` once CI is green on each; report what merged and what did not.",
    repos: ["atom-insurance/elseco-deal-service"],
    spec: { at: now + 2 * H + 10 * 60_000 },
    nextFire: now + 2 * H + 10 * 60_000,
    scope: "scheduled",
    sourceBox: chat,
    sourceTitle: "Release the deal service hotfix",
    when: `once, ${new Date(now + 2 * H).toISOString().slice(0, 16).replace("T", " ")} UTC`,
    quiet: false,
  }),
  // One-time, critical → proposed, waiting on you.
  base({
    id: "t-once-ask",
    name: "Roll back the deal service",
    summary: "Redeploys the previous MTA archive to the QA space if the smoke check still fails",
    outcome: "A rollback, or a reply that it was not needed",
    taskTemplate: "If the smoke check on elseco-deal-service in QA still fails at 18:00, redeploy the previous MTA archive and report.",
    repos: ["atom-insurance/elseco-deal-service"],
    spec: { at: now + 5 * H },
    enabled: false,
    proposed: true,
    scope: "scheduled",
    status: "needs-ok",
    sourceBox: chat,
    sourceTitle: "Release the deal service hotfix",
    when: `once, ${new Date(now + 5 * H).toISOString().slice(0, 16).replace("T", " ")} UTC`,
  }),
  // One-time, done, with a headline.
  base({
    id: "t-once-done",
    name: "Force merge PR #2910",
    summary: "Merges #2910 with admin override after the checks pass",
    outcome: "One merged PR",
    taskTemplate: "Force merge PR #2910 in atom-insurance/elseco-deal-service once checks are green.",
    repos: ["atom-insurance/elseco-deal-service"],
    spec: { at: now - 2 * D },
    lastFired: now - 2 * D,
    lastResult: { at: now - 2 * D, outcome: "started", box: "pool-1791900000000-omp-abc123", finished: { state: "done", headline: "Merged #2910 after a rebase; CI green on main", archiveId: 41 } },
    scope: "scheduled",
    status: "done",
    sourceBox: chat,
    sourceTitle: "Release the deal service hotfix",
    when: `once, ${new Date(now - 2 * D).toISOString().slice(0, 16).replace("T", " ")} UTC`,
  }),
  // One-time, the OLD form (no agent fields): the name is the task's first sentence, time and all.
  base({
    id: "t-once-old",
    name: "Report the current UTC time again by running `date -u`",
    taskTemplate: "Report the current UTC time again by running `date -u`. Reply in this chat with the output.",
    spec: { at: now - 9 * D },
    lastFired: now - 9 * D,
    lastResult: { at: now - 9 * D, outcome: "started", box: "pool-1791800000000-omp-zzz", finished: { state: "failed", headline: "The box was destroyed before the run finished" } },
    scope: "scheduled",
    status: "failed",
    sourceBox: "pool-1791800000000-omp-zzz",
    when: `once, ${new Date(now - 9 * D).toISOString().slice(0, 16).replace("T", " ")} UTC`,
  }),
  // Standing rules.
  base({
    id: "t-watch",
    kind: "watch",
    name: "Deal Reviewer",
    summary: "Reads every new PR's diff and posts one review comment with concrete findings",
    outcome: "A review comment on the PR",
    taskTemplate: 'Review PR #{{pr.number}} "{{pr.title}}" ({{pr.html_url}}). Read the diff and post one review comment on the PR with concrete findings.',
    repos: ["atom-insurance/elseco-deal-service", "atom-insurance/elseco-claims-service", "atom-insurance/atom-mdm"],
    spec: { watch: ["pr_opened", "pr_pushed"] },
    when: "PR opened, PR pushed to on atom-insurance/elseco-deal-service +2 more",
    prComment: true,
    lastFired: now - 3 * H,
    lastResult: { at: now - 3 * H, outcome: "started", box: "pool-1791950000000-omp-rev001", finished: { state: "done", headline: "2 findings on #2931: a missing null check, a test gap", archiveId: 52 } },
    lastDelivery: { id: 9, at: now - 3 * H, outcome: "fired", box: "pool-1791950000000-omp-rev001" },
  }),
  base({
    id: "t-ci",
    name: "Failing CI on main",
    summary: "Every 30 minutes, looks for failed runs on main and fixes or explains them",
    taskTemplate: "Check CI on the default branch: run `gh run list --branch main --status failure --limit 5` …",
    repos: ["HatriGt/agent-sandbox"],
    spec: { cron: "*/30 * * * *", timezone: "UTC" },
    when: "Every 30 min UTC",
    quiet: true,
    counts: { checked: 12, reports: 1 },
    lastFired: now - 25 * 60_000,
    nextFire: now + 5 * 60_000,
    lastResult: { at: now - 25 * 60_000, outcome: "started", box: "pool-1791960000000-omp-ci0001", finished: { state: "done", headline: "Nothing failed on main", archiveId: 60 } },
  }),
  base({
    id: "t-deps",
    name: "Weekly dependency refresh",
    summary: "Upgrades outdated dependencies, keeps what passes the tests, opens one PR",
    outcome: "A PR",
    taskTemplate: "Update outdated dependencies to their latest compatible versions …",
    repos: ["HatriGt/agent-sandbox"],
    spec: { cron: "0 9 * * 1", timezone: "Asia/Dubai" },
    when: "Mondays 09:00 (Asia/Dubai)",
    enabled: false,
    status: "paused",
    nextFire: null,
    lastFired: now - 6 * D,
    lastResult: { at: now - 6 * D, outcome: "started", box: "pool-1791500000000-omp-dep001", finished: { state: "done", headline: "Upgraded 7 packages, skipped vite 8 (tests failed)", archiveId: 33 } },
  }),
  base({
    id: "t-chat-rule",
    name: "Morning CI summary",
    summary: "Summarises the night's CI runs across the ATOM repos and posts the digest",
    outcome: "A digest in this chat",
    taskTemplate: "Every morning summarise CI across the atom-insurance repos …",
    spec: { cron: "0 5 * * 1-5", timezone: "UTC" },
    when: "Weekdays 05:00 UTC",
    nextFire: now + 14 * H,
    scope: "scheduled",
    sourceBox: chat,
    sourceTitle: "Release the deal service hotfix",
    quiet: true,
    counts: { checked: 4, reports: 2 },
  }),
  // One-time, the OLD form with a long first-sentence name, as the live row of 2026-11-24 read.
  base({
    id: "t-once-old-long",
    name: "Force-merge 3 production PRs at 12:45 PM Dubai time; the user explicitly authori",
    taskTemplate:
      "Force-merge 3 production PRs at 12:45 PM Dubai time; the user explicitly authorized this and said not to ask again. Run each with `gh pr merge <n> -R <repo> --admin` plus the merge method the repo allows (prefer merge commit, keep the branch): atom-insurance/atom-ui-spacerdb#282, atom-insurance/elseco-riskdb-services#164, atom-insurance/elseco-deal-service#2889.",
    spec: { at: now - 3 * D },
    lastFired: now - 3 * D,
    lastResult: { at: now - 3 * D, outcome: "started", box: "pool-1791700000000-omp-fm3", finished: { state: "done", headline: "done · 4 steps", archiveId: 456 } },
    scope: "scheduled",
    status: "done",
    sourceBox: "pool-1791700000000-omp-src3",
    when: `once, ${new Date(now - 3 * D).toISOString().slice(0, 16).replace("T", " ")} UTC`,
  }),
].map((t) => ({ ...t, brief: briefOf(t) }));
console.log("brief:", JSON.stringify(Object.fromEntries(triggers.map((t) => [t.name.slice(0, 28), t.brief]))));

const server = spawn(process.execPath, ["test/ui-mock-server.mjs", String(port)], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise((r) => server.stdout.once("data", r));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: 1600 }, colorScheme: dark ? "dark" : "light", deviceScaleFactor: 2, timezoneId: "Asia/Dubai", locale: "en-GB" });
await ctx.addInitScript((d) => {
  localStorage.setItem("asb-token", "devtoken123");
  localStorage.setItem("asb-dark", d ? "1" : "0");
  localStorage.setItem("asb-hub-howto-done", "1");
}, dark);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.route("**/triggers.json*", (r) => r.fulfill({ json: { triggers } }));
await page.route("**/workflows.json*", (r) => r.fulfill({ json: { workflows: [] } }));
await page.route("**/harnesses.json*", (r) => r.fulfill({ json: { harnesses: [] } }));
await page.route("**/pr-followups.json*", (r) => r.fulfill({ json: { prefs: { keepGreen: true, addressReviews: true, commandAnywhere: true }, hook: null, installs: [] } }));
await page.route("**/trigger-deliveries.json*", (r) => r.fulfill({ json: { deliveries: [] } }));
await page.route("**/titles.json*", (r) => r.fulfill({ json: { titles: {} } }));

await page.goto(`http://localhost:${port}/dashboard/autopilot`, { waitUntil: "load" });
const T = "[aria-label='Automations']";
await page.waitForSelector(T, { timeout: 20000 });
await page.waitForTimeout(1400);
await page.screenshot({ path: out("page"), fullPage: true });
await page.locator(T).screenshot({ path: out("grid") });

// Readout: the filter bar, the header row and one line per row.
const readTable = () =>
  page.evaluate((T) => {
    const t = document.querySelector(T);
    const head = [...t.querySelectorAll("thead th")].map((th) => th.innerText.replace(/\s+/g, " ").trim());
    const rows = [...t.querySelectorAll("tbody tr")].map((tr) => [...tr.children].map((td) => td.innerText.replace(/\s+/g, " ").trim().slice(0, 60)).join(" | "));
    const bar = t.closest("[data-slot=data-table]")?.firstElementChild;
    const chips = bar ? [...bar.querySelectorAll("[role=radio]")].map((c) => `${c.innerText.replace(/\s+/g, " ").trim()}${c.getAttribute("aria-checked") === "true" ? "*" : ""}`) : [];
    const selects = bar ? [...bar.querySelectorAll("select")].map((sel) => `${sel.getAttribute("aria-label")}=${sel.options[sel.selectedIndex].text} (${[...sel.options].map((o) => o.text).join(" / ")})`) : [];
    return { chips, selects, head, rows };
  }, T);
const live = await page.evaluate(() => document.querySelector("header p[aria-live]")?.innerText.replace(/\s+/g, " ").trim());
const tabs = await page.evaluate(() => [...document.querySelectorAll("[role=tab]")].map((t) => t.innerText.replace(/\s+/g, " ").trim()));
console.log(JSON.stringify({ live, tabs, ...(await readTable()) }, null, 1));

// Hover a coming-up row: the actions (View · Cancel) show, like every table here.
const waitRow = page.getByRole("row", { name: "Open runs of Force-merge 3 production PRs", exact: true });
await waitRow.hover();
await page.waitForTimeout(400);
await waitRow.screenshot({ path: out("row-hover") });
console.log("widths:", JSON.stringify(await page.evaluate((T) => {
  const t = document.querySelector(T);
  const cols = [...t.querySelectorAll("col")].map((c) => `${c.dataset.col}:${c.style.width || c.className}`);
  const tr = [...t.querySelectorAll("tbody tr")].find((r) => r.innerText.includes("Force-merge 3"));
  const cells = [...tr.children].map((td) => `${td.clientWidth}/${td.scrollWidth}`);
  return { table: t.clientWidth, wrap: t.parentElement.clientWidth, scroll: t.parentElement.scrollWidth, cols, cells, tr: tr.getBoundingClientRect().width };
}, T)));
console.log("hover row buttons:", JSON.stringify(await waitRow.locator("button").allInnerTexts()));

// Scrolled sideways: the Name column stays put (sticky) while Result · Next · Source come into view.
await page.mouse.move(10, 10);
const scrolled = await page.evaluate((T) => {
  const box = document.querySelector(T).parentElement;
  box.scrollLeft = box.scrollWidth;
  const td = document.querySelector(`${T} tbody tr td`);
  const cs = getComputedStyle(td);
  const tr = getComputedStyle(td.parentElement);
  return new Promise((r) => setTimeout(() => r({ left: box.scrollLeft, max: box.scrollWidth - box.clientWidth, nameX: td.getBoundingClientRect().left, boxX: box.getBoundingClientRect().left, position: cs.position, bg: cs.backgroundColor, trTransform: tr.transform, trAnim: tr.animationName, cls: td.className.slice(0, 80) }), 300));
}, T);
console.log("scrolled:", JSON.stringify(scrolled));
await page.locator(T).screenshot({ path: out("scrolled") });
await page.evaluate((T) => (document.querySelector(T).parentElement.scrollLeft = 0), T);
await page.waitForTimeout(300);

// Filters: the One-time chip, then Status = waiting on you, then search.
await page.getByRole("radio", { name: /^One-time/ }).click();
await page.waitForTimeout(500);
console.log("chip One-time →", JSON.stringify((await readTable()).rows.map((r) => r.split(" | ")[0])));
await page.locator(T).scrollIntoViewIfNeeded();
await page.screenshot({ path: out("filter-once"), fullPage: false });
await page.getByRole("radio", { name: /^All/ }).click();
await page.locator("select[aria-label=Status]").selectOption("waiting on you");
await page.waitForTimeout(500);
console.log("status waiting on you →", JSON.stringify((await readTable()).rows.map((r) => r.split(" | ")[0])));
await page.locator("select[aria-label=Status]").selectOption("");
await page.getByRole("searchbox", { name: "Search automations" }).fill("merge");
await page.waitForTimeout(500);
console.log("search 'merge' →", JSON.stringify((await readTable()).rows.map((r) => r.split(" | ")[0])));
await page.screenshot({ path: out("search"), fullPage: false });
await page.getByRole("searchbox", { name: "Search automations" }).fill("");
await page.waitForTimeout(400);

// The editor sheet on a one-time task: the "What it does" / "Gives" fields.
await page.getByRole("button", { name: "View Force-merge 3 production PRs", exact: true }).click();
await page.waitForSelector("[role=dialog]", { timeout: 10000 });
await page.waitForTimeout(900);
await page.locator("[role=dialog]").screenshot({ path: out("sheet") });
const sheet = await page.evaluate(() => [...document.querySelectorAll("[role=dialog] input")].slice(0, 8).map((i) => `${i.closest("label")?.querySelector("span")?.innerText ?? "?"}=${i.value}${i.value ? "" : ` (${i.placeholder})`}`));
console.log("sheet:", JSON.stringify(sheet));
await page.keyboard.press("Escape");
await page.waitForTimeout(500);

// Phone.
await page.setViewportSize({ width: 420, height: 900 });
await page.waitForTimeout(800);
await page.locator(T).scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await page.screenshot({ path: out("phone") });
console.log("phone widths:", JSON.stringify(await page.evaluate((T) => {
  const t = document.querySelector(T);
  const cols = [...t.querySelectorAll("col")].map((c) => `${c.dataset.col}:${c.style.width || c.className}`);
  const tr = [...t.querySelectorAll("tbody tr")].find((r) => r.innerText.includes("Force-merge 3"));
  const cells = [...tr.children].map((td) => `${td.clientWidth}/${td.scrollWidth}`);
  const act = tr.lastElementChild.querySelector(".dt-actions");
  return { table: t.clientWidth, cols, cells, actions: act && act.getBoundingClientRect().width };
}, T)));

console.log(JSON.stringify({ errors: errors.slice(0, 5) }));
await browser.close();
server.kill();
