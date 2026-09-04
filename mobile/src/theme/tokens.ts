// Design tokens ported 1:1 from web/src/index.css (oklch → sRGB hex).
// Rule set carried over from web/DESIGN.md:
//  - color is functional only; every state color pairs with an icon AND a word
//  - amber is reserved exclusively for "needs you"
//  - border OR shadow, never both

export type Palette = {
  background: string;
  foreground: string;
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
};

export const palettes: { light: Palette; dark: Palette } = {
  light: {
    background: "#fcfcfd",
    foreground: "#18181b",
    card: "#ffffff",
    popover: "#ffffff",
    primary: "#18181b",
    primaryForeground: "#fafafa",
    secondary: "#f0f0f1",
    muted: "#f2f2f4",
    mutedForeground: "#62626c",
    accent: "#ececef",
    faint: "#797981",
    border: "#00000017",
    lineStrong: "#0000002e",
    input: "#0000001f",
    ring: "#2d69de",
    live: "#1f5ed9",
    attention: "#f9b73f",
    attentionText: "#925000",
    attentionInk: "#331b06",
    ok: "#007f3d",
    destructive: "#d01d21",
    sleep: "#8156c0",
    trace: "#161619",
    traceFg: "#e7e7ea",
  },
  dark: {
    background: "#0f0f12",
    foreground: "#eeeef0",
    card: "#171719",
    popover: "#1b1b1e",
    primary: "#e8e8e9",
    primaryForeground: "#131316",
    secondary: "#262629",
    muted: "#222226",
    mutedForeground: "#9d9da6",
    accent: "#2b2b2f",
    faint: "#85858d",
    border: "#ffffff17",
    lineStrong: "#ffffff33",
    input: "#ffffff24",
    ring: "#6ca2ff",
    live: "#75a9ff",
    attention: "#f2b036",
    attentionText: "#f7c56d",
    attentionInk: "#2b1401",
    ok: "#55c483",
    destructive: "#ff6367",
    sleep: "#be9df7",
    trace: "#070709",
    traceFg: "#dedee0",
  },
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
export const radius = { sm: 6, md: 8, lg: 10, xl: 14, "2xl": 18, pill: 9999 } as const;

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
      return { color: p.attention, word: "needs you", icon: "hand" };
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
