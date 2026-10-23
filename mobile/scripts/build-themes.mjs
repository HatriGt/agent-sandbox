// The nine console themes, authored in oklch so they stay auditable against web/src/index.css, and
// converted to sRGB hex for React Native (which has no oklch). Rerun after editing a value:
//
//   node mobile/scripts/build-themes.mjs
//
// It rewrites mobile/src/theme/palettes.generated.ts. Each hex carries its oklch source in a
// trailing comment so a reviewer can diff a theme against the web registry line by line.
//
// A value is an oklch tuple [L, C, H] or [L, C, H, alpha], or a literal "#hex" passthrough.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "theme", "palettes.generated.ts");

// Functional state colours are shared by every theme in a scheme. Amber is the attention state in
// all nine themes (the web dashboard moved its attention fill to ink; the phone keeps amber).
const LIGHT_STATES = {
  ring: [0.55, 0.19, 262],
  live: [0.52, 0.2, 262],
  attention: [0.82, 0.15, 78],
  attentionText: [0.5, 0.12, 62],
  attentionInk: [0.25, 0.05, 60],
  ok: [0.52, 0.14, 152],
  destructive: [0.55, 0.21, 27],
  sleep: [0.55, 0.16, 300],
  destructiveForeground: "#ffffff",
  scrim: [0, 0, 0, 0.4],
};
const DARK_STATES = {
  ring: [0.72, 0.16, 262],
  live: [0.74, 0.15, 262],
  attention: [0.8, 0.15, 78],
  attentionText: [0.85, 0.12, 80],
  attentionInk: [0.22, 0.05, 60],
  ok: [0.74, 0.14, 155],
  destructive: [0.7, 0.19, 22],
  sleep: [0.76, 0.13, 300],
  destructiveForeground: "#1a0607",
  scrim: [0, 0, 0, 0.6],
};

// Light: web :root. White paper, zinc ink.
const light = {
  background: [0.992, 0.001, 286],
  foreground: [0.21, 0.006, 285.9],
  rail: [0.962, 0.003, 286],
  card: [1, 0, 0],
  popover: [1, 0, 0],
  primary: [0.21, 0.006, 285.9],
  primaryForeground: [0.985, 0, 0],
  secondary: [0.955, 0.002, 286.4],
  muted: [0.962, 0.002, 286.4],
  mutedForeground: [0.5, 0.016, 285.9],
  accent: [0.945, 0.003, 286.4],
  faint: [0.555, 0.012, 286],
  border: [0, 0, 0, 0.09],
  lineStrong: [0, 0, 0, 0.18],
  input: [0, 0, 0, 0.12],
  trace: [0.2, 0.006, 286],
  traceFg: [0.93, 0.003, 286],
  ...LIGHT_STATES,
};

// Linen: web [data-theme="linen"]. Warm paper (hue 80), warm ink (hue 60), brand indigo kept.
const linen = {
  ...light,
  background: [0.975, 0.009, 80],
  foreground: [0.25, 0.02, 60],
  rail: [0.945, 0.012, 80],
  card: [0.99, 0.005, 85],
  popover: [0.99, 0.005, 85],
  primary: [0.25, 0.02, 60],
  primaryForeground: [0.985, 0.006, 85],
  secondary: [0.94, 0.012, 80],
  muted: [0.945, 0.012, 80],
  mutedForeground: [0.49, 0.03, 65],
  accent: [0.925, 0.014, 80],
  faint: [0.54, 0.028, 65],
  border: [0.3, 0.05, 60, 0.12],
  lineStrong: [0.3, 0.05, 60, 0.22],
  input: [0.3, 0.05, 60, 0.15],
  trace: [0.22, 0.012, 60],
  traceFg: [0.93, 0.008, 80],
};

// Mist: Linen's recipe on a cool grey-blue paper (hue 240).
const mist = {
  ...light,
  background: [0.975, 0.008, 240],
  foreground: [0.24, 0.02, 250],
  rail: [0.945, 0.012, 240],
  card: [0.99, 0.004, 240],
  popover: [0.99, 0.004, 240],
  primary: [0.24, 0.02, 250],
  primaryForeground: [0.985, 0.004, 240],
  secondary: [0.94, 0.012, 240],
  muted: [0.945, 0.012, 240],
  mutedForeground: [0.48, 0.03, 245],
  accent: [0.925, 0.014, 240],
  faint: [0.54, 0.028, 245],
  border: [0.3, 0.06, 245, 0.12],
  lineStrong: [0.3, 0.06, 245, 0.22],
  input: [0.3, 0.06, 245, 0.15],
  trace: [0.21, 0.015, 245],
  traceFg: [0.93, 0.006, 240],
};

