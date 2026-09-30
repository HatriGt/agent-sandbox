/**
 * Answer from the notification (docs/plan-demo-parity.md bet 1).
 *
 * A question can carry up to MAX_CHOICES short choices. They come from the agent's existing
 * question format (src/drivers/prompts.ts) — the `Options:` block — so nothing old breaks. The one
 * extension is optional and backward-compatible: an option line may split a short button label from
 * its detail with ` | `:
 *
 *     Options:
 *     - Mock the clock | freeze Date.now in the flaky test
 *     - Widen tolerance
 *
 * Older clients render the whole line as the option (still correct); newer surfaces show the label
 * on the button and send the WHOLE line as the answer, so the agent always gets the detail it wrote.
 *
 * A push that carries choices also carries a one-use NONCE bound to (owner, box, question). The
 * answer endpoint accepts a choice index + nonce, answers once, and is idempotent: a replay of the
 * same choice is `already`, a different choice after the first is refused. The nonce never appears
 * in visible notification text (it rides the data payload) and is stored only as a SHA-256.
 */
import { createHash, randomBytes } from "node:crypto";
import type { Db } from "./db.js";

export const MAX_CHOICES = 3;
/** Notification action buttons truncate hard on both platforms; keep labels short. */
export const LABEL_MAX = 32;
/** A question hours old is still actionable (push TTL is 24 h); a week-old nonce is not. */
export const NONCE_TTL_MS = 24 * 3600_000;

export interface Choice {
  /** Short button label. */
  label: string;
  /** The text sent to the agent when chosen (the whole option line). */
  answer: string;
}

const OPTIONS_HEADER = /^\s*options?\s*:?\s*$/i;
const OPTION_LINE = /^\s*(?:[-*•]\s+|\d+[.)]\s+|\(?[A-Za-z]\)\s+)(.+?)\s*$/;

/** Label/answer for one option line (web/mobile question.ts mirror this). */
export function toChoice(option: string): Choice {
  const answer = option.trim();
  const bar = answer.indexOf(" | ");
  const raw = (bar > 0 ? answer.slice(0, bar) : answer).trim();
  const label = raw.length > LABEL_MAX ? `${raw.slice(0, LABEL_MAX - 1).trimEnd()}…` : raw;
  return { label, answer };
}

/**
 * The choices a question offers, or [] for a free-form question. Deliberately strict — only the
 * explicit `Options:` block — because a button that sends a misparsed answer from a lock screen is
 * worse than no button (the card in the app still parses the looser shapes).
 */
export function questionChoices(raw: string | undefined): Choice[] {
  const lines = (raw ?? "").replace(/\r/g, "").split("\n");
  const hdr = lines.findIndex((l) => OPTIONS_HEADER.test(l));
  if (hdr < 0) return [];
  const out: Choice[] = [];
  const seen = new Set<string>();
  for (const l of lines.slice(hdr + 1)) {
    const m = l.match(OPTION_LINE);
    if (!m) continue;
    const c = toChoice(m[1]);
    if (!c.label || seen.has(c.answer)) continue;
    seen.add(c.answer);
    out.push(c);
    if (out.length >= MAX_CHOICES) break;
  }
  // One option is not a choice; the app handles it as a normal question.
  return out.length >= 2 ? out : [];
}

/* ───────────────────────────── nonces ───────────────────────────── */

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const questionHash = (q: string) => sha((q ?? "").replace(/\r/g, "").trim());

/**
 * Created on first use rather than as a numbered migration: nonces are ephemeral, and a numbered
 * migration would collide with parallel branches appending to the same list.
 */
