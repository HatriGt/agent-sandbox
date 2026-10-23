// Rewrites the mist/nord/forest/dusk objects in mobile/scripts/build-themes.mjs from the web CSS
// blocks (:root[data-theme] in web/src/index.css), so the phone and the dashboard share one palette.
// Mobile-only keys (scrim, the amber attention states) stay; the web-only ones (shade, viz-grid) are
// not carried. Rerun .shots/compare-themes.mjs afterwards: it must print "all matched".
import { readFileSync, writeFileSync } from "node:fs";

const CSS = "web/src/index.css";
const MJS = "mobile/scripts/build-themes.mjs";
const css = readFileSync(CSS, "utf8");
let mjs = readFileSync(MJS, "utf8");
const nl = mjs.includes("\r\n") ? "\r\n" : "\n";

// web token -> mobile key, in the order the mobile objects list them.
const ORDER = [
  ["background", "background"], ["foreground", "foreground"], ["sidebar", "rail"], ["card", "card"], ["popover", "popover"],
  ["primary", "primary"], ["primary-foreground", "primaryForeground"], ["secondary", "secondary"], ["muted", "muted"],
  ["muted-foreground", "mutedForeground"], ["accent", "accent"], ["faint", "faint"], ["border", "border"],
  ["line-strong", "lineStrong"], ["input", "input"], ["ring", "ring"], ["live", "live"], ["ok", "ok"],
  ["trace", "trace"], ["trace-fg", "traceFg"],
];
const NOTE = {
  mist: "Mist: web [data-theme=\"mist\"]. Cool grey-blue paper (hue 240), slate ink (hue 250), a steel-blue live.",
  nord: "Nord: web [data-theme=\"nord\"]. Polar grey-blue (hue 245), a step lighter than Graphite; frost-cyan live (hue 215).",
  forest: "Forest: web [data-theme=\"forest\"]. Deep green (hue 155), moss cards, mint live (hue 172); `ok` leans yellow-green (hue 135).",
  dusk: "Dusk: web [data-theme=\"dusk\"]. Warm aubergine (hue 340), rose-gold live (hue 20).",
};

function tokens(id) {
  const m = css.match(new RegExp(String.raw`:root\[data-theme="${id}"\]\s*\{([^}]*)\}`));
  if (!m) throw new Error("no css block for " + id);
  const out = {};
  for (const mm of m[1].matchAll(/--([a-z0-9-]+):\s*oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)/g)) {
    out[mm[1]] = [mm[2], mm[3], mm[4], mm[5]].filter((x) => x !== undefined).map(Number);
  }
  return out;
}

for (const [id, base] of [["mist", "light"], ["nord", "graphite"], ["forest", "graphite"], ["dusk", "graphite"]]) {
  const t = tokens(id);
  const lines = [`// ${NOTE[id]}`, `const ${id} = {`, `  ...${base},`];
  for (const [wk, mk] of ORDER) if (wk in t) lines.push(`  ${mk}: [${t[wk].join(", ")}],`);
  const old = mjs.match(new RegExp(String.raw`^// [^\n]*\n(?:// [^\n]*\n)?const ${id} = \{[\s\S]*?^\};`, "m"));
  if (!old) throw new Error("no mobile object for " + id);
  const scrim = old[0].match(/^\s*scrim: (\[[^\]]*\]),/m);
  if (scrim) lines.push(`  scrim: ${scrim[1]},`);
  lines.push("};");
  mjs = mjs.replace(old[0], lines.join(nl));
}
writeFileSync(MJS, mjs);
console.log("rewritten", MJS);
