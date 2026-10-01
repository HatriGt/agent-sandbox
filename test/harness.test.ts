import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { openMemoryDb } from "../src/db.js";
import { makeSecretBox } from "../src/secretbox.js";
import { registerUserStoreBackend } from "../src/user-store.js";
import {
  applyHarness,
  approveHarness,
  buildHarnessBundle,
  BUILTIN_HARNESSES,
  deleteHarness,
  duplicateHarness,
  ensureDefaultHarnesses,
  getHarness,
  HARNESS_LIMITS,
  loadHarnesses,
  normalizeHarness,
  parseHarnessFolder,
  planImport,
  upsertHarness,
  compareFacts,
  type HarnessDef,
} from "../src/harness.js";
import { checkCompareSide, createCompare, getCompare, recordRunHarness, runHarnessOf, listCompares } from "../src/harness-runs.js";
import { skillsForBox } from "../src/skill-store.js";
import { normalizeTrigger } from "../src/triggers.js";

function setup() {
  const db = openMemoryDb();
  registerUserStoreBackend({ db, box: makeSecretBox(crypto.randomBytes(32)) });
  return db;
}

const hj = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ format: "agent-sandbox/harness", version: 1, name: "Careful", rules: { askBeforeGuess: true, planFirst: false, verifyOnDone: true }, ...extra });

function def(over: Partial<HarnessDef> = {}): HarnessDef {
  return { ...normalizeHarness({ name: "H", rules: { askBeforeGuess: false, planFirst: false, verifyOnDone: false } }), ...over };
}

test("validation: name required, egress hostnames only, limits, review state never from input", () => {
  assert.throws(() => normalizeHarness({}), /name/i);
  assert.throws(() => normalizeHarness({ name: "x", egress: ["https://evil.com/path"] }));
  assert.throws(() => normalizeHarness({ name: "x", egress: Array.from({ length: HARNESS_LIMITS.maxEgress + 1 }, (_, i) => `h${i}.com`) }));
  assert.throws(() => normalizeHarness({ name: "x", driver: "not-a-driver" }));
  const h = normalizeHarness({ name: "x", needsReview: false, origin: { kind: "file" } } as never);
  assert.equal(h.needsReview, undefined);
  assert.equal(h.origin, undefined);
  assert.match(h.id, /^hrn_/);
});

test("store is per owner; duplicate and approve", () => {
  setup();
  const a = upsertHarness({ name: "A", rules: {} }, undefined, "u1");
  assert.equal(loadHarnesses("u2").length, 0);
  assert.equal(getHarness(a.id, "u2"), undefined);
  const d = duplicateHarness(a.id, "u1")!;
  assert.notEqual(d.id, a.id);
  assert.equal(loadHarnesses("u1").length, 2);
  assert.equal(approveHarness(a.id, "u2"), undefined);
});

test("resolution precedence: explicit fields win; provider+model travel as a unit; lists replace", () => {
  const h = def({ driver: "codex" as never, providerId: "prv_x", model: "m-harness", egress: ["a.com"], skills: ["s1"], rules: { askBeforeGuess: true, planFirst: false, verifyOnDone: true }, verifyCommand: "npm test" });
  const all = applyHarness(h, { task: "do it" });
  assert.equal(all.body.agent, "codex");
  assert.equal(all.body.provider, "prv_x");
  assert.equal(all.body.model, "m-harness");
  assert.deepEqual(all.body.allowDomains, ["a.com"]);
  assert.deepEqual(all.body.verify, { command: "npm test" });
  assert.match(String(all.body.task), /^Harness rules \(H\):[\s\S]*do it$/);
  // Run names a model only: the harness's provider must NOT be paired with it.
  const m = applyHarness(h, { task: "t", model: "mine", agent: "claude", allowDomains: ["b.com"], verify: { criterion: "x" } });
  assert.equal(m.body.provider, undefined);
  assert.equal(m.body.model, "mine");
  assert.equal(m.body.agent, "claude");
  assert.deepEqual(m.body.allowDomains, ["b.com"]);
  assert.deepEqual(m.body.verify, { criterion: "x" });
  assert.ok(!m.applied.includes("model") && !m.applied.includes("provider"));
  // verifyOnDone without a command: a criterion from the task.
  const c = applyHarness(def({ rules: { askBeforeGuess: false, planFirst: false, verifyOnDone: true } }), { task: "fix bug" });
  assert.match(String((c.body.verify as { criterion: string }).criterion), /fix bug/);
  // An imported, unreviewed harness never runs.
  assert.throws(() => applyHarness(def({ needsReview: true }), { task: "t" }), /reviewed/);
});

