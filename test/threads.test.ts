/**
 * Threads (src/threads.ts): the durable unit. The table outlives the box, the fleet lists a thread
 * whose box is gone as AWAY when a copy is kept (asleep when its host merely did not answer), and
 * the transcript's copy on the controller follows the box's log by appending whole lines.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openMemoryDb } from "../src/db.ts";
import { mergeWithMemory } from "../src/fleet.ts";
import type { BoxView } from "../src/monitor.ts";
import { getThread, listThreads, markThreadDeleted, noteAbsentThreads, planSync, readTranscript, syncSh, syncTranscript, threadFromBox, threadRunMetas, threadViews, upsertThread } from "../src/threads.ts";

const box = (name: string, extra: Partial<BoxView> = {}): BoxView => ({ name, role: "session", boxStatus: "Running", runState: "running", task: "fix the pool", ...extra });

test("threads: upsert writes only the given columns, list hides deleted rows, revive undeletes", () => {
  const db = openMemoryDb();
  upsertThread(db, threadFromBox(box("t1", { host: "freestyle-a" }), "alice", { title: "Pool fix", kept: true }, 1000), 1000);
  let row = getThread(db, "t1");
  assert.ok(row);
  assert.equal(row.owner, "alice");
  assert.equal(row.title, "Pool fix");
  assert.equal(row.kept, 1);
  assert.equal(row.box_status, "running");
  assert.equal(row.box_seen_at, 1000);
  assert.equal(row.created_at, 1000);
  // A later sweep that says nothing about the title keeps it.
  upsertThread(db, { id: "t1", runState: "done", exitCode: 0, boxStatus: "stopped" }, 2000);
  row = getThread(db, "t1")!;
  assert.equal(row.title, "Pool fix");
  assert.equal(row.run_state, "done");
  assert.equal(row.exit_code, 0);
  assert.equal(row.updated_at, 2000);
  assert.equal(row.created_at, 1000);
  markThreadDeleted(db, "t1", 3000);
  assert.deepEqual(listThreads(db), []);
  assert.equal(getThread(db, "t1")?.deleted_at, 3000);
  upsertThread(db, { id: "t1", boxStatus: "running" }, 4000, { revive: true });
  assert.equal(listThreads(db).length, 1);
  assert.equal(getThread(db, "t1")?.deleted_at, null);
  // Per-owner listing.
  upsertThread(db, { id: "t2", owner: "bob" }, 5000);
  assert.deepEqual(listThreads(db, { owner: "alice" }).map((r) => r.id), ["t1"]);
  assert.deepEqual(listThreads(db).map((r) => r.id), ["t2", "t1"], "newest first");
});

test("threadFromBox: a running box's question is definitive, a stopped box reads as stopped", () => {
  const u = threadFromBox(box("t", { runState: "waiting", question: "which db?" }), null, {}, 7);
  assert.equal(u.question, "which db?");
  assert.equal(u.boxStatus, "running");
  const s = threadFromBox(box("t", { boxStatus: "Stopped", runState: "done", exitCode: 0 }), null, {}, 7);
  assert.equal(s.boxStatus, "stopped");
  assert.equal(s.boxSeenAt, 7);
});

test("threadViews: a present box is skipped, a stale host reads asleep, a kept copy reads away, else not listed", () => {
  const db = openMemoryDb();
  for (const [id, host] of [
    ["seen", "hostbrr"],
    ["asleep", "freestyle-a"],
    ["away", "hostbrr"],
    ["gone", "hostbrr"],
  ] as const) {
    upsertThread(db, { id, host, task: `task ${id}`, runState: "done", exitCode: 0, kept: id === "away", boxStatus: "stopped" }, 1);
  }
  const views = threadViews(listThreads(db), new Set(["seen"]), new Set(["freestyle-a"]), (id) => id === "away");
  const byName = Object.fromEntries(views.map((v) => [v.name, v]));
  assert.deepEqual(Object.keys(byName).sort(), ["asleep", "away"]);
  assert.equal(byName.asleep.boxStatus, "Stopped");
  assert.equal(byName.asleep.absent, undefined);
  assert.equal(byName.away.boxStatus, "Absent");
  assert.equal(byName.away.absent, true);
  assert.equal(byName.away.kept, true);
  assert.equal(byName.away.task, "task away");
  assert.equal(byName.away.runState, "done");
});

test("fleet: an away row passes through the merge untouched and leaves no memory", () => {
  const mem = new Map<string, BoxView>();
  mergeWithMemory([box("a")], mem);
  assert.ok(mem.has("a"));
  const out = mergeWithMemory([{ name: "a", role: "session", boxStatus: "Absent", runState: "done", absent: true }], mem);
  assert.equal(out.length, 1);
  assert.equal(out[0].absent, true);
  assert.equal(out[0].boxStatus, "Absent");
  assert.ok(!mem.has("a"), "nothing is remembered about a box that does not exist");
});

test("planSync: equal → none, bigger → whole lines appended, marker → replace, smaller without marker → torn", () => {
  assert.deepEqual(planSync(10, "SIZE 10\n"), { kind: "none", size: 10 });
  assert.deepEqual(planSync(10, "SIZE 25\nline a\nline b\npartial"), { kind: "append", text: "line a\nline b\n", size: 25 });
  assert.deepEqual(planSync(10, "SIZE 12\npartial"), { kind: "none", size: 12 });
  assert.deepEqual(planSync(10, "SIZE 4\n---WHOLE---\nabc\n"), { kind: "replace", text: "abc\n", size: 4 });
  assert.deepEqual(planSync(10, "SIZE 4\n"), { kind: "none", size: 4 }, "a torn answer waits for the next one");
  assert.deepEqual(planSync(0, "SIZE 3\nab\n"), { kind: "append", text: "ab\n", size: 3 });
  assert.throws(() => planSync(5, "garbage"), /unexpected sync answer/, "a box that did not answer the probe is an error, not an empty log");
  assert.match(syncSh(42), /tail -c \+43/);
});

test("syncTranscript: follows a growing log, takes the whole file after a truncation", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "asb-threads-"));
  const cfg = { dataDir };
  let log = "";
  const exec = async (sh: string): Promise<string> => {
    const m = /tail -c \+(\d+)/.exec(sh);
    const have = Number(m![1]) - 1;
    const size = Buffer.byteLength(log);
    if (size > have) return `SIZE ${size}\n${Buffer.from(log).subarray(have).toString()}`;
    if (size < have) return `SIZE ${size}\n---WHOLE---\n${log}`;
    return `SIZE ${size}\n`;
  };
  log = "{\"a\":1}\n{\"b\":2}\n{\"c\":";
  let r = await syncTranscript(cfg, "t", exec);
  assert.equal(r.changed, true);
  assert.equal(await readTranscript(cfg, "t"), "{\"a\":1}\n{\"b\":2}\n");
  r = await syncTranscript(cfg, "t", exec);
  assert.equal(r.changed, false, "the torn tail is not stored twice");
  log += "3}\n";
  r = await syncTranscript(cfg, "t", exec);
  assert.equal(await readTranscript(cfg, "t"), log);
  assert.equal(r.bytes, Buffer.byteLength(log));
  // The box's log was replaced by something shorter (a restore from an older copy).
  log = "{\"z\":0}\n";
  await syncTranscript(cfg, "t", exec);
  assert.equal(await readTranscript(cfg, "t"), log);
  assert.equal(await readTranscript(cfg, "nope"), null);
  await fs.rm(dataDir, { recursive: true, force: true });
});

test("threadRunMetas: live rows seed the fleet's memory; a row with no task uses the claim-time head; deleted and empty rows are skipped", () => {
  const db = openMemoryDb();
  const now = 1_700_000_000_000;
  upsertThread(db, { id: "delegate-1-a", owner: "u1", title: "Create a deal", host: "freestyle-a", runState: "idle", boxStatus: "stopped" }, now);
  upsertThread(db, { id: "delegate-1-b", owner: "u1", task: "full task text", question: "which env?", repos: [{ owner: "o", name: "r" }] as never, runState: "waiting", exitCode: null, host: "freestyle-a", boxStatus: "stopped" }, now);
  upsertThread(db, { id: "delegate-1-c", owner: "u1", task: "gone", runState: "done", boxStatus: "stopped" }, now);
  markThreadDeleted(db, "delegate-1-c", now + 1);
  upsertThread(db, { id: "delegate-1-d", owner: "u1", runState: "idle", boxStatus: "stopped" }, now);
  const heads: Record<string, string> = { "delegate-1-a": "create a deal for ..." };
  const m = threadRunMetas(listThreads(db), (id) => heads[id] ?? null);
  assert.deepEqual([...m.keys()].sort(), ["delegate-1-a", "delegate-1-b"]);
  assert.equal(m.get("delegate-1-a")?.task, "create a deal for ...");
  assert.equal(m.get("delegate-1-a")?.host, "freestyle-a");
  const b = m.get("delegate-1-b")!;
  assert.equal(b.task, "full task text");
  assert.equal(b.question, "which env?");
  assert.equal(b.runState, "waiting");
  assert.deepEqual(b.repos, [{ owner: "o", name: "r" }]);
  // Merged with a sweep that lists the box stopped: the thread keeps its task instead of reading "No task yet".
  const sweep: BoxView[] = [{ name: "delegate-1-a", boxStatus: "Stopped", role: "session", runState: "idle", host: "freestyle-a" } as BoxView];
  const merged = mergeWithMemory(sweep, new Map(m.entries()) as never, { held: () => true });
  assert.equal(merged[0]?.task, "create a deal for ...");
  assert.equal(merged[0]?.boxStatus, "Stopped");
});

test("threads: a host that answered without the box marks the row absent (not a row seconds old, not from a host that did not answer); the view then shows away while the host sleeps, not asleep", () => {
  const db = openMemoryDb();
  const t0 = 1_000_000;
  for (const [id, host, created] of [
    ["gone", "freestyle-a", t0],
    ["young", "freestyle-a", t0 + 500_000],
    ["elsewhere", "freestyle-b", t0],
    ["present", "freestyle-a", t0],
  ] as const) {
    upsertThread(db, { id, host, task: `task ${id}`, runState: "done", exitCode: 0, boxStatus: "stopped" }, created);
  }
  const now = t0 + 600_000;
  const wrote = noteAbsentThreads(db, listThreads(db), new Set(["present"]), new Set(["freestyle-a"]), now);
  assert.deepEqual(wrote, ["gone"], "only the old row on the host that answered");
  assert.equal(getThread(db, "gone")?.box_status, "absent");
  assert.equal(getThread(db, "gone")?.box_seen_at, now);
  assert.equal(getThread(db, "young")?.box_status, "stopped", "a row seconds old may still be booting");
  assert.equal(getThread(db, "elsewhere")?.box_status, "stopped", "its host did not answer");
  assert.deepEqual(noteAbsentThreads(db, listThreads(db), new Set(["present"]), new Set(["freestyle-a"]), now + 1), [], "written once");
  // freestyle-a sleeps: "gone" reads away (a copy exists), never asleep; "young" still reads asleep.
  const views = threadViews(listThreads(db), new Set(["present"]), new Set(["freestyle-a", "freestyle-b"]), (id) => id === "gone");
  const byName = Object.fromEntries(views.map((v) => [v.name, v]));
  assert.equal(byName.gone.absent, true);
  assert.equal(byName.gone.boxStatus, "Absent");
  assert.equal(byName.young.absent, undefined);
  assert.equal(byName.young.boxStatus, "Stopped");
  assert.equal(byName.elsewhere.boxStatus, "Stopped");
  // Listed again (restored): the sweep's upsert says stopped/running and the view follows.
  upsertThread(db, { id: "gone", boxStatus: "running" }, now + 2);
  const back = threadViews(listThreads(db), new Set(), new Set(["freestyle-a"]), () => true);
  assert.equal(back.find((v) => v.name === "gone")?.absent, undefined);
});
