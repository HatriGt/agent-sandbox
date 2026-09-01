/**
 * Importing skills from outside the dashboard: a SKILL.md file from disk, or a GitHub repository
 * browsed live. The file format is Claude Code's own — YAML frontmatter (name/description) over a
 * markdown body — so anything from anthropics/skills or a repo's .claude/skills folder drops in
 * unchanged. GitHub reads go through the controller (`/skill-repo.json`), NOT straight from here:
 * the page runs under `connect-src 'self'`, which is what stops an injected script exfiltrating the
 * bearer token, so the import feature routes around that policy instead of widening it.
 */
import { api } from "./api";

export interface ParsedSkill {
  name: string;
  description: string;
  content: string;
}

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,49}$/;

/** Slugify anything (a filename, a heading) into a valid skill name. */
export function toSkillName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\.(md|markdown|txt)$/i, "")
    .replace(/skill$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "imported-skill";
}

/**
 * Parse a SKILL.md: frontmatter name/description if present, else fall back to the first heading /
 * first paragraph. Never throws — the editor is the place to fix a rough import, not an error toast.
 */
export function parseSkillMd(text: string, fallbackName: string): ParsedSkill {
  const src = text.replace(/\r\n/g, "\n").trim();
  let name = "";
  let description = "";
  let body = src;

  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(src);
  if (fm) {
    body = src.slice(fm[0].length).trim();
    for (const line of fm[1].split("\n")) {
      const m = /^(name|description)\s*:\s*(.*)$/.exec(line);
      if (!m) continue;
      let v = m[2].trim();
      // Frontmatter written by us JSON-quotes the description; plain YAML quoting also lands here.
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        try {
          v = v.startsWith('"') ? (JSON.parse(v) as string) : v.slice(1, -1);
        } catch {
          v = v.slice(1, -1);
        }
      }
      if (m[1] === "name") name = v;
      else description = v;
    }
  }

  if (!name || !NAME_RE.test(name)) {
    const h = /^#\s+(.+)$/m.exec(body);
    name = toSkillName(name || h?.[1] || fallbackName);
  }
  if (!description) {
    const firstPara = body
      .split("\n")
      .find((l) => l.trim() && !l.startsWith("#") && !l.startsWith("```"));
    description = (firstPara ?? `Imported skill ${name}.`).trim().slice(0, 1024);
  }
  return { name, description, content: body || src };
}

/** The SKILL.md we hand back on export — identical to what the controller writes into the box. */
export function toSkillMd(s: ParsedSkill): string {
  return `---\nname: ${s.name}\ndescription: ${JSON.stringify(s.description)}\n---\n\n${s.content}\n`;
}

/* ───────────────────────────── GitHub ───────────────────────────── */

export interface RepoRef {
  owner: string;
  repo: string;
  branch?: string;
  /** Directory the URL pointed at, if any — narrows the listing to that folder. */
  subpath?: string;
}

export interface RepoSkillFile {
  /** Path of the markdown file inside the repo. */
  path: string;
  /** The display name derived from the path (folder for SKILL.md, filename otherwise). */
  name: string;
}

/**
 * Accepts "owner/repo" or a github.com URL. A URL that points into the tree
 * (`/tree/<branch>/<dir>`) keeps its directory, so pasting the address bar from a single skill's
 * folder imports that skill rather than every skill in the repository.
 */
export function parseRepoInput(input: string): RepoRef {
  const s = input.trim().replace(/\/+$/, "").replace(/\.git$/, "");
  const url = /github\.com\/([^/\s]+)\/([^/\s]+)(?:\/tree\/([^/\s]+)(?:\/([^\s?#]+))?)?/.exec(s);
  if (url) return { owner: url[1], repo: url[2], branch: url[3], subpath: url[4] };
  const short = /^([\w.-]+)\/([\w.-]+)$/.exec(s);
  if (short) return { owner: short[1], repo: short[2] };
  throw new Error("Enter a repository as owner/repo or a github.com URL.");
}

/**
 * List the skill files a repository carries: every `SKILL.md` (Claude Code skill folders), plus
 * loose `.md` files under a `skills/` or `commands/` directory. The controller does the fetching.
 */
export async function listRepoSkills(ref: RepoRef): Promise<{ branch: string; files: RepoSkillFile[] }> {
  return api.skillRepo<{ branch: string; files: RepoSkillFile[] }>({ action: "list", owner: ref.owner, repo: ref.repo, branch: ref.branch, subpath: ref.subpath });
}

/** Fetch one file's raw text from the repo. */
export async function fetchRepoFile(ref: RepoRef, branch: string, path: string): Promise<string> {
  const { text } = await api.skillRepo<{ text: string }>({ action: "fetch", owner: ref.owner, repo: ref.repo, branch, path });
  return text;
}
