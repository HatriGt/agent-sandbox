import { BAKED_MCP_PACKAGES } from "./package-watch.js";
/**
 * Thin wrapper over the microsandbox CLI (`msb`), exposing only the operations the
 * orchestrator needs. Command shapes are the ones verified in docs/runbook.md.
 *
 * All calls run on the VPS over SSH so this works whether the MCP is driven from the client
 * or from the box itself. Args are passed as an argv array (no shell interpolation).
 */
import { assertBoxName } from "./sync.js";
import { run, shellQuote } from "./exec.js";
import { sshMuxOpts } from "./ssh.js";
import { listClaims, listKept, listParked, markClaimed, shouldKeepStopped, unmarkClaimed, unmarkKept, unmarkParked } from "./claims.js";
import { askParkTtlSec } from "./snapshot.js";
import { guardNodeProgram } from "./guard.js";
import { loadMcpStore, toClaudeMcpConfig, boxSecretPolicy, boxExclusion } from "./mcp-store.js";
import { boxSkillSelection, buildSkillsTarBase64, loadSkillStore, skillsForBox, type SkillDef } from "./skill-store.js";
import { SKILLS_DIR, SKILLS_INDEX, recordSkillPicks, skillTurnHint, skillsIndex } from "./skill-match.js";
import { loadMemoryStore, markUsed, playbookHint, receiptOf, recordReceipt, renderMemoryArchive, renderMemoryMd, saveMemoryStore, selectMemory, type MemoryReceipt } from "./memory-store.js";
import { MEMORY_ALL_MD, MEMORY_MD, memorySetup } from "./drivers/memory-tool.js";
import { repoSlugFromUrl } from "./setup-store.js";
import { harnessPromptHint, reposPromptHint, type RepoLayout } from "./agent-prompt.js";
import { secretEnvFlags } from "./secret-env.js";
import type { AgentKind } from "./agent-kind.js";
import {
  ASK_ALLOWED_TOOLS,
  ASK_DIR,
  ASK_LANE_ENV,
  ASK_LOG,
  ASK_THREAD_MARK,
  askGateNodeProgram,
  askSystemPrompt,
  askThreadProbe,
  type AskResult,
} from "./ask.js";
import {
  parseLsJson,
  isRunning,
  classifyBox,
  parseRunState,
  parseMetrics,
  parseMemUsage,
  type BoxView,
  type RunState,
  type WatchSnapshot,
  type RepoRef,
  parseDurationSec,
  warmMaxDuration,
} from "./monitor.js";
import type { PollResult } from "./wait.js";
import type { Config } from "./config.js";
import { redactShapes, redactShapesSource } from "./redact.js";
import { askSnapName } from "./snapshot.js";
import { driverFor } from "./drivers/index.js";
import { askHookScript, claudeDriver, claudeInstallSh, streamFmtScript } from "./drivers/claude.js";
import { ompInstallSh, ompSeedSh } from "./drivers/omp.js";
import { NEED_HOOK, needSetup } from "./drivers/need.js";
import { AGENT_LOG, AT_MARK, MCP_CONFIG_PATH, PROVIDER_ENV_PATH, QUESTION_MARK, USAGE_OPEN, YOU_MARK_CLOSE, YOU_MARK_OPEN } from "./drivers/sentinels.js";
import { INBOX_APPEND_SH, INBOX_RESET_SH, INBOX_TAKE_DELIVERED_SH, inboxLine, type InboxLine } from "./drivers/inbox-gate.js";
import { isStalled } from "./stall.js";
import { EXIT_DISK_FULL } from "./run-health.js";
import { parseBakedManifest, type LastProvision } from "./package-watch.js";
import { ensureHostGuard, hostGuardFlags } from "./host-guard.js";
import { BLANK_OWNER, ownerTag } from "./warm-owners.js";
import { withOwner } from "./user-store.js";
import { MOLI_BIN, MOLI_PROMPT_HINT, browserToolSetup, moliInstallSh } from "./browser.js";
import { orphanSandboxDirs, parseDfPk, parseDirListing, type DiskReading } from "./host-disk.js";
import { PKG_STORE_MOUNT, STORE_BOX_PREFIX, isStoreBox, makePkgStore, specName, storable, storeKey, storedPathSh } from "./pkg-store.js";

// The driver pieces used to live here; re-exported so every existing importer keeps working.
export { claudeInstallSh, streamFmtScript } from "./drivers/claude.js";
export { ompInstallSh, ompFmtScript, ompGuardScript, ompSeedSh } from "./drivers/omp.js";
export { AGENT_SYS_PROMPT, OMP_SYS_PROMPT } from "./drivers/prompts.js";
export {
  QUESTION_MARK,
  ERR_MARK,
  ID_OPEN,
  ID_CLOSE,
  RESULT_MAX_LINES,
  RESULT_MAX_BYTES,
  RESULT_MAX_LINE_CHARS,
  THINK_OPEN,
  THINK_CLOSE,
  PLAN_OPEN,
  PLAN_CLOSE,
  DIFF_OPEN,
  DIFF_CLOSE,
  USAGE_OPEN,
  AT_MARK,
  DIFF_MAX_LINES,
  DIFF_MAX_BYTES,
} from "./drivers/sentinels.js";

/**
 * Run `msb <rest>` on the VPS over SSH.
 *
 * ssh re-parses its arguments through the REMOTE shell, so every element (msb path + each
 * arg, including task text and env values) is single-quoted into one remote command string.
 * This keeps argv semantics intact remotely and prevents task/env content from injecting.
 *
 * Uses a multiplexed master connection (sshMuxOpts) so repeated calls skip the ~2s handshake.
 */
async function msb(cfg: Config, rest: string[], check = true, timeoutMs?: number) {
  const remoteCmd = [cfg.msb, ...rest].map(shellQuote).join(" ");
  // The command travels on STDIN to a remote `sh`, never as the ssh remote-command argument. The
  // remote command IS the sshd child's argv — readable in /proc/*/cmdline by any local user on the
  // VPS for the duration of the call — and these commands routinely carry `-e GH_TOKEN=…`,
  // `-e ANTHROPIC_API_KEY=…` and the full task text. Inside the ssh channel none of that is
  // host-visible. `"$(cat)"` slurps the WHOLE command before executing (a plain `ssh … sh` would
  // stream it, and any inner command that reads stdin would eat the rest of the script).
  return run("ssh", [...sshMuxOpts(cfg), cfg.vpsSsh, 'sh -c "$(cat)"'], { check, timeoutMs, input: `${remoteCmd}\n` });
}

/**
 * Timeout for the read-only probes the fleet sweep and watch hub make (`ls`, `exec` of the
 * sentinel script, `metrics`). These are the calls that hang: `msb exec` into a box caught
 * mid-shutdown parks in poll() forever. They're also cheap and frequent, so they get a much
 * tighter bound than DEFAULT_TIMEOUT_MS — a probe that hasn't answered in 20s won't, and the
 * caller treats a rejection as "no data for this box", which is the honest answer.
 */
const PROBE_TIMEOUT_MS = 20_000;

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
  // The host's own addresses are refused first, in both modes (src/host-guard.ts).
  if (allowAll) {
    return ["--net", "public", ...hostGuardFlags()];
  }
  const flags = [...hostGuardFlags(), "--net-default-egress", "deny", "--net-rule", "allow@dns"];
  for (const domain of cfg.egressDomains) {
    flags.push("--net-rule", `allow@${domain}:tcp:443`);
  }
  return flags;
}

/** Which stopped boxes the reaper has already said it is keeping, and why. */
const saidKeeping = new Map<string, string>();

// ---- the package store (src/pkg-store.ts): MCP packages installed once on the host ----
let pkgStoreRoot: string | undefined;
let pkgStoreLearned: Promise<void> | undefined;
/** Find (and make) the store's directory on the host, once. Never throws; off with MCP_PKG_STORE=0. */
export function learnPkgStore(cfg: Config): Promise<void> {
  if (process.env.MCP_PKG_STORE === "0") return Promise.resolve();
  return (pkgStoreLearned ??= (async () => {
    try {
      const r = await ssh(cfg, 'D="$HOME/.agent-sandbox/npm-store"; mkdir -p "$D/pkgs" "$D/stage" && echo "$D"', false);
      const d = String(r.stdout ?? "").trim().split("\n").pop() ?? "";
      if (r.code === 0 && /^\/[\w./-]+$/.test(d)) pkgStoreRoot = d;
      else pkgStoreLearned = undefined;
    } catch {
      pkgStoreLearned = undefined;
    }
  })());
}
/** The read-only mount every image-booted box gets. Empty until the store is known. */
function pkgStoreFlags(): string[] {
  return pkgStoreRoot ? ["--mount-dir", `${pkgStoreRoot}/pkgs:${PKG_STORE_MOUNT}:ro`] : [];
}
/** Free host memory a builder box needs before it is started (its own 1 GB plus the reserve). */
const STORE_BUILD_MIN_FREE_MB = 1536;
/**
 * Install one spec into the store: a throwaway box whose only writable mount is this package's
 * staging directory runs npm there; the host then renames the finished directory into place and
 * drops all but the two newest versions.
 */
async function buildStoredPackage(cfg: Config, spec: string, ver: string): Promise<void> {
  if (!storable(spec) || !/^v\d+$/.test(ver)) throw new Error("not a package the store can hold");
  await learnPkgStore(cfg);
  if (!pkgStoreRoot) throw new Error("the store directory is not available on the host");
  const free = await hostFreeMb(cfg);
  if (free !== undefined && free < STORE_BUILD_MIN_FREE_MB) throw new Error(`the host has ${free} MB free; a build needs ${STORE_BUILD_MIN_FREE_MB}`);
  await learnHostGuard(cfg);
  const key = storeKey(spec), name = specName(spec);
  const stage = `${pkgStoreRoot}/stage/${key}-${ver}`, dest = `${pkgStoreRoot}/pkgs/${key}`;
  const box = `${STORE_BOX_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await ssh(cfg, `rm -rf ${shellQuote(stage)} && mkdir -p ${shellQuote(stage)}`);
  try {
    await msb(cfg, ["run", "-d", "--name", box, "-m", "1G", "--max-memory", "1G", "--root-disk", "4G", "--net", "public", ...hostGuardFlags(), "--max-duration", "20m", "--pull", "never", "--mount-dir", `${stage}:/out`, cfg.image, "--", "sleep", "infinity"]);
    const q = shellQuote(spec);
    const r = await msb(
      cfg,
      [
        "exec", box, "--", "sh", "-lc",
        `mkdir -p /root/.npm-tmp && cd /root && ${NPM_INSTALL_ENV} npm i -g --no-audit --no-fund --prefix /out ${q} >/root/npm.log 2>&1 || { tail -c 400 /root/npm.log; exit 1; }; ` +
          // The same trims the image bake makes: GPU and other-platform runtimes no box can use.
          `find /out \\( -name libonnxruntime_providers_cuda.so -o -name libonnxruntime_providers_tensorrt.so \\) -delete; ` +
          `for d in $(find /out -type d -path '*onnxruntime-node/bin/napi-v*'); do rm -rf "$d/darwin" "$d/win32" "$d/linux/arm64"; done; ` +
          `test -f /out/lib/node_modules/${shellQuote(name)}/package.json && echo asb-stored`,
      ],
      false,
      600_000
    );
    if (!String(r.stdout ?? "").includes("asb-stored")) throw new Error(`npm did not install it: ${String(r.stdout ?? "").replace(/\s+/g, " ").slice(-300)}`);
  } catch (e) {
    await ssh(cfg, `rm -rf ${shellQuote(stage)}`, false).catch(() => {});
    throw e;
  } finally {
    await msb(cfg, ["stop", box], false).catch(() => {});
    await msb(cfg, ["rm", "--force", box], false).catch(() => {});
  }
  await ssh(
    cfg,
    `mkdir -p ${shellQuote(dest)} && mv ${shellQuote(stage)} ${shellQuote(`${dest}/${ver}`)} && ` +
      `ls -d ${shellQuote(dest)}/v* | sort | head -n -2 | while read -r old; do rm -rf "$old"; done`
  );
}
let pkgStoreQueue: ReturnType<typeof makePkgStore> | undefined;
/** Ask for these specs to be in the store; anything missing is built in the background. */
export function wantStoredPackages(cfg: Config, specs: readonly string[]): void {
  if (process.env.MCP_PKG_STORE === "0" || !specs.length) return;
  pkgStoreQueue ??= makePkgStore({
    nowSec: () => Math.floor(Date.now() / 1000),
    list: async () => {
      await learnPkgStore(cfg);
      if (!pkgStoreRoot) throw new Error("the store directory is not available on the host");
      return String((await ssh(cfg, `ls -d ${shellQuote(pkgStoreRoot)}/pkgs/*/v* 2>/dev/null; true`, false)).stdout ?? "");
    },
    build: (spec, ver) => buildStoredPackage(cfg, spec, ver),
    log: (m) => console.error(m),
  });
  pkgStoreQueue.want(specs);
}
/** Builder boxes a restart left behind (a build is cut off when the controller stops). */
export async function reapStoreBuilders(cfg: Config): Promise<void> {
  try {
    const r = await msb(cfg, ["ls", "--format", "json"], false, PROBE_TIMEOUT_MS);
    for (const e of parseLsJson(r.stdout)) {
      if (!isStoreBox(e.name)) continue;
      await msb(cfg, ["stop", e.name], false);
      await msb(cfg, ["rm", "--force", e.name], false);
    }
    await learnPkgStore(cfg);
    if (pkgStoreRoot) await ssh(cfg, `rm -rf ${shellQuote(pkgStoreRoot)}/stage/* 2>/dev/null; true`, false);
  } catch {
    /* next start tries again */
  }
}

/** Learn which addresses are the host's own, once, so boxes can be kept off them. Never throws. */
export function learnHostGuard(cfg: Config): Promise<void> {
  return ensureHostGuard(async () => (await ssh(cfg, "hostname -I")).stdout);
}

/**
 * Copy a staged working tree on the VPS into a running box's /workspace.
 * `msb copy <dir> box:/dest` copies the dir *into* /dest (trailing /. ignored), so we copy to a
 * temp path then move the contents into /workspace to avoid a nested subdir.
 */
/**
 * Copy a directory from the VPS into a RUNNING box at `dest` (used to attach a repo mid-run). The
 * staged tree lands via `msb copy` in a scratch dir, then moves into place so a half-copied tree is
 * never visible at the final path.
 */
export async function copyDirIntoBox(cfg: Config, box: string, hostDir: string, dest: string): Promise<void> {
  const scratch = `/.wt-${Date.now().toString(36)}`;
  await msb(cfg, ["copy", hostDir, `${box}:${scratch}`]);
  await exec(cfg, box, `mkdir -p ${shellQuote(dest)} && cp -a ${scratch}/. ${shellQuote(dest)}/ && rm -rf ${scratch}`);
}

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
  await learnHostGuard(cfg);
  await learnPkgStore(cfg);
  const common = [
    "run",
    "-d",
    "--name",
    opts.name,
    "-m",
    cfg.memory,
    // Without --max-memory the runtime keeps its default 4G hotplug ceiling and reports THAT as
    // the MEM denominator in `msb metrics` — so every dashboard meter reads "of 4.0 GB" no matter
    // what -m says. Pin the ceiling to the cap so the meters show the real limit.
    "--max-memory",
    cfg.memory,
    ...cpuFlags(cfg),
    // Same story for the root disk: without --root-disk every box gets the runtime's default 4G
    // volume and the disk meter reads "of 3.9 GB". Boxes start at cfg.rootDisk (default 1G) and
    // the operator grows from there (msb modify --root-disk is grow-only). Snapshot boots skip
    // the flag — a snapshot carries its own rootfs size (pinned at bake time in createBareBox),
    // and asking for a smaller disk than the snapshot was baked with would fail the boot.
    ...(cfg.snapshot ? [] : ["--root-disk", cfg.rootDisk, ...pkgStoreFlags()]),
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


export interface ExecOpts {
  /** Per-invocation env, as `msb exec -e K=V` flags. Values land in the VPS-side ssh command string
   *  (readable in /proc/⋆/cmdline on the host for the call's duration) — fine for a flag, NOT for a
   *  credential; use `secretEnv` for those. Nothing persists in the box. */
  env?: Record<string, string>;
  /** Env whose VALUES must never touch argv: exported inside the box from stdin before `sh` runs. */
  secretEnv?: Record<string, string>;
  /** Payload for the command's stdin. A shell argument caps at ~128 KB (and the ssh remote command is
   *  one argument), so file contents — a pasted screenshot, an edited source file — must stream. */
  input?: string;
  timeoutMs?: number;
}

/**
 * Run a shell command inside the box (no cred env). The one exec-in-box primitive: plain argv exec
 * by default; with `input` or `secretEnv` the call rides a direct ssh so the payload travels on
 * stdin (`msb exec` forwards it). Secret exports are prepended to the stdin payload and `eval`ed
 * inside the box before `sh` (the exports ARE the stdin, so `secretEnv` and `input` are exclusive).
 */
export async function exec(cfg: Config, box: string, sh: string, opts: ExecOpts = {}) {
  const envFlags = Object.entries(opts.env ?? {}).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  if (opts.input === undefined && !opts.secretEnv) {
    return msb(cfg, ["exec", ...envFlags, box, "--", "sh", "-lc", sh], true, opts.timeoutMs);
  }
  if (opts.secretEnv && opts.input !== undefined) throw new Error("exec: secretEnv and input are mutually exclusive (the exports ARE the stdin)");
  let script = sh;
  let input = opts.input ?? "";
  if (opts.secretEnv) {
    const exports = Object.entries(opts.secretEnv)
      .map(([k, v]) => {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw new Error(`invalid env name: ${k}`);
        return `export ${k}=${shellQuote(v)}`;
      })
      .join("\n");
    script = `eval "$(cat)"\n${sh}`;
    input = `${exports}\n`;
  }
  const remoteCmd = [cfg.msb, "exec", ...envFlags, box, "--", "sh", "-lc", script].map(shellQuote).join(" ");
  return run("ssh", [...sshMuxOpts(cfg), cfg.vpsSsh, remoteCmd], { input, ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}) });
}
export { exec as execInBox };

