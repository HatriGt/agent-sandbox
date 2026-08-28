import test from "node:test";
import assert from "node:assert/strict";
import { openMemoryDb } from "../src/db.js";
import { upsertGithubUser, recordBoxOwner } from "../src/identity.js";
import { guardDeps, makeOwnership, NotOwnedError, QuotaError, withPrincipal } from "../src/tenancy.js";
import type { HandlerDeps } from "../src/handlers.js";
import type { Config } from "../src/config.js";

const cfg = { userMaxBoxes: 2 } as Config;

function fakeDeps(calls: string[]): HandlerDeps {
  return {
    countBoxes: async () => 0,
    resolveGitAccess: async () => ({ ok: true, ownerTokens: {}, ownerLogins: {}, primaryToken: undefined, primaryLogin: undefined }) as never,
    runDelegation: async () => ({ box: "pool-new", warm: true, output: "" }) as never,
    status: async (_c, s) => (calls.push(`status:${s}`), "ok"),
    resume: async (_c, s) => (calls.push(`resume:${s}`), "ok"),
    teardown: async (_c, s) => void calls.push(`teardown:${s}`),
    poolStatus: async () => "",
    monitor: async () => "",
    watch: async (_c, s) => (calls.push(`watch:${s}`), "ok"),
    ask: async (_c, s) => (calls.push(`ask:${s}`), "ok"),
    addGhToken: async () => "",
  } as unknown as HandlerDeps;
}

test("tenancy: a user's calls reach only their own boxes; the operator reaches all", async () => {
  const db = openMemoryDb();
  const alice = upsertGithubUser(db, { githubId: "1", login: "alice" });
  const bob = upsertGithubUser(db, { githubId: "2", login: "bob" });
  recordBoxOwner(db, "pool-a", alice.id);
  recordBoxOwner(db, "pool-b", bob.id);
  const calls: string[] = [];
  const deps = guardDeps(fakeDeps(calls), makeOwnership(db, cfg));
  const asAlice = <T>(fn: () => T) => withPrincipal({ kind: "user", userId: alice.id, login: "alice", role: "user", via: "session" }, fn);

  assert.equal(await asAlice(() => deps.status(cfg, "pool-a")), "ok");
  await assert.rejects(asAlice(() => deps.status(cfg, "pool-b")), NotOwnedError);
  await assert.rejects(asAlice(() => deps.resume(cfg, "pool-b", "hi")), NotOwnedError);
  await assert.rejects(asAlice(() => deps.teardown(cfg, "pool-b")), NotOwnedError);
  await assert.rejects(asAlice(() => deps.watch(cfg, "pool-legacy")), NotOwnedError, "no ownership record → not yours");
  // Outside a request the operator acts.
  assert.equal(await deps.status(cfg, "pool-b"), "ok");
  assert.deepEqual(calls, ["status:pool-a", "status:pool-b"]);
});

test("tenancy: a delegation records its owner; teardown forgets it", async () => {
  const db = openMemoryDb();
  const alice = upsertGithubUser(db, { githubId: "1", login: "alice" });
  const own = makeOwnership(db, cfg);
  const deps = guardDeps(fakeDeps([]), own);
  const asAlice = <T>(fn: () => T) => withPrincipal({ kind: "user", userId: alice.id, login: "alice", role: "user", via: "apikey" }, fn);
  await asAlice(() => deps.runDelegation(cfg, { task: "Fix it\nmore", source: "git", repos: [] } as never));
  assert.equal(await asAlice(() => deps.status(cfg, "pool-new")), "ok", "the creator owns the box");
  assert.deepEqual(asAlice(() => own.visible([{ name: "pool-new", role: "pool-claimed" }, { name: "pool-free-1", role: "pool-free" }, { name: "pool-x", role: "pool-claimed" }])), [{ name: "pool-new", role: "pool-claimed" }]);
  await asAlice(() => deps.teardown(cfg, "pool-new"));
  await assert.rejects(asAlice(() => deps.status(cfg, "pool-new")), NotOwnedError);
});

test("tenancy: quota counts only the user's running boxes", () => {
  const db = openMemoryDb();
  const alice = upsertGithubUser(db, { githubId: "1", login: "alice" });
  recordBoxOwner(db, "a1", alice.id);
  recordBoxOwner(db, "a2", alice.id);
  const own = makeOwnership(db, cfg);
  const fleet = [
    { name: "a1", boxStatus: "Running" },
    { name: "a2", boxStatus: "Stopped" },
    { name: "someone-else", boxStatus: "Running" },
  ];
  withPrincipal({ kind: "user", userId: alice.id, login: "alice", role: "user", via: "session" }, () => {
    assert.equal(own.liveOwned(fleet), 1);
    assert.doesNotThrow(() => own.assertQuota(1, 2));
    assert.throws(() => own.assertQuota(2, 2), QuotaError);
  });
  assert.doesNotThrow(() => own.assertQuota(99, 2), "operators are not quota'd");
});
