/**
 * The transient booting-state copy. Pure, so covered here. Regression: a warm claim (a pre-booted
 * pool box reused instantly) was shown "Booting a fresh microVM" — a visible lie. Only a real cold
 * boot (pool empty) may say that; a warm claim says it's starting on a warm sandbox.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bootingLabel } from "../web/src/lib/booting.ts";

test("bootingLabel: warm claim never says 'fresh microVM'", () => {
  const warm = bootingLabel(true);
  assert.match(warm, /warm/i);
  assert.doesNotMatch(warm, /fresh microVM/i);
});

test("bootingLabel: cold boot says fresh microVM", () => {
  assert.match(bootingLabel(false), /fresh microVM/i);
});
