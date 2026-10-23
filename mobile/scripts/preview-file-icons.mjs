// Renders the FileIcon geometry table and the nine theme palettes to HTML (and a PNG when the
// workstation's Playwright is present), straight from the source modules, so a reviewer can see the
// glyphs without an emulator. The SVG markup mirrors FileIcon.tsx's render; keep the two in step.
//
//   node mobile/scripts/preview-file-icons.mjs            → mobile/.preview/file-icons.html (+ .png)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const here = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const root = join(here, "..");
const outDir = join(root, ".preview");
mkdirSync(outDir, { recursive: true });

// Type-only imports are elided by the transpiler, so both modules load as plain ESM.
async function load(rel) {
  const src = readFileSync(join(root, rel), "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  const tmp = join(outDir, rel.replace(/[\\/]/g, "_").replace(/\.ts$/, ".mjs"));
  writeFileSync(tmp, js);
  return import(pathToFileURL(tmp).href);
}

const { DOC, FOLDER, MARKS, TEST_BADGE, iconFor } = await load("src/components/ui/fileGlyphs.ts");
const { PALETTES, FILE_HUES } = await load("src/theme/palettes.generated.ts");

const SAMPLES = [
  "src", "open-folder", "app.tsx", "index.ts", "main.js", "worker.mjs", "data.json", "config.yaml", "pyproject.toml",
  "README.md", "notes.mdx", "styles.css", "theme.scss", "index.html", "App.vue", "train.py", "main.go", "lib.rs",
  "main.c", "Program.cs", "deploy.sh", "run.ps1", "logo.png", "icon.svg", ".env", "settings.ini", "yarn.lock",
  "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", ".gitignore", "LICENSE", "Dockerfile",
  "docker-compose.yml", "app.test.tsx", "api.spec.js", "util.test.py", "Makefile", "notes.txt",
];
const DARK = new Set(["black", "graphite", "midnight", "nord", "forest", "dusk"]);

function hueColor(hue, p, dark) {
  if (hue === "slate") return p.mutedForeground;
  if (hue === "grey" || hue === "muted") return p.faint;
  return FILE_HUES[dark ? "dark" : "light"][hue];
}

function mark(m, hue) {
  switch (m.kind) {
    case "path":
      return m.fill ? `<path d="${m.d}" fill="${hue}"/>` : `<path d="${m.d}" fill="none" stroke="${hue}" stroke-width="${m.width ?? 1.1}" stroke-linecap="round" stroke-linejoin="round"/>`;
    case "text":
      return `<text x="${m.x ?? 8}" y="12.6" font-size="${m.size ?? 5.4}" font-family="Geist Mono, ui-monospace, Menlo, monospace" font-weight="500" fill="${hue}" text-anchor="middle">${m.s.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</text>`;
    case "circle":
      return m.stroke ? `<circle cx="${m.cx}" cy="${m.cy}" r="${m.r}" fill="none" stroke="${hue}" stroke-width="1.1"/>` : `<circle cx="${m.cx}" cy="${m.cy}" r="${m.r}" fill="${hue}"/>`;
    case "rect":
      return `<rect x="${m.x}" y="${m.y}" width="${m.w}" height="${m.h}" rx="0.5" fill="${hue}"/>`;
  }
}

function svg(name, p, dark, size) {
  const folder = name === "src" || name === "open-folder";
  let body;
  if (folder) {
    const tone = p.mutedForeground;
    body = `<path d="${FOLDER.back}" fill="${tone}" fill-opacity="0.55"/><path d="${name === "open-folder" ? FOLDER.open : FOLDER.closed}" fill="${tone}"/>`;
  } else {
    const def = iconFor(name);
    const hue = hueColor(def.hue, p, dark);
    body =
      `<path d="${DOC.body}" fill="${hue}" fill-opacity="0.14" stroke="${hue}" stroke-width="1.1" stroke-linejoin="round"/>` +
      `<path d="${DOC.fold}" fill="none" stroke="${hue}" stroke-width="1.1" stroke-linejoin="round"/>` +
      MARKS[def.glyph].map((m) => mark(m, hue)).join("") +
      (def.test ? `<circle cx="${TEST_BADGE.cx}" cy="${TEST_BADGE.cy}" r="${TEST_BADGE.r}" fill="${hue}"/><path d="${TEST_BADGE.check}" fill="none" stroke="${p.background}" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>` : "");
  }
  return `<svg width="${size}" height="${size}" viewBox="0 0 16 16">${body}</svg>`;
}

const themeBlock = (id, p) => {
  const dark = DARK.has(id);
  const rows = SAMPLES.map(
    (n) =>
      `<div class="row" style="border-color:${p.border}">${svg(n, p, dark, 16)}${svg(n, p, dark, 40)}<span style="color:${p.foreground}">${n}</span><span class="k" style="color:${p.faint}">${n === "src" || n === "open-folder" ? "folder" : `${iconFor(n).glyph} · ${iconFor(n).hue}${iconFor(n).test ? " · test" : ""}`}</span></div>`,
  ).join("");
  const swatch = (k) => `<i title="${k}" style="background:${p[k]}"></i>`;
  return `<section style="background:${p.background};color:${p.foreground}">
    <h2>${id} <small style="color:${p.mutedForeground}">${dark ? "dark" : "light"}</small></h2>
    <div class="sw">${["background", "rail", "card", "popover", "secondary", "muted", "accent", "border", "foreground", "mutedForeground", "faint", "live", "attention", "ok", "destructive", "sleep", "trace"].map(swatch).join("")}</div>
    <div class="card" style="background:${p.card};border-color:${p.border}">${rows}</div>
  </section>`;
};

const html = `<!doctype html><meta charset="utf-8"><title>FileIcon + themes</title>
<style>
  body{margin:0;font:13px/1.4 Inter,system-ui,sans-serif;display:grid;grid-template-columns:repeat(3,1fr)}
  section{padding:16px 18px}
  h2{margin:0 0 8px;font-size:15px;text-transform:capitalize}
  .sw{display:flex;gap:3px;margin-bottom:10px}.sw i{display:block;width:16px;height:16px;border-radius:4px;box-shadow:inset 0 0 0 1px rgba(128,128,128,.35)}
  .card{border:1px solid;border-radius:10px;padding:2px 10px}
  .row{display:grid;grid-template-columns:16px 40px 1fr auto;gap:10px;align-items:center;padding:3px 0;border-bottom:1px solid}
  .row:last-child{border-bottom:0}.k{font-size:11px;font-family:ui-monospace,Menlo,monospace}
</style>
${Object.entries(PALETTES).map(([id, p]) => themeBlock(id, p)).join("")}`;

const htmlPath = join(outDir, "file-icons.html");
writeFileSync(htmlPath, html);
console.log(`wrote ${htmlPath}`);

// The dashboard's .shots scripts use the workstation's global Playwright; a missing one is not an error.
const PW = "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";
try {
  const { chromium } = await import(PW);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(pathToFileURL(htmlPath).href);
  const png = join(outDir, "file-icons.png");
  await page.screenshot({ path: png, fullPage: true });
  await browser.close();
  console.log(`wrote ${png}`);
} catch (e) {
  console.log(`no screenshot: ${e.message.split("\n")[0]}`);
}
