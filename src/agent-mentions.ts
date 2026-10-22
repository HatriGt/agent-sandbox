import type { Db } from "./db.js";
import type { FollowupEngine } from "./pr-followup-engine.js";
import { addressedToAgent } from "./pr-followups.js";
import { mentionsSourceId } from "./pr-followup-store.js";
import { backoffUntil, GhRateLimitError, type RateInfo } from "./repo-watch.js";
import { claimDelivery, logDelivery } from "./trigger-store.js";

/**
 * `/agent …` on ANY pull request, without a webhook: the controller asks GitHub, as each stored
 * account, which issues and PRs that account can see were updated since the last look
 * (`GET /issues?filter=all&since=…`, every repo the token reaches, private ones included), reads
 * the new comments on each updated PR, and hands every comment addressed to the agent to the
 * follow-up engine as if it were an `issue_comment` delivery. The engine adopts the PR, runs the
 * request on its branch and replies on the PR.
 *
 * Why not the activity feed (`/users/{login}/events`)? It is best effort: events show up late,
 * vanish again, and their ids are not one sequence. The issues list is the same consistent read
 * the GitHub UI does. Anyone whose comment the account can read arrives this way (the engine
 * still only obeys trusted commenters), not just the account's own comments.
 *
 * Every read is conditional (ETag; a 304 is free against the rate limit) and honours GitHub's
 * `X-Poll-Interval` when sent. Watching starts with a baseline — nothing written before the
 * controller started watching is replayed — and later reads act only on what changed since the
 * last look, so a short controller outage loses nothing while a cursor left unused for longer
 * than STALE_MS starts over. Each comment is acted on once (a delivery claim by comment id),
 * whichever path delivers it first.
 */

export interface MentionAnswer {
  notModified: boolean;
  data?: unknown;
  etag?: string;
  rate?: RateInfo;
  /** GitHub's `X-Poll-Interval` (seconds), when the endpoint sends one. */
  pollInterval?: number;
}

export interface MentionDeps {
  db: Db;
  engine: Pick<FollowupEngine, "handle">;
  /** Every GitHub account the controller holds a token for, with the owner it belongs to. */
  accounts(): Promise<Array<{ owner: string; login: string }>>;
  /** One conditional GitHub read as `login` (its own token). Throws GhRateLimitError on 403/429. */
  get(owner: string, login: string, path: string, etag?: string): Promise<MentionAnswer>;
  /** The owner's "Answer /agent on any PR" setting. */
  enabled(owner: string): boolean;
  log?(m: string): void;
  now?(): number;
}

interface GhIssue {
  number: number;
  updated_at?: string;
  pull_request?: unknown;
  repository?: { full_name?: string; name?: string; owner?: { login?: string }; html_url?: string };
  repository_url?: string;
  [k: string]: unknown;
}

interface GhComment {
  id: number;
  body?: string;
  created_at?: string;
  user?: { login?: string; type?: string };
  author_association?: string;
  [k: string]: unknown;
}

interface FeedState {
  /** ISO time of the newest update seen; the next read asks for changes since then. */
  since: string;
}

const SOURCE = "events";
/** A cursor not used for this long is re-baselined rather than replayed. */
const STALE_MS = 24 * 3600_000;
/** Comments older than this are never acted on, whatever the list says. */
const MAX_AGE_MS = 24 * 3600_000;
const DEFAULT_POLL_S = 60;
/** Pages of the updated-issues list read per poll; more than this in one interval is a storm, not a backlog. */
const MAX_PAGES = 3;

const repoOf = (i: GhIssue): string => {
  if (i.repository?.full_name) return String(i.repository.full_name);
  const m = /\/repos\/([^/]+\/[^/]+)$/.exec(String(i.repository_url ?? ""));
  return m?.[1] ?? "";
};
const t = (iso: string | undefined): number => (iso ? Date.parse(iso) || 0 : 0);

