// File and folder icon geometry, with no React Native imports so scripts/preview-file-icons.mjs can
// render the same table to HTML. FileIcon.tsx paints it with react-native-svg.
import type { FileHue } from "@/theme/palettes.generated";

/** The eight generated hues, plus three neutral tiers that come from the live palette. */
export type Hue = FileHue | "slate" | "grey" | "muted";

export type FileGlyph =
  | "ts"
  | "js"
  | "json"
  | "yaml"
  | "md"
  | "css"
  | "html"
  | "py"
  | "compiled"
  | "shell"
  | "image"
  | "config"
  | "package"
  | "tsconfig"
  | "git"
  | "readme"
  | "license"
  | "docker"
  | "file";

export interface IconDef {
  match: RegExp;
  hue: Hue;
  glyph: FileGlyph;
}

/** Matched against the file's base name, first hit wins; dedicated names sit above the families. */
export const ICONS: readonly IconDef[] = [
  { match: /^package(-lock)?\.json$/i, hue: "data", glyph: "package" },
  { match: /^tsconfig(\..+)?\.json$/i, hue: "ts", glyph: "tsconfig" },
  { match: /^\.git(ignore|attributes|modules)$/i, hue: "compiled", glyph: "git" },
  { match: /^readme(\..+)?$/i, hue: "slate", glyph: "readme" },
  { match: /^(licen[cs]e|copying)(\..+)?$/i, hue: "muted", glyph: "license" },
  { match: /^dockerfile(\..+)?$|\.dockerfile$|^docker-compose\.ya?ml$/i, hue: "ts", glyph: "docker" },
  { match: /\.tsx?$/i, hue: "ts", glyph: "ts" },
  { match: /\.[mc]?jsx?$/i, hue: "js", glyph: "js" },
  { match: /\.json[c5]?$/i, hue: "data", glyph: "json" },
  { match: /\.(ya?ml|toml)$/i, hue: "data", glyph: "yaml" },
  { match: /\.(md|markdown|mdx)$/i, hue: "slate", glyph: "md" },
  { match: /\.(css|scss|sass|less)$/i, hue: "css", glyph: "css" },
  { match: /\.(html?|vue|svelte|astro)$/i, hue: "html", glyph: "html" },
  { match: /\.py[iw]?$/i, hue: "py", glyph: "py" },
  { match: /\.(c|h|cc|cpp|hpp|cs|go|rs|java|kt|swift|m|mm|zig)$/i, hue: "compiled", glyph: "compiled" },
  { match: /\.(sh|bash|zsh|fish|ps1|bat|cmd)$/i, hue: "grey", glyph: "shell" },
  { match: /\.(png|jpe?g|gif|webp|svg|bmp|heic|ico|avif)$/i, hue: "image", glyph: "image" },
  { match: /^\.(env|editorconfig|prettierrc|eslintrc|npmrc|nvmrc)(\..+)?$|\.(env|ini|cfg|conf|config|lock|properties)$/i, hue: "muted", glyph: "config" },
];

const FALLBACK: IconDef = { match: /./, hue: "muted", glyph: "file" };
const TEST = /\.(test|spec)\.[^.]+$/i;

export function iconFor(name: string): IconDef & { test: boolean } {
  const base = name.slice(name.lastIndexOf("/") + 1);
  const def = ICONS.find((d) => d.match.test(base)) ?? FALLBACK;
  return { ...def, test: TEST.test(base) };
}

/** Marks are drawn in a 16×16 box over the document body; `x` and `y` default to its centre. */
export type Mark =
  | { kind: "path"; d: string; fill?: true; width?: number }
  | { kind: "text"; s: string; size?: number; x?: number }
  | { kind: "circle"; cx: number; cy: number; r: number; stroke?: true }
  | { kind: "rect"; x: number; y: number; w: number; h: number };

export const DOC = {
  body: "M3.5 1.5H9L12.5 5V14.5H3.5Z",
  fold: "M9 1.5V5H12.5",
} as const;

export const FOLDER = {
  back: "M1.5 4.7a1.2 1.2 0 0 1 1.2-1.2h3.3a1.2 1.2 0 0 1 .85.35L8.1 5.1h5.2a1.2 1.2 0 0 1 1.2 1.2v6.5a1.2 1.2 0 0 1-1.2 1.2H2.7a1.2 1.2 0 0 1-1.2-1.2Z",
  closed: "M1.5 6.6h13v6.2a1.2 1.2 0 0 1-1.2 1.2H2.7a1.2 1.2 0 0 1-1.2-1.2Z",
  open: "M3 7.4h12.4l-1.7 5.9a1 1 0 0 1-.96.7H2.1Z",
} as const;

