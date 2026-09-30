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

/**
 * Chaining: a global core.hooksPath would otherwise silently disable the repo's own hooks. Every hook
 * we install ends by exec'ing the repo's own one — `.git/hooks/<name>` (if executable, git's rule)
 * or husky's `.husky/<name>` — with the same args and stdin.
 */
const CHAIN = `repo_hook() {
  gd=$(git rev-parse --git-dir 2>/dev/null) || return 0
  if [ -x "$gd/hooks/$1" ]; then shift_hook="$gd/hooks/$1"; return 0; fi
  if [ -f ".husky/$1" ]; then shift_hook="sh -e .husky/$1"; return 0; fi
  shift_hook=""
}`;

/** The pre-push hook. POSIX sh; stdin lines are `<local ref> <local sha> <remote ref> <remote sha>`. */
export const PRE_PUSH_HOOK = `#!/bin/sh
# agent-sandbox: PR-only guard for runs started by an automation.
${CHAIN}
input=$(cat)
def=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')
while read lref lsha rref rsha; do
  [ -z "$rref" ] && continue
  b=\${rref#refs/heads/}
  if [ "$lsha" = "${ZERO}" ]; then
    echo "agent-sandbox: automations may not delete remote branches ($b)" >&2
    exit 1
  fi
  if [ "$b" = "main" ] || [ "$b" = "master" ] || { [ -n "$def" ] && [ "$b" = "$def" ]; }; then
    echo "agent-sandbox: this run was started by an automation; it may only push a new branch and open a PR (refused push to $b)" >&2
    exit 1
  fi
done <<EOF
$input
EOF
repo_hook pre-push
[ -n "$shift_hook" ] && { printf '%s\\n' "$input" | $shift_hook "$@"; exit $?; }
exit 0
`;

/** Pass-through shims so the global hooksPath does not disable the repo's other hooks. */
export const CHAINED_HOOKS = ["pre-commit", "prepare-commit-msg", "commit-msg", "post-commit", "post-checkout", "post-merge", "pre-rebase", "post-rewrite"];
export const SHIM_HOOK = `#!/bin/sh
${CHAIN}
repo_hook "$(basename "$0")"
[ -n "$shift_hook" ] && exec $shift_hook "$@"
exit 0
`;

/**
 * Shell that installs the hooks for every repo in the box (global hooksPath covers later clones).
 * A repo-local core.hooksPath (husky sets one) would override the global guard, so it is unset in
 * every cloned repo — husky's hooks still run through the chain above.
 */
export function installHookScript(): string {
  const b64 = Buffer.from(PRE_PUSH_HOOK).toString("base64");
  const shim = Buffer.from(SHIM_HOOK).toString("base64");
  return (
    `set -e; D="$HOME/.asb-hooks"; mkdir -p "$D"; printf '%s' ${shellQuote(b64)} | base64 -d > "$D/pre-push"; chmod 755 "$D/pre-push"; ` +
    `for h in ${CHAINED_HOOKS.join(" ")}; do printf '%s' ${shellQuote(shim)} | base64 -d > "$D/$h"; chmod 755 "$D/$h"; done; ` +
    `git config --global core.hooksPath "$D"; git config --system core.hooksPath "$D" 2>/dev/null || true; ` +
    `for r in /workspace/*/; do [ -d "$r.git" ] && git -C "$r" config --local --unset-all core.hooksPath 2>/dev/null || true; done; ` +
    `[ "$(git config --global core.hooksPath)" = "$D" ] && [ -x "$D/pre-push" ] && echo ok`
  );
}

export async function installPrOnlyGuard(cfg: Config, box: string): Promise<void> {
  const r = await exec(cfg, box, installHookScript());
  if (!r.stdout.trim().endsWith("ok")) throw new Error(`could not install the PR-only guard: ${(r.stderr || r.stdout).slice(0, 200)}`);
}

/**
 * Fail closed: install the guard (one retry); if it still fails, tear the box down so the agent
 * cannot keep working unguarded, and return a failed start with a reason for the automation's
 * last result.
 */
export async function guardOrStop(
  box: string,
  install: (box: string) => Promise<void>,
  teardown: (box: string) => Promise<void>,
  log: (m: string) => void = (m) => console.error(m)
): Promise<{ ok: true } | { ok: false; question: string }> {
  let err: unknown;
  for (let i = 0; i < 2; i++) {
    try {
      await install(box);
      return { ok: true };
    } catch (e) {
      err = e;
    }
  }
  const msg = (err as Error)?.message ?? String(err);
  log(`[triggers] ${box}: PR-only guard not installed, stopping the run: ${msg}`);
  await teardown(box).catch((e) => log(`[triggers] ${box}: teardown after guard failure failed: ${(e as Error).message}`));
  return { ok: false, question: `Stopped: the PR-only guard could not be installed, so the run was torn down before it could push (${msg.slice(0, 160)}).` };
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
