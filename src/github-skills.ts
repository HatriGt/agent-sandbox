/**
 * Server-side GitHub reads for the dashboard's "import skill from a repository" flow.
 *
 * This lives on the controller rather than in the browser for one reason: the SPA runs under
 * `connect-src 'self'` (see security-headers.ts), which is the load-bearing defence around the
 * root-equivalent bearer token in localStorage. Fetching api.github.com straight from the page
 * would need that policy widened to a host an injected script could also reach, so the browser
 * asks us instead and the policy stays shut.
 *
 * Auth: when the caller's stored GitHub accounts (gh-token-store) include one whose observed
 * access covers the repo, its token rides along — that is what makes PRIVATE repos browsable.
 * The token never leaves the controller (the CSP rationale above holds), and public repos are
 * still fetched anonymously so an import never spends a token it doesn't need. Anonymous
 * traffic is capped at GitHub's ~60 req/hr budget per server IP — the reason the list call is
 * a single recursive tree request rather than a walk.
 */
import type { Config } from "./config.js";
import { candidateAccounts, loadStore } from "./gh-token-store.js";
import { SKILL_LIMITS, validateSkillFilePath, type SkillFile } from "./skill-store.js";

/** Something importable found in a repo: a skill folder (SKILL.md + files) or a loose markdown file. */
export interface RepoSkillEntry {
  kind: "dir" | "file";
  /** Folder path (kind dir) or markdown file path (kind file) inside the repo. */
  path: string;
  /** Skill name derived from the path. */
  name: string;
  /** Files the folder carries (1 for a loose file). */
  fileCount: number;
  /** Total blob bytes (best effort — what the tree API reports). */
  totalBytes: number;
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

function assertPath(path: string, markdownOnly: boolean): void {
  if (!path || path.length > 400 || path.startsWith("/") || path.includes("..") || /[\0\\]/.test(path)) {
    throw new Error("Invalid file path.");
  }
  if (markdownOnly && !/\.(md|markdown)$/i.test(path)) throw new Error("Only markdown files can be imported.");
}

/**
 * The first stored account whose observed access covers the repo — its token unlocks private
 * repos for the import proxy. Undefined means browse anonymously (public repos, no token spent).
 */
export async function resolveSkillRepoToken(cfg: Config, owner: string, repo: string): Promise<string | undefined> {
  try {
    const store = await loadStore(cfg);
    return candidateAccounts(store, `${owner}/${repo}`)[0]?.token;
  } catch {
    return undefined; // token store trouble must never break public imports
  }
}

function ghHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "agent-sandbox-dashboard" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function gh<T>(path: string, token?: string): Promise<T> {
  const r = await fetch(`https://api.github.com${path}`, { headers: ghHeaders(token) });
  if (r.status === 403 || r.status === 429) throw new Error("GitHub rate limit reached — try again in a few minutes.");
  if (r.status === 404 || r.status === 401)
    throw new Error(
      token
        ? "Repository not found — your saved GitHub token cannot access it."
        : "Repository not found (add a GitHub account with access to browse private repositories)."
    );
  if (!r.ok) throw new Error(`GitHub said ${r.status}.`);
  return (await r.json()) as T;
}

interface TreeBlob {
  path: string;
  type: string;
  sha: string;
  size?: number;
}

async function repoTree(owner: string, repo: string, branch: string | undefined, token?: string): Promise<{ ref: string; blobs: TreeBlob[] }> {
  const ref = branch ?? (await gh<{ default_branch: string }>(`/repos/${owner}/${repo}`, token)).default_branch;
  const tree = await gh<{ tree: TreeBlob[]; truncated?: boolean }>(
    `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    token
  );
  if (tree.truncated) throw new Error("Repository is too large to list — paste a URL that points at the skill folder instead.");
  return { ref, blobs: tree.tree.filter((t) => t.type === "blob") };
}

/**
 * List what a repository carries: every folder holding a `SKILL.md` (a whole Claude Code skill —
 * imported with all its supporting files), plus loose `.md` files under a `skills/` or `commands/`
 * directory. `subpath` narrows the result to one directory, which is what a
 * github.com/.../tree/main/<dir> URL means.
 */
export async function listRepoSkills(
  owner: string,
  repo: string,
  branch?: string,
  subpath?: string,
  token?: string
): Promise<{ branch: string; entries: RepoSkillEntry[] }> {
  assertRef(owner, repo, branch);
  const { ref, blobs } = await repoTree(owner, repo, branch, token);

  const prefix = (subpath ?? "").replace(/^\/+|\/+$/g, "");
  const inScope = blobs.filter((t) => !prefix || t.path === prefix || t.path.startsWith(`${prefix}/`));

  // Skill folders: every directory that holds a SKILL.md claims its whole subtree.
  const dirs = inScope
    .filter((t) => /(^|\/)skill\.md$/i.test(t.path))
    .map((t) => t.path.split("/").slice(0, -1).join("/"));
  const entries: RepoSkillEntry[] = [];
  for (const dir of dirs.sort()) {
    const inside = inScope.filter((t) => (dir ? t.path.startsWith(`${dir}/`) : true));
    entries.push({
      kind: "dir",
      path: dir,
      name: toSkillName(dir.split("/").pop() ?? repo),
      fileCount: inside.length,
      totalBytes: inside.reduce((n, t) => n + (t.size ?? 0), 0),
    });
  }

  // Loose markdown under skills/ or commands/ that no skill folder already claims.
  for (const t of inScope) {
    if (!/\.md$/i.test(t.path)) continue;
    const file = t.path.split("/").pop() ?? "";
    if (/^(skill|readme)\.md$/i.test(file)) continue;
    if (!/(^|\/)(skills|commands)\//i.test(t.path)) continue;
    if (dirs.some((d) => d && t.path.startsWith(`${d}/`))) continue;
    entries.push({ kind: "file", path: t.path, name: toSkillName(file), fileCount: 1, totalBytes: t.size ?? 0 });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return { branch: ref, entries };
}

/** Fetch one file's raw text (single-file imports). */
export async function fetchRepoFile(owner: string, repo: string, branch: string, path: string, token?: string): Promise<string> {
  assertRef(owner, repo, branch);
  assertPath(path, true);
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  const r = await fetch(url, { headers: token ? { "User-Agent": "agent-sandbox-dashboard", Authorization: `Bearer ${token}` } : { "User-Agent": "agent-sandbox-dashboard" } });
  if (!r.ok) throw new Error(`Could not fetch ${path} (${r.status}).`);
  const text = await r.text();
  if (text.length > 512_000) throw new Error(`${path} is too large to import.`);
  return text;
}

/** One blob's text via the git blobs API — works for private repos with the same token. */
async function fetchRepoBlob(owner: string, repo: string, sha: string, token?: string): Promise<string> {
  const b = await gh<{ content: string; encoding: string }>(`/repos/${owner}/${repo}/git/blobs/${sha}`, token);
  if (b.encoding !== "base64") throw new Error(`Unexpected blob encoding "${b.encoding}".`);
  return Buffer.from(b.content, "base64").toString("utf8");
}

/**
 * Fetch a whole skill folder: the SKILL.md plus every supporting file, straight off the tree we
 * re-walk here (never trusting client-supplied shas). Oversized, binary, or unrepresentable files
 * are skipped and reported, not fatal — the import should carry what it can.
 */
export async function fetchRepoSkillDir(
  owner: string,
  repo: string,
  branch: string,
  dirPath: string,
  token?: string
): Promise<{ skillMd: string; files: SkillFile[]; skipped: string[] }> {
  assertRef(owner, repo, branch);
  if (dirPath) assertPath(dirPath, false);
  const { blobs } = await repoTree(owner, repo, branch, token);
  const inside = blobs.filter((t) => (dirPath ? t.path.startsWith(`${dirPath}/`) : true));
  const skillMd = inside.find((t) => /^skill\.md$/i.test(t.path.slice(dirPath ? dirPath.length + 1 : 0)));
  if (!skillMd) throw new Error(`No SKILL.md under ${dirPath || "the repository root"}.`);

  const rel = (p: string) => (dirPath ? p.slice(dirPath.length + 1) : p);
  const skipped: string[] = [];
  const wanted: TreeBlob[] = [];
  let total = skillMd.size ?? 0;
  for (const t of inside) {
    if (t === skillMd) continue;
    const r = rel(t.path);
    if ((t.size ?? 0) > SKILL_LIMITS.maxFileBytes) {
      skipped.push(`${r} (too large)`);
      continue;
    }
    try {
      validateSkillFilePath(r);
    } catch {
      skipped.push(`${r} (unsupported path)`);
      continue;
    }
    if (wanted.length >= SKILL_LIMITS.maxFiles || total + (t.size ?? 0) > SKILL_LIMITS.maxSkillBytes) {
      skipped.push(`${r} (skill size limit)`);
      continue;
    }
    total += t.size ?? 0;
    wanted.push(t);
  }

  // Fetch with bounded concurrency — a big skill is ~100 small blobs.
  const files: SkillFile[] = [];
  const queue = [...wanted];
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (let t = queue.shift(); t; t = queue.shift()) {
        const content = await fetchRepoBlob(owner, repo, t.sha, token);
        if (content.includes("\0")) skipped.push(`${rel(t.path)} (binary)`);
        else files.push({ path: rel(t.path), content });
      }
    })
  );
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { skillMd: await fetchRepoBlob(owner, repo, skillMd.sha, token), files, skipped };
}

/**
 * Fetch a harness folder (src/harness.ts): the files the harness format reads under `dirPath`, off
 * the tree we re-walk here. Unlike skill folders nothing is silently skipped for size — an
 * oversized harness is refused, so the review panel always shows the whole thing. hooks/ is not
 * fetched at all (imported bundles never install hooks).
 */
export async function fetchRepoHarnessDir(
  owner: string,
  repo: string,
  branch: string | undefined,
  dirPath: string,
  limits: { maxFiles: number; maxBytes: number; maxFileBytes: number },
  token?: string
): Promise<{ ref: string; files: Array<{ path: string; content: string }>; skipped: string[] }> {
  assertRef(owner, repo, branch);
  const dir = dirPath.replace(/^\/+|\/+$/g, "");
  if (dir) assertPath(dir, false);
  const { ref, blobs } = await repoTree(owner, repo, branch, token);
  const rel = (p: string) => (dir ? p.slice(dir.length + 1) : p);
  const inside = blobs.filter((t) => (dir ? t.path.startsWith(`${dir}/`) : true));
  if (!inside.some((t) => rel(t.path) === "harness.json")) throw new Error(`No harness.json under ${dir || "the repository root"}.`);
  const skipped: string[] = [];
  const wanted = inside.filter((t) => {
    const r = rel(t.path);
    if (/^hooks\//i.test(r)) {
      skipped.push(`${r} (hooks are never imported)`);
      return false;
    }
    // Only what the harness format reads; anything else (CI config, images) is not fetched.
    return /^(harness\.json|rules\.md|verify\.sh|skills\/.+)$/i.test(r);
  });
  if (wanted.length > limits.maxFiles) throw new Error(`The harness folder has too many files (max ${limits.maxFiles}).`);
  let total = 0;
  for (const t of wanted) {
    if ((t.size ?? 0) > limits.maxFileBytes) throw new Error(`${rel(t.path)} is too large to import.`);
    total += t.size ?? 0;
  }
  if (total > limits.maxBytes) throw new Error("The harness folder is too large to import.");
  const files: Array<{ path: string; content: string }> = [];
  const queue = [...wanted];
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (let t = queue.shift(); t; t = queue.shift()) {
        const content = await fetchRepoBlob(owner, repo, t.sha, token);
        if (content.includes("\0")) skipped.push(`${rel(t.path)} (binary)`);
        else files.push({ path: rel(t.path), content });
      }
    })
  );
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { ref, files, skipped };
}
