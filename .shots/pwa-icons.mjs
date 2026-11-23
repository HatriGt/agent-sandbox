// Rasterises the console's favicon.svg into the PNG set the web manifest and iOS need.
// Usage: node .shots/pwa-icons.mjs   (writes web/public/icons/*.png)
//
// - icon-192 / icon-512: the favicon as drawn (rounded square on transparent).
// - maskable-512: full-bleed ink with the glyph inside the 80% safe zone, for launchers that cut
//   their own shape (Android adaptive icons).
// - apple-touch-icon (180): full-bleed, no transparency; iOS rounds the corners itself.
import { chromium } from "file:///C:/Users/ak/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.mjs";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const svg = readFileSync(resolve(root, "web/public/favicon.svg"), "utf8");
const outDir = resolve(root, "web/public/icons");
mkdirSync(outDir, { recursive: true });

// The favicon without its rounded plate: just the box glyph, for the full-bleed variants.
const glyph = svg.replace(/<rect[^>]*\/>\s*/, "");

const shots = [
  { file: "icon-192.png", size: 192, body: svg, transparent: true },
  { file: "icon-512.png", size: 512, body: svg, transparent: true },
  { file: "maskable-512.png", size: 512, body: glyph, transparent: false, inset: 0.18 },
  { file: "apple-touch-icon.png", size: 180, body: glyph, transparent: false, inset: 0.1 },
];

const browser = await chromium.launch();
for (const s of shots) {
  const page = await browser.newPage({ viewport: { width: s.size, height: s.size }, deviceScaleFactor: 1 });
  const pad = Math.round(s.size * (s.inset ?? 0));
  await page.setContent(
    `<style>html,body{margin:0;width:${s.size}px;height:${s.size}px;overflow:hidden;background:${s.transparent ? "transparent" : "#18181b"}}
     svg{display:block;position:absolute;inset:${pad}px;width:${s.size - 2 * pad}px;height:${s.size - 2 * pad}px}</style>${s.body}`
  );
  await page.screenshot({ path: resolve(outDir, s.file), omitBackground: s.transparent, type: "png" });
  await page.close();
  console.log("wrote", s.file);
}
await browser.close();
