/**
 * Starter skills — a small curated set seeded into every NEW account so the skills feature is
 * demonstrated by example, not explained by an empty page. Seeding is best-effort and happens once,
 * at account creation; it never overwrites anything an owner already has (see seedStarterSkills).
 *
 * Content rules: each SKILL.md body is a short, concrete playbook (~15–25 lines) in the product's
 * direct technical voice. These intentionally do not duplicate the dashboard's inline templates
 * (review-pr, release-notes, fix-ci in SkillsPage.tsx).
 */
import { normalizeSkill, type SkillDef, type SkillStore } from "./skill-store.js";
import { loadSkillStore, saveSkillStore } from "./skill-store.js";
import { hasUserStoreBackend, withOwner } from "./user-store.js";
import type { Config } from "./config.js";

export interface StarterSkill {
  name: string;
  description: string;
  content: string;
}

export const STARTER_SKILLS: StarterSkill[] = [
  {
    name: "fix-issue",
    description: "Use when given a GitHub issue reference (URL or #number) and the task is to fix it end to end.",
    content: [
      "Take an issue from report to merged-ready PR. Reproduce before you touch anything.",
      "",
      "1. Read the issue with `gh issue view <ref>` — the description, then every comment; later comments often correct the report.",
      "2. Reproduce it. Write the smallest command, script, or test that shows the bug. If you cannot reproduce, say so on the issue-fixing task and stop — do not fix by guesswork.",
      "3. Find the cause, not the symptom. Trace from the failing behaviour to the code that decides it.",
      "4. Fix it with the smallest change that addresses the cause. Resist drive-by refactors.",
      "5. Add a regression test that fails on the old code and passes on the fix. Run it against the unfixed code if practical to prove it catches the bug.",
      "6. Run the full test suite. Fix anything you broke.",
      "7. Open a PR: title states the fix, body links the issue (`Fixes #N`), explains the cause in two or three sentences, and shows how you verified it.",
      "",
      "Never close the issue yourself; the PR merge does that via the `Fixes` keyword.",
    ].join("\n"),
  },
  {
    name: "write-tests",
    description: "Use when asked to add tests or raise coverage on a module or file.",
    content: [
      "Raise real coverage on the named module — tests that would catch a bug, not tests that restate the code.",
      "",
      "1. Run the existing suite first and note the result; you need a clean baseline to know what you added.",
      "2. Read the module and list its observable behaviours: inputs → outputs, error paths, edge cases (empty, zero, unicode, concurrent, huge).",
      "3. Test behaviour, not implementation. Assert on return values and effects, never on private internals or call counts unless the contract IS the call.",
      "4. Prioritise: error handling and boundary conditions first — the happy path usually already works.",
      "5. Follow the project's existing test style: same runner, same file layout, same assertion library. Do not introduce a new framework.",
      "6. Each test gets a name that reads as a claim (\"rejects an expired token\"), one behaviour per test.",
      "7. Run the full suite again. Every new test must pass; every old test must still pass.",
      "8. Summarise: which behaviours are now covered, and which remain untested and why.",
    ].join("\n"),
  },
  {
    name: "upgrade-deps",
    description: "Use when asked to update or upgrade dependencies in a project.",
    content: [
      "Update dependencies conservatively — the goal is a boring diff that ships, not the newest of everything.",
      "",
      "1. List what is outdated (`npm outdated`, `pip list --outdated`, or the ecosystem's equivalent).",
      "2. Split into patch/minor vs major. Patch and minor go in one batch; each major gets its own commit.",
      "3. For every major bump, read the changelog or release notes for breaking changes before touching the lockfile. Skip a major you cannot verify.",
      "4. Upgrade, then run the full build AND the test suite after each batch. A red suite means stop and fix or roll that bump back — never stack a second upgrade on a broken tree.",
      "5. Check the lockfile diff for surprise transitive changes.",
      "6. Open a PR with a summary table: package, old version, new version, breaking changes (or \"none\"), and what you ran to verify.",
      "",
      "Do not upgrade tools the project pins deliberately (engine versions, pinned SDKs) without flagging it.",
    ].join("\n"),
  },
  {
    name: "code-review",
    description: "Use when asked to review code: the current diff, a branch, or a pull request.",
    content: [
      "Review adversarially — your job is to find what is wrong, not to describe what the code does.",
      "",
      "1. Get the diff: `git diff` for the working tree, or `gh pr diff <number>` for a PR. Read the whole thing before commenting.",
      "2. Read every changed file in full context, not just the changed hunks — bugs live in the lines the diff doesn't show.",
      "3. Verify claims by running the code: if the description says \"tests pass\", run them; if a function claims to handle an edge case, feed it that case.",
      "4. Hunt in order of damage: correctness bugs, missing error handling, security holes, race conditions, then untested behaviour changes, then style.",
      "5. For each candidate finding, try to prove yourself wrong before reporting it — a false positive costs the author real time.",
      "6. Report findings ranked by severity. Each one: file and line, what breaks, and how to trigger it. No vague advice.",
      "7. End with a verdict: approve, or needs work — and if needs work, exactly what must change.",
      "",
      "Zero findings is a valid result; say so plainly rather than inventing nitpicks.",
    ].join("\n"),
  },
];

/** The starters as validated store entries (throws in tests if any starter is malformed). */
export function starterSkillDefs(now = Date.now()): SkillDef[] {
  return STARTER_SKILLS.map((s) => normalizeSkill({ ...s, enabled: true }, now));
}

/**
 * Seed the starter skills into a brand-new owner's (empty) skill store. Best-effort by contract:
 * any failure is logged and swallowed — seeding must never fail a signup. An owner who already has
 * any skill is left completely alone.
 */
export async function seedStarterSkills(cfg: Config, ownerId: string): Promise<void> {
  try {
    if (!hasUserStoreBackend()) return; // stdio/local mode: no per-owner store to seed
    await withOwner(ownerId, async () => {
      const store = await loadSkillStore(cfg);
      if (Object.keys(store.skills).length > 0) return; // not a fresh store: hands off
      const next: SkillStore = { skills: {} };
      for (const def of starterSkillDefs()) next.skills[def.name] = def;
      await saveSkillStore(cfg, next);
    });
  } catch (e) {
    console.error(`[skills] starter seeding failed for ${ownerId}: ${String((e as Error)?.message ?? e)}`);
  }
}
