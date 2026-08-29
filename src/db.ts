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
  for (; v < MIGRATIONS.length; v++) db.exec(MIGRATIONS[v]);
  if (row) db.prepare(`UPDATE schema_version SET v = ?`).run(v);
  else db.prepare(`INSERT INTO schema_version (v) VALUES (?)`).run(v);
}

export const nowIso = (ms = Date.now()) => new Date(ms).toISOString();
