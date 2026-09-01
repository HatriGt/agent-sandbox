/**
 * Server-side GitHub reads for the dashboard's "import skill from a repository" flow.
 *
 * This lives on the controller rather than in the browser for one reason: the SPA runs under
 * `connect-src 'self'` (see security-headers.ts), which is the load-bearing defence around the
 * root-equivalent bearer token in localStorage. Fetching api.github.com straight from the page
 * would need that policy widened to a host an injected script could also reach, so the browser
 * asks us instead and the policy stays shut.
 *
 * Public repos only, and deliberately unauthenticated: importing a skill is a read of public
 * content, so it never spends (or exposes) a stored user token. That caps us at GitHub's ~60
 * req/hr anonymous budget per server IP — fine for occasional imports, and the reason the list
 * call is a single recursive tree request rather than a walk.
 */

/** A markdown file in a repo that looks like a skill. */
export interface RepoSkillFile {
  path: string;
  name: string;
}

const OWNER_RE = /^[\w.-]{1,100}$/;
const BRANCH_RE = /^[\w.\-/]{1,250}$/;

/** Slugify a filename or folder into a valid skill name. Mirrors the client's toSkillName. */
export function toSkillName(raw: string): string {
  return (
    raw
      .toLowerCase()
      .replace(/\.(md|markdown|txt)$/i, "")
      .replace(/skill$/i, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "imported-skill"
  );
}

/**
 * Reject anything that isn't a plain owner/repo/branch/path. The proxy only ever builds URLs on
 * github's own hosts, so this is about keeping path traversal and stray URL syntax out of the
 * request we sign our server's IP to — not about origin choice, which is fixed below.
 */
function assertRef(owner: string, repo: string, branch?: string): void {
  if (!OWNER_RE.test(owner) || !OWNER_RE.test(repo)) throw new Error("Enter a repository as owner/repo.");
  if (branch !== undefined && !BRANCH_RE.test(branch)) throw new Error("Invalid branch name.");
}

function assertPath(path: string): void {
  if (!path || path.length > 400 || path.startsWith("/") || path.includes("..") || /[\0\\]/.test(path)) {
    throw new Error("Invalid file path.");
  }
  if (!/\.(md|markdown)$/i.test(path)) throw new Error("Only markdown files can be imported.");
}

async function gh<T>(path: string): Promise<T> {
  const r = await fetch(`https://api.github.com${path}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "agent-sandbox-dashboard" },
  });
  if (r.status === 403 || r.status === 429) throw new Error("GitHub rate limit reached — try again in a few minutes.");
  if (r.status === 404) throw new Error("Repository not found (private repositories cannot be browsed here).");
  if (!r.ok) throw new Error(`GitHub said ${r.status}.`);
  return (await r.json()) as T;
}

/**
 * List the skill files a repository carries: every `SKILL.md` (a Claude Code skill folder), plus
 * loose `.md` files under a `skills/` or `commands/` directory. `subpath` narrows the result to one
 * directory, which is what a github.com/.../tree/main/skills/<name> URL means.
 */
export async function listRepoSkills(
  owner: string,
  repo: string,
  branch?: string,
  subpath?: string
): Promise<{ branch: string; files: RepoSkillFile[] }> {
  assertRef(owner, repo, branch);
  const ref = branch ?? (await gh<{ default_branch: string }>(`/repos/${owner}/${repo}`)).default_branch;
  const tree = await gh<{ tree: { path: string; type: string }[]; truncated?: boolean }>(
    `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`
  );

  const prefix = (subpath ?? "").replace(/^\/+|\/+$/g, "");
  const files: RepoSkillFile[] = [];
  for (const t of tree.tree) {
    if (t.type !== "blob" || !/\.md$/i.test(t.path)) continue;
    if (prefix && t.path !== prefix && !t.path.startsWith(`${prefix}/`)) continue;
    const parts = t.path.split("/");
    const file = parts[parts.length - 1];
    if (/^skill\.md$/i.test(file)) {
      files.push({ path: t.path, name: toSkillName(parts[parts.length - 2] ?? file) });
    } else if (/(^|\/)(skills|commands)\//i.test(t.path) && !/^readme\.md$/i.test(file)) {
      files.push({ path: t.path, name: toSkillName(file) });
    }
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  return { branch: ref, files };
}

/** Fetch one file's raw text. */
export async function fetchRepoFile(owner: string, repo: string, branch: string, path: string): Promise<string> {
  assertRef(owner, repo, branch);
  assertPath(path);
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  const r = await fetch(url, { headers: { "User-Agent": "agent-sandbox-dashboard" } });
  if (!r.ok) throw new Error(`Could not fetch ${path} (${r.status}).`);
  const text = await r.text();
  if (text.length > 512_000) throw new Error(`${path} is too large to import.`);
  return text;
}
