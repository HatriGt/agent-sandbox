import { test } from "node:test";
import assert from "node:assert/strict";
import { Inbox } from "../src/inbox.ts";
import { openMemoryDb } from "../src/db.ts";

const rows = (db: ReturnType<typeof openMemoryDb>) =>
  db.prepare(`SELECT box, msg_id, text, created_at FROM inbox_messages ORDER BY id`).all() as {
    box: string;
    msg_id: string;
    text: string;
    created_at: number;
  }[];

test("durable inbox: enqueue persists rows mirroring the in-memory shape", () => {
  const db = openMemoryDb();
  const ib = new Inbox(db);
  const a = ib.enqueue("box-a", "first", 111);
  ib.enqueue("box-b", "second", 222);
  const r = rows(db);
  assert.equal(r.length, 2);
  assert.deepEqual(r[0], { box: "box-a", msg_id: a.id, text: "first", created_at: 111 });
  assert.equal(r[1].box, "box-b");
});

test("durable inbox: a new Inbox over the same db hydrates the queue (restart)", () => {
  const db = openMemoryDb();
  const ib1 = new Inbox(db);
  ib1.enqueue("b", "one", 1);
  ib1.enqueue("b", "two", 2);
  ib1.enqueue("c", "three", 3);

  const ib2 = new Inbox(db);
  assert.deepEqual(ib2.sessions().sort(), ["b", "c"]);
  assert.deepEqual(ib2.list("b").map((m) => m.text), ["one", "two"]);
  assert.deepEqual(ib2.list("b").map((m) => m.at), [1, 2]);
  // seq resumes past hydrated ids: new ids never collide with restored ones.
  const fresh = ib2.enqueue("b", "four");
  assert.ok(!ib2.list("b").slice(0, 2).some((m) => m.id === fresh.id));
});

test("durable inbox: remove/drain/clear delete rows", () => {
  const db = openMemoryDb();
  const ib = new Inbox(db);
  const a = ib.enqueue("b", "one");
  ib.enqueue("b", "two");
  ib.enqueue("c", "other");

  assert.ok(ib.remove("b", a.id));
  assert.equal(rows(db).filter((r) => r.box === "b").length, 1);

  assert.deepEqual(ib.drain("b").map((m) => m.text), ["two"]);
  assert.equal(rows(db).filter((r) => r.box === "b").length, 0);
  assert.equal(rows(db).filter((r) => r.box === "c").length, 1, "drain only touches its own box");

  ib.clear("c");
  assert.equal(rows(db).length, 0);
  // A restart now hydrates nothing — drained messages are not re-delivered.
  assert.deepEqual(new Inbox(db).sessions(), []);
});

test("durable inbox: a db error degrades to memory-only without throwing", () => {
  const db = openMemoryDb();
  db.exec(`DROP TABLE inbox_messages`);
  const ib = new Inbox(db); // hydrate fails, starts empty
  const m = ib.enqueue("b", "still works");
  assert.deepEqual(ib.list("b").map((x) => x.text), ["still works"]);
  assert.ok(ib.remove("b", m.id));
  ib.enqueue("b", "again");
  assert.deepEqual(ib.drain("b").map((x) => x.text), ["again"]);
  ib.clear("b");
  assert.deepEqual(ib.sessions(), []);
});

test("durable inbox: no db behaves exactly as before", () => {
  const ib = new Inbox();
  ib.enqueue("b", "x");
  assert.deepEqual(ib.drain("b").map((m) => m.text), ["x"]);
});
