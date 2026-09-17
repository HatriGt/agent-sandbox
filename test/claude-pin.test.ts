/**
 * WS1 — pinned Claude Code in the box.
 *
 * The CLI used to be installed unpinned (`npm i -g @anthropic-ai/claude-code`) behind a
 * `command -v claude ||` guard, which meant (a) a cold box got whatever npm served that day, and
 * (b) a snapshot/warm-pool box NEVER upgraded even when we wanted it to. The install snippet is now
 * version-aware: it compares `claude --version` to the pinned version and (re)installs on mismatch.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { claudeInstallSh } from "../src/msb.ts";

test("install snippet pins the exact version", () => {
  const sh = claudeInstallSh("2.1.273");
  assert.match(sh, /@anthropic-ai\/claude-code@2\.1\.273/);
});

test("install snippet is version-aware, not merely presence-aware", () => {
  const sh = claudeInstallSh("2.1.273");
  // A bare `command -v claude ||` guard would skip the upgrade on a baked snapshot forever.
  assert.doesNotMatch(sh, /command -v claude >\/dev\/null \|\| npm/);
  // The installed version must be consulted so a pin bump reaches existing snapshots/warm boxes.
  assert.match(sh, /claude --version/);
  assert.match(sh, /2\.1\.273/);
});

test("install snippet is a no-op when the pinned version is already installed", () => {
  // Shape: `[ "$(claude --version ...)" = "<ver>" ] || npm i -g ...` — the equality test must
  // short-circuit the install. We assert the structure (grep the guard) rather than executing npm.
  const sh = claudeInstallSh("2.1.273");
  assert.match(sh, /\|\|\s*npm i -g/);
});

test("the version lands in the snippet unquoted-safe (no shell metacharacters accepted)", () => {
  assert.throws(() => claudeInstallSh("2.1.273; rm -rf /"), /version/i);
  assert.throws(() => claudeInstallSh(""), /version/i);
  assert.throws(() => claudeInstallSh("$(whoami)"), /version/i);
});
