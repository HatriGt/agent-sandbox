/**
 * Mobile push (src/push.ts): device registry scoping, payload privacy, Expo send + pruning.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { openMemoryDb } from "../src/db.ts";
import { makeSecretBox } from "../src/secretbox.ts";
import {
  buildPushMessages,
  deviceCount,
  isExpoPushToken,
  listDeviceTokens,
  makeOwnerRateCap,
  MAX_DEVICES_PER_OWNER,
  pruneToken,
  registerDevice,
  sendExpoPush,
  shortTitle,
  unregisterDevice,
  type ExpoMessage,
} from "../src/push.ts";

const sb = makeSecretBox(randomBytes(32));
const T1 = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]";
const T2 = "ExpoPushToken[bbbbbbbbbbbbbbbbbbbbbb]";

test("token shape: only Expo push tokens are accepted", () => {
  assert.ok(isExpoPushToken(T1));
  assert.ok(isExpoPushToken(T2));
  for (const bad of ["", "abc", "ExponentPushToken[]", "ExponentPushToken[a b]", 42, null, `ExponentPushToken[${"a".repeat(300)}]`])
    assert.equal(isExpoPushToken(bad), false);
});

test("register/unregister is owner-scoped and tokens are sealed at rest", () => {
  const db = openMemoryDb();
  assert.equal(registerDevice(db, sb, "alice", T1, "ios").ok, true);
  assert.equal(registerDevice(db, sb, "alice", T1, "ios").ok, true); // idempotent
  assert.equal(registerDevice(db, sb, "bob", T2, "android").ok, true);
  assert.equal(registerDevice(db, sb, "bob", "nope", "android").ok, false);
  assert.deepEqual(listDeviceTokens(db, sb, "alice"), [T1]);
  assert.deepEqual(listDeviceTokens(db, sb, "bob"), [T2]);
  const raw = JSON.stringify(db.prepare(`SELECT * FROM push_devices`).all());
  assert.ok(!raw.includes("aaaaaaaaaa") && !raw.includes("bbbbbbbbbb"), "no plaintext token in the table");
  // bob cannot unregister alice's device
  assert.equal(unregisterDevice(db, "bob", T1), false);
  assert.equal(deviceCount(db, "alice"), 1);
  assert.equal(unregisterDevice(db, "alice", T1), true);
  assert.equal(deviceCount(db, "alice"), 0);
});

test("a token registered by a second owner moves: the old owner stops receiving", () => {
  const db = openMemoryDb();
  registerDevice(db, sb, "alice", T1, "ios");
  registerDevice(db, sb, "bob", T1, "ios");
  assert.deepEqual(listDeviceTokens(db, sb, "alice"), []);
  assert.deepEqual(listDeviceTokens(db, sb, "bob"), [T1]);
});

test("device cap evicts the stalest device", () => {
  const db = openMemoryDb();
  for (let i = 0; i < MAX_DEVICES_PER_OWNER; i++) registerDevice(db, sb, "a", `ExpoPushToken[device${String(i).padStart(4, "0")}xx]`, "ios", 1000 + i);
  registerDevice(db, sb, "a", T1, "ios", 5000);
  const toks = listDeviceTokens(db, sb, "a");
  assert.equal(toks.length, MAX_DEVICES_PER_OWNER);
  assert.ok(toks.includes(T1) && !toks.includes("ExpoPushToken[device0000xx]"));
});

test("payload carries only a short title and a fixed phrase — never the question", () => {
  const [m] = buildPushMessages({ box: "b-1", kind: "waiting", question: "Paste the prod DB password?" }, [T1], "Fix login flow");
  assert.equal(m.to, T1);
  assert.equal(m.title, "Fix login flow");
  assert.equal(m.body, "Needs an answer");
  assert.deepEqual(m.data, { box: "b-1", kind: "waiting", url: "asb://box/b-1" });
  assert.ok(!JSON.stringify(m).includes("password"));
  assert.equal(m.priority, "high");
  assert.equal(m.interruptionLevel, "time-sensitive");
  assert.equal(m.tag, "b-1:ask");
  const [d] = buildPushMessages({ box: "b-1", kind: "done", exitCode: 0 }, [T1], "");
  assert.equal(d.title, "b-1", "falls back to the box name");
  assert.equal(d.priority, "high", "a finished run still wakes the device");
  assert.equal(d.interruptionLevel, "active", "but does not break through Focus");
  assert.equal(buildPushMessages({ box: "b", kind: "failed", exitCode: 1 }, [T1], "t")[0].interruptionLevel, "time-sensitive");
  assert.equal(buildPushMessages({ box: "b", kind: "waiting", question: "Which one?" }, [T1], "t")[0].channelId, "needs-you-v2");
  assert.equal(buildPushMessages({ box: "b", kind: "stalled" }, [T1], "t")[0].body, "Looks stalled");
  assert.ok(shortTitle("x".repeat(200), "b").length <= 60);
  assert.equal(shortTitle("line one\nsecret second line", "b"), "line one");
});

test("send posts to exp.host and prunes DeviceNotRegistered tokens only", async () => {
  const db = openMemoryDb();
  registerDevice(db, sb, "a", T1, "ios");
  registerDevice(db, sb, "a", T2, "ios");
  let sent: ExpoMessage[] = [];
  let auth = "";
  const fakeFetch = (async (url: string, init: RequestInit) => {
    assert.equal(url, "https://exp.host/--/api/v2/push/send");
    auth = (init.headers as Record<string, string>).Authorization ?? "";
    sent = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ data: [{ status: "ok", id: "x" }, { status: "error", details: { error: "DeviceNotRegistered" } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  const msgs = buildPushMessages({ box: "b", kind: "done" }, listDeviceTokens(db, sb, "a"), "t");
  const n = await sendExpoPush(msgs, { fetch: fakeFetch, prune: (t) => pruneToken(db, t), accessToken: "tok" });
  assert.equal(n, 1);
  assert.equal(sent.length, 2);
  assert.equal(auth, "Bearer tok");
  assert.deepEqual(listDeviceTokens(db, sb, "a"), [sent[0].to]);
});

test("a failed request throws (so the notifier does not mark it delivered)", async () => {
  const f = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
  await assert.rejects(sendExpoPush(buildPushMessages({ box: "b", kind: "done" }, [T1], "t"), { fetch: f, prune: () => {} }));
});

test("per-owner rate cap bounds a storm", () => {
  let t = 0;
  const cap = makeOwnerRateCap(3, 60_000, () => t);
  assert.deepEqual([1, 2, 3, 4].map(() => cap.allow("a")), [true, true, true, false]);
  assert.equal(cap.allow("b"), true, "other owners unaffected");
  t = 61_000;
  assert.equal(cap.allow("a"), true);
});
