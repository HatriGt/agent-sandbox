/**
 * Tests for the skill store: validation (names, required fields, size caps), the SKILL.md shape
 * Claude Code loads, enable filtering, and round-tripping the persisted JSON.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSkill,
  toSkillMd,
  enabledSkills,
  viewSkills,
  parseSkillStore,
  serializeSkillStore,
  SKILL_LIMITS,
  type SkillStore,
} from "../src/skill-store.ts";

test("normalizeSkill accepts a kebab-case skill and stamps times", () => {
  const s = normalizeSkill({ name: "review-pr", description: "Use when reviewing a pull request.", content: "# Steps\n1. read the diff" }, 1000);
  assert.equal(s.name, "review-pr");
  assert.equal(s.enabled, true);
  assert.equal(s.addedAt, 1000);
  assert.equal(s.updatedAt, 1000);
});

test("normalizeSkill rejects bad names, empty description/content, oversize content", () => {
  assert.throws(() => normalizeSkill({ name: "Bad Name", description: "d", content: "c" }), /kebab-case/);
  assert.throws(() => normalizeSkill({ name: "-lead", description: "d", content: "c" }), /kebab-case/);
  assert.throws(() => normalizeSkill({ name: "ok", description: "", content: "c" }), /description/);
  assert.throws(() => normalizeSkill({ name: "ok", description: "d", content: "  " }), /instructions/);
  assert.throws(() => normalizeSkill({ name: "ok", description: "d", content: "x".repeat(SKILL_LIMITS.maxContent + 1) }), /KB/);
});

test("toSkillMd writes frontmatter Claude Code parses, description safely quoted", () => {
  const s = normalizeSkill({ name: "deploy", description: 'Use for deploys: quotes " and colons.', content: "Run the deploy.\n" }, 1);
  const md = toSkillMd(s);
  assert.match(md, /^---\nname: deploy\ndescription: "Use for deploys: quotes \\" and colons\."\n---\n\nRun the deploy\.\n$/);
});

test("enabledSkills filters and sorts; viewSkills shows everything", () => {
  const store: SkillStore = { skills: {} };
  store.skills.b = normalizeSkill({ name: "b-skill", description: "d", content: "c" }, 1);
  store.skills.a = normalizeSkill({ name: "a-skill", description: "d", content: "c" }, 1);
  store.skills.off = normalizeSkill({ name: "off-skill", description: "d", content: "c", enabled: false }, 1);
  assert.deepEqual(enabledSkills(store).map((s) => s.name), ["a-skill", "b-skill"]);
  assert.equal(viewSkills(store).length, 3);
});

test("store JSON round-trips and garbage parses to empty", () => {
  const store: SkillStore = { skills: { x: normalizeSkill({ name: "x1", description: "d", content: "c" }, 5) } };
  const back = parseSkillStore(serializeSkillStore(store));
  assert.deepEqual(back, store);
  assert.deepEqual(parseSkillStore("not json"), { skills: {} });
  assert.deepEqual(parseSkillStore("[1,2]"), { skills: {} });
});
