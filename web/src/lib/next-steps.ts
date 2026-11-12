// What to ask for next, read off how the run ended. A finished run leaves facts (checks, changes,
// pull requests, exit code); the obvious follow-up is offered as one click that fills the message
// box, never sends: the person still decides.
import type { RunOutcome } from "./api";

export interface NextStep {
  id: "fix-checks" | "retry" | "test" | "pr" | "review" | "ci";
  label: string;
  text: string;
}

const MAX = 3;

/** Up to three follow-ups, most urgent first. `exitCode` is the agent's own exit, when known. */
export function nextSteps(o: RunOutcome | null, exitCode: number | null): NextStep[] {
  if (!o || o.state === "running" || o.state === "waiting") return [];
  const out: NextStep[] = [];
  const t = o.trust;
  const changed = (o.result.diff?.files ?? 0) > 0;
  const hasPr = o.result.prs.length > 0;
  const checksFailed = (t.tests?.failed ?? 0) > 0 || t.verified?.pass === false;
  const checked = !!t.tests || !!t.verified;
  // The sandbox died or was stopped: the pill already says what to do about it.
  const infra = exitCode === 137 || exitCode === 250 || exitCode === 253 || exitCode === 254;
  if (infra) return [];
  if (checksFailed) {
    const n = t.tests?.failed ?? 0;
    out.push({ id: "fix-checks", label: n > 0 ? `Fix the ${n} failing ${n === 1 ? "test" : "tests"}` : "Fix the failing check", text: "The checks failed. Find out why, fix the cause and run them again until they pass." });
  } else if (o.state === "failed" || (exitCode != null && exitCode !== 0)) {
    out.push({ id: "retry", label: "Try another way", text: "That did not work. Say in one line what went wrong, then try a different approach." });
  }
  if (changed && !checked) out.push({ id: "test", label: "Run the tests", text: "Run the project's tests against these changes and fix anything that fails." });
  if (changed && !hasPr && !checksFailed) out.push({ id: "pr", label: "Open a pull request", text: "Open a pull request for these changes. Say what changed and why in a few lines." });
  if (hasPr) out.push({ id: "ci", label: "Check the pull request", text: "Look at the checks and review comments on the pull request and fix whatever is failing or asked for." });
  if (changed) out.push({ id: "review", label: "Review the changes", text: "Review your own changes for bugs, missed edge cases and leftovers, and fix what you find." });
  return out.slice(0, MAX);
}
