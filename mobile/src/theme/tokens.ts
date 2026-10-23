// Design tokens. Palettes live in palettes.generated.ts (nine themes, oklch source in
// scripts/build-themes.mjs); the registry that names them is themes.ts.
// Rule set carried over from web/DESIGN.md:
//  - color is functional only; every state color pairs with an icon AND a word
//  - amber is reserved exclusively for "action needed"
//  - border OR shadow, never both

export type Palette = {
  background: string;
  foreground: string;
  /** The web sidebar tone. On the phone it only paints the theme picker's rail strip. */
  rail: string;
  card: string;
  popover: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  faint: string;
  border: string;
  lineStrong: string;
  input: string;
  ring: string;
  live: string;
  attention: string;
  attentionText: string;
  attentionInk: string;
  ok: string;
  destructive: string;
  sleep: string;
  trace: string;
  traceFg: string;
  /** Text on `destructive` fills. Dark red needs dark ink, not white. */
  destructiveForeground: string;
  /** Modal/sheet backdrop. */
  scrim: string;
};

// Type scale from web (px sizes; lineHeight = size * ratio, rounded).
export const type = {
  micro: { fontSize: 11, lineHeight: 15 },
  meta: { fontSize: 13, lineHeight: 20 },
  body: { fontSize: 14, lineHeight: 21 },
  lead: { fontSize: 15, lineHeight: 23 },
  prose: { fontSize: 15.5, lineHeight: 26 },
  code: { fontSize: 12.5, lineHeight: 20 },
  h3: { fontSize: 16, lineHeight: 22 },
  h2: { fontSize: 20, lineHeight: 27 },
  h1: { fontSize: 28, lineHeight: 34 },
  display: { fontSize: 34, lineHeight: 39 },
} as const;

export const fonts = {
  sans: "Inter_400Regular",
  sansMedium: "Inter_500Medium",
  sansSemi: "Inter_600SemiBold",
  serif: "HedvigLettersSerif_400Regular",
  mono: "GeistMono_400Regular",
  monoMedium: "GeistMono_500Medium",
} as const;

// Radius scale: base 8px (0.5rem); sm/md/lg/xl/2xl = -2/+0/+2/+6/+10.
export const radius = { sm: 6, md: 8, lg: 10, xl: 14, "2xl": 18, sheet: 24, pill: 9999 } as const;

export const space = (n: number) => n * 4;

export type RunState = "running" | "waiting" | "done" | "idle";

export function stateColor(p: Palette, s: {
  runState?: RunState | string;
  boxStatus?: string;
  exitCode?: number | null;
}): { color: string; word: string; icon: "dot" | "hand" | "check" | "x" | "moon" | "circle" } {
  if (/^stopped$/i.test(s.boxStatus ?? "")) return { color: p.sleep, word: "sleeping", icon: "moon" };
  switch (s.runState) {
    case "waiting":
      return { color: p.attention, word: "action needed", icon: "hand" };
    case "running":
      return { color: p.live, word: "working", icon: "dot" };
    case "done":
      return s.exitCode === 0
        ? { color: p.ok, word: "done", icon: "check" }
        : s.exitCode === 137
          ? { color: p.destructive, word: "out of memory", icon: "x" }
        : s.exitCode === 254
          ? { color: p.mutedForeground, word: "interrupted", icon: "x" }
          : s.exitCode === 253
            ? { color: p.mutedForeground, word: "stopped", icon: "x" }
            : { color: p.destructive, word: "failed", icon: "x" };
    default:
      return { color: p.faint, word: "idle", icon: "circle" };
  }
}
