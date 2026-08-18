/**
 * Thin wrapper over the microsandbox CLI (`msb`), exposing only the operations the
 * orchestrator needs. Command shapes are the ones verified in docs/runbook.md.
 *
 * All calls run on the VPS over SSH so this works whether the MCP is driven from the client
 * or from the box itself. Args are passed as an argv array (no shell interpolation).
 */
import { run, shellQuote } from "./exec.js";
import { sshMuxOpts } from "./ssh.js";
import { reposPromptHint, type RepoLayout } from "./agent-prompt.js";
import { secretEnvFlags } from "./secret-env.js";
import type { Config } from "./config.js";

/**
 * Run `msb <rest>` on the VPS over SSH.
 *
 * ssh re-parses its arguments through the REMOTE shell, so every element (msb path + each
 * arg, including task text and env values) is single-quoted into one remote command string.
 * This keeps argv semantics intact remotely and prevents task/env content from injecting.
 *
 * Uses a multiplexed master connection (sshMuxOpts) so repeated calls skip the ~2s handshake.
 */
async function msb(cfg: Config, rest: string[], check = true) {
  const remoteCmd = [cfg.msb, ...rest].map(shellQuote).join(" ");
  return run("ssh", [...sshMuxOpts(cfg), cfg.vpsSsh, remoteCmd], { check });
}

/** Run an arbitrary remote command over the same multiplexed SSH connection. */
async function ssh(cfg: Config, remoteCmd: string, check = true) {
  return run("ssh", [...sshMuxOpts(cfg), cfg.vpsSsh, remoteCmd], { check });
}

/**
 * Build egress flags. Default is a strict allowlist: deny by default, allow DNS + each allowed
 * domain on tcp:443, so a leaked token is useless off-list. When `allowAll` is set, the box gets
 * open egress (`--net public`) instead — any domain, no allowlist.
 */
function egressFlags(cfg: Config, allowAll = cfg.egressAllowAll): string[] {
  if (allowAll) {
    return ["--net", "public"];
  }
  const flags = ["--net-default-egress", "deny", "--net-rule", "allow@dns"];
  for (const domain of cfg.egressDomains) {
    flags.push("--net-rule", `allow@${domain}:tcp:443`);
  }
  return flags;
}

/**
 * Copy a staged working tree on the VPS into a running box's /workspace.
 * `msb copy <dir> box:/dest` copies the dir *into* /dest (trailing /. ignored), so we copy to a
 * temp path then move the contents into /workspace to avoid a nested subdir.
 */
