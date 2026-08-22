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
import {
  ASK_ALLOWED_TOOLS,
  ASK_DIR,
  ASK_LANE_ENV,
  ASK_LOG,
  ASK_THREAD_MARK,
  askGateNodeProgram,
  askSystemPrompt,
  type AskResult,
} from "./ask.js";
import {
  parseLsJson,
  isRunning,
  classifyBox,
  parseRunState,
  parseMetrics,
  type BoxView,
  type RunState,
  type WatchSnapshot,
} from "./monitor.js";
import type { PollResult } from "./wait.js";
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
async function copyTreeIntoBox(cfg: Config, box: string, copyDir: string | undefined): Promise<void> {
  // Task-only (no repos): nothing staged — just ensure an empty /workspace exists to run in.
  if (!copyDir) {
    await exec(cfg, box, "mkdir -p /workspace");
    return;
  }
  await msb(cfg, ["copy", copyDir, `${box}:/.wt`]);
  await exec(cfg, box, "mkdir -p /workspace && cp -a /.wt/. /workspace/ && rm -rf /.wt");
}

export interface CreateBoxOpts {
  name: string;
  /** Remote path on the VPS (staging dir) to bake into /workspace at boot. Omit for task-only. */
  copyDir?: string;
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
    // Task-only (no copyDir): copyTreeIntoBox just mkdir's an empty /workspace.
    await msb(cfg, [...common, "--from-snapshot", cfg.snapshot, "--", "sleep", "infinity"]);
    await copyTreeIntoBox(cfg, opts.name, opts.copyDir);
  } else if (opts.copyDir) {
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
  } else {
    // Base image, task-only: no repo to bake — boot bare, then create an empty /workspace.
    await msb(cfg, [...common, cfg.image, "--", "sleep", "infinity"]);
    await copyTreeIntoBox(cfg, opts.name, undefined);
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

/**
 * All warm pool boxes with their msb lifecycle status, from `msb ls --format json` (robust to the
 * variable-width text table). Newest-name order not guaranteed.
 */
async function allPoolBoxes(cfg: Config): Promise<Array<{ name: string; status: string }>> {
  const r = await msb(cfg, ["ls", "--format", "json"], false);
  return parseLsJson(r.stdout)
    .filter((e) => e.name.startsWith(POOL_PREFIX))
    .map((e) => ({ name: e.name, status: e.status }));
}

/**
 * Force-remove a wedged box (stop + rm --force), swallowing errors. Used to reap pool boxes that
 * msb reports as Stopped/exited but still has a stale record for — the source of the "already
 * running" desync that leaves a claimed box that never actually runs.
 */
async function forceRemoveBox(cfg: Config, box: string): Promise<void> {
  await msb(cfg, ["stop", box], false);
  await msb(cfg, ["rm", "--force", box], false);
}

/**
 * Reap pool boxes that are not actually Running (Stopped/exited/unknown). Returns the names of the
 * still-Running boxes. Removing dead boxes clears msb's stale state so a later refill can recreate
 * them cleanly instead of hitting "cannot start: already running".
 */
export async function reapDeadPoolBoxes(cfg: Config): Promise<string[]> {
  const boxes = await allPoolBoxes(cfg);
  const live: string[] = [];
  for (const b of boxes) {
    if (isRunning(b.status)) {
      live.push(b.name);
    } else {
      console.error(`[pool] reaping dead box ${b.name} (status=${b.status || "unknown"})`);
      await forceRemoveBox(cfg, b.name);
    }
  }
  return live;
}

/**
 * Available (unclaimed) warm boxes: only RUNNING pool boxes with no /.claimed marker. Stopped or
 * wedged boxes are reaped first so we never hand a dead box to a delegation (which would claim it,
 * record the task, but never run — the box shows run:running while Stopped).
 */
export async function listPoolBoxes(cfg: Config): Promise<string[]> {
  const live = await reapDeadPoolBoxes(cfg);
  const available: string[] = [];
  for (const box of live) {
    try {
      const r = await exec(cfg, box, "test -f /.claimed && echo claimed || echo free");
      if (r.stdout.trim().endsWith("free")) available.push(box);
    } catch {
      // Not execable despite a Running status => wedged; reap it so refill can recreate.
      console.error(`[pool] reaping unexecable box ${box}`);
      await forceRemoveBox(cfg, box);
    }
  }
  return available;
}

/**
 * Claim a warm box for a session: mark it claimed and copy the staged tree into /workspace.
 * The claimed box keeps its pool name as the box id; the caller maps session->box.
 */
export async function claimWarmBox(
  cfg: Config,
  box: string,
  copyDir: string | undefined
): Promise<void> {
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
  const r = await msb(cfg, ["ls", "--format", "json"], false);
  const entries = parseLsJson(r.stdout).filter((e) => isRunning(e.status));

  let count = 0;
  for (const e of entries) {
    if (e.name.startsWith(POOL_PREFIX)) {
      // Only count claimed pool boxes; a dead/unexecable one doesn't hold a session.
      try {
        const c = await exec(cfg, e.name, "test -f /.claimed && echo claimed || echo free");
        if (c.stdout.trim().endsWith("claimed")) count++;
      } catch {
        // unexecable => not a live session
      }
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
// The agent writes a plain-text QUESTION here when it needs a decision/answer to continue, then
// finishes the run. `status` surfaces it as "waiting"; `resume` clears it and feeds back the answer.
export const QUESTION_MARK = "/workspace/.agent.question";

// Standing policy injected as a system prompt on every run/resume. Kept as env data (like the
// task) so it never touches the command string. No AI attribution in commits or PRs.
const AGENT_SYS_PROMPT =
  "Never add AI attribution to git commits or pull requests. Do not include " +
  '"Generated with Claude Code", "Co-Authored-By: Claude", any 🤖 marker, or similar ' +
  "AI/assistant credit in commit messages, PR titles, or PR bodies. Write them as a human author would. " +
  // Interactive Q&A: the ONE way to reach the caller. Everything you need from the outside world —
  // a decision, a missing secret, or a blocker you cannot resolve yourself — goes through this file.
  `This is an interactive session. Your ONLY channel to the caller is the file ${QUESTION_MARK}: ` +
  "write one clear question (plain text, include the options you are choosing between) as your LAST " +
  "action, then STOP and end your turn immediately — do not take any further steps after writing it. " +
  `(Enforcement: while ${QUESTION_MARK} exists, every tool call you attempt is DENIED, so you cannot ` +
  "do more work until the caller answers — writing it and stopping is the only correct move.) " +
  "The caller answers and continues this same session with 'claude -c'; when you " +
  "continue, first read and act on the answer. STOP and ask — never guess or silently work around — " +
  "in ANY of these cases: " +
  "(1) a DECISION or fact you cannot safely infer (ambiguous requirements, which approach, a missing " +
  "fact about the codebase, confirmation before anything destructive); " +
  "(2) a missing credential or connection detail (token for a private repo, database URL, API key) — " +
  "name the exact environment variable(s) you need and why, so the caller can re-run with them; " +
  "(3) an ENVIRONMENT BLOCKER that stops you from doing the task properly — e.g. `npm install` / build / " +
  "test / auth failures, a 401/403 from a package registry or API, a missing tool or scope. Report the " +
  "exact failure (command + key error line) and what would unblock it, then STOP. Do NOT declare the " +
  "task done, and do NOT skip a required step and press on, when a blocker prevented you from verifying " +
  "your work. " +
  "Ask only when it genuinely matters — keep moving on things you can determine yourself. Never print, " +
  "echo, or log secret values (tokens, passwords, connection strings): refer to them only by their env " +
  "var name, and never write a secret value into the question file.";

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
  // GH_TOKEN drives the `gh` CLI; it's the access-resolved token for the FIRST repo's owner. Per-repo
  // pushes use the ~/.git-credentials entries (per-owner). There is NO default cfg.ghToken fallback —
  // if nothing resolved, `gh` gets no token and the agent must ask for one (ask-then-resume).
  if (ghTokenOverride) {
    flags.push("-e", `GH_TOKEN=${ghTokenOverride}`, "-e", `GITHUB_TOKEN=${ghTokenOverride}`);
  }
  if (cfg.npmToken) flags.push("-e", `NPM_TOKEN=${cfg.npmToken}`);
  return flags;
}

/** Working dir for the agent: the single repo's dir, or /workspace (parent) for multi-repo. */
function agentWorkdir(repos?: RepoLayout[]): string {
  if (repos && repos.length === 1) return `/workspace/${repos[0].name}`;
  return "/workspace";
}

/**
 * Mark every /workspace repo dir (and /workspace itself) as trusted in ~/.claude.json so Claude
 * honors settings instead of logging "workspace has not been trusted". Trust is keyed to the dir;
 * we set hasTrustDialogAccepted for each so a single- or multi-repo layout is covered. Uses node
 * (present in the image) to edit the JSON — no jq dependency. Idempotent.
 */
async function trustWorkspace(cfg: Config, box: string): Promise<void> {
  const script =
    `node -e '` +
    `const fs=require("fs"),os=require("os"),p=require("path");` +
    `const f=p.join(os.homedir(),".claude.json");` +
    `let j={};try{j=JSON.parse(fs.readFileSync(f,"utf8"))}catch(e){}` +
    `j.projects=j.projects||{};` +
    `const dirs=["/workspace","${ASK_DIR}"];` +
    `try{for(const d of fs.readdirSync("/workspace",{withFileTypes:true}))if(d.isDirectory())dirs.push("/workspace/"+d.name)}catch(e){}` +
    `for(const d of dirs){j.projects[d]=j.projects[d]||{};j.projects[d].hasTrustDialogAccepted=true;}` +
    `fs.writeFileSync(f,JSON.stringify(j));` +
    `'`;
  await exec(cfg, box, script);
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
/**
 * Install our USER-scope Claude hook that turns "ask a question" into a real, enforced pause.
 *
 * Why a hook: `claude -p` never blocks — writing the question file alone doesn't stop Claude; it
 * writes then keeps working and self-answers (observed). Claude Code's documented lever is a
 * PreToolUse hook returning permissionDecision:"deny": once the agent has written the question
 * sentinel, the hook DENIES every subsequent tool call, so Claude cannot do any more work and its
 * turn ends cleanly at the question. The run then shows run:waiting; `resume` (claude -c) deletes
 * the sentinel (see agentSh) and the next turn's tool calls are allowed again.
 *
 * Installed at ~/.claude (user scope) so `--setting-sources user` loads it (project settings are
 * intentionally skipped). Idempotent: overwrites the files each bootstrap.
 */
function askHookScript(): string {
  // The hook: if the question sentinel exists, DENY the pending tool call with a clear reason; else
  // allow. Reads the PreToolUse JSON on stdin (we don't need its fields — presence of the sentinel
  // is the whole decision). Uses node (always present in the image) to emit the exact JSON contract.
  const hook =
    `#!/bin/sh\n` +
    // Driver lane only. The ASK co-pilot runs in the same box with the same user settings, so it
    // would otherwise be frozen by the driver's pending question — exactly when you most want to ask
    // "what is it stuck on?". The lane flag is set on ask execs only (see askInBox).
    `if [ -n "$${ASK_LANE_ENV}" ]; then exit 0; fi\n` +
    `if [ -f ${QUESTION_MARK} ]; then\n` +
    `  node -e 'process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:"A question is pending in ${QUESTION_MARK} and is awaiting the caller. Do NOT take any further action or guess an answer — end your turn now. It will be resumed with the answer."}}))'\n` +
    `fi\n` +
    `exit 0\n`;
  // The ask lane's read-only gate: the mirror image of the ask-gate — it runs ONLY when the lane
  // flag is set, and denies anything that would mutate the box under the working driver.
  const roHook =
    `#!/bin/sh\n` +
    `if [ -z "$${ASK_LANE_ENV}" ]; then exit 0; fi\n` +
    `exec node "$HOME/.claude/hooks/ask-ro.js"\n`;

  const settings = JSON.stringify({
    hooks: {
      PreToolUse: [
        {
          matcher: "*",
          hooks: [
            { type: "command", command: "$HOME/.claude/hooks/ask-gate.sh" },
            { type: "command", command: "$HOME/.claude/hooks/ask-ro.sh" },
          ],
        },
      ],
    },
  });
  // The gate program is base64'd for the same reason as stream-fmt.js: a raw JS blob does not
  // survive shell + SSH + msb-exec quoting intact.
  const roB64 = Buffer.from(askGateNodeProgram(), "utf8").toString("base64");
  return (
    `mkdir -p "$HOME/.claude/hooks" && ` +
    `printf '%s' ${shellQuote(hook)} > "$HOME/.claude/hooks/ask-gate.sh" && ` +
    `chmod +x "$HOME/.claude/hooks/ask-gate.sh" && ` +
    `printf '%s' ${shellQuote(roHook)} > "$HOME/.claude/hooks/ask-ro.sh" && ` +
    `chmod +x "$HOME/.claude/hooks/ask-ro.sh" && ` +
    `printf '%s' '${roB64}' | base64 -d > "$HOME/.claude/hooks/ask-ro.js" && ` +
    // Merge the hook into any existing user settings.json (don't clobber other keys).
    `node -e 'const fs=require("fs"),os=require("os"),p=require("path");const f=p.join(os.homedir(),".claude","settings.json");let j={};try{j=JSON.parse(fs.readFileSync(f,"utf8"))}catch(e){}const add=${JSON.stringify(JSON.parse(settings))};j.hooks=Object.assign({},j.hooks,add.hooks);fs.writeFileSync(f,JSON.stringify(j,null,2))'`
  );
}

/**
 * Install the stream-json → human-log formatter at ~/.claude/stream-fmt.js.
 *
 * Headless `claude -p` buffers plain output and flushes at the very end, so the dashboard terminal
 * shows nothing mid-run. With `--output-format stream-json --verbose` Claude emits one JSON event per
 * line (system init, assistant text, tool_use, tool_result, final result) as they happen. This
 * formatter tails that NDJSON on stdin and appends readable lines to the log (argv[1]) in real time —
 * so the terminal panel streams tool calls and messages live. It also re-emits the final result text
 * so `status`/completion still sees the summary. Pure Node (always in the image); no deps.
 */
function streamFmtScript(): string {
  const js =
    `const fs=require("fs");` +
    `const out=process.argv[2];` +
    `function w(s){try{fs.appendFileSync(out,s+"\\n")}catch(e){}}` +
    `let buf="";` +
    `process.stdin.setEncoding("utf8");` +
    `process.stdin.on("data",d=>{buf+=d;let i;while((i=buf.indexOf("\\n"))>=0){const line=buf.slice(0,i);buf=buf.slice(i+1);handle(line)}});` +
    `process.stdin.on("end",()=>{if(buf.trim())handle(buf)});` +
    `function txt(c){return Array.isArray(c)?c.map(b=>b&&b.type==="text"?b.text:"").join(""):(typeof c==="string"?c:"")}` +
    `function handle(line){line=line.trim();if(!line)return;let e;try{e=JSON.parse(line)}catch(_){w(line);return}` +
    `try{` +
    `if(e.type==="system"&&e.subtype==="init"){w("● session started (model "+(e.model||"?")+")");return}` +
    `if(e.type==="assistant"&&e.message){for(const b of e.message.content||[]){` +
    `if(b.type==="text"&&b.text.trim())w(b.text.trim());` +
    `else if(b.type==="tool_use"){const inp=b.input||{};const arg=inp.command||inp.file_path||inp.path||inp.pattern||inp.description||"";w("→ "+b.name+(arg?": "+String(arg).slice(0,200):""))}` +
    `}return}` +
    `if(e.type==="user"&&e.message){for(const b of e.message.content||[]){` +
    `if(b.type==="tool_result"){const r=txt(b.content).trim();if(r)w("  "+r.split("\\n").slice(0,20).join("\\n  "))}` +
    `}return}` +
    `if(e.type==="result"){if(e.result&&String(e.result).trim())w(String(e.result).trim());return}` +
    `}catch(_){}}`;
  // base64 the whole script and decode in the box: shipping a large JS blob through
  // shell/SSH/msb-exec quoting was corrupting it (trailing garbage → SyntaxError at load).
  // base64 has no shell-special chars, so the file lands byte-for-byte intact.
  const b64 = Buffer.from(js, "utf8").toString("base64");
  return (
    `mkdir -p "$HOME/.claude" && ` +
    `printf '%s' '${b64}' | base64 -d > "$HOME/.claude/stream-fmt.js"`
  );
}

function bootstrapScript(cfg: Config): string {
  const lines = [
    "set -e",
    "command -v claude >/dev/null || npm i -g @anthropic-ai/claude-code",
    // Install gh if missing (Debian/Ubuntu node image). We do NOT run `gh auth setup-git` or set any
    // identity here: there is no default account. Git auth + commit identity are applied per-repo
    // afterwards (applyGitCredentials) from the access-resolved account for each repo.
    "command -v gh >/dev/null || (type apt-get >/dev/null 2>&1 && " +
      "(apt-get update -qq && apt-get install -y -qq gh >/dev/null 2>&1 || npm i -g gh >/dev/null 2>&1)) || true",
    // Scrub any GLOBAL identity a stale warm-start snapshot may have baked in (e.g. an old default
    // like `atom-bot`). Commit identity must ONLY ever come from the per-repo access-resolved account
    // set by applyGitCredentials — never a leftover global. Unset is idempotent/‑safe if absent.
    "git config --global --unset-all user.name 2>/dev/null || true",
    "git config --global --unset-all user.email 2>/dev/null || true",
    // Install the PreToolUse ask-gate hook so a pending question actually halts the turn.
    askHookScript(),
    // Install the stream-json formatter so the dashboard terminal streams live progress.
    streamFmtScript(),
  ];
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
const TASK_MARK = "/workspace/.agent.task"; // the current task/follow-up text, so `monitor` can show it

/**
 * Build the background agent command. The agent runs headless and DETACHED so `msb exec` returns
 * immediately (fixing the MCP response timeout): delegate returns the session id in seconds while
 * the task keeps running in the box. Completion is observable via the .agent.done sentinel (holds
 * the exit code); `status` reads it. `resume=true` continues the existing Claude session (-c).
 */
function agentSh(workdir: string, resume: boolean): string {
  // --setting-sources user: load ONLY user settings, so a cloned repo's own .claude/settings.json
  // (and its hooks) is never loaded. Target repos commonly ship a UserPromptSubmit "plugin gate"
  // hook that hard-blocks every prompt when marketplace plugins aren't installed — which they aren't
  // in a headless box — making Claude exit 0 doing nothing. Skipping project settings avoids that;
  // we grant tools ourselves via --allowedTools, so we don't need the repo's permissions.allow.
  const settingSources = `--setting-sources user`;
  // stream-json (+ required --verbose) emits one JSON event per line as work happens; we pipe it
  // through the formatter so the dashboard terminal streams live instead of dumping at the end.
  const streamFmt = `--output-format stream-json --verbose`;
  const cont = resume ? `-c ` : ``;
  const claude =
    `claude ${cont}-p "$AGENT_TASK" ${settingSources} ${streamFmt} ` +
    `--append-system-prompt "$AGENT_SYS_PROMPT" --allowedTools ${ALLOWED_TOOLS}`;
  // Clear any pending question up front: a new run or a resume (which carries the answer) means the
  // previous question is now handled, so status stops reporting "waiting".
  const inner =
    // Record the current task (from env) so `monitor` can report what this box is doing. First run
    // sets it; a resume appends the follow-up so the marker reflects the latest ask.
    `cd ${workdir} && printf '%s\\n' "$AGENT_TASK" ${resume ? `>> ${TASK_MARK}` : `> ${TASK_MARK}`} && ` +
    `rm -f ${DONE_MARK} ${QUESTION_MARK} && touch ${RUN_MARK} && ` +
    // pipefail so the recorded exit reflects claude's, not the formatter's. Claude's raw stderr also
    // lands in the log (errors aren't JSON). The formatter appends readable lines to the same log as
    // events stream in, tailing live for the dashboard. Run under bash (present in the node image) so
    // pipefail is available.
    `{ set -o pipefail; ` +
    `${claude} 2>> ${AGENT_LOG} | node "$HOME/.claude/stream-fmt.js" ${AGENT_LOG}; ` +
    `echo $? > ${DONE_MARK}; rm -f ${RUN_MARK}; }`;
  // nohup + bash + & so the child outlives the exec shell; redirect all fds so exec doesn't block.
  return `nohup bash -c ${shellQuote(inner)} >/dev/null 2>&1 < /dev/null & echo started`;
}

/**
 * Per-repo GitHub credentials resolved from the token store, threaded into a run. There is NO
 * default account: everything here is the access-resolved account(s) for the repo(s) in this task.
 *  - ownerTokens: owner -> token, written as per-owner ~/.git-credentials entries (multi-owner push).
 *  - ownerLogins: owner -> GitHub login, used to set the commit identity PER REPO directory so each
 *    repo is authored by the account that can actually push it (never a shared/default identity).
 *  - repoOwners: in-box dir name (/workspace/<name>) -> owner, so we know which login/token each
 *    repo directory should use.
 *  - primaryToken: token for the first repo's owner, exported as GH_TOKEN so the `gh` CLI defaults to
 *    an account with access (per-repo pushes still use ownerTokens via ~/.git-credentials).
 *  - primaryLogin: login behind primaryToken (informational / gh default).
 */
export interface AgentCreds {
  ownerTokens?: Record<string, string>;
  ownerLogins?: Record<string, string>;
  repoOwners?: Record<string, string>;
  primaryToken?: string;
  primaryLogin?: string;
}

/**
 * Apply resolved GitHub creds inside the box (after bootstrap). No default account is ever used:
 *  1. per-owner ~/.git-credentials so each repo pushes with the token that has access;
 *  2. commit identity set PER REPO directory (git -C /workspace/<name>) from that repo's access
 *     account login — so a repo is authored by the account that can actually push it, and a
 *     mixed-owner multi-repo task gets the right author in each repo;
 *  3. a GitHub Packages ~/.npmrc line (primary token) so scoped @owner installs resolve — needs
 *     `read:packages` on the token.
 * Deliberately does NOT set a global user.name/email or run `gh auth setup-git` with a default token.
 */
async function applyGitCredentials(cfg: Config, box: string, creds?: AgentCreds): Promise<void> {
  const lines: string[] = [];

  const credScript = gitCredentialsScript(creds?.ownerTokens ?? {});
  if (credScript) lines.push(credScript);

  // Per-repo identity: for each in-box dir, look up its owner -> that owner's access login.
  const repoOwners = creds?.repoOwners ?? {};
  const ownerLogins = creds?.ownerLogins ?? {};
  for (const [name, owner] of Object.entries(repoOwners)) {
    const login = ownerLogins[owner];
    if (!login) continue; // no resolved account for this repo -> set no identity (never a default)
    const email = `${login}@users.noreply.github.com`;
    const dir = `/workspace/${name}`;
    lines.push(`git -C ${shellQuote(dir)} config user.name ${shellQuote(login)}`);
    lines.push(`git -C ${shellQuote(dir)} config user.email ${shellQuote(email)}`);
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
  await trustWorkspace(cfg, box);
  return msb(cfg, ["exec", box, ...env, "--", "sh", "-lc", agentSh(workdir, false)]);
}

/** Raw sentinel readout from the box, split into the state line, question text, and log tail. */
export interface ProgressRaw {
  /** One of: running | done exit=N | idle (from the run/done sentinels). */
  runLine: string;
  /** Question text if the agent is waiting for an answer, else "". */
  question: string;
  /** Last log lines. */
  log: string;
}

/**
 * Turn the raw sentinel readout into a human status. A pending QUESTION takes precedence: even if
 * the run has finished, an unanswered question means the agent is WAITING for the caller to answer
 * (via resume) — that's the interactive-development signal the Mac agent loops on.
 */
export function formatProgress(raw: ProgressRaw): string {
  const head = raw.question
    ? `run:waiting — the agent asked a question and paused.\nQUESTION: ${raw.question.trim()}\n` +
      `Answer it with resume(session, "<answer>"). The Mac agent should answer from repo context if ` +
      `it can, otherwise ask the user.`
    : raw.runLine;
  return `${head}\n---LOG---\n${raw.log}`.trim();
}

/** One SSH round-trip that reads the run/done/question sentinels + a log tail into a ProgressRaw. */
async function readProgressRaw(cfg: Config, box: string, logLines = 60): Promise<ProgressRaw> {
  const r = await exec(
    cfg,
    box,
    `if [ -f ${RUN_MARK} ]; then echo "run:running"; ` +
      `elif [ -f ${DONE_MARK} ]; then echo "run:done exit=$(cat ${DONE_MARK} 2>/dev/null)"; ` +
      `else echo "run:idle"; fi; ` +
      `echo "---Q---"; cat ${QUESTION_MARK} 2>/dev/null || true; ` +
      `echo "---LOG---"; tail -n ${logLines} ${AGENT_LOG} 2>/dev/null || true`
  );
  const out = r.stdout;
  const qStart = out.indexOf("---Q---");
  const logStart = out.indexOf("---LOG---");
  return {
    runLine: out.slice(0, qStart).trim(),
    question: out.slice(qStart + "---Q---".length, logStart).trim(),
    log: out.slice(logStart + "---LOG---".length).trim(),
  };
}

/** Read run state from the sentinels: waiting(question) | running | done(code) | idle, plus log tail. */
export async function agentProgress(cfg: Config, box: string): Promise<string> {
  return formatProgress(await readProgressRaw(cfg, box));
}

/**
 * One poll of a box for the block-until-boundary wait loop: the classified RunState (a pending
 * question forces `waiting` even past `done`, mirroring formatProgress) plus the human status text.
 * Used by waitForBoundary so `delegate`/`resume` can hold the MCP call open until there's something
 * to act on.
 */
export async function agentBoundary(cfg: Config, box: string): Promise<PollResult> {
  const raw = await readProgressRaw(cfg, box);
  const state: RunState = raw.question ? "waiting" : parseRunState(raw.runLine).state;
  // Propagate the RAW question text so the elicitation prompt is the agent's actual question, not the
  // "run:waiting — the agent asked a question…" status blurb. Falls back to text when there's none.
  return { state, text: formatProgress(raw), question: raw.question || undefined };
}

/**
 * Ensure a box is running before we exec into it. A box waiting on a question can outlive its
 * `--idle-timeout` and be Stopped by msb while its rootfs (and Claude session) persist — so a
 * `resume` must `msb start` it first, otherwise the exec fails and the answer is lost. Best-effort:
 * if it's already running, `msb start` is a harmless no-op; failures are swallowed and surfaced by
 * the exec that follows.
 */
export async function startBoxIfStopped(cfg: Config, box: string): Promise<void> {
  const r = await msb(cfg, ["ls", "--format", "json"], false);
  const entry = parseLsJson(r.stdout).find((e) => e.name === box);
  if (entry && !isRunning(entry.status)) {
    await msb(cfg, ["start", box], false);
  }
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
  // A box that idle-timed-out while WAITING on a question is Stopped but intact — start it so the
  // answer reaches the same Claude session instead of failing the exec.
  await startBoxIfStopped(cfg, box);
  // Ephemeral secrets are appended as extra -e flags on THIS exec only (not stored).
  const env = [...agentEnvFlags(cfg, message, repos, creds?.primaryToken), ...secretEnvFlags(secrets)];
  await applyGitCredentials(cfg, box, creds);
  await trustWorkspace(cfg, box);
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

/**
 * Fleet snapshot for the `monitor` tool: every box with role, agent run-state, task, and metrics.
 * One `msb ls --format json`, then per box a single combined sentinel read + one metrics call. All
 * per-box reads are best-effort (a box can vanish mid-scan) — failures degrade that box's row, not
 * the whole report. Shaping/formatting is delegated to the pure monitor module.
 */
export async function gatherMonitor(cfg: Config): Promise<BoxView[]> {
  const ls = await msb(cfg, ["ls", "--format", "json"], false);
  const entries = parseLsJson(ls.stdout);

  const views = await Promise.all(
    entries.map(async (e): Promise<BoxView> => {
      let claimed = false;
      let runState: RunState = "idle";
      let exitCode: number | undefined;
      let task: string | undefined;
      let question: string | undefined;
      let uptime: string | undefined;
      let cpu: string | undefined;
      let mem: string | undefined;

      // One round-trip for all in-box sentinels: claim marker, run state, task, question.
      try {
        const r = await exec(
          cfg,
          e.name,
          `test -f /.claimed && echo CLAIMED || echo FREE; ` +
            `if [ -f ${RUN_MARK} ]; then echo "run:running"; ` +
            `elif [ -f ${DONE_MARK} ]; then echo "run:done exit=$(cat ${DONE_MARK} 2>/dev/null)"; ` +
            `else echo "run:idle"; fi; ` +
            `echo "---Q---"; cat ${QUESTION_MARK} 2>/dev/null || true; ` +
            `echo "---T---"; head -n 1 ${TASK_MARK} 2>/dev/null || true`
        );
        const out = r.stdout;
        const qStart = out.indexOf("---Q---");
        const tStart = out.indexOf("---T---");
        const head = out.slice(0, qStart);
        claimed = /(^|\n)CLAIMED\s*(\n|$)/.test(head);
        const runLine = head.split("\n").map((l) => l.trim()).find((l) => l.startsWith("run:")) ?? "run:idle";
        const rs = parseRunState(runLine);
        // A pending question means WAITING even if the run "finished" (mirrors agentProgress).
        question = out.slice(qStart + "---Q---".length, tStart).trim() || undefined;
        runState = question ? "waiting" : rs.state;
        exitCode = rs.exitCode;
        task = out.slice(tStart + "---T---".length).trim() || undefined;
      } catch {
        // box gone / not execable — leave defaults.
      }

      // Metrics are cheap and independent; best-effort. msb's metrics STATE is more current than the
      // ls status (ls can briefly lag a just-stopped box), so prefer it for the lifecycle when present.
      let boxStatus = e.status;
      try {
        const m = parseMetrics(await metrics(cfg, e.name));
        uptime = m.uptime;
        cpu = m.cpu;
        mem = m.mem;
        if (m.state) boxStatus = m.state === "exited" ? "Stopped" : m.state;
      } catch {
        // ignore
      }

      return {
        name: e.name,
        role: classifyBox(e.name, claimed),
        boxStatus,
        runState,
        exitCode,
        task,
        question,
        uptime,
        cpu,
        mem,
      };
    })
  );

  return views;
}

/**
 * Live over-the-shoulder snapshot of ONE box for the `watch` tool/CLI: the same sentinels monitor
 * reads (claim/run-state/task/question) plus a configurable-length log tail and metrics. Returns a
 * `missing` snapshot (never throws) if the box is gone, so the watch CLI can keep polling cleanly.
 */
/**
 * Ask the co-pilot a question about a running box, WITHOUT disturbing the driver agent.
 *
 * Unlike runAgentTask (detached, sentinel-observed) this exec is SYNCHRONOUS and short: the caller
 * is waiting for an answer, so we block on it and cap it with `timeout` well under the MCP client's
 * request window. Nothing here touches /workspace, the .agent.* sentinels, or the driver's Claude
 * session — see ask.ts for why each of those matters.
 *
 * Threading: the ask lane keeps its own resumable Claude session, rooted at ${ASK_DIR} so it can
 * never be picked up by the driver's `claude -c`. We only pass `-c` when a prior turn left the
 * thread marker, since `-c` with no session in the bucket is an error.
 */
export async function askInBox(
  cfg: Config,
  box: string,
  question: string,
  opts: { newThread?: boolean; repos?: RepoLayout[] } = {}
): Promise<AskResult> {
  // A box that idle-stopped (very likely if the driver is parked on a question) still holds the
  // whole workspace — start it so the co-pilot has something to read.
  await startBoxIfStopped(cfg, box);
  // The co-pilot's cwd is a project dir like any other: without a trust entry Claude Code can refuse
  // to run there. Cheap and idempotent, so just do it on every ask.
  await trustWorkspace(cfg, box);

  const workdir = agentWorkdir(opts.repos);
  const timeoutSec = Math.max(5, Math.round(cfg.askTimeoutMs / 1000));

  const env = [
    "-e",
    `ANTHROPIC_BASE_URL=${cfg.anthropicBaseUrl}`,
    "-e",
    `ANTHROPIC_API_KEY=${cfg.anthropicApiKey}`,
    "-e",
    // The lane flag: flips BOTH in-box hooks (driver ask-gate off, read-only gate on).
    `${ASK_LANE_ENV}=1`,
    "-e",
    // Model selection goes through the env, exactly like the driver's. Without it Claude Code falls
    // back to its own default alias, which the ccproxy does not serve — a 502 the CLI reports only as
    // "Execution error". askModel lets the co-pilot run on a cheaper/faster alias than the driver.
    `ANTHROPIC_MODEL=${cfg.askModel ?? cfg.anthropicModel}`,
    "-e",
    `ASK_QUESTION=${question}`,
    "-e",
    `ASK_SYS_PROMPT=${askSystemPrompt(workdir, AGENT_LOG, QUESTION_MARK)}`,
  ];

  // Continue the ask thread unless asked for a fresh one; the marker is what proves `-c` is safe.
  const contProbe = opts.newThread
    ? `rm -f ${ASK_THREAD_MARK}; CONT=""`
    : `if [ -f ${ASK_THREAD_MARK} ]; then CONT="-c"; else CONT=""; fi`;

  const inner =
    `mkdir -p ${ASK_DIR} && cd ${ASK_DIR} && ${contProbe}; ` +
    `printf '\\n=== ask %s ===\\n%s\\n' "$(date -u +%FT%TZ)" "$ASK_QUESTION" >> ${ASK_LOG}; ` +
    // --setting-sources user loads the hooks (both gates) and nothing from any cloned repo.
    `timeout ${timeoutSec}s claude $CONT -p "$ASK_QUESTION" --setting-sources user ` +
    `--append-system-prompt "$ASK_SYS_PROMPT" --allowedTools ${ASK_ALLOWED_TOOLS} ` +
    `2>>${ASK_LOG} | tee -a ${ASK_LOG}; ` +
    // 124 is timeout(1)'s "killed at the cap"; surface it so the caller can say the answer is partial.
    `code=$?; touch ${ASK_THREAD_MARK}; echo "---ASKEXIT---$code"`;

  const r = await msb(cfg, ["exec", box, ...env, "--", "bash", "-lc", inner], false);
  const out = r.stdout;
  const marker = out.lastIndexOf("---ASKEXIT---");
  const answer = (marker >= 0 ? out.slice(0, marker) : out).trim();
  const code = marker >= 0 ? Number(out.slice(marker + "---ASKEXIT---".length).trim()) : r.code;

  return {
    session: box,
    answer,
    timedOut: code === 124,
    continued: !opts.newThread,
  };
}

/** One-line driver state for the ask header: what the OTHER lane is doing right now. */
export async function driverStateLine(cfg: Config, box: string): Promise<string | undefined> {
  try {
    const raw = await readProgressRaw(cfg, box, 0);
    if (raw.question) return `WAITING on a question — "${raw.question.split("\n")[0].slice(0, 120)}"`;
    return raw.runLine || undefined;
  } catch {
    return undefined; // context only; never fail the ask over it
  }
}

export async function gatherWatch(
  cfg: Config,
  box: string,
  logLines = 40
): Promise<WatchSnapshot> {
  const base: WatchSnapshot = { name: box, boxStatus: "missing", runState: "idle", log: "" };
  try {
    const r = await exec(
      cfg,
      box,
      `if [ -f ${RUN_MARK} ]; then echo "run:running"; ` +
        `elif [ -f ${DONE_MARK} ]; then echo "run:done exit=$(cat ${DONE_MARK} 2>/dev/null)"; ` +
        `else echo "run:idle"; fi; ` +
        `echo "---Q---"; cat ${QUESTION_MARK} 2>/dev/null || true; ` +
        `echo "---T---"; head -n 1 ${TASK_MARK} 2>/dev/null || true; ` +
        `echo "---LOG---"; tail -n ${logLines} ${AGENT_LOG} 2>/dev/null || true`
    );
    const out = r.stdout;
    const qStart = out.indexOf("---Q---");
    const tStart = out.indexOf("---T---");
    const logStart = out.indexOf("---LOG---");
    const runLine =
      out.slice(0, qStart).split("\n").map((l) => l.trim()).find((l) => l.startsWith("run:")) ??
      "run:idle";
    const rs = parseRunState(runLine);
    const question = out.slice(qStart + "---Q---".length, tStart).trim() || undefined;
    base.question = question;
    base.runState = question ? "waiting" : rs.state;
    base.exitCode = rs.exitCode;
    base.task = out.slice(tStart + "---T---".length, logStart).trim() || undefined;
    base.log = out.slice(logStart + "---LOG---".length).trim();
    base.boxStatus = "running"; // execable => running
  } catch {
    return base; // stays "missing"
  }

  try {
    const m = parseMetrics(await metrics(cfg, box));
    base.uptime = m.uptime;
    base.cpu = m.cpu;
    base.mem = m.mem;
    if (m.state && m.state !== "running") base.boxStatus = m.state === "exited" ? "stopped" : m.state;
  } catch {
    // metrics is best-effort
  }
  return base;
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
