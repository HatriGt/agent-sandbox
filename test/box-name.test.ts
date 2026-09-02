import test from "node:test";
import assert from "node:assert/strict";
import { isBoxName, stagingPathFor, repoStagingPath } from "../src/sync.js";
import { repoDirName } from "../src/delegate-input.js";
import type { Config } from "../src/config.js";

test("box names: plain identifiers pass; traversal, slashes and dot names are rejected", () => {
  for (const ok of ["pool-1787845143307-mdj5l3", "session_1.2", "a"]) assert.equal(isBoxName(ok), true, ok);
  for (const bad of ["../../root", "..", ".", "a/b", "a b", "", "x;rm -rf /", "$(id)", 42, null, undefined]) assert.equal(isBoxName(bad), false, String(bad));
});

test("stagingPathFor never escapes the staging dir", () => {
  const cfg = { vpsStagingDir: "/root/agent-sandbox-staging" } as Config;
  assert.equal(stagingPathFor(cfg, "box-1"), "/root/agent-sandbox-staging/box-1");
  assert.throws(() => stagingPathFor(cfg, "../../root"));
  assert.throws(() => stagingPathFor(cfg, ".."));
});

test("repoStagingPath stays under the session dir", () => {
  const cfg = { vpsStagingDir: "/root/agent-sandbox-staging" } as Config;
  assert.equal(repoStagingPath(cfg, "box-1", "api"), "/root/agent-sandbox-staging/box-1/api");
  // ".." used to collapse the join onto the staging ROOT, which cloneRepoInStaging then `rm -rf`s.
  assert.throws(() => repoStagingPath(cfg, "box-1", ".."));
  assert.throws(() => repoStagingPath(cfg, "box-1", "."));
  assert.throws(() => repoStagingPath(cfg, "box-1", "a/b"));
  assert.throws(() => repoStagingPath(cfg, "..", "api"));
});

test("repoDirName never yields a dot-only directory name", () => {
  // `owner/..` reached repoDirName intact: normalizeRepo accepts it (two non-empty parts) and the
  // charset filter permits ".", so the name was the literal "..".
  for (const repo of ["owner/..", "owner/.", "..", ".", "...", "/a/../"]) {
    const n = repoDirName(repo);
    assert.doesNotMatch(n, /^\.+$/, `${repo} -> ${n}`);
    assert.equal(isBoxName(n), true, `${repo} -> ${n}`);
  }
  assert.equal(repoDirName("atom-insurance/atom-deal-service"), "atom-deal-service");
});
