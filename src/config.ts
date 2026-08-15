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
  /** Auto-stop after this idle period. */
  idleTimeout: string;
  /** Hard cap on box lifetime. */
  maxDuration: string;

  /** ccproxy endpoint for in-box model calls. */
  anthropicBaseUrl: string;
  /** Placeholder key accepted by ccproxy's Anthropic route. */
  anthropicApiKey: string;
  /** Model alias to use (a current, non-retired one from ccproxy /v1/models). */
  anthropicModel: string;

  /** Short-lived git credential injected into the box (optional). */
  gitToken?: string;
  /** Short-lived npm credential injected into the box (optional). */
  npmToken?: string;
}

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

export function loadConfig(): Config {
  return {
    vpsSsh: req("VPS_SSH"),
    vpsStagingDir: req("VPS_STAGING_DIR", "/root/agent-sandbox-staging"),

    msb: req("MSB", "/root/.local/bin/msb"),
    image: req("MSB_IMAGE", "node"),
    idleTimeout: req("MSB_IDLE_TIMEOUT", "15m"),
    maxDuration: req("MSB_MAX_DURATION", "1h"),

    anthropicBaseUrl: req("ANTHROPIC_BASE_URL", "https://your-ccproxy.example.com"),
    anthropicApiKey: req("ANTHROPIC_API_KEY", "dummy"),
    anthropicModel: req("ANTHROPIC_MODEL", "ak-claude-opus-4.8"),

    gitToken: process.env.GIT_TOKEN || undefined,
    npmToken: process.env.NPM_TOKEN || undefined,
  };
}
