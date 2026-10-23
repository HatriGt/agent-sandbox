// Compares the web theme CSS (:root[data-theme] blocks in web/src/index.css) with the mobile oklch
// sources in mobile/scripts/build-themes.mjs, token by token, and prints every mismatch.
import { readFileSync } from "node:fs";

const css = readFileSync("web/src/index.css", "utf8");
const mjs = readFileSync("mobile/scripts/build-themes.mjs", "utf8");

// web token -> mobile key
const MAP = {
  background: "background", foreground: "foreground", sidebar: "rail", card: "card", popover: "popover",
  primary: "primary", "primary-foreground": "primaryForeground", secondary: "secondary", muted: "muted",
  "muted-foreground": "mutedForeground", accent: "accent", faint: "faint", border: "border",
  "line-strong": "lineStrong", input: "input", trace: "trace", "trace-fg": "traceFg",
  ring: "ring", live: "live", ok: "ok",
};

function webTheme(id) {
  const m = css.match(new RegExp(String.raw`:root\[data-theme="${id}"\]\s*\{([^}]*)\}`));
  if (!m) throw new Error("no css block for " + id);
  const out = {};
  for (const [, k, v] of m[1].matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) out[k] = v.trim();
  return out;
}
function parseOklch(v) {
  const m = v.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)/);
  return m ? [m[1], m[2], m[3], m[4]].filter((x) => x !== undefined).map(Number) : v;
}
function mobileTheme(id) {
  // Resolve the `...base` spread chain by evaluating the object literals in order.
  const objs = {};
  for (const [, name, body] of mjs.matchAll(/^const (\w+) = \{([\s\S]*?)^\};/gm)) {
    const o = {};
    for (const [, base] of body.matchAll(/^\s*\.\.\.(\w+),/gm)) Object.assign(o, objs[base] ?? {});
    for (const [, k, v] of body.matchAll(/^\s*(\w+):\s*(\[[^\]]*\]|"[^"]*"),/gm)) o[k] = JSON.parse(v);
    objs[name] = o;
  }
  for (const [, name, body] of mjs.matchAll(/^const (\w+) = \{([\s\S]*?)^\};/gm)) if (/STATES/.test(name)) objs[name] = objs[name];
  return objs[id];
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let bad = 0;
for (const id of process.argv.slice(2)) {
  const w = webTheme(id), m = mobileTheme(id);
  if (!m) { console.log(id, "missing on mobile"); bad++; continue; }
  for (const [wk, mk] of Object.entries(MAP)) {
    if (!(wk in w)) continue; // the theme inherits its scheme base for this token
    const wv = parseOklch(w[wk]), mv = m[mk];
    if (!same(wv, mv)) { bad++; console.log(`${id}.${wk}: web ${JSON.stringify(wv)} mobile ${JSON.stringify(mv)}`); }
  }
}
console.log(bad ? `${bad} mismatches` : "all matched");
