import { test } from "node:test";
import assert from "node:assert/strict";
import { openMemoryDb } from "../src/db.ts";
import { archiveRun, deleteRun, getRun, listRuns, pruneArchive } from "../src/run-archive.ts";
import type { RunDigest } from "../src/digest.ts";

const digest = (over: Partial<RunDigest> = {}): RunDigest => ({
  box: "box-a",
  task: "do the thing",
  state: "done",
  exitCode: 0,
  startedAt: 1000,
  endedAt: 2000,
  plan: [],
  files: [],
  failedCommands: [],
  questions: [],
  headline: "done · 2 files",
  ...over,
});

test("archive: insert persists and getRun parses digest_json", () => {
  const db = openMemoryDb();
  const id = archiveRun(db, { box: "box-a", owner: "u1", digest: digest(), now: 5000 });
  assert.ok(id !== null);
  const run = getRun(db, "u1", id!);
  assert.ok(run);
  assert.equal(run!.box, "box-a");
  assert.equal(run!.task, "do the thing");
  assert.equal(run!.state, "done");
  assert.equal(run!.exitCode, 0);
  assert.equal(run!.startedAt, 1000);
  assert.equal(run!.endedAt, 2000);
  assert.equal(run!.archivedAt, 5000);
  assert.equal(run!.headline, "done · 2 files");
  assert.deepEqual(run!.digest, digest());
});

test("archive: list is reverse-chron and owner-scoped", () => {
  const db = openMemoryDb();
  archiveRun(db, { box: "a1", owner: "A", digest: digest({ box: "a1", endedAt: 1 }), now: 10 });
  archiveRun(db, { box: "a2", owner: "A", digest: digest({ box: "a2", endedAt: 2 }), now: 20 });
  archiveRun(db, { box: "b1", owner: "B", digest: digest({ box: "b1", endedAt: 3 }), now: 30 });

  const a = listRuns(db, "A");
  assert.deepEqual(a.map((r) => r.box), ["a2", "a1"], "newest first");
  assert.ok(a.every((r) => r.owner === "A"), "owner A never sees B");
  assert.deepEqual(listRuns(db, "B").map((r) => r.box), ["b1"]);
  assert.deepEqual(listRuns(db, "C"), []);

  // paging: before excludes the row itself
  const before = listRuns(db, "A", { before: a[0].id });
  assert.deepEqual(before.map((r) => r.box), ["a1"]);
  assert.equal(listRuns(db, "A", { limit: 1 }).length, 1);
});

test("archive: same finish observed twice does not duplicate (equal ended_at, even with a degraded headline)", () => {
  const db = openMemoryDb();
  const id1 = archiveRun(db, { box: "b", owner: "A", digest: digest({ headline: "done · 2 files" }), now: 100 });
  assert.ok(id1 !== null);
  // teardown fallback: same finish stamp, but no files → different headline. Still the same finish.
  const id2 = archiveRun(db, { box: "b", owner: "A", digest: digest({ headline: "done", files: [] }), now: 200 });
  assert.equal(id2, null);
  assert.equal(listRuns(db, "A").length, 1);
});

test("archive: stamp-less finish dedupes on (exit, headline) within the window, not outside it", () => {
  const db = openMemoryDb();
  const d = digest({ startedAt: undefined, endedAt: undefined });
  assert.ok(archiveRun(db, { box: "b", owner: "A", digest: d, now: 1_000_000 }) !== null);
  assert.equal(archiveRun(db, { box: "b", owner: "A", digest: d, now: 1_000_000 + 60_000 }), null, "same stamp-less finish within window");
  assert.ok(
    archiveRun(db, { box: "b", owner: "A", digest: { ...d, headline: "failed (exit 1)", exitCode: 1, state: "failed" }, now: 1_000_000 + 60_000 }) !== null,
    "a different outcome is a new finish"
  );
  const stale = digest({ startedAt: undefined, endedAt: undefined });
  archiveRun(db, { box: "c", owner: "A", digest: stale, now: 0 });
  assert.ok(archiveRun(db, { box: "c", owner: "A", digest: stale, now: 2 * 60 * 60 * 1000 }) !== null, "outside the window a stamp-less repeat records again");
});

test("archive: a resume that finishes again (new ended_at) creates a NEW row even with an identical outcome", () => {
  const db = openMemoryDb();
  assert.ok(archiveRun(db, { box: "b", owner: "A", digest: digest({ endedAt: 2000 }), now: 100 }) !== null);
  assert.ok(archiveRun(db, { box: "b", owner: "A", digest: digest({ endedAt: 9000 }), now: 200 }) !== null);
  assert.equal(listRuns(db, "A").length, 2);
});

test("archive: prune by age and by count", () => {
  const db = openMemoryDb();
  const day = 24 * 60 * 60 * 1000;
  const now = 100 * day;
  archiveRun(db, { box: "old", owner: "A", digest: digest({ box: "old", endedAt: 1 }), now: now - 95 * day });
  archiveRun(db, { box: "new", owner: "A", digest: digest({ box: "new", endedAt: 2 }), now: now - day });
  const removed = pruneArchive(db, { now });
  assert.equal(removed, 1);
  assert.deepEqual(listRuns(db, "A").map((r) => r.box), ["new"]);

  // count cap: per owner, newest kept
  for (let i = 0; i < 6; i++) archiveRun(db, { box: `x${i}`, owner: "B", digest: digest({ box: `x${i}`, endedAt: i + 10 }), now: now - 1000 + i });
  pruneArchive(db, { maxRows: 3, now });
  const b = listRuns(db, "B");
  assert.deepEqual(b.map((r) => r.box), ["x5", "x4", "x3"], "newest 3 kept for B");
  assert.equal(listRuns(db, "A").length, 1, "A's single row survives B's trim");
});

test("archive: delete is owner-scoped", () => {
  const db = openMemoryDb();
  const id = archiveRun(db, { box: "b", owner: "A", digest: digest(), now: 1 })!;
  assert.equal(deleteRun(db, "B", id), false, "another owner cannot delete");
  assert.ok(getRun(db, "A", id));
  assert.equal(deleteRun(db, "A", id), true);
  assert.equal(getRun(db, "A", id), undefined);
});

test("archive: getRun is owner-scoped and survives corrupt digest_json", () => {
  const db = openMemoryDb();
  const id = archiveRun(db, { box: "b", owner: "A", digest: digest(), now: 1 })!;
  assert.equal(getRun(db, "B", id), undefined);
  db.prepare(`UPDATE run_archive SET digest_json = 'not json' WHERE id = ?`).run(id);
  const run = getRun(db, "A", id);
  assert.ok(run);
  assert.equal(run!.digest, null, "corrupt digest degrades to null, row still readable");
});
