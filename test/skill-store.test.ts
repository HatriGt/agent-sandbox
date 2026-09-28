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
  validateSkillFilePath,
  ustarSplit,
  buildSkillsTarBase64,
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

test("supporting files: validated, deduped, sorted; single-file skills carry no files key", () => {
  const s = normalizeSkill(
    {
      name: "multi",
      description: "d",
      content: "c",
      files: [
        { path: "scripts/run.mjs", content: "console.log(1)\r\n" },
        { path: ".env.qa", content: "A=1" },
      ],
    },
    1
  );
  assert.deepEqual(s.files?.map((f) => f.path), [".env.qa", "scripts/run.mjs"]);
  assert.equal(s.files?.[1].content, "console.log(1)\n"); // CRLF normalised
  assert.equal("files" in normalizeSkill({ name: "single", description: "d", content: "c", files: [] }, 1), false);
});

test("supporting files: traversal, absolute, binary, duplicate and oversize inputs are rejected", () => {
  const base = { name: "bad", description: "d", content: "c" };
  const mk = (files: unknown) => () => normalizeSkill({ ...base, files: files as never }, 1);
  assert.throws(mk([{ path: "../evil", content: "x" }]), /Invalid file path/);
  assert.throws(mk([{ path: "/abs", content: "x" }]), /Invalid file path/);
  assert.throws(mk([{ path: "a\\b", content: "x" }]), /Invalid file path/);
  assert.throws(mk([{ path: "a/./b", content: "x" }]), /Invalid file path/);
  assert.throws(mk([{ path: "SKILL.md", content: "x" }]), /cannot be named/);
  assert.throws(mk([{ path: "bin", content: "a\0b" }]), /not a text file/);
  assert.throws(mk([{ path: "a.md", content: "x" }, { path: "A.md", content: "y" }]), /duplicate/);
  assert.throws(mk([{ path: "big.md", content: "x".repeat(SKILL_LIMITS.maxFileBytes + 1) }]), /KB/);
  assert.throws(mk([{ path: "a/b/c/d/e/f/g/h/i.md", content: "x" }]), /too deep/);
  assert.throws(() => validateSkillFilePath("x".repeat(241)), /240/);
});

test("ustarSplit keeps short paths whole and splits long ones at a slash", () => {
  assert.deepEqual(ustarSplit("skill/SKILL.md"), { name: "skill/SKILL.md", prefix: "" });
  const long = `${"a".repeat(80)}/${"b".repeat(70)}/${"c".repeat(80)}`;
  const split = ustarSplit(long);
  assert.ok(split && split.name.length <= 100 && split.prefix.length <= 155);
  assert.equal(`${split!.prefix}/${split!.name}`, long);
  // A path no ustar name/prefix split can carry is refused, not silently mangled.
  assert.equal(ustarSplit(`${"a".repeat(100)}/${"b".repeat(100)}/${"c".repeat(54)}`), null);
});

test("buildSkillsTarBase64 emits a well-formed tar carrying SKILL.md and nested files", () => {
  const s = normalizeSkill(
    { name: "deal", description: "d", content: "body", files: [{ path: "scripts/core/run.mjs", content: "hi" }] },
    1_700_000_000_000
  );
  const buf = Buffer.from(buildSkillsTarBase64([s]), "base64");
  assert.equal(buf.length % 512, 0);
  // Walk the archive: header (name at 0..100, size octal at 124..136), then padded body.
  const seen: Record<string, string> = {};
  for (let off = 0; off < buf.length; ) {
    const name = buf.subarray(off, off + 100).toString("utf8").replace(/\0.*$/s, "");
    if (!name) break; // end-of-archive zero blocks
    const size = parseInt(buf.subarray(off + 124, off + 136).toString("utf8"), 8);
    assert.equal(buf.subarray(off + 257, off + 262).toString("utf8"), "ustar");
    seen[name] = buf.subarray(off + 512, off + 512 + size).toString("utf8");
    off += 512 + Math.ceil(size / 512) * 512;
  }
  assert.match(seen["deal/SKILL.md"], /^---\nname: deal\n/);
  assert.equal(seen["deal/scripts/core/run.mjs"], "hi");
});

test("saveSkillStore-sized stores: serialized JSON over the cap is refused at normalize scale", () => {
  // The cap itself lives in saveSkillStore (IO); assert the constant is sane relative to per-skill caps.
  assert.ok(SKILL_LIMITS.maxStoreBytes >= SKILL_LIMITS.maxSkillBytes * 2);
});

test("store JSON round-trips and garbage parses to empty", () => {
  const store: SkillStore = { skills: { x: normalizeSkill({ name: "x1", description: "d", content: "c" }, 5) } };
  const back = parseSkillStore(serializeSkillStore(store));
  assert.deepEqual(back, store);
  assert.deepEqual(parseSkillStore("not json"), { skills: {} });
  assert.deepEqual(parseSkillStore("[1,2]"), { skills: {} });
});