// Graphite: web .dark. Charcoal, the rail a step below the page, the terminal darker still.
const graphite = {
  background: [0.175, 0.005, 286],
  foreground: [0.95, 0.002, 286],
  rail: [0.125, 0.005, 286],
  card: [0.215, 0.005, 286],
  popover: [0.245, 0.006, 286],
  primary: [0.93, 0.002, 286],
  primaryForeground: [0.19, 0.005, 286],
  secondary: [0.28, 0.006, 286],
  muted: [0.265, 0.006, 286],
  mutedForeground: [0.7, 0.012, 286],
  accent: [0.3, 0.007, 286],
  faint: [0.62, 0.012, 286],
  border: [1, 0, 0, 0.12],
  lineStrong: [1, 0, 0, 0.24],
  input: [1, 0, 0, 0.16],
  trace: [0.12, 0.004, 286],
  traceFg: [0.9, 0.004, 286],
  ...DARK_STATES,
};

// Black: web [data-theme="black"]. Pitch page; nothing can sit below it, so rail, card and the
// terminal all step UP and a sheet reads as a dark well in a lighter frame.
const black = {
  ...graphite,
  background: [0.1, 0, 0],
  foreground: [0.95, 0, 0],
  rail: [0.16, 0, 0],
  card: [0.15, 0, 0],
  popover: [0.19, 0, 0],
  primary: [0.95, 0, 0],
  primaryForeground: [0.12, 0, 0],
  secondary: [0.23, 0, 0],
  muted: [0.21, 0, 0],
  mutedForeground: [0.71, 0, 0],
  accent: [0.25, 0, 0],
  faint: [0.63, 0, 0],
  border: [1, 0, 0, 0.1],
  lineStrong: [1, 0, 0, 0.22],
  input: [1, 0, 0, 0.14],
  trace: [0.16, 0, 0],
  traceFg: [0.9, 0, 0],
};

// Midnight: web [data-theme="midnight"]. Navy on the live hue (262); cards lean six degrees violet
// and the hairlines carry the hue.
const midnight = {
  ...graphite,
  background: [0.17, 0.03, 262],
  foreground: [0.95, 0.008, 262],
  rail: [0.125, 0.028, 262],
  card: [0.215, 0.032, 268],
  popover: [0.25, 0.034, 268],
  primary: [0.93, 0.012, 262],
  primaryForeground: [0.19, 0.03, 262],
  secondary: [0.28, 0.038, 266],
  muted: [0.265, 0.036, 266],
  mutedForeground: [0.73, 0.03, 262],
  accent: [0.3, 0.042, 266],
  faint: [0.65, 0.03, 262],
  border: [0.78, 0.1, 262, 0.16],
  lineStrong: [0.78, 0.1, 262, 0.3],
  input: [0.78, 0.1, 262, 0.2],
  ring: [0.74, 0.16, 262],
  live: [0.76, 0.15, 262],
  trace: [0.115, 0.026, 262],
  traceFg: [0.9, 0.01, 262],
  scrim: [0.1, 0.03, 262, 0.6],
};

// Nord: Midnight's recipe at a lower chroma on a cool grey-blue (hue 240). Live stays brand indigo.
const nord = {
  ...graphite,
  background: [0.19, 0.018, 240],
  foreground: [0.95, 0.006, 240],
  rail: [0.145, 0.016, 240],
  card: [0.23, 0.02, 244],
  popover: [0.265, 0.022, 244],
  primary: [0.93, 0.01, 240],
  primaryForeground: [0.2, 0.018, 240],
  secondary: [0.29, 0.024, 244],
  muted: [0.275, 0.022, 244],
  mutedForeground: [0.74, 0.022, 240],
  accent: [0.31, 0.026, 244],
  faint: [0.66, 0.022, 240],
  border: [0.8, 0.07, 240, 0.16],
  lineStrong: [0.8, 0.07, 240, 0.3],
  input: [0.8, 0.07, 240, 0.2],
  trace: [0.13, 0.014, 240],
  traceFg: [0.9, 0.008, 240],
  scrim: [0.1, 0.02, 240, 0.6],
};

