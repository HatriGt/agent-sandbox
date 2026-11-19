/**
 * Claim markers — the controller's memory of which pool boxes carry a run, kept on the VPS host.
 *
 * Why: a warm box is claimed by touching `/.claimed` INSIDE it. Once it idle-stops, nothing can exec
 * into it to read that file, so the pool maintainer saw a Stopped `pool-*` box, called it dead, and
 * force-removed it — destroying a sleeping run the operator had been promised would wake on reply.
 * The marker lives OUTSIDE the box (`~/.agent-sandbox/claims/<box>`), so a stopped box's status as a
 * run is still knowable, and its mtime is the sleep clock: a claimed box asleep longer than
 * `MSB_SLEEP_TTL` is finally reaped (docs/lifecycle.md).
 */
import { assertBoxName } from "./sync.js";
import type { Config } from "./config.js";
import { run, shellQuote } from "./exec.js";
import { sshMuxOpts } from "./ssh.js";

const DIR = '"$HOME/.agent-sandbox/claims"';

async function ssh(cfg: Config, cmd: string): Promise<string> {
  // Bounded: these are tiny host-side file reads on the fleet read's critical path, so a stalled
  // connection must degrade to "no claims known" rather than hang the sweep. Callers already
  // .catch() into an empty set/map.
  const r = await run("ssh", [...sshMuxOpts(cfg), cfg.vpsSsh, cmd], { check: false, timeoutMs: 15_000 });
  return r.stdout ?? "";
}

/** Record that `box` carries a run (idempotent; refreshes nothing — the claim time is the first touch). */
export async function markClaimed(cfg: Config, box: string): Promise<void> {
  assertBoxName(box);
  await ssh(cfg, `mkdir -p ${DIR} && chmod 700 ${DIR} && [ -e ${DIR}/${shellQuote(box)} ] || : > ${DIR}/${shellQuote(box)}`);
}

/** Re-stamp the claim: called when a box is seen going Running → Stopped, so `asleepSec` and the sleep TTL count from the nap, not the claim. */
export async function touchClaimed(cfg: Config, box: string): Promise<void> {
  assertBoxName(box);
  await ssh(cfg, `mkdir -p ${DIR} && touch ${DIR}/${shellQuote(box)}`);
}

export async function unmarkClaimed(cfg: Config, box: string): Promise<void> {
  assertBoxName(box);
  await ssh(cfg, `rm -f ${DIR}/${shellQuote(box)}`);
}

/** Every claimed box with the age of its claim in seconds. */
export async function listClaims(cfg: Config, now = Math.floor(Date.now() / 1000)): Promise<Map<string, number>> {
  const out = await ssh(cfg, `[ -d ${DIR} ] && cd ${DIR} && for f in *; do [ -f "$f" ] && printf '%s %s\\n' "$f" "$(stat -c %Y "$f")"; done || true`);
  return parseClaims(out, now);
}

export function parseClaims(stdout: string, now: number): Map<string, number> {
  const m = new Map<string, number>();
  for (const line of stdout.split("\n")) {
    const [name, mtime] = line.trim().split(/\s+/);
    if (!name || name === "*" || !mtime) continue;
    const t = Number(mtime);
    if (Number.isFinite(t)) m.set(name, Math.max(0, now - t));
  }
  return m;
}

/* ───────────── keep (pin) markers: a run the operator wants held until they destroy it ───────────── */
const KEEP_DIR = '"$HOME/.agent-sandbox/keep"';

export async function markKept(cfg: Config, box: string): Promise<void> {
  assertBoxName(box);
  await ssh(cfg, `mkdir -p ${KEEP_DIR} && chmod 700 ${KEEP_DIR} && : > ${KEEP_DIR}/${shellQuote(box)}`);
}
export async function unmarkKept(cfg: Config, box: string): Promise<void> {
  assertBoxName(box);
  await ssh(cfg, `rm -f ${KEEP_DIR}/${shellQuote(box)}`);
}
export async function listKept(cfg: Config): Promise<Set<string>> {
  const out = await ssh(cfg, `[ -d ${KEEP_DIR} ] && ls -1 ${KEEP_DIR} 2>/dev/null || true`);
  return parseKept(out);
}

