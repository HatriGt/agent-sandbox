import { cn } from "@/lib/utils";

/**
 * The console's file icon theme, one inline-SVG set for the explorer, tabs, the @ menu and the
 * quick-open lists. Every file is the same 16px sheet with a folded corner; the family's mark sits
 * on the sheet and the whole icon takes the family's hue, one of eight picked in oklch at one
 * lightness and one chroma per scheme so no file shouts. Prose, shell, config and lock files draw in
 * the muted ink. Folders are a two-tone glyph in the muted ink: the tab turns live when a change
 * sits inside, and a repo root wears a branch mark.
 */

export type Hue = "blue" | "amber" | "green" | "violet" | "orange" | "teal" | "red" | "pink" | "mono";

// Light L .62 C .13, dark L .72 C .12. Whole class strings so Tailwind's scanner sees them.
const HUE: Record<Hue, string> = {
  blue: "text-[oklch(0.62_0.13_250)] dark:text-[oklch(0.72_0.12_250)]",
  amber: "text-[oklch(0.62_0.13_80)] dark:text-[oklch(0.72_0.12_80)]",
  green: "text-[oklch(0.62_0.13_150)] dark:text-[oklch(0.72_0.12_150)]",
  violet: "text-[oklch(0.62_0.13_305)] dark:text-[oklch(0.72_0.12_305)]",
  orange: "text-[oklch(0.62_0.13_50)] dark:text-[oklch(0.72_0.12_50)]",
  teal: "text-[oklch(0.62_0.13_195)] dark:text-[oklch(0.72_0.12_195)]",
  red: "text-[oklch(0.62_0.13_20)] dark:text-[oklch(0.72_0.12_20)]",
  pink: "text-[oklch(0.62_0.13_345)] dark:text-[oklch(0.72_0.12_345)]",
  mono: "text-muted-foreground",
};

// All marks share the svg's 1.5 stroke, round caps and joins; a filled piece says so itself.
const SOLID = { fill: "currentColor", stroke: "none" } as const;
const SLIDERS = (
  <>
    <path d="M4.75 9.25h6.5M4.75 12.25h6.5" />
    <circle cx="9.5" cy="9.25" r="1.25" {...SOLID} />
    <circle cx="6.5" cy="12.25" r="1.25" {...SOLID} />
  </>
);
const MARK = {
  ts: <path d="M5.75 8.75h4.5M8 8.75v4.5" />,
  js: <path d="M7 8.75h3M9.75 8.75v2.75a1.75 1.75 0 0 1-3.5 0" />,
  data: <path d="M6.75 8.25c-1 0-1.5.5-1.5 1.25v.75c0 .5-.25.75-.75.75.5 0 .75.25.75.75v.75c0 .75.5 1.25 1.5 1.25M9.25 8.25c1 0 1.5.5 1.5 1.25v.75c0 .5.25.75.75.75-.5 0-.75.25-.75.75v.75c0 .75-.5 1.25-1.5 1.25" />,
  doc: <path d="M5.25 8.5h5.5M5.25 10.75h5.5M5.25 13h3" />,
  style: <path d="M6.5 8.25v5M9.5 8.25v5M5 9.75h6M5 11.75h6" />,
  markup: <path d="M6.25 8.5 4.5 10.75l1.75 2.25M9.75 8.5l1.75 2.25-1.75 2.25" />,
  python: <path d="M6 13.25V8.5h2.25a1.5 1.5 0 0 1 0 3H6" />,
  compiled: <path d="m8 7.75 2.6 1.5v3L8 13.75l-2.6-1.5v-3z" />,
  shell: <path d="m5 8.75 2.5 2-2.5 2M8.75 12.75h2.5" />,
  media: (
    <>
      <path d="m4.75 13.25 2.5-2.75 1.75 1.75 1-1 1.75 2" />
      <circle cx="10.25" cy="8.75" r=".9" {...SOLID} />
    </>
  ),
  config: SLIDERS,
  tsconfig: SLIDERS,
  lock: (
    <>
      <path d="M6.25 10.25v-1a1.75 1.75 0 0 1 3.5 0v1" />
      <rect x="5.25" y="10.25" width="5.5" height="3.25" rx=".75" {...SOLID} />
    </>
  ),
  package: <path d="M5 9.5h6v4H5zM5 9.5V8.25h6V9.5M8 9.5v4" />,
  gitignore: (
    <>
      <circle cx="8" cy="10.75" r="2.5" />
      <path d="m6.25 9 3.5 3.5" />
    </>
  ),
  readme: (
    <>
      <circle cx="8" cy="8.5" r=".9" {...SOLID} />
      <path d="M8 10.5v3" />
    </>
  ),
  license: (
    <>
      <circle cx="8" cy="9.75" r="2" />
      <path d="m6.9 11.5-.9 2.25M9.1 11.5l.9 2.25" />
    </>
  ),
  dockerfile: <path d="M4.75 11h2v2h-2zM7.25 11h2v2h-2zM9.75 11h2v2h-2zM6 8.5h2v2H6zM8.5 8.5h2v2h-2z" {...SOLID} />,
  file: null,
};
export type Kind = keyof typeof MARK;