// ----- Warm pool -------------------------------------------------------------------------
// Pool boxes are pre-booted from the snapshot with OPEN egress and pre-bootstrapped (claude+gh
// + git/gh auth + npm). Claiming one = copy the repo in, skipping the ~4s boot + bootstrap.
// They're named `<POOL_PREFIX><rand>` so they're discoverable across MCP process respawns.
const POOL_PREFIX = "pool-";

/**
 * Boot one warm pool box: snapshot + open egress + memory cap + auto-teardown, then
 * pre-bootstrap creds/tools so a claim only needs the repo copy. Requires cfg.snapshot.
 */
export async function bootWarmBox(cfg: Config, agent: AgentKind = "claude", owner: string | null = null): Promise<string> {
  // Flavor rides in the NAME (pool-<ts>-omp-<rand>) so every prefix/age-based pool mechanism
  // covers both flavors unchanged. Callers pass the flavored cfg (ompPoolCfg) for omp boots.
  const name = `${POOL_PREFIX}${Date.now()}-${agent === "omp" ? "omp-" : ""}${Math.random().toString(36).slice(2, 8)}`;
  warming.add(name);
  try {
    await bootAndWarm(cfg, name, agent, owner);
  } catch (e) {
    // A box whose warm-up failed (boot error, bootstrap error, or the health check below) is not
    // left running without /.ready for the orphan reaper to find twelve minutes later: it goes now,
    // and the refill that called us boots another. The error still propagates so the log says why.
    await forceRemoveBox(cfg, name).catch(() => {});
    throw e;
  } finally {
    warming.delete(name);
  }
  return name;
}

/**
 * Pool boxes THIS process is booting/warming. A box whose warm-up was cut off (controller restart
 * mid-warm-up) never gets /.ready, so it is neither claimable nor counted by the refill — which
 * boots a replacement and leaves the half-warmed box running (2G RAM) until its max-duration.
 * listPoolBoxes reaps such orphans; this set plus the age floor keeps it off live warm-ups.
 */
const warming = new Set<string>();

/** Longer than any bootWarmBox run (boot + bootstrap + MCP/skills + the 360s warm-up exec). */
export const WARM_UP_BUDGET_MS = 12 * 60_000;

/** A running, unclaimed, never-ready pool box that is past the warm-up budget and not ours. Pure. */
export function isOrphanWarmBox(name: string, state: string, inFlight: ReadonlySet<string>, nowMs = Date.now()): boolean {
  if (state !== "warming" || inFlight.has(name)) return false;
  const m = name.match(/^pool-(\d+)-/);
  return !!m && nowMs - Number(m[1]) > WARM_UP_BUDGET_MS;
}

/**
 * Wipe what the pool warm-up leaves behind before the box becomes claimable. The warm-up runs with
 * the box OWNER's MCP config and skills (nobody's, for a blank box) and only that owner can claim
 * it. The claim rewrites the MCP config and skills anyway, and the scrub keeps the warm-up's own
 * traces out of the first real run: omp's agent.db
 * (auth_credentials is where omp keeps MCP OAuth logins, plus the discovery cache), its logs and
 * warm-up transcripts, the HANA client's secure store (~/.hdb), mcp-remote's OAuth dir and npm
 * logs. Kept, because they are the point of warming: bun's transpile cache and the model catalog.
 */
export const OMP_WARM_SCRUB_SH =
  "rm -rf /root/.agent-mcp.json /root/.omp/agent/mcp.json /root/.claude/skills /root/.omp/agent/agent.db* " +
  "/root/.omp/agent/sessions /root/.omp/sessions /root/.omp/logs /root/.hdb /root/.mcp-auth /root/.npm/_logs " +
  "/root/.local/share/chrome-devtools-mcp /workspace/* /workspace/.[!.]* /tmp/* /root/.tmp/* 2>/dev/null; true";

/**
 * Prepare a booted, bootstrapped box for the one owner it will be handed to. `owner` null means a
 * blank box: nobody's MCP servers, skills or memory go in, so anyone may claim it and pays their
 * own install then. Runs as that owner, so every store read below is theirs and never the
 * operator's. All best-effort, at a time when nobody is waiting.
 */
async function prepareWarmBox(cfg: Config, name: string, agent: AgentKind, owner: string | null): Promise<void> {
  const asOwner = <T>(fn: () => Promise<T>): Promise<T> => (owner ? withOwner(owner, fn) : fn());
  if (agent === "omp") {
    // Pre-warm: the box's FIRST omp session pays bun compile caches, cold module trees AND every
    // MCP server's first-run side effects (connects, discovery, tool listing) — measured live as a
    // ~50s "Starting up" on the first task; every later session is ~12s. The owner's own MCP
    // config goes in first so the warm-up one-shot spawns the servers this owner really uses.
    if (owner) {
      await asOwner(async () => {
        await installMcpConfig(cfg, name).catch(() => {});
        // Skills too: omp indexes them on first sight (onnxruntime embedding load — expensive), and
        // they otherwise arrive only at claim time, putting that cost back on the user's first task.
        await installSkills(cfg, name).catch(() => {});
        await installMemory(cfg, name);
      });
    }
    // TWICE: measured on a warm box, the run right after a single warm-up still took 6.6s to
    // reach turn one and every run after it ~3.5s — so with one pass the user's task WAS that
    // second, half-primed run. The extra pass is ~5s at boot, when nobody is waiting.
    const oneShot =
      `OMP_SKIP_SETUP=1 timeout 180 omp --mode json --approval-mode=yolo ` +
      `--model "ccproxy/$ANTHROPIC_MODEL"` +
      `$([ -n "$ANTHROPIC_SMOL_MODEL" ] && printf -- ' --smol ccproxy/%s' "$ANTHROPIC_SMOL_MODEL")` +
      ` -p "Reply with exactly: ok" </dev/null >/dev/null 2>&1`;
    const warm =
      `mkdir -p /workspace && cd /workspace && ${ompSeedSh()} && { ${oneShot}; ${oneShot}; }; ` +
      `${OMP_WARM_SCRUB_SH}`;
    // Generous budget: the warm-up one-shot IS the ~50s cold start being absorbed — a timeout that
    // kills it mid-flight (the first version's 150s did, together with a cache-priming find) just
    // moves the cost back onto the user's first task.
    await msb(cfg, ["exec", name, ...agentEnvFlags(cfg, "noop", undefined, undefined, undefined, agent), "--", "bash", "-lc", warm], false, 360_000);
  } else if (owner) {
    // The owner's MCP config goes in now, not only at the claim: the warm-up start below (see
    // CLAUDE_PREWARM_SH) then starts the servers this owner really uses, once, while nobody waits.
    // It is written again at the claim, so a server added in between is not missed.
    const s = Date.now();
    const notes = await asOwner(() => installMcpConfig(cfg, name)).catch(() => [] as string[]);
    console.error(`[pool] ${name}: MCP servers ready in ${Date.now() - s}ms${notes.length ? ` (${notes.join("; ")})` : ""}`);
  }
}

/** Write who the box is for. The value is a tag (or "blank"), so it is safe inside a shell word. */
function ownerMarkSh(owner: string | null): string {
  return `printf %s ${owner ? ownerTag(owner) : BLANK_OWNER} > /.owner`;
}

/**
 * Hand a blank warm box to an owner without booting another VM: prepare it with that owner's set
 * and re-mark it. The box is not claimable while this runs (no /.ready), and a failure removes it
 * so nobody is handed a half-prepared box. Costs no extra RAM, which is the point.
 */
export async function adoptWarmBox(cfg: Config, box: string, agent: AgentKind, owner: string): Promise<void> {
  warming.add(box);
  try {
    await exec(cfg, box, "rm -f /.ready");
    await prepareWarmBox(cfg, box, agent, owner);
    const health = await exec(cfg, box, warmHealthSh(agent), { timeoutMs: 60_000 });
    const verdict = warmBoxVerdict(health.stdout);
    if (!verdict.ok) throw new Error(`warm box ${box} failed its health check (${verdict.reason}); it is not handed out`);
    await exec(cfg, box, `${ownerMarkSh(owner)} && touch /.ready`);
  } catch (e) {
    await forceRemoveBox(cfg, box).catch(() => {});
    throw e;
  } finally {
    warming.delete(box);
  }
}

/** MiB the host can still give out (MemAvailable), or undefined when it cannot be read. */
export async function hostFreeMb(cfg: Config): Promise<number | undefined> {
  try {
    const r = await ssh(cfg, "awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo", false);
    const n = Number(String(r.stdout ?? "").trim());
    return Number.isFinite(n) && n > 0 ? n : undefined;
  } catch {
    return undefined;
  }
}

async function bootAndWarm(cfg: Config, name: string, agent: AgentKind, owner: string | null = null): Promise<void> {
  await learnHostGuard(cfg);
  await learnPkgStore(cfg);
  await msb(cfg, [
    "run",
    "-d",
    "--name",
    name,
    "-m",
    cfg.memory,
    "--max-memory",
    cfg.memory, // pin the hotplug ceiling too, or metrics report the default 4G as the total
    ...cpuFlags(cfg),
    ...egressFlags(cfg, true), // pooled boxes always boot with open egress
    // An UNCLAIMED warm box must persist until a delegation claims it, so it uses the longer
    // poolIdleTimeout (not a session's idleTimeout) — otherwise it idle-stops and the pool drains.
    "--idle-timeout",
    cfg.poolIdleTimeout,
    // max-duration is anchored at BOOT, not at claim: a warm box claimed near the end of a plain
    // cfg.maxDuration was killed minutes into the user's run ("max duration exceeded" → exit 254).
    // Budget the whole pool window PLUS a full run; acquireBox's freshness gate enforces the rest.
    "--max-duration",
    warmMaxDuration(cfg.poolIdleTimeout, cfg.maxDuration),
    "--pull",
    "never",
    // The package store, for image boots (a snapshot boot is left exactly as it was).
    ...(cfg.snapshot ? [] : pkgStoreFlags()),
    // A snapshot carries its own rootfs size (pinned at bake time); an image boot sizes it here.
    ...rootSourceArgs(cfg),
    "--",
    "sleep",
    "infinity",
  ]);
  // Pre-bootstrap so claims are instant (idempotent; persists in the box rootfs). For omp this
  // also lays down the formatter + asb-guard ahead of the claim.
  await msb(cfg, ["exec", name, ...agentEnvFlags(cfg, "noop", undefined, undefined, undefined, agent), "--", "sh", "-lc", bootstrapScript(cfg, agent)]);
  await prepareWarmBox(cfg, name, agent, owner);
  // A box is handed out only if it can actually run a task: the disk has room for one and the
  // agent binary starts. Checked HERE, at warm-up time where nobody is waiting, rather than at
  // claim time: neither can change while the box sits idle, and `claude --version` is a ~1s node
  // startup that would otherwise sit on every task start. The claim re-reads only the disk.
  const health = await exec(cfg, name, warmHealthSh(agent), { timeoutMs: 60_000 });
  const verdict = warmBoxVerdict(health.stdout);
  if (!verdict.ok) throw new Error(`warm box ${name} failed its health check (${verdict.reason}); it is not handed out`);
  // Claimable only from here: the free-probe requires /.ready, so a delegation can never claim a
  // box whose (multi-minute, for omp) warm-up is still running — that race put the whole cold
  // start back on the user's first task while the pool claimed to be "warm". The owner marker lands
  // in the same step: a box is never ready without saying whose it is.
  await exec(cfg, name, `${ownerMarkSh(owner)} && touch /.ready`);
}

/**
 * Free KiB the root disk must keep for a run to live: the repo copy is already in, so this covers
 * the agent's log and transcript, git's lock files, the hooks and whatever the task writes. 100M
 * is far above what a run needs to start and far below what a full disk has (0). The MCP install
 * keeps its own, higher floor (MCP_MIN_FREE_KB) because an install is what used to eat the rest.
 */
export const RUN_MIN_FREE_KB = 102_400;
/** Free KiB on the root disk, one number (blank if df is unavailable). */
export const DF_FREE_KB_SH = `df -Pk / 2>/dev/null | awk 'NR==2{print $4}'`;
/**
 * Claude Code's first start in a box is slow: measured in a fresh warm box, 1.9 s to get going
 * the first time and 0.3 s every time after (it migrates its config, probes the filesystem, lays
 * out its caches). With the owner's MCP servers it is worse: 5 to 6 s before the first request
 * the first time, 2.3 s after, because each server reads its package from disk for the first
 * time. A warm box had never run any of it, so the user's first task paid that, and with the
 * wait for servers capped (CLAUDE_MCP_WAIT_MS) the slow ones missed the first turn. Here it is
 * all started once while nobody waits, against an address nothing listens on and with a key that
 * is not one: Claude Code and the servers start, no model is reached, and it is stopped. Nothing
 * of the attempt is kept.
 */
export const CLAUDE_PREWARM_SH =
  `(W=4; F=; if [ -s ${MCP_CONFIG_PATH} ]; then W=10; F="--mcp-config ${MCP_CONFIG_PATH}"; fi; ` +
  `cd /tmp && ANTHROPIC_API_KEY=warm ANTHROPIC_BASE_URL=http://127.0.0.1:9 CLAUDE_CODE_MCP_STARTUP_WAIT_MS=8000 ` +
  `timeout "$W" claude -p hi --setting-sources user $F --output-format stream-json --verbose >/dev/null 2>&1; ` +
  `rm -rf "$HOME/.claude/projects/-tmp"; true)`;
/** The warm-up health probe: free KiB on line one, then the agent's version line. */
export const WARM_HEALTH_SH = `${DF_FREE_KB_SH}; claude --version 2>/dev/null | head -1`;
/** The same, after the warm-up start for a box that will run Claude Code. */
export const warmHealthSh = (agent: AgentKind): string => (agent === "omp" ? WARM_HEALTH_SH : `${CLAUDE_PREWARM_SH}; ${WARM_HEALTH_SH}`);

/** Judge WARM_HEALTH_SH's output. Pure, so the gate is unit-tested without a box. */
export function warmBoxVerdict(stdout: string, minFreeKb = RUN_MIN_FREE_KB): { ok: true } | { ok: false; reason: string } {
  const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  const free = Number(lines[0]);
  if (!Number.isFinite(free)) return { ok: false, reason: "the root disk could not be read" };
  if (free < minFreeKb) return { ok: false, reason: `only ${Math.round(free / 1024)} MB free on the root disk` };
  if (!lines.slice(1).some((l) => /\d+\.\d+/.test(l))) return { ok: false, reason: "claude --version printed nothing" };
  return { ok: true };
}

/**
 * The launch preflight: if the root disk is below the run floor, drop what the box can spare (the
 * npm caches and temp dirs) and look again; still short means the run is NOT started — the
 * wrapper's first writes (git config, the hooks, the log) would fail with ENOSPC and the box
 * would die before turn one with nothing to say why. Sets $F to the free KiB after the attempt.
 */
export const DISK_PREFLIGHT_SH =
  `F=$(${DF_FREE_KB_SH}); if [ "\${F:-0}" -lt ${RUN_MIN_FREE_KB} ]; then ` +
  `npm cache clean --force >/dev/null 2>&1; rm -rf /root/.npm/_cacache /root/.npm-tmp /root/.tmp/* /tmp/* 2>/dev/null; F=$(${DF_FREE_KB_SH}); fi`;

/** A box whose disk cannot hold a run: thrown by the launch so the caller gets a sentence, not a dead box. */
export class DiskFullError extends Error {
  constructor(public readonly box: string, public readonly freeKb: number, public readonly totalKb: number) {
    super(
      `The sandbox disk is full (${Math.round(freeKb / 1024)} MB free of ${Math.round(totalKb / 1024)} MB), so the run was not started. ` +
        `Grow the disk from the machine menu and send the message again, or destroy this machine and start over.`
    );
    this.name = "DiskFullError";
  }
}

