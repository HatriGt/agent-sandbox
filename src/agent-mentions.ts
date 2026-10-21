import type { Db } from "./db.js";
import type { FollowupEngine } from "./pr-followup-engine.js";
import { addressedToAgent } from "./pr-followups.js";
import { mentionsSourceId } from "./pr-followup-store.js";
import { backoffUntil, GhRateLimitError, type RateInfo } from "./repo-watch.js";
import { claimDelivery, logDelivery } from "./trigger-store.js";

/**
 * `/agent …` on ANY pull request, without a webhook: the controller polls each owner's own GitHub
 * activity feed (`GET /users/{login}/events`, which lists the comments that account wrote across
 * every repo it can see, private ones included when the token is the account's own) and hands each
 * PR comment addressed to the agent to the follow-up engine as if it were an `issue_comment`
 * delivery. The engine adopts the PR, runs the request on its branch and replies on the PR.
 *
 * Only the owner's OWN comments arrive this way (it is their feed): a collaborator's `/agent` on a
 * repo needs the follow-up webhook or an automation. Every read is conditional (ETag; a 304 is free
 * against the rate limit) and honours GitHub's `X-Poll-Interval`. The first read of a feed records
 * a baseline — nothing written before the controller started watching is replayed — and later
 * reads act only on events newer than the last id seen, so a short controller outage loses nothing
 * while a feed left unread for longer than STALE_MS starts over.
 */

export interface MentionAnswer {
  notModified: boolean;
  data?: unknown;
  etag?: string;
  rate?: RateInfo;
  /** GitHub's `X-Poll-Interval` (seconds) for this feed. */
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

interface GhEvent {
  id: string;
  type: string;
  actor?: { login?: string; type?: string };
  repo?: { name?: string };
  payload?: { action?: string; issue?: Record<string, any>; comment?: Record<string, any> };
  created_at?: string;
}

interface FeedState {
  lastId: string;
}

const SOURCE = "events";
/** A feed not read for this long is re-baselined rather than replayed. */
const STALE_MS = 24 * 3600_000;
/** Events older than this are never acted on, whatever the feed says. */
const MAX_AGE_MS = 24 * 3600_000;
const DEFAULT_POLL_S = 60;

const gt = (a: string, b: string): boolean => {
  const x = /^\d+$/.test(a) ? BigInt(a) : 0n;
  const y = /^\d+$/.test(b) ? BigInt(b) : 0n;
  return x > y;
};
const maxId = (events: GhEvent[], from = "0"): string => events.reduce((m, e) => (gt(String(e.id), m) ? String(e.id) : m), from);

/** The webhook-shaped `issue_comment` payload the engine classifies, built from one feed event. */
export function payloadOf(e: GhEvent, login: string): Record<string, unknown> {
  const repo = String(e.repo?.name ?? "");
  const [owner, name] = repo.split("/");
  return {
    action: "created",
    repository: { full_name: repo, name: name ?? "", owner: { login: owner ?? "" }, html_url: `https://github.com/${repo}` },
    sender: { login: String(e.actor?.login ?? login), type: e.actor?.type ?? "User" },
    issue: e.payload?.issue ?? {},
    comment: e.payload?.comment ?? {},
  };
}

/** Is this event a PR comment addressed to the agent? (Everything else in a feed is noise.) */
export function isAgentCommand(e: GhEvent): boolean {
  if (e.type !== "IssueCommentEvent" || e.payload?.action !== "created") return false;
  if (!e.payload.issue?.pull_request) return false;
  return addressedToAgent(String(e.payload.comment?.body ?? ""));
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

  async function pollFeed(owner: string, login: string): Promise<number> {
    const row = load(owner, login);
    let r: MentionAnswer;
    try {
      r = await d.get(owner, login, `/users/${encodeURIComponent(login)}/events?per_page=100`, row?.etag);
    } catch (e) {
      if (e instanceof GhRateLimitError) nextAt.set(login, backoffUntil(e.rate, e.status, now()) ?? now() + 60_000);
      throw e;
    }
    const pause = backoffUntil(r.rate, undefined, now());
    nextAt.set(login, Math.max(pause ?? 0, now() + (r.pollInterval && r.pollInterval > 0 ? r.pollInterval : DEFAULT_POLL_S) * 1000));
    if (r.notModified) {
      touch(owner, login);
      return 0;
    }
    const events = (Array.isArray(r.data) ? r.data : []) as GhEvent[];
    if (!row?.state) {
      // First read (or a stale feed): a baseline, nothing replayed.
      store(owner, login, r.etag, { lastId: maxId(events) });
      return 0;
    }
    const since = row.state.lastId;
    const fresh = events
      .filter((e) => gt(String(e.id), since))
      .filter((e) => !e.created_at || now() - Date.parse(e.created_at) < MAX_AGE_MS)
      .sort((a, b) => (gt(a.id, b.id) ? 1 : gt(b.id, a.id) ? -1 : 0));
    // Record the new high-water mark before acting: a crash mid-way never replays the batch.
    store(owner, login, r.etag, { lastId: maxId(events, since) });
    let fired = 0;
    const source = mentionsSourceId(owner);
    for (const e of fresh) {
      if (!isAgentCommand(e)) continue;
      if (!claimDelivery(d.db, source, [`event:${e.id}`], now())) continue;
      let payload = payloadOf(e, login);
      const comment = payload.comment as Record<string, any>;
      // Older feed shapes omit the commenter's association: read the comment itself, which carries it.
      if (!comment.author_association && comment.id && e.repo?.name) {
        try {
          const full = await d.get(owner, login, `/repos/${e.repo.name}/issues/comments/${Number(comment.id)}`);
          if (!full.notModified && full.data && typeof full.data === "object") payload = { ...payload, comment: { ...comment, ...(full.data as object) } };
        } catch (err) {
          log(`[mentions] ${login}: reading comment ${comment.id} failed: ${(err as Error).message.slice(0, 200)}`);
        }
      }
      const tag = `${e.repo?.name ?? "?"}#${Number((payload.issue as Record<string, any>)?.number) || "?"}`;
      try {
        const res = await d.engine.handle({ id: source, owner }, "issue_comment", payload, { adopt: true });
        if (!res.handled) logDelivery(d.db, source, { at: now(), outcome: "skipped", reason: "ignored", detail: `/agent on ${tag}: ${res.reason}`.slice(0, 300) });
        else if (res.outcome === "fired") fired++;
      } catch (err) {
        logDelivery(d.db, source, { at: now(), outcome: "failed", reason: "error", detail: `/agent on ${tag}: ${(err as Error).message.slice(0, 200)}` });
      }
    }
    return fired;
  }

  /** Read every watched feed that is due. Re-entrancy guarded: a slow GitHub never stacks polls. */
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
          // Log a failing feed once per distinct error, not every tick.
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