test("export: no provider id/key, provider as kind+label, secrets redacted, secret files skipped", () => {
  const h = def({ providerId: "prv_secret", model: "gpt", rulesMd: "Use key sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA please", verifyCommand: "TOKEN=ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA npm test", skills: ["s1"] });
  const out = buildHarnessBundle(h, {
    provider: { kind: "openai", label: "Work" },
    skills: [{ name: "s1", description: "d", content: "body", enabled: true, addedAt: 1, updatedAt: 1, files: [{ path: ".env", content: "X=1" }, { path: "ok.md", content: "fine" }] } as never],
  });
  const text = JSON.stringify(out.bundle);
  assert.ok(!text.includes("prv_secret"));
  assert.ok(!text.includes("sk-ant-api03-AAAA"));
  assert.ok(!text.includes("ghp_AAAA"));
  assert.ok(!text.includes("X=1"));
  assert.ok(out.redacted >= 2);
  assert.deepEqual(out.skipped, ["skills/s1/.env (secret file name)"]);
  const hjFile = JSON.parse(out.bundle.files.find((f) => f.path === "harness.json")!.content);
  assert.deepEqual(hjFile.provider, { kind: "openai", label: "Work" });
  assert.equal(hjFile.budget, undefined);
  // Round-trip: the export re-imports cleanly.
  const parsed = parseHarnessFolder(out.bundle.files);
  assert.equal(parsed.harness.model, "gpt");
});

