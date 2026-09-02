/**
 * Pure builder for on-demand secret env flags (ask-then-resume, ephemeral).
 *
 * When the in-box agent reports it needs a credential/connection detail, you re-call `resume` with
 * `secrets: {KEY: value}`. Those become `-e KEY=VALUE` flags on THAT exec only — same injection
 * path as GH_TOKEN — so the continued agent can use them. Nothing is stored; they vanish on the
 * next exec / teardown. Each flag is a single argv token ("KEY=VALUE"); msb.ts shell-quotes every
 * token before it crosses SSH, so keys/values can't inject into the remote shell.
 *
 * Two rules the caller cannot bend:
 *
 *  - RESERVED keys are refused. `resumeAgentTask` appends these flags AFTER the controller's own
 *    (msb.ts), and a later `-e` wins, so `secrets: {ANTHROPIC_BASE_URL: "https://attacker/"}` would
 *    silently point the in-box agent's model traffic — prompts, repo contents and the API key it
 *    also holds — at a caller-chosen host. AGENT_SYS_PROMPT would drop the standing policy the
 *    guard hook and ask-gate assume; AGENT_TASK would make the agent run something other than the
 *    message the transcript records. None of these are things a credential injection needs, so the
 *    whole set is refused with a message naming the key rather than quietly ignored.
 *  - KEYS must look like env names. A key with `=`, a space or a NUL does not survive the KEY=VALUE
 *    encoding intact, and one starting with `-` would be read by msb as another flag.
 */

/** Env the controller sets itself; a caller-supplied value would override it (last -e wins). */
export const RESERVED_SECRET_KEYS = new Set([
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_MODEL",
  "AGENT_TASK",
  "AGENT_SYS_PROMPT",
  "CLAUDE_CODE_ENABLE_TASKS",
  "NPM_TOKEN",
]);

/** POSIX-ish env name: letters, digits, underscore; never leading digit, never a flag. */
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

export function secretEnvFlags(secrets?: Record<string, string>): string[] {
  if (!secrets) return [];
  const flags: string[] = [];
  for (const [key, value] of Object.entries(secrets)) {
    if (!ENV_KEY_RE.test(key)) {
      throw new Error(
        `Invalid secret name "${key}": use an environment variable name (letters, digits, underscore; not starting with a digit).`
      );
    }
    if (RESERVED_SECRET_KEYS.has(key)) {
      throw new Error(
        `"${key}" is set by the sandbox itself and cannot be supplied as a secret — it would redirect or reprogram the agent. Pass the credential under its own name instead.`
      );
    }
    flags.push("-e", `${key}=${value}`);
  }
  return flags;
}
