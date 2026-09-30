/**
 * The agent selector: "claude" (Claude Code) vs "omp" (oh-my-pi). The kind gates which CLI a run
 * launches, so an invalid value must never pass validation — it would land inside a shell command.
 * Prefs are a per-owner encrypted blob (user_blobs), same store the notify settings use.
 */
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { openMemoryDb } from "../src/db.js";
import { makeSecretBox } from "../src/secretbox.js";
import { registerUserStoreBackend, saveBlob } from "../src/user-store.js";
import { withPrincipal } from "../src/tenancy.js";
import {
  isAgentKind,
  normalizeAgentPrefs,
  loadAgentPrefs,
  saveAgentPrefs,
  AGENT_KINDS,
} from "../src/agent-kind.js";

test("isAgentKind accepts exactly the known kinds", () => {
  assert.equal(isAgentKind("claude"), true);
  assert.equal(isAgentKind("omp"), true);
  assert.equal(isAgentKind("aider"), false);
  assert.equal(isAgentKind(""), false);
  assert.equal(isAgentKind(undefined), false);
  assert.equal(isAgentKind("omp; rm -rf /"), false);
  assert.equal(isAgentKind("codex"), true);
  assert.equal(isAgentKind("opencode"), true);
  assert.deepEqual(AGENT_KINDS, ["claude", "omp", "codex", "opencode"]);
});

test("normalizeAgentPrefs: defaults, accepts valid picks, rejects garbage", () => {
  assert.deepEqual(normalizeAgentPrefs({}), { defaultAgent: "claude" });
  assert.deepEqual(normalizeAgentPrefs(undefined), { defaultAgent: "claude" });
  assert.deepEqual(normalizeAgentPrefs({ defaultAgent: "omp" }), { defaultAgent: "omp" });
  assert.throws(() => normalizeAgentPrefs({ defaultAgent: "gpt-agent" }), /defaultAgent/);
});

test("agent prefs round-trip per owner; missing blob means claude", () => {
  const db = openMemoryDb();
  registerUserStoreBackend({ db, box: makeSecretBox(crypto.randomBytes(32)) });
  const alice = { kind: "user" as const, userId: "u_ak", login: "alice", role: "user" as const, via: "session" as const };
  assert.deepEqual(withPrincipal(alice, () => loadAgentPrefs()), { defaultAgent: "claude" });
  withPrincipal(alice, () => saveAgentPrefs({ defaultAgent: "omp" }));
  assert.deepEqual(withPrincipal(alice, () => loadAgentPrefs()), { defaultAgent: "omp" });
  // Another principal (the operator) is unaffected.
  assert.deepEqual(loadAgentPrefs(), { defaultAgent: "claude" });
});

test("a corrupted stored blob degrades to the default, never throws", () => {
  const db = openMemoryDb();
  registerUserStoreBackend({ db, box: makeSecretBox(crypto.randomBytes(32)) });
  const alice = { kind: "user" as const, userId: "u_ak2", login: "alice", role: "user" as const, via: "session" as const };
  withPrincipal(alice, () => saveBlob("agent-prefs", "not json"));
  assert.deepEqual(withPrincipal(alice, () => loadAgentPrefs()), { defaultAgent: "claude" });
  withPrincipal(alice, () => saveBlob("agent-prefs", JSON.stringify({ defaultAgent: "bogus" })));
  assert.deepEqual(withPrincipal(alice, () => loadAgentPrefs()), { defaultAgent: "claude" });
});
