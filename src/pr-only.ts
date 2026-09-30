/**
 * PR-only, enforced at the git layer for runs an automation started (not just asked for in the
 * prompt). Two gates:
 *
 * 1. A box-side `pre-push` hook, installed through the box's global `core.hooksPath` right after
 *    the trigger's box launches. It refuses any push whose remote ref is the default branch (from
 *    `origin/HEAD`, plus main/master), and any remote branch deletion.
 * 2. The controller's own push path (the workspace pane's Push button) refuses the same refs for a
 *    trigger-started box, independent of anything inside the box.
 *
 * Known limit, stated honestly: the agent holds a GitHub token inside its box, so `git push
 * --no-verify` or a raw API call can still bypass gate 1. Branch protection on the repo is the only
 * complete answer; this closes the ordinary path an agent takes.
 */
import type { Config } from "./config.js";
import { exec } from "./msb.js";
import { shellQuote } from "./exec.js";

const ZERO = "0000000000000000000000000000000000000000";
const ALWAYS_PROTECTED = ["main", "master"];

/** Pure mirror of the hook's decision, for the controller path and tests. Returns a reason or null. */
export function refusePush(remoteRef: string, localSha: string, defaultBranch?: string): string | null {
  const b = remoteRef.replace(/^refs\/heads\//, "");
  if (localSha === ZERO) return `automations may not delete remote branches (${b})`;
  if (ALWAYS_PROTECTED.includes(b) || (defaultBranch && b === defaultBranch))
    return `this run was started by an automation; it may only push a new branch and open a PR (refused push to ${b})`;
  return null;
}

/** The pre-push hook. POSIX sh; stdin lines are `<local ref> <local sha> <remote ref> <remote sha>`. */
export const PRE_PUSH_HOOK = `#!/bin/sh
# agent-sandbox: PR-only guard for runs started by an automation.
def=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')
while read lref lsha rref rsha; do
  b=\${rref#refs/heads/}
  if [ "$lsha" = "${ZERO}" ]; then
    echo "agent-sandbox: automations may not delete remote branches ($b)" >&2
    exit 1
  fi
  if [ "$b" = "main" ] || [ "$b" = "master" ] || { [ -n "$def" ] && [ "$b" = "$def" ]; }; then
    echo "agent-sandbox: this run was started by an automation; it may only push a new branch and open a PR (refused push to $b)" >&2
    exit 1
  fi
done
exit 0
`;

/** Shell that installs the hook for every repo in the box (global hooksPath covers later clones too). */
export function installHookScript(): string {
  const b64 = Buffer.from(PRE_PUSH_HOOK).toString("base64");
  return (
    `set -e; D="$HOME/.asb-hooks"; mkdir -p "$D"; printf '%s' ${shellQuote(b64)} | base64 -d > "$D/pre-push"; chmod 755 "$D/pre-push"; ` +
    `git config --global core.hooksPath "$D"; git config --system core.hooksPath "$D" 2>/dev/null || true; echo ok`
  );
}

export async function installPrOnlyGuard(cfg: Config, box: string): Promise<void> {
  const r = await exec(cfg, box, installHookScript());
  if (!r.stdout.trim().endsWith("ok")) throw new Error(`could not install the PR-only guard: ${(r.stderr || r.stdout).slice(0, 200)}`);
}

/** Controller push path: refuse pushing HEAD to the default branch for a trigger-started box. */
export async function assertPrOnlyPush(cfg: Config, box: string, repo: string): Promise<void> {
  const r = await exec(
    cfg,
    box,
    `cd /workspace/${shellQuote(repo)} 2>/dev/null || exit 0; git rev-parse --abbrev-ref HEAD; git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##'`
  );
  const [branch = "", def = ""] = r.stdout.trim().split("\n").map((s) => s.trim());
  const why = refusePush(branch, "x", def || undefined);
  if (why) throw new Error(why);
}
