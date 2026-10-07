import type { Db } from "./db.js";
import type { Dispatcher } from "./trigger-dispatch.js";
import type { TriggerSpec, WatchEvent } from "./triggers.js";
import { claimDelivery, savePayload, watchTriggers, type TriggerRow } from "./trigger-store.js";

/**
 * Repo activity without a webhook: the controller polls GitHub as the automation's owner and turns
 * what changed into events (the way Claude desktop keeps its PR chips current). Every request is
 * conditional (If-None-Match), and GitHub does not count a 304 against the rate limit, so a short
 * interval is cheap. Automations watching the same repo for the same owner share one set of
 * requests and one persisted snapshot (`repo_watch`).
 *
 * The first poll of a source only records a baseline: nothing that happened before an automation
 * was saved is replayed. Each fire is claimed in `trigger_deliveries` with a stable key, so a
 * restart between "noticed" and "recorded" cannot fire the same change twice.
 */

export type WatchGet = (owner: string, repo: string, path: string, etag?: string) => Promise<{ notModified: true } | { notModified: false; data: unknown; etag?: string; login: string }>;

export interface WatchDeps {
  db: Db;
  dispatcher: Pick<Dispatcher, "fire">;
  get: WatchGet;
  redact(s: string): string;
  log?(m: string): void;
  now?(): number;
}

export interface WatchHit {
  event: WatchEvent;
  /** Stable per change: the dedupe key. */
  key: string;
  payload: Record<string, unknown>;
  subject?: { kind: "issue" | "pr"; number: number };
  fork?: boolean;
  branch?: string;
  label?: string;
  comment?: { body: string; author: string; bot: boolean };
}

/* The slices of GitHub's REST shapes the diffs read. Everything else rides along untyped in the payload. */
interface GhUser {
  login?: string;
  type?: string;
}
interface GhPr {
  number: number;
  state: string;
  draft?: boolean;
  merged_at?: string | null;
  closed_at?: string | null;
  created_at: string;
  updated_at: string;
  user?: GhUser;
  head?: { sha?: string; ref?: string; repo?: { full_name?: string } | null };
  base?: { ref?: string; repo?: { full_name?: string } };
}
interface GhIssue {
  number: number;
  state: string;
  pull_request?: unknown;
  labels?: Array<string | { name?: string }>;
  closed_at?: string | null;
  created_at: string;
  updated_at: string;
  user?: GhUser;
}
interface GhComment {
  id: number;
  body?: string;
  html_url?: string;
  issue_url?: string;
  user?: GhUser;
}
interface GhCommit {
  sha?: string;
  commit?: Record<string, unknown>;
  author?: GhUser | null;
}
interface GhRun {
  id: number;
  run_attempt?: number;
  status?: string;
  conclusion?: string | null;
  updated_at: string;
  head_branch?: string;
  pull_requests?: Array<{ number: number }>;
  actor?: GhUser;
}
interface GhRelease {
  id: number;
  draft?: boolean;
  published_at?: string | null;
  author?: GhUser;
}
interface GhRepo {
  full_name?: string;
  name?: string;
  html_url?: string;
  default_branch?: string;
  private?: boolean;
  owner?: GhUser;
}
type RepoInfo = Pick<GhRepo, "full_name" | "name" | "html_url" | "default_branch" | "private"> & { owner: { login?: string }; login: string };

const MAX_TRACKED = 300;
const RECEIPT_MARK = "Agent Sandbox receipt";
const STALE_MS = 120_000;

/* ───────────────────────────── diffing (pure) ───────────────────────────── */

interface PrSnap {
  s: string;
  m: boolean;
  d: boolean;
  h: string;
}
export interface PullsState {
  since: number;
  prs: Record<string, PrSnap>;
}

