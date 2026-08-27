/**
 * What the agent changed in a sandbox, and how to look at it.
 *
 *   · `listChanges`  — per checked-out repo: `git diff --numstat HEAD` (modified/deleted) plus untracked
 *                      files (`git ls-files --others --exclude-standard`, counted with wc -l), and any
 *                      loose files under /workspace outside a repo (task-only runs). One exec per box.
 *   · `readDiff`     — the unified diff for one path (`git diff HEAD -- path`; an untracked file is
 *                      shown as all-added), for the file pane's Diff tab.
 *   · `fetchPull`    — GitHub PR metadata for the PR card (title, state, +/-, files, branches).
 *
 * All paths are confined to /workspace (same rule as /artifact). Pure parsers are exported for tests.
 */
import type { Config } from "./config.js";
import { exec } from "./msb.js";
import { shellQuote } from "./exec.js";
import { ghGetJson } from "./gh-probe.js";
import { loadStore, pickDefaultAccount, candidateAccounts } from "./gh-token-store.js";

export interface ChangedFile {
  /** Relative to /workspace, e.g. "queue-service/src/retry.ts". */
  path: string;
  repo?: string;
  status: "modified" | "added" | "deleted" | "untracked" | "renamed";
  additions: number;
  deletions: number;
}

const SCRIPT = `cd /workspace 2>/dev/null || exit 0
for g in */.git; do
  [ -d "$g" ] || continue
  r=$(dirname "$g")
  echo "@@repo $r"
  git -C "$r" diff --numstat HEAD 2>/dev/null
  git -C "$r" diff --name-status HEAD 2>/dev/null | sed 's/^/@@status /'
  git -C "$r" ls-files --others --exclude-standard 2>/dev/null | while IFS= read -r f; do
    [ -f "$r/$f" ] || continue
    n=$(wc -l < "$r/$f" 2>/dev/null || echo 0)
    echo "@@untracked $n $f"
  done
done
echo "@@loose"
find . -maxdepth 3 -type f -not -path './*/.git/*' -not -name '.agent.*' -not -path './node_modules/*' 2>/dev/null | while IFS= read -r f; do
  f=\${f#./}
  top=\${f%%/*}
  [ -d "$top/.git" ] && continue
  n=$(wc -l < "$f" 2>/dev/null || echo 0)
  echo "@@loosefile $n $f"
done`;