type Rule = { kind: Kind; hue: Hue; match: RegExp };
/** Tested in order against the lowercased basename; name-matched specials come before extensions. */
export const ICONS: readonly Rule[] = [
  { kind: "package", hue: "amber", match: /^package\.json$/ },
  { kind: "tsconfig", hue: "blue", match: /^tsconfig(\..+)?\.json$/ },
  { kind: "lock", hue: "mono", match: /^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|cargo\.lock|go\.sum|.*\.lock)$/ },
  { kind: "gitignore", hue: "mono", match: /^\.git(ignore|attributes|modules)$/ },
  { kind: "readme", hue: "mono", match: /^readme(\..+)?$/ },
  { kind: "license", hue: "mono", match: /^(licen[cs]e|copying|notice)(\..+)?$/ },
  { kind: "dockerfile", hue: "mono", match: /^(dockerfile|.*\.dockerfile|(docker-)?compose\.ya?ml)$/ },
  { kind: "shell", hue: "mono", match: /^(makefile|justfile|.*\.(sh|bash|zsh|fish|ps1|bat|cmd|mk))$/ },
  { kind: "config", hue: "mono", match: /^(\.env(\..+)?|\.[a-z]+rc(\.(json|ya?ml|[cm]?js))?|\.editorconfig|\.npmrc|.*\.config\.[cm]?[jt]s|.*\.(ini|cfg|conf|properties))$/ },
  { kind: "ts", hue: "blue", match: /\.([cm]?ts|tsx)$/ },
  { kind: "js", hue: "amber", match: /\.([cm]?js|jsx)$/ },
  { kind: "data", hue: "green", match: /\.(json|jsonc|json5|ya?ml|toml|sql|graphql|gql|prisma|csv|tsv)$/ },
  { kind: "doc", hue: "mono", match: /\.(md|mdx|markdown|txt|rst|adoc|log)$/ },
  { kind: "style", hue: "violet", match: /\.(css|scss|sass|less|styl|pcss)$/ },
  { kind: "markup", hue: "orange", match: /\.(html?|xhtml|xml|vue|svelte|astro|ejs|hbs|njk)$/ },
  { kind: "python", hue: "teal", match: /\.(py|pyi|ipynb)$/ },
  { kind: "compiled", hue: "red", match: /\.(go|rs|c|h|cc|cpp|hpp|cs|java|kt|kts|swift|dart|scala|zig|ex|exs|hs|lua|rb|php|r|jl|wasm)$/ },
  { kind: "media", hue: "pink", match: /\.(png|jpe?g|gif|webp|avif|ico|bmp|svg|woff2?|ttf|otf|eot|mp4|mp3|wav|pdf)$/ },
];
const FALLBACK: Rule = { kind: "file", hue: "mono", match: /./ };
const TEST = /(\.(test|spec)\.[^.]+|_test\.go)$/;