/** Newest-updated PR list → events against the previous snapshot. */
export function diffPulls(prev: PullsState | undefined, items: GhPr[], now: number): { state: PullsState; hits: WatchHit[] } {
  const prs: Record<string, PrSnap> = { ...(prev?.prs ?? {}) };
  const hits: WatchHit[] = [];
  const since = prev?.since ?? now;
  for (const pr of items) {
    const n = Number(pr.number);
    const cur: PrSnap = { s: String(pr.state), m: !!pr.merged_at, d: !!pr.draft, h: String(pr.head?.sha ?? "") };
    const old = prs[n];
    prs[n] = cur;
    if (!prev) continue;
    const hit = (event: WatchEvent, key: string) =>
      hits.push({
        event,
        key: `pr:${n}:${key}`,
        payload: { action: event.slice(3), pull_request: pr, sender: pr.user },
        subject: { kind: "pr", number: n },
        fork: String(pr.head?.repo?.full_name ?? "").toLowerCase() !== String(pr.base?.repo?.full_name ?? "").toLowerCase(),
        branch: String(pr.base?.ref ?? ""),
      });
    if (!old) {
      // Not seen before: only a PR created since watching started is "opened" (an old PR that just
      // scrolled into the window is not). A draft announces itself with pr_ready later.
      if (Date.parse(pr.created_at) >= since && cur.s === "open" && !cur.d) hit("pr_opened", "opened");
      continue;
    }
    if (old.s === "open" && cur.s === "closed") hit(cur.m ? "pr_merged" : "pr_closed", cur.m ? "merged" : `closed:${pr.closed_at}`);
    else if (old.s === "closed" && cur.s === "open") hit("pr_reopened", `reopened:${pr.updated_at}`);
    else if (cur.s === "open") {
      if (old.d && !cur.d) hit("pr_ready", `ready:${pr.updated_at}`);
      else if (old.h && cur.h && old.h !== cur.h && !cur.d) hit("pr_pushed", `push:${cur.h}`);
    }
  }
  return { state: { since, prs: trim(prs) }, hits };
}

interface IssueSnap {
  s: string;
  l: string[];
}
export interface IssuesState {
  since: number;
  issues: Record<string, IssueSnap>;
}

/** Issue list (PRs filtered out) → opened / closed / reopened / labelled. */
export function diffIssues(prev: IssuesState | undefined, items: GhIssue[], now: number): { state: IssuesState; hits: WatchHit[] } {
  const issues: Record<string, IssueSnap> = { ...(prev?.issues ?? {}) };
  const hits: WatchHit[] = [];
  const since = prev?.since ?? now;
  for (const it of items) {
    if (it.pull_request) continue;
    const n = Number(it.number);
    const labels: string[] = Array.isArray(it.labels) ? it.labels.map((l) => String(typeof l === "string" ? l : l.name)) : [];
    const cur: IssueSnap = { s: String(it.state), l: labels };
    const old = issues[n];
    issues[n] = cur;
    if (!prev) continue;
    const hit = (event: WatchEvent, key: string, extra: Partial<WatchHit> = {}) =>
      hits.push({ event, key: `issue:${n}:${key}`, payload: { action: event.slice(6), issue: it, sender: it.user, ...extra.payload }, subject: { kind: "issue", number: n }, ...extra });
    const isNew = !old && Date.parse(it.created_at) >= since;
    if (!old && !isNew) continue;
    if (isNew && cur.s === "open") hit("issue_opened", "opened");
    if (old && old.s === "open" && cur.s === "closed") hit("issue_closed", `closed:${it.closed_at}`);
    if (old && old.s === "closed" && cur.s === "open") hit("issue_reopened", `reopened:${it.updated_at}`);
    for (const name of labels) {
      if (old?.l.includes(name)) continue;
      hit("issue_labeled", `label:${name}:${it.updated_at}`, { label: name, payload: { action: "labeled", issue: it, sender: it.user, label: { name } } });
    }
  }
  return { state: { since, issues: trim(issues) }, hits };
}

export interface CommentsState {
  maxId: number;
}

