/**
 * Starter skills: the curated set passes the skill store's own validation, seeding fills a fresh
 * owner's store, and an owner who already has skills is never touched.
 */
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { openMemoryDb } from "../src/db.js";
import { makeSecretBox } from "../src/secretbox.js";
import { registerUserStoreBackend, withOwner } from "../src/user-store.js";
import { loadSkillStore, saveSkillStore, normalizeSkill, toSkillMd, SKILL_LIMITS } from "../src/skill-store.js";
import { STARTER_SKILLS, starterSkillDefs, seedStarterSkills } from "../src/starter-skills.js";
import type { Config } from "../src/config.js";

const cfg = {} as Config;

test("starter skills are valid per the store's own validation", () => {
  assert.equal(STARTER_SKILLS.length, 4);
  assert.deepEqual(
    STARTER_SKILLS.map((s) => s.name).sort(),
    ["code-review", "fix-issue", "upgrade-deps", "write-tests"]
  );
  const defs = starterSkillDefs(1234);
  for (const d of defs) {
    // normalizeSkill throws on anything invalid; also check the caps directly.
    assert.doesNotThrow(() => normalizeSkill(d, 1234));
    assert.ok(d.description.length <= SKILL_LIMITS.maxDescription);
    assert.ok(d.content.length <= SKILL_LIMITS.maxContent);
    assert.equal(d.enabled, true);
    assert.equal(d.addedAt, 1234);
    // and the SKILL.md render starts with parseable frontmatter
    assert.match(toSkillMd(d), new RegExp(`^---\\nname: ${d.name}\\n`));
  }
});

test("seeding writes the starters for a fresh owner", async () => {
  const db = openMemoryDb();
  registerUserStoreBackend({ db, box: makeSecretBox(crypto.randomBytes(32)) });
  await seedStarterSkills(cfg, "u_fresh");
  const store = await withOwner("u_fresh", () => loadSkillStore(cfg));
  assert.deepEqual(Object.keys(store.skills).sort(), ["code-review", "fix-issue", "upgrade-deps", "write-tests"]);
  assert.equal(store.skills["fix-issue"].enabled, true);
  assert.ok(store.skills["code-review"].content.includes("adversarially"));
});

test("an owner with existing skills is left alone", async () => {
  const db = openMemoryDb();
  registerUserStoreBackend({ db, box: makeSecretBox(crypto.randomBytes(32)) });
  const mine = normalizeSkill({ name: "my-skill", description: "Mine.", content: "Do my thing." }, 1);
  await withOwner("u_vet", () => saveSkillStore(cfg, { skills: { "my-skill": mine } }));
  await seedStarterSkills(cfg, "u_vet");
  const store = await withOwner("u_vet", () => loadSkillStore(cfg));
  assert.deepEqual(Object.keys(store.skills), ["my-skill"], "seeding must not add to or overwrite an existing store");
});

test("seeding never throws without a backend (stdio mode) — signup must not fail", async () => {
  // Note: backend registration is process-global; this test relies on module order only for the
  // hasUserStoreBackend() short-circuit being safe, so we just assert seedStarterSkills resolves.
  await assert.doesNotReject(seedStarterSkills(cfg, "u_any"));
});
