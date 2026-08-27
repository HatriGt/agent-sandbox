/**
 * Source-control operations the workspace pane offers on a cloned repo inside a sandbox: status
 * (branch, upstream, ahead/behind, last commit), commit-all, and push. Everything runs as the box's
 * own git identity (set at setup) through one `msb exec`; outputs are shaped here so the UI never
 * parses git. Pure parsers are exported for tests; IO at the bottom.
 */
import type { Config } from "./config.js";
import { exec } from "./msb.js";
import { shellQuote } from "./exec.js";

export interface GitStatus {
  repo: string;
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  /** `<short sha> <subject>` of HEAD, if any commit exists. */
  lastCommit?: string;
  /** Working tree has no changes (staged, unstaged or untracked). */
  clean: boolean;
  changed: number;
}

const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
export function assertRepoName(repo: string): string {
  if (!REPO_RE.test(repo)) throw new Error("invalid repo name");
  return repo;
}

/** Parse `git status -sb --porcelain=v1` (first line `## branch...upstream [ahead 1, behind 2]`) + a log line. */
export function parseStatus(repo: string, statusOut: string, logOut: string): GitStatus {
  const lines = statusOut.split("\n").filter((l) => l.length > 0);
  const head = lines[0]?.startsWith("## ") ? lines[0].slice(3) : "";
  let branch = head, upstream: string | undefined, ahead = 0, behind = 0;
  const m = /^(.+?)(?:\.\.\.(\S+))?(?: \[(.*)\])?$/.exec(head);
  if (m) {
    branch = m[1].replace(/^No commits yet on /, "");
    upstream = m[2];
    const flags = m[3] ?? "";
    ahead = Number(/ahead (\d+)/.exec(flags)?.[1] ?? 0);
    behind = Number(/behind (\d+)/.exec(flags)?.[1] ?? 0);
  }
  const changed = lines.length - (lines[0]?.startsWith("## ") ? 1 : 0);
  const lastCommit = logOut.trim() || undefined;
  return { repo, branch: branch.replace(/^HEAD \(no branch\)$/, "HEAD (detached)"), upstream, ahead, behind, lastCommit, clean: changed === 0, changed };
}

function inRepo(repo: string, sh: string): string {
  return `cd /workspace/${shellQuote(repo)} 2>/dev/null || { echo "@@NOREPO"; exit 0; }; ${sh}`;
}

export async function gitStatus(cfg: Config, box: string, repo: string): Promise<GitStatus> {
  assertRepoName(repo);
  const r = await exec(cfg, box, inRepo(repo, `git status -sb --porcelain=v1 2>&1; echo "@@LOG"; git log -1 --format='%h %s' 2>/dev/null`));
  if (r.stdout.startsWith("@@NOREPO")) throw new Error(`no repository at /workspace/${repo}`);
  const [status, log = ""] = r.stdout.split("@@LOG");
  return parseStatus(repo, status, log);
}

export async function gitCommitAll(cfg: Config, box: string, repo: string, message: string): Promise<{ sha: string; summary: string }> {
  assertRepoName(repo);
  const msg = message.trim();
  if (!msg) throw new Error("a commit message is required");
  if (msg.length > 2000) throw new Error("commit message too long");
  const r = await exec(cfg, box, inRepo(repo, `git add -A && git commit -q -m ${shellQuote(msg)} 2>&1 && git log -1 --format='%h%n%s' 2>/dev/null`));
  if (r.stdout.startsWith("@@NOREPO")) throw new Error(`no repository at /workspace/${repo}`);
  const lines = r.stdout.trim().split("\n");
  const sha = lines[lines.length - 2] ?? "";
  if (!/^[0-9a-f]{6,}$/.test(sha)) throw new Error(r.stdout.trim().slice(-400) || "nothing to commit");
  return { sha, summary: lines[lines.length - 1] ?? msg };
}

export async function gitPush(cfg: Config, box: string, repo: string): Promise<{ output: string }> {
  assertRepoName(repo);
  const r = await exec(cfg, box, inRepo(repo, `git push -u origin HEAD 2>&1 | tail -n 12`));
  if (r.stdout.startsWith("@@NOREPO")) throw new Error(`no repository at /workspace/${repo}`);
  return { output: r.stdout.trim() };
}
