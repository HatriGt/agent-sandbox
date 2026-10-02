// Memory v2 (web half) with mocked routes: the proposal toast on a thread (Keep/Edit/Forget, 8 s
// auto-keep), the "Remembered" toast with Undo, the Memory page sections, the Earlier fold and
// Promote to skill. Run from PowerShell with Vite up: `node .shots/memory-v2.mjs [dark] [reduce]`.
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";
const base = process.env.ASB_UI || "http://localhost:5181";
const dark = process.argv.includes("dark"), reduce = process.argv.includes("reduce");
const sfx = `${dark ? "-dark" : ""}${reduce ? "-reduce" : ""}`;
const BOX = "asb-memory-v2";
const lifecycle = { capacity: 4, maxDurationSec: 3600, idleTimeoutSec: 900 };
const now = Date.now();
const t0 = now - 90_000;
const at = (s) => `⟦at⟧ ${t0 + s * 1000}`;
const log = [at(0), "⟦you⟧", "check the preprod org for failed syncs", "⟦/you⟧", at(2), "Looking at the preprod org now.", at(5), "→ Bash: gh api /orgs/elseco/repos ⟦#t1⟧", at(8), "  ⟦#t1⟧ 404", at(9), "⟦you⟧", "no — the preprod org is elseco-pp", "⟦/you⟧", at(12), "Got it, using elseco-pp.", '<!-- remember: lesson | The preprod org is elseco-pp, not elseco | why: gh api on elseco returned 404 -->', ""].join("\n") + "\n";

const lesson = { id: "m-lesson-1", kind: "lesson", text: "The preprod org is elseco-pp, not elseco", why: "gh api on elseco returned 404", status: "pending", at: now - 5000 };
const pref = { id: "m-pref-1", kind: "preference", text: "Keep replies short; no card layouts", status: "kept", at: now - 3000 };

const calls = [];
let memoryNew = [lesson];
const meta = () => ({ name: BOX, boxStatus: "running", runState: "running", exitCode: null, task: "Check preprod org for failed syncs", role: "cold", memoryNew });

const notes = [
  { id: "p1", kind: "preference", scope: "operator", status: "kept", text: "Keep replies short; no card layouts, lists with dividers instead", at: now - 86400e3, source: "pool-0", pinned: true },
  { id: "r1", kind: "rule", scope: "operator", status: "kept", text: "When I say “ship it”, run the tests and open a PR — never push to main", at: now - 2 * 86400e3, source: "pool-0" },
  { id: "pb1", kind: "playbook", scope: "repo", status: "kept", repo: "HatriGt/agent-sandbox", text: "Check LORO sync errors in aqa02\n1. gh api /orgs/elseco-pp/repos — confirm the org\n2. msb exec aqa02 -- grep runLoroSync /var/log/app.log | tail -50\n3. Report counts per error class, newest first", at: now - 3600e3, source: "pool-3", uses: 3, lastUsed: now - 600e3 },
  { id: "pb2", kind: "playbook", scope: "repo", status: "kept", repo: "HatriGt/agent-sandbox", text: "Nightly deps report\n1. npm outdated --json\n2. Summarise majors only", at: now - 7200e3, source: "pool-4" },
  { id: "l1", kind: "lesson", scope: "repo", status: "pending", repo: "HatriGt/agent-sandbox", text: "The preprod org is elseco-pp, not elseco", why: "gh api on elseco returned 404", at: now - 300e3, source: "pool-5" },
  { id: "l2", kind: "lesson", scope: "repo", status: "kept", repo: "HatriGt/agent-sandbox", text: "Tests need --runInBand on this repo; parallel workers deadlock on the sqlite fixture", why: "two runs hung at 100% CPU before the flag", at: now - 5 * 3600e3, source: "pool-2" },
  { id: "d1", kind: "decision", scope: "repo", status: "kept", repo: "HatriGt/agent-sandbox", text: "asked which chart library → operator chose pure SVG, no library", why: "bundle size and CSP", at: now - 7200e3, source: "pool-1" },
  { id: "f1", kind: "fact", scope: "repo", status: "kept", repo: "HatriGt/agent-sandbox", text: "Tests run with `npx tsx --test test/*.test.ts` from PowerShell; 16 Windows failures are expected", at: now - 3600e3, source: "pool-1" },
  { id: "f0", kind: "fact", scope: "repo", status: "kept", repo: "HatriGt/agent-sandbox", text: "Tests run with `npm test`", at: now - 9 * 86400e3, until: now - 3600e3, source: "pool-0" },
  { id: "f2", kind: "fact", scope: "repo", status: "kept", repo: "HatriGt/agent-sandbox", text: "Tests run with `npx tsx --test test/*.test.ts` from PowerShell; 16 Windows failures are expected", at: now - 3600e3, source: "pool-1", supersedes: "f0" },
  { id: "f3", kind: "fact", scope: "operator", status: "kept", text: "The VPS deploy script is C:\\Users\\ak\\deploy-asb.cmd", at: now - 3 * 86400e3, source: "pool-0" },
];
// f1 duplicates f2 for the shot — drop it so the superseding note is the one shown.
notes.splice(notes.findIndex((n) => n.id === "f1"), 1);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: reduce ? "reduce" : "no-preference", colorScheme: dark ? "dark" : "light" });
await ctx.addInitScript((DARK) => {
  localStorage.setItem("asb-token", "devtoken123");
  localStorage.setItem("asb-hub-howto-done", "1");
  localStorage.setItem("asb-dark", DARK);
}, dark ? "1" : "0");
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.route("**/fleet.json*", (r) => r.fulfill({ json: { boxes: [meta()], lifecycle } }));
await page.route("**/monitor.json*", (r) => r.fulfill({ json: { boxes: [meta()], lifecycle } }));
await page.route("**/watch.sse*", (r) => r.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: `event: snapshot\nid: ${log.length}\ndata: ${JSON.stringify({ meta: meta(), log, from: 0 })}\n\n` }));
await page.route("**/watch.json*", (r) => r.fulfill({ json: { ...meta(), log } }));
await page.route("**/memory-notes.json*", async (r) => {
  const req = r.request();
  const body = req.method() === "POST" ? req.postDataJSON() : req.method() === "DELETE" ? { deleteId: new URL(req.url()).searchParams.get("id") } : null;
  if (body) calls.push({ method: req.method(), ...body });
  if (body?.deleteId) {
    const i = notes.findIndex((n) => n.id === body.deleteId);
    if (i >= 0) notes.splice(i, 1);
  } else if (body?.id) {
    const n = notes.find((x) => x.id === body.id);
    if (n) Object.assign(n, body);
  } else if (body?.add) {
    notes.unshift({ id: `new-${notes.length}`, scope: "operator", status: "kept", at: Date.now(), source: "you", ...body.add });
  }
  r.fulfill({ json: { enabled: true, notes } });
});
await page.route("**/memory-promote.json*", (r) => {
  calls.push({ method: "POST", promote: r.request().postDataJSON().id });
  r.fulfill({ json: { skill: { name: "check-loro-sync" }, enabled: true, notes } });
});
await page.route("**/digest.json*", (r) => r.fulfill({ status: 404, json: { error: "none" } }));
await page.route("**/history/outcome.json*", (r) => r.fulfill({ status: 404, json: { error: "none" } }));
await page.route("**/changes.json*", (r) => r.fulfill({ json: { files: [] } }));
await page.route("**/inbox.json*", (r) => r.fulfill({ json: { queued: [] } }));
await page.route("**/skills.json*", (r) => r.fulfill({ json: { skills: [] } }));
await page.route("**/revert-points.json*", (r) => r.fulfill({ json: { messages: [] } }));