/** A small circle with a check, bottom-right, for *.test.* and *.spec.* files. */
export const TEST_BADGE = { cx: 12.3, cy: 12.3, r: 3.1, check: "M10.8 12.3l1.1 1.1 2-2.2" } as const;

const two = (s: string): Mark => ({ kind: "text", s, size: 5.4 });

export const MARKS: Record<FileGlyph, Mark[]> = {
  ts: [two("TS")],
  js: [two("JS")],
  json: [{ kind: "text", s: "{ }", size: 5.8 }],
  yaml: [
    { kind: "rect", x: 5, y: 8.2, w: 1.3, h: 1.3 },
    { kind: "rect", x: 7.2, y: 8.2, w: 4, h: 1.3 },
    { kind: "rect", x: 5, y: 10.4, w: 1.3, h: 1.3 },
    { kind: "rect", x: 7.2, y: 10.4, w: 3, h: 1.3 },
    { kind: "rect", x: 5, y: 12.6, w: 1.3, h: 1.3 },
    { kind: "rect", x: 7.2, y: 12.6, w: 4, h: 1.3 },
  ],
  md: [
    { kind: "text", s: "M", size: 5.6, x: 6.6 },
    { kind: "path", d: "M10.6 8.4v4.2M9.2 11.2l1.4 1.5 1.4-1.5" },
  ],
  css: [{ kind: "text", s: "#", size: 6.6 }],
  html: [{ kind: "text", s: "<>", size: 6 }],
  py: [two("Py")],
  compiled: [
    { kind: "circle", cx: 8, cy: 10.6, r: 2.1, stroke: true },
    { kind: "path", d: "M8 7.2v1.2M8 12.8v1.2M4.6 10.6h1.2M10.2 10.6h1.2" },
  ],
  shell: [{ kind: "text", s: ">_", size: 5.6 }],
  image: [
    { kind: "path", d: "M4.8 13.2 7.2 9.6l1.6 2 1-1.2 1.8 2.8Z", fill: true },
    { kind: "circle", cx: 10.2, cy: 8, r: 1.1 },
  ],
  config: [
    { kind: "path", d: "M5 9.2h6M5 12h6" },
    { kind: "circle", cx: 6.8, cy: 9.2, r: 1.2 },
    { kind: "circle", cx: 9.4, cy: 12, r: 1.2 },
  ],
  package: [{ kind: "path", d: "M5 9.2l3-1.5 3 1.5v3.6l-3 1.5-3-1.5ZM5 9.2l3 1.5 3-1.5M8 10.7v3.6" }],
  tsconfig: [
    { kind: "text", s: "TS", size: 5.4, x: 7.4 },
    { kind: "circle", cx: 11.5, cy: 12.7, r: 1.3 },
  ],
  git: [
    { kind: "circle", cx: 6, cy: 8.6, r: 1.2 },
    { kind: "circle", cx: 6, cy: 12.6, r: 1.2 },
    { kind: "circle", cx: 10.2, cy: 8.6, r: 1.2 },
    { kind: "path", d: "M6 9.8v1.6M10.2 9.8c0 1.8-2.2 1.4-3.4 2.1" },
  ],
  readme: [
    { kind: "rect", x: 5, y: 8.3, w: 6, h: 1.5 },
    { kind: "rect", x: 5, y: 10.8, w: 4.5, h: 1 },
    { kind: "rect", x: 5, y: 12.6, w: 5.5, h: 1 },
  ],
  license: [
    { kind: "circle", cx: 8, cy: 9.6, r: 2, stroke: true },
    { kind: "path", d: "M6.9 11.4l-.7 2.4 1.8-.8 1.8.8-.7-2.4", fill: true },
  ],
  docker: [
    { kind: "rect", x: 4.8, y: 11, w: 2, h: 2 },
    { kind: "rect", x: 7.1, y: 11, w: 2, h: 2 },
    { kind: "rect", x: 9.4, y: 11, w: 2, h: 2 },
    { kind: "rect", x: 7.1, y: 8.7, w: 2, h: 2 },
  ],
  file: [
    { kind: "rect", x: 5, y: 9.6, w: 5, h: 1 },
    { kind: "rect", x: 5, y: 11.8, w: 3.5, h: 1 },
  ],
};
