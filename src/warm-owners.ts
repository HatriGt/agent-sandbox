/**
 * Who a warm box is kept for.
 *
 * A warm box used to be prepared with the OPERATOR's MCP servers and then handed to whoever asked
 * first. Two things were wrong with that: another person's box carried packages (and, for omp, a
 * warm-up run) that were never theirs, and everyone but the operator still paid their own install
 * at claim time. A warm box now belongs to ONE owner, is prepared with that owner's own set, and
 * only that owner can claim it. The operator is an owner like any other.
 *
 * Which owners get one is decided here from when each was last seen (the dashboard polling, or a
 * task starting). The list is short and capped, because every warm box is a VM holding real RAM.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Config } from "./config.js";

/** The owner marker a box carries (`/.owner`): a tag, never the account id itself. */
export function ownerTag(owner: string): string {
  return createHash("sha256").update(`warm-owner:${owner}`).digest("hex").slice(0, 16);
}

/** What `/.owner` holds in a box prepared for nobody: bootstrapped, with no one's servers or skills. */
export const BLANK_OWNER = "blank";

/** How long the single most recent owner keeps a box with nobody around (it replaces the blank one). */
export const LAST_OWNER_KEEP_MS = 7 * 24 * 3600_000;

/**
 * The owners to keep a warm box for, most recent first. Everyone seen inside `windowMs`, up to
 * `max`; when nobody is, the one most recent owner (within a week) keeps theirs, so a deployment
 * with one person always has that person's box and not a blank one. Pure.
 */
export function pickWarmOwners(seen: ReadonlyMap<string, number>, nowMs: number, windowMs: number, max: number): string[] {
  if (max <= 0) return [];
  const byRecency = [...seen.entries()].sort((a, b) => b[1] - a[1]);
  const recent = byRecency.filter(([, at]) => nowMs - at <= windowMs).slice(0, max).map(([o]) => o);
  if (recent.length) return recent;
  const last = byRecency[0];
  return last && nowMs - last[1] <= LAST_OWNER_KEEP_MS ? [last[0]] : [];
}

const seen = new Map<string, number>();
let loadedFrom: string | null = null;
let lastWrite = 0;

function fileOf(cfg: Config): string {
  return path.join(cfg.dataDir, "warm-owners.json");
}

/** Last-seen times survive a restart: a deploy must not forget whose box to keep. */
function load(cfg: Config): void {
  if (!cfg.dataDir) return;
  const file = fileOf(cfg);
  if (loadedFrom === file) return;
  loadedFrom = file;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    for (const [o, at] of Object.entries(raw)) if (typeof at === "number" && !seen.has(o)) seen.set(o, at);
  } catch {
    /* no file yet, or unreadable: start empty */
  }
}

function persist(cfg: Config, nowMs: number): void {
  if (!cfg.dataDir || nowMs - lastWrite < 60_000) return;
  lastWrite = nowMs;
  try {
    // Owners not seen for a month are dropped, so the file cannot grow without bound.
    for (const [o, at] of seen) if (nowMs - at > 30 * 24 * 3600_000) seen.delete(o);
    fs.mkdirSync(cfg.dataDir, { recursive: true });
    fs.writeFileSync(fileOf(cfg), JSON.stringify(Object.fromEntries(seen)), { mode: 0o600 });
  } catch {
    /* best-effort: the in-memory map still serves this process */
  }
}

/**
 * Record that an owner is around. Returns true when this changes who the pool should be warm for
 * (the owner was not on the list before), so the caller can kick a refill right away.
 */
export function noteOwnerActive(cfg: Config, owner: string, nowMs = Date.now()): boolean {
  load(cfg);
  const before = pickWarmOwners(seen, nowMs, cfg.poolOwnerWindowMs, cfg.poolOwners);
  seen.set(owner, nowMs);
  persist(cfg, nowMs);
  return !before.includes(owner) && pickWarmOwners(seen, nowMs, cfg.poolOwnerWindowMs, cfg.poolOwners).includes(owner);
}

/**
 * The agent each owner last started a task with, in this process. A person who picks omp for a
 * task in the composer while their default is Claude Code used to get a cold box every time,
 * because the warm one was only ever kept in the default's flavor. Not persisted: after a restart
 * the default decides again until the next task.
 */
const lastAgent = new Map<string, "claude" | "omp">();

/** Record the agent an owner just started. True when it differs from what was recorded before. */
export function noteOwnerAgent(owner: string, agent: "claude" | "omp"): boolean {
  const before = lastAgent.get(owner);
  lastAgent.set(owner, agent);
  return before !== agent;
}

/** The agent an owner last started here, if any. */
export function lastOwnerAgent(owner: string): "claude" | "omp" | undefined {
  return lastAgent.get(owner);
}

/** A saved default is the newer word: it replaces what the last task said. */
export function forgetOwnerAgent(owner: string): void {
  lastAgent.delete(owner);
}

/** The owners the pool should hold a box for right now. */
export function activeWarmOwners(cfg: Config, nowMs = Date.now()): string[] {
  load(cfg);
  return pickWarmOwners(seen, nowMs, cfg.poolOwnerWindowMs, cfg.poolOwners);
}

/** Test seam: forget everything. */
export function resetWarmOwners(): void {
  seen.clear();
  lastAgent.clear();
  loadedFrom = null;
  lastWrite = 0;
}
