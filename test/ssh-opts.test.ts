/**
 * Phase 1 / Step 5 — ssh extra opts for containerized deploy (TDD).
 * The container needs `-i <key>` and a host-key policy; sshMuxOpts must include configured extras.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sshMuxOpts } from "../src/ssh.ts";
import type { Config } from "../src/config.ts";

function cfg(extra?: string[]): Config {
  return { vpsSsh: "root@host", sshPersist: "120", sshExtraOpts: extra } as unknown as Config;
}

test("no extras -> base mux opts only", () => {
  const opts = sshMuxOpts(cfg());
  assert.ok(opts.includes("ControlMaster=auto"));
  assert.ok(!opts.join(" ").includes("id_ed25519"));
});

test("extras are appended verbatim (e.g. -i key, StrictHostKeyChecking)", () => {
  const opts = sshMuxOpts(cfg(["-i", "/root/.ssh/id_ed25519", "-o", "StrictHostKeyChecking=accept-new"]));
  const s = opts.join(" ");
  assert.ok(s.includes("-i /root/.ssh/id_ed25519"));
  assert.ok(s.includes("StrictHostKeyChecking=accept-new"));
  // base opts still present
  assert.ok(s.includes("ControlMaster=auto"));
});
