import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The controller's own state: users, sessions, API keys, box ownership, audit. SQLite in DATA_DIR
 * (one controller, one file, WAL mode). Every access goes through the small typed helpers below so
 * a later move to Postgres is a change to this module, not to the routes.
 */
export type Db = Database.Database;

const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    github_id TEXT UNIQUE,
    login TEXT NOT NULL,
    email TEXT,
    avatar_url TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    max_boxes INTEGER,
    created_at TEXT NOT NULL,
    last_seen_at TEXT
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_seen_at TEXT,
    ip TEXT,
    user_agent TEXT
  );
  CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    prefix TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    revoked_at TEXT
  );
  CREATE INDEX IF NOT EXISTS api_keys_user ON api_keys(user_id);
  CREATE TABLE IF NOT EXISTS boxes (
    name TEXT PRIMARY KEY,
    owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    task_head TEXT
  );
  CREATE INDEX IF NOT EXISTS boxes_owner ON boxes(owner_id);
  CREATE TABLE IF NOT EXISTS login_states (
    state TEXT PRIMARY KEY,
    expires_at TEXT NOT NULL,
    redirect_to TEXT
  );
  CREATE TABLE IF NOT EXISTS audit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    user_id TEXT,
    client TEXT,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    status INTEGER NOT NULL,
    session TEXT,
    action TEXT
  );
  CREATE INDEX IF NOT EXISTS audit_user_at ON audit_events(user_id, at);
  `,
  `
  -- Per-owner integration state (GitHub accounts, MCP servers), encrypted with the controller key.
  -- owner_id is a users.id, or 'operator' for the deployment's own operator identity.
  CREATE TABLE IF NOT EXISTS user_blobs (
    owner_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    data_enc TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (owner_id, kind)
  );
  `,
  `
  ALTER TABLE users ADD COLUMN name TEXT;
  ALTER TABLE users ADD COLUMN password_hash TEXT;
  `,
  `
  -- Plans. 'trial' runs until trial_ends_at; 'pro' is paid/unlimited; 'free' is a self-hoster's
  -- default (no clock). Admins and the operator are never gated.
  ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'trial';
  ALTER TABLE users ADD COLUMN trial_ends_at TEXT;
  `,
  `
  -- Durable follow-up inbox: messages typed while a run is mid-turn survive controller restarts.
  -- Mirrors the in-memory QueuedMessage shape (id, text, at) plus the box the queue belongs to.
  CREATE TABLE IF NOT EXISTS inbox_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    box TEXT NOT NULL,
    msg_id TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS inbox_messages_box ON inbox_messages(box);
  `,
  `
  -- Run history archive: finished runs used to evaporate at teardown. Each row is a digest-shaped
  -- RECORD (never live state — PRODUCT.md principle 4): the full RunDigest serialized in digest_json
  -- plus the columns list views need without parsing it. Scoped per owner ('operator' for the
  -- deployment's own runs).
  CREATE TABLE IF NOT EXISTS run_archive (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    box TEXT,
    owner TEXT,
    task TEXT,
    state TEXT,
    exit_code INTEGER,
    started_at INTEGER,
    ended_at INTEGER,
    archived_at INTEGER NOT NULL,
    headline TEXT,
    digest_json TEXT
  );
  CREATE INDEX IF NOT EXISTS run_archive_owner_at ON run_archive(owner, archived_at);
  `,
  `
  -- End-of-run full diff (workspace-relative unified diff), captured at the finish edge while the
  -- box is still up, so a finished run stays REVIEWABLE after teardown. Redacted before storage;
  -- byte-capped at capture (FULL_DIFF_MAX_BYTES). NULL when capture failed or nothing changed.
  ALTER TABLE run_archive ADD COLUMN diff_text TEXT;
  `,
  `
  -- Triggers (docs/plan-agent-cloud.md workstream C): runs that start without a human at the
  -- keyboard, all through the same delegate flow. secret_enc is sealed with the controller key (the
  -- HMAC check needs the plaintext, so it cannot be a hash). last_payload_json is the redacted, capped
  -- last delivery — the editor's live template preview renders against it.
  CREATE TABLE IF NOT EXISTS triggers (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    spec_json TEXT NOT NULL,
    repo TEXT,
    task_template TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    concurrency INTEGER NOT NULL DEFAULT 1,
    budget_json TEXT, -- orphaned: run budgets were removed; never read or written (sqlite: not dropped)
    pr_comment INTEGER NOT NULL DEFAULT 0,
    agent TEXT,
    model TEXT,
    secret_enc TEXT,
    last_fired INTEGER,
    next_fire INTEGER,
    last_result_json TEXT,
    last_payload_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS triggers_owner ON triggers(owner);
  -- Replay/dedupe: one row per (trigger, delivery key); pruned after 7 days.
  CREATE TABLE IF NOT EXISTS trigger_deliveries (
    trigger_id TEXT NOT NULL,
    key TEXT NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (trigger_id, key)
  );
  -- How each run was started (manual / mcp / after: handoff / trigger), keyed by box, written at
  -- delegation time so the receipt knows it even after a controller restart.
  CREATE TABLE IF NOT EXISTS run_started_by (
    box TEXT PRIMARY KEY,
    started_by_json TEXT NOT NULL,
    at INTEGER NOT NULL
  );
  -- Ledger columns (History page filters/totals) — NULL on rows archived before this migration.
  ALTER TABLE run_archive ADD COLUMN started_by TEXT;
  ALTER TABLE run_archive ADD COLUMN trigger_id TEXT;
  ALTER TABLE run_archive ADD COLUMN agent TEXT;
  ALTER TABLE run_archive ADD COLUMN verified INTEGER;
  ALTER TABLE run_archive ADD COLUMN input_tokens INTEGER;
  ALTER TABLE run_archive ADD COLUMN output_tokens INTEGER;
  ALTER TABLE run_archive ADD COLUMN cost_usd REAL;
  -- Every fire attempt (storm cap) and the box it started (concurrency). Persisted so a controller
  -- restart cannot reset either count; in-flight rows are reconciled against live boxes.
  CREATE TABLE IF NOT EXISTS trigger_fires (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trigger_id TEXT NOT NULL,
    at INTEGER NOT NULL,
    box TEXT,
    finished_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS trigger_fires_trigger ON trigger_fires(trigger_id, at);
  CREATE INDEX IF NOT EXISTS trigger_fires_box ON trigger_fires(box);
  `,
  `
  -- Mobile push devices (src/push.ts). Expo push tokens are sealed with the controller key and
  -- looked up by SHA-256: a token lets its holder push to that phone, so it is a secret.
  CREATE TABLE IF NOT EXISTS push_devices (
    token_hash TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    token_enc TEXT NOT NULL,
    platform TEXT,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS push_devices_owner ON push_devices(owner);
  `,
  `
  -- Harness bundles (docs/plan-agent-cloud.md workstream F). Harness definitions live in the
  -- per-owner user_blobs store; these rows are only the links a run needs after a restart: which
  -- harness (and skill selection) a box started on, and the side-by-side compare it belongs to.
  ALTER TABLE triggers ADD COLUMN harness_id TEXT;
  CREATE TABLE IF NOT EXISTS run_harness (
    box TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    harness_id TEXT,
    harness_name TEXT,
    skills_json TEXT,
    compare_id TEXT,
    side TEXT,
    at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS run_harness_compare ON run_harness(compare_id);
  CREATE TABLE IF NOT EXISTS harness_compares (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    task TEXT NOT NULL,
    harness_a TEXT NOT NULL,
    harness_b TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS harness_compares_owner ON harness_compares(owner, created_at);
  `,
  `
  -- Alert-source presets + delivery log (docs/plan-demo-parity.md bets 3-4). The vendor's signing
  -- secret is sealed like the URL secret. The log keeps the last 50 deliveries per automation:
  -- what arrived and what happened to it (fired → box / skipped / rejected / failed).
  ALTER TABLE triggers ADD COLUMN signing_secret_enc TEXT;
  CREATE TABLE IF NOT EXISTS trigger_delivery_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trigger_id TEXT NOT NULL,
    at INTEGER NOT NULL,
    outcome TEXT NOT NULL,
    reason TEXT,
    detail TEXT,
    box TEXT,
    test INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS trigger_delivery_log_trigger ON trigger_delivery_log(trigger_id, id);
  `,
  `
  -- PR follow-ups (src/pr-followups.ts): which PRs this product opened (so CI failures and review
  -- feedback only ever act on those), each follow-up run (loop guard, dedupe per head SHA / review,
  -- the outcome card's "Fixed failing check" lines), and the per-owner GitHub webhook the events
  -- arrive on (secret sealed like a trigger's). repo is stored lowercased.
  CREATE TABLE IF NOT EXISTS agent_prs (
    repo TEXT NOT NULL,
    number INTEGER NOT NULL,
    owner TEXT NOT NULL,
    root_box TEXT NOT NULL,
    branch TEXT,
    harness_id TEXT,
    agent TEXT,
    model TEXT,
    trigger_id TEXT,
    archive_id INTEGER,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (repo, number)
  );
  CREATE INDEX IF NOT EXISTS agent_prs_branch ON agent_prs(repo, branch);
  CREATE INDEX IF NOT EXISTS agent_prs_root ON agent_prs(root_box);
  CREATE TABLE IF NOT EXISTS pr_followups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo TEXT NOT NULL,
    number INTEGER NOT NULL,
    owner TEXT NOT NULL,
    kind TEXT NOT NULL,
    dedupe_key TEXT NOT NULL,
    attempt INTEGER NOT NULL,
    subject TEXT NOT NULL,
    box TEXT,
    state TEXT NOT NULL,
    comments_json TEXT,
    archive_id INTEGER,
    at INTEGER NOT NULL,
    finished_at INTEGER,
    UNIQUE (repo, number, dedupe_key)
  );
  CREATE INDEX IF NOT EXISTS pr_followups_box ON pr_followups(box);
  CREATE TABLE IF NOT EXISTS pr_followup_hooks (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL UNIQUE,
    secret_enc TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  `,
  `
  -- Repo setup profiles (src/setup-profile.ts): per owner × repo, how it installs/builds/tests.
  -- profile_json never holds a secret value — env vars are stored by NAME only.
  CREATE TABLE IF NOT EXISTS repo_setup (
    owner TEXT NOT NULL,
    repo TEXT NOT NULL,
    profile_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (owner, repo)
  );
  `,
  `
  -- "Tries several approaches" (src/attempts.ts): an attempt group is a harness_compares row with
  -- kind='attempts'; its attempts link through run_harness (compare_id, side = "1".."3") like the
  -- two compare sides. The row carries the controller's scoring state and the winner.
  ALTER TABLE harness_compares ADD COLUMN kind TEXT NOT NULL DEFAULT 'harness';
  ALTER TABLE harness_compares ADD COLUMN status TEXT;
  ALTER TABLE harness_compares ADD COLUMN attempts_json TEXT;
  ALTER TABLE harness_compares ADD COLUMN deadline_at INTEGER;
  ALTER TABLE harness_compares ADD COLUMN winner_box TEXT;
  ALTER TABLE harness_compares ADD COLUMN decided_by TEXT;
  ALTER TABLE harness_compares ADD COLUMN decided_at INTEGER;
  ALTER TABLE harness_compares ADD COLUMN question TEXT;
  ALTER TABLE harness_compares ADD COLUMN note TEXT;
  CREATE INDEX IF NOT EXISTS harness_compares_kind ON harness_compares(kind, status);
  `,
  `
  -- Intake channels (src/intake.ts): one row per owner — the private email address token, the Slack
  -- app's signing secret / bot token, the Sentry token for pasted links, sender and Slack-user
  -- allowlists, the default repo. Secrets sealed like every other. Deliveries reuse
  -- trigger_delivery_log keyed by the channel id. A pending row is an intake waiting for "which repo?".
  CREATE TABLE IF NOT EXISTS intake_channels (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL UNIQUE,
    email_token_enc TEXT NOT NULL,
    mailgun_key_enc TEXT,
    slack_signing_secret_enc TEXT,
    slack_bot_token_enc TEXT,
    sentry_token_enc TEXT,
    allow_emails_json TEXT NOT NULL DEFAULT '[]',
    slack_users_json TEXT NOT NULL DEFAULT '[]',
    default_repo TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS intake_pending (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    source TEXT NOT NULL,
    task TEXT NOT NULL,
    attachments_json TEXT,
    choices_json TEXT NOT NULL,
    meta_json TEXT,
    created_at INTEGER NOT NULL,
    resolved_at INTEGER,
    box TEXT
  );
  CREATE INDEX IF NOT EXISTS intake_pending_owner ON intake_pending(owner, created_at);
  `,
  `
  -- Which skills a run was pointed at (src/skill-match.ts): [{name, how: "explicit"|"auto"}].
  CREATE TABLE IF NOT EXISTS run_skills (
    box TEXT PRIMARY KEY,
    picks_json TEXT NOT NULL,
    at INTEGER NOT NULL
  );
  `,
  `
  -- Proactive agents (Phase 4). triggers.quiet: a run that ends with the quiet marker (nothing needs
  -- the operator) sends no notification. triggers.proposed: authored by an agent at its finish edge
  -- (<!-- automate: cron | task -->), created paused until the operator enables or dismisses it.
  -- trigger_delivery_log.quiet is stamped when the fired run finishes: 1 = quiet, 0 = reported,
  -- NULL = not finished (or not a run) — the "checked N× · M reports" counter reads it.
  ALTER TABLE triggers ADD COLUMN quiet INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE triggers ADD COLUMN proposed INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE trigger_delivery_log ADD COLUMN quiet INTEGER;
  `,
];

export function openDb(dataDir: string): Db {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, "asb.sqlite"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

/** In-memory database for tests. */
export function openMemoryDb(): Db {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL)`);
  const row = db.prepare(`SELECT v FROM schema_version`).get() as { v: number } | undefined;
  let v = row?.v ?? 0;
  if (!row) db.prepare(`INSERT INTO schema_version (v) VALUES (?)`).run(v);
  // Persist the version after EACH migration, and run migration + bump in ONE transaction: `exec`
  // is not atomic across statements, so a crash between two ALTERs of the same migration would
  // otherwise leave it half-applied with the version un-bumped — the re-run then fails with
  // "duplicate column name" and bricks every startup.
  const bump = db.prepare(`UPDATE schema_version SET v = ?`);
  const step = db.transaction((sql: string, next: number) => {
    db.exec(sql);
    bump.run(next);
  });
  for (; v < MIGRATIONS.length; v++) step(MIGRATIONS[v], v + 1);
}

export const nowIso = (ms = Date.now()) => new Date(ms).toISOString();
