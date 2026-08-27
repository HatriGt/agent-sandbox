import test from "node:test";
import assert from "node:assert/strict";
import { assertRepoName, parseStatus } from "../src/git-ops.ts";

test("status: branch, upstream, ahead/behind and change count come out of porcelain -sb", () => {
  const out = ["## fix/retry-clock...origin/fix/retry-clock [ahead 2, behind 1]", " M src/retry.ts", "?? src/clock.ts", ""].join("\n");
  const s = parseStatus("queue-service", out, "3c38610 Inject a clock");
  assert.equal(s.branch, "fix/retry-clock");
  assert.equal(s.upstream, "origin/fix/retry-clock");
  assert.equal(s.ahead, 2);
  assert.equal(s.behind, 1);
  assert.equal(s.changed, 2);
  assert.equal(s.clean, false);
  assert.equal(s.lastCommit, "3c38610 Inject a clock");
});

test("status: no upstream, clean tree, fresh repo", () => {
  assert.deepEqual(parseStatus("r", "## main\n", ""), { repo: "r", branch: "main", upstream: undefined, ahead: 0, behind: 0, lastCommit: undefined, clean: true, changed: 0 });
  assert.equal(parseStatus("r", "## No commits yet on main\n", "").branch, "main");
  assert.equal(parseStatus("r", "## HEAD (no branch)\n", "abc s").branch, "HEAD (detached)");
});

test("repo names are confined to a single safe path segment", () => {
  assert.equal(assertRepoName("queue-service"), "queue-service");
  for (const bad of ["../x", "a/b", "", " x", "-x", "a;b"]) assert.throws(() => assertRepoName(bad), bad);
});