test("import limits: version, format, forbidden keys, secret shapes, sizes, traversal, hooks ignored", () => {
  assert.throws(() => parseHarnessFolder([]), /empty/);
  assert.throws(() => parseHarnessFolder([{ path: "RULES.md", content: "x" }]), /harness.json/);
  assert.throws(() => parseHarnessFolder([{ path: "harness.json", content: hj({ version: 99 }) }]), /version 99/);
  assert.throws(() => parseHarnessFolder([{ path: "harness.json", content: hj({ format: "other" }) }]), /format/);
  assert.throws(() => parseHarnessFolder([{ path: "harness.json", content: hj({ apiKey: "x" }) }]), /apiKey/);
  assert.throws(() => parseHarnessFolder([{ path: "harness.json", content: hj({ provider: { kind: "openai", baseUrl: "https://x" } }) }]), /baseUrl/);
  assert.throws(() => parseHarnessFolder([{ path: "harness.json", content: hj({ description: "ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }) }]), /secret/);
  assert.throws(() => parseHarnessFolder([{ path: "harness.json", content: hj() }, { path: "../../etc/passwd", content: "x" }]));
  assert.throws(() => parseHarnessFolder([{ path: "harness.json", content: hj() }, { path: "RULES.md", content: "x".repeat(HARNESS_LIMITS.maxBundleFileBytes + 1) }]), /KB/);
  const many = Array.from({ length: HARNESS_LIMITS.maxBundleFiles + 1 }, (_, i) => ({ path: `skills/a/f${i}.md`, content: "x" }));
  assert.throws(() => parseHarnessFolder([{ path: "harness.json", content: hj() }, ...many]), /too many/);
  const ok = parseHarnessFolder([
    // An older bundle's `budget` block is tolerated and ignored.
    { path: "harness.json", content: hj({ budget: { maxMinutes: 5, maxTokens: 10 } }) },
    { path: "hooks/pre.sh", content: "rm -rf /" },
    { path: "verify.sh", content: "#!/bin/sh\n# c\nnpm test\n" },
    { path: "skills/s1/SKILL.md", content: "---\ndescription: hi\n---\nbody" },
  ]);
  assert.equal(ok.verifySh, "npm test");
  assert.ok(ok.warnings.some((w) => w.startsWith("hooks/")));
  assert.equal(ok.skills[0].enabled, false);
});

test("planImport: needsReview, clashing skill renamed never overwritten, provider matched by kind", () => {
  const parsed = parseHarnessFolder([
    { path: "harness.json", content: hj({ provider: { kind: "openai", label: "Other" }, model: "gpt", skills: ["s1"] }) },
    { path: "verify.sh", content: "npm test" },
    { path: "skills/s1/SKILL.md", content: "---\ndescription: new\n---\nnew body" },
  ]);
  const store = { skills: { s1: { name: "s1", description: "old", content: "old body", enabled: true, addedAt: 1, updatedAt: 1 } } } as never;
  const p = planImport(parsed, { store, providers: [{ id: "prv_1", kind: "openai", label: "Mine" }], origin: { kind: "file", at: 1 } });
  assert.equal(p.harness.needsReview, true);
  assert.equal(p.harness.providerId, "prv_1");
  assert.equal(p.addSkills[0].name, "s1-2");
  assert.equal(p.addSkills[0].enabled, false);
  assert.deepEqual(p.harness.skills, ["s1-2"]);
  assert.equal(p.harness.verifyCommand, "npm test");
  const none = planImport(parsed, { store, providers: [], origin: { kind: "file", at: 1 } });
  assert.equal(none.harness.providerId, undefined);
  assert.equal(none.harness.model, undefined);
  assert.deepEqual(none.harness.unresolvedProvider, { kind: "openai", label: "Other" });
});

test("skillsForBox: selection installs named skills regardless of enabled; none = enabled only", () => {
  const store = { skills: { a: { name: "a", enabled: true }, b: { name: "b", enabled: false } } } as never;
  assert.deepEqual(skillsForBox(store, undefined).map((s) => s.name), ["a"]);
  assert.deepEqual(skillsForBox(store, ["b"]).map((s) => s.name), ["b"]);
});

test("compare linking: owner-scoped, harness must match side, one run per side", () => {
  const db = setup();
  const id = createCompare(db, "u1", { task: "t", harnessA: "hrn_aaaaaaa", harnessB: "hrn_bbbbbbb" });
  assert.equal(getCompare(db, "u2", id), undefined);
  assert.equal(checkCompareSide(db, "u2", id, "a", "hrn_aaaaaaa").ok, false);
  assert.equal(checkCompareSide(db, "u1", id, "a", "hrn_bbbbbbb").ok, false);
  assert.equal(checkCompareSide(db, "u1", id, "c", "hrn_aaaaaaa").ok, false);
  assert.equal(checkCompareSide(db, "u1", id, "a", "hrn_aaaaaaa").ok, true);
  recordRunHarness(db, { box: "box-a", owner: "u1", harnessId: "hrn_aaaaaaa", harnessName: "A", skills: ["s"], compareId: id, side: "a" });
  assert.equal(checkCompareSide(db, "u1", id, "a", "hrn_aaaaaaa").ok, false);
  recordRunHarness(db, { box: "box-b", owner: "u1", harnessId: "hrn_bbbbbbb", compareId: id, side: "b" });
  const c = getCompare(db, "u1", id)!;
  assert.deepEqual(c.sides.map((s) => s.box), ["box-a", "box-b"]);
  assert.deepEqual(runHarnessOf(db, "box-a")?.skills, ["s"]);
  assert.equal(listCompares(db, "u1").length, 1);
});

test("compareFacts never fabricates: missing usage/cost/duration stay null", () => {
  const f = compareFacts({ box: "b", state: "done" });
  assert.equal(f.tokens, null);
  assert.equal(f.costUsd, null);
  assert.equal(f.durationMs, null);
  assert.equal(f.verified, null);
  const g = compareFacts({ box: "b", state: "done", usage: { inputTokens: 1, outputTokens: 2 }, startedAt: 10, endedAt: 30, verified: { pass: true } }, 0.5);
  assert.deepEqual(g.tokens, { input: 1, output: 2 });
  assert.equal(g.durationMs, 20);
  assert.equal(g.costUsd, 0.5);
});

test("triggers accept a harness id and reject malformed ones", () => {
  const base = { name: "Fix", kind: "github", repo: "o/r", taskTemplate: "t", spec: { event: "issue_labeled" } };
  const ok = normalizeTrigger({ ...base, harnessId: "hrn_abcdefgh" });
  assert.ok(ok.ok, JSON.stringify(ok));
  assert.equal(ok.ok && ok.trigger.harnessId, "hrn_abcdefgh");
  assert.equal(normalizeTrigger({ ...base, harnessId: "bad id" }).ok, false);
});

test("built-ins: seeded once per owner, idempotent, deletion hides, edits kept, restore, cap respected", () => {
  setup();
  assert.equal(ensureDefaultHarnesses("n1"), BUILTIN_HARNESSES.length);
  assert.equal(ensureDefaultHarnesses("n1"), 0);
  const list = loadHarnesses("n1");
  assert.equal(list.length, BUILTIN_HARNESSES.length);
  assert.ok(list.every((h) => h.builtin && h.id.startsWith("hrn_builtin-") && !h.needsReview));
  assert.ok(list.find((h) => h.builtin === "incident-responder")!.rules.askBeforeGuess);
  // Built-ins pass the same gates as any harness and bring no provider/model of their own.
  const bug = getHarness("hrn_builtin-bug-fixer", "n1")!;
  const r = applyHarness(bug, { task: "fix it" });
  assert.deepEqual(r.applied.sort(), ["rules", "verify"]);
  assert.match(String(r.body.task), /test that fails/);
  // Edit in place keeps the built-in tag; a duplicate is custom.
  const edited = upsertHarness({ ...bug, name: "My bug fixer" }, bug.id, "n1");
  assert.equal(edited.builtin, "bug-fixer");
  assert.equal(duplicateHarness(bug.id, "n1")!.builtin, undefined);
  ensureDefaultHarnesses("n1");
  assert.equal(getHarness(bug.id, "n1")!.name, "My bug fixer");
  // Delete hides it; later reads never bring it back, restore does (without touching edits).
  assert.ok(deleteHarness("hrn_builtin-code-reviewer", "n1"));
  assert.equal(ensureDefaultHarnesses("n1"), 0);
  assert.equal(getHarness("hrn_builtin-code-reviewer", "n1"), undefined);
  assert.equal(ensureDefaultHarnesses("n1", { restore: true }), 1);
  assert.equal(getHarness(bug.id, "n1")!.name, "My bug fixer");
  // An existing account at the cap: nothing forced in; seeded once there is room.
  for (let i = 0; i < HARNESS_LIMITS.maxHarnesses; i++) upsertHarness({ name: `C${i}`, rules: {} }, undefined, "full");
  assert.equal(ensureDefaultHarnesses("full"), 0);
  deleteHarness(loadHarnesses("full")[0].id, "full");
  assert.equal(ensureDefaultHarnesses("full"), 1);
  // A built-in id reaching the delegate path seeds lazily (e.g. the token-mode operator).
  assert.equal(getHarness("hrn_builtin-test-writer", "operator")?.builtin, "test-writer");
});
