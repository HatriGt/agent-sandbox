/**
 * Pure builder for on-demand secret env flags (ask-then-resume, ephemeral).
 *
 * When the in-box agent reports it needs a credential/connection detail, you re-call `resume` with
 * `secrets: {KEY: value}`. Those become `-e KEY=VALUE` flags on THAT exec only — same injection
 * path as GH_TOKEN — so the continued agent can use them. Nothing is stored; they vanish on the
 * next exec / teardown. Each flag is a single argv token ("KEY=VALUE"); msb.ts shell-quotes every
 * token before it crosses SSH, so keys/values can't inject into the remote shell.
 */
export function secretEnvFlags(secrets?: Record<string, string>): string[] {
  if (!secrets) return [];
  const flags: string[] = [];
  for (const [key, value] of Object.entries(secrets)) {
    flags.push("-e", `${key}=${value}`);
  }
  return flags;
}
