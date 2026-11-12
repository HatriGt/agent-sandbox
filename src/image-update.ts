/**
 * Updating the claude image from the dashboard. The "image is behind" notice used to end in an
 * instruction ("rebake the image") that nobody reading it could follow: the bake is a command on
 * the host, the switch is a line in `.env`, and the Claude Code version is pinned in config, so
 * even the documented command rebuilt the SAME version. This is the missing other half:
 *
 *   plan    — exactly the versions the notice names, everything else held where it is;
 *   bake    — a new image tag with those versions;
 *   switch  — new sandboxes boot from it (an override file under DATA_DIR, no `.env` edit, no
 *             restart), running ones are not touched;
 *   verify  — the canary task; if it fails the previous image and version come back.
 *
 * The override applies only while the operator's own settings are the ones it was made on top of:
 * edit MSB_CLAUDE_IMAGE or CLAUDE_CODE_VERSION by hand afterwards and the hand edit wins.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Outdated } from "./package-watch.js";

export const CLAUDE_CODE_PACKAGE = "@anthropic-ai/claude-code";
/** In the baked manifest but not ours to pin: they come with the base image's node. */
const BASE_PACKAGES = new Set(["npm", "corepack"]);

export interface ImagePlan {
  /** The Claude Code version the new image carries. */
  claudeCodeVersion: string;
  /** Every other baked package, pinned: the due ones to their latest, the rest to what is baked. */
  pins: string[];
  /** What changes, for the record and the UI. */
  changes: Outdated[];
}

/**
 * The new image differs from the current one in the packages the notice named and nothing else.
 * An unpinned bake would also take that day's latest of every OTHER package — the drift the pins
 * exist to prevent (2026-10-26: one server's new release pulled in a runtime that no longer fit).
 */
export function planImageUpdate(baked: Readonly<Record<string, string>>, due: readonly Outdated[], currentClaudeCode: string): ImagePlan {
  const latest = new Map(due.map((o) => [o.name, o.latest]));
  const pins: string[] = [];
  for (const [name, version] of Object.entries(baked)) {
    if (BASE_PACKAGES.has(name) || name === CLAUDE_CODE_PACKAGE) continue;
    pins.push(`${name}@${latest.get(name) ?? version}`);
  }
  return {
    claudeCodeVersion: latest.get(CLAUDE_CODE_PACKAGE) ?? currentClaudeCode,
    pins: pins.sort(),
    changes: due.filter((o) => !BASE_PACKAGES.has(o.name)),
  };
}

export interface ImageOverride {
  claudeImage: string;
  claudeCodeVersion: string;
  /** The operator's settings this override was made on top of; a later hand edit retires it. */
  base: { claudeImage: string; claudeCodeVersion: string };
  at: number;
}

const FILE = "image-override.json";

export function readImageOverride(dataDir: string): ImageOverride | null {
  try {
    const o = JSON.parse(readFileSync(join(dataDir, FILE), "utf8")) as Partial<ImageOverride> | null;
    if (!o || typeof o.claudeImage !== "string" || typeof o.claudeCodeVersion !== "string") return null;
    if (!o.base || typeof o.base.claudeImage !== "string" || typeof o.base.claudeCodeVersion !== "string") return null;
    return { claudeImage: o.claudeImage, claudeCodeVersion: o.claudeCodeVersion, base: o.base, at: Number(o.at) || 0 };
  } catch {
    return null;
  }
}

export function writeImageOverride(dataDir: string, o: ImageOverride): void {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, FILE), JSON.stringify(o, null, 2));
}

export function clearImageOverride(dataDir: string): void {
  rmSync(join(dataDir, FILE), { force: true });
}

/** The image and version to run with: the override's, if it still sits on the operator's settings. */
export function resolveImage(configured: { claudeImage: string; claudeCodeVersion: string }, o: ImageOverride | null): { claudeImage: string; claudeCodeVersion: string } {
  if (!o || !o.claudeImage) return configured;
  if (o.base.claudeImage !== configured.claudeImage || o.base.claudeCodeVersion !== configured.claudeCodeVersion) return configured;
  return { claudeImage: o.claudeImage, claudeCodeVersion: o.claudeCodeVersion };
}

export type ImageUpdatePhase = "idle" | "building" | "verifying" | "done" | "rolled-back" | "failed";

export interface ImageUpdateState {
  phase: ImageUpdatePhase;
  startedAt?: number;
  finishedAt?: number;
  tag?: string;
  changes?: Outdated[];
  /** Why it failed or was rolled back, in one line. */
  detail?: string;
}

export interface ImageUpdateIO {
  now: () => number;
  /** Build `tag` with this Claude Code version and these pinned packages. */
  bake: (tag: string, claudeCodeVersion: string, pins: string[]) => Promise<void>;
  /** Point new sandboxes at this image and version (and persist it), or back at the previous one. */
  use: (image: { claudeImage: string; claudeCodeVersion: string } | null) => void;
  /** One real task through the service; ok=false when it did not finish. */
  verify: () => Promise<{ ok: boolean; detail: string }>;
  log: (m: string) => void;
}

/**
 * One update at a time. `start` returns at once; the phases are read from `state()`. A build that
 * fails changes nothing; a verification that fails puts the previous image back.
 */
export function makeImageUpdater(io: ImageUpdateIO) {
  let state: ImageUpdateState = { phase: "idle" };
  const busy = () => state.phase === "building" || state.phase === "verifying";
  const run = async (plan: ImagePlan, tag: string): Promise<void> => {
    try {
      await io.bake(tag, plan.claudeCodeVersion, plan.pins);
    } catch (e) {
      state = { ...state, phase: "failed", finishedAt: io.now(), detail: `the image did not build — ${oneLine(e)}` };
      io.log(`[image-update] build failed: ${oneLine(e)}`);
      return;
    }
    io.use({ claudeImage: tag, claudeCodeVersion: plan.claudeCodeVersion });
    state = { ...state, phase: "verifying" };
    let verdict: { ok: boolean; detail: string };
    try {
      verdict = await io.verify();
    } catch (e) {
      verdict = { ok: false, detail: oneLine(e) };
    }
    if (!verdict.ok) {
      io.use(null);
      state = { ...state, phase: "rolled-back", finishedAt: io.now(), detail: `the test task failed on the new image — ${verdict.detail}` };
      io.log(`[image-update] ${tag} rolled back: ${verdict.detail}`);
      return;
    }
    state = { ...state, phase: "done", finishedAt: io.now() };
    io.log(`[image-update] now booting ${tag} (claude ${plan.claudeCodeVersion})`);
  };
  return {
    state: (): ImageUpdateState => ({ ...state }),
    busy,
    /** Start an update. Throws when one is already running or there is nothing to change. */
    start(plan: ImagePlan): ImageUpdateState {
      if (busy()) throw new Error("an image update is already running");
      if (!plan.changes.length) throw new Error("the image is already up to date");
      const tag = `agent-claude:${new Date(io.now()).toISOString().replace(/\D/g, "").slice(0, 12)}`;
      state = { phase: "building", startedAt: io.now(), tag, changes: plan.changes };
      void run(plan, tag);
      return { ...state };
    },
  };
}

function oneLine(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.replace(/\s+/g, " ").trim().slice(0, 240);
}