/** Newest issue + PR conversation comments → one hit per comment id above the high-water mark. */
export function diffComments(prev: CommentsState | undefined, items: GhComment[]): { state: CommentsState; hits: WatchHit[] } {
  const maxId = Math.max(prev?.maxId ?? 0, ...items.map((c) => Number(c.id) || 0));
  if (!prev) return { state: { maxId }, hits: [] };
  const hits: WatchHit[] = [];
  for (const c of [...items].sort((a, b) => Number(a.id) - Number(b.id))) {
    if (Number(c.id) <= prev.maxId) continue;
    const url = String(c.html_url ?? "");
    const n = Number(String(c.issue_url ?? "").split("/").pop());
    const isPr = /\/pull\/\d+/.test(url);
    const issueUrl = url.replace(/#.*$/, "");
    const issue: Record<string, unknown> = { number: n, html_url: issueUrl, ...(isPr ? { pull_request: { html_url: issueUrl } } : {}) };
    hits.push({
      event: "comment_created",
      key: `comment:${c.id}`,
      payload: { action: "created", comment: c, issue, sender: c.user },
      ...(Number.isFinite(n) && n > 0 ? { subject: { kind: isPr ? "pr" : "issue", number: n } } : {}),
      comment: { body: String(c.body ?? ""), author: String(c.user?.login ?? ""), bot: c.user?.type === "Bot" },
    });
  }
  return { state: { maxId }, hits };
}

export interface PushState {
  sha: string;
}

/** Latest commit on a branch → push when it moved. */
export function diffPush(prev: PushState | undefined, branch: string, commits: GhCommit[]): { state: PushState | undefined; hits: WatchHit[] } {
  const head = commits[0];
  if (!head?.sha) return { state: prev, hits: [] };
  const state = { sha: String(head.sha) };
  if (!prev || prev.sha === state.sha) return { state, hits: [] };
  return {
    state,
    hits: [{ event: "push", key: `push:${branch}:${state.sha}`, branch, payload: { ref: `refs/heads/${branch}`, before: prev.sha, after: state.sha, head_commit: head.commit ? { ...head.commit, id: head.sha } : head, sender: head.author } }],
  };
}

export interface IdsState {
  since: number;
  seen: number[];
}

const FAILED = new Set(["failure", "timed_out", "startup_failure"]);

/** Completed workflow runs → failed / succeeded, once per run attempt. */
export function diffRuns(prev: IdsState | undefined, runs: GhRun[], now: number): { state: IdsState; hits: WatchHit[] } {
  const since = prev?.since ?? now;
  const seen = new Set(prev?.seen ?? []);
  const hits: WatchHit[] = [];
  for (const r of runs) {
    if (r.status !== "completed") continue;
    const id = Number(r.id) * 100 + Number(r.run_attempt ?? 1);
    if (seen.has(id)) continue;
    seen.add(id);
    if (!prev || Date.parse(r.updated_at) < since) continue;
    const event: WatchEvent | undefined = FAILED.has(r.conclusion ?? "") ? "run_failed" : r.conclusion === "success" ? "run_succeeded" : undefined;
    if (!event) continue;
    const pr = Array.isArray(r.pull_requests) && r.pull_requests[0] ? Number(r.pull_requests[0].number) : undefined;
    hits.push({ event, key: `run:${id}`, branch: String(r.head_branch ?? ""), payload: { action: "completed", workflow_run: r, sender: r.actor }, ...(pr ? { subject: { kind: "pr", number: pr } } : {}) });
  }
  return { state: { since, seen: [...seen].slice(-MAX_TRACKED) }, hits };
}

/** Published releases (not drafts) → release_published. */
export function diffReleases(prev: IdsState | undefined, releases: GhRelease[], now: number): { state: IdsState; hits: WatchHit[] } {
  const since = prev?.since ?? now;
  const seen = new Set(prev?.seen ?? []);
  const hits: WatchHit[] = [];
  for (const r of releases) {
    if (r.draft || !r.published_at) continue;
    const id = Number(r.id);
    if (seen.has(id)) continue;
    seen.add(id);
    if (prev && Date.parse(r.published_at) >= since) hits.push({ event: "release_published", key: `release:${id}`, payload: { action: "published", release: r, sender: r.author } });
  }
  return { state: { since, seen: [...seen].slice(-MAX_TRACKED) }, hits };
}

function trim<T>(m: Record<string, T>): Record<string, T> {
  const keys = Object.keys(m);
  if (keys.length <= MAX_TRACKED) return m;
  const keep = keys.map(Number).sort((a, b) => b - a).slice(0, MAX_TRACKED);
  return Object.fromEntries(keep.map((k) => [k, m[k]]));
}

/**
 * Does this hit fire this automation? `login` is the GitHub account the watch reads as: comments it
 * wrote (the agent's own review, the receipt) never fire a comment automation without a command
 * prefix, so an automation cannot feed itself.
 */
export function watchMatches(spec: TriggerSpec, hit: WatchHit, login: string, defaultBranch: string): { ok: true } | { ok: false; reason: string } {
  if (!spec.watch?.includes(hit.event)) return { ok: false, reason: `not watching ${hit.event}` };
  if (hit.event.startsWith("pr_") && hit.fork && !spec.allowForks) return { ok: false, reason: "PR is from a fork" };
  if (hit.event === "issue_labeled" && spec.label && spec.label.toLowerCase() !== (hit.label ?? "").toLowerCase()) return { ok: false, reason: `label is not '${spec.label}'` };
  if (hit.event === "push" && hit.branch !== (spec.branch ?? defaultBranch)) return { ok: false, reason: `push to ${hit.branch}` };
  if ((hit.event === "run_failed" || hit.event === "run_succeeded") && spec.branch && hit.branch !== spec.branch) return { ok: false, reason: `run on ${hit.branch}` };
  if (hit.event === "comment_created" && hit.comment) {
    const c = hit.comment;
    if (c.bot) return { ok: false, reason: "comment is from a bot" };
    if (c.body.includes(RECEIPT_MARK)) return { ok: false, reason: "comment is a run receipt" };
    if (spec.command) {
      const body = c.body.trim();
      if (!(body === spec.command || body.startsWith(spec.command + " ") || body.startsWith(spec.command + "\n"))) return { ok: false, reason: `comment does not start with ${spec.command}` };
    } else if (c.author.toLowerCase() === login.toLowerCase()) {
      return { ok: false, reason: "comment written by the watching account" };
    }
  }
  return { ok: true };
}

/* ───────────────────────────── the poller ───────────────────────────── */

type Source = "repo" | "pulls" | "issues" | "comments" | "runs" | "releases" | `push:${string}`;

const SOURCE_OF: Record<WatchEvent, Exclude<Source, "repo" | `push:${string}`> | "push"> = {
  pr_opened: "pulls", pr_pushed: "pulls", pr_ready: "pulls", pr_merged: "pulls", pr_closed: "pulls", pr_reopened: "pulls",
  issue_opened: "issues", issue_closed: "issues", issue_reopened: "issues", issue_labeled: "issues",
  comment_created: "comments", push: "push", run_failed: "runs", run_succeeded: "runs", release_published: "releases",
};

const PATH: Record<Exclude<Source, `push:${string}`>, string> = {
  repo: "",
  pulls: "/pulls?state=all&sort=updated&direction=desc&per_page=50",
  issues: "/issues?state=all&sort=updated&direction=desc&per_page=50",
  comments: "/issues/comments?sort=created&direction=desc&per_page=50",
  runs: "/actions/runs?status=completed&per_page=30",
  releases: "/releases?per_page=10",
};

export function makeRepoWatcher(d: WatchDeps) {
  const now = () => (d.now ? d.now() : Date.now());
  const log = (m: string) => (d.log ? d.log(m) : console.error(m));
  const lastError = new Map<string, string>();
  let ticking = false;

  /**
   * A snapshot older than STALE_MS is a baseline from before a pause (every automation on the repo
   * was off, or the controller was down): diffing against it would replay everything since then, so
   * it is dropped and the next read records a fresh baseline instead.
   */
  const load = (owner: string, repo: string, source: string) => {
    const r = d.db.prepare(`SELECT etag, state_json, updated_at FROM repo_watch WHERE owner = ? AND repo = ? AND source = ?`).get(owner, repo, source) as
      | { etag: string | null; state_json: string | null; updated_at: number }
      | undefined;
    return r && now() - r.updated_at < STALE_MS ? r : undefined;
  };
  const touch = (owner: string, repo: string, source: string) =>
    d.db.prepare(`UPDATE repo_watch SET updated_at = ? WHERE owner = ? AND repo = ? AND source = ?`).run(now(), owner, repo, source);
  const store = (owner: string, repo: string, source: string, etag: string | undefined, state: unknown) =>
    d.db
      .prepare(
        `INSERT INTO repo_watch (owner, repo, source, etag, state_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(owner, repo, source) DO UPDATE SET etag = excluded.etag, state_json = excluded.state_json, updated_at = excluded.updated_at`
      )
      .run(owner, repo, source, etag ?? null, JSON.stringify(state ?? null), now());

  /** One conditional read. `undefined` = unchanged since the last poll. */
  async function read(owner: string, repo: string, source: Source, path: string): Promise<{ data: unknown; etag?: string; login: string; prev: unknown } | undefined> {
    const row = load(owner, repo, source);
    const r = await d.get(owner, repo, `/repos/${repo}${path}`, row?.etag ?? undefined);
    if (r.notModified) {
      touch(owner, repo, source);
      return undefined;
    }
    return { data: r.data, etag: r.etag, login: r.login, prev: row?.state_json ? JSON.parse(row.state_json) : undefined };
  }

  async function pollGroup(owner: string, repo: string, triggers: TriggerRow[]): Promise<void> {
    const events = new Set(triggers.flatMap((t) => t.spec.watch ?? []));
    const repoRow = load(owner, repo, "repo");
    let repoInfo = repoRow?.state_json ? (JSON.parse(repoRow.state_json) as RepoInfo) : undefined;
    let login = repoInfo?.login ?? "";
    const fresh = await read(owner, repo, "repo", PATH.repo);
    if (fresh) {
      const r = fresh.data as GhRepo;
      repoInfo = { full_name: r.full_name, name: r.name, html_url: r.html_url, default_branch: r.default_branch, private: r.private, owner: { login: r.owner?.login }, login: fresh.login };
      login = fresh.login;
      store(owner, repo, "repo", fresh.etag, repoInfo);
    }
    if (!repoInfo) return;
    const defaultBranch = String(repoInfo.default_branch ?? "main");
    const repository = { full_name: repoInfo.full_name, name: repoInfo.name, html_url: repoInfo.html_url, default_branch: defaultBranch, private: repoInfo.private, owner: repoInfo.owner };

    const sources = new Set<Source>();
    for (const e of events) {
      const s = SOURCE_OF[e];
      if (s !== "push") sources.add(s);
    }
    if (events.has("push")) for (const t of triggers) if (t.spec.watch?.includes("push")) sources.add(`push:${t.spec.branch ?? defaultBranch}`);

    const hits: WatchHit[] = [];
    for (const source of sources) {
      const branch = source.startsWith("push:") ? source.slice(5) : "";
      const path = branch ? `/commits?sha=${encodeURIComponent(branch)}&per_page=1` : PATH[source as Exclude<Source, `push:${string}`>];
      const r = await read(owner, repo, source, path);
      if (!r) continue;
      if (r.login) login = r.login;
      const t = now();
      const out =
        source === "pulls" ? diffPulls(r.prev as PullsState | undefined, r.data as GhPr[], t)
        : source === "issues" ? diffIssues(r.prev as IssuesState | undefined, r.data as GhIssue[], t)
        : source === "comments" ? diffComments(r.prev as CommentsState | undefined, r.data as GhComment[])
        : source === "runs" ? diffRuns(r.prev as IdsState | undefined, (r.data as { workflow_runs?: GhRun[] }).workflow_runs ?? [], t)
        : source === "releases" ? diffReleases(r.prev as IdsState | undefined, r.data as GhRelease[], t)
        : diffPush(r.prev as PushState | undefined, branch, r.data as GhCommit[]);
      store(owner, repo, source, r.etag, out.state);
      hits.push(...out.hits);
    }

    for (const hit of hits) {
      const payload = { ...hit.payload, repository, asb_event: hit.event };
      for (const t of triggers) {
        if (!watchMatches(t.spec, hit, login, defaultBranch).ok) continue;
        if (!claimDelivery(d.db, t.id, [`watch:${hit.key}`], now())) continue;
        try {
          savePayload(d.db, t.id, JSON.parse(d.redact(JSON.stringify(payload))));
        } catch {
          /* preview storage is best-effort */
        }
        await d.dispatcher
          .fire(t, { payload, event: hit.event, match: { match: true, ...(hit.subject ? { subject: { ...hit.subject, repo: repoInfo.full_name ?? repo } } : {}) } })
          .catch((e) => log(`[watch] ${t.id} ${hit.event}: ${(e as Error).message.slice(0, 200)}`));
      }
    }
  }

  /** Poll every watched repo once. Re-entrancy guarded: a slow GitHub never stacks polls. */
  async function tick(): Promise<void> {
    if (ticking) return;
    ticking = true;
    try {
      const groups = new Map<string, { repo: string; triggers: TriggerRow[] }>();
      for (const t of watchTriggers(d.db)) {
        for (const repo of t.repos ?? []) {
          const k = `${t.owner}\u0000${repo.toLowerCase()}`;
          const g = groups.get(k) ?? { repo, triggers: [] };
          g.triggers.push(t);
          groups.set(k, g);
        }
      }
      for (const [k, g] of groups) {
        const [owner, repo] = k.split("\u0000");
        try {
          await pollGroup(owner, g.repo, g.triggers);
          lastError.delete(k);
        } catch (e) {
          const msg = (e as Error).message.slice(0, 200);
          // Log a failing repo once per distinct error, not every 15 s.
          if (lastError.get(k) !== msg) log(`[watch] ${repo} (${owner}): ${msg}`);
          lastError.set(k, msg);
        }
      }
    } finally {
      ticking = false;
    }
  }

  function start(intervalMs = 15_000): { stop: () => void } {
    const timer = setInterval(() => void tick(), intervalMs);
    if (typeof timer.unref === "function") timer.unref();
    return { stop: () => clearInterval(timer) };
  }

  return { tick, start };
}