const bad = [];
const shot = (name) => page.screenshot({ path: `.shots/out/memory-v2-${name}${sfx}.png` });

// 1. Pending lesson → proposal toast.
await page.goto(`${base}/dashboard/box/${BOX}`, { waitUntil: "load" });
const t = page.locator("[data-memory-toast='m-lesson-1']");
try { await t.waitFor({ timeout: 15000 }); } catch { bad.push("lesson toast never appeared"); }
await page.waitForTimeout(600);
const tt = (await t.count()) ? (await t.innerText()).replace(/\s+/g, " ") : "";
console.log("toast:", JSON.stringify(tt));
if (!/Lesson to remember/.test(tt) || !/elseco-pp/.test(tt) || !/404/.test(tt)) bad.push("toast text missing label/text/why");
await shot("toast-pending");
// Keyboard: Tab reaches Keep; Edit opens inline textarea.
await t.getByRole("button", { name: "Edit" }).click();
await page.waitForTimeout(300);
const ta = t.locator("textarea");
if (!(await ta.count())) bad.push("Edit did not open a textarea");
else {
  await ta.fill("Preprod org = elseco-pp (not elseco); the prod org is elseco");
  await shot("toast-edit");
  await ta.press("Enter");
  await page.waitForTimeout(400);
  const saved = calls.find((c) => c.id === "m-lesson-1" && c.status === "kept" && /elseco-pp \(not elseco\)/.test(c.text ?? ""));
  if (!saved) bad.push("Edit → Enter did not POST {id, text, status: kept}");
  if (await t.count()) bad.push("toast still open after save");
}
// 2. Auto-keep: fresh id, wait > 8 s, no interaction.
calls.length = 0;
memoryNew = [{ ...lesson, id: "m-lesson-2", text: "Run the sync checker from the repo root, not from scripts/" }];
await page.evaluate(() => localStorage.removeItem("asb-memory-seen"));
await page.reload({ waitUntil: "load" });
const t2 = page.locator("[data-memory-toast='m-lesson-2']");
try { await t2.waitFor({ timeout: 15000 }); } catch { bad.push("second lesson toast never appeared"); }
await page.mouse.move(10, 10);
await page.waitForTimeout(9000);
if (!calls.some((c) => c.id === "m-lesson-2" && c.status === "kept")) bad.push("auto-keep after 8 s did not POST status kept");
if (await t2.count()) bad.push("toast still open after auto-keep");
// Esc = Keep.
calls.length = 0;
memoryNew = [{ ...lesson, id: "m-lesson-3", text: "Esc keeps this one" }];
await page.evaluate(() => localStorage.removeItem("asb-memory-seen"));
await page.reload({ waitUntil: "load" });
const t3 = page.locator("[data-memory-toast='m-lesson-3']");
try { await t3.waitFor({ timeout: 15000 }); } catch { bad.push("third lesson toast never appeared"); }
await t3.getByRole("button", { name: "Keep", exact: true }).focus();
await page.keyboard.press("Escape");
await page.waitForTimeout(500);
if (!calls.some((c) => c.id === "m-lesson-3" && c.status === "kept")) bad.push("Esc did not keep");
// Forget.
calls.length = 0;
memoryNew = [{ ...lesson, id: "m-lesson-4", text: "Forget this one" }];
await page.evaluate(() => localStorage.removeItem("asb-memory-seen"));
await page.reload({ waitUntil: "load" });
const t4 = page.locator("[data-memory-toast='m-lesson-4']");
try { await t4.waitFor({ timeout: 15000 }); } catch { bad.push("fourth lesson toast never appeared"); }
await t4.getByRole("button", { name: "Forget" }).click();
await page.waitForTimeout(500);
if (!calls.some((c) => c.method === "DELETE" && c.deleteId === "m-lesson-4")) bad.push("Forget did not DELETE");
// Seen dedupe: reload WITHOUT clearing → no toast.
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1500);
if (await t4.count()) bad.push("seen id toasted again after reload");

