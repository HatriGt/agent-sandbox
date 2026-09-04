// Deterministic adjective-animal name, identical to the web's (lib/format.ts):
// the dashboard never shows raw box ids, so mobile must hash the same way.
const NAME_ADJECTIVES = [
  "amber", "brisk", "cobalt", "dusk", "ember", "fern", "glint", "hazel", "iris", "jade",
  "lunar", "mint", "nova", "onyx", "pine", "quartz", "rust", "sage", "teal", "vapor",
  "wren", "zephyr", "clay", "frost", "opal", "slate", "coral", "drift", "flint", "moss",
];
const NAME_NOUNS = [
  "otter", "falcon", "cedar", "harbor", "lark", "maple", "quokka", "raven", "sparrow", "tundra",
  "willow", "badger", "comet", "delta", "eagle", "finch", "grove", "heron", "ibis", "koi",
  "lynx", "marsh", "newt", "orbit", "puffin", "reef", "swift", "thorn", "vale", "yak",
];

function hashName(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function friendlyName(name: string): string {
  const h = hashName(name);
  return `${NAME_ADJECTIVES[h % NAME_ADJECTIVES.length]}-${NAME_NOUNS[(h >>> 8) % NAME_NOUNS.length]}`;
}

export function ago(ts?: number | null): string {
  if (!ts) return "";
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function durationWords(sec?: number | null): string {
  if (sec == null) return "";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function greeting(name?: string): string {
  const h = new Date().getHours();
  const part = h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return name ? `${part}, ${name.split(" ")[0]}.` : `${part}.`;
}

// boxStatus casing varies by endpoint (fleet says "Stopped", watch says
// "stopped", live boxes are "running") — compare case-insensitively, like the web.
export function isUp(boxStatus?: string): boolean {
  return /^running$/i.test(boxStatus ?? "");
}

export function isSleeping(boxStatus?: string): boolean {
  return /^stopped$/i.test(boxStatus ?? "");
}

export function fleetSentence(boxes: { runState: string; boxStatus: string }[]): string {
  const waiting = boxes.filter((b) => b.runState === "waiting").length;
  const running = boxes.filter((b) => b.runState === "running" && isUp(b.boxStatus)).length;
  const sleeping = boxes.filter((b) => isSleeping(b.boxStatus)).length;
  const parts: string[] = [];
  if (running) parts.push(`${plural(running, "machine")} working`);
  if (waiting) parts.push(`${waiting} waiting on you`);
  if (sleeping) parts.push(`${sleeping} sleeping`);
  if (!parts.length) return "The fleet is quiet.";
  return parts.join(", ") + ".";
}

/* ─────────────────────── resource usage (mirrors web/src/lib/lifecycle.ts) ─────────────────────── */

/** A used/total pair in MiB, as the controller reports it. */
export interface Usage {
  usedMib: number;
  totalMib: number;
}

export type UsageLevel = "normal" | "high" | "critical";

/** 0..1, clamped. Undefined when there is nothing live to show (a sleeping box has no vitals). */
export function usageFraction(u: Usage | undefined): number | undefined {
  if (!u || !(u.totalMib > 0)) return undefined;
  return Math.max(0, Math.min(1, u.usedMib / u.totalMib));
}

/**
 * "high" starts at 75% so the meter turns amber with enough headroom left to act (raise the tier)
 * rather than as an obituary — a 1G box was OOM-killed three times with the UI saying nothing.
 */
export function usageLevel(u: Usage | undefined): UsageLevel {
  const f = usageFraction(u);
  if (f == null) return "normal";
  return f >= 0.9 ? "critical" : f >= 0.75 ? "high" : "normal";
}

/** Compact size for a meter label: 812 MB / 4.0 GB. */
export function fmtMib(mib: number): string {
  if (!Number.isFinite(mib) || mib < 0) return "—";
  if (mib < 1024) return `${Math.round(mib)} MB`;
  const gb = mib / 1024;
  return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
}

/** "812 MB of 4.0 GB" — the meter's accessible text. */
export function fmtUsage(u: Usage | undefined): string | null {
  if (!u || !(u.totalMib > 0)) return null;
  return `${fmtMib(u.usedMib)} of ${fmtMib(u.totalMib)}`;
}

/** "16G" → 16. Undefined for anything not in that shape. */
export function tierGib(tier: string | undefined): number | undefined {
  const m = /^(\d+)\s*g$/i.exec((tier ?? "").trim());
  return m ? Number(m[1]) : undefined;
}

/**
 * The tiers a box may actually be moved to. Disk is GROW-ONLY in this runtime, so offering a smaller
 * size would produce a failure the user cannot understand; memory resizes in both directions.
 */
export function offerableTiers(tiers: string[] | undefined, currentTier: string | undefined, growOnly: boolean): string[] {
  const all = tiers ?? [];
  if (!growOnly || !currentTier) return all;
  const cur = tierGib(currentTier);
  if (cur == null) return all;
  return all.filter((t) => {
    const g = tierGib(t);
    return g == null || g >= cur;
  });
}

/** The box's current disk tier, rounded up to the offered tier that contains it. */
export function currentDiskTier(disk: Usage | undefined, tiers: string[] | undefined): string | undefined {
  if (!disk || !(disk.totalMib > 0)) return undefined;
  // df reports slightly less than the nominal size (a 4 GiB disk reads 3.9G), so match the smallest
  // tier at or above the reported total rather than expecting equality.
  const gb = disk.totalMib / 1024;
  const sorted = (tiers ?? []).slice().sort((a, b) => (tierGib(a) ?? 0) - (tierGib(b) ?? 0));
  return sorted.find((t) => (tierGib(t) ?? 0) >= gb - 0.35) ?? sorted[sorted.length - 1];
}
