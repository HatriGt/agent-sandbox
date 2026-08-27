/**
 * Runtime configuration for the orchestrator, loaded from environment.
 *
 * The MCP server runs on the VPS. Client-side values (VPS_SSH) are used by the sync step
 * to push the local working tree up; host-side values (MSB, image, timeouts) drive msb;
 * ccproxy + creds are injected into the box only at agent-run time.
 */

export interface Config {
  /** SSH target the client uses to reach the VPS for rsync (user@host or ssh alias). */
  vpsSsh: string;
  /** Base dir on the VPS where each delegation's working tree is staged before --copy-dir. */
  vpsStagingDir: string;
  /** IDE-provided open workspace path (local delegate falls back to this when no repo is given).
   * Wire in mcp.json: env WORKSPACE_DIR=${workspaceFolder}. Ignored if not a real absolute path. */
  workspaceDir?: string;
  /** How long (ssh ControlPersist syntax) to keep the multiplexed master connection alive. */
  sshPersist: string;
  /** Extra ssh args (e.g. -i <key>, -o StrictHostKeyChecking=...) for containerized deploy. */
  sshExtraOpts?: string[];

  /** Path to the msb binary on the VPS. */
  msb: string;
  /** Base OCI image for boxes (cached on host). */
  image: string;
  /** Snapshot name to warm-start from (Claude Code + gh pre-baked). Empty = boot from image. */
  snapshot: string;
  /** Auto-stop after this idle period. */
  idleTimeout: string;
  /**
   * Idle timeout for UNCLAIMED warm-pool boxes. A warm box must persist until a delegation claims
   * it, so this is much longer than a session's idleTimeout — otherwise an unclaimed box idle-stops
   * (default 15m) and the pool silently drains to empty with no delegation to trigger a reseed.
   */
  poolIdleTimeout: string;
  /**
   * How often the background pool maintainer reaps dead/idle-stopped boxes and refills to poolSize.
   * This is what keeps a warm box always ready even when no delegation happens for a long time (a
   * claim-only reseed can't cover an idle-drained or max-duration-reaped pool). 0 disables it.
   */
  poolRefillIntervalMs: number;
  /** Hard cap on box lifetime. */
  maxDuration: string;
  /**
   * How long a CLAIMED box may stay asleep (idle-stopped) before it is finally destroyed. A sleeping
   * run keeps its workspace and can be woken by a reply; this bounds how long that offer stands.
   */
  sleepTtl: string;
  /** Per-box memory cap (e.g. 512M, 1G). */
  memory: string;
  /** Max concurrent live boxes; new delegations are refused past this. */
  maxBoxes: number;
  /** Number of pre-booted warm boxes to keep idle (0 disables pooling). */
  poolSize: number;

  /**
   * Interactive A2A: how long `delegate`/`resume` block server-side waiting for the in-box agent to
   * reach a boundary (a question => waiting, or done) before returning "still working, reconnect via
   * status". Kept under the MCP client's HTTP timeout so the call never hangs the IDE.
   */
  waitTimeoutMs: number;
  /** Poll interval for that wait loop (one SSH sentinel read per tick). */
  waitIntervalMs: number;

  /**
   * ASK lane: hard cap on one co-pilot turn. The call is synchronous (the operator is waiting), so
   * this must stay under the MCP client's request timeout — same reasoning as waitTimeoutMs.
   */
  askTimeoutMs: number;
  /**
   * ASK lane: optional model override. The co-pilot is a read-mostly glance, so a cheaper/faster
   * alias than the driver's is usually right. Empty = whatever the box's Claude Code defaults to.
   */
  askModel?: string;

  /** ccproxy endpoint for in-box model calls. */
  anthropicBaseUrl: string;
  /** Placeholder key accepted by ccproxy's Anthropic route. */
  anthropicApiKey: string;
  /** Model alias to use (a current, non-retired one from ccproxy /v1/models). */
  anthropicModel: string;

  /** Domains the box is allowed to reach (egress allowlist). ccproxy is always added. */
  egressDomains: string[];
  /** When true, allow the box to reach ANY domain (open egress) instead of the allowlist. */
  egressAllowAll: boolean;

  /**
   * Per-clone GitHub token, set explicitly by runDelegation from the access-resolved account for
   * each repo. There is intentionally NO default/global token from the environment: access is
   * resolved per repo from the login-keyed store (see gh-token-store.ts).
   */
  ghToken?: string;
  /** npm credential injected into the box (optional). */
  npmToken?: string;

  /**
   * GitHub OAuth App client id for "Sign in with GitHub" (device flow) on the dashboard's Accounts
   * page. Optional: without it, accounts are added by pasting a personal access token.
   */
  githubOauthClientId?: string;

  /** HTTP entry (http.ts): port to bind. */
  httpPort: number;
  /** HTTP entry: bind host. Default 127.0.0.1 (local). In a container set 0.0.0.0 so Traefik
   * on the compose network can reach it; never publish the port to the public internet. */
  httpHost: string;
  /** HTTP entry: bearer token required on /mcp. Empty => HTTP entry refuses all (fail closed). */
  httpToken?: string;
}

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

