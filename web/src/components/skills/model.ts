import type { SkillsResponse } from "@/lib/api";
import type { SkillFile } from "@/lib/skillImport";

/** What the editor works on: a saved skill's fields, or an import/template not yet saved. */
export type Draft = { name: string; description: string; content: string; files?: SkillFile[] };

/** The page's one mutation channel: POST, replace the cached list, toast. */
export type Mutate = (body: Record<string, unknown>, ok?: string) => Promise<SkillsResponse>;

/** Claude Code's constraint for skill folder names — what we write is what it loads. */
export const NAME_RE = /^[a-z0-9][a-z0-9-]{0,49}$/;
export const MAX_CONTENT = 65_536;

export function fmtKb(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(bytes >= 10240 ? 0 : 1)} KB` : `${bytes} B`;
}

/** UTF-8 size of a string — what the file will weigh on disk in the sandbox. */
export function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** Paths a skill file may use: relative, no `..`, no leading slash, ordinary characters. */
export const FILE_PATH_RE = /^(?!.*(^|\/)\.\.(\/|$))[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

export function fileNameError(path: string, taken: string[]): string | null {
  const p = path.trim();
  if (!p) return "Name the file.";
  if (p === "SKILL.md") return "SKILL.md is the entry point — it is already here.";
  if (!FILE_PATH_RE.test(p)) return "Letters, digits, dots, dashes; folders with /.";
  if (taken.includes(p)) return "A file with this path already exists.";
  return null;
}

/** Skill name from a file/heading, for the frontmatter field's auto-slug. */
export function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+/, "")
    .slice(0, 50);
}

/** "3 files · 12 KB" — how a multi-file skill announces its baggage. */
export function fmtBundle(fileCount: number, totalBytes: number): string {
  return `${fileCount} file${fileCount === 1 ? "" : "s"} · ${fmtKb(totalBytes)}`;
}

/** The skills the controller seeds into a new store (src/starter-skills.ts). */
export const STARTER_NAMES: Record<string, true> = { "fix-issue": true, "write-tests": true, "upgrade-deps": true, "code-review": true, "security-review": true, "write-pr-description": true };

export type SkillSource = "starter" | "custom";

/** Where a skill came from. The store keeps no provenance, so: a starter name is a starter; the rest is yours. */
export function sourceOf(name: string): SkillSource {
  return STARTER_NAMES[name] ? "starter" : "custom";
}

export const TEMPLATES: (Draft & { blurb: string; steps: number })[] = [
  {
    name: "review-pr",
    blurb: "A consistent PR review, your way",
    steps: 5,
    description: "Use when asked to review a pull request in any of our repos.",
    content:
      "1. Read the PR description and every changed file before commenting.\n" +
      "2. Check: correctness first, then tests, then naming and structure.\n" +
      "3. Flag anything that changes public behaviour without a test.\n" +
      "4. Summarise as: verdict (approve / needs work), then findings ordered by severity.\n" +
      "5. Be specific — file and line for every finding, no vague advice.",
  },
  {
    name: "release-notes",
    blurb: "Turn merged work into notes people read",
    steps: 4,
    description: "Use when asked to write release notes or a changelog entry.",
    content:
      "1. List the commits/PRs since the last tag.\n" +
      "2. Group into: Features, Fixes, Internal. Drop anything users cannot observe.\n" +
      "3. One line each, plain language, lead with the user benefit.\n" +
      "4. End with upgrade/migration steps only if something breaks.",
  },
  {
    name: "fix-ci",
    blurb: "Diagnose a red pipeline methodically",
    steps: 4,
    description: "Use when a CI pipeline or test run is failing and the task is to fix it.",
    content:
      "1. Reproduce locally first — run the exact failing command from the CI log.\n" +
      "2. Read the FIRST error, not the last; later failures usually cascade.\n" +
      "3. Fix the cause, not the assertion. Never skip or delete a failing test to go green.\n" +
      "4. Re-run the full suite before declaring it fixed.",
  },
];
