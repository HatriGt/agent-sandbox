// Skills page flows: node .shots/skills-flows.mjs [--dark] [--w=1440 --h=900] [scenario...]
// Scenarios: list editor preview raw newfile menu new template empty import import-paste mobile
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";

const args = process.argv.slice(2);
const dark = args.includes("--dark");
const w = Number(args.find((a) => a.startsWith("--w="))?.slice(4) ?? 1440);
const h = Number(args.find((a) => a.startsWith("--h="))?.slice(4) ?? 900);
const scenarios = args.filter((a) => !a.startsWith("--"));
const suffix = `${w}${dark ? "-dark" : ""}`;
const base = "http://localhost:5173";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: dark ? "dark" : "light", deviceScaleFactor: 1 });
await ctx.addInitScript((d) => { localStorage.setItem("asb-token", "devtoken123"); localStorage.setItem("asb-dark", d ? "1" : "0"); }, dark);
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && !/status of (404|500)/.test(m.text()) && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
const shot = (name) => page.screenshot({ path: `.shots/sk-${name}-${suffix}.png` });
const run = (name) => !scenarios.length || scenarios.includes(name);

await page.goto(base + "/dashboard/skills", { waitUntil: "load" });
await page.waitForTimeout(1200);
if (run("list")) await shot("list");

const openSkill = async (name) => {
  await page.click(`button[aria-label='Edit skill ${name}']`);
  await page.waitForTimeout(600);
};
const back = async () => {
  await page.click("button[aria-label='Back to skills']");
  await page.waitForTimeout(500);
};

if (run("editor")) {
  await openSkill("review-pr");
  await shot("editor");
  // open a supporting file
  await page.click("nav[aria-label='Skill files'] button[title='templates/comment.md']").catch(() => {});
  await page.waitForTimeout(400);
  await shot("editor-file");
  await back();
}
if (run("preview")) {
  await openSkill("review-pr");
  await page.click("[role=tab]:has-text('Preview')").catch(async () => page.click("[role=radio]:has-text('Preview')"));
  await page.waitForTimeout(500);
  await shot("preview");
  await page.click("[role=radio]:has-text('Raw')");
  await page.waitForTimeout(400);
  await shot("preview-raw");
  await back();
}
if (run("newfile")) {
  await openSkill("release-notes");
  await page.click("button[aria-label='Add a file']");
  await page.keyboard.type("scripts/collect.sh");
  await page.waitForTimeout(200);
  await shot("newfile-typing");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  await page.keyboard.type("#!/bin/sh\ngit log --oneline $(git describe --tags --abbrev=0)..HEAD");
  await page.waitForTimeout(300);
  await shot("newfile-dirty");
  // hover the row to reveal menu and rename
  const row = page.locator("nav[aria-label='Skill files'] button[title='scripts/collect.sh']");
  await row.hover();
  await page.click("nav[aria-label='Skill files'] button[aria-label='File actions']");
  await page.waitForTimeout(300);
  await shot("file-menu");
  await page.click("[role=menuitem]:has-text('Rename')");
  await page.waitForTimeout(200);
  await page.keyboard.type("gather");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  await shot("file-renamed");
  // leave without saving: guard
  await back();
  await page.waitForTimeout(400);
  await shot("unsaved-guard");
  await page.click("button:has-text('Discard')");
  await page.waitForTimeout(500);
}
if (run("menu")) {
  await openSkill("fix-ci");
  await page.click("button[aria-label='More actions']");
  await page.waitForTimeout(300);
  await shot("menu");
  await page.click("[role=menuitem]:has-text('Delete skill')");
  await page.waitForTimeout(400);
  await shot("delete-confirm");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await back();
}
if (run("new")) {
  await page.click("button:has-text('New skill')");
  await page.waitForTimeout(600);
  await shot("new-empty");
  await page.keyboard.type("Ship Hotfix");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Use when a production bug needs a same-day fix and release.");
  await page.click(".cm-content");
  await page.keyboard.type("# Hotfix\n\n1. Branch from the last release tag.\n2. Fix, add a regression test.\n3. Tag and release; open a back-merge PR.");
  await page.waitForTimeout(300);
  await shot("new-filled");
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(900);
  await shot("new-saved");
  await back();
  await page.waitForTimeout(500);
  await shot("list-after-create");
  // clean up: delete the created skill
  await openSkill("ship-hotfix");
  await page.click("button[aria-label='More actions']");
  await page.click("[role=menuitem]:has-text('Delete skill')");
  await page.waitForTimeout(300);
  await page.click("[role=dialog] button:has-text('Delete skill')");
  await page.waitForTimeout(800);
}
if (run("template")) {
  // templates strip shows only for missing templates; all 3 exist, so intercept to show it
  await page.route("**/skills.json", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const res = await route.fetch();
    const json = await res.json();
    json.skills = json.skills.filter((s) => s.name !== "fix-ci");
    await route.fulfill({ response: res, json });
  });
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(1200);
  await shot("templates");
  await page.unroute("**/skills.json");
}
if (run("empty")) {
  await page.route("**/skills.json", (route) => (route.request().method() === "GET" ? route.fulfill({ json: { skills: [] } }) : route.continue()));
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(1200);
  await shot("empty");
  await page.unroute("**/skills.json");
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(1000);
}
if (run("import")) {
  await page.click("button:has-text('Import')");
  await page.waitForTimeout(500);
  await shot("import");
}
if (run("github")) {
  if (!run("import")) {
    await page.click("button:has-text('Import')");
    await page.waitForTimeout(500);
  }
  await page.click("button:has-text('anthropics/skills')");
  await page.waitForTimeout(1500);
  await shot("github-loading");
  await page.waitForTimeout(8000);
  await shot("github-list");
  await page.click("[role=checkbox]").catch(() => {});
  await page.waitForTimeout(4000);
  await shot("github-preview");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
}
if (run("import-paste")) {
  if (!run("import")) {
    await page.click("button:has-text('Import')");
    await page.waitForTimeout(500);
  }
  await page.click("[role=tab]:has-text('Paste')");
  await page.waitForTimeout(300);
  await page.fill("textarea", "---\nname: triage-issue\ndescription: Use when an issue needs labels and a first response.\n---\n\n# Triage\n\n1. Reproduce.\n2. Label severity.\n3. Reply within the hour.");
  await page.waitForTimeout(400);
  await shot("import-paste");
  await page.keyboard.press("Escape");
}
if (run("mobile")) {
  await openSkill("review-pr");
  await shot("m-editor");
  await page.click("button:has-text('SKILL.md')");
  await page.waitForTimeout(400);
  await shot("m-files");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.click("button[aria-label='Details']");
  await page.waitForTimeout(400);
  await shot("m-details");
  await page.keyboard.press("Escape");
  await back();
}

console.log("done", suffix);
if (errors.length) console.log("console errors:\n" + errors.slice(0, 10).join("\n"));
await browser.close();
