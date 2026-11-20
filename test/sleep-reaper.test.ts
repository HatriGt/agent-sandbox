/**
 * The sleep TTL judged by the controller from the thread rows (src/sleep-reaper.ts): a temporary
 * thread asleep past the TTL is destroyed wherever its host is; an automation's box goes as soon
 * as it is not running; kept, running, waiting (within the park TTL) and Away threads are left.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { openMemoryDb } from "../src/db.ts";
import { getThread, upsertThread, threadFromBox } from "../src/threads.ts";
import type { ThreadRow } from "../src/threads.ts";
import type { BoxView } from "../src/monitor.ts";
import { asleepSecOf, groupByHost, reapVerdicts } from "../src/sleep-reaper.ts";
import type { StartedBy } from "../src/started-by.ts";

const H = 3600_000;
const row = (id: string, extra: Partial<ThreadRow> = {}): ThreadRow => ({
  id,
  owner: "alice",
  title: null,
  task: "t",
  agent: "claude",
  host: "instabox-b",
  role: "session",
  run_state: "done",
  exit_code: 0,
  question: null,
  repos_json: null,
  kept: 0,
  box_status: "stopped",
  box_seen_at: 0,
  asleep_since: 0,
  last_turn_at: null,
  created_at: 0,
  updated_at: 0,
  deleted_at: null,
  ...extra,
});
const trigger: StartedBy = { kind: "trigger", triggerId: "trg_1", name: "Deal Reviewer", source: "watch" };
const verdicts = (rows: ThreadRow[], by: Record<string, StartedBy> = {}, nowMs = 10 * H) =>
  reapVerdicts({ rows, startedBy: (id) => by[id], nowMs, sleepTtlSec: 3600, parkTtlSec: 48 * 3600 });

test("sleep reaper: a temporary thread past the TTL is destroyed, one within it waits, one without a clock gets one", () => {
  const v = verdicts([
    row("old", { asleep_since: 8 * H }), // asleep 2h
    row("fresh", { asleep_since: 9.5 * H }), // asleep 30m
    row("noclock", { asleep_since: null }),
  ]);
  assert.deepEqual(v.map((a) => [a.id, a.action]), [["old", "destroy"], ["noclock", "clock"]]);
  assert.match(v[0].why, /past the 60m sleep TTL/);
});

test("sleep reaper: kept, running, unknown, deleted and Away (absent) user threads are left alone", () => {
  const v = verdicts([
    row("kept", { kept: 1, asleep_since: 0 }),
    row("up", { box_status: "running", asleep_since: null }),
    row("never", { box_status: "unknown", asleep_since: null }),
    row("gone", { deleted_at: 1, asleep_since: 0 }),
    row("away", { box_status: "absent", asleep_since: 0 }),
  ]);
  assert.deepEqual(v, []);
});

test("sleep reaper: a thread parked on a question is held to the park TTL, from the same clock", () => {
  const v = verdicts([
    row("asked-recent", { run_state: "waiting", asleep_since: 0 }), // 10h asleep, park TTL 48h
    row("asked-old", { run_state: "waiting", asleep_since: 0 }),
  ], {}, 50 * H);
  assert.deepEqual(v.map((a) => [a.id, a.action]), [["asked-recent", "destroy"], ["asked-old", "destroy"]]);
  const within = verdicts([row("asked", { run_state: "waiting", asleep_since: 0 })], {}, 10 * H);
  assert.deepEqual(within, []);
  const noClock = verdicts([row("asked", { run_state: "waiting", asleep_since: null })], {}, 10 * H);
  assert.equal(noClock[0]?.action, "clock");
});

test("sleep reaper: an automation's box goes as soon as it is not running, whatever the clock says; a question holds it; a gone box closes the row", () => {
  const by = { done: trigger, failed: trigger, mid: trigger, asked: trigger, gone: trigger, fu: { kind: "followup", followup: "ci", parent: "p", pr: { repo: "o/r", number: 1 }, attempt: 1, subject: "s" } as StartedBy };
  const v = verdicts([
    row("done", { asleep_since: 9.9 * H }),
    row("failed", { run_state: "failed", asleep_since: null }),
    row("mid", { run_state: "running", asleep_since: 9.9 * H }),
    row("asked", { run_state: "waiting", asleep_since: 0 }),
    row("gone", { box_status: "absent", run_state: "running" }),
    row("fu", { asleep_since: null }),
    row("up", { box_status: "running", asleep_since: null }),
  ], by);
  assert.deepEqual(v.map((a) => [a.id, a.action]), [["done", "destroy"], ["failed", "destroy"], ["mid", "destroy"], ["gone", "forget"], ["fu", "destroy"]]);
  assert.match(v[2].why, /stopped mid-run/);
});

test("sleep reaper: destroys are grouped by host so a paused host is woken once", () => {
  const g = groupByHost([
    { id: "a", host: "instabox-b", action: "destroy", why: "" },
    { id: "b", host: "freestyle-a", action: "destroy", why: "" },
    { id: "c", host: "instabox-b", action: "forget", why: "" },
    { id: "d", host: null, action: "destroy", why: "" },
  ]);
  assert.deepEqual([...g.keys()], ["instabox-b", "freestyle-a", ""]);
  assert.deepEqual(g.get("instabox-b")?.map((a) => a.id), ["a", "c"]);
});

test("threads: the sleep clock is stamped when the box is seen stopped, kept while it stays stopped, cleared when it runs again", () => {
  const db = openMemoryDb();
  const box = (status: string): BoxView => ({ name: "t1", role: "session", boxStatus: status, runState: "done", task: "x" });
  upsertThread(db, threadFromBox(box("Running"), "alice", {}, 1000), 1000);
  assert.equal(getThread(db, "t1")?.asleep_since, null);
  upsertThread(db, threadFromBox(box("Stopped"), "alice", {}, 2000), 2000);
  assert.equal(getThread(db, "t1")?.asleep_since, 2000, "the nap stamps the clock");
  upsertThread(db, threadFromBox(box("Stopped"), "alice", { title: "named later" }, 3000), 3000);
  assert.equal(getThread(db, "t1")?.asleep_since, 2000, "a later change to the row leaves the clock");
  upsertThread(db, { id: "t1", kept: true }, 3500);
  assert.equal(getThread(db, "t1")?.asleep_since, 2000, "an upsert without a status says nothing about the clock");
  assert.equal(asleepSecOf(getThread(db, "t1"), 62_000), 60);
  upsertThread(db, threadFromBox(box("Running"), "alice", {}, 4000), 4000);
  assert.equal(getThread(db, "t1")?.asleep_since, null, "awake again: no clock");
  assert.equal(asleepSecOf(getThread(db, "t1"), 62_000), undefined);
  // A row found asleep with no clock (made before the column existed): the reaper's "clock" action stamps now.
  db.prepare(`UPDATE threads SET box_status = 'stopped', asleep_since = NULL WHERE id = 't1'`).run();
  upsertThread(db, { id: "t1", boxStatus: "stopped" }, 5000);
  assert.equal(getThread(db, "t1")?.asleep_since, 5000);
  // A new row first seen stopped starts its clock at once.
  upsertThread(db, threadFromBox({ ...box("Stopped"), name: "t2" }, null, {}, 6000), 6000);
  assert.equal(getThread(db, "t2")?.asleep_since, 6000);
});
