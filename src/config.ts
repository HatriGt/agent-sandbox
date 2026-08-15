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

  /** Path to the msb binary on the VPS. */
  msb: string;
  /** Base OCI image for boxes (cached on host). */
  image: string;
  /** Snapshot name to warm-start from (Claude Code + gh pre-baked). Empty = boot from image. */
  snapshot: string;
  /** Auto-stop after this idle period. */
  idleTimeout: string;
  /** Hard cap on box lifetime. */
  maxDuration: string;
  /** Per-box memory cap (e.g. 512M, 1G). */
  memory: string;
  /** Max concurrent live boxes; new delegations are refused past this. */
  maxBoxes: number;

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

  /** GitHub token for git push + `gh` (PR creation) inside the box. */
  ghToken?: string;
  /** git identity used for in-box commits. */
  gitAuthorName?: string;
  gitAuthorEmail?: string;
  /** npm credential injected into the box (optional). */
  npmToken?: string;
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

    msb: req("MSB", "/root/.local/bin/msb"),
    image: req("MSB_IMAGE", "node"),
    snapshot: process.env.MSB_SNAPSHOT || "",
    idleTimeout: req("MSB_IDLE_TIMEOUT", "15m"),
    maxDuration: req("MSB_MAX_DURATION", "1h"),
    memory: req("MSB_MEMORY", "1G"),
    maxBoxes: Number(process.env.MSB_MAX_BOXES ?? "5"),

    anthropicBaseUrl,
    anthropicApiKey: req("ANTHROPIC_API_KEY", "dummy"),
    anthropicModel: req("ANTHROPIC_MODEL", "ak-claude-opus-5"),

    egressDomains,
    egressAllowAll: parseBool(process.env.EGRESS_ALLOW_ALL),

    ghToken: process.env.GH_TOKEN || undefined,
    gitAuthorName: process.env.GIT_AUTHOR_NAME || undefined,
    gitAuthorEmail: process.env.GIT_AUTHOR_EMAIL || undefined,
    npmToken: process.env.NPM_TOKEN || undefined,
  };
}
