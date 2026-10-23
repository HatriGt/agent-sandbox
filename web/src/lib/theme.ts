import * as React from "react";

/**
 * Console themes. One registry row per theme; the id lands on `<html data-theme>` and the scheme
 * drives the `dark` class, which every `.dark` selector (syntax tokens, raised, code blocks, Mermaid)
 * keys off. Token values live in `index.css` (`:root[data-theme="…"]` blocks). `preview` repeats the
 * tones the theme panel's miniatures are drawn in (rail, page, card, ink, muted ink, hairline, live);
 * `.shots/r8-themes.mjs` asserts the rendered page background equals `preview.background`, so the
 * registry and the CSS cannot drift silently.
 *
 * Storage: `asb-theme` holds the choice, `asb-theme-light` / `asb-theme-dark` the last choice per
 * scheme so the light/dark toggle returns to the theme the user had, not to a default. The legacy
 * `asb-dark` key (true → Black, false → Light) is read once and then superseded.
 */
export type ThemeId = "light" | "linen" | "mist" | "black" | "graphite" | "midnight" | "nord" | "forest" | "dusk";
export type Scheme = "light" | "dark";
export interface Theme {
  id: ThemeId;
  label: string;
  scheme: Scheme;
  description: string;
  preview: { background: string; sidebar: string; card: string; foreground: string; muted: string; border: string; live: string };
}

export const THEMES: readonly Theme[] = [
  {
    id: "light", label: "Light", scheme: "light", description: "White paper, zinc ink",
    preview: { background: "oklch(0.992 0.001 286)", sidebar: "oklch(0.962 0.003 286)", card: "oklch(1 0 0)", foreground: "oklch(0.21 0.006 285.9)", muted: "oklch(0.5 0.016 285.9)", border: "oklch(0 0 0 / 0.09)", live: "oklch(0.52 0.2 262)" },
  },
  {
    id: "linen", label: "Linen", scheme: "light", description: "Warm paper, warm ink",
    preview: { background: "oklch(0.975 0.009 80)", sidebar: "oklch(0.945 0.012 80)", card: "oklch(0.99 0.005 85)", foreground: "oklch(0.25 0.02 60)", muted: "oklch(0.49 0.03 65)", border: "oklch(0.3 0.05 60 / 0.12)", live: "oklch(0.52 0.2 262)" },
  },
  {
    id: "mist", label: "Mist", scheme: "light", description: "Cool grey-blue paper, slate ink",
    preview: { background: "oklch(0.962 0.012 240)", sidebar: "oklch(0.925 0.016 240)", card: "oklch(0.985 0.007 240)", foreground: "oklch(0.27 0.03 250)", muted: "oklch(0.47 0.035 250)", border: "oklch(0.3 0.06 250 / 0.13)", live: "oklch(0.5 0.16 250)" },
  },
  {
    id: "black", label: "Black", scheme: "dark", description: "Pitch black, OLED-friendly",
    preview: { background: "oklch(0.1 0 0)", sidebar: "oklch(0.16 0 0)", card: "oklch(0.15 0 0)", foreground: "oklch(0.95 0 0)", muted: "oklch(0.71 0 0)", border: "oklch(1 0 0 / 0.1)", live: "oklch(0.74 0.15 262)" },
  },
  {
    id: "graphite", label: "Graphite", scheme: "dark", description: "Charcoal, the classic dark",
    preview: { background: "oklch(0.175 0.005 286)", sidebar: "oklch(0.125 0.005 286)", card: "oklch(0.215 0.005 286)", foreground: "oklch(0.95 0.002 286)", muted: "oklch(0.7 0.012 286)", border: "oklch(1 0 0 / 0.12)", live: "oklch(0.74 0.15 262)" },
  },
  {
    id: "midnight", label: "Midnight", scheme: "dark", description: "Deep navy, indigo light",
    preview: { background: "oklch(0.17 0.03 262)", sidebar: "oklch(0.125 0.028 262)", card: "oklch(0.215 0.032 268)", foreground: "oklch(0.95 0.008 262)", muted: "oklch(0.73 0.03 262)", border: "oklch(0.78 0.1 262 / 0.16)", live: "oklch(0.76 0.15 262)" },
  },
  {
    id: "nord", label: "Nord", scheme: "dark", description: "Polar grey-blue, frost light",
    preview: { background: "oklch(0.225 0.02 245)", sidebar: "oklch(0.18 0.018 245)", card: "oklch(0.265 0.022 245)", foreground: "oklch(0.94 0.008 240)", muted: "oklch(0.74 0.02 240)", border: "oklch(0.85 0.05 240 / 0.14)", live: "oklch(0.8 0.09 215)" },
  },
  {
    id: "forest", label: "Forest", scheme: "dark", description: "Deep green, moss cards, mint light",
    preview: { background: "oklch(0.185 0.025 155)", sidebar: "oklch(0.14 0.022 155)", card: "oklch(0.23 0.03 152)", foreground: "oklch(0.95 0.01 150)", muted: "oklch(0.73 0.035 150)", border: "oklch(0.8 0.08 155 / 0.15)", live: "oklch(0.82 0.13 172)" },
  },
  {
    id: "dusk", label: "Dusk", scheme: "dark", description: "Warm plum, rose-gold light",
    preview: { background: "oklch(0.185 0.03 340)", sidebar: "oklch(0.14 0.028 340)", card: "oklch(0.23 0.033 345)", foreground: "oklch(0.95 0.01 340)", muted: "oklch(0.74 0.03 340)", border: "oklch(0.85 0.08 340 / 0.15)", live: "oklch(0.8 0.1 20)" },
  },
];

