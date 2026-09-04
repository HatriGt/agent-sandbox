import type { BoxView, FleetLifecycle, RunState } from "./api";

/**
 * Lifecycle math for a machine, from facts the controller actually knows:
 *
 *   · `uptime` (msb metrics) against the configured `--max-duration`  → the hard deadline;
 *   · `lastOutputAt` (agent log mtime) against `--idle-timeout`        → the idle-stop estimate.
 *
 * The idle figure is an ESTIMATE and is labelled as such in the UI: msb decides idleness by its own
 * activity accounting, and the agent's log is only a proxy for it. The max-duration figure is exact.
 */

/** "43m18s" / "1h02m03s" / "2d1h" → seconds. */
export function parseUptimeSec(raw: string | undefined): number | undefined {
  const s = (raw ?? "").trim().toLowerCase().replace(/^ran\s+/, "");
  if (!s) return undefined;
  const re = /(\d+(?:\.\d+)?)\s*(d|h|m|s)/g;
  let total = 0;
  let matched = false;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    matched = true;
    const n = Number(m[1]);
    total += m[2] === "d" ? n * 86400 : m[2] === "h" ? n * 3600 : m[2] === "m" ? n * 60 : n;
  }
  return matched ? Math.round(total) : undefined;
}

/**
 * The box's current memory cap as a tier string ("1G"/"2G"/"4G").
 *
 * There is no dedicated field for it: `mem` comes from the MEM column of `msb metrics` as
 * "1009.6 MiB / 1.0 GiB", and the denominator IS the cap. A sleeping box has no metrics at all, so
 * fall back to the deployment default. This is the one brittle piece of the resize feature — it
 * parses a CLI table — hence the tests.
 */
export function currentMemoryTier(mem: string | undefined, fallback?: string): string | undefined {
  const denom = (mem ?? "").split("/")[1]?.trim();
  const m = /^(\d+(?:\.\d+)?)\s*(gib|gb|g|mib|mb|m)$/i.exec(denom ?? "");
  if (!m) return fallback;
  const n = Number(m[1]);
  const gb = /^m/i.test(m[2]) ? n / 1024 : n;
  // Round to the nearest whole gibibyte: msb reports 1.0/2.0/4.0 GiB, but a MiB-denominated
  // reading (1024 MiB) must land on the same tier label the menu offers.
  const whole = Math.round(gb);
  return whole >= 1 ? `${whole}G` : fallback;
}

