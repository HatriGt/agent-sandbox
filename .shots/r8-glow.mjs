// Round 8 glow fixture: nothing in the thread column paints a glow. Run from PowerShell:
//
//   node .shots/r8-glow.mjs [--shots]
//
// Renders done, running and question threads (the answer carries viz fences: chart, timeline with
// an active event, steps with an active step, compare with a pick, progress, tests, mermaid), light
// and dark, with every fold open and the composer focused, and asserts over every element and
// pseudo-element inside [data-thread]:
//   · no box-shadow layer that is not inset and is either chromatic (oklch C > 0.02) or lighter
//     than the page (a light shadow on a dark page is a bloom)
//   · no radial-gradient background, no filter: blur
//   · the number of elements carrying any box-shadow is reported and capped
//   · the composer shows an outline while focused and none when not
//   · the question card keeps a visible hairline border
import { serveWorktreeFonts } from "./overflow-probe.mjs";
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";
import fs from "node:fs";

const shots = process.argv.includes("--shots");
const base = process.env.ASB_UI || "http://localhost:5173";
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? "  " + detail : ""}`); };
const info = (name, detail) => console.log(`INFO ${name}  ${detail}`);
fs.mkdirSync(".shots/r8", { recursive: true });

// Elements with any box-shadow, measured after the round. Elevation shadows in neutral stay.
const SHADOW_CAP = { done: 12, running: 12, question: 14 };

/* ───────────── the box: one turn of work, then an answer made of visualizers ───────────── */
const NAME = "quiet-otter";
const REPO = "acme/orders-api";
const T0 = Date.now() - 14 * 60_000;
const at = (m, s = 0) => `⟦at⟧ ${T0 + m * 60_000 + s * 1000}`;
const TASK = "Replace the fixed-window rate limiter in the orders API with a sliding-window one backed by Redis, keep the public middleware signature, add tests for burst and steady traffic, and open a PR.";
const fence = (lang, body) => ["```" + lang, ...body, "```", ""];
const ANSWER = [
  "## Sliding-window limiter is in",
  "",
  "The limiter now keeps **six 10-second buckets** per key in a Redis hash and sums them on each request.",
  "",
  ...fence("chart", ['{"type":"bar","title":"Requests per bucket","x":["b1","b2","b3","b4","b5","b6"],"series":[{"name":"hits","data":[41,59,12,8,33,20]}]}']),
  ...fence("timeline", ["09:14 - read the limiter ✓", "09:15 - wrote the sliding version ✓", "09:16 - running the suite ..."]),
  ...fence("steps", ["- [x] Read the current limiter", "- [x] Implement the sliding window", "- [ ] Open the PR ...", "- [ ] Deploy preview"]),
  ...fence("compare", ["## Fail open (recommended)", "+ API stays up through a Redis outage", "- No protection during the outage", "## Fail closed", "+ Strict quota at all times", "- 503s until Redis returns"]),
  ...fence("progress", ["- coverage | 91%", "- migrated | 3/4"]),
  ...fence("tests", ["✓ test/rateLimit.test.ts (9 tests) 212ms", "✓ test/orders.test.ts (14 tests) 488ms", "Tests  23 passed (23)"]),
  ...fence("mermaid", ["flowchart LR", "  req[request] --> rl[rate limiter]", "  rl --> redis[(Redis)]", "  rl --> next[next()]"]),
  "PR: https://github.com/acme/orders-api/pull/482",
];
const QUESTION = ["Should the limiter fail open or closed when Redis is unreachable?", "", "Options:", "- Fail open (log once, allow traffic)", "- Fail closed (503 until Redis returns)"].join("\n");
const VITEST = ["RUN  v2.1.3 /workspace/orders-api", "", " ✓ test/rateLimit.test.ts (9 tests) 212ms", " ✓ test/orders.test.ts (14 tests) 488ms", "", " Test Files  2 passed (2)", "      Tests  23 passed (23)", "   Duration  1.42s"];
function log(kind) {
  const L = [at(0), "● session started (model ak-claude-opus-4.8)"];
  L.push(at(0, 4), "⟦think⟧", "Read the current implementation and its tests first so the new limiter keeps the same middleware contract.", "⟦/think⟧");
  L.push(at(0, 9), "I'll start by reading how the limiter is wired today, then swap the implementation behind the same signature.");
  L.push(`⟦plan⟧ ${T0 + 10_000}`, "[x] Read the current limiter and its tests", "[>] Implement a sliding-window limiter on Redis", "[ ] Open a pull request", "⟦/plan⟧");
  L.push(at(0, 12), "→ Read: src/middleware/rateLimit.ts ⟦#r1⟧", at(0, 13), "  ⟦#r1⟧ 1\tconst WINDOW = 60_000;", "  2\texport function rateLimit({ limit }: { limit: number }) {");
  L.push(at(0, 14), "→ Grep: rateLimit( src ⟦#r2⟧", at(0, 14), "  ⟦#r2⟧ src/app.ts:18:app.use('/orders', rateLimit({ limit: 100 }), ordersRouter);");
  L.push(at(0, 30), "→ Write: src/middleware/rateLimit.ts ⟦#w1⟧", at(0, 31), "  ⟦#w1⟧ File updated: src/middleware/rateLimit.ts (41 lines)", "⟦diff⟧", "-const WINDOW = 60_000;", "+const BUCKETS = 6;", "⟦/diff⟧");
  L.push(at(0, 40), "→ mcp__redis-dev__execute_command ⟦#m1⟧", at(0, 41), '  ⟦#m1⟧ {"command":"HGETALL rl:10.0.0.4","result":{"172950":"41","172951":"59"},"ms":3}');
  L.push(at(0, 50), "→ Bash: npx vitest run ⟦#b2⟧", at(0, 52), ...VITEST.map((l, i) => (i === 0 ? `  ⟦#b2⟧ ${l}` : `  ${l}`)));
  L.push(at(0, 56), "→ Bash: ./scripts/deploy-preview.sh ⟦#b6⟧", at(0, 57), "  ⟦#b6⟧ ⟦err⟧ Exit code 1", "  deploy-preview: DEPLOY_TOKEN is not set");
  if (kind === "question") {
    L.push(at(1, 0), "Before I open the PR there is one behaviour I do not want to guess at.");
    L.push("⟦ask⟧", QUESTION, "⟦/ask⟧");
    return L.join("\n");
  }
  L.push(at(1, 0), ...(kind === "running" ? ANSWER.slice(0, 12) : ANSWER));
  return L.join("\n");
}
const CHANGES = [
  { path: "orders-api/src/middleware/rateLimit.ts", repo: "orders-api", status: "modified", additions: 34, deletions: 11 },
  { path: "orders-api/test/rateLimit.test.ts", repo: "orders-api", status: "modified", additions: 24, deletions: 0 },
];
const PR = { repo: REPO, number: 482, title: "feat: sliding-window rate limiter", state: "open", additions: 58, deletions: 11, changedFiles: 2, head: "feat/sliding-window-limiter", base: "main", author: "agent-sandbox[bot]", url: `https://github.com/${REPO}/pull/482`, mergeable: true, reviewDecision: "review_required", reviewers: [], checks: { total: 3, success: 2, failure: 0, pending: 1 } };
const LIFECYCLE = { idleTimeoutSec: 1800, maxDurationSec: 4 * 3600, capacity: 8, poolSize: 2, sleepTtlSec: 7 * 86400, memoryTiers: ["2G", "4G", "8G"], memoryDefault: "4G" };
const ME = { kind: "user", mode: "saas", id: "u_1", login: "ak", name: "Arun K", role: "admin", via: "session", email: "ak@example.com", avatarUrl: null, github: true, hasPassword: true, maxBoxes: 8, plan: "trial", trialEndsAt: new Date(Date.now() + 9 * 86400e3).toISOString(), daysLeft: 9, expired: false, billingUrl: null };
const boxFor = (s) => ({
  name: NAME, role: "session", boxStatus: "running", task: TASK, uptime: "14m", cpu: "12%", mem: "1.1G/4G", lastOutputAt: Date.now() - 4000,
  title: "Sliding-window rate limiter", repos: [{ name: "orders-api", branch: "feat/sliding-window-limiter" }], agent: "claude",
  ...(s === "done" ? { runState: "done", exitCode: 0 } : s === "question" ? { runState: "waiting", question: QUESTION } : { runState: "running" }),
});
const frame = (event, data, id) => `event: ${event}\n${id !== undefined ? `id: ${id}\n` : ""}data: ${JSON.stringify(data)}\n\n`;

