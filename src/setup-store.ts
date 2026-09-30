/**
 * Rows for repo setup profiles (src/setup-profile.ts), keyed owner × lowercase "owner/name".
 * Every write goes through sanitizeProfile, so a stored row can never carry a secret value.
 */
import type { Db } from "./db.js";
import { mergeProfile, sanitizeProfile, type SetupConfirmedBy, type SetupProfile } from "./setup-profile.js";

export const repoKey = (repo: string): string => repo.trim().replace(/\.git$/i, "").toLowerCase();

/** "owner/name" from a git remote URL (https or ssh), or undefined. */
export function repoSlugFromUrl(url: string): string | undefined {
  const m = url.trim().match(/github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  return m ? repoKey(`${m[1]}/${m[2]}`) : undefined;
}

export function getSetup(db: Db, owner: string, repo: string): SetupProfile | undefined {
  const row = db.prepare(`SELECT profile_json FROM repo_setup WHERE owner = ? AND repo = ?`).get(owner, repoKey(repo)) as { profile_json: string } | undefined;
  if (!row) return undefined;
  try {
    const j = JSON.parse(row.profile_json) as SetupProfile;
    return sanitizeProfile(j, j.confirmedBy ?? "detected");
  } catch {
    return undefined;
  }
}

export function listSetups(db: Db, owner: string): Array<{ repo: string; profile: SetupProfile; updatedAt: number }> {
  const rows = db.prepare(`SELECT repo, profile_json, updated_at FROM repo_setup WHERE owner = ? ORDER BY repo`).all(owner) as Array<{ repo: string; profile_json: string; updated_at: number }>;
  const out: Array<{ repo: string; profile: SetupProfile; updatedAt: number }> = [];
  for (const r of rows) {
    try {
      const j = JSON.parse(r.profile_json) as SetupProfile;
      out.push({ repo: r.repo, profile: sanitizeProfile(j, j.confirmedBy ?? "detected"), updatedAt: Number(r.updated_at) });
    } catch {
      /* a corrupt row is skipped, never served */
    }
  }
  return out;
}

export function saveSetup(db: Db, owner: string, repo: string, input: unknown, by: SetupConfirmedBy, now = Date.now()): SetupProfile {
  const p = sanitizeProfile(input, by, now);
  db.prepare(
    `INSERT INTO repo_setup (owner, repo, profile_json, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(owner, repo) DO UPDATE SET profile_json = excluded.profile_json, updated_at = excluded.updated_at`
  ).run(owner, repoKey(repo), JSON.stringify(p), now);
  return p;
}

export function deleteSetup(db: Db, owner: string, repo: string): boolean {
  return db.prepare(`DELETE FROM repo_setup WHERE owner = ? AND repo = ?`).run(owner, repoKey(repo)).changes > 0;
}

/**
 * Record what a run learned. Rules: a user-edited profile is never overwritten by a run; the
 * agent's sentinel refines whatever is stored (or the fresh detection); a detection only fills a
 * repo that has nothing yet. Returns what was saved, or undefined when nothing changed.
 */
export function recordLearned(
  db: Db,
  owner: string,
  repo: string,
  learned: { agent?: SetupProfile; detected?: SetupProfile | null },
  now = Date.now()
): SetupProfile | undefined {
  const existing = getSetup(db, owner, repo);
  if (existing?.confirmedBy === "user") return undefined;
  if (learned.agent) return saveSetup(db, owner, repo, mergeProfile(existing ?? learned.detected ?? undefined, learned.agent), "agent", now);
  if (!existing && learned.detected) return saveSetup(db, owner, repo, learned.detected, "detected", now);
  return undefined;
}