function ensureTable(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS question_nonces (
      nonce_hash TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      box TEXT NOT NULL,
      question_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      used_at INTEGER,
      choice INTEGER
    );
    CREATE INDEX IF NOT EXISTS question_nonces_box ON question_nonces(box, question_hash);
  `);
}

/**
 * Mint a nonce for (owner, box, question). Every device of the owner gets the same nonce for one
 * question (a push fans out to all phones; the first tap wins). A reminder push for a still-open
 * question mints a fresh nonce; older unused ones stay valid until TTL so the first notification's
 * buttons keep working, and all of them die the moment any one is used.
 */
export function mintNonce(db: Db, owner: string, box: string, question: string, now = Date.now()): string {
  ensureTable(db);
  db.prepare(`DELETE FROM question_nonces WHERE created_at < ?`).run(now - NONCE_TTL_MS * 2);
  const nonce = randomBytes(18).toString("base64url");
  db.prepare(`INSERT INTO question_nonces (nonce_hash, owner, box, question_hash, created_at) VALUES (?, ?, ?, ?, ?)`).run(
    sha(nonce),
    owner,
    box,
    questionHash(question),
    now
  );
  return nonce;
}

export type ClaimResult =
  | { ok: true; choice: Choice; already?: false }
  | { ok: true; already: true; choice: Choice }
  | { ok: false; status: 400 | 403 | 404 | 409 | 410; error: string };

/**
 * Validate and atomically consume a nonce. `currentQuestion` is the box's question RIGHT NOW (from
 * the live snapshot): if it changed or vanished, the push is stale and the answer is refused — the
 * choices on a lock screen must never be applied to a different question.
 *
 * On success the caller must deliver the answer; if delivery fails it calls `releaseNonce` so the
 * user can retry.
 */
export function claimNonce(
  db: Db,
  args: { owner: string; box: string; nonce: unknown; choice: unknown; currentQuestion: string | undefined },
  now = Date.now()
): ClaimResult {
  ensureTable(db);
  if (typeof args.nonce !== "string" || args.nonce.length < 8 || args.nonce.length > 100) return { ok: false, status: 400, error: "nonce required" };
  if (typeof args.choice !== "number" || !Number.isInteger(args.choice) || args.choice < 0 || args.choice >= MAX_CHOICES) {
    return { ok: false, status: 400, error: "choice must be 0..2" };
  }
  const row = db.prepare(`SELECT owner, box, question_hash, created_at, used_at, choice FROM question_nonces WHERE nonce_hash = ?`).get(sha(args.nonce)) as
    | { owner: string; box: string; question_hash: string; created_at: number; used_at: number | null; choice: number | null }
    | undefined;
  // Wrong owner looks exactly like unknown: a nonce is not an oracle for someone else's boxes.
  if (!row || row.owner !== args.owner || row.box !== args.box) return { ok: false, status: 404, error: "unknown or expired answer link" };
  if (row.used_at != null) {
    // Idempotent replay (a retried request, a double tap): the same choice again is a no-op success.
    if (row.choice === args.choice) return { ok: true, already: true, choice: { label: "", answer: "" } };
    return { ok: false, status: 409, error: "this question was already answered" };
  }
  if (now - row.created_at > NONCE_TTL_MS) return { ok: false, status: 410, error: "this answer link expired — open the app to answer" };
  if (!args.currentQuestion || questionHash(args.currentQuestion) !== row.question_hash) {
    return { ok: false, status: 409, error: "this question was already answered or has changed" };
  }
  const choices = questionChoices(args.currentQuestion);
  const choice = choices[args.choice];
  if (!choice) return { ok: false, status: 400, error: "no such choice" };
  // Atomic: of two concurrent taps (two phones), exactly one flips used_at.
  const won = db.prepare(`UPDATE question_nonces SET used_at = ?, choice = ? WHERE nonce_hash = ? AND used_at IS NULL`).run(now, args.choice, sha(args.nonce)).changes === 1;
  if (!won) return claimNonce(db, args, now);
  // Answered once: every sibling nonce for this question dies with it.
  db.prepare(`UPDATE question_nonces SET used_at = ?, choice = -1 WHERE box = ? AND question_hash = ? AND used_at IS NULL`).run(now, row.box, row.question_hash);
  return { ok: true, choice };
}

/** Undo a claim whose delivery failed, so the user can try again. */
export function releaseNonce(db: Db, nonce: string): void {
  ensureTable(db);
  const h = sha(nonce);
  const row = db.prepare(`SELECT box, question_hash FROM question_nonces WHERE nonce_hash = ?`).get(h) as { box: string; question_hash: string } | undefined;
  if (!row) return;
  db.prepare(`UPDATE question_nonces SET used_at = NULL, choice = NULL WHERE box = ? AND question_hash = ?`).run(row.box, row.question_hash);
}
