/**
 * Structural sharing for the live thread. The log is re-parsed on every streamed chunk, and a fresh
 * parse hands back brand-new objects for every event and group — so every row of a long conversation
 * re-rendered on every 800 ms tick (a 400 KB run dropped to ~7 frames a second and the view shook).
 * These keep the PREVIOUS object wherever the content is unchanged, so memoized rows skip work and
 * only the row that actually grew renders.
 */
const sigs = new WeakMap<object, string>();
function signature(o: object): string {
  let s = sigs.get(o);
  if (s === undefined) {
    s = JSON.stringify(o);
    sigs.set(o, s);
  }
  return s;
}

/** `next` with every element equal to the one at the same index in `prev` swapped for the old object. */
export function reuseEvents<T extends object>(prev: readonly T[], next: T[]): T[] {
  let changed = prev.length !== next.length;
  const out = next.map((e, i) => {
    const p = prev[i];
    if (p !== undefined && (p === e || signature(p) === signature(e))) return p;
    changed = true;
    return e;
  });
  return changed ? out : (prev as T[]);
}

/** Deep equality that short-circuits on identity (cheap once the leaves are shared). */
export function sameShape(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameShape(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (!sameShape((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  return true;
}

/** Like reuseEvents, for derived groups (whose leaves are already shared events). */
export function reuseGroups<T extends object>(prev: readonly T[], next: T[]): T[] {
  let changed = prev.length !== next.length;
  const out = next.map((g, i) => {
    const p = prev[i];
    if (p !== undefined && sameShape(p, g)) return p;
    changed = true;
    return g;
  });
  return changed ? out : (prev as T[]);
}
