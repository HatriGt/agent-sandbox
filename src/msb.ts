/**
 * Thin wrapper over the microsandbox CLI (`msb`), exposing only the operations the
 * orchestrator needs. Command shapes are the ones verified in docs/runbook.md.
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

/**
 * Build egress allowlist flags: deny by default, allow DNS + each allowed domain on tcp:443.
 * This means a leaked token in the box is useless off-list — the box can only reach ccproxy,
 * npm, GitHub, and any per-call extras.
 */
function egressFlags(cfg: Config): string[] {
  const flags = ["--net-default-egress", "deny", "--net-rule", "allow@dns"];
  for (const domain of cfg.egressDomains) {
    flags.push("--net-rule", `allow@${domain}:tcp:443`);
  }
  return flags;
}

export interface CreateBoxOpts {
  name: string;
  /** Remote path on the VPS (staging dir) to bake into /workspace at boot. */
  copyDir: string;
}

/**
 * Create a detached box with the repo present at /workspace, a curated egress allowlist, a
 * memory cap, and auto-teardown timers.
 *
 * msb 0.6.9 rejects `--copy-dir` combined with `--from-snapshot` ("patches cannot be combined
 * with from_snapshot"), so:
 *  - base image  -> bake the repo in at boot via --copy-dir (fastest, one step)
 *  - snapshot    -> boot warm (claude+gh pre-baked), then `msb cp` the staged tree into /workspace
 */
export async function createBox(cfg: Config, opts: CreateBoxOpts): Promise<void> {
  const common = [
    "run",
    "-d",
    "--name",
    opts.name,
    "-m",
    cfg.memory,
    ...egressFlags(cfg),
    "--idle-timeout",
    cfg.idleTimeout,
    "--max-duration",
    cfg.maxDuration,
    "--pull",
    "never",
  ];

  if (cfg.snapshot) {
    // No -w /workspace here: it doesn't exist in the snapshot at boot. Agent commands cd into
    // it themselves. Copy the staged tree in post-boot (copy-dir is disallowed with snapshots).
    await msb(cfg, [...common, "--from-snapshot", cfg.snapshot, "--", "sleep", "infinity"]);
    // `msb copy <dir> box:/dest` copies the dir *into* /dest (trailing /. is ignored), so copy
    // to a temp path then move the contents into /workspace to avoid a nested subdir.
    await msb(cfg, ["copy", opts.copyDir, `${opts.name}:/.wt`]);
    await exec(
      cfg,
      opts.name,
      "mkdir -p /workspace && cp -a /.wt/. /workspace/ && rm -rf /.wt"
    );
  } else {
    // Base image: bake the repo in at boot and set the workdir.
    await msb(cfg, [
      ...common,
      "-w",
      "/workspace",
      "--copy-dir",
      `${opts.copyDir}:/workspace`,
      cfg.image,
      "--",
      "sleep",
      "infinity",
    ]);
  }
}


/** Run a shell command inside the box (no cred env). */
export async function exec(cfg: Config, box: string, sh: string) {
  return msb(cfg, ["exec", box, "--", "sh", "-lc", sh]);
}

/** Install the agent toolchain (claude + gh) into a box. Used when baking the warm snapshot. */
export async function installTools(cfg: Config, box: string) {
  return exec(
    cfg,
    box,
    "set -e; command -v claude >/dev/null || npm i -g @anthropic-ai/claude-code; " +
      "command -v gh >/dev/null || (type apt-get >/dev/null 2>&1 && apt-get update -qq && " +
      "apt-get install -y -qq gh >/dev/null 2>&1) || true; claude --version; gh --version | head -1"
  );
}

/** Count currently live boxes (for the concurrency cap). Header line is excluded. */
export async function countBoxes(cfg: Config): Promise<number> {
  const r = await msb(cfg, ["ls"], false);
  const lines = r.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  // Drop the header row ("NAME  IMAGE  ...") if present.
  const dataLines = lines.filter((l) => !l.startsWith("NAME") && !/no sandboxes/i.test(l));
  return dataLines.length;
}

/**
 * Env flags shared by agent runs: ccproxy model access, the task text (via AGENT_TASK env so
 * it's data, never part of the command string), and any credentials so the in-box agent can
 * push and open PRs exactly like local Claude Code.
 */
