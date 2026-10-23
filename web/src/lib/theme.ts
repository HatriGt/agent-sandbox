import * as React from "react";

/**
 * Console themes. One registry row per theme; the id lands on `<html data-theme>` and the scheme
 * drives the `dark` class, which every `.dark` selector (syntax tokens, raised, code blocks, Mermaid)
 * keys off. Token values live in `index.css` (`:root[data-theme="…"]` blocks). `preview` repeats the
 * three tones the picker swatches show; `.shots/r7-themes.mjs` asserts the page background matches
 * it, so the two cannot drift silently.
 *
 * Storage: `asb-theme` holds the choice, `asb-theme-light` / `asb-theme-dark` the last choice per
 * scheme so the light/dark toggle returns to the theme the user had, not to a default. The legacy
 * `asb-dark` key (true → Black, false → Light) is read once and then superseded.
 */
export type ThemeId = "light" | "black" | "graphite" | "midnight" | "linen";
export type Scheme = "light" | "dark";
export interface Theme {
  id: ThemeId;
  label: string;
  scheme: Scheme;
  description: string;
  preview: { background: string; sidebar: string; live: string };
}

export const THEMES: readonly Theme[] = [
  { id: "light", label: "Light", scheme: "light", description: "White paper, zinc ink", preview: { background: "oklch(0.992 0.001 286)", sidebar: "oklch(0.962 0.003 286)", live: "oklch(0.52 0.2 262)" } },
  { id: "linen", label: "Linen", scheme: "light", description: "Warm paper, warm ink", preview: { background: "oklch(0.975 0.009 80)", sidebar: "oklch(0.945 0.012 80)", live: "oklch(0.52 0.2 262)" } },
  { id: "black", label: "Black", scheme: "dark", description: "Pitch black, OLED-friendly", preview: { background: "oklch(0.1 0 0)", sidebar: "oklch(0.16 0 0)", live: "oklch(0.74 0.15 262)" } },
  { id: "graphite", label: "Graphite", scheme: "dark", description: "Charcoal, the classic dark", preview: { background: "oklch(0.175 0.005 286)", sidebar: "oklch(0.125 0.005 286)", live: "oklch(0.74 0.15 262)" } },
  { id: "midnight", label: "Midnight", scheme: "dark", description: "Deep navy, indigo light", preview: { background: "oklch(0.17 0.03 262)", sidebar: "oklch(0.125 0.028 262)", live: "oklch(0.76 0.15 262)" } },
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

/** DOM only: `data-theme` and the `dark` class. No transition, a theme switch is not a moment. */
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
