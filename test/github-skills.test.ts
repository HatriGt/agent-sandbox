import { test } from "node:test";
import assert from "node:assert/strict";
import { toSkillName, listRepoSkills, fetchRepoFile } from "../src/github-skills.js";

/**
 * The proxy's guard rails. These reject BEFORE any network call, so the assertions below are
 * offline — the point is that a malformed owner/repo/path never reaches GitHub with our IP on it.
 */

test("toSkillName slugifies folders and filenames", () => {
  assert.equal(toSkillName("frontend-design"), "frontend-design");
  assert.equal(toSkillName("Frontend Design.md"), "frontend-design");
  assert.equal(toSkillName("PDF_Processing.SKILL.md"), "pdf-processing");
  assert.equal(toSkillName("!!!"), "imported-skill");
});

test("listRepoSkills rejects a malformed owner or repo before fetching", async () => {
  await assert.rejects(() => listRepoSkills("anthropics", "sk ills"), /owner\/repo/);
  await assert.rejects(() => listRepoSkills("../etc", "skills"), /owner\/repo/);
  await assert.rejects(() => listRepoSkills("anthropics", "skills", "a branch"), /branch/i);
});

test("fetchRepoFile rejects traversal and non-markdown paths", async () => {
  const ok = ["anthropics", "skills", "main"] as const;
  await assert.rejects(() => fetchRepoFile(...ok, "../../etc/passwd.md"), /Invalid file path/);
  await assert.rejects(() => fetchRepoFile(...ok, "/etc/passwd.md"), /Invalid file path/);
  await assert.rejects(() => fetchRepoFile(...ok, "skills/x/run.sh"), /markdown/);
});
