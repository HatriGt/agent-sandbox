/**
 * Editing a queued message (PATCH /inbox.json): the inbox rewrites it in place — same id, same slot,
 * same stamp — and the box-side mirror is taken back by id so the gate never delivers the old words.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Inbox } from "../src/inbox.ts";
import { INBOX_MARK, inboxLine, inboxUnmirrorSh } from "../src/drivers/inbox-gate.ts";

test("Inbox.update rewrites the text in place and keeps id, order and stamp", () => {
  const inbox = new Inbox();
  const a = inbox.enqueue("b", "first", 1000);
  const m = inbox.enqueue("b", "second", 2000);
  inbox.enqueue("b", "third", 3000);
  const updated = inbox.update("b", m.id, "second, rewritten");
  assert.deepEqual(updated, { id: m.id, text: "second, rewritten", at: 2000 });
  assert.deepEqual(
    inbox.list("b").map((x) => [x.id, x.text]),
    [
      [a.id, "first"],
      [m.id, "second, rewritten"],
      ["q3", "third"],
    ]
  );
  assert.equal(inbox.update("b", "q99", "nothing"), null);
  assert.equal(inbox.update("other", m.id, "nothing"), null);
});

test("the unmirror shell matches exactly the line the mirror wrote, and only that one", () => {
  const sh = inboxUnmirrorSh("q12");
  assert.ok(sh.includes(`grep -v -F '{"id":"q12",' ${INBOX_MARK}`));
  // q1 and q120 must survive a q12 removal: the match includes the closing quote and comma.
  const needle = '{"id":"q12",';
  assert.ok(inboxLine({ id: "q12", text: "x", at: 1 }).startsWith(needle));
  assert.ok(!inboxLine({ id: "q1", text: "x", at: 1 }).includes(needle));
  assert.ok(!inboxLine({ id: "q120", text: "x", at: 1 }).includes(needle));
  assert.throws(() => inboxUnmirrorSh("q12; rm -rf /"), /bad id/);
});
