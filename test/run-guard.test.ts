import { test } from "node:test";
import assert from "node:assert/strict";

test("warmBoxVerdict: a readable disk above the floor and a claude version pass; each miss has a reason", async () => {
  const { warmBoxVerdict, RUN_MIN_FREE_KB, WARM_HEALTH_SH } = await import("../src/msb.js");
  assert.deepEqual(warmBoxVerdict(`${RUN_MIN_FREE_KB + 1}\n2.1.273 (Claude Code)\n`), { ok: true });
  assert.match((warmBoxVerdict("") as { reason: string }).reason, /could not be read/);
  assert.match((warmBoxVerdict("5000\n2.1.273\n") as { reason: string }).reason, /only 5 MB free/);
  assert.match((warmBoxVerdict(`${RUN_MIN_FREE_KB}\n`) as { reason: string }).reason, /printed nothing/);
  assert.ok(WARM_HEALTH_SH.includes("df -Pk /") && WARM_HEALTH_SH.includes("claude --version"));
});

test("the guarded launch: a disk below the floor writes the note and the 250 mark and prints diskfull; otherwise the agent runs", async () => {
  const { guardedAgentSh, agentSh, diskFullFromLaunch, DiskFullError, RUN_MIN_FREE_KB } = await import("../src/msb.js");
  const sh = guardedAgentSh("/workspace/repo", false);
  assert.ok(sh.includes(`-lt ${RUN_MIN_FREE_KB}`));
  assert.ok(sh.includes("npm cache clean --force"), "the preflight tries to free the caches first");
  assert.ok(sh.includes("echo 250 > /workspace/.agent.done"));
  assert.ok(sh.includes("the sandbox disk is full"));
  assert.ok(sh.includes('echo "diskfull ${F:-0}'));
  assert.ok(sh.endsWith(`else ${agentSh("/workspace/repo", false)}; fi`));
  assert.deepEqual(diskFullFromLaunch("diskfull 1024 3145728\n"), { freeKb: 1024, totalKb: 3145728 });
  assert.equal(diskFullFromLaunch("run:started\n"), undefined);
  const e = new DiskFullError("box-1", 1024, 3145728);
  assert.match(e.message, /^The sandbox disk is full \(1 MB free of 3072 MB\)/);
});

test("claudeRootSource: the image wins over the snapshot, as for omp", async () => {
  const { claudeRootSource } = await import("../src/msb.js");
  const cfg = { image: "node:20", snapshot: "agent-base-3g-2", claudeImage: "" } as never;
  assert.deepEqual(claudeRootSource(cfg), { image: "node:20", snapshot: "agent-base-3g-2" });
  assert.deepEqual(claudeRootSource({ ...(cfg as object), claudeImage: "agent-claude:1" } as never), { image: "agent-claude:1", snapshot: "" });
});

test("agentImageDockerfile: the claude flavor has no omp and writes the baked manifest", async () => {
  const { agentImageDockerfile, BAKED_MANIFEST } = await import("../src/msb.js");
  const df = agentImageDockerfile({ claudeCodeVersion: "2.1.273", ompVersion: "latest" } as never, "node@sha256:abc", ["mcp-remote@0.1.37"], "claude");
  assert.equal(df.match(/^RUN /gm)?.length, 1);
  assert.doesNotMatch(df, /pi-coding-agent|omp --version|BUN_INSTALL/);
  assert.match(df, /@anthropic-ai\/claude-code@2\.1\.273/);
  assert.match(df, /'mcp-remote@0\.1\.37'/);
  assert.ok(df.includes(`npm ls -g --depth=0 --json 2>/dev/null > ${BAKED_MANIFEST}`));
  assert.ok(df.indexOf("npm ls -g") < df.indexOf("rm -rf /usr/local/install/cache"), "the manifest is written before the caches go");
});

test("rememberProvision parses the install's notes into the last-provision record", async () => {
  const { rememberProvision, mcpProvisionState } = await import("../src/msb.js");
  rememberProvision("box-9", ["mcp-skip:'btp-mcp-server' free=120000k", "mcp-fail:'@cap-js/mcp-server@0.1.0'", "mcp-drop:btp,cap"]);
  const { last } = mcpProvisionState();
  assert.equal(last?.box, "box-9");
  assert.deepEqual(last?.skipped, ["btp-mcp-server"]);
  assert.deepEqual(last?.failed, ["@cap-js/mcp-server@0.1.0"]);
  assert.deepEqual(last?.dropped, ["btp", "cap"]);
});

test("the box's temp dir is on the root disk for the agent, login shells and the scrub/prune", async () => {
  const { agentEnvFlags, bootstrapScript, BOX_TMPDIR, OMP_WARM_SCRUB_SH, pruneMcpPackagesSh } = await import("../src/msb.js");
  const flags = agentEnvFlags({ claudeCodeVersion: "2.1.273", egressAllowAll: true } as never, "claude");
  assert.ok(flags.includes(`TMPDIR=${BOX_TMPDIR}`));
  assert.ok(bootstrapScript({ claudeCodeVersion: "2.1.273" } as never).includes(`export TMPDIR=${BOX_TMPDIR}' > /etc/profile.d/asb-tmpdir.sh`));
  assert.ok(OMP_WARM_SCRUB_SH.includes(`${BOX_TMPDIR}/*`));
  assert.ok(pruneMcpPackagesSh().includes(`${BOX_TMPDIR}/*`));
});