async function openThread(browser, scenario, dark) {
  const box = boxFor(scenario);
  const text = log(scenario);
  const { role: _r, ...meta } = box;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: dark ? "dark" : "light", deviceScaleFactor: 1 });
  await ctx.addInitScript((d) => { localStorage.setItem("asb-token", "devtoken123"); localStorage.setItem("asb-dark", d ? "1" : "0"); }, dark);
  await serveWorktreeFonts(ctx);
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/favicon|net::/.test(m.text()) && errors.push(m.text().slice(0, 160)));
  const json = (route, body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  const bodies = {
    "/auth/config.json": { mode: "saas", providers: ["github"], tokenLogin: true, password: true, signup: true, passwordMin: 10, trialDays: 14, beta: true },
    "/me.json": ME, "/account.json": ME,
    "/fleet.json": { boxes: [box], lifecycle: LIFECYCLE, at: Date.now() }, "/monitor.json": { boxes: [box] },
    "/watch.json": { ...meta, log: text },
    "/changes.json": { files: CHANGES }, "/pr.json": PR, "/inbox.json": { queued: [] },
    "/repos.json": { repos: [{ fullName: REPO, private: true, defaultBranch: "main", logins: ["acme"] }], total: 1 },
    "/secrets.json": { secrets: [] }, "/revert-points.json": { messages: [2] },
    "/models.json": { default: "m", current: "m", models: [{ id: "m", label: "Opus 4.8", tier: "opus" }] },
    "/skills.json": { skills: [] }, "/workflows.json": { limits: {}, dir: "", workflows: [] }, "/triggers/for-box.json": { items: [] },
    "/tree.json": { files: CHANGES.map((f) => f.path), total: CHANGES.length, truncated: false },
    "/git.json": { repo: "orders-api", branch: "feat/sliding-window-limiter", upstream: null, ahead: 0, behind: 0, lastCommit: "feat", clean: false, changed: 2 },
    "/digest.json": { box: NAME, task: TASK, state: scenario === "done" ? "done" : "running", exitCode: 0, startedAt: T0, endedAt: T0 + 92_000, plan: [], files: CHANGES, failedCommands: [], questions: [], usage: null, headline: "" },
  };
  await page.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === "/watch.sse") {
      const body = "retry: 3000\n\n" + frame("snapshot", { meta, log: text, from: 0 }, text.length) + (scenario === "done" ? frame("done", { meta }) : "");
      return route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache" }, body });
    }
    if (u.pathname in bodies) return json(route, bodies[u.pathname]);
    if (u.pathname.endsWith(".json")) return json(route, {});
    return route.fallback();
  });
  await page.goto(`${base}/dashboard/box/${NAME}`, { waitUntil: "load", timeout: 30000 }).catch((e) => errors.push("goto: " + e.message));
  await page.waitForTimeout(1800);
  await page.getByRole("button", { name: "Expand all" }).click({ timeout: 1500 }).catch(() => {});
  await page.waitForTimeout(700);
  return { ctx, page, errors };
}

