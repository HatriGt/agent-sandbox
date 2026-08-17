/**
 * Multi-repo staging paths (pure). Each repo stages into <sessionRoot>/<name>; the whole
 * session root is later copied into /workspace so each repo becomes /workspace/<name>.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { stagingPathFor, repoStagingPath } from "../src/sync.ts";
import type { Config } from "../src/config.ts";

const cfg = { vpsStagingDir: "/root/stg" } as unknown as Config;

test("stagingPathFor is the per-session root", () => {
  assert.equal(stagingPathFor(cfg, "s1"), "/root/stg/s1");
});

test("repoStagingPath nests each repo under the session root by name", () => {
  assert.equal(repoStagingPath(cfg, "s1", "frontend"), "/root/stg/s1/frontend");
  assert.equal(repoStagingPath(cfg, "s1", "backend"), "/root/stg/s1/backend");
});