/**
 * The keep markers, or a throw when the host did not answer (SSH gated for a paused VM, a timeout, a
 * refused connection). The removal guard (msb.ts removalRefusal) uses this one: an empty answer from
 * an SSH that never ran must read as "could not be read", never as "nothing is kept".
 */
export async function listKeptStrict(cfg: Config): Promise<Set<string>> {
  const r = await run("ssh", [...sshMuxOpts(cfg), cfg.vpsSsh, `[ -d ${KEEP_DIR} ] && ls -1 ${KEEP_DIR} 2>/dev/null || true`], { check: false, timeoutMs: 15_000 });
  if (r.code !== 0) throw new Error(`keep markers of ${cfg.hostId ?? cfg.vpsSsh} could not be read (ssh exit ${r.code})`);
  return parseKept(r.stdout ?? "");
}

function parseKept(out: string): Set<string> {
  return new Set(out.split("\n").map((l) => l.trim()).filter((l) => l && l !== "*"));
}

/**
 * May a box be removed, given the host's keep markers? A kept box is NEVER removed by an automatic
 * path, and markers that could not be read mean "kept" (nobody can prove it is not). Only a
 * deliberate Destroy that says `force` (the thread's own dialog, which names the keep) proceeds
 * regardless. Pure, so the guarantee is testable.
 */
export function removalVerdict(kept: ReadonlySet<string> | null, box: string, force = false): "proceed" | "refuse-kept" | "refuse-unknown" {
  if (force) return "proceed";
  if (!kept) return "refuse-unknown";
  return kept.has(box) ? "refuse-kept" : "proceed";
}

/* ── parked markers: a box stopped BY THE CONTROLLER because it is waiting on a question ──
 * The reaper cannot ask a stopped box whether a question is pending (exec would boot it), so the
 * park sweep records the fact host-side, like claims. A parked box costs disk only and is held to
 * the much longer ASK_PARK_TTL; answering (resume → start) or teardown clears the marker. */
const PARK_DIR = '"$HOME/.agent-sandbox/parked"';

export async function markParked(cfg: Config, box: string): Promise<void> {
  assertBoxName(box);
  await ssh(cfg, `mkdir -p ${PARK_DIR} && chmod 700 ${PARK_DIR} && : > ${PARK_DIR}/${shellQuote(box)}`);
}
export async function unmarkParked(cfg: Config, box: string): Promise<void> {
  assertBoxName(box);
  await ssh(cfg, `rm -f ${PARK_DIR}/${shellQuote(box)}`);
}
export async function listParked(cfg: Config): Promise<Set<string>> {
  const out = await ssh(cfg, `[ -d ${PARK_DIR} ] && ls -1 ${PARK_DIR} 2>/dev/null || true`);
  return new Set(out.split("\n").map((l) => l.trim()).filter((l) => l && l !== "*"));
}

/**
 * The reaping decision for a NON-running pool box: keep it if it is a claimed run that has been
 * asleep for less than the sleep TTL; otherwise it is dead capacity (or an abandoned run) and goes.
 */
export function shouldKeepStopped(claimAgeSec: number | undefined, sleepTtlSec: number, kept = false): boolean {
  if (kept) return true;
  return claimAgeSec !== undefined && claimAgeSec < sleepTtlSec;
}

/**
 * The reaping decision for ANY non-running box, pool or session (a delegate box). Pure.
 *   - kept: "keep", held until the operator destroys it;
 *   - asleep for less than its TTL (the park TTL for a parked box): "keep";
 *   - no sleep clock yet: a pool box nobody claimed is dead capacity, "reap"; a session box is
 *     launched without a claim marker, so its clock "start"s now and it is judged on a later sweep.
 *     A box that fell asleep while the controller was down or its host was paused gets the full TTL
 *     from the moment it is first seen asleep, never the axe on sight;
 *   - past the TTL: "reap". Until 2026-11-19 only pool boxes were judged at all, and a sleeping
 *     delegate box stayed on its host for days.
 */
export function stoppedBoxVerdict(o: { pool: boolean; kept: boolean; ageSec: number | undefined; ttlSec: number }): "keep" | "start" | "reap" {
  if (o.kept) return "keep";
  if (o.ageSec === undefined) return o.pool ? "reap" : "start";
  return o.ageSec < o.ttlSec ? "keep" : "reap";
}
