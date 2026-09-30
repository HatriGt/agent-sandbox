import type { Db } from "./db.js";
import type { RunDigest } from "./digest.js";
import type { StartedBy } from "./started-by.js";
import type { DeliveryEntry } from "./trigger-store.js";
import {
  admitFollowup, ciTask, classifyEvent, dedupeKey, enabledFor, excerptLog, FOLLOWUP_EVENTS, FOLLOWUP_MARKER, inlineOf, parseAddressed,
  reviewTask, subjectOf, summaryComment, threadReply, type FollowupPrefs, type ReviewComment, type Signal,
} from "./pr-followups.js";
import {
  agentPrByBranch, attachBox, claimFollowup, dropFollowup, finishFollowup, getAgentPr, guardFacts, recordAgentPrs, setPrBranch, updateFollowup, type AgentPr,
} from "./pr-followup-store.js";

/**
 * The side effects of PR follow-ups (rules: src/pr-followups.ts). Three entry points:
 *   - onArchived: a finished run's opened PRs become "agent PRs" (the only ones ever followed up)
 *   - handle: one GitHub delivery (from an automation's webhook or the owner's follow-up hook)
 *   - onRunFinished: a follow-up finished → reply on the review threads, resolve them, summarise
 * GitHub is reached only through `gh`, which the controller wires to the owner's stored token.
 */

export interface GhRequest {
  method?: "GET" | "POST" | "PATCH";
  path: string;
  body?: unknown;
  /** Return the response text (job logs) instead of JSON. */
  text?: boolean;
}

export interface FollowupStart {
  owner: string;
  pr: AgentPr;
  branch: string;
  task: string;
  startedBy: Extract<StartedBy, { kind: "followup" }>;
}

export interface EngineDeps {
  db: Db;
  gh(owner: string, repo: string, req: GhRequest): Promise<any>;
  startFollowup(input: FollowupStart): Promise<{ ok: true; box: string } | { ok: false; question: string }>;
  prefs(owner: string): FollowupPrefs;
  /** The automation that started the PR's run: its explicit keepGreen/addressReviews win. */
  triggerSpec?(triggerId: string): { keepGreen?: boolean; addressReviews?: boolean } | undefined;
  redact(s: string): string;
  logDelivery?(sourceId: string, e: Omit<DeliveryEntry, "id">): void;
  publicUrl?: string;
  log?(m: string): void;
  now?(): number;
}

export type HandleResult =
  | { handled: false; reason: string }
  | { handled: true; outcome: "fired" | "skipped" | "failed"; reason?: DeliveryEntry["reason"]; detail: string; box?: string };

const MAX_FAILURES = 3;
const MAX_COMMENTS = 30;

