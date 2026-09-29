/**
 * The in-box ~/.git-credentials builder. Per-owner entries win by longest-prefix match
 * (credential.useHttpPath); the DEFAULT account rides as a host-level fallback so a task-only box
 * (no resolved repos) can still `git clone` what the connected account can read — previously such
 * a box had no git credential helper at all and stopped to ask for a token the profile held.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { gitCredentialsScript } from "../src/msb.js";

test("per-owner entries only — no fallback line without a default token", () => {
  const sh = gitCredentialsScript({ acme: "ghp_owner" });
  assert.match(sh, /x-access-token:ghp_owner@github\.com\/acme/);
  assert.match(sh, /credential\.useHttpPath true/);
  assert.doesNotMatch(sh, /@github\.com'\s/, "no bare-host entry");
});

test("task-only box: the default account becomes a host-level git fallback", () => {
  const sh = gitCredentialsScript({}, "ghp_default");
  assert.match(sh, /credential\.helper store/);
  assert.match(sh, /x-access-token:ghp_default@github\.com'/);
  assert.doesNotMatch(sh, /github\.com\//, "no per-owner path without owners");
});

test("both: owner lines precede the fallback; nothing at all when empty", () => {
  const sh = gitCredentialsScript({ acme: "ghp_owner" }, "ghp_default");
  const ownerAt = sh.indexOf("github.com/acme");
  const fbAt = sh.indexOf("ghp_default@github.com");
  assert.ok(ownerAt >= 0 && fbAt > ownerAt);
  assert.equal(gitCredentialsScript({}), "");
});
