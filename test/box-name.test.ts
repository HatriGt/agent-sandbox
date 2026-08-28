import test from "node:test";
import assert from "node:assert/strict";
import { isBoxName, stagingPathFor } from "../src/sync.js";
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
