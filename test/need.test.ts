/** The box's auto-installer (src/drivers/need.ts): the script shape the bootstrap ships. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { needScript, needHook, needSetup, NEED_PATH, NEED_HOOK } from "../src/drivers/need.ts";
import { bootstrapScript, agentEnvFlags } from "../src/msb.ts";
import type { Config } from "../src/config.ts";
const cfg = { claudeCodeVersion: "2.1.273", ompVersion: "latest", anthropicBaseUrl: "http://ccproxy:8080", anthropicApiKey: "sk-test", anthropicModel: "sonnet" } as unknown as Config;

test("need: curated map covers the CLIs live runs stalled on, then falls back by name", () => {
  const s = needScript();
  assert.ok(s.startsWith("#!/bin/sh"));
  for (const c of ["cf)", "kubectl)", "aws)", "az)", "gcloud)", "helm)", "terraform)", "psql|pg_dump)", "redis-cli)"]) assert.ok(s.includes(c), c);
  assert.ok(/\*\) apt_i "\$c" \|\| npm i -g "\$c".*\|\| pip3 install/.test(s));
  assert.ok(s.includes("could not install"), "an unknown name reports, not silently passes");
});

test("need: the bash hook installs then re-runs, and preserves 127 when it cannot", () => {
  const h = needHook();
  assert.ok(h.includes("command_not_found_handle()"));
  assert.ok(h.includes(`${NEED_PATH} "$1"`));
  assert.ok(h.includes('"$@"; return $?'));
  assert.ok(h.includes("return 127"));
  assert.ok(h.includes("ASB_NEED_BUSY"), "no recursion if need itself calls a missing command");
});

test("need: bootstrap installs both and every agent bash sources the hook", () => {
  const setup = needSetup();
  assert.ok(setup.includes(`> ${NEED_PATH} && chmod +x ${NEED_PATH}`));
  assert.ok(setup.includes(`> ${NEED_HOOK}`));
  assert.ok(bootstrapScript(cfg).includes(setup));
  assert.ok(bootstrapScript(cfg, "omp").includes(setup));
  const flags = agentEnvFlags(cfg, "t");
  assert.ok(flags.includes(`BASH_ENV=${NEED_HOOK}`));
});