const DEFAULT: Record<Scheme, ThemeId> = { light: "light", dark: "black" };
const KEY = "asb-theme";
const LEGACY_KEY = "asb-dark";
const lastKey = (s: Scheme) => `${KEY}-${s}`;
const listeners = new Set<() => void>();

const byId = new Map(THEMES.map((t) => [t.id, t]));
export const isThemeId = (v: unknown): v is ThemeId => typeof v === "string" && byId.has(v as ThemeId);
export const themeOf = (id: ThemeId): Theme => byId.get(id)!;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** The stored theme, else the legacy boolean mapped onto a default, else the OS preference. */
export function readTheme(): ThemeId {
  const stored = read(KEY);
  if (isThemeId(stored)) return stored;
  const legacy = read(LEGACY_KEY);
  if (legacy !== null) return legacy === "true" || legacy === "1" ? DEFAULT.dark : DEFAULT.light;
  const osDark = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  return osDark ? DEFAULT.dark : DEFAULT.light;
}

/** The last theme the user chose in `scheme`, else that scheme's default. */
export function lastTheme(scheme: Scheme): ThemeId {
  const v = read(lastKey(scheme));
  return isThemeId(v) && themeOf(v).scheme === scheme ? v : DEFAULT[scheme];
}

/**
 * DOM only: `data-theme` and the `dark` class. No transition, a theme switch is not a moment. The
 * theme panel calls this alone to preview a theme under the pointer, then again with `readTheme()`
 * to put the chosen one back; nothing is stored until `setTheme`.
 */
export function applyTheme(id: ThemeId) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = id;
  root.classList.toggle("dark", themeOf(id).scheme === "dark");
}

export function setTheme(id: ThemeId) {
  try {
    // The theme being left is its scheme's "last", so a migrated or seeded choice counts too.
    const leaving = readTheme();
    localStorage.setItem(lastKey(themeOf(leaving).scheme), leaving);
    localStorage.setItem(KEY, id);
    localStorage.setItem(lastKey(themeOf(id).scheme), id);
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* storage unavailable: the choice still applies for this page */
  }
  applyTheme(id);
  for (const l of listeners) l();
}

/** The quick toggle: flip to the other scheme, landing on the theme the user last used there. */
export function toggleScheme() {
  const current = themeOf(readTheme());
  setTheme(lastTheme(current.scheme === "dark" ? "light" : "dark"));
}

/** Call once before the first render; also follows a change made in another tab. */
export function initTheme() {
  applyTheme(readTheme());
  window.addEventListener("storage", (e) => {
    if (e.key === KEY || e.key === LEGACY_KEY) {
      applyTheme(readTheme());
      for (const l of listeners) l();
    }
  });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useTheme(): Theme {
  const id = React.useSyncExternalStore(subscribe, readTheme, () => DEFAULT.light);
  return themeOf(id);
}
