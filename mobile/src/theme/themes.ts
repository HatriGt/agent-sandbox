import { PALETTES, type ThemeId } from "./palettes.generated";
import type { Palette } from "./tokens";

export type { ThemeId };
export type Scheme = "light" | "dark";

/**
 * Console themes, one registry row per theme in picker order (mirrors web/src/lib/theme.ts). The
 * scheme drives the status bar and every light/dark fork; the palette is the full token set.
 */
export interface Theme {
  id: ThemeId;
  label: string;
  scheme: Scheme;
  description: string;
  palette: Palette;
}

export const THEMES: readonly Theme[] = [
  { id: "light", label: "Light", scheme: "light", description: "White paper, zinc ink", palette: PALETTES.light },
  { id: "linen", label: "Linen", scheme: "light", description: "Warm paper, warm ink", palette: PALETTES.linen },
  { id: "mist", label: "Mist", scheme: "light", description: "Cool grey-blue paper, slate ink", palette: PALETTES.mist },
  { id: "black", label: "Black", scheme: "dark", description: "Pitch black, OLED-friendly", palette: PALETTES.black },
  { id: "graphite", label: "Graphite", scheme: "dark", description: "Charcoal, the classic dark", palette: PALETTES.graphite },
  { id: "midnight", label: "Midnight", scheme: "dark", description: "Deep navy, indigo light", palette: PALETTES.midnight },
  { id: "nord", label: "Nord", scheme: "dark", description: "Polar grey-blue, frost light", palette: PALETTES.nord },
  { id: "forest", label: "Forest", scheme: "dark", description: "Deep green, moss cards, mint light", palette: PALETTES.forest },
  { id: "dusk", label: "Dusk", scheme: "dark", description: "Warm plum, rose-gold light", palette: PALETTES.dusk },
];

export const DEFAULT_THEME: Record<Scheme, ThemeId> = { light: "light", dark: "black" };

const byId = new Map(THEMES.map((t) => [t.id, t]));
export const isThemeId = (v: unknown): v is ThemeId => typeof v === "string" && byId.has(v as ThemeId);
export const themeOf = (id: ThemeId): Theme => byId.get(id)!;

/** What `asb-theme` stores: a theme id, or "system" (the OS scheme's default theme). */
export type ThemePref = ThemeId | "system";

/**
 * Parse a stored preference. The pre-registry app stored "light" | "dark" | "system" under the
 * same key: "dark" becomes Black, "light" is already a theme id, anything else follows the OS.
 */
export function parseThemePref(v: string | null): ThemePref {
  if (isThemeId(v)) return v;
  if (v === "dark") return DEFAULT_THEME.dark;
  return "system";
}

export function resolveTheme(pref: ThemePref, os: Scheme): Theme {
  return themeOf(pref === "system" ? DEFAULT_THEME[os] : pref);
}