export function makeFollowupEngine(d: EngineDeps) {
  const now = () => (d.now ? d.now() : Date.now());
  const log = (m: string) => (d.log ? d.log(m) : console.error(m));
  const runUrl = (box: string) => (d.publicUrl ? `${d.publicUrl.replace(/\/$/, "")}/dashboard/box/${encodeURIComponent(box)}` : undefined);

  function onArchived(r: { box: string; owner: string; digest: RunDigest; archiveId?: number; harnessId?: string }): number {
    const prs = (r.digest as { outcome?: { result?: { prs?: Array<{ repo: string; number: number }> } } }).outcome?.result?.prs ?? [];
    if (!prs.length) return 0;
    const sb = r.digest.provenance?.startedBy;
    return recordAgentPrs(d.db, {
      owner: r.owner,
      box: r.box,
      prs,
      ...(r.harnessId ? { harnessId: r.harnessId } : {}),
      ...(r.digest.provenance?.agent ? { agent: r.digest.provenance.agent } : {}),
      ...(r.digest.provenance?.model ? { model: r.digest.provenance.model } : {}),
      ...(sb?.kind === "trigger" ? { triggerId: sb.triggerId } : sb?.kind === "followup" && sb.triggerId ? { triggerId: sb.triggerId } : {}),
      ...(r.archiveId ? { archiveId: r.archiveId } : {}),
    }, now());
  }

  /** Read a check's log: the Actions job log when there is one, else the check's own output. */
  async function failureOf(owner: string, repo: string, run: Record<string, any>): Promise<{ name: string; conclusion: string; url?: string; excerpt: string }> {
    let text = "";
    try {
      text = String(await d.gh(owner, repo, { path: `/repos/${repo}/actions/jobs/${Number(run.id)}/logs`, text: true }));
    } catch {
      /* not an Actions job, or logs expired: fall back to the check output */
    }
    if (!text.trim()) text = [run.output?.title, run.output?.summary, run.output?.text].filter(Boolean).join("\n\n");
    return {
      name: String(run.name ?? "check"),
      conclusion: String(run.conclusion ?? "failure"),
      ...(run.html_url ? { url: String(run.html_url) } : {}),
      excerpt: d.redact(excerptLog(text)),
    };
  }

  async function ciFailures(owner: string, s: Extract<Signal, { kind: "ci" }>): Promise<Array<{ name: string; conclusion: string; url?: string; excerpt: string }>> {
    const bad = (r: Record<string, any>) => ["failure", "timed_out", "startup_failure"].includes(String(r.conclusion));
    try {
      if (s.check.source === "check_run") {
        const run = await d.gh(owner, s.repo, { path: `/repos/${s.repo}/check-runs/${s.check.id}` });
        return [await failureOf(owner, s.repo, run)];
      }
      if (s.check.source === "check_suite") {
        const r = await d.gh(owner, s.repo, { path: `/repos/${s.repo}/check-suites/${s.check.id}/check-runs?filter=latest&per_page=50` });
        const runs = ((r?.check_runs ?? []) as Array<Record<string, any>>).filter(bad).slice(0, MAX_FAILURES);
        return Promise.all(runs.map((x) => failureOf(owner, s.repo, x)));
      }
      const r = await d.gh(owner, s.repo, { path: `/repos/${s.repo}/actions/runs/${s.check.id}/jobs?filter=latest&per_page=50` });
      const jobs = ((r?.jobs ?? []) as Array<Record<string, any>>).filter(bad).slice(0, MAX_FAILURES);
      if (jobs.length) return Promise.all(jobs.map((x) => failureOf(owner, s.repo, x)));
    } catch (e) {
      log(`[followup] ${s.repo}: reading the failing check failed: ${(e as Error).message.slice(0, 200)}`);
    }
    return [{ name: s.check.name, conclusion: s.check.conclusion, ...(s.check.url ? { url: s.check.url } : {}), excerpt: "" }];
  }

  async function reviewComments(owner: string, s: Extract<Signal, { kind: "review" }>, number: number): Promise<ReviewComment[]> {
    const out = new Map<number, ReviewComment>();
    for (const c of s.comments) out.set(c.id, c);
    if (s.unit.type === "review") {
      try {
        const list = (await d.gh(owner, s.repo, { path: `/repos/${s.repo}/pulls/${number}/reviews/${s.unit.id}/comments?per_page=100` })) as Array<Record<string, any>>;
        for (const c of Array.isArray(list) ? list : []) if (!out.has(Number(c.id))) out.set(Number(c.id), inlineOf(c));
      } catch (e) {
        log(`[followup] ${s.repo}#${number}: reading review comments failed: ${(e as Error).message.slice(0, 200)}`);
      }
    }
    return [...out.values()]
      .filter((c) => c.body.trim() && !c.body.includes(FOLLOWUP_MARKER))
      .slice(0, MAX_COMMENTS)
      .map((c) => ({ ...c, body: d.redact(c.body), ...(c.diffHunk ? { diffHunk: d.redact(c.diffHunk) } : {}) }));
  }

  /** Which agent PR does this signal concern? */
  function findPr(s: Signal): AgentPr | undefined {
    for (const n of s.prs) {
      const p = getAgentPr(d.db, s.repo, n);
      if (p) return p;
    }
    return s.kind === "ci" ? agentPrByBranch(d.db, s.repo, s.headBranch) : undefined;
  }

  /** Synchronous, db-only: is this delivery a follow-up on one of `owner`'s agent PRs? */
  function claims(owner: string, eventHeader: string, payload: unknown): { ok: true; signal: Signal; pr: AgentPr } | { ok: false; reason: string } {
    if (!FOLLOWUP_EVENTS.has(eventHeader)) return { ok: false, reason: `event ${eventHeader || "?"} is not a follow-up event` };
    const c = classifyEvent(eventHeader, payload);
    if (!c.ok) return { ok: false, reason: c.reason };
    const apr = findPr(c.signal);
    // A hook only acts on its owner's PRs; another tenant's PR is "not ours", never an error that leaks it.
    if (!apr || apr.owner !== owner) return { ok: false, reason: "not a pull request this product opened" };
    return { ok: true, signal: c.signal, pr: apr };
  }

  async function handle(source: { id: string; owner: string }, eventHeader: string, payload: unknown): Promise<HandleResult> {
    const cl = claims(source.owner, eventHeader, payload);
    if (!cl.ok) return { handled: false, reason: cl.reason };
    const s = cl.signal;
    const apr = cl.pr;
    const done = (r: Omit<Extract<HandleResult, { handled: true }>, "handled">): HandleResult => {
      d.logDelivery?.(source.id, { at: now(), outcome: r.outcome, ...(r.reason ? { reason: r.reason } : {}), detail: r.detail.slice(0, 300), ...(r.box ? { box: r.box } : {}) });
      return { handled: true, ...r };
    };
    const tag = `${apr.repo}#${apr.number}`;

    let pr: Record<string, any>;
    try {
      pr = await d.gh(apr.owner, s.repo, { path: `/repos/${s.repo}/pulls/${apr.number}` });
    } catch (e) {
      return done({ outcome: "failed", reason: "error", detail: `follow-up on ${tag}: could not read the PR (${(e as Error).message.slice(0, 120)})` });
    }
    const branch = String(pr?.head?.ref ?? "");
    const headRepo = String(pr?.head?.repo?.full_name ?? "");
    if (branch && branch !== apr.branch) setPrBranch(d.db, apr.repo, apr.number, branch);

    const prefs = d.prefs(apr.owner);
    const spec = apr.triggerId ? d.triggerSpec?.(apr.triggerId) : undefined;
    const key = dedupeKey(s);
    const g = guardFacts(d.db, apr.repo, apr.number, s.kind, key, now());
    const adm = admitFollowup(s, {
      ...g,
      enabled: enabledFor(s.kind, prefs, spec),
      pr: { open: pr?.state === "open" && !pr?.merged, headSha: String(pr?.head?.sha ?? ""), fork: !!headRepo && headRepo.toLowerCase() !== s.repo.toLowerCase() },
    });
    if (!adm.ok) return done({ outcome: "skipped", reason: adm.code, detail: `follow-up on ${tag}: ${adm.reason}` });
    if (!branch) return done({ outcome: "failed", reason: "error", detail: `follow-up on ${tag}: the PR has no head branch` });

    const id = claimFollowup(d.db, { repo: apr.repo, number: apr.number, owner: apr.owner, kind: s.kind, dedupeKey: key, attempt: adm.attempt, subject: subjectOf(s) }, now());
    if (id === null) return done({ outcome: "skipped", reason: "dedupe", detail: `follow-up on ${tag}: already claimed` });

    const ref = { repo: s.repo, number: apr.number, branch, ...(pr?.title ? { title: String(pr.title) } : {}) };
    let task: string;
    let subject: string;
    if (s.kind === "ci") {
      const failures = await ciFailures(apr.owner, s);
      subject = `failing check \`${failures[0]?.name.slice(0, 60) ?? s.check.name}\``;
      task = ciTask(ref, failures, adm.attempt);
    } else {
      const comments = await reviewComments(apr.owner, s, apr.number);
      if (!comments.length) {
        dropFollowup(d.db, id);
        return done({ outcome: "skipped", reason: "ignored", detail: `follow-up on ${tag}: the review has no comments to address` });
      }
      subject = subjectOf(s, comments.length);
      updateFollowup(d.db, id, { comments });
      task = reviewTask(ref, comments, adm.attempt);
    }
    updateFollowup(d.db, id, { subject });

    const startedBy: FollowupStart["startedBy"] = {
      kind: "followup",
      followup: s.kind,
      parent: apr.rootBox,
      pr: { repo: s.repo, number: apr.number },
      attempt: adm.attempt,
      subject,
      ...(apr.triggerId ? { triggerId: apr.triggerId } : {}),
    };
    let r: Awaited<ReturnType<EngineDeps["startFollowup"]>>;
    try {
      r = await d.startFollowup({ owner: apr.owner, pr: apr, branch, task, startedBy });
    } catch (e) {
      r = { ok: false, question: (e as Error).message };
    }
    if (!r.ok) {
      // A start that never produced a box is not an attempt; the next delivery may retry.
      dropFollowup(d.db, id);
      return done({ outcome: "failed", reason: "error", detail: `follow-up on ${tag}: ${r.question.slice(0, 200)}` });
    }
    attachBox(d.db, id, r.box);
    log(`[followup] ${tag} ${s.kind} attempt ${adm.attempt} → ${r.box}`);
    return done({ outcome: "fired", detail: `follow-up on ${tag}: ${subject} · attempt ${adm.attempt}`, box: r.box });
  }

  /** Resolve the review threads whose first comment is one we answered. Best-effort. */
  async function resolveThreads(owner: string, repo: string, number: number, commentIds: Set<number>): Promise<number> {
    if (!commentIds.size) return 0;
    const [o, n] = repo.split("/");
    const q = await d.gh(owner, repo, {
      method: "POST",
      path: "/graphql",
      body: {
        query: `query($o:String!,$n:String!,$num:Int!){repository(owner:$o,name:$n){pullRequest(number:$num){reviewThreads(first:100){nodes{id isResolved comments(first:1){nodes{databaseId}}}}}}}`,
        variables: { o, n, num: number },
      },
    });
    const threads = (q?.data?.repository?.pullRequest?.reviewThreads?.nodes ?? []) as Array<{ id: string; isResolved: boolean; comments: { nodes: Array<{ databaseId: number }> } }>;
    let resolved = 0;
    for (const t of threads) {
      if (t.isResolved || !commentIds.has(Number(t.comments?.nodes?.[0]?.databaseId))) continue;
      await d.gh(owner, repo, { method: "POST", path: "/graphql", body: { query: `mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{id}}}`, variables: { id: t.id } } });
      resolved++;
    }
    return resolved;
  }

  async function onRunFinished(box: string, digest: RunDigest, runLog: string, archiveId?: number): Promise<void> {
    const state = digest.state === "done" ? "done" : "failed";
    const row = finishFollowup(d.db, box, state, archiveId, now());
    if (!row) return;
    const repo = row.repo;
    const url = runUrl(box);
    let addressed = 0;
    if (row.kind === "review") {
      const said = parseAddressed(runLog);
      const answered = new Set<number>();
      for (const c of row.comments) {
        if (c.type !== "inline") continue;
        const summary = said.get(c.id);
        try {
          await d.gh(row.owner, repo, {
            method: "POST",
            path: `/repos/${repo}/pulls/${row.number}/comments/${c.id}/replies`,
            body: { body: d.redact(threadReply(summary, url, state === "done")) },
          });
          addressed++;
          if (summary && state === "done") answered.add(c.id);
        } catch (e) {
          log(`[followup] reply on ${repo}#${row.number} comment ${c.id} failed: ${(e as Error).message.slice(0, 200)}`);
        }
      }
      await resolveThreads(row.owner, repo, row.number, answered).catch((e) => log(`[followup] resolving threads on ${repo}#${row.number} failed: ${(e as Error).message.slice(0, 200)}`));
      // Review summaries and PR conversation comments are answered in the summary below.
      for (const c of row.comments) if (c.type !== "inline" && said.has(c.id)) addressed++;
    }
    const body = summaryComment({
      kind: row.kind,
      subject: row.subject,
      attempt: row.attempt,
      state,
      headline: digest.headline,
      ...(url ? { runUrl: url } : {}),
      ...(row.kind === "review" ? { addressed, total: row.comments.length } : {}),
    });
    await d
      .gh(row.owner, repo, { method: "POST", path: `/repos/${repo}/issues/${row.number}/comments`, body: { body: d.redact(body) } })
      .catch((e) => log(`[followup] summary comment on ${repo}#${row.number} failed: ${(e as Error).message.slice(0, 200)}`));
  }

  return { onArchived, claims, handle, onRunFinished };
}

export type FollowupEngine = ReturnType<typeof makeFollowupEngine>;