// Forest: deep green (hue 155) with a mint live (hue 172). `ok` moves to leaf green (hue 145) and
// drops a step in lightness so done and working stay apart; both still carry an icon and a word.
const forest = {
  ...graphite,
  background: [0.17, 0.022, 155],
  foreground: [0.95, 0.008, 150],
  rail: [0.125, 0.02, 155],
  card: [0.21, 0.026, 158],
  popover: [0.245, 0.028, 158],
  primary: [0.93, 0.012, 150],
  primaryForeground: [0.19, 0.022, 155],
  secondary: [0.275, 0.032, 158],
  muted: [0.26, 0.03, 158],
  mutedForeground: [0.73, 0.03, 150],
  accent: [0.295, 0.036, 158],
  faint: [0.65, 0.03, 150],
  border: [0.8, 0.1, 155, 0.16],
  lineStrong: [0.8, 0.1, 155, 0.3],
  input: [0.8, 0.1, 155, 0.2],
  ring: [0.8, 0.13, 172],
  live: [0.82, 0.12, 172],
  ok: [0.72, 0.15, 145],
  trace: [0.12, 0.018, 155],
  traceFg: [0.9, 0.01, 150],
  scrim: [0.08, 0.02, 155, 0.6],
};

// Dusk: warm aubergine (hue 340) with a rose-gold live (hue 35, chroma .09). Destructive keeps its
// saturated red (hue 22, chroma .19); the two differ by chroma and lightness, not hue alone.
const dusk = {
  ...graphite,
  background: [0.18, 0.028, 340],
  foreground: [0.95, 0.008, 340],
  rail: [0.135, 0.026, 340],
  card: [0.22, 0.03, 345],
  popover: [0.255, 0.032, 345],
  primary: [0.93, 0.012, 340],
  primaryForeground: [0.2, 0.028, 340],
  secondary: [0.285, 0.036, 345],
  muted: [0.27, 0.034, 345],
  mutedForeground: [0.74, 0.028, 340],
  accent: [0.305, 0.04, 345],
  faint: [0.66, 0.028, 340],
  border: [0.8, 0.1, 340, 0.16],
  lineStrong: [0.8, 0.1, 340, 0.3],
  input: [0.8, 0.1, 340, 0.2],
  ring: [0.78, 0.11, 35],
  live: [0.8, 0.09, 35],
  trace: [0.12, 0.022, 340],
  traceFg: [0.9, 0.01, 340],
  scrim: [0.08, 0.025, 340, 0.6],
};

// Order is the picker order: light schemes first, then dark.
const THEMES = { light, linen, mist, black, graphite, midnight, nord, forest, dusk };

// File-type icon hues: eight hues at one lightness and chroma per scheme (ui/FileIcon.tsx).
const FILE_HUE_ANGLES = { ts: 250, js: 80, data: 150, css: 300, html: 45, py: 195, compiled: 25, image: 350 };
const FILE_HUES = {
  light: Object.fromEntries(Object.entries(FILE_HUE_ANGLES).map(([k, h]) => [k, [0.52, 0.12, h]])),
  dark: Object.fromEntries(Object.entries(FILE_HUE_ANGLES).map(([k, h]) => [k, [0.76, 0.11, h]])),
};

function oklchToHex(L, C, H, alpha) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const toSrgb = (c) => {
    c = Math.min(1, Math.max(0, c));
    return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  };
  const hex = (c) => Math.round(toSrgb(c) * 255).toString(16).padStart(2, "0");
  let out = `#${hex(r)}${hex(g)}${hex(bl)}`;
  if (alpha != null) out += Math.round(alpha * 255).toString(16).padStart(2, "0");
  return out;
}

const source = (v) => (typeof v === "string" ? "literal" : `oklch(${v.slice(0, 3).join(" ")}${v.length > 3 ? ` / ${v[3]}` : ""})`);
const hexOf = (v) => (typeof v === "string" ? v : oklchToHex(...v));
const block = (set, indent) =>
  Object.entries(set)
    .map(([k, v]) => `${indent}${k}: "${hexOf(v)}", // ${source(v)}`)
    .join("\n");

const out = `// Generated by mobile/scripts/build-themes.mjs. Do not edit; change the oklch source there and rerun.
import type { Palette } from "./tokens";

export type ThemeId = ${Object.keys(THEMES).map((k) => `"${k}"`).join(" | ")};
export type FileHue = ${Object.keys(FILE_HUE_ANGLES).map((k) => `"${k}"`).join(" | ")};

export const PALETTES: Record<ThemeId, Palette> = {
${Object.entries(THEMES)
  .map(([id, set]) => `  ${id}: {\n${block(set, "    ")}\n  },`)
  .join("\n")}
};

export const FILE_HUES: Record<"light" | "dark", Record<FileHue, string>> = {
${Object.entries(FILE_HUES)
  .map(([scheme, set]) => `  ${scheme}: {\n${block(set, "    ")}\n  },`)
  .join("\n")}
};
`;

writeFileSync(OUT, out);
console.log(`wrote ${OUT}`);
for (const [id, set] of Object.entries(THEMES)) {
  console.log(`${id.padEnd(9)} page ${hexOf(set.background)} rail ${hexOf(set.rail)} card ${hexOf(set.card)} live ${hexOf(set.live)}`);
}
