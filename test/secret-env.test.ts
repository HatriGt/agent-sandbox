/**
 * Pure builder for on-demand secret env flags (ask-then-resume, ephemeral).
 * Turns {KEY: value} into ["-e", "KEY=value", ...] injected per-exec only. Keys and values are
 * shell-quoted downstream; here we assert the flag pairs and safe no-op on empty/undefined.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { secretEnvFlags } from "../src/secret-env.ts";

test("undefined -> no flags", () => {
  assert.deepEqual(secretEnvFlags(undefined), []);
});

test("empty object -> no flags", () => {
  assert.deepEqual(secretEnvFlags({}), []);
});

test("single secret -> one -e KEY=VALUE pair", () => {
  assert.deepEqual(secretEnvFlags({ GITHUB_TOKEN: "ghp_x" }), ["-e", "GITHUB_TOKEN=ghp_x"]);
});

test("multiple secrets -> a pair each, order preserved", () => {
  assert.deepEqual(secretEnvFlags({ A: "1", DB_URL: "postgres://u:p@h/db" }), [
    "-e",
    "A=1",
    "-e",
    "DB_URL=postgres://u:p@h/db",
  ]);
});

test("values with = and spaces are kept verbatim in the KEY=VALUE token", () => {
  assert.deepEqual(secretEnvFlags({ TOKEN: "a=b c" }), ["-e", "TOKEN=a=b c"]);
});

test("controller-owned env cannot be overridden by a caller's secrets", () => {
  // resumeAgentTask appends these flags AFTER agentEnvFlags and a later -e wins, so accepting
  // ANTHROPIC_BASE_URL would point the in-box agent's model traffic at a caller-chosen host.
  for (const k of ["ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY", "AGENT_TASK", "AGENT_SYS_PROMPT", "NPM_TOKEN"]) {
    assert.throws(() => secretEnvFlags({ [k]: "x" }), new RegExp(k));
  }
});

test("secret names must be environment variable names", () => {
  for (const k of ["A=B", "with space", "-e", "1LEADING", ""]) {
    assert.throws(() => secretEnvFlags({ [k]: "v" }), /Invalid secret name/);
  }
  assert.deepEqual(secretEnvFlags({ DB_URL: "x" }), ["-e", "DB_URL=x"]);
});
