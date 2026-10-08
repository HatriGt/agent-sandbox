import type { BoxView, FleetLifecycle } from "./api";

/**
 * Lifecycle math for a machine (web/src/lib/lifecycle.ts): `uptime` against `maxDurationSec` is the
 * hard deadline; `lastOutputAt` against `idleTimeoutSec` is the idle-stop ESTIMATE.
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

/** `mm:ss` (or `h:mm:ss`) — the header's elapsed clock. */
export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export interface Deadline {
  /** Seconds left before the machine is stopped, or undefined when unknowable. */
  remainingSec?: number;
  /** 0..1 of the window already consumed. */
  fraction?: number;
  kind: "max-duration" | "idle" | "sleep" | "none";
  /** Seconds since the agent's last output, when known. */
  quietForSec?: number;
}

type LifecycleBox = Pick<BoxView, "boxStatus" | "runState" | "role" | "uptime" | "lastOutputAt" | "kept" | "asleepSec">;

/**
 * What ends this machine first, right now. A live run is bounded by max-duration; a finished or
 * waiting run by whichever of idle-stop (estimated) and max-duration comes sooner.
 */
export function deadlineOf(b: LifecycleBox, lc: FleetLifecycle, nowMs = Date.now()): Deadline {
  if (/^stopped$/i.test(b.boxStatus)) {
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

/** One quiet sentence: "42m left of the run cap" / "stops in ~9m if it stays quiet". */
export function deadlineLabel(d: Deadline): string | null {
  if (d.kind === "none" || d.remainingSec == null) return null;
  if (d.remainingSec <= 0) return d.kind === "sleep" ? "being destroyed" : d.kind === "max-duration" ? "at the run cap — stopping" : "going to sleep any moment";
  if (d.kind === "max-duration") return `${fmtDuration(d.remainingSec)} left of the run cap`;
  if (d.kind === "sleep") return `destroyed in ${fmtDuration(d.remainingSec)} unless kept or woken`;
  return `stops in ~${fmtDuration(d.remainingSec)} if it stays quiet`;
}

/** The same fact in three words for the header: "sleeps in 4m" / "destroyed in 20m" / "42m left of cap". */
export function deadlineShort(d: Deadline): string | null {
  if (d.kind === "none" || d.remainingSec == null) return null;
  if (d.remainingSec <= 0) return d.kind === "sleep" ? "being destroyed" : d.kind === "max-duration" ? "at the cap" : "sleeping any moment";
  const t = fmtDuration(d.remainingSec);
  return d.kind === "max-duration" ? `${t} left of cap` : d.kind === "sleep" ? `destroyed in ${t}` : `sleeps in ${t}`;
}