/** `diskfull <freeKb> <totalKb>` from a guarded launch, or undefined when the run was started. */
export function diskFullFromLaunch(stdout: string): { freeKb: number; totalKb: number } | undefined {
  const m = stdout.match(/^diskfull (\d+) (\d+)\s*$/m);
  return m ? { freeKb: Number(m[1]), totalKb: Number(m[2]) } : undefined;
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
export async function forceRemoveBox(cfg: Config, box: string): Promise<void> {
  await msb(cfg, ["stop", box], false);
  await msb(cfg, ["rm", "--force", box], false);
  // A parked box always carries an ask snapshot (parkWaitingBox creates one); box names are unique
  // per run, so a snapshot not removed here is orphaned host disk forever.
  await msb(cfg, ["snapshot", "rm", askSnapName(box)], false);
  await unmarkClaimed(cfg, box);
  await unmarkKept(cfg, box);
  await unmarkParked(cfg, box).catch(() => {});
}

/**
 * Reap pool boxes that are not actually Running (Stopped/exited/unknown). Returns the names of the
 * still-Running boxes. Removing dead boxes clears msb's stale state so a later refill can recreate
 * them cleanly instead of hitting "cannot start: already running".
 */
export async function reapDeadPoolBoxes(cfg: Config): Promise<string[]> {
  const boxes = await allPoolBoxes(cfg);
  const live: string[] = [];
  let claims: Map<string, number> | null = null;
  let kept: Set<string> | null = null;
  let parked: Set<string> | null = null;
  const sleepTtlSec = parseDurationSec(cfg.sleepTtl) ?? 86_400;
  for (const b of boxes) {
    if (isRunning(b.status)) {
      live.push(b.name);
      continue;
    }
    // A stopped box is either dead capacity (never claimed) or a SLEEPING RUN: claimed, idle-stopped,
    // workspace and session intact, wakeable by a reply. Only the former is reaped now; the latter
    // survives until the sleep TTL. (The claim marker lives on the host — the box can't be asked.)
    claims ??= await listClaims(cfg);
    kept ??= await listKept(cfg);
    parked ??= await listParked(cfg).catch(() => new Set<string>());
    const age = claims.get(b.name);
    // A PARKED box (stopped by the controller because a question is pending) costs disk only, so it
    // is held to the much longer park TTL — an overnight question must survive to be answered.
    const ttl = parked.has(b.name) ? Math.max(sleepTtlSec, askParkTtlSec()) : sleepTtlSec;
    if (shouldKeepStopped(age, ttl, kept.has(b.name))) {
      // Said when it becomes true, not on every sweep: one pinned run wrote this line every few
      // minutes for months and buried everything else in the log.
      const why = kept.has(b.name) ? "pinned" : "asleep";
      if (saidKeeping.get(b.name) !== why) {
        saidKeeping.set(b.name, why);
        console.error(
          why === "pinned"
            ? `[pool] keeping pinned run ${b.name} (asleep; held until the operator destroys it)`
            : `[pool] keeping sleeping run ${b.name} (asleep ${Math.round((age ?? 0) / 60)}m, ttl ${cfg.sleepTtl})`
        );
      }
      continue;
    }
    console.error(
      age === undefined
        ? `[pool] reaping dead box ${b.name} (status=${b.status || "unknown"})`
        : `[pool] reaping abandoned run ${b.name} (asleep ${Math.round(age / 3600)}h > ${cfg.sleepTtl})`
    );
    await forceRemoveBox(cfg, b.name);
  }
  return live;
}

/**
 * Available (unclaimed) warm boxes: only RUNNING pool boxes with no /.claimed marker. Stopped or
 * wedged boxes are reaped first so we never hand a dead box to a delegation (which would claim it,
 * record the task, but never run — the box shows run:running while Stopped).
 */
export async function listPoolBoxes(cfg: Config): Promise<string[]> {
  return (await listWarmBoxes(cfg)).map((b) => b.name);
}

/** A free warm box and who it is for: an owner tag, "blank", or "legacy" (made before owners existed). */
export interface WarmBox {
  name: string;
  owner: string;
}

/** Read the free-probe's last line: `claimed`, `warming`, or `free <owner>`. Pure. */
export function parseWarmProbe(stdout: string): { state: string; owner: string } {
  const m = stdout.trim().match(/(claimed|warming|free)(?:[ \t]+(\S+))?\s*$/);
  return m ? { state: m[1], owner: m[2] || "legacy" } : { state: "", owner: "legacy" };
}

/** The free warm boxes with their owners. One exec per box, the same one that proves it free. */
export async function listWarmBoxes(cfg: Config): Promise<WarmBox[]> {
  const live = await reapDeadPoolBoxes(cfg);
  const available: WarmBox[] = [];
  for (const box of live) {
    try {
      // Free = unclaimed AND finished its boot-time warm-up (/.ready is bootWarmBox's LAST step).
      // Without the readiness gate a box was claimable seconds after boot, mid-warm-up, and the
      // user's first task paid the whole cold start the pool exists to hide.
      // A box with no /.owner was warmed before boxes had owners; it reads as "legacy" and is
      // never handed out, because it may carry another owner's packages.
      const r = await exec(cfg, box, 'if [ -f /.claimed ]; then echo claimed; elif [ ! -f /.ready ]; then echo warming; else echo "free $(cat /.owner 2>/dev/null || echo legacy)"; fi');
      const { state, owner } = parseWarmProbe(r.stdout);
      if (state === "free") available.push({ name: box, owner });
      else if (isOrphanWarmBox(box, state, warming)) {
        console.error(`[pool] reaping orphaned warm-up ${box} (never became ready; its warm-up was cut off)`);
        await forceRemoveBox(cfg, box);
      }
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
  // The claim marker lands only if the disk can still take a run (the warm-up proved the rest,
  // see WARM_HEALTH_SH); one exec for both, this is the task-start critical path.
  const r = await exec(cfg, box, `F=$(${DF_FREE_KB_SH}); if [ "\${F:-0}" -lt ${RUN_MIN_FREE_KB} ]; then echo "lowdisk $F"; else touch /.claimed && echo claimed; fi`);
  const low = r.stdout.match(/^lowdisk (\d*)\s*$/m);
  if (low) throw new Error(`warm box ${box} has only ${Math.round(Number(low[1] || 0) / 1024)} MB free; not claiming it`);
  if (!/^claimed\s*$/m.test(r.stdout)) throw new Error(`warm box ${box} did not accept the claim marker`);
  // Host-side marker too: once this box sleeps, /.claimed is unreadable, and the marker is what
  // stops the pool maintainer from reaping the run (see claims.ts).
  await markClaimed(cfg, box);
  await copyTreeIntoBox(cfg, box, copyDir);
}



/**
 * Install the agent toolchain (claude + gh) into a box. Used when baking the warm snapshot.
 * omp is deliberately NOT baked: bun + omp (onnxruntime and friends) need ~1.5 GB and would not fit
 * the 1G default rootfs the snapshot pins for EVERY box — measured live: the bake ENOSPC'd and
 * produced an unbootable snapshot. omp installs at bootstrap instead, after the omp run's disk grow.
 */
export async function installTools(cfg: Config, box: string) {
  return exec(
    cfg,
    box,
    `set -e; ${claudeInstallSh(cfg.claudeCodeVersion)}; ` +
      "command -v gh >/dev/null || (type apt-get >/dev/null 2>&1 && apt-get update -qq && " +
      "apt-get install -y -qq gh >/dev/null 2>&1) || true; claude --version; gh --version | head -1"
  );
}

/**
 * Bake variant for the agent-omp snapshot: the claude toolchain PLUS bun + omp, then the caches
 * are stripped — npm's and bun's download caches are pure dead weight once the binaries are on
 * PATH, and everything left in the snapshot is paid again as disk by every box booted from it.
 */
export async function installOmpTools(cfg: Config, box: string) {
  return exec(
    cfg,
    box,
    `set -e; ${claudeInstallSh(cfg.claudeCodeVersion)}; ` +
      "command -v gh >/dev/null || (type apt-get >/dev/null 2>&1 && apt-get update -qq && " +
      "apt-get install -y -qq gh >/dev/null 2>&1) || true; " +
      `${ompInstallSh(cfg.ompVersion)}; ` +
      // debugpy: omp's debug (DAP) tool has NO Node adapter, so Python is the language where the
      // debugger genuinely works — bake its adapter so `debug` is usable out of the box.
      `{ pip3 install --break-system-packages debugpy || pip3 install debugpy || ` +
      `apt-get install -y -qq python3-debugpy; } >/dev/null 2>&1 || true; ` +
      `npm cache clean --force >/dev/null 2>&1 || true; rm -rf /root/.bun/install/cache /root/.cache/pip /tmp/* 2>/dev/null || true; ` +
      "claude --version; OMP_SKIP_SETUP=1 omp --version",
    { timeoutMs: 600_000 }
  );
}

/**
 * Where an omp box's rootfs comes from. A baked image (MSB_OMP_IMAGE) wins over the snapshot:
 * msb stores an image's layers ONCE on the host as shared read-only EROFS, so each box's private
 * upper.ext4 starts sparse (~1.5 MB measured) — whereas a snapshot boot COPIES the snapshot's full
 * upper (3.4 GB for agent-omp, no reflink on the host's ext4) into every box it boots.
 */
export function ompRootSource(cfg: Config): { image: string; snapshot: string } {
  return cfg.ompImage ? { image: cfg.ompImage, snapshot: "" } : { image: cfg.image, snapshot: cfg.ompSnapshot };
}

/**
 * Where a claude box's rootfs comes from — the same rule as ompRootSource: a baked image
 * (MSB_CLAUDE_IMAGE) wins over the snapshot (MSB_SNAPSHOT), because a snapshot boot copies the
 * whole upper per box (931M for the MCP-laden claude snapshot, no reflink on the host) while an
 * image is stored once and each box's upper starts empty. Callers splice this into the Config they
 * boot with (createBox / bootAndWarm read cfg.snapshot and cfg.image).
 */
export function claudeRootSource(cfg: Config): { image: string; snapshot: string } {
  return cfg.claudeImage ? { image: cfg.claudeImage, snapshot: "" } : { image: cfg.image, snapshot: cfg.snapshot };
}

/** The `msb run` rootfs flags: the snapshot (which pins its own disk size), or a sized image boot. */
export function rootSourceArgs(cfg: Config): string[] {
  return cfg.snapshot ? ["--from-snapshot", cfg.snapshot] : ["--root-disk", cfg.rootDisk, cfg.image];
}

/** Where a bake leaves the list of globally installed npm packages (src/package-watch.ts reads it). */
export const BAKED_MANIFEST = "/etc/asb-baked-npm.json";
/** Record what the bake installed globally: { dependencies: { name: { version } } }. Best-effort. */
export function bakedManifestSh(): string {
  return `npm ls -g --depth=0 --json 2>/dev/null > ${BAKED_MANIFEST} || true`;
}

/**
 * Dockerfile for the omp image: the same toolchain installOmpTools bakes into the snapshot, plus
 * the MCP server packages, in ONE RUN — a file deleted in a later layer still ships in the earlier
 * one, so the prune only saves anything inside the layer that created the bytes. Pruned (measured
 * on 18.4.3): onnxruntime's CUDA/TensorRT providers (~700M, no GPU in a microVM), its darwin/win32/
 * arm64 binaries, bun's install cache (a hardlinked second copy of every package), and — when the
 * build host has AVX2, which every box on it then has too — the unused baseline CPU builds of
 * pi-natives and bun (the loaders pick "modern" first).
 */
export function ompImageDockerfile(cfg: Config, base: string, npx: string[]): string {
  return agentImageDockerfile(cfg, base, npx, "omp");
}

/**
 * The same one-layer build for either flavor. The claude image is Claude Code + gh + the MCP
 * server packages (what the claude snapshot carried, minus the per-box copy of it); the omp image
 * adds bun, omp and debugpy. Both end with the baked-package manifest (BAKED_MANIFEST) so a box
 * can tell the controller what it was born with.
 */
export function agentImageDockerfile(cfg: Config, base: string, npx: string[], agent: "claude" | "omp"): string {
  if (!/^[\w./:@-]+$/.test(base)) throw new Error(`invalid base image: ${JSON.stringify(base)}`);
  const omp = agent === "omp";
  const steps = [
    "set -e",
    claudeInstallSh(cfg.claudeCodeVersion),
    // Fonts for the browser (src/browser.ts): the base image has DejaVu alone, so every page fell
    // back to it and an emoji was an empty box. Liberation stands in for Arial, Times and Courier.
    "apt-get update -qq && apt-get install -y -qq --no-install-recommends gh fonts-liberation fonts-noto-color-emoji >/dev/null",
    // The browser (src/browser.ts): one pinned, checksummed binary, for the agent and the pane.
    moliInstallSh(),
    ...(omp
      ? [ompInstallSh(cfg.ompVersion), "{ pip3 install --break-system-packages debugpy || apt-get install -y -qq --no-install-recommends python3-debugpy; } >/dev/null 2>&1 || true"]
      : []),
    preinstallSh(npx),
    "find / -xdev \\( -name libonnxruntime_providers_cuda.so -o -name libonnxruntime_providers_tensorrt.so \\) -delete",
    `for d in $(find / -xdev -type d -path '*onnxruntime-node/bin/napi-v*'); do rm -rf "$d/darwin" "$d/win32" "$d/linux/arm64"; done`,
    "if grep -q avx2 /proc/cpuinfo; then rm -f /usr/local/install/global/node_modules/@oh-my-pi/pi-natives-linux-x64/*-baseline.node; " +
      "rm -rf /usr/local/lib/node_modules/*/node_modules/@oven/bun-linux-x64-baseline; fi",
    "npm cache clean --force >/dev/null 2>&1 || true",
    bakedManifestSh(),
    "rm -rf /usr/local/install/cache /root/.bun/install/cache /root/.cache /root/.npm /root/.npm-tmp /root/.hdb /tmp/* /var/lib/apt/lists/* /var/cache/apt/*",
    "claude --version",
    `${MOLI_BIN} --version`,
    ...(omp ? ["omp --version"] : []),
  ];
  const env = omp ? "ENV BUN_INSTALL=/usr/local OMP_SKIP_SETUP=1\n" : "";
  return `FROM ${base}\n${env}RUN ${steps.join("; \\\n  ")}\n`;
}

/**
 * Build the omp image on the VPS and load it into msb's image store as `tag`. Docker (host-side)
 * builds it FROM the exact digest msb already caches for cfg.image, so the base layers dedupe with
 * the plain boxes' image; `docker save | msb load` imports it; the docker copy is dropped after.
 * The MCP package list is the operator's stored config plus `extraNpx` (OMP_BAKE_NPX).
 */
export async function bakeOmpImage(cfg: Config, tag: string, extraNpx: string[]): Promise<string> {
  return bakeAgentImage(cfg, tag, extraNpx, "omp");
}

/**
 * The install order for a bake: the operator's explicit (pinned) specs FIRST, then the store's.
 * preinstallSh skips a package that is already present by NAME, so with the store's unpinned
 * `btp-mcp-server` ahead of `btp-mcp-server@1.0.1` the pin was never installed — the bake took
 * whatever npm called latest that day, which is the drift the pin exists to prevent.
 */
export function bakeSpecOrder(storeSpecs: readonly string[], pinned: readonly string[]): string[] {
  return Array.from(new Set([...pinned, ...storeSpecs]));
}

export async function bakeAgentImage(cfg: Config, tag: string, extraNpx: string[], agent: "claude" | "omp"): Promise<string> {
  if (!/^[a-z0-9][\w.-]*:[\w.-]+$/.test(tag)) throw new Error(`invalid image tag: ${JSON.stringify(tag)}`);
  const insp = await msb(cfg, ["image", "inspect", cfg.image]);
  const digest = insp.stdout.match(/^Digest:\s+(sha256:[0-9a-f]{64})$/m)?.[1];
  if (!digest) throw new Error(`cannot resolve the digest of ${cfg.image}`);
  const repo = cfg.image.replace(/[:@].*$/, "");
  // The image is shared by every user, so it carries the list chosen for everyone
  // (BAKED_MCP_PACKAGES), not the operator's own servers; `extraNpx` adds or pins more.
  const df = agentImageDockerfile(cfg, `${repo}@${digest}`, bakeSpecOrder([...BAKED_MCP_PACKAGES], extraNpx), agent);
  const q = shellQuote(tag);
  const r = await run("ssh", [...sshMuxOpts(cfg), cfg.vpsSsh, 'sh -c "$(cat)"'], {
    timeoutMs: 1_800_000,
    input:
      `set -e; D=$(mktemp -d); printf '%s' ${shellQuote(Buffer.from(df).toString("base64"))} | base64 -d > "$D/Dockerfile"; ` +
      `docker build -q -t ${q} "$D" >/dev/null; docker save ${q} | ${shellQuote(cfg.msb)} load -q -t ${q}; ` +
      `docker rmi ${q} >/dev/null; rm -rf "$D"; ${shellQuote(cfg.msb)} image inspect ${q} | head -6\n`,
  });
  return r.stdout;
}

/**
 * Count live user sessions for the concurrency cap. Excludes UNCLAIMED warm pool boxes (they're
 * infrastructure); claimed pool boxes are real sessions and do count.
 */
export async function countBoxes(cfg: Config): Promise<number> {
  const r = await msb(cfg, ["ls", "--format", "json"], false);
  // Fail loud: a broken `msb ls` must not read as "0 boxes live" — that would wave any number of
  // delegations past the capacity gate while the host is unreachable.
  if (r.code !== 0) throw new Error(`msb ls failed (exit ${r.code}): ${r.stderr.slice(0, 200)}`);
  const entries = parseLsJson(r.stdout).filter((e) => isRunning(e.status));

  let count = 0;
  for (const e of entries) {
    if (isStoreBox(e.name)) continue;
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


export function agentEnvFlags(
  cfg: Config,
  task: string,
  repos?: RepoLayout[],
  ghTokenOverride?: string,
  modelOverride?: string,
  agent: AgentKind = "claude",
  /** Harness rules text (src/harness.ts rulesPreamble) for the FIRST turn; see harnessPromptHint. */
  rules?: string
): string[] {
  // The standing policy plus (when known) the goal-neutral repo-layout hint, so the agent knows
  // where each repo lives (/workspace/<name>). The TASK decides the goal. Passed as env, never argv.
  const driver = driverFor(agent);
  const basePrompt = `${driver.systemPrompt} ${MOLI_PROMPT_HINT}`;
  const sysPrompt = repos?.length
    ? `${basePrompt} ${reposPromptHint(repos)}`
    : basePrompt;
  const rulesHint = harnessPromptHint(rules);
  const flags = [
    "-e",
    `ANTHROPIC_BASE_URL=${cfg.anthropicBaseUrl}`,
    "-e",
    `ANTHROPIC_API_KEY=${cfg.anthropicApiKey}`,
    "-e",
    // Per-message model switch: the override is validated against the ccproxy catalog upstream
    // (src/models.ts isAllowedModel) — by the time it reaches here it is a known alias.
    `ANTHROPIC_MODEL=${modelOverride || cfg.anthropicModel}`,
    "-e",
    `AGENT_TASK=${task}`,
    "-e",
    `AGENT_SYS_PROMPT=${sysPrompt}`,
    // Pin the PLAN tool to TodoWrite. Newer Claude Code exposes EITHER TodoWrite or the task list
    // (TaskCreate/TaskUpdate/TaskList) and, unset, headless runs get the task list. Measured on the
    // installed 2.1.234: unset → TaskCreate only; `0`/`false` → TodoWrite only; `1` → TaskCreate only.
    // TodoWrite is the better fit here because it re-emits the WHOLE list per call, so one call is one
    // plan snapshot — the task tools emit one call per task, which turned a 4-step plan into 12
    // snapshots and made "how many times did it rewrite the plan" meaningless. The formatter still
    // understands both, so a box that ignores this flag degrades instead of losing its plan.
    "-e",
    "CLAUDE_CODE_ENABLE_TASKS=0",
    // Every non-interactive bash the agent spawns sources the auto-install hook (src/drivers/need.ts).
    "-e",
    `BASH_ENV=${NEED_HOOK}`,
    // The box's /tmp is a 256M tmpfs in RAM: anything the agent (or a tool it runs: npm, pip, a
    // build) parks there dies with ENOSPC at 256M however large the disk is. Temp files go on the
    // root disk instead; bootstrapScript creates the dir and sets the same for login shells.
    "-e",
    `TMPDIR=${BOX_TMPDIR}`,
  ];
  // Harness rules travel as their own variable, not folded into AGENT_SYS_PROMPT here: the run
  // wrapper (agentSh) persists them in the box on the first turn and appends them to the system
  // prompt on every turn, so a follow-up from any resume lane keeps the harness without the caller
  // knowing about it. Only the first turn carries a value; resumes read the stored copy.
  if (rulesHint) flags.push("-e", `AGENT_RULES=${rulesHint}`);
  // Driver-specific env (e.g. omp's "smol" model role) — see each driver's envFlags.
  flags.push(...driver.envFlags(cfg));
  // Non-Anthropic-native drivers (codex, opencode) read their model from $AGENT_MODEL (the launch
  // passes it as -m only when set, so an unset model means the CLI's own default).
  if (agent !== "claude" && agent !== "omp" && modelOverride) flags.push("-e", `AGENT_MODEL=${modelOverride}`);
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
 * The workdir of a run ALREADY in the box, read from the box instead of from a caller's layout.
 *
 * `claude -c` continues the most recent session **in the current directory**, so a resume MUST land
 * in the same cwd the first run used or it silently starts a brand-new session with no memory of the
 * conversation — the agent answers a follow-up by asking which PR you meant. Resume callers only
 * have a box id (the original plan is long gone), and passing `repos: undefined` made agentWorkdir
 * fall back to `/workspace` while the first run had used `/workspace/<repo>`.
 *
 * Source of truth is WORKDIR_MARK, written by the FIRST run: the live repo listing is NOT a proxy
 * for where the session lives, because the layout can change mid-thread — attaching a second repo
 * to a single-repo box flipped the derived cwd from /workspace/<repo> to /workspace, and the very
 * next follow-up silently resumed as a fresh session (live incident: the agent re-asked what the
 * task was, then reviewed a PR in the wrong repo). Only when the mark is absent (a box bootstrapped
 * by an older controller) does the layout-derived guess apply; it is correct as long as the layout
 * has not changed since the first run. Falls back to `/workspace` if the probe fails entirely.
 */
async function boxAgentWorkdir(cfg: Config, box: string): Promise<string> {
  try {
    const r = await exec(cfg, box, WORKDIR_PROBE_SH);
    return workdirFromProbe(r.stdout);
  } catch {
    return "/workspace";
  }
}

// The FIRST run's cwd — where the Claude session lives, so resumes land there even after the repo
// layout changes (attach_repo). Declared here, above the "stable in-box paths" block, because the
// probe below embeds it at module init.
const WORKDIR_MARK = "/workspace/.agent.workdir";

/** Lists the repo dirs directly under /workspace, one basename per line (empty for a bare box). */
export const WORKSPACE_DIRS_SH = 'for d in /workspace/*/; do basename "$d"; done';

/**
 * One probe for the resume cwd: the persisted mark first, then the repo listing after a `---` line.
 * A single exec, so the mark and the fallback can never disagree about which box they describe.
 */
export const WORKDIR_PROBE_SH = `cat ${WORKDIR_MARK} 2>/dev/null; echo ---; ${WORKSPACE_DIRS_SH}`;

/**
 * The workdir implied by a `WORKSPACE_DIRS_SH` listing. Pure so the resume-cwd rule is testable:
 * this is what keeps `claude -c` on the same session the first run created.
 */
export function workdirFromWorkspaceListing(stdout: string): string {
  const names = stdout
    .split("\n")
    .map((n) => n.trim())
    // An unmatched glob comes back literally as `*` on a bare box; not a repo.
    .filter((n) => n && n !== "*");
  return agentWorkdir(names.map((name) => ({ name })));
}

/**
 * The workdir implied by a `WORKDIR_PROBE_SH` output: the persisted mark wins; the layout-derived
 * guess covers boxes whose first run predates the mark. The mark must be an absolute path under
 * /workspace — anything else (corruption, a stray error line) is ignored rather than trusted as a cwd.
 */
export function workdirFromProbe(stdout: string): string {
  const sep = stdout.indexOf("---");
  const mark = (sep >= 0 ? stdout.slice(0, sep) : "").trim();
  if (mark === "/workspace" || /^\/workspace\/[^/\s]+$/.test(mark)) return mark;
  return workdirFromWorkspaceListing(sep >= 0 ? stdout.slice(sep + 3) : stdout);
}

/**
 * Which agent this thread runs on, recorded by the FIRST run (like WORKDIR_MARK). Every resume lane
 * only has a box id, so the box itself is the source of truth: a thread started on omp keeps
 * resuming omp (a mid-thread agent switch would orphan the session state of both CLIs).
 */
export const KIND_MARK = "/workspace/.agent.kind";

/**
 * Root disk an omp box BOOTS with (bun + omp need ~1.5 GB; the default rootfs is 1G). omp boxes
 * cold-boot from the base image with this size instead of claiming a pooled/snapshot box: growing
 * a claimed box needed `msb modify --restart`, and the restart window made the box unexecable —
 * the pool maintainer reaped it mid-claim (measured live). A cold boot has no such window, and the
 * volume is sparse, so unused space costs no host disk.
 */
export const OMP_MIN_DISK = "4G";

/**
 * Memory an omp box boots with. omp's bun runtime plus the per-session stdio MCP servers (each an
 * `npx …` node process) exhausted the 1G default: a live omp run's microVM died ~a minute in and
 * healed to "sandbox restarted mid-run" (exit 254) once a probe re-booted it. 2G is the next tier.
 */
export const OMP_MIN_MEMORY = "2G";

/**
 * vCPUs an omp box boots with. omp's headless start waits for EVERY MCP server before turn one,
 * and on the default single vCPU the ~8 server processes spawning at once serialized behind each
 * other: time-to-first-turn on a hot box measured 6.3s at 1 vCPU vs 3.7-4.3s at 2. vCPUs are
 * threads, not reserved cores, so an idle warm box costs the host nothing extra.
 */
export const OMP_CPUS = 2;

/**
 * vCPUs every other box boots with. Claude Code waits for the account's MCP servers before its
 * first request too: measured live on one vCPU, four server processes starting beside Claude Code
 * took 2.6 s together (1.3 s for the slowest alone) and the first request left 5.2 s after launch.
 */
export const BOX_CPUS = 2;

function cpuFlags(cfg: Config): string[] {
  return ["-c", String(cfg.cpus && cfg.cpus > 0 ? cfg.cpus : BOX_CPUS)];
}

/**
 * Parse the kind mark defensively: it sits in the agent-writable workspace, so only a clean
 * single-token "omp" is trusted; anything else (missing, claude, corruption) is claude — the agent
 * every box can run.
 */
export function boxAgentKindFrom(stdout: string): AgentKind {
  const k = stdout.trim();
  return k === "omp" || k === "codex" || k === "opencode" ? k : "claude";
}

/** Read the thread's agent kind from the box; claude when unreadable (older boxes, probe failure). */
export async function boxAgentKind(cfg: Config, box: string): Promise<AgentKind> {
  try {
    const r = await exec(cfg, box, `cat ${KIND_MARK} 2>/dev/null || true`);
    return boxAgentKindFrom(r.stdout);
  } catch {
    return "claude";
  }
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
export function gitCredentialsScript(ownerTokens: Record<string, string>, fallbackToken?: string): string {
  const owners = Object.keys(ownerTokens).filter((o) => o && ownerTokens[o]);
  if (owners.length === 0 && !fallbackToken) return "";
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
  // Host-level fallback: the DEFAULT account's token, matched only when no per-owner entry wins the
  // longest-prefix match. This is the git-over-https twin of the GH_TOKEN env the `gh` CLI already
  // gets — without it a task-only box (no resolved repos, so no per-owner lines) had NO git
  // credential helper at all, and the very first `git clone` of a private repo the connected
  // account could read stopped the run to ask for a token the profile already holds. Commit
  // IDENTITY is deliberately still never defaulted (applyGitCredentials sets it per resolved repo).
  if (fallbackToken) {
    lines.push(`printf '%s\\n' ${shellQuote(`https://x-access-token:${fallbackToken}@github.com`)} >> "$GC"`);
  }
  return lines.join(" && ");
}

/**
 * One-time in-box setup so the agent behaves like local Claude Code: install the agent + gh,
 * authenticate git via gh (credential helper), set the commit identity, and wire npm auth.
 * Idempotent — safe to run before every task; a snapshot warm-start makes it near-instant.
 */





/** The agent's `browser` command (src/browser.ts). Best-effort: a run must not fail to start over it. */
export async function installBrowserTool(cfg: Config, box: string): Promise<void> {
  const { sh, input } = browserToolSetup();
  await exec(cfg, box, sh, { input }).catch((e) => console.error(`[browser] could not install the browser command in ${box}: ${String((e as Error)?.message ?? e).slice(0, 200)}`));
}

/** On-disk temp dir for everything that runs in a box (see agentEnvFlags: /tmp is a 256M tmpfs). */
export const BOX_TMPDIR = "/root/.tmp";

export function bootstrapScript(cfg: Config, agent: AgentKind = "claude"): string {
  const lines = [
    "set -e",
    // Temp on the root disk for every `sh -lc` / `bash -lc` exec too (login shells read profile.d).
    `mkdir -p ${BOX_TMPDIR} && printf '%s\\n' 'export TMPDIR=${BOX_TMPDIR}' > /etc/profile.d/asb-tmpdir.sh`,
    claudeInstallSh(cfg.claudeCodeVersion),
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
    claudeDriver.gateScript()!,
    // Install the stream-json formatter so the dashboard terminal streams live progress.
    claudeDriver.formatter(),
    // `need` + the command-not-found hook: a missing CLI installs itself instead of ending the task.
    needSetup(),
    // `memory`: search what earlier runs learned, add a note mid-run (src/drivers/memory-tool.ts).
    memorySetup(),
  ];
  // Claude Code is ALWAYS installed (above): the read-only ask lane runs it next to any driver.
  // Another driver additionally needs its own CLI (idempotent when an image baked it), its event
  // formatter, and its gate (question hard-stop + control-plane guard).
  lines.push(...extraDriverSetup(cfg, agent));
  if (cfg.npmToken) {
    lines.push(
      'printf "//registry.npmjs.org/:_authToken=%s\\n" "$NPM_TOKEN" > "$HOME/.npmrc"'
    );
  }
  return lines.join(" && ");
}

/**
 * The setup shells a NON-claude driver adds on top of the always-present Claude Code base:
 * [install, formatter, gate]. Empty for claude. Used by bootstrap and by every resume (so a deploy
 * that changes a formatter or gate reaches long-running threads).
 */
function extraDriverSetup(cfg: Config, agent: AgentKind): string[] {
  if (agent === "claude") return [];
  const d = driverFor(agent);
  return [d.install(cfg), d.formatter(), d.gateScript()].filter((s): s is string => !!s);
}

// Stable in-box paths (above per-repo dirs so `status` finds them regardless of repo layout).
const DONE_MARK = "/workspace/.agent.done"; // written with the exit code when the run finishes
const RUN_MARK = "/workspace/.agent.running"; // present while a run is in flight
const PID_MARK = "/workspace/.agent.pid"; // pid of the run wrapper, for liveness checks
const START_MARK = "/workspace/.agent.start"; // guest /proc/uptime seconds when the run began
const BOOT_MARK = "/workspace/.agent.boot"; // the guest boot id the run began on (BOOT_ID below)
/** The kernel's per-boot uuid: the one boot marker that does not move while the box is up. */
const BOOT_ID = "/proc/sys/kernel/random/boot_id";
const TASK_MARK = "/workspace/.agent.task"; // the current task/follow-up text, so `monitor` can show it
// The harness rules the thread started on (src/agent-prompt.ts harnessPromptHint), written from
// $AGENT_RULES by the FIRST turn and appended to $AGENT_SYS_PROMPT by EVERY turn, so a follow-up from
// any resume lane keeps the harness. Lives beside the other marks, never in the task text.
export const RULES_MARK = "/workspace/.agent.rules";

/**
 * Shell fragment that reports the run state — with a liveness check. RUN_MARK alone is not proof of
 * a live run: if the microVM is stopped mid-run (idle reaper, host restart) or the wrapper is killed,
 * the marker survives on disk and every reader reports run:running forever. That deadlocks the whole
 * thread: the dashboard shows "working…" with no output, and /resume.json queues every new message to
 * the inbox, which only delivers on done/idle. So: a marker whose recorded pid is dead, or that
 * was recorded on a previous boot (boot id mismatch), is stale — heal it to done(254) in place and note
 * the interruption in the log so the user sees why the run ended. 254 is reserved for "interrupted".
 *
 * A restart is not the only way a run can vanish, and it used to be the only one we reported: a box
 * with a 1 GiB cap and no swap OOM-kills the agent, the wrapper dies with it, and the user was told
 * three times over that the sandbox had "restarted" — so they retried a task that could never fit.
 * So a kill in the guest ring buffer means 137 (128+SIGKILL) and a pointer at the memory control.
 *
 * But "this boot" is NOT "this run", and treating them as the same misreported a LIVE run as
 * OOM-killed: one manual `node` hog earlier in a box's life left a "Killed process" line in dmesg,
 * and every later interruption on that boot inherited exit 137 — while `claude` was still running.
 * The ring buffer is per-boot and monotonic, so the fix is to compare timestamps: a kill counts only
 * if it happened AFTER this run started (START_MARK, recorded from /proc/uptime on the same clock).
 * Both marks are missing on an old box mid-upgrade; no start time means we cannot attribute the
 * kill, and 254 ("interrupted") is the honest answer over a confident wrong one.
 */
const OOM_RE = "Out of memory: Killed process";
// Last kill's kernel timestamp: "[ 2047.861194] Out of memory: ..." -> "2047.861194".
const LAST_OOM_AT = `dmesg 2>/dev/null | grep ${shellQuote(OOM_RE)} | sed -n 's/^\\[[ ]*\\([0-9.]*\\)\\].*/\\1/p' | tail -1`;
export const RUN_STATE_SH =
  `if [ -f ${RUN_MARK} ]; then ` +
  `p=$(cat ${PID_MARK} 2>/dev/null); b=$(head -n 1 ${BOOT_MARK} 2>/dev/null); cur=$(cat ${BOOT_ID} 2>/dev/null); ` +
  // A run is live only if its pid was recorded THIS boot and that process still exists. Anything
  // else is stale. The two halves are both load-bearing:
  //   · the pid must still exist — otherwise the wrapper died (crash, OOM, VM stop);
  //   · the pid must have been recorded on THIS boot — after a reboot the workspace still holds
  //     the old pid, and pid numbers are recycled, so an unrelated process can inherit it and pin
  //     the box in `running` forever.
  // "This boot" is the kernel's boot id, recorded by the wrapper next to the pid. It used to be
  // judged by mtime, `PID_MARK -ot /proc/1`, and that healed a LIVE run to "restarted" seconds
  // after it launched (measured on a 1G box starting claude plus its MCP servers): /proc entries
  // are not real files, the kernel stamps /proc/1 with the time its inode was last CREATED, and
  // under page-cache pressure that inode is evicted and re-created at the next stat, so "boot"
  // moved to "now" and every mark on disk read as pre-boot. The mtime rule survives only as the
  // fallback for a run launched by the previous wrapper, which wrote no boot mark.
  `if [ -n "$b" ] && [ -n "$cur" ]; then if [ "$b" = "$cur" ]; then same=1; else same=; fi; ` +
  `elif [ ${PID_MARK} -ot /proc/1 ]; then same=; else same=1; fi; ` +
  `if [ -z "$p" ] || [ ! -d "/proc/$p" ] || [ -z "$same" ]; then ` +
  // START_MARK sits in the agent-writable workspace, so it is read defensively: the FIRST line
  // only (a forged "junk\n0" would otherwise pass a line-oriented filter and forge a start time of
  // zero, back-dating the run so any kill in the buffer post-dates it), and it must be a bare
  // number. Both values then go to awk as DATA via -v, never as program text, so nothing here is
  // parsed as awk source — which also avoids awk reading a leading-zero value as octal.
  //
  // A start mark older than /proc/1 belongs to a previous boot. Uptime resets at boot, so such a
  // mark is on a different epoch than the current dmesg timestamps and comparing them is
  // meaningless — it would read a fresh kill as "after" a stale start and report a confident 137.
  // That is the resize flow exactly (raise memory -> reboot -> marks survive), where the wrong
  // answer tells a user who just added memory to add memory again. Discard it: no usable start
  // time means the kill cannot be attributed to this run, and 254 ("interrupted") is honest.
  // The heal MUTATES (writes DONE_MARK, appends to the log) and is embedded in several unsynchronized
  // probes (fleet sweep, watch-hub tick, MCP status) that can fire in the same second — without a
  // winner, two probes both append the "interrupted" line and the transcript shows duplicate forged
  // turn boundaries. `mv` of the run marker is atomic: exactly one prober takes the heal, the rest
  // report the healed state read-only.
  `if mv ${RUN_MARK} ${RUN_MARK}.healing 2>/dev/null; then ` +
  `k=$(${LAST_OOM_AT}); s=$(head -n 1 ${START_MARK} 2>/dev/null | grep -Ex '[0-9]+(\\.[0-9]+)?'); ` +
  // The start mark is on this boot's clock only if the run is: a boot id mismatch discards it; a
  // run without a boot mark keeps the old mtime test for the start mark itself.
  `if { [ -n "$b" ] && [ -z "$same" ]; } || { [ -z "$b" ] && [ -f ${START_MARK} ] && [ ${START_MARK} -ot /proc/1 ]; }; then s=; fi; ` +
  `if [ -n "$k" ] && [ -n "$s" ] && awk -v k="$k" -v s="$s" 'BEGIN{exit !(k+0 > s+0)}' 2>/dev/null; then c=137; ` +
  `m="run interrupted: out of memory — the agent was killed by the kernel. Raise this machine memory from the menu, then send a message to continue."; ` +
  `else c=254; m="run interrupted: the sandbox restarted mid-run. Send a message to continue."; fi; ` +
  `echo $c > ${DONE_MARK}; rm -f ${RUN_MARK}.healing ${START_MARK} ${BOOT_MARK}; ` +
  `echo "$m" >> ${AGENT_LOG}; ` +
  `echo "run:done exit=$c"; ` +
  // Lost the mv race: another prober is healing right now — report done with its exit if already
  // published, else the generic interrupted code (the state IS dead either way).
  `else echo "run:done exit=$(cat ${DONE_MARK} 2>/dev/null || echo 254)"; fi; ` +
  `else echo "run:running"; fi; ` +
  `elif [ -f ${DONE_MARK} ]; then echo "run:done exit=$(cat ${DONE_MARK} 2>/dev/null)"; ` +
  `else echo "run:idle"; fi`;

// Sentinels the resume path writes into the log to record a user follow-up as a first-class turn.
// The trace parser (web/src/lib/trace.ts) recognises the same pair and emits a `you` event, so the
// user's message is persisted in the durable log and ordered correctly relative to agent output.


/** The question the operator answered, stamped into the log right before their ⟦you⟧ answer, so the
 *  transcript keeps question + options + answer together (the sentinel file itself is deleted). */
const ASK_MARK_OPEN = "⟦ask⟧";
const ASK_MARK_CLOSE = "⟦/ask⟧";

/**
 * The follow-up text a caller sends is echoed verbatim into the durable log inside a ⟦you⟧ block —
 * so a message that CONTAINS these sentinels forges transcript history. Observed live: a resume
 * whose body carried `⟦/you⟧`, `● session started (model evil-model)`, `⟦ask⟧ delete production?`
 * and a `⟦you⟧ yes` answer rendered in the dashboard as a genuine agent question the operator had
 * approved. The in-box agent recognised the injection and refused, but the *record* was forged, and
 * the record is what a human reviews. So the echoed copy is defanged: a zero-width space (U+200B)
 * is wedged in front of every ⟦ and of a line-leading ● — the parser matches neither `⟦you⟧` nor
 * `^●` any more, while the text still reads identically to a human. Only the LOG copy is touched:
 * $AGENT_TASK reaches claude unmodified, so the agent still sees exactly what the caller wrote.
 */
const DEFANG_SENTINELS_SED = `sed -e 's/⟦/​⟦/g' -e 's/^●/​●/' -e 's/^→/​→/'`;


/** omp reads its user-level MCP servers from here (it does NOT read Claude's paths or a flag). */
const OMP_MCP_CONFIG_PATH = "/root/.omp/agent/mcp.json";

/**
 * Write the enabled MCP servers into the box (or remove stale files when none are enabled). Runs
 * before every agent start/resume so a server added on the dashboard reaches the very next turn.
 * Written to BOTH agents' locations in one exec — the store shape ({mcpServers}) is the same, and
 * writing both keeps a thread honest if the box is ever probed by the other agent's tooling.
 * Best-effort: an MCP misconfiguration must never block a run.
 */
/**
 * The npm packages the config's `npx …` stdio servers will run, so they can be pre-installed.
 * `npx -y` downloads the package on FIRST use — in a cold box that download races the agent's MCP
 * startup timeout and loses ("not ready after 30000ms", measured live with omp's 30s cap). A global
 * pre-install puts the bin on PATH, so npx starts it instantly. Pure and exported for tests.
 */
export function npxPackagesOf(conf: { mcpServers: Record<string, unknown> }): string[] {
  const specs = new Set<string>();
  for (const s of Object.values(conf.mcpServers) as Array<{ type?: string; command?: string; args?: string[] }>) {
    if (s?.type !== "stdio" || s.command !== "npx") continue;
    const spec = (s.args ?? []).find((a) => a && !a.startsWith("-"));
    // Only things that look like npm package specs — an npx arg that is a URL or path is the
    // server's OWN argument (e.g. `npx mcp-remote https://…`), never something to install.
    if (spec && /^(@[\w.-]+\/)?[\w.-]+(@[\w.^~-]+)?$/.test(spec) && !/^https?:/.test(spec)) specs.add(spec);
  }
  return [...specs];
}

/**
 * In-box rewriter (node, argv = config files; env R = global node_modules root): every
 * `npx [-y] <pkg> …args` stdio server whose package is globally installed becomes
 * `<node> <pkg's bin file> …args`. Even with the package on disk, each npx launch is a full npm
 * CLI startup plus resolution (and a REGISTRY round trip for `@latest` specs) before the server
 * runs — with ~8 of them spawning at once on a 2-vCPU box that contention was ~6s of the omp
 * headless start, which waits for every server before turn one. Anything it can't map exactly
 * (unknown npx flags, ambiguous bins, package absent) is left on npx untouched.
 */
export const MCP_DIRECT_BIN_JS = String.raw`
const fs = require("fs"), path = require("path");
const R = process.env.R || "/usr/local/lib/node_modules";
// Specs the pre-install could not put on disk (env D, space-separated): their servers are DROPPED
// from the config rather than left on npx, which would download them mid-run into the same disk.
const DROP = new Set((process.env.D || "").split(/\s+/).filter(Boolean));
const dropped = new Set();
const NPX_FLAGS = new Set(["-y", "--yes", "-q", "--quiet"]);
for (const file of process.argv.slice(1)) {
  let conf;
  try { conf = JSON.parse(fs.readFileSync(file, "utf8")); } catch { continue; }
  let changed = false;
  for (const [sname, s] of Object.entries(conf.mcpServers || {})) {
    if (!s || s.type !== "stdio" || s.command !== "npx") continue;
    const args = s.args || [];
    let i = 0;
    while (i < args.length && NPX_FLAGS.has(args[i])) i++;
    const spec = args[i];
    if (!spec || spec.startsWith("-") || !/^(@[\w.-]+\/)?[\w.-]+(@[\w.^~-]+)?$/.test(spec)) continue;
    if (DROP.has(spec)) { delete conf.mcpServers[sname]; dropped.add(sname); changed = true; continue; }
    const at = spec.indexOf("@", 1);
    const name = at > 0 ? spec.slice(0, at) : spec;
    let pkg;
    try { pkg = JSON.parse(fs.readFileSync(path.join(R, name, "package.json"), "utf8")); } catch { continue; }
    const short = name.split("/").pop();
    let rel;
    if (typeof pkg.bin === "string") rel = pkg.bin;
    else if (pkg.bin && typeof pkg.bin === "object") {
      const keys = Object.keys(pkg.bin);
      rel = pkg.bin[short] ?? (keys.length === 1 ? pkg.bin[keys[0]] : undefined);
    }
    if (!rel) continue;
    const bin = path.join(R, name, rel);
    if (!fs.existsSync(bin)) continue;
    s.command = process.execPath;
    s.args = [bin, ...args.slice(i + 1)];
    changed = true;
  }
  if (changed) fs.writeFileSync(file, JSON.stringify(conf), { mode: 0o600 });
}
if (dropped.size) console.log("mcp-drop:" + [...dropped].join(","));
`;

export async function installMcpConfig(cfg: Config, box: string): Promise<string[]> {
  try {
    const store = await loadMcpStore(cfg);
    const policy = boxSecretPolicy(cfg);
    // Said once per install, in the controller log: which enabled server was kept out because it
    // carries the operator's own token. The MCP page says the same next to the server.
    const withheld = Object.values(store.servers).filter((s) => s.enabled && boxExclusion(s, policy) === "operator-token").map((s) => s.name);
    if (withheld.length) console.error(`[mcp] ${box}: kept out of the box (carries the controller's operator token): ${withheld.join(", ")}`);
    const conf = toClaudeMcpConfig(store, policy);
    if (!conf) {
      await exec(cfg, box, `rm -f ${MCP_CONFIG_PATH} ${OMP_MCP_CONFIG_PATH} ${MCP_NOTES_PATH}`);
      return [];
    }
    const json = JSON.stringify(conf);
    const specs = npxPackagesOf(conf);
    wantStoredPackages(cfg, specs);
    // ONE exec for the config writes, the package pre-install AND the npx→direct-bin rewrite: each
    // exec is an SSH→msb→guest round trip on the task-start critical path.
    const direct = specs.length
      ? `; R="$R" D="$D" node -e ${shellQuote(MCP_DIRECT_BIN_JS)} ${MCP_CONFIG_PATH} ${OMP_MCP_CONFIG_PATH} || true`
      : "";
    // The install's decisions are kept in the box (MCP_NOTES_PATH) so the thread can show what the
    // agent lacks — the watch probe reads them — and the bake's package manifest rides back on the
    // same exec, so the controller learns what the box was born with without opening a snapshot.
    const r = await exec(
      cfg,
      box,
      `printf '%s' ${shellQuote(json)} > ${MCP_CONFIG_PATH} && chmod 600 ${MCP_CONFIG_PATH} && ` +
        `mkdir -p /root/.omp/agent && printf '%s' ${shellQuote(json)} > ${OMP_MCP_CONFIG_PATH} && chmod 600 ${OMP_MCP_CONFIG_PATH}` +
        `; { ${preinstallSh(specs)}${direct}; } > ${MCP_NOTES_PATH} 2>&1; cat ${MCP_NOTES_PATH}` +
        `; echo "mcp-baked:$(tr -d '\\n' < ${BAKED_MANIFEST} 2>/dev/null)"`,
      { timeoutMs: 300_000 }
    );
    const out = r.stdout ?? "";
    const baked = out.match(/^mcp-baked:(\{.*\})\s*$/m);
    if (baked) rememberBaked(baked[1]);
    // A server that could not be installed on this disk is dropped for the run, not fatal — but it
    // must be visible somewhere, and the run log is the operator's first stop.
    const notes = mcpInstallNotes(out);
    if (notes.length) console.error(`[mcp] ${box}: ${notes.join("; ")}`);
    rememberProvision(box, notes);
    return notes;
  } catch (e) {
    console.error(`[mcp] could not install MCP config into ${box}:`, (e as Error).message);
    return [];
  }
}

/** Where the in-box install leaves its mcp-skip/fail/drop lines for the watch probe. */
export const MCP_NOTES_PATH = "/root/.agent-mcp.notes";

// What the controller knows about MCP package provisioning, for the MCP settings page: the baked
// manifest the last box reported, and the decisions of the last install. Process memory — both
// are re-learned on the next task start, and neither is worth a table.
let bakedPackages: Record<string, string> = {};
let lastProvision: LastProvision | undefined;

function rememberBaked(json: string): void {
  const m = parseBakedManifest(json);
  if (Object.keys(m).length) bakedPackages = m;
}

/** mcp-skip:'spec' free=…k / mcp-fail:'spec' / mcp-drop:name,name → the last provision record. */
export function rememberProvision(box: string, notes: readonly string[]): void {
  const specOf = (l: string) => (l.match(/^mcp-(?:skip|fail):'([^']+)'/)?.[1] ?? l.replace(/^mcp-(?:skip|fail):/, "").split(" ")[0].replace(/^'|'$/g, "")).trim();
  const skipped = notes.filter((l) => l.startsWith("mcp-skip:")).map(specOf);
  const failed = notes.filter((l) => l.startsWith("mcp-fail:")).map(specOf);
  const dropped = notes.filter((l) => l.startsWith("mcp-drop:")).flatMap((l) => l.slice("mcp-drop:".length).split(",").map((s) => s.trim()).filter(Boolean));
  lastProvision = { at: Date.now(), box, skipped, failed, dropped };
}

export function mcpProvisionState(): { baked: Record<string, string>; last: LastProvision | undefined } {
  return { baked: { ...bakedPackages }, last: lastProvision ? { ...lastProvision } : undefined };
}

/**
 * The root disk must keep at least this much free for a run to live (the repo copy, the agent's
 * log and transcript, git's lock files, the hooks); an MCP package that would eat into it is not
 * installed. 300M: the biggest server package in use unpacks to ~260M, so anything above this
 * line is a box with room, anything below is one that would have died.
 */
export const MCP_MIN_FREE_KB = 307_200;

/** The `mcp-skip:` / `mcp-fail:` / `mcp-drop:` lines the in-box install prints, for the run log. */
export function mcpInstallNotes(stdout: string): string[] {
  return stdout.split("\n").map((l) => l.trim()).filter((l) => /^mcp-(skip|fail|drop):/.test(l));
}

/**
 * Globally install npm packages in the box so `npx <pkg>` starts instantly instead of downloading
 * against the MCP startup timeout. Presence-guarded per package. Disk-guarded too, and the npm
 * cache is dropped after EVERY install rather than once at the end: a 1G box holding Claude Code
 * has ~550M to spare, and one server's tarballs plus its unpacked tree (btp-mcp-server ships two
 * 107M bun binaries) filled that to the last byte — every later write of the run (git config, the
 * PR-only hooks, the agent log) then failed with ENOSPC and the box died before turn one, for two
 * weeks of runs. A package that cannot fit is skipped, a failed install is removed again, and
 * either spec lands in $D so the rewriter drops its server from the config instead of leaving
 * `npx` to download it mid-run into the same full disk. Each decision is printed as an
 * `mcp-skip:` / `mcp-fail:` line (mcpInstallNotes) so the controller log says what the agent lacks.
 *
 * npm's temp dir is moved onto the root disk: the box's /tmp is a 256M tmpfs (RAM), and a
 * postinstall that downloads something big — onnxruntime-node fetches a GPU package of several
 * hundred MB — dies there with ENOSPC however large the disk is (seen with @cap-js/mcp-server in
 * every box AND in the bake). That GPU download is also told to stay home: no microVM has a GPU.
 */
/** Where a box notes the packages that failed to install, and for how long one is left alone. */
const MCP_FAIL_DIR = "/root/.asb/mcp-failed";
export const MCP_FAIL_RETRY_MIN = 360;
const NPM_INSTALL_ENV = "TMPDIR=/root/.npm-tmp ONNXRUNTIME_NODE_INSTALL_CUDA=skip";
/** The shell for the presence-guarded install, so callers can splice it into an existing exec. */
export function preinstallSh(specs: string[]): string {
  if (!specs.length) return "true";
  const steps = specs.map((spec) => {
    // Package NAME for the presence check: the spec minus any trailing @version (the leading
    // @scope survives because only an "@" after index 0 is a version separator).
    const at = spec.indexOf("@", 1);
    const name = at > 0 ? spec.slice(0, at) : spec;
    const dir = `"$R"/${shellQuote(name)}`;
    const q = shellQuote(spec);
    // A directory test, NOT `npm ls -g`: seven sequential npm invocations cost ~5s inside the box
    // on every run start (measured); the dir test is free and the no-op path is the common one.
    // A package that failed here a while ago is not tried again on every turn: measured live, one
    // package too big for the disk cost 20 s at the start of EVERY task and EVERY follow-up message.
    const mark = `"$M"/${shellQuote(spec.replace(/[^\w.@-]/g, "_"))}`;
    // First choice: the copy in the package store (src/pkg-store.ts), linked, not installed. A
    // link left dangling (a box restored without the mount) is replaced by whichever path wins.
    return (
      `[ -d ${dir} ] || { S=$(${storedPathSh(spec, shellQuote)}); F=$(df -Pk / 2>/dev/null | awk 'NR==2{print $4}'); [ -L ${dir} ] && rm -f ${dir}; ` +
      `if [ -n "$S" ] && [ -f "$S/package.json" ]; then mkdir -p "$(dirname ${dir})" && ln -sfn "$S" ${dir}; ` +
      `elif [ -n "$(find ${mark} -mmin -${MCP_FAIL_RETRY_MIN} 2>/dev/null)" ]; then echo mcp-fail:${q}" not-retried"; D="$D "${q}; ` +
      `elif [ "\${F:-0}" -lt ${MCP_MIN_FREE_KB} ]; then echo mcp-skip:${q}" free=\${F}k"; D="$D "${q}; ` +
      `elif ${NPM_INSTALL_ENV} npm i -g --no-audit --no-fund ${q} >/dev/null 2>&1; then npm cache clean --force >/dev/null 2>&1; ` +
      `else echo mcp-fail:${q}; D="$D "${q}; rm -rf ${dir}; mkdir -p "$M"; : > ${mark}; npm cache clean --force >/dev/null 2>&1; fi; } || true`
    );
  });
  // The global root is /usr/local/lib/node_modules in every box image we ship; `npm root -g` is
  // itself a ~1s npm startup, so it is only the fallback for a nonstandard image.
  return `R=/usr/local/lib/node_modules; [ -d "$R" ] || R=$(npm root -g); D=; M=${MCP_FAIL_DIR}; mkdir -p /root/.npm-tmp; ${steps.join("; ")}; rm -rf /root/.npm-tmp; true`;
}

export async function preinstallNpmPackages(cfg: Config, box: string, specs: string[]): Promise<void> {
  if (!specs.length) return;
  await exec(cfg, box, preinstallSh(specs), { timeoutMs: 300_000 });
}

/**
 * The dead weight the MCP server packages drag into a box, for a bake to strip before the snapshot
 * is taken (the same cuts ompImageDockerfile makes in its one layer, measured there): onnxruntime's
 * CUDA/TensorRT providers (~700M, no GPU in a microVM), its darwin/win32/arm64 binaries, and bun's
 * baseline CPU build when the host has AVX2 — every box booted from the snapshot would otherwise
 * copy all of it. Confined to the global node_modules: the box root is an overlay, and a tree-wide
 * find is both slow and pointless there. Then the caches, which are tarballs nothing reads again.
 */
export function pruneMcpPackagesSh(root = "/usr/local/lib/node_modules"): string {
  const r = shellQuote(root);
  return (
    `find ${r} \\( -name libonnxruntime_providers_cuda.so -o -name libonnxruntime_providers_tensorrt.so \\) -delete 2>/dev/null; ` +
    `for d in $(find ${r} -type d -path '*onnxruntime-node/bin/napi-v*' 2>/dev/null); do rm -rf "$d/darwin" "$d/win32" "$d/linux/arm64"; done; ` +
    `if grep -q avx2 /proc/cpuinfo 2>/dev/null; then rm -rf ${r}/*/node_modules/@oven/bun-linux-x64-baseline; fi; ` +
    `npm cache clean --force >/dev/null 2>&1; rm -rf /root/.npm/_cacache /root/.npm-tmp /root/.cache /tmp/* /root/.tmp/* 2>/dev/null; true`
  );
}

/** Where dashboard-configured skills land inside the box. `--setting-sources user` loads exactly
 *  this tree, so the in-box claude discovers them natively (and repo-shipped skills never load). */
/**
 * Sync the owner's enabled skills into the box before every run/resume: the whole tree is replaced,
 * so an edit, a disable, or a delete on the dashboard reaches the very next turn. One exec for all
 * of them, plus the skills index (SKILLS_INDEX) every driver's prompt picks up. Best-effort: a skill
 * must never block a run. Returns the installed set (empty on failure) for the per-turn skill hint.
 */
export async function installSkills(cfg: Config, box: string): Promise<SkillDef[]> {
  try {
    const skills = skillsForBox(await loadSkillStore(cfg), boxSkillSelection(box));
    if (!skills.length) {
      await exec(cfg, box, `rm -rf ${SKILLS_DIR}`);
      return [];
    }
    // The payload rides stdin as a base64 tar, not argv: skills carry whole file trees now
    // (scripts/, docs/, …) and a shell argument caps at ~128 KB — see ExecOpts.input.
    const tarB64 = buildSkillsTarBase64(skills, skillsIndex(skills));
    await exec(cfg, box, `rm -rf ${SKILLS_DIR} && mkdir -p ${SKILLS_DIR} && base64 -d | tar -xf - -C ${SKILLS_DIR}`, { input: tarB64 });
    return skills;
  } catch (e) {
    console.error(`[skills] could not install skills into ${box}:`, (e as Error).message);
    return [];
  }
}

/** Where the memory files land for each driver (claude reads ~/.claude, omp ~/.omp). */
const MEMORY_PATHS = [MEMORY_MD, "/root/.omp/MEMORY.md"] as const;
const MEMORY_ALL_PATHS = [MEMORY_ALL_MD, "/root/.omp/MEMORY-all.md"] as const;

/**
 * The GitHub slugs of the repos checked out in a box, from each dir's origin remote — a resume only
 * has a box id, so this is how it gets the same memory as the first turn. Exported for the harvest
 * (src/http.ts), which needs the scope of a note while the run is still going.
 */
export async function boxRepoSlugs(cfg: Config, box: string): Promise<string[]> {
  const r = await exec(cfg, box, `for d in /workspace/*/; do git -C "$d" remote get-url origin 2>/dev/null; done; true`);
  const repos: string[] = [];
  for (const line of (r.stdout ?? "").split(/\r?\n/)) {
    const slug = repoSlugFromUrl(line);
    if (slug && !repos.includes(slug)) repos.push(slug);
  }
  return repos;
}

/** Notes already counted as recalled by a box: a twenty-turn thread is one use, not twenty. */
const recalledBy = new Map<string, Set<string>>();
/** The latest receipt per box, so the watch path never has to open the owner's store. */
const memoryReceipts = new Map<string, MemoryReceipt | null>();

/**
 * What the box's latest turn was handed from memory, for the thread. Read from this process when
 * it installed it; otherwise once from the owner's store (a restart, a sleeping box).
 */
export function memoryReceiptOf(box: string, owner?: string): MemoryReceipt | undefined {
  if (!memoryReceipts.has(box)) {
    try {
      memoryReceipts.set(box, loadMemoryStore(owner).receipts?.[box] ?? null);
    } catch {
      return undefined;
    }
  }
  return memoryReceipts.get(box) ?? undefined;
}

/** A box is gone: forget what this process knew of its recalls. */
export function forgetMemoryReceipt(box: string): void {
  recalledBy.delete(box);
  memoryReceipts.delete(box);
}

/**
 * Drop the owner's memory (src/memory-store.ts) into the box before every run/resume: MEMORY.md
 * (Core + the notes relevant to `task`) and MEMORY-all.md (every note, for `memory search`), for
 * the operator plus the repos checked out here. Replaced whole every turn, so a dashboard edit or
 * delete reaches the next turn; removed when there is nothing (or memory is off) so a stale file
 * never lingers. Every note the task brought up counts one recall per run (it decides what the
 * caps keep and tells the Memory page which notes earn their place), the turn's receipt is kept
 * for the thread ("Memory: 6 notes"), and on the first turn the returned `hint` names the matched
 * playbooks (it rides the skill-hint env, see skillHintFlags). Best-effort: memory must never
 * block a run.
 */
export async function installMemory(cfg: Config, box: string, task?: string, opts: { firstTurn?: boolean } = {}): Promise<{ hint: string }> {
  try {
    const store = loadMemoryStore();
    const rm = `rm -f ${[...MEMORY_PATHS, ...MEMORY_ALL_PATHS].join(" ")}`;
    if (!store.enabled || (!store.global.length && !Object.keys(store.repos).length && !Object.keys(store.episodes ?? {}).length)) {
      await exec(cfg, box, rm);
      return { hint: "" };
    }
    const repos = await boxRepoSlugs(cfg, box);
    const md = renderMemoryMd(store, repos, task, { box });
    // A repo with history but no notes yet still gets MEMORY.md; the archive then says so.
    const all = renderMemoryArchive(store, repos) ?? "# Memory archive\n\nNo notes yet for this operator and these repos.\n";
    if (!md) {
      await exec(cfg, box, rm);
      return { hint: "" };
    }
    const sel = selectMemory(store, repos, task, { box });
    const matched = sel.matchedPlaybooks;
    // Only a real turn is a recall: the pool's warm-up installs memory with no task and no reader.
    if (task?.trim()) {
      const counted = recalledBy.get(box) ?? new Set<string>();
      recalledBy.set(box, counted);
      const fresh = sel.picked.filter((n) => !counted.has(n.id));
      for (const n of fresh) counted.add(n.id);
      markUsed(fresh);
      const receipt = receiptOf(sel);
      recordReceipt(store, box, receipt);
      memoryReceipts.set(box, receipt);
      try {
        saveMemoryStore(store);
      } catch {
        /* a lost counter bump is not worth failing the turn */
      }
    }
    // Each file rides stdin (it can run past what a shell argument safely carries) and is written
    // once, then copied, so both drivers see the identical text.
    const write = (paths: readonly string[], text: string) => {
      const [first, ...rest] = paths;
      const dirs = paths.map((p) => p.replace(/\/[^/]+$/, "")).join(" ");
      return exec(cfg, box, `mkdir -p ${dirs} && cat > ${first}${rest.map((p) => ` && cp ${first} ${p}`).join("")}`, { input: text });
    };
    await Promise.all([write(MEMORY_PATHS, md), write(MEMORY_ALL_PATHS, all)]);
    return { hint: opts.firstTurn ? playbookHint(matched) : "" };
  } catch (e) {
    console.error(`[memory] could not install memory into ${box}:`, (e as Error).message);
    return { hint: "" };
  }
}

/**
 * The per-turn skill env (src/skill-match.ts skillTurnHint): an explicit `/name` on any turn, or the
 * matcher's suggestions on the first. Recorded on the run so the UI can show "Skills: x (auto)".
 * `extra` rides the same env — the memory playbook hint (installMemory) is the one other first-turn
 * one-liner, and a second env would mean a second splice point in agentSh for no gain.
 */
function skillHintFlags(box: string, task: string, skills: SkillDef[], firstTurn: boolean, extra = ""): string[] {
  const { hint, picks } = skillTurnHint(task, skills, firstTurn);
  recordSkillPicks(box, picks);
  const line = [hint, extra].filter(Boolean).join(" ");
  return line ? ["-e", `AGENT_SKILL_HINT=${line}`] : [];
}

/**
 * Build the background agent command. The agent runs headless and DETACHED so `msb exec` returns
 * immediately (fixing the MCP response timeout): delegate returns the session id in seconds while
 * the task keeps running in the box. Completion is observable via the .agent.done sentinel (holds
 * the exit code); `status` reads it. `resume=true` continues the existing Claude session (-c).
 */

export function agentSh(workdir: string, resume: boolean, agent: AgentKind = "claude"): string {
  // The one driver-specific piece of the wrapper: the command that runs a turn and pipes its
  // native events through the driver's formatter into the agent log (src/drivers/).
  // A per-thread provider (src/providers.ts) is written to PROVIDER_ENV_PATH by the first run and
  // sourced by EVERY turn, so a resume from any lane keeps the provider the thread started on.
  const launch = `[ -f ${PROVIDER_ENV_PATH} ] && . ${PROVIDER_ENV_PATH}; ` + driverFor(agent).launch({ resume });
  // Clear any pending question up front: a new run or a resume (which carries the answer) means the
  // previous question is now handled, so status stops reporting "waiting".
  // On resume, stamp the user's follow-up into the durable log BEFORE Claude runs, so the dashboard
  // reconstructs the turn from one source of truth (the log) instead of ephemeral browser state:
  // this fixes both the ordering (the `you` line lands before the new agent output, so it renders
  // above the response it triggered) and the persistence (it survives a page refresh). The `⟦you⟧`
  // sentinel is a line the trace parser turns into a `you` event; `⟦/you⟧` closes a multi-line
  // message so trailing agent prose is never absorbed into it.
  const echoFollowup = resume
    ? `if [ -s ${QUESTION_MARK} ]; then { printf '%s\\n' ${shellQuote(ASK_MARK_OPEN)}; cat ${QUESTION_MARK}; printf '\\n%s\\n' ${shellQuote(ASK_MARK_CLOSE)}; } >> ${AGENT_LOG}; fi; ` +
      // Stamped `date +%s` + "000": busybox date has no %N, and a bubble's time needs no more.
      `{ printf '%s %s000\\n' ${shellQuote(AT_MARK)} "$(date +%s)"; printf '%s\\n' ${shellQuote(YOU_MARK_OPEN)}; printf '%s\\n' "$AGENT_TASK" | ${DEFANG_SENTINELS_SED}; printf '%s\\n' ${shellQuote(YOU_MARK_CLOSE)}; } >> ${AGENT_LOG} && `
    : ``;
  // Two resumes can land at once (an inbox delivery and an explicit resume raced in live testing):
  // both ran `claude -c` concurrently in the same dir, and the second's sentinel reset stomped the
  // first's RUN_MARK/DONE_MARK — the transcript showed two interleaved "session started" turns and
  // status flipped to done while a run was still going. A resume therefore WAITS for a live
  // in-flight run to finish (dead-pid/stale marks don't count — same liveness rule as RUN_STATE_SH)
  // instead of starting a second one; the message is preserved, just delivered next.
  // If the loop EXPIRES with the run still live (a >10-minute turn), ABORT instead of falling
  // through: launching anyway is exactly the concurrent-`claude -c` stomp the wait exists to
  // prevent, just deferred to long turns. The wrapper is detached (nohup, fds to /dev/null), so the
  // abort is surfaced in the agent log the dashboard renders — never silently.
  const waitForRun = resume
    ? `i=0; while [ -f ${RUN_MARK} ] && [ $((i+=1)) -le 600 ]; do ` +
      `p=$(cat ${PID_MARK} 2>/dev/null); { [ -z "$p" ] || [ ! -d "/proc/$p" ]; } && break; sleep 1; done; ` +
      `if [ -f ${RUN_MARK} ]; then p=$(cat ${PID_MARK} 2>/dev/null); ` +
      `if [ -n "$p" ] && [ -d "/proc/$p" ]; then ` +
      `echo '[system] a follow-up arrived while a turn was still running after a 10-minute wait; it was NOT delivered — resend it when this turn finishes' >> ${AGENT_LOG}; exit 213; fi; fi; `
    : ``;
  const inner =
    waitForRun +
    // Record the task (from env) so `monitor`/the dashboards can show what this box is doing. Only
    // the FIRST run writes it: the marker is the ORIGINAL task, read back whole by the watch/fleet
    // probes for the thread's pinned Task bubble. Follow-ups are already first-class ⟦you⟧ turns in
    // the log; appending them here (the old behavior) just mashed them into the task text.
    // The workdir mark is (re)written on the FIRST run only, like TASK_MARK: it records where this
    // thread's Claude session lives, so a resume lands there even if repos are attached later.
    `cd ${workdir} && ${resume ? `true` : `printf '%s\\n' "$AGENT_TASK" > ${TASK_MARK} && printf '%s\\n' ${shellQuote(workdir)} > ${WORKDIR_MARK} && printf '%s\\n' ${shellQuote(agent)} > ${KIND_MARK}`} && ` +
    // Harness rules: the first turn stores what the controller sent (or clears a stale mark on a
    // reused box); every turn then appends the stored text to the system prompt. This is the ONE
    // place the rules join the prompt, so the task the operator typed is never rewritten.
    (resume ? `` : `{ if [ -n "$AGENT_RULES" ]; then printf '%s\\n' "$AGENT_RULES" > ${RULES_MARK}; else rm -f ${RULES_MARK}; fi; } && `) +
    `{ if [ -s ${RULES_MARK} ]; then AGENT_SYS_PROMPT="$AGENT_SYS_PROMPT $(cat ${RULES_MARK})"; export AGENT_SYS_PROMPT; fi; } && ` +
    // Skills index (installSkills writes it each turn): appended the same way for every driver, so
    // codex/opencode/omp learn the playbooks exist too, not only Claude Code's native loader.
    `{ if [ -s ${SKILLS_INDEX} ]; then AGENT_SYS_PROMPT="$AGENT_SYS_PROMPT $(cat ${SKILLS_INDEX})"; export AGENT_SYS_PROMPT; fi; } && ` +
    // Per-turn skill hint (skillHintFlags). First turn: system prompt, which every driver reads on
    // turn one. Resume: prefixed to the task AFTER the ⟦you⟧ echo (the transcript keeps the clean
    // message), because codex/opencode/omp only send $AGENT_SYS_PROMPT on their first prompt.
    (resume
      ? ``
      : `{ if [ -n "$AGENT_SKILL_HINT" ]; then AGENT_SYS_PROMPT="$AGENT_SYS_PROMPT $AGENT_SKILL_HINT"; export AGENT_SYS_PROMPT; fi; } && `) +
    echoFollowup +
    (resume
      ? `{ if [ -n "$AGENT_SKILL_HINT" ]; then AGENT_TASK="$(printf '%s\\n\\n%s' "$AGENT_SKILL_HINT" "$AGENT_TASK")"; export AGENT_TASK; fi; } && `
      : ``) +
    // $$ is this wrapper's pid — the process that writes DONE_MARK at the end — recorded so status
    // reads can tell a live run from a stale marker left by a mid-run VM stop (see RUN_STATE_SH).
    //
    // ORDER MATTERS: the pid is written BEFORE the run marker. A status read treats a live pid as
    // proof of a live run, so publishing the pid first means the marker is never visible while the
    // PREVIOUS run's dead pid is still on disk — the window that healed a running agent to done.
    //
    // The start time is recorded on the same clock the guest's dmesg timestamps use, so an OOM kill
    // can be attributed to this run rather than to anything earlier in the boot. It is deliberately
    // NOT part of the && chain: a failure to write it (a full disk) must cost us the OOM hint, not
    // the whole run — chaining it would skip `claude` entirely and, with DONE_MARK already removed
    // and all output sent to /dev/null, the box would sit at `idle` with the user's message gone.
    // A fresh turn starts with no stale mid-turn mail or delivery receipts (src/drivers/inbox-gate.ts).
    `rm -f ${DONE_MARK} ${QUESTION_MARK}; ${INBOX_RESET_SH}; echo $$ > ${PID_MARK} && ` +
    // The boot id rides beside the pid so a status read can tell "this boot" without trusting a
    // /proc mtime (see RUN_STATE_SH). Best-effort like the start mark: no mark means the reader
    // falls back to the mtime rule, never that the run is skipped.
    `{ cat ${BOOT_ID} > ${BOOT_MARK} 2>/dev/null || rm -f ${BOOT_MARK}; }; ` +
    `{ cut -d' ' -f1 /proc/uptime > ${START_MARK} || rm -f ${START_MARK}; }; touch ${RUN_MARK} && ` +
    // pipefail so the recorded exit reflects claude's, not the formatter's. Claude's raw stderr also
    // lands in the log (errors aren't JSON). The formatter appends readable lines to the same log as
    // events stream in, tailing live for the dashboard. Run under bash (present in the node image) so
    // pipefail is available.
    `{ set -o pipefail; ` +
    launch +
    `echo $? > ${DONE_MARK}; rm -f ${RUN_MARK} ${PID_MARK} ${START_MARK} ${BOOT_MARK}; }`;
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
export async function applyGitCredentials(cfg: Config, box: string, creds?: AgentCreds): Promise<void> {
  const lines: string[] = [];

  const credScript = gitCredentialsScript(creds?.ownerTokens ?? {}, creds?.primaryToken);
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
  creds?: AgentCreds,
  model?: string,
  agent: AgentKind = "claude",
  /** Harness rules for the thread (src/harness.ts rulesPreamble); stored in the box by the first turn. */
  rules?: string,
  /** Vault secrets granted to the run (src/secrets-store.ts): -e flags on the agent exec only, same path as resume secrets. */
  secrets?: Record<string, string>
) {
  const env = agentEnvFlags(cfg, task, repos, creds?.primaryToken, model, agent, rules);
  const agentEnv = [...env, ...secretEnvFlags(secrets)];
  const workdir = agentWorkdir(repos);
  // Publish the task BEFORE bootstrap, not only when agentSh launches. The thread view treats
  // "runState idle + no task" as an unused box and shows the "Nothing has run here yet" card —
  // which is exactly what a just-delegated cold boot looked like for the whole bootstrap window
  // (~60s on an omp box installing bun+omp). With the mark up early, every fleet/watch probe reads
  // a task and the dashboard renders "starting" instead. agentSh re-writes the same content on
  // launch (first-run marks), which is harmless. Best-effort: rides stdin, never argv.
  const t0 = Date.now();
  await exec(cfg, box, `cat > ${TASK_MARK}`, { input: `${task}\n` }).catch(() => {});
  const t1 = Date.now();
  await msb(cfg, ["exec", box, ...env, "--", "sh", "-lc", bootstrapScript(cfg, agent)]);
  const t2 = Date.now();
  // These four touch independent files (~/.git-credentials + per-repo config, ~/.claude.json,
  // /root/.agent-mcp.json, ~/.claude/skills), so they run in parallel: each is an SSH→msb→guest
  // round-trip, and serializing them was most of the delegate→first-token latency after boot.
  const timed = async <T>(label: string, p: Promise<T>): Promise<T> => {
    const s = Date.now();
    try {
      return await p;
    } finally {
      prepMarks.push(`${label}=${Date.now() - s}ms`);
    }
  };
  const prepMarks: string[] = [];
  const [, , , skills, memory] = await Promise.all([
    timed("creds", applyGitCredentials(cfg, box, creds)),
    timed("trust", trustWorkspace(cfg, box)),
    timed("mcp", installMcpConfig(cfg, box)),
    timed("skills", installSkills(cfg, box)),
    timed("memory", installMemory(cfg, box, task, { firstTurn: true })),
    timed("browser", installBrowserTool(cfg, box)),
  ]);
  const t3 = Date.now();
  const r = await msb(cfg, ["exec", box, ...agentEnv, ...skillHintFlags(box, task, skills, true, memory.hint), "--", "sh", "-lc", guardedAgentSh(workdir, false, agent)]);
  console.error(
    `[timing] runAgentTask ${box} taskmark=${t1 - t0}ms bootstrap=${t2 - t1}ms prep=${t3 - t2}ms (${prepMarks.join(" ")}) exec=${Date.now() - t3}ms`
  );
  const full = diskFullFromLaunch(r.stdout);
  if (full) throw new DiskFullError(box, full.freeKb, full.totalKb);
  return r;
}

/**
 * The launch behind the disk preflight (DISK_PREFLIGHT_SH). A disk below the run floor records the
 * reason where every reader looks — a line in the agent log, EXIT_DISK_FULL in the done mark, so the
 * thread shows "Disk full" and the notification says so — and prints `diskfull <free> <total>` for
 * the controller, which turns it into a DiskFullError for the caller. Both writes are best-effort:
 * at 0 bytes they fail too, and the stdout line is then the only word (hence the throw).
 */
export function guardedAgentSh(workdir: string, resume: boolean, agent: AgentKind = "claude"): string {
  const note = "run not started: the sandbox disk is full (%s MB free). Grow the disk from the machine menu, then send a message to continue.";
  return (
    `${DISK_PREFLIGHT_SH}; if [ "\${F:-0}" -lt ${RUN_MIN_FREE_KB} ]; then ` +
    `{ printf ${shellQuote(note + "\\n")} "$((\${F:-0}/1024))"; } >> ${AGENT_LOG} 2>/dev/null; ` +
    `echo ${EXIT_DISK_FULL} > ${DONE_MARK} 2>/dev/null; rm -f ${QUESTION_MARK} 2>/dev/null; ` +
    `echo "diskfull \${F:-0} $(df -Pk / 2>/dev/null | awk 'NR==2{print $2}')"; ` +
    `else ${agentSh(workdir, resume, agent)}; fi`
  );
}

/**
 * How much of `.agent.log` a READER pulls back from the box.
 *
 * The formatter budgets (RESULT_MAX_*) decide how much of one tool_result reaches the log; these
 * decide how much of the log reaches us. They have to be sized against each other, and they were
 * not: with the formatter writing up to 400 lines per result, a reader tailing 40–60 lines could
 * not even carry ONE ordinary command's output. Worse than losing text, a short tail DECAPITATES
 * the log — it slices away the `● session started` marker and the `→ Tool: arg` call line, and the
 * indented result block that survives has no call to attach to, so parseTrace renders real tool
 * output as orphaned prose (the "unreadable blob").
 *
 * Two budgets, mirroring the formatter's reasoning:
 *  - LINES bounds an ordinary chatty run. 2000 lines holds a session marker, several full-budget
 *    tool results and the prose between them, which is what a realistic multi-step run looks like.
 *  - BYTES is the real protection and the binding one in the dangerous case: a handful of very long
 *    lines (a minified bundle, a base64 blob) is cheap in lines and megabytes on the wire. This log
 *    is re-read IN FULL on every SSE tick (SSE_TICK_MS) per viewer, so bytes are what bloat the
 *    stream. 128KB is deliberately a compromise: enough for ~2 pathological full-budget results
 *    (64KB each) plus context, small enough that a viewer costs ~160KB/s of SSH read in the worst
 *    case rather than an unbounded amount. Unbounded was never an option for that reason.
 *
 * Bytes are applied first (`tail -c` bounds what is read at all), lines second. Either bound can
 * still cut mid-structure; parseTrace handles a leading orphaned result block explicitly rather
 * than relying on the bound being large enough.
 */
export const LOG_TAIL_LINES = 2000;
export const LOG_TAIL_BYTES = 131072;

/**
 * The `tail` invocation for a log read. `lines = 0` means "no log at all" (driverStateLine only
 * wants the sentinels), and is kept as an explicit no-op read so the command shape stays uniform.
 */
export function logTailCmd(lines: number, path = AGENT_LOG): string {
  if (lines <= 0) return `tail -n 0 ${path} 2>/dev/null || true`;
  return `tail -c ${LOG_TAIL_BYTES} ${path} 2>/dev/null | tail -n ${lines} || true`;
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
async function readProgressRaw(cfg: Config, box: string, logLines = LOG_TAIL_LINES): Promise<ProgressRaw> {
  const r = await exec(
    cfg,
    box,
    `${RUN_STATE_SH}; ` +
      `echo "---Q---"; cat ${QUESTION_MARK} 2>/dev/null || true; ` +
      `echo "---LOG---"; ${logTailCmd(logLines)}`
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
  return { state, text: redactShapes(formatProgress(raw)), question: raw.question ? redactShapes(raw.question) : undefined };
}

/**
 * What a start attempt actually did. Callers that exec straight afterwards can ignore this (their
 * exec surfaces any failure); `/wake.json` has no follow-up command, so it needs to know the
 * difference between "it is up" and "nothing happened" — otherwise it answers `ok` for a box the
 * runtime never started and the client waits forever on a machine no one asked to boot.
 */
export type StartOutcome =
  /** Already running, or `msb start` succeeded. */
  | "running"
  /** `msb ls` does not list this box at all — destroyed, reaped, or a foreign name. */
  | "absent"
  /** Listed and stopped, but every `msb start` attempt failed. */
  | "failed";

/**
 * Ensure a box is running before we exec into it. A box waiting on a question can outlive its
 * `--idle-timeout` and be Stopped by msb while its rootfs (and Claude session) persist — so a
 * `resume` must `msb start` it first, otherwise the exec fails and the answer is lost. Never
 * throws: callers that exec next let that exec do the complaining, and `/wake.json` reads the
 * returned outcome instead.
 */
export async function startBoxIfStopped(cfg: Config, box: string): Promise<StartOutcome> {
  const r = await msb(cfg, ["ls", "--format", "json"], false);
  const entry = parseLsJson(r.stdout).find((e) => e.name === box);
  if (!entry) return "absent";
  if (isRunning(entry.status)) return "running";
  // A box mid-shutdown reports "Draining" for a few seconds; `start` fails until it is Stopped.
  // Retry briefly instead of surfacing "cannot start" for a reply that arrived at the wrong moment.
  for (let attempt = 0; attempt < 5; attempt++) {
    const s = await msb(cfg, ["start", box], false);
    if (s.code === 0) return "running";
    await new Promise((res) => setTimeout(res, 2000));
    const again = parseLsJson((await msb(cfg, ["ls", "--format", "json"], false)).stdout).find((e) => e.name === box);
    if (!again) return "absent";
    if (isRunning(again.status)) return "running";
  }
  return "failed";
}

/** Continue an existing Claude Code session with a follow-up (runbook note: `claude -c -p`). */
export async function resumeAgentTask(
  cfg: Config,
  box: string,
  message: string,
  repos?: RepoLayout[],
  secrets?: Record<string, string>,
  creds?: AgentCreds,
  model?: string
) {
  // A box that idle-timed-out while WAITING on a question is Stopped but intact — start it so the
  // answer reaches the same Claude session instead of failing the exec. A PARKED box (ask-park)
  // wakes the same way; the marker is cleared so the reaper's long park TTL stops applying.
  await startBoxIfStopped(cfg, box);
  void unmarkParked(cfg, box).catch(() => {});
  // Which agent this thread runs on is the BOX's decision (the .agent.kind mark from the first
  // run), never the caller's: every resume lane only has a box id, and a mid-thread agent switch
  // would resume a session that does not exist in the other CLI's store.
  const agent = await boxAgentKind(cfg, box);
  // Ephemeral secrets are appended as extra -e flags on THIS exec only (not stored).
  const env = [...agentEnvFlags(cfg, message, repos, creds?.primaryToken, model, agent), ...secretEnvFlags(secrets)];
  // The formatter AND the hooks are refreshed here too, not only at bootstrap: a box bootstrapped
  // by an older controller keeps that build's formatter/guard for the whole life of the sandbox
  // otherwise, so a deploy that changes the log format or a guard rule would never reach a
  // long-running thread's follow-up turns. All six touch independent files, so one parallel batch.
  const [, , , skills] = await Promise.all([
    applyGitCredentials(cfg, box, creds),
    trustWorkspace(cfg, box),
    installMcpConfig(cfg, box),
    installSkills(cfg, box),
    installMemory(cfg, box, message),
    exec(cfg, box, streamFmtScript()),
    exec(cfg, box, askHookScript()),
    installBrowserTool(cfg, box),
    // A non-claude thread also refreshes ITS formatter and gate (same reasoning: a deploy that
    // changes the log grammar or a guard rule must reach long-running threads) and re-checks the
    // driver install for boxes bootstrapped before this thread's first turn — a no-op when present.
    ...extraDriverSetup(cfg, agent).map((sh) => exec(cfg, box, sh)),
  ]);
  // The cwd is read from the box, not taken from `repos`: every resume path (dashboard follow-up,
  // inbox delivery, send-now, the credential broker, an elicited answer) only has a box id and used
  // to pass undefined here, which resumed a single-repo box in /workspace and lost the session.
  const workdir = repos?.length ? agentWorkdir(repos) : await boxAgentWorkdir(cfg, box);
  const r = await msb(cfg, ["exec", box, ...env, ...skillHintFlags(box, message, skills, false), "--", "sh", "-lc", guardedAgentSh(workdir, true, agent)]);
  const full = diskFullFromLaunch(r.stdout);
  if (full) throw new DiskFullError(box, full.freeKb, full.totalKb);
  return r;
}

/**
 * Interrupt the agent run in a box so a message can be delivered NOW instead of waiting for the
 * turn to finish (e.g. the agent is polling a CI check that will never complete). We kill the
 * CHILDREN of the run wrapper (claude + the log formatter), not the wrapper itself: the wrapper
 * then records the exit in DONE_MARK and clears RUN_MARK/PID_MARK exactly as on a normal finish,
 * so every status reader sees a clean `done` and the follow-up `claude -c` resumes the same
 * session. A note is stamped into the log first so the transcript says why the turn ended.
 * Escalates TERM → KILL, and as a last resort heals the sentinels in place (exit 253) so the box
 * can never be left wedged in `running`. Returns false when nothing was running.
 */
/**
 * Mirror a queued message into a RUNNING box so its PreToolUse gate delivers it at the next tool
 * call (src/drivers/inbox-gate.ts). Best-effort: a failure leaves the SQLite inbox as the only copy
 * and the message delivers at turn end as before.
 */
export async function mirrorInboxMessage(cfg: Config, box: string, m: InboxLine): Promise<void> {
  await exec(cfg, box, INBOX_APPEND_SH, { input: inboxLine(m) });
}

/** Ids the box's gate has already delivered mid-turn (and clears the receipt), so the controller
 *  never re-sends them at turn end. Empty on a sleeping or broken box. */
export async function takeDeliveredInbox(cfg: Config, box: string): Promise<string[]> {
  try {
    const out = await msb(cfg, ["exec", box, "--", "sh", "-lc", INBOX_TAKE_DELIVERED_SH], true, PROBE_TIMEOUT_MS);
    return out.stdout.split("\n").map((s) => s.trim()).filter((s) => /^q\d+$/.test(s));
  } catch {
    return [];
  }
}

export async function interruptAgentRun(cfg: Config, box: string, why = "to deliver a message immediately"): Promise<boolean> {
  const reason = why.replace(/[^\w .,-]/g, "");
  const sh =
    `p=$(cat ${PID_MARK} 2>/dev/null); ` +
    `if [ -z "$p" ] || [ ! -d "/proc/$p" ]; then echo no-run; exit 0; fi; ` +
    `echo "run interrupted by the operator ${reason}." >> ${AGENT_LOG}; ` +
    `pkill -TERM -P "$p" 2>/dev/null; ` +
    `for i in 1 2 3 4 5 6 7 8 9 10; do [ ! -f ${RUN_MARK} ] && { echo interrupted; exit 0; }; sleep 1; done; ` +
    `pkill -KILL -P "$p" 2>/dev/null; ` +
    `for i in 1 2 3 4 5; do [ ! -f ${RUN_MARK} ] && { echo interrupted; exit 0; }; sleep 1; done; ` +
    `kill -KILL "$p" 2>/dev/null; echo 253 > ${DONE_MARK}; rm -f ${RUN_MARK} ${PID_MARK} ${START_MARK} ${BOOT_MARK}; echo forced`;
  const r = await msb(cfg, ["exec", box, "--", "bash", "-lc", sh], false);
  return !/(^|\n)no-run/.test(r.stdout);
}

/** Raw `msb status` for a box (non-fatal if the box is gone). */
export async function status(cfg: Config, box: string) {
  const r = await msb(cfg, ["status", box], false);
  return r.stdout || r.stderr;
}

/** Raw `msb metrics` for a box (CPU/MEM/uptime); non-fatal. */
export async function metrics(cfg: Config, box: string) {
  const r = await msb(cfg, ["metrics", box], false, PROBE_TIMEOUT_MS);
  return r.stdout || r.stderr;
}

/**
 * Fleet snapshot for the `monitor` tool: every box with role, agent run-state, task, and metrics.
 * One `msb ls --format json`, then per box a single combined sentinel read + one metrics call. All
 * per-box reads are best-effort (a box can vanish mid-scan) — failures degrade that box's row, not
 * the whole report. Shaping/formatting is delegated to the pure monitor module.
 */
/**
 * `msb ls` status of every box as of the last fleet sweep. `msb exec` on a STOPPED box boots it for
 * the duration of the command and stops it again (measured: "ran 2.5s") — so probing a sleeping box
 * wakes it, flips its status for a few seconds, and burns a boot. Every reader that would exec
 * (fleet sweep, watch hub) consults this first and leaves sleeping boxes alone.
 */
const lastLsStatus = new Map<string, { status: string; at: number }>();
/** After `msb start`, stop treating the box as asleep so the watch hub execs again immediately. */
export function noteRunning(box: string): void {
  lastLsStatus.set(box, { status: "Running", at: Date.now() });
}
/** After `msb stop`, treat the box as asleep at once so no reader execs into it and re-boots it. */
export function noteStopped(box: string): void {
  lastLsStatus.set(box, { status: "Stopped", at: Date.now() });
}
export function knownStopped(box: string, maxAgeMs = 15_000): boolean {
  const e = lastLsStatus.get(box);
  return !!e && !isRunning(e.status) && Date.now() - e.at < maxAgeMs;
}

export async function gatherMonitor(cfg: Config): Promise<BoxView[]> {
  const ls = await msb(cfg, ["ls", "--format", "json"], false, PROBE_TIMEOUT_MS);
  // A failed `msb ls` (SSH refused, host restarting) must be an ERROR, not an empty fleet: an empty
  // sweep result deletes every entry from fleet run-memory AND the durable store, permanently losing
  // sleeping boxes' task/question metadata — and momentarily zeroes the capacity count.
  if (ls.code !== 0) throw new Error(`msb ls failed (exit ${ls.code}): ${ls.stderr.slice(0, 200)}`);
  const entries = parseLsJson(ls.stdout).filter((e) => !isStoreBox(e.name));
  const now = Date.now();
  for (const e of entries) lastLsStatus.set(e.name, { status: e.status, at: now });
  for (const name of [...lastLsStatus.keys()]) if (!entries.some((e) => e.name === name)) lastLsStatus.delete(name);

  const views = await Promise.all(
    entries.map(async (e): Promise<BoxView> => {
      // A stopped box is asleep: do not exec (that would boot it). Report it stopped; the fleet layer
      // merges its last-known task/question from memory.
      if (!isRunning(e.status)) {
        return { name: e.name, role: classifyBox(e.name, false), boxStatus: "Stopped", runState: "idle" };
      }
      let claimed = false;
      let runState: RunState = "idle";
      let exitCode: number | undefined;
      let task: string | undefined;
      let question: string | undefined;
      let uptime: string | undefined;
      let cpu: string | undefined;
      let mem: string | undefined;
      let lastOutputAt: number | undefined;
      let repos: RepoRef[] | undefined;
      let disk: { usedMib: number; totalMib: number } | undefined;
      let agent: AgentKind | undefined;

      // The sentinel read and the metrics read are independent, so they go out together. They used
      // to be sequential, which doubled this endpoint's latency per box: with four boxes the whole
      // response took ~3.8s, slower than the dashboard's own poll interval.
      const [sentinels, metricsText] = await Promise.allSettled([
        exec(
          cfg,
          e.name,
          `test -f /.claimed && echo CLAIMED || echo FREE; ` +
            `${RUN_STATE_SH}; ` +
            `echo "---Q---"; cat ${QUESTION_MARK} 2>/dev/null || true; ` +
            `echo "---T---"; cat ${TASK_MARK} 2>/dev/null || true; ` +
            // Repositories checked out in the box (dir name + current branch), so the dashboard can
            // show what a sandbox is connected to and scope file search to it.
            `echo "---R---"; for g in /workspace/*/.git; do [ -d "$g" ] || continue; d=$(dirname "$g"); ` +
            `printf '%s %s\n' "$(basename "$d")" "$(git -C "$d" rev-parse --abbrev-ref HEAD 2>/dev/null)"; done 2>/dev/null; ` +
            // mtime of the agent log = the last moment the agent produced output. The dashboard uses
            // it to say "no output for 4m" next to the idle-stop deadline. Best-effort (no log → blank).
            `echo "---M---"; stat -c %Y ${AGENT_LOG} 2>/dev/null || true; ` +
            // Root-disk usage. `msb metrics`' DISK column is an I/O RATE, not occupancy, so the only
            // honest source for "how full is this box" is df inside it — and it rides along on a probe
            // we were already making. `-k` for a stable unit (blocks of 1 KiB) rather than df's
            // human-readable rounding, which the client would have to re-parse.
            `echo "---D---"; df -k / 2>/dev/null | awk 'NR==2 {print $2, $3}' || true; ` +
            // Which agent the thread runs on, for the dashboard's thread header chip.
            `echo "---K---"; cat ${KIND_MARK} 2>/dev/null || true`,
          // Bounded: this is the exact call that wedged forever on a box caught mid-shutdown and
          // took the whole fleet read with it. A rejection here is already handled below (execOk).
          { timeoutMs: PROBE_TIMEOUT_MS }
        ),
        metrics(cfg, e.name),
      ]);

      // If we cannot exec into a box, it is not usable, whatever `msb ls` still claims. A box being
      // reaped at --max-duration flaps: ls reports Running, metrics reports exited, and the exec
      // fails intermittently. Reporting that honestly (as not-running) stops the dashboard blinking
      // a card in and out once a second.
      const execOk = sentinels.status === "fulfilled";

      if (sentinels.status === "fulfilled") {
        const out = sentinels.value.stdout;
        const qStart = out.indexOf("---Q---");
        const tStart = out.indexOf("---T---");
        const mStartRaw = out.indexOf("---M---");
        const mStart = mStartRaw >= 0 ? mStartRaw : out.length;
        const rStartRaw = out.indexOf("---R---");
        const rStart = rStartRaw >= 0 ? rStartRaw : mStart;
        const head = out.slice(0, qStart);
        claimed = /(^|\n)CLAIMED\s*(\n|$)/.test(head);
        const runLine = head.split("\n").map((l) => l.trim()).find((l) => l.startsWith("run:")) ?? "run:idle";
        const rs = parseRunState(runLine);
        // A pending question means WAITING even if the run "finished" (mirrors agentProgress).
        question = out.slice(qStart + "---Q---".length, tStart).trim() || undefined;
        runState = question ? "waiting" : rs.state;
        exitCode = rs.exitCode;
        task = out.slice(tStart + "---T---".length, rStart).trim() || undefined;
        if (rStartRaw >= 0) {
          const list = out
            .slice(rStart + "---R---".length, mStart)
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
            .map((l) => {
              const [name, branch] = l.split(/\s+/);
              return { name, branch: branch && branch !== "HEAD" ? branch : undefined };
            });
          repos = list.length ? list : undefined;
        }
        const dStartRaw = out.indexOf("---D---");
        const dStart = dStartRaw >= 0 ? dStartRaw : out.length;
        const mtime = Number(out.slice(mStart + "---M---".length, dStart).trim());
        lastOutputAt = Number.isFinite(mtime) && mtime > 0 ? mtime : undefined;
        const kStartRaw = out.indexOf("---K---");
        if (kStartRaw >= 0) agent = boxAgentKindFrom(out.slice(kStartRaw + "---K---".length));
        if (dStartRaw >= 0) {
          // "<total-1k-blocks> <used-1k-blocks>" from df -k, or blank on an older box / failed df.
          const [totalK, usedK] = out
            .slice(dStart + "---D---".length, kStartRaw >= 0 ? kStartRaw : out.length)
            .trim()
            .split(/\s+/)
            .map(Number);
          if (Number.isFinite(totalK) && Number.isFinite(usedK) && totalK > 0) {
            disk = { usedMib: Math.round(usedK / 1024), totalMib: Math.round(totalK / 1024) };
          }
        }
      }

      // msb's metrics STATE is more current than the ls status (ls can briefly lag a just-stopped
      // box), so prefer it for the lifecycle when present. Best-effort.
      let boxStatus = e.status;
      if (metricsText.status === "fulfilled") {
        const m = parseMetrics(metricsText.value);
        uptime = m.uptime;
        cpu = m.cpu;
        mem = m.mem;
        if (m.state) boxStatus = m.state === "exited" ? "Stopped" : m.state;
      }
      // Not execable => not usable. This is the deciding vote, so the answer cannot flip between
      // two disagreeing sources on consecutive polls.
      if (!execOk) boxStatus = "Stopped";

      const nowMs = Date.now();
      const stalled = execOk && isStalled(runState, lastOutputAt, nowMs);

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
        memUsage: parseMemUsage(mem),
        disk,
        lastOutputAt,
        repos,
        agent,
        ...(stalled ? { stalled } : {}),
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
  opts: { newThread?: boolean; repos?: RepoLayout[]; ghToken?: string } = {}
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
    // Same GH default the driver gets, so the co-pilot's read-only `gh` calls (pr checks, run
    // status…) work instead of failing with "gh auth login required". Mutating gh is still denied
    // by the ask gate (MUTATING_BASH_RE), so this widens what it can SEE, not what it can do.
    ...(opts.ghToken ? ["-e", `GH_TOKEN=${opts.ghToken}`, "-e", `GITHUB_TOKEN=${opts.ghToken}`] : []),
  ];

  // Continue the ask thread only when it belongs to the driver's CURRENT task (see askThreadProbe).
  const contProbe = askThreadProbe(TASK_MARK, !!opts.newThread);

  const inner =
    `mkdir -p ${ASK_DIR} && cd ${ASK_DIR} && ${contProbe}; ` +
    // Report the decision the BOX made, so the caller never claims continuity the box didn't give.
    `echo "---ASKCONT---$([ -n "$CONT" ] && echo 1 || echo 0)"; ` +
    `printf '\\n=== ask %s ===\\n%s\\n' "$(date -u +%FT%TZ)" "$ASK_QUESTION" >> ${ASK_LOG}; ` +
    // --setting-sources user loads the hooks (both gates) and nothing from any cloned repo.
    `timeout ${timeoutSec}s claude $CONT -p "$ASK_QUESTION" --setting-sources user ` +
    `--append-system-prompt "$ASK_SYS_PROMPT" --allowedTools ${ASK_ALLOWED_TOOLS} ` +
    `2>>${ASK_LOG} | tee -a ${ASK_LOG}; ` +
    // 124 is timeout(1)'s "killed at the cap"; surface it so the caller can say the answer is partial.
    // Stamp the thread with the task it belongs to, so the next turn can tell continuity from a
    // box that has since been recycled into a different delegation.
    `code=$?; printf '%s' "$ASK_FP" > ${ASK_THREAD_MARK}; echo "---ASKEXIT---$code"`;

  const r = await msb(cfg, ["exec", box, ...env, "--", "bash", "-lc", inner], false);
  return parseAskOutput(box, r.stdout, r.code);
}

/**
 * Split one ask turn's stdout into its parts. Pure so the marker handling is unit-tested: the
 * continuity flag comes from the BOX's own decision (the fingerprint probe), never from the
 * caller's `newThread` — otherwise the header claims "same thread" for a turn that actually
 * started fresh because the box had been recycled into a different delegation.
 */
export function parseAskOutput(box: string, stdout: string, exitCode: number): AskResult {
  const contMark = "---ASKCONT---";
  const exitMark = "---ASKEXIT---";
  const cont = stdout.indexOf(contMark);
  const continued = cont >= 0 && stdout.slice(cont + contMark.length).trimStart().startsWith("1");

  const bodyStart = cont >= 0 ? stdout.indexOf("\n", cont) + 1 : 0;
  const end = stdout.lastIndexOf(exitMark);
  const answer = (end >= 0 ? stdout.slice(bodyStart, end) : stdout.slice(bodyStart)).trim();
  const code = end >= 0 ? Number(stdout.slice(end + exitMark.length).trim()) : exitCode;

  return { session: box, answer, timedOut: code === 124, continued };
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
  // Same bound as readProgressRaw: the SSE stream reads through here while the MCP `progress` path
  // reads through there, and two paths disagreeing about how much log they show is its own bug —
  // the dashboard would render a differently-truncated (differently-parseable) trace than the tool.
  // An explicit `--lines N` from a caller still overrides, and is still byte-capped.
  logLines = LOG_TAIL_LINES,
  // The SSE tail loop reads this every 800ms; vitals come from the fleet poll anyway, so it skips
  // the second SSH round trip (`msb metrics`) and halves the per-tick cost and first-frame latency.
  opts: { metrics?: boolean } = {}
): Promise<WatchSnapshot> {
  const base: WatchSnapshot = { name: box, boxStatus: "missing", runState: "idle", log: "" };
  // Asleep per the last fleet sweep: report it without exec'ing (which would boot it).
  if (knownStopped(box)) return { ...base, boxStatus: "stopped" };
  try {
    const r = await exec(
      cfg,
      box,
      `${RUN_STATE_SH}; ` +
        `echo "---Q---"; cat ${QUESTION_MARK} 2>/dev/null || true; ` +
        `echo "---T---"; cat ${TASK_MARK} 2>/dev/null || true; ` +
        `echo "---A---"; cat ${KIND_MARK} 2>/dev/null || true; ` +
        `echo "---N---"; cat ${MCP_NOTES_PATH} 2>/dev/null || true; ` +
        `echo "---SZ---"; stat -c %s ${AGENT_LOG} 2>/dev/null || wc -c < ${AGENT_LOG} 2>/dev/null || echo 0; ` +
        `echo "---LOG---"; ${logTailCmd(logLines)}`,
      // Same bound as gatherMonitor's probe: an exec into a box caught mid-shutdown can park in
      // poll() indefinitely, and this read sits behind every WatchHub tick — unbounded, one wedged
      // box stalls all of its SSE viewers for the full 5-minute default.
      { timeoutMs: PROBE_TIMEOUT_MS }
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
    // ---A--- (agent kind) is absent on boxes probed by an older controller — tolerate both shapes.
    const aStartRaw = out.indexOf("---A---");
    const nStartRaw = out.indexOf("---N---");
    const szStart = out.indexOf("---SZ---");
    const metaEnd = szStart >= 0 && szStart < logStart ? szStart : logStart;
    const tEnd = aStartRaw >= 0 ? aStartRaw : nStartRaw >= 0 ? nStartRaw : metaEnd;
    base.task = out.slice(tStart + "---T---".length, tEnd).trim() || undefined;
    if (aStartRaw >= 0) base.agent = boxAgentKindFrom(out.slice(aStartRaw + "---A---".length, nStartRaw >= 0 ? nStartRaw : metaEnd));
    // ---N---: what the MCP install left out of this box (mcp-skip/fail/drop lines), for the thread.
    if (nStartRaw >= 0) {
      const notes = mcpInstallNotes(out.slice(nStartRaw + "---N---".length, metaEnd));
      if (notes.length) base.mcpNotes = notes;
    }
    base.log = out.slice(logStart + "---LOG---".length).trim();
    // The tail is a window: say when the file holds more than it, so the hub can stitch the whole
    // conversation together (WatchHub.readFull) instead of losing its start once the log is long.
    if (szStart >= 0 && szStart < logStart) {
      const size = Number(out.slice(szStart + "---SZ---".length, logStart).trim());
      if (Number.isFinite(size) && size - Buffer.byteLength(base.log) > 64) base.logTruncated = true;
    }
    base.boxStatus = "running"; // execable => running
  } catch {
    return base; // stays "missing"
  }

  if (opts.metrics === false) return base;
  try {
    const m = parseMetrics(await metrics(cfg, box));
    base.uptime = m.uptime;
    base.cpu = m.cpu;
    base.mem = m.mem;
    base.memUsage = parseMemUsage(m.mem);
    if (m.state && m.state !== "running") base.boxStatus = m.state === "exited" ? "stopped" : m.state;
  } catch {
    // metrics is best-effort
  }
  return base;
}

/** Upper bound on a whole-log read for the live thread (the start of a very long run is kept). */
export const LOG_FULL_BYTES = 8 * 1024 * 1024;

/**
 * The whole `.agent.log` (up to LOG_FULL_BYTES, from the end), for the thread's first frame when the
 * tail window no longer reaches the start. Read once per box by WatchHub; later ticks are stitched.
 */
export async function readAgentLogFull(cfg: Config, box: string): Promise<string> {
  const r = await exec(cfg, box, `tail -c ${LOG_FULL_BYTES} ${AGENT_LOG} 2>/dev/null || true`, { timeoutMs: PROBE_TIMEOUT_MS * 3 });
  return r.stdout.trim();
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
    "--max-memory",
    cfg.memory,
    // The snapshot baked from this box is what warm-pool boxes boot from; its rootfs must match
    // the default tier or every snapshot-booted box inherits a bigger disk than configured.
    "--root-disk",
    cfg.rootDisk,
    "--net",
    "public",
    ...hostGuardFlags(),
    "--pull",
    "if-missing",
    cfg.image,
    "--",
    "sleep",
    "infinity",
  ]);
}

/** Allowed per-box memory tiers. A reboot is required — this runtime has no live resize. */
export const MEMORY_TIERS = ["1G", "2G", "4G"] as const;
export type MemoryTier = (typeof MEMORY_TIERS)[number];

export function isMemoryTier(v: unknown): v is MemoryTier {
  return typeof v === "string" && (MEMORY_TIERS as readonly string[]).includes(v);
}

/**
 * Resize a box's memory and reboot it so the change takes effect. Both --memory and --max-memory are
 * set: the latter is the boot-time hotplug ceiling, and raising the former alone is clamped to it.
 * The reboot destroys any in-flight run (it trips the stale-marker heal in RUN_STATE_SH), so callers
 * must gate on runState.
 */
export async function setBoxMemory(cfg: Config, box: string, tier: MemoryTier): Promise<void> {
  await msb(cfg, ["modify", box, "--memory", tier, "--max-memory", tier, "--restart"]);
}

/**
 * Root disk tiers. GROW-ONLY: `msb modify --root-disk` on a managed disk cannot shrink, so the UI
 * must offer only tiers at or above the current size — a "shrink" would fail at the runtime with a
 * confusing error. Boxes are created at cfg.rootDisk (default 1G).
 */
export const DISK_TIERS = ["1G", "2G", "4G", "8G", "16G", "32G"] as const;
export type DiskTier = (typeof DISK_TIERS)[number];

export function isDiskTier(v: unknown): v is DiskTier {
  return typeof v === "string" && (DISK_TIERS as readonly string[]).includes(v);
}

/** Grow the root disk and reboot so it takes effect. Same run-state gating as setBoxMemory. */
export async function setBoxDisk(cfg: Config, box: string, tier: DiskTier): Promise<void> {
  await msb(cfg, ["modify", box, "--root-disk", tier, "--restart"]);
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
/** The raw msb runner for modules that compose their own verbs (snapshot.ts). Never throws. */
export function msbIo(cfg: Config) {
  return {
    msb: (args: string[]) => msb(cfg, args, false),
    log: (m: string) => console.error(m),
    noteStopped,
    noteRunning,
  };
}

/** `df` of the filesystem under the microsandbox home on the VPS — the disk every box boot needs. */
export async function hostDisk(cfg: Config): Promise<DiskReading | undefined> {
  const r = await ssh(cfg, `df -Pk ${shellQuote(cfg.msbHome)}`, false);
  return r.code === 0 ? parseDfPk(r.stdout) : undefined;
}

/**
 * Remove sandbox directories the runtime no longer lists (src/host-disk.ts orphanSandboxDirs).
 * Observed on the host: 15 dirs from one August afternoon, 6.8G, from boots that failed or were
 * removed mid-way — msb forgot them, the disk did not. The listing must SUCCEED and parse before
 * anything is judged an orphan: an empty listing from a failed `msb ls` would make every dir one.
 */
export async function sweepOrphanSandboxDirs(cfg: Config, opts: { dryRun?: boolean } = {}): Promise<{ removed: string[]; freedMib?: number }> {
  const ls = await msb(cfg, ["ls", "--format", "json"], false, PROBE_TIMEOUT_MS);
  if (ls.code !== 0 || !ls.stdout.trim().startsWith("[")) throw new Error(`msb ls failed (exit ${ls.code}); not sweeping`);
  const listed = parseLsJson(ls.stdout).map((e) => e.name);
  const dir = `${cfg.msbHome}/sandboxes`;
  const found = await ssh(cfg, `find ${shellQuote(dir)} -mindepth 1 -maxdepth 1 -type d -printf '%f %T@\\n' 2>/dev/null`, false);
  const orphans = orphanSandboxDirs(parseDirListing(found.stdout), listed, Date.now() / 1000);
  if (!orphans.length || opts.dryRun) return { removed: orphans };
  const paths = orphans.map((n) => shellQuote(`${dir}/${n}`)).join(" ");
  const r = await ssh(cfg, `du -skc ${paths} 2>/dev/null | tail -1 | awk '{print $1}'; rm -rf ${paths}`, false);
  const kb = Number(r.stdout.trim().split("\n")[0]);
  return { removed: orphans, ...(Number.isFinite(kb) && kb > 0 ? { freedMib: Math.round(kb / 1024) } : {}) };
}

/**
 * Dig the holes out of a snapshot's upper on the host. The guest cannot fstrim, so every byte a
 * bake installed and deleted again (npm's tarballs, the pruned GPU providers) stays allocated in
 * upper.ext4 — 2.1G allocated for 543M of content, measured — and a snapshot boot copies all of
 * it into every box. bake-snapshot zero-fills the free space in the guest first, so the freed
 * blocks are zeros; `fallocate -d` then turns the zero runs into holes (2.1G → 931M).
 */
export async function compactSnapshotUpper(cfg: Config, name: string): Promise<string> {
  const f = `${cfg.msbHome}/snapshots/${name}/upper.ext4`;
  const r = await ssh(
    cfg,
    `F=${shellQuote(f)}; if [ ! -f "$F" ]; then echo "no upper at $F"; exit 0; fi; ` +
      `B=$(du -sh "$F" | cut -f1); fallocate -d "$F" 2>/dev/null || echo "fallocate -d failed"; echo "$B -> $(du -sh "$F" | cut -f1)"`,
    false
  );
  return r.stdout.trim();
}

/** Fill the guest's free space with zeros and release it, so the host can punch holes (above). */
export const ZERO_FILL_SH = "dd if=/dev/zero of=/.zero bs=4M 2>/dev/null; sync; rm -f /.zero; sync; true";

export async function teardown(cfg: Config, box: string, stagingDir?: string): Promise<void> {
  assertBoxName(box);
  await msb(cfg, ["stop", box], false);
  await msb(cfg, ["rm", "--force", box], false);
  // The box's rewind snapshot (if any) dies with it — snapshots are per-box, never shared.
  await msb(cfg, ["snapshot", "rm", askSnapName(box)], false);
  await unmarkClaimed(cfg, box);
  await unmarkKept(cfg, box);
  await unmarkParked(cfg, box).catch(() => {});
  if (stagingDir) {
    await ssh(cfg, `rm -rf ${shellQuote(stagingDir)}`, false);
  }
}