/** Parse a truthy env flag (1/true/yes/on, case-insensitive). */
function parseBool(raw: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test((raw ?? "").trim());
}

/** Parse a comma/space-separated domain list into a trimmed array. */
function parseDomains(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((d) => d.trim())
    .filter(Boolean);
}

/** Default egress allowlist: npm + GitHub (git push + gh API). ccproxy is added from its URL. */
const DEFAULT_EGRESS = [
  "registry.npmjs.org",
  "*.npmjs.org",
  "github.com",
  "*.github.com",
  "api.github.com",
  "codeload.github.com",
  "objects.githubusercontent.com",
];

export function loadConfig(): Config {
  const anthropicBaseUrl = req("ANTHROPIC_BASE_URL", "https://your-ccproxy.example.com");

  // Always allow the ccproxy host itself so the in-box agent can reach the model.
  const ccproxyHost = new URL(anthropicBaseUrl).hostname;
  const egressDomains = Array.from(
    new Set([ccproxyHost, ...DEFAULT_EGRESS, ...parseDomains(process.env.EGRESS_DOMAINS)])
  );

  return {
    vpsSsh: req("VPS_SSH"),
    vpsStagingDir: req("VPS_STAGING_DIR", "/root/agent-sandbox-staging"),
    // Only accept an absolute path; ignore an unexpanded "${workspaceFolder}" literal.
    workspaceDir:
      process.env.WORKSPACE_DIR && process.env.WORKSPACE_DIR.startsWith("/")
        ? process.env.WORKSPACE_DIR
        : undefined,
    sshPersist: req("SSH_PERSIST", "120"),
    sshExtraOpts: process.env.SSH_EXTRA_OPTS
      ? process.env.SSH_EXTRA_OPTS.split(/\s+/).filter(Boolean)
      : undefined,

    msb: req("MSB", "/root/.local/bin/msb"),
    image: req("MSB_IMAGE", "node"),
    snapshot: process.env.MSB_SNAPSHOT || "",
    idleTimeout: req("MSB_IDLE_TIMEOUT", "15m"),
    // Warm boxes should outlive a long lull with no delegations; the maintainer replaces any that the
    // hard max-duration cap reaps. Default well above idleTimeout so the pool doesn't self-drain.
    poolIdleTimeout: req("MSB_POOL_IDLE_TIMEOUT", "6h"),
    // Default = the run cap: a non-kept sandbox is gone within an hour of its last activity. Pin it
    // (Keep) to hold it; raise this to give every run a longer grace period.
    sleepTtl: req("MSB_SLEEP_TTL", "1h"),
    poolRefillIntervalMs: Number(process.env.MSB_POOL_REFILL_MS ?? "60000"),
    maxDuration: req("MSB_MAX_DURATION", "1h"),
    memory: req("MSB_MEMORY", "1G"),
    maxBoxes: Number(process.env.MSB_MAX_BOXES ?? "5"),
    poolSize: Number(process.env.MSB_POOL_SIZE ?? "1"),

    // Block-until-boundary window. A tools/call must RETURN before the MCP client's own request
    // timeout, or the client throws "-32001 Request timed out" and the calling agent reverts to
    // fire-and-forget. Cursor's client timeout is ~60s, so we cap the server-side block at 50s: if the
    // box reaches a boundary (asks a question / finishes) we return instantly with it; otherwise we
    // return a "still working — reconnect with status" message at 50s, safely under the client cap, and
    // status resumes the same wait. (A question/done mid-window still short-circuits immediately.)
    // Poll every 3s so a boundary is surfaced within ~3s of happening.
    waitTimeoutMs: Number(process.env.WAIT_TIMEOUT_MS ?? "50000"),
    waitIntervalMs: Number(process.env.WAIT_INTERVAL_MS ?? "3000"),

    // 45s: one co-pilot turn is a few reads plus a short answer, and this leaves headroom under a
    // ~60s client timeout for the SSH round-trip either side of it.
    askTimeoutMs: Number(process.env.ASK_TIMEOUT_MS ?? "45000"),
    askModel: process.env.ASK_MODEL || undefined,
    githubOauthClientId: process.env.GITHUB_OAUTH_CLIENT_ID?.trim() || undefined,

    anthropicBaseUrl,
    anthropicApiKey: req("ANTHROPIC_API_KEY", "dummy"),
    anthropicModel: req("ANTHROPIC_MODEL", "ak-claude-opus-5"),

    egressDomains,
    egressAllowAll: parseBool(process.env.EGRESS_ALLOW_ALL),

    // No default GH token from the env: per-repo access is resolved from the login-keyed store.
    ghToken: undefined,
    npmToken: process.env.NPM_TOKEN || undefined,

    httpPort: Number(process.env.MCP_HTTP_PORT ?? "8787"),
    httpHost: process.env.MCP_HTTP_HOST || "127.0.0.1",
    httpToken: process.env.MCP_HTTP_TOKEN || undefined,
  };
}