/** The webhook-shaped `issue_comment` payload the engine classifies, from one listed PR and one of its comments. */
export function payloadOf(issue: GhIssue, comment: GhComment): Record<string, unknown> {
  const repo = repoOf(issue);
  const [owner, name] = repo.split("/");
  return {
    action: "created",
    repository: { full_name: repo, name: name ?? "", owner: { login: owner ?? "" }, html_url: `https://github.com/${repo}` },
    sender: { login: String(comment.user?.login ?? ""), type: comment.user?.type ?? "User" },
    issue,
    comment,
  };
}

/** Is this comment on a PR addressed to the agent? (Everything else in the list is noise.) */
export function isAgentCommand(issue: GhIssue, comment: GhComment): boolean {
  if (!issue.pull_request) return false;
  return addressedToAgent(String(comment.body ?? ""));
}

export function makeMentionWatcher(d: MentionDeps) {
  const now = () => (d.now ? d.now() : Date.now());
  const log = (m: string) => (d.log ? d.log(m) : console.error(m));
  /** Per login: the earliest next read (poll interval, or a rate-limit pause). */
  const nextAt = new Map<string, number>();
  const lastError = new Map<string, string>();
  let ticking = false;

  const feedKey = (login: string) => `@${login.toLowerCase()}`;
  const load = (owner: string, login: string) => {
    const r = d.db.prepare(`SELECT etag, state_json, updated_at FROM repo_watch WHERE owner = ? AND repo = ? AND source = ?`).get(owner, feedKey(login), SOURCE) as
      | { etag: string | null; state_json: string | null; updated_at: number }
      | undefined;
    if (!r || now() - r.updated_at >= STALE_MS) return undefined;
    let state: FeedState | undefined;
    try {
      state = r.state_json ? (JSON.parse(r.state_json) as FeedState) : undefined;
    } catch {
      state = undefined;
    }
    // A row from an earlier version (the activity-feed poller) is not a usable cursor: start over.
    if (!state || typeof state.since !== "string" || !t(state.since)) return undefined;
    return { etag: r.etag ?? undefined, state };
  };
  const touch = (owner: string, login: string) => d.db.prepare(`UPDATE repo_watch SET updated_at = ? WHERE owner = ? AND repo = ? AND source = ?`).run(now(), owner, feedKey(login), SOURCE);
  const store = (owner: string, login: string, etag: string | undefined, state: FeedState) =>
    d.db
      .prepare(
        `INSERT INTO repo_watch (owner, repo, source, etag, state_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(owner, repo, source) DO UPDATE SET etag = excluded.etag, state_json = excluded.state_json, updated_at = excluded.updated_at`
      )
      .run(owner, feedKey(login), SOURCE, etag ?? null, JSON.stringify(state), now());

  const listPath = (since: string, page: number) =>
    `/issues?filter=all&state=all&since=${encodeURIComponent(since)}&sort=updated&direction=desc&per_page=100${page > 1 ? `&page=${page}` : ""}`;

  async function pollFeed(owner: string, login: string): Promise<number> {
    const row = load(owner, login);
    if (!row) {
      // First look (or a stale cursor): a baseline, nothing replayed, no request.
      store(owner, login, undefined, { since: new Date(now()).toISOString() });
      nextAt.set(login, now() + DEFAULT_POLL_S * 1000);
      return 0;
    }
    const since = row.state.since;
    const issues: GhIssue[] = [];
    let etag: string | undefined;
    for (let page = 1; page <= MAX_PAGES; page++) {
      let r: MentionAnswer;
      try {
        r = await d.get(owner, login, listPath(since, page), page === 1 ? row.etag : undefined);
      } catch (e) {
        if (e instanceof GhRateLimitError) nextAt.set(login, backoffUntil(e.rate, e.status, now()) ?? now() + 60_000);
        throw e;
      }
      if (page === 1) {
        const pause = backoffUntil(r.rate, undefined, now());
        nextAt.set(login, Math.max(pause ?? 0, now() + (r.pollInterval && r.pollInterval > 0 ? r.pollInterval : DEFAULT_POLL_S) * 1000));
        if (r.notModified) {
          touch(owner, login);
          return 0;
        }
        etag = r.etag;
      }
      const batch = (Array.isArray(r.data) ? r.data : []) as GhIssue[];
      issues.push(...batch);
      if (batch.length < 100) break;
    }
    // Move the cursor before acting: a crash mid-way never replays the batch.
    const newest = issues.reduce((m, i) => Math.max(m, t(i.updated_at)), t(since));
    store(owner, login, etag, { since: new Date(newest).toISOString() });

    let fired = 0;
    const source = mentionsSourceId(owner);
    const prs = issues.filter((i) => i.pull_request && repoOf(i) && Number.isFinite(Number(i.number))).sort((a, b) => t(a.updated_at) - t(b.updated_at));
    for (const issue of prs) {
      const repo = repoOf(issue);
      const tag = `${repo}#${issue.number}`;
      let comments: GhComment[];
      try {
        const r = await d.get(owner, login, `/repos/${repo}/issues/${Number(issue.number)}/comments?since=${encodeURIComponent(since)}&per_page=100`);
        comments = (Array.isArray(r.data) ? r.data : []) as GhComment[];
      } catch (e) {
        if (e instanceof GhRateLimitError) {
          nextAt.set(login, backoffUntil(e.rate, e.status, now()) ?? now() + 60_000);
          throw e;
        }
        log(`[mentions] @${login}: reading comments on ${tag} failed: ${(e as Error).message.slice(0, 200)}`);
        continue;
      }
      for (const c of comments.sort((a, b) => t(a.created_at) - t(b.created_at))) {
        if (!isAgentCommand(issue, c)) continue;
        // `since` on the comments list is by last edit: an old comment edited now is not a new ask.
        if (c.created_at && (t(c.created_at) < t(since) || now() - t(c.created_at) >= MAX_AGE_MS)) continue;
        if (!claimDelivery(d.db, source, [`comment:${c.id}`], now())) continue;
        try {
          const res = await d.engine.handle({ id: source, owner }, "issue_comment", payloadOf(issue, c), { adopt: true });
          if (!res.handled) logDelivery(d.db, source, { at: now(), outcome: "skipped", reason: "ignored", detail: `/agent on ${tag}: ${res.reason}`.slice(0, 300) });
          else if (res.outcome === "fired") fired++;
        } catch (err) {
          logDelivery(d.db, source, { at: now(), outcome: "failed", reason: "error", detail: `/agent on ${tag}: ${(err as Error).message.slice(0, 200)}` });
        }
      }
    }
    return fired;
  }

  /** Look for every watched account that is due. Re-entrancy guarded: a slow GitHub never stacks polls. */
  async function tick(): Promise<void> {
    if (ticking) return;
    ticking = true;
    try {
      let accounts: Array<{ owner: string; login: string }> = [];
      try {
        accounts = await d.accounts();
      } catch (e) {
        log(`[mentions] listing accounts failed: ${(e as Error).message.slice(0, 200)}`);
      }
      for (const a of accounts) {
        if (!d.enabled(a.owner)) continue;
        if ((nextAt.get(a.login) ?? 0) > now()) continue;
        const k = `${a.owner}\u0000${a.login}`;
        try {
          await pollFeed(a.owner, a.login);
          lastError.delete(k);
        } catch (e) {
          const msg = (e as Error).message.slice(0, 200);
          // Log a failing account once per distinct error, not every tick.
          if (lastError.get(k) !== msg) log(`[mentions] @${a.login} (${a.owner}): ${msg}`);
          lastError.set(k, msg);
        }
      }
    } finally {
      ticking = false;
    }
  }

  function start(intervalMs = 20_000): { stop: () => void } {
    const timer = setInterval(() => void tick(), intervalMs);
    if (typeof timer.unref === "function") timer.unref();
    return { stop: () => clearInterval(timer) };
  }

  return { tick, start, pollFeed };
}

export type MentionWatcher = ReturnType<typeof makeMentionWatcher>;