/** Compact human duration: 42s · 4m · 1h 12m · 2d 3h. */
export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return rm ? `${h}h ${rm}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}

/** The dashboard's display state: the agent's run state, or "sleeping" for an idle-stopped microVM. */
export type DisplayState = RunState | "sleeping";

export function displayState(b: Pick<BoxView, "boxStatus" | "runState">): DisplayState {
  return /^stopped$/i.test(b.boxStatus) ? "sleeping" : b.runState;
}

export interface Deadline {
  /** Seconds left before the machine is stopped, or undefined when unknowable. */
  remainingSec?: number;
  /** 0..1 of the window already consumed, for a progress track. */
  fraction?: number;
  /** Which limit produces the deadline. */
  kind: "max-duration" | "idle" | "sleep" | "none";
  /** Seconds since the agent's last output, when known. */
  quietForSec?: number;
}

/**
 * What ends this machine first, right now. A live run is bounded by max-duration; a finished or
 * waiting run is bounded by whichever of idle-stop (estimated) and max-duration comes sooner.
 */
export function deadlineOf(b: BoxView, lc: FleetLifecycle, nowMs = Date.now()): Deadline {
  if (/^stopped$/i.test(b.boxStatus)) {
    // Asleep: destroyed when the sleep TTL runs out, unless kept.
    if (b.kept || b.asleepSec == null || !lc.sleepTtlSec) return { kind: "none" };
    return { kind: "sleep", remainingSec: Math.max(0, lc.sleepTtlSec - b.asleepSec), fraction: Math.min(1, b.asleepSec / lc.sleepTtlSec) };
  }
  const up = parseUptimeSec(b.uptime);
  const cands: Deadline[] = [];
  if (up != null && lc.maxDurationSec) {
    cands.push({ kind: "max-duration", remainingSec: Math.max(0, lc.maxDurationSec - up), fraction: Math.min(1, up / lc.maxDurationSec) });
  }
  const quiet = b.lastOutputAt ? Math.max(0, Math.round(nowMs / 1000 - b.lastOutputAt)) : undefined;
  const idleLimit = b.role === "pool-free" ? lc.poolIdleTimeoutSec : lc.idleTimeoutSec;
  if (b.runState !== "running" && quiet != null && idleLimit) {
    cands.push({ kind: "idle", remainingSec: Math.max(0, idleLimit - quiet), fraction: Math.min(1, quiet / idleLimit), quietForSec: quiet });
  }
  if (!cands.length) return { kind: "none", quietForSec: quiet };
  cands.sort((a, c) => (a.remainingSec ?? Infinity) - (c.remainingSec ?? Infinity));
  return { ...cands[0], quietForSec: quiet };
}

/** One quiet sentence for the header: "1h cap · 42m left" / "stops in ~9m if it stays quiet". */
export function deadlineLabel(d: Deadline): string | null {
  if (d.kind === "none" || d.remainingSec == null) return null;
  if (d.remainingSec <= 0) return d.kind === "sleep" ? "being destroyed" : d.kind === "max-duration" ? "at the run cap — stopping" : "going to sleep any moment";
  if (d.kind === "max-duration") return `${fmtDuration(d.remainingSec)} left of the run cap`;
  if (d.kind === "sleep") return `destroyed in ${fmtDuration(d.remainingSec)} unless kept or woken`;
  return `stops in ~${fmtDuration(d.remainingSec)} if it stays quiet`;
}

/** The same fact in three words for the header context line: "sleeps in 4m" / "destroyed in 20m" / "42m left of cap". */
export function deadlineShort(d: Deadline): string | null {
  if (d.kind === "none" || d.remainingSec == null) return null;
  if (d.remainingSec <= 0) return d.kind === "sleep" ? "being destroyed" : d.kind === "max-duration" ? "at the cap" : "sleeping any moment";
  const t = fmtDuration(d.remainingSec);
  return d.kind === "max-duration" ? `${t} left of cap` : d.kind === "sleep" ? `destroyed in ${t}` : `sleeps in ${t}`;
}

/* ─────────────────────────── resource usage meters ─────────────────────────── */

/** A used/total pair in MiB, as the controller reports it. */
export interface Usage {
  usedMib: number;
  totalMib: number;
}

/**
 * Severity of a usage ratio, for the meter's fill colour.
 *
 * The thresholds are not decorative. A 1 GiB box running `mbt build` was OOM-killed while the UI
 * showed nothing at all about memory, and the user retried three times. "high" starts at 75% so the
 * meter turns amber with enough headroom left to act (raise the tier) rather than as an obituary.
 */
export type UsageLevel = "normal" | "high" | "critical";

export function usageLevel(u: Usage | undefined): UsageLevel {
  const f = usageFraction(u);
  if (f == null) return "normal";
  return f >= 0.9 ? "critical" : f >= 0.75 ? "high" : "normal";
}

/** 0..1, clamped. Undefined when there is nothing to show (a sleeping box has no live vitals). */
export function usageFraction(u: Usage | undefined): number | undefined {
  if (!u || !(u.totalMib > 0)) return undefined;
  return Math.max(0, Math.min(1, u.usedMib / u.totalMib));
}

/**
 * Compact size for a meter label: 812 MB / 4.0 GB. Sub-GiB stays in whole MB (a decimal there is
 * noise at this size), GiB gets one decimal so 1.0 and 1.4 are distinguishable.
 */
export function fmtMib(mib: number): string {
  if (!Number.isFinite(mib) || mib < 0) return "—";
  if (mib < 1024) return `${Math.round(mib)} MB`;
  const gb = mib / 1024;
  return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
}

/** "812 MB of 4.0 GB" — the meter's accessible text, and its tooltip. */
export function fmtUsage(u: Usage | undefined): string | null {
  if (!u || !(u.totalMib > 0)) return null;
  return `${fmtMib(u.usedMib)} of ${fmtMib(u.totalMib)}`;
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

/** "16G" → 16. Undefined for anything not in that shape. */
export function tierGib(tier: string | undefined): number | undefined {
  const m = /^(\d+)\s*g$/i.exec((tier ?? "").trim());
  return m ? Number(m[1]) : undefined;
}

/** The box's current disk tier, rounded up to the offered tier that contains it. */
export function currentDiskTier(disk: Usage | undefined, tiers: string[] | undefined): string | undefined {
  if (!disk || !(disk.totalMib > 0)) return undefined;
  // df reports slightly less than the nominal size (filesystem overhead: a 4 GiB disk reads 3.9G),
  // so match the smallest tier that is >= the reported total, rather than expecting equality.
  const gb = disk.totalMib / 1024;
  const sorted = (tiers ?? []).slice().sort((a, b) => (tierGib(a) ?? 0) - (tierGib(b) ?? 0));
  return sorted.find((t) => (tierGib(t) ?? 0) >= gb - 0.35) ?? sorted[sorted.length - 1];
}