export function parseChanges(out: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  let repo: string | undefined;
  const statuses = new Map<string, string>();
  for (const raw of out.split("\n")) {
    const line = raw.trimEnd();
    if (!line) continue;
    if (line.startsWith("@@repo ")) {
      repo = line.slice(7).trim();
      continue;
    }
    if (line === "@@loose") {
      repo = undefined;
      continue;
    }
    if (line.startsWith("@@status ")) {
      const [code, ...rest] = line.slice(9).split(/\t/);
      const p = rest[rest.length - 1];
      if (p) statuses.set(`${repo}/${p}`, code.trim()[0]);
      continue;
    }
    if (line.startsWith("@@untracked ")) {
      const m = line.match(/^@@untracked (\d+|-) (.+)$/);
      if (m && repo) files.push({ path: `${repo}/${m[2]}`, repo, status: "untracked", additions: Number(m[1]) || 0, deletions: 0 });
      continue;
    }
    if (line.startsWith("@@loosefile ")) {
      const m = line.match(/^@@loosefile (\d+|-) (.+)$/);
      if (m) files.push({ path: m[2], status: "added", additions: Number(m[1]) || 0, deletions: 0 });
      continue;
    }
    // numstat: "<adds>\t<dels>\t<path>" (binary shows "-")
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (m && repo) {
      const p = m[3].includes(" => ") ? m[3].replace(/^.*\{?([^{}]*) => ([^{}]*)\}?.*$/, (_s, _a, b) => b) : m[3];
      files.push({
        path: `${repo}/${p}`,
        repo,
        status: "modified",
        additions: m[1] === "-" ? 0 : Number(m[1]),
        deletions: m[2] === "-" ? 0 : Number(m[2]),
      });
    }
  }
  for (const f of files) {
    const code = statuses.get(f.path);
    if (code === "D") f.status = "deleted";
    else if (code === "A") f.status = "added";
    else if (code === "R") f.status = "renamed";
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export async function listChanges(cfg: Config, box: string): Promise<ChangedFile[]> {
  const r = await exec(cfg, box, SCRIPT);
  return parseChanges(r.stdout);
}

/** Confine a client path to /workspace; throws on escape attempts. Returns the relative path. */
export function safeRelPath(p: string): string {
  const rel = p.replace(/^\/workspace\/?/, "").replace(/^\/+/, "");
  if (!rel || rel.split("/").some((s) => s === ".." || s === "." || s === "")) throw new Error("invalid path");
  return rel;
}

export interface FileDiff {
  path: string;
  /** Unified diff text ("" when unchanged). */
  diff: string;
  /** For untracked/loose files: the whole file, rendered as added. */
  untracked: boolean;
  binary: boolean;
}

export async function readDiff(cfg: Config, box: string, path: string): Promise<FileDiff> {
  const rel = safeRelPath(path);
  const top = rel.split("/")[0];
  const inner = rel.slice(top.length + 1);
  const q = shellQuote;
  const sh =
    `cd /workspace || exit 0; if [ -d ${q(top)}/.git ] && [ -n ${q(inner)} ]; then ` +
    `if git -C ${q(top)} ls-files --error-unmatch ${q(inner)} >/dev/null 2>&1; then git -C ${q(top)} diff HEAD -- ${q(inner)} | head -c 400000; ` +
    `else echo "@@UNTRACKED"; fi; else echo "@@UNTRACKED"; fi`;
  const r = await exec(cfg, box, sh);
  const out = r.stdout;
  if (out.trim().startsWith("@@UNTRACKED")) return { path: rel, diff: "", untracked: true, binary: false };
  return { path: rel, diff: out, untracked: false, binary: /^Binary files/m.test(out) };
}

export interface PullInfo {
  repo: string;
  number: number;
  title: string;
  state: "open" | "closed" | "merged" | "draft";
  additions: number;
  deletions: number;
  changedFiles: number;
  head: string;
  base: string;
  author?: string;
  url: string;
}

interface GhPull {
  title: string;
  state: string;
  merged_at?: string | null;
  draft?: boolean;
  additions?: number;
  deletions?: number;
  changed_files?: number;
  head?: { ref?: string };
  base?: { ref?: string };
  user?: { login?: string };
  html_url?: string;
}

export function shapePull(repo: string, number: number, p: GhPull): PullInfo {
  return {
    repo,
    number,
    title: p.title,
    state: p.merged_at ? "merged" : p.draft ? "draft" : p.state === "open" ? "open" : "closed",
    additions: p.additions ?? 0,
    deletions: p.deletions ?? 0,
    changedFiles: p.changed_files ?? 0,
    head: p.head?.ref ?? "",
    base: p.base?.ref ?? "",
    author: p.user?.login,
    url: p.html_url ?? `https://github.com/${repo}/pull/${number}`,
  };
}

const pullCache = new Map<string, { at: number; info: PullInfo }>();

export async function fetchPull(cfg: Config, repo: string, number: number): Promise<PullInfo | undefined> {
  const key = `${repo}#${number}`;
  const c = pullCache.get(key);
  if (c && Date.now() - c.at < 60_000) return c.info;
  const store = await loadStore(cfg);
  const accounts = [...candidateAccounts(store, repo), ...(pickDefaultAccount(store) ? [pickDefaultAccount(store)!] : []), ...Object.values(store.accounts)];
  for (const acc of accounts) {
    const p = await ghGetJson<GhPull>(cfg, acc.token, `/repos/${repo}/pulls/${number}`);
    if (p?.title) {
      const info = shapePull(repo, number, p);
      pullCache.set(key, { at: Date.now(), info });
      return info;
    }
  }
  return undefined;
}
