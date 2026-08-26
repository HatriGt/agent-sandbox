import { test } from "node:test";
import assert from "node:assert/strict";
import { Inbox, joinQueued, startInboxDelivery } from "../src/inbox.ts";
import { isGithubAuthQuestion, makeCredentialBroker } from "../src/broker.ts";
import type { WatchSnapshot } from "../src/monitor.ts";

const snap = (runState: WatchSnapshot["runState"], boxStatus = "running"): WatchSnapshot => ({
  name: "b",
  boxStatus,
  runState,
  log: "",
});

test("inbox: enqueue/list/remove/drain", () => {
  const ib = new Inbox();
  const a = ib.enqueue("b", "first");
  ib.enqueue("b", "second");
  assert.equal(ib.list("b").length, 2);
  assert.ok(ib.remove("b", a.id));
  assert.deepEqual(ib.list("b").map((m) => m.text), ["second"]);
  assert.deepEqual(ib.drain("b").map((m) => m.text), ["second"]);
  assert.deepEqual(ib.sessions(), []);
  assert.equal(joinQueued([{ id: "1", text: " a ", at: 0 }, { id: "2", text: "b", at: 0 }]), "a\n\nb");
});

test("inbox delivery: waits while running, delivers on done, leaves waiting alone", async () => {
  const ib = new Inbox();
  ib.enqueue("b", "also run lint");
  let state: WatchSnapshot["runState"] = "running";
  const delivered: string[] = [];
  const stop = startInboxDelivery({
    inbox: ib,
    read: async () => snap(state),
    resume: async (_s, m) => void delivered.push(m),
    intervalMs: 5,
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(delivered.length, 0);
  state = "waiting";
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(delivered.length, 0, "a question is not auto-fed from the queue");
  state = "done";
  await new Promise((r) => setTimeout(r, 25));
  assert.deepEqual(delivered, ["also run lint"]);
  assert.equal(ib.list("b").length, 0);
  stop();
});

test("inbox delivery: a failed resume re-queues the messages", async () => {
  const ib = new Inbox();
  ib.enqueue("b", "x");
  let calls = 0;
  const stop = startInboxDelivery({
    inbox: ib,
    read: async () => snap("done"),
    resume: async () => {
      calls++;
      throw new Error("ssh down");
    },
    intervalMs: 5,
  });
  await new Promise((r) => setTimeout(r, 20));
  stop();
  assert.ok(calls >= 1);
  assert.deepEqual(ib.list("b").map((m) => m.text), ["x"]);
});

test("broker: recognises GitHub auth questions only", () => {
  assert.ok(isGithubAuthQuestion("GitHub auth has been lost… please re-export GH_TOKEN"));
  assert.ok(isGithubAuthQuestion("All gh calls fail with 'please run gh auth login'"));
  assert.equal(isGithubAuthQuestion("Should I mock the clock or widen the tolerance?"), false);
  assert.equal(isGithubAuthQuestion(undefined), false);
});

test("broker: answers once per (box, question) and only with a stored account", async () => {
  const resumed: string[] = [];
  let login: string | undefined = "hatrigt";
  const consider = makeCredentialBroker({
    defaultLogin: async () => login,
    resume: async (_s, m) => void resumed.push(m),
  });
  assert.equal(await consider("b", "I need GH_TOKEN to continue"), true);
  assert.match(resumed[0], /hatrigt/);
  assert.equal(await consider("b", "I need GH_TOKEN to continue"), false, "same question is not re-answered");
  login = undefined;
  assert.equal(await consider("c", "please run gh auth login"), false, "no account → human decides");
});