/* ───────────── measurements, in the page ───────────── */
const measure = () => {
  const root = document.querySelector("[data-thread]");
  if (!root) return { missing: true };
  const cv = document.createElement("canvas"); cv.width = cv.height = 1;
  const c = cv.getContext("2d", { willReadFrequently: true });
  // Any CSS colour → [r, g, b, a] via the canvas; a colour the canvas rejects reads as transparent.
  const rgba = (color) => { c.clearRect(0, 0, 1, 1); c.fillStyle = "#000"; c.fillStyle = color; c.fillRect(0, 0, 1, 1); const d = c.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  // sRGB bytes → oklch L and C (Ottosson's matrices).
  const oklch = ([r, g, b]) => {
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const [R, G, B] = [lin(r), lin(g), lin(b)];
    const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
    const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
    const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
    const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    return { L, C: Math.hypot(a, bb) };
  };
  const pageBg = getComputedStyle(document.querySelector("[data-sheet]") ?? document.body).backgroundColor;
  const pageL = oklch(rgba(pageBg)).L;
  // Split a computed box-shadow into layers (commas inside colour functions do not split).
  const layers = (s) => { const out = []; let depth = 0, cur = ""; for (const ch of s) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch; } if (cur.trim()) out.push(cur.trim()); return out; };
  const colourOf = (layer) => layer.match(/^(rgba?\([^)]*\)|color\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\)|#[0-9a-f]+|[a-z]+)/i)?.[1] ?? null;
  const tag = (el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.classList.length ? "." + [...el.classList].slice(0, 3).join(".") : "") + (el.getAttribute("aria-label") ? `[${el.getAttribute("aria-label").slice(0, 24)}]` : "");
  const glows = [], radials = [], blurs = [];
  let shadowed = 0;
  for (const el of root.querySelectorAll("*")) {
    for (const pseudo of [null, "::before", "::after"]) {
      const cs = getComputedStyle(el, pseudo);
      if (pseudo && (cs.content === "none" || cs.content === "")) continue;
      const where = tag(el) + (pseudo ?? "");
      if (cs.boxShadow && cs.boxShadow !== "none") {
        if (!pseudo) shadowed++;
        for (const layer of layers(cs.boxShadow)) {
          if (/\binset\b/.test(layer)) continue;
          // Tailwind's ring-0 leaves zero-size layers (0px 0px 0px 0px): nothing is painted.
          if (/(?:^|\s)0px 0px 0px 0px\s*$/.test(layer)) continue;
          const col = colourOf(layer);
          if (!col) continue;
          const [r, g, b, a] = rgba(col);
          if (a === 0) continue;
          const { L, C } = oklch([r, g, b]);
          if (C > 0.02 || L > pageL + 0.02) glows.push(`${where} ${layer.slice(0, 80)} (C=${C.toFixed(3)} L=${L.toFixed(2)} page L=${pageL.toFixed(2)})`);
        }
      }
      if (/radial-gradient/.test(cs.backgroundImage)) radials.push(where);
      if (/blur\((?!0px)/.test(cs.filter)) blurs.push(`${where} ${cs.filter}`);
    }
  }
  const composer = document.querySelector(".composer-depth");
  const ccs = composer && getComputedStyle(composer);
  const composerRing = composer && { outline: ccs.outlineStyle !== "none" && parseFloat(ccs.outlineWidth) > 0 && rgba(ccs.outlineColor)[3] > 0, outlineColor: ccs.outlineColor, border: ccs.borderTopColor, shadow: ccs.boxShadow };
  const q = document.querySelector('[role=group][aria-label="Question from the agent"]');
  const qcs = q && getComputedStyle(q);
  const question = q && { width: parseFloat(qcs.borderTopWidth), colour: qcs.borderTopColor, alpha: rgba(qcs.borderTopColor)[3], bg: qcs.backgroundColor, shadow: qcs.boxShadow };
  const viz = root.querySelectorAll(".group\\/viz").length;
  const transcript = root.querySelector('[aria-label="Conversation"]')?.textContent?.length ?? 0;
  return { glows, radials, blurs, shadowed, composerRing, question, viz, transcript, pageL };
};

const browser = await chromium.launch();
try {
  for (const scenario of ["done", "running", "question"]) {
    for (const dark of [false, true]) {
      const tag = `${scenario} ${dark ? "dark" : "light"}`;
      const { ctx, page, errors } = await openThread(browser, scenario, dark);
      const rest = await page.evaluate(measure);
      check(`${tag}: the thread column root [data-thread] is present`, !rest.missing, rest.missing ? `url=${page.url()} errors=${errors.join(" | ")}` : "");
      if (rest.missing) { await page.screenshot({ path: `.shots/r8/glow-${scenario}-${dark ? "dark" : "light"}-missing.png` }); await ctx.close(); continue; }
      check(`${tag}: the transcript rendered`, rest.transcript > 400, `${rest.transcript} chars, ${rest.viz} viz frames`);
      check(`${tag}: composer has no outline when unfocused`, rest.composerRing && !rest.composerRing.outline, JSON.stringify(rest.composerRing));
      await page.locator("#send-input").focus();
      await page.waitForTimeout(350);
      const m = await page.evaluate(measure);
      info(`${tag} shadows`, `${m.shadowed} elements carry a box-shadow; page L=${m.pageL.toFixed(2)}`);
      check(`${tag}: no chromatic or light box-shadow in the column`, m.glows.length === 0, m.glows.join(" | "));
      check(`${tag}: no radial-gradient in the column`, m.radials.length === 0, m.radials.join(" | "));
      check(`${tag}: no blur filter in the column`, m.blurs.length === 0, m.blurs.join(" | "));
      check(`${tag}: box-shadow count <= ${SHADOW_CAP[scenario]}`, m.shadowed <= SHADOW_CAP[scenario], String(m.shadowed));
      check(`${tag}: composer shows an outline while focused, in a colour other than its border`, m.composerRing?.outline && m.composerRing.outlineColor !== m.composerRing.border, JSON.stringify(m.composerRing));
      if (scenario === "question") {
        check(`${tag}: question card keeps a visible hairline border`, m.question && m.question.width >= 1 && m.question.alpha > 0 && m.question.colour !== m.question.bg, JSON.stringify(m.question));
        check(`${tag}: question card carries no box-shadow`, m.question && m.question.shadow === "none", m.question?.shadow);
      }
      if (scenario === "done") {
        // The detector proves itself: the round's old composer halo, orb sphere and a blur, injected
        // back for one measurement, must each be caught.
        const injected = await page.evaluate(() => {
          const s = document.createElement("style");
          s.id = "r8-selftest";
          s.textContent = `.composer-depth:focus-within{box-shadow:0 0 0 3px color-mix(in oklch,var(--ring) 22%,transparent),var(--shadow-e2)}
            .think-orb{background:radial-gradient(circle at 32% 28%,color-mix(in oklch,var(--live) 40%,white) 0%,var(--live) 52%,black 100%);box-shadow:0 1px 2px color-mix(in oklch,var(--live) 30%,transparent);filter:blur(1px)}`;
          document.head.append(s);
          return true;
        });
        const bad = await page.evaluate(measure);
        await page.evaluate(() => document.getElementById("r8-selftest")?.remove());
        check(`${tag}: detector catches the old composer halo and orb shadow`, injected && bad.glows.length >= 2, bad.glows.join(" | "));
        check(`${tag}: detector catches a radial sphere`, bad.radials.length >= 1, bad.radials.join(" | "));
        check(`${tag}: detector catches a blur`, bad.blurs.length >= 1, bad.blurs.join(" | "));
      }
      check(`${tag}: no page errors`, errors.length === 0, errors.join(" | "));
      if (shots) {
        await page.screenshot({ path: `.shots/r8/glow-${scenario}-${dark ? "dark" : "light"}-1440.png` });
        if (scenario !== "question") {
          await page.evaluate(() => document.querySelector('[aria-label="Conversation"] > div')?.scrollTo({ top: 1e6, behavior: "instant" }));
          await page.waitForTimeout(400);
          await page.screenshot({ path: `.shots/r8/glow-${scenario}-${dark ? "dark" : "light"}-viz-1440.png` });
        }
      }
      await ctx.close();
    }
  }
} finally { await browser.close(); }
const pass = results.filter((r) => r.ok).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
