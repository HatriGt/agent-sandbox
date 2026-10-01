import { test } from "node:test";
import assert from "node:assert/strict";
import {
  explicitSkills,
  matchSkills,
  mergePicks,
  skillTurnHint,
  skillsIndex,
  skillMdPath,
  INDEX_MAX_ENTRIES,
} from "../src/skill-match.ts";
import { STARTER_SKILLS } from "../src/starter-skills.ts";
import { agentSh } from "../src/msb.ts";
import { AGENT_KINDS } from "../src/agent-kind.ts";

const starters = STARTER_SKILLS.map((s) => ({ name: s.name, description: s.description }));

test("starter descriptions all start with 'Use when' and carry quoted triggers", () => {
  for (const s of starters) {
    assert.match(s.description, /^Use when /, s.name);
    assert.ok(/"[^"]+"/.test(s.description), s.name);
  }
});

test("matchSkills picks the obvious skill for typical tasks", () => {
  const top = (t: string) => matchSkills(t, starters)[0]?.name;
  assert.equal(top("Please fix issue #42 in the parser"), "fix-issue");
  assert.equal(top("write tests for src/digest.ts and increase coverage"), "write-tests");
  assert.equal(top("upgrade dependencies, npm audit is red"), "upgrade-deps");
  assert.equal(top("do a security review of the login flow"), "security-review");
  assert.equal(top("open a PR with a good PR description"), "write-pr-description");
});

test("matchSkills returns nothing for unrelated tasks and at most 3", () => {
  assert.deepEqual(matchSkills("what's the weather like", starters), []);
  assert.deepEqual(matchSkills("", starters), []);
  const many = Array.from({ length: 10 }, (_, i) => ({ name: `deploy-${i}`, description: 'Use when "deploy the app".' }));
  assert.equal(matchSkills("deploy the app now", many).length, 3);
});

test("stoplist: generic words alone never trigger", () => {
  assert.deepEqual(matchSkills("please make a change to the code in this repo", starters), []);
});

test("explicit /skill wins over auto and works on any turn", () => {
  assert.deepEqual(explicitSkills("/code-review then fix issue #4", starters), ["code-review"]);
  assert.deepEqual(explicitSkills("see /workspace/src and https://x/fix-issue", starters), []);
  const first = skillTurnHint("/code-review fix issue #4", starters, true);
  assert.deepEqual(first.picks, [{ name: "code-review", how: "explicit" }]);
  assert.equal(first.hint, `The user asked you to run skill code-review: read ${skillMdPath("code-review")} and follow it.`);
  const later = skillTurnHint("/write-tests now", starters, false);
  assert.deepEqual(later.picks, [{ name: "write-tests", how: "explicit" }]);
});

test("auto hint only on the first turn", () => {
  const first = skillTurnHint("fix issue #12", starters, true);
  assert.match(first.hint, /^Likely relevant skills for this task: fix-issue/);
  assert.match(first.hint, /read them before starting/);
  assert.equal(first.picks[0].how, "auto");
  assert.deepEqual(skillTurnHint("fix issue #12", starters, false), { hint: "", picks: [] });
});

test("mergePicks: explicit overrides auto", () => {
  assert.deepEqual(mergePicks([{ name: "a", how: "auto" }], [{ name: "a", how: "explicit" }, { name: "b", how: "auto" }]), [
    { name: "a", how: "explicit" },
    { name: "b", how: "auto" },
  ]);
});

test("skillsIndex lists name, truncated description and path, capped", () => {
  assert.equal(skillsIndex([]), "");
  const idx = skillsIndex(starters);
  assert.match(idx, /^Skills available/);
  for (const s of starters) assert.ok(idx.includes(skillMdPath(s.name)), s.name);
  const lots = Array.from({ length: 50 }, (_, i) => ({ name: `s${i}`, description: "x".repeat(500) }));
  const big = skillsIndex(lots);
  assert.equal(big.split("\n").filter((l) => l.startsWith("- s")).length, INDEX_MAX_ENTRIES);
  assert.match(big, /and 10 more/);
  assert.ok(!big.includes("x".repeat(200)));
});

test("every driver's prompt assembly appends the skills index and the skill hint", () => {
  for (const kind of AGENT_KINDS) {
    for (const resume of [false, true]) {
      const sh = agentSh("/workspace/repo", resume, kind);
      assert.ok(sh.includes(`AGENT_SYS_PROMPT="$AGENT_SYS_PROMPT $(cat /root/.claude/skills/INDEX.md)"`), `${kind} ${resume}`);
      assert.ok(sh.includes("AGENT_SKILL_HINT"), `${kind} ${resume}`);
      assert.ok(sh.indexOf("skills/INDEX.md") < sh.indexOf("set -o pipefail"), `${kind} ${resume}`);
    }
  }
});
