import test from "node:test";
import assert from "node:assert/strict";
import { openMemoryDb, nowIso } from "../src/db.js";
import { AUDIT_MAX_AGE_DAYS, listAuditEvents, pruneAuditEvents } from "../src/audit.js";

function insert(db: ReturnType<typeof openMemoryDb>, row: { at: string; user_id: string | null; method?: string; path?: string; status?: number; session?: string | null; action?: string | null; client?: string | null }) {
  db.prepare(`INSERT INTO audit_events (at, user_id, client, method, path, status, session, action) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    row.at, row.user_id, row.client ?? "1.2.3.4", row.method ?? "POST", row.path ?? "/delegate.json", row.status ?? 200, row.session ?? null, row.action ?? null
  );
}

test("audit view: scoping — a user sees only their own rows", () => {
  const db = openMemoryDb();
  insert(db, { at: nowIso(1000), user_id: "u1", session: "box-a" });
  insert(db, { at: nowIso(2000), user_id: "u2", session: "box-b" });
  insert(db, { at: nowIso(3000), user_id: "u1", path: "/teardown.json", session: "box-a" });

  const mine = listAuditEvents(db, { userId: "u1" });
  assert.equal(mine.length, 2);
  assert.ok(mine.every((e) => e.session === "box-a"));
  // Reverse-chron: latest first.
  assert.equal(mine[0].path, "/teardown.json");

  // No userId (operator/admin view): everything.
  assert.equal(listAuditEvents(db).length, 3);
});

test("audit view: limit is capped at 100 and defaults to 50; before pages backwards", () => {
  const db = openMemoryDb();
  for (let i = 0; i < 120; i++) insert(db, { at: nowIso(i * 1000), user_id: "u1", session: `s${i}` });

  assert.equal(listAuditEvents(db, { userId: "u1" }).length, 50);
  assert.equal(listAuditEvents(db, { userId: "u1", limit: 999 }).length, 100);
  assert.equal(listAuditEvents(db, { userId: "u1", limit: 0 }).length, 1);

  const page1 = listAuditEvents(db, { userId: "u1", limit: 10 });
  assert.equal(page1[0].session, "s119");
  const page2 = listAuditEvents(db, { userId: "u1", limit: 10, before: page1[page1.length - 1].at });
  assert.equal(page2[0].session, "s109");
  // No overlap between pages.
  const seen = new Set(page1.map((e) => e.session));
  assert.ok(page2.every((e) => !seen.has(e.session!)));
});

test("audit view: prune deletes only rows older than the retention window", () => {
  const db = openMemoryDb();
  const now = Date.now();
  const old = now - (AUDIT_MAX_AGE_DAYS + 1) * 86_400_000;
  const fresh = now - (AUDIT_MAX_AGE_DAYS - 1) * 86_400_000;
  insert(db, { at: nowIso(old), user_id: "u1", session: "ancient" });
  insert(db, { at: nowIso(fresh), user_id: "u1", session: "recent" });
  insert(db, { at: nowIso(now), user_id: "u2", session: "today" });

  assert.equal(pruneAuditEvents(db, now), 1);
  const rest = listAuditEvents(db);
  assert.deepEqual(rest.map((e) => e.session).sort(), ["recent", "today"]);
  // Idempotent.
  assert.equal(pruneAuditEvents(db, now), 0);
});
