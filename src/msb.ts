/**
 * Thin wrapper over the microsandbox CLI (`msb`), exposing only the operations the
 * orchestrator needs. Command shapes are the ones verified in docs/runbook.md (Phase 1).
 *
 * All calls run on the VPS over SSH so this works whether the MCP is driven from the client
 * or from the box itself. Args are passed as an argv array (no shell interpolation).
 */
import { run, shellQuote } from "./exec.js";
import type { Config } from "./config.js";

/**
 * Run `msb <rest>` on the VPS over SSH.
 *
 * ssh re-parses its arguments through the REMOTE shell, so every element (msb path + each
 * arg, including task text and env values) is single-quoted into one remote command string.
 * This keeps argv semantics intact remotely and prevents task/env content from injecting.
 */
async function msb(cfg: Config, rest: string[], check = true) {
  const remoteCmd = [cfg.msb, ...rest].map(shellQuote).join(" ");
  return run("ssh", [cfg.vpsSsh, remoteCmd], { check });
}

export interface CreateBoxOpts {
  name: string;
  /** Remote path on the VPS (staging dir) to bake into /workspace at boot. */
  copyDir: string;
}

/**
 * Create a detached box with the repo copied in at boot, egress on, auto-teardown timers set.
 * `--copy-dir` is a BOOT-TIME flag (runbook 1b), so the repo is baked in here on `msb run`.
 */
export async function createBox(cfg: Config, opts: CreateBoxOpts): Promise<void> {
  await msb(cfg, [
    "run",
    "-d",
    "--name",
    opts.name,
    "--net",
    "public",
    "--idle-timeout",
    cfg.idleTimeout,
    "--max-duration",
    cfg.maxDuration,
    "--copy-dir",
    `${opts.copyDir}:/workspace`,
    "-w",
    "/workspace",
    "--pull",
    "never",
    cfg.image,
    "--",
    "sleep",
    "infinity",
  ]);
}

/** Run a shell command inside the box (no cred env). */
export async function exec(cfg: Config, box: string, sh: string) {
  return msb(cfg, ["exec", box, "--", "sh", "-lc", sh]);
}

/**
 * Env flags for the agent run: ccproxy + optional short-lived creds (runbook 1c) + the
 * task text itself (passed via AGENT_TASK env, never interpolated into the shell string, so
 * task content can't break out of quoting or inject commands).
 */
function agentEnvFlags(cfg: Config, task: string): string[] {
  const flags = [
    "-e",
    `ANTHROPIC_BASE_URL=${cfg.anthropicBaseUrl}`,
    "-e",
    `ANTHROPIC_API_KEY=${cfg.anthropicApiKey}`,
    "-e",
    `ANTHROPIC_MODEL=${cfg.anthropicModel}`,
    "-e",
    `AGENT_TASK=${task}`,
  ];
  if (cfg.gitToken) flags.push("-e", `GIT_TOKEN=${cfg.gitToken}`);
  if (cfg.npmToken) flags.push("-e", `NPM_TOKEN=${cfg.npmToken}`);
  return flags;
}

// Agent invocation reads the task from $AGENT_TASK (set via -e), so the task text is data,
// not part of the command string.
const RUN_SH =
  'cd /workspace && claude -p "$AGENT_TASK" --permission-mode acceptEdits 2>&1 | tee -a /workspace/.agent.log';
const RESUME_SH =
  'cd /workspace && claude -c -p "$AGENT_TASK" --permission-mode acceptEdits 2>&1 | tee -a /workspace/.agent.log';

/**
 * Ensure Claude Code is installed, then run the task headless in the box.
 * Creds are injected here (per-exec) so they only exist for the task duration.
 */
export async function runAgentTask(cfg: Config, box: string, task: string) {
  await exec(cfg, box, "command -v claude >/dev/null || npm i -g @anthropic-ai/claude-code");
  return msb(cfg, ["exec", box, ...agentEnvFlags(cfg, task), "--", "sh", "-lc", RUN_SH]);
}

/** Continue an existing Claude Code session with a follow-up (runbook note: `claude -c -p`). */
export async function resumeAgentTask(cfg: Config, box: string, message: string) {
  return msb(cfg, ["exec", box, ...agentEnvFlags(cfg, message), "--", "sh", "-lc", RESUME_SH]);
}

/** Raw `msb status` for a box (non-fatal if the box is gone). */
export async function status(cfg: Config, box: string) {
  const r = await msb(cfg, ["status", box], false);
  return r.stdout || r.stderr;
}

/** Stop then remove the box, and clean its staging dir on the VPS if given. */
export async function teardown(cfg: Config, box: string, stagingDir?: string): Promise<void> {
  await msb(cfg, ["stop", box], false);
  await msb(cfg, ["rm", "--force", box], false);
  if (stagingDir) {
    await run("ssh", [cfg.vpsSsh, `rm -rf ${shellQuote(stagingDir)}`], { check: false });
  }
}