// 3. Auto-kept preference → "Remembered" toast with Undo.
calls.length = 0;
memoryNew = [pref];
await page.evaluate(() => localStorage.removeItem("asb-memory-seen"));
await page.reload({ waitUntil: "load" });
const rem = page.locator("[data-sonner-toast]", { hasText: "Remembered:" });
try { await rem.waitFor({ timeout: 15000 }); } catch { bad.push("Remembered toast never appeared"); }
await page.waitForTimeout(500);
await shot("toast-remembered");
if (await rem.count()) {
  await rem.getByRole("button", { name: "Undo" }).click();
  await page.waitForTimeout(400);
  if (!calls.some((c) => c.method === "DELETE" && c.deleteId === "m-pref-1")) bad.push("Undo did not DELETE the preference");
}

// 4. Memory page.
await page.goto(`${base}/dashboard/memory`, { waitUntil: "load" });
await page.waitForTimeout(1200);
const main = await page.locator("main").innerText().catch(() => "");
for (const s of ["You", "HatriGt/agent-sandbox", "Playbooks", "Lessons", "Decisions", "Facts", "Earlier", "Any repo", "used 3×", "Keep", "Proposed by a run"]) if (!main.toLowerCase().includes(s.toLowerCase())) bad.push(`memory page missing "${s}"`);
if (/npm test/.test(main)) bad.push("Earlier content visible while collapsed");
await shot("page");
await page.screenshot({ path: `.shots/out/memory-v2-page-full${sfx}.png`, fullPage: true });
// Earlier fold.
console.log("page-bad-so-far:", bad.join(" ; "));
await page.locator("[aria-controls=memory-earlier-list]").click();
await page.waitForTimeout(500);
const after = await page.locator("main").innerText().catch(() => "");
if (!/npm test/.test(after) || !/replaced by/.test(after)) bad.push("Earlier fold did not reveal the superseded note with 'replaced by'");
const earlier = page.locator("#memory-earlier-h");
await earlier.scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await shot("page-earlier");
// Promote to skill.
calls.length = 0;
const promote = page.getByRole("button", { name: /Promote · used 3×/ });
if (!(await promote.count())) bad.push("no emphasised Promote button on the used-3× playbook");
else {
  await promote.scrollIntoViewIfNeeded();
  await promote.click();
  await page.waitForTimeout(500);
  if (!calls.some((c) => c.promote === "pb1")) bad.push("Promote did not POST /memory-promote.json");
  const pt = page.locator("[data-sonner-toast]", { hasText: "check-loro-sync" });
  if (!(await pt.count())) bad.push("no skill-drafted toast");
  await shot("page-promote");
}
// Inline Keep on the pending row.
calls.length = 0;
await page.locator("li", { hasText: "Proposed by a run" }).getByRole("button", { name: "Keep", exact: true }).click();
await page.waitForTimeout(400);
if (!calls.some((c) => c.id === "l1" && c.status === "kept")) bad.push("inline Keep did not POST status kept");
// Composer.
await page.getByRole("button", { name: "Add", exact: true }).click();
await page.waitForTimeout(400);
await page.getByRole("radio", { name: "Rule" }).click();
await page.getByLabel("Rule text").fill("When I say deploy, run the tests first");
await page.locator("[aria-controls=memory-composer]").scrollIntoViewIfNeeded();
await shot("page-composer");
await page.keyboard.press("Enter");
await page.waitForTimeout(400);
if (!calls.some((c) => c.add?.kind === "rule" && /deploy/.test(c.add.text))) bad.push("composer did not POST {add}");

console.log(bad.length ? "FAIL\n" + bad.join("\n") : "PASS");
console.log("errors:", errors.slice(0, 3).join(" | ") || "none");
await browser.close();