// Standing policy injected as a system prompt on every run/resume. Kept as env data (like the
// task) so it never touches the command string. No AI attribution in commits or PRs.
const AGENT_SYS_PROMPT =
  "Never add AI attribution to git commits or pull requests. Do not include " +
  '"Generated with Claude Code", "Co-Authored-By: Claude", any 🤖 marker, or similar ' +
  "AI/assistant credit in commit messages, PR titles, or PR bodies. Write them as a human author would.";

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
    "-e",
    `AGENT_SYS_PROMPT=${AGENT_SYS_PROMPT}`,
  ];
  if (cfg.ghToken) flags.push("-e", `GH_TOKEN=${cfg.ghToken}`, "-e", `GITHUB_TOKEN=${cfg.ghToken}`);
  if (cfg.npmToken) flags.push("-e", `NPM_TOKEN=${cfg.npmToken}`);
  return flags;
}

/**
 * One-time in-box setup so the agent behaves like local Claude Code: install the agent + gh,
 * authenticate git via gh (credential helper), set the commit identity, and wire npm auth.
 * Idempotent — safe to run before every task; a snapshot warm-start makes it near-instant.
 */
function bootstrapScript(cfg: Config): string {
  const lines = [
    "set -e",
    "command -v claude >/dev/null || npm i -g @anthropic-ai/claude-code",
  ];
  if (cfg.ghToken) {
    lines.push(
      // Install gh if missing (Debian/Ubuntu node image).
      "command -v gh >/dev/null || (type apt-get >/dev/null 2>&1 && " +
        "(apt-get update -qq && apt-get install -y -qq gh >/dev/null 2>&1 || npm i -g gh >/dev/null 2>&1)) || true",
      // Make git use gh's token for HTTPS pushes + let gh open PRs.
      "gh auth setup-git >/dev/null 2>&1 || true"
    );
  }
  if (cfg.gitAuthorName) {
    lines.push(`git config --global user.name ${shellQuote(cfg.gitAuthorName)}`);
  }
  if (cfg.gitAuthorEmail) {
    lines.push(`git config --global user.email ${shellQuote(cfg.gitAuthorEmail)}`);
  }
  if (cfg.npmToken) {
    lines.push(
      'printf "//registry.npmjs.org/:_authToken=%s\\n" "$NPM_TOKEN" > "$HOME/.npmrc"'
    );
  }
  return lines.join(" && ");
}

// Agent invocation reads the task from $AGENT_TASK (set via -e), so the task text is data.
// Claude Code refuses --dangerously-skip-permissions as root (boxes run as root), so we grant
// the concrete tools the agent needs instead. Bash covers git/gh/npm; this is safe because the
// box is an isolated microVM with a curated egress allowlist. --allowedTools takes multiple
// space-separated values, so it goes LAST in the command.
const ALLOWED_TOOLS = "Bash Edit Write Read Glob Grep";
// --append-system-prompt carries the standing no-attribution policy (via env, so it's data).
const RUN_SH =
  `cd /workspace && claude -p "$AGENT_TASK" --append-system-prompt "$AGENT_SYS_PROMPT" --allowedTools ${ALLOWED_TOOLS} 2>&1 | tee -a /workspace/.agent.log`;
const RESUME_SH =
  `cd /workspace && claude -c -p "$AGENT_TASK" --append-system-prompt "$AGENT_SYS_PROMPT" --allowedTools ${ALLOWED_TOOLS} 2>&1 | tee -a /workspace/.agent.log`;

/**
 * Bootstrap creds/tools, then run the task headless in the box.
 * Creds are injected here (per-exec) so they only exist for the task duration.
 */
export async function runAgentTask(cfg: Config, box: string, task: string) {
  await msb(cfg, ["exec", box, ...agentEnvFlags(cfg, task), "--", "sh", "-lc", bootstrapScript(cfg)]);
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

/** Boot a plain box (no repo copy) from the base image — used to bake a warm-start snapshot. */
export async function createBareBox(cfg: Config, name: string): Promise<void> {
  await msb(cfg, [
    "run",
    "-d",
    "--name",
    name,
    "-m",
    cfg.memory,
    "--net",
    "public",
    "--pull",
    "if-missing",
    cfg.image,
    "--",
    "sleep",
    "infinity",
  ]);
}

/** Stop a box (no remove) so it can be snapshotted. */
export async function stopBox(cfg: Config, box: string): Promise<void> {
  await msb(cfg, ["stop", box], false);
}

/** Create a named snapshot from a stopped box. */
export async function snapshotCreate(cfg: Config, fromBox: string, name: string): Promise<void> {
  await msb(cfg, ["snapshot", "create", "--force", "--from", fromBox, name]);
}

/** Stop then remove the box, and clean its staging dir on the VPS if given. */
export async function teardown(cfg: Config, box: string, stagingDir?: string): Promise<void> {
  await msb(cfg, ["stop", box], false);
  await msb(cfg, ["rm", "--force", box], false);
  if (stagingDir) {
    await run("ssh", [cfg.vpsSsh, `rm -rf ${shellQuote(stagingDir)}`], { check: false });
  }
}