async function copyTreeIntoBox(cfg: Config, box: string, copyDir: string): Promise<void> {
  await msb(cfg, ["copy", copyDir, `${box}:/.wt`]);
  await exec(cfg, box, "mkdir -p /workspace && cp -a /.wt/. /workspace/ && rm -rf /.wt");
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
    await copyTreeIntoBox(cfg, opts.name, opts.copyDir);
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

// ----- Warm pool -------------------------------------------------------------------------
// Pool boxes are pre-booted from the snapshot with OPEN egress and pre-bootstrapped (claude+gh
// + git/gh auth + npm). Claiming one = copy the repo in, skipping the ~4s boot + bootstrap.
// They're named `<POOL_PREFIX><rand>` so they're discoverable across MCP process respawns.
const POOL_PREFIX = "pool-";

/**
 * Boot one warm pool box: snapshot + open egress + memory cap + auto-teardown, then
 * pre-bootstrap creds/tools so a claim only needs the repo copy. Requires cfg.snapshot.
 */
export async function bootWarmBox(cfg: Config): Promise<string> {
  const name = `${POOL_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await msb(cfg, [
    "run",
    "-d",
    "--name",
    name,
    "-m",
    cfg.memory,
    ...egressFlags(cfg, true), // pooled boxes always boot with open egress
    "--idle-timeout",
    cfg.idleTimeout,
    "--max-duration",
    cfg.maxDuration,
    "--pull",
    "never",
    "--from-snapshot",
    cfg.snapshot,
    "--",
    "sleep",
    "infinity",
  ]);
  // Pre-bootstrap so claims are instant (idempotent; persists in the box rootfs).
  await msb(cfg, ["exec", name, ...agentEnvFlags(cfg, "noop"), "--", "sh", "-lc", bootstrapScript(cfg)]);
  return name;
}

/** All warm pool boxes (claimed or not), newest-name order not guaranteed. */
async function allPoolBoxes(cfg: Config): Promise<string[]> {
  const r = await msb(cfg, ["ls"], false);
  return r.stdout
    .split("\n")
    .map((l) => l.trim().split(/\s+/)[0])
    .filter((n) => n && n.startsWith(POOL_PREFIX));
}

/**
 * Available (unclaimed) warm boxes: a pool box is "claimed" once a repo is copied in, marked by
 * the sentinel file /.claimed. Unclaimed boxes have no such marker.
 */
export async function listPoolBoxes(cfg: Config): Promise<string[]> {
  const boxes = await allPoolBoxes(cfg);
  const available: string[] = [];
  for (const box of boxes) {
    const r = await exec(cfg, box, "test -f /.claimed && echo claimed || echo free");
    if (r.stdout.trim().endsWith("free")) available.push(box);
  }
  return available;
}

/**
 * Claim a warm box for a session: mark it claimed and copy the staged tree into /workspace.
 * The claimed box keeps its pool name as the box id; the caller maps session->box.
 */
export async function claimWarmBox(cfg: Config, box: string, copyDir: string): Promise<void> {
  await exec(cfg, box, "touch /.claimed");
  await copyTreeIntoBox(cfg, box, copyDir);
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

/**
 * Count live user sessions for the concurrency cap. Excludes UNCLAIMED warm pool boxes (they're
 * infrastructure); claimed pool boxes are real sessions and do count.
 */
export async function countBoxes(cfg: Config): Promise<number> {
  const r = await msb(cfg, ["ls"], false);
  const names = r.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("NAME") && !/no sandboxes/i.test(l))
    .map((l) => l.split(/\s+/)[0]);

  let count = 0;
  for (const name of names) {
    if (name.startsWith(POOL_PREFIX)) {
      // Only count claimed pool boxes.
      const c = await exec(cfg, name, "test -f /.claimed && echo claimed || echo free");
      if (c.stdout.trim().endsWith("claimed")) count++;
    } else {
      count++;
    }
  }
  return count;
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
  "AI/assistant credit in commit messages, PR titles, or PR bodies. Write them as a human author would. " +
  // Ask-then-resume for missing secrets: don't fail silently or fabricate credentials.
  "If you are missing a credential or connection detail needed to continue (e.g. a token for a " +
  "private repo, a database URL, an API key), STOP and state clearly the exact environment " +
  "variable name(s) you need and why. The caller will re-run with those provided as env. " +
  "Never print, echo, or log secret values (tokens, passwords, connection strings); refer to them " +
  "only by their env var name.";

function agentEnvFlags(
  cfg: Config,
  task: string,
  repos?: RepoLayout[],
  ghTokenOverride?: string
): string[] {
  // The standing policy plus (when known) the goal-neutral repo-layout hint, so the agent knows
  // where each repo lives (/workspace/<name>). The TASK decides the goal. Passed as env, never argv.
  const sysPrompt = repos?.length
    ? `${AGENT_SYS_PROMPT} ${reposPromptHint(repos)}`
    : AGENT_SYS_PROMPT;
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
    `AGENT_SYS_PROMPT=${sysPrompt}`,
  ];
  // The GH_TOKEN env drives the `gh` CLI (PR creation) for the PRIMARY repo's owner; per-owner
  // git pushes are handled by the ~/.git-credentials entries (gitCredentialsScript). An override
  // (resolved from the token store for the primary repo) wins over the default cfg.ghToken.
  const ghToken = ghTokenOverride ?? cfg.ghToken;
  if (ghToken) flags.push("-e", `GH_TOKEN=${ghToken}`, "-e", `GITHUB_TOKEN=${ghToken}`);
  if (cfg.npmToken) flags.push("-e", `NPM_TOKEN=${cfg.npmToken}`);
  return flags;
}

/** Working dir for the agent: the single repo's dir, or /workspace (parent) for multi-repo. */
function agentWorkdir(repos?: RepoLayout[]): string {
  if (repos && repos.length === 1) return `/workspace/${repos[0].name}`;
  return "/workspace";
}

/**
 * Shell to write per-OWNER git credentials inside the box so a multi-repo/multi-owner task
 * authenticates each repo with the right token. GitHub shares one host across all owners, so we
 * enable `credential.useHttpPath` and write one `~/.git-credentials` line per owner path — git then
 * longest-prefix matches `github.com/<owner>/...` to the correct token. Returns "" when no tokens.
 */
function gitCredentialsScript(ownerTokens: Record<string, string>): string {
  const owners = Object.keys(ownerTokens).filter((o) => o && ownerTokens[o]);
  if (owners.length === 0) return "";
  const lines = [
    "git config --global credential.helper store",
    "git config --global credential.useHttpPath true",
    // Recreate the file fresh each run so a rotated/removed token doesn't linger.
    'GC="$HOME/.git-credentials"; : > "$GC"; chmod 600 "$GC"',
  ];
  for (const owner of owners) {
    const line = `https://x-access-token:${ownerTokens[owner]}@github.com/${owner}`;
    // printf keeps the token off the process list better than echo in ps; still env-free here.
    lines.push(`printf '%s\\n' ${shellQuote(line)} >> "$GC"`);
  }
  return lines.join(" && ");
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

// Stable in-box paths (above per-repo dirs so `status` finds them regardless of repo layout).
const AGENT_LOG = "/workspace/.agent.log";
const DONE_MARK = "/workspace/.agent.done"; // written with the exit code when the run finishes
const RUN_MARK = "/workspace/.agent.running"; // present while a run is in flight

/**
 * Build the background agent command. The agent runs headless and DETACHED so `msb exec` returns
 * immediately (fixing the MCP response timeout): delegate returns the session id in seconds while
 * the task keeps running in the box. Completion is observable via the .agent.done sentinel (holds
 * the exit code); `status` reads it. `resume=true` continues the existing Claude session (-c).
 */
function agentSh(workdir: string, resume: boolean): string {
  const claude = resume
    ? `claude -c -p "$AGENT_TASK"`
    : `claude -p "$AGENT_TASK"`;
  // Run the whole pipeline in a detached subshell; record start/finish sentinels.
  const inner =
    `cd ${workdir} && rm -f ${DONE_MARK} && touch ${RUN_MARK} && ` +
    `{ ${claude} --append-system-prompt "$AGENT_SYS_PROMPT" --allowedTools ${ALLOWED_TOOLS} ` +
    `>> ${AGENT_LOG} 2>&1; echo $? > ${DONE_MARK}; rm -f ${RUN_MARK}; }`;
  // nohup + & so the child outlives the exec shell; redirect all fds so exec doesn't block on them.
  return `nohup sh -c ${shellQuote(inner)} >/dev/null 2>&1 < /dev/null & echo started`;
}

/**
 * Per-repo GitHub credentials resolved from the token store, threaded into a run.
 *  - ownerTokens: owner -> token, written as per-owner ~/.git-credentials entries (multi-owner push).
 *  - primaryToken: token for the primary repo's owner, exported as GH_TOKEN for the `gh` CLI.
 *  - primaryLogin: GitHub login behind primaryToken — sets the in-box git commit identity so commits
 *    are authored as the account whose token actually has access (not the box's default identity).
 */
export interface AgentCreds {
  ownerTokens?: Record<string, string>;
  primaryToken?: string;
  primaryLogin?: string;
}

/**
 * Apply resolved GitHub creds inside the box (after bootstrap):
 *  1. per-owner ~/.git-credentials so each repo pushes with the right token (multi-owner);
 *  2. git commit identity from the token's login (name + noreply email), so authorship matches the
 *     account with access instead of the box default;
 *  3. a GitHub Packages ~/.npmrc line with the primary token so scoped installs
 *     (e.g. @owner/pkg from npm.pkg.github.com) work — needs `read:packages` on the token.
 */
async function applyGitCredentials(cfg: Config, box: string, creds?: AgentCreds): Promise<void> {
  const lines: string[] = [];

  const credScript = gitCredentialsScript(creds?.ownerTokens ?? {});
  if (credScript) lines.push(credScript);

  if (creds?.primaryLogin) {
    // GitHub noreply email keeps the commit linked to the account without exposing a real address.
    const email = `${creds.primaryLogin}@users.noreply.github.com`;
    lines.push(`git config --global user.name ${shellQuote(creds.primaryLogin)}`);
    lines.push(`git config --global user.email ${shellQuote(email)}`);
  }

  if (creds?.primaryToken) {
    // GitHub Packages auth for scoped @owner installs. Appended (not overwriting any npmjs entry).
    const npmrcLine = `//npm.pkg.github.com/:_authToken=${creds.primaryToken}`;
    lines.push(
      `touch "$HOME/.npmrc" && chmod 600 "$HOME/.npmrc" && ` +
        `grep -q npm.pkg.github.com "$HOME/.npmrc" || printf '%s\\n' ${shellQuote(npmrcLine)} >> "$HOME/.npmrc"`
    );
  }

  if (lines.length) await exec(cfg, box, lines.join(" && "));
}

/**
 * Bootstrap creds/tools, then LAUNCH the task headless-and-detached in the box.
 * Returns as soon as the agent is kicked off (not when it finishes) so the caller can return a
 * session id without hitting the MCP timeout. Creds are injected per-exec (task-scoped).
 */
export async function runAgentTask(
  cfg: Config,
  box: string,
  task: string,
  repos?: RepoLayout[],
  creds?: AgentCreds
) {
  const env = agentEnvFlags(cfg, task, repos, creds?.primaryToken);
  const workdir = agentWorkdir(repos);
  await msb(cfg, ["exec", box, ...env, "--", "sh", "-lc", bootstrapScript(cfg)]);
  await applyGitCredentials(cfg, box, creds);
  return msb(cfg, ["exec", box, ...env, "--", "sh", "-lc", agentSh(workdir, false)]);
}

/** Read run state from the sentinels: running | done(code) | idle, plus the log tail. */
export async function agentProgress(cfg: Config, box: string): Promise<string> {
  const r = await exec(
    cfg,
    box,
    `if [ -f ${RUN_MARK} ]; then echo "run:running"; ` +
      `elif [ -f ${DONE_MARK} ]; then echo "run:done exit=$(cat ${DONE_MARK} 2>/dev/null)"; ` +
      `else echo "run:idle"; fi; echo "---LOG---"; tail -n 60 ${AGENT_LOG} 2>/dev/null || true`
  );
  return r.stdout.trim();
}

/** Continue an existing Claude Code session with a follow-up (runbook note: `claude -c -p`). */
export async function resumeAgentTask(
  cfg: Config,
  box: string,
  message: string,
  repos?: RepoLayout[],
  secrets?: Record<string, string>,
  creds?: AgentCreds
) {
  // Ephemeral secrets are appended as extra -e flags on THIS exec only (not stored).
  const env = [...agentEnvFlags(cfg, message, repos, creds?.primaryToken), ...secretEnvFlags(secrets)];
  await applyGitCredentials(cfg, box, creds);
  return msb(cfg, ["exec", box, ...env, "--", "sh", "-lc", agentSh(agentWorkdir(repos), true)]);
}

/** Raw `msb status` for a box (non-fatal if the box is gone). */
export async function status(cfg: Config, box: string) {
  const r = await msb(cfg, ["status", box], false);
  return r.stdout || r.stderr;
}

/** Raw `msb metrics` for a box (CPU/MEM/uptime); non-fatal. */
export async function metrics(cfg: Config, box: string) {
  const r = await msb(cfg, ["metrics", box], false);
  return r.stdout || r.stderr;
}

/** Run the credential/tool bootstrap step only (separated so benchmarks can time it). */
export async function bootstrap(cfg: Config, box: string, task = "noop") {
  return msb(cfg, ["exec", box, ...agentEnvFlags(cfg, task), "--", "sh", "-lc", bootstrapScript(cfg)]);
}

/** Launch only the agent task (assumes bootstrap already ran); separated for benchmarks. */
export async function runAgentOnly(cfg: Config, box: string, task: string) {
  return msb(cfg, ["exec", box, ...agentEnvFlags(cfg, task), "--", "sh", "-lc", agentSh("/workspace", false)]);
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
    await ssh(cfg, `rm -rf ${shellQuote(stagingDir)}`, false);
  }
}