export type FileIconDef = { kind: Kind; hue: Hue; test: boolean };
export function fileIcon(path: string): FileIconDef {
  const base = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const rule = ICONS.find((r) => r.match.test(base)) ?? FALLBACK;
  return { kind: rule.kind, hue: rule.hue, test: TEST.test(base) };
}

// A 10x13 sheet centred in the 16 box, its corner folded at top right.
const SHEET = "M4 1.75h5.25L13 5.5v7.75a1.25 1.25 0 0 1-1.25 1.25h-7.5A1.25 1.25 0 0 1 3 13.25V2.75a1 1 0 0 1 1-1z";
const FOLD = "M9.25 1.75V5.5H13";
const BADGE = (
  <g>
    <circle cx="12" cy="12.25" r="3.75" fill="var(--background)" stroke="none" />
    <circle cx="12" cy="12.25" r="2.75" {...SOLID} />
    <path d="m10.6 12.25 1 1 1.9-1.9" stroke="var(--background)" strokeWidth={1.25} />
  </g>
);

export function FileIcon({ path, size = 16, className }: { path: string; size?: number; className?: string }) {
  const { kind, hue, test } = fileIcon(path);
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={cn("shrink-0", HUE[hue], className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      data-file-kind={kind}
      data-file-hue={hue}
      data-file-test={test || undefined}
    >
      <path d={SHEET} fill="currentColor" fillOpacity={0.08} />
      <path d={FOLD} />
      {MARK[kind]}
      {test && BADGE}
    </svg>
  );
}

// Back plate (the tab) and front body. The body is an opaque 85% mix (inline, since Tailwind does
// not emit a color-mix arbitrary property) so the plate never shows through it; the plate is a step
// darker in both schemes (full ink in light, 60% in dark).
const PLATE = "M1.5 3.75A1.25 1.25 0 0 1 2.75 2.5h3.1a1.25 1.25 0 0 1 .9.37l1.1 1.13h5.4A1.25 1.25 0 0 1 14.5 5.25v7.5A1.25 1.25 0 0 1 13.25 14h-10.5A1.25 1.25 0 0 1 1.5 12.75z";
const BODY = {
  closed: "M1.5 6.25h13v6.5A1.25 1.25 0 0 1 13.25 14h-10.5A1.25 1.25 0 0 1 1.5 12.75z",
  open: "M3.1 7.25h11.2a.7.7 0 0 1 .68.88l-1.3 4.95a1.25 1.25 0 0 1-1.2.92H2.75A1.25 1.25 0 0 1 1.5 12.75V8.85A1.6 1.6 0 0 1 3.1 7.25z",
};
const BRANCH = "M5.75 9.5v3M10.25 9.5c0 1.5-4.5 1-4.5 2.5";

export type FolderIconProps = { open?: boolean; root?: boolean; changed?: boolean; size?: number; className?: string };
export function FolderIcon({ open = false, root = false, changed = false, size = 16, className }: FolderIconProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} className={cn("text-muted-foreground shrink-0", className)} aria-hidden data-folder={open ? "open" : "closed"} data-folder-root={root || undefined} data-folder-changed={changed || undefined}>
      <path d={PLATE} fill="currentColor" className={cn("dark:opacity-60", changed && "text-live")} data-folder-tab />
      <path d={BODY[open ? "open" : "closed"]} style={{ fill: "color-mix(in oklab, currentColor 85%, var(--background))" }} data-folder-body />
      {root && (
        <g stroke="var(--background)" strokeWidth={1.25} strokeLinecap="round" fill="var(--background)">
          <circle cx="5.75" cy="9.5" r=".9" stroke="none" />
          <circle cx="10.25" cy="9.5" r=".9" stroke="none" />
          <circle cx="5.75" cy="12.5" r=".9" stroke="none" />
          <path d={BRANCH} fill="none" />
        </g>
      )}
    </svg>
  );
}
