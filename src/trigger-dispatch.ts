import type { Db } from "./db.js";
import type { RunDigest } from "./digest.js";
import type { StartedBy } from "./started-by.js";
import type { TraceEvent } from "./trace.js";
import { resultFacts, subjectFacts } from "./run-facts.js";
import {
  admit,
  MAX_DEFERRED_PER_TRIGGER,
  formatReceiptComment,
  type Admission,
  shouldDestroyBox,
  quietPreamble,
  renderTemplate,
  templateContext,
  unattendedPreamble,
  type GithubMatch,
} from "./triggers.js";
import {
  advanceNextFire, chainsAfter, countDeferred, dropDeferred, dueSchedules, enqueueDeferred, getTriggerById, listDeferred, markDeliveryFinished, markDeliveryReceipt, markFinished, markFired, markSkipped, takeDeferred,
  type TriggerResult, type TriggerRow,
} from "./trigger-store.js";

/**
 * The trigger dispatcher: one controller loop (modelled on the pool maintainer — setInterval,
 * unref'd, every failure logged and swallowed) that fires due schedules, plus the entry points the
 * webhook route and the finish edge call. Every fire goes through `startRun`, which the controller
 * wires to the SAME runDelegateFlow the composer uses, under the trigger owner's principal (so the
 * per-user quota, trial gate and ownership record all apply) and with a `trigger` StartedBy.
 */

export interface StartRunInput {
  owner: string;
  trigger: TriggerRow;
  task: string;
  repos?: Array<{ repo: string; ref?: string }>;
  /** chain: the parent box to hand off from (src/handoff.ts). */
  after?: string;
  startedBy: StartedBy;
}

export interface DispatcherDeps {
  db: Db;
  startRun(input: StartRunInput): Promise<{ ok: true; box: string } | { ok: false; question: string }>;
  /** Post a receipt comment on an issue/PR with the owner's GitHub token; answers the comment's web URL when GitHub gave one. */
  postComment?(owner: string, repo: string, number: number, body: string): Promise<string | undefined | void>;
  audit?(owner: string, action: string, detail: { trigger: string; box?: string; outcome: string }): void;
  publicUrl?: string;
  /**
   * Names of boxes that exist right now. Used to reconcile persisted in-flight fires whose box was
   * torn down or lost while the controller was down. Throwing skips reconciliation (fail closed:
   * a broken listing must never read as "nothing running" and free every slot).
   */
  liveBoxes?(): Promise<Iterable<string>>;
  log?(m: string): void;
  now?(): number;
}

export interface FireContext {
  payload?: unknown;
  event?: string;
  match?: Extract<GithubMatch, { match: true }>;
  /** chain: the finished parent run. */
  parent?: { box: string; digest: RunDigest };
  manual?: boolean;
  /** A re-review round on a followed PR (src/pr-follow.ts): the preface goes after the template. */
  follow?: { round: number; preface: string };
}

/** Runs after every fire that passed admission, immediate or deferred (src/repo-watch.ts registers the PRs it follows here). */
export type AfterFire = (t: TriggerRow, ctx: FireContext, result: TriggerResult) => void;

export function makeDispatcher(d: DispatcherDeps) {
  const now = () => (d.now ? d.now() : Date.now());
  const log = (m: string) => (d.log ? d.log(m) : console.error(m));
  /*
   * In-flight runs and the storm cap live in `trigger_fires`, not memory, so a controller restart
   * cannot reset them. A row is one fire attempt; `finished_at IS NULL` means its run is still going
   * (box NULL = still starting). A start interrupted by a crash dies with the process, so rows left
   * "starting" from a previous process are closed at construction.
   */
  d.db.prepare(`UPDATE trigger_fires SET finished_at = ? WHERE box IS NULL AND finished_at IS NULL`).run(now());
  let ticking = false;
  let lastReconcile = -Infinity;
  const afterFire: AfterFire[] = [];

  const activeCount = (id: string) =>
    (d.db.prepare(`SELECT COUNT(*) AS n FROM trigger_fires WHERE trigger_id = ? AND finished_at IS NULL`).get(id) as { n: number }).n;
  const recentFires = (id: string, at: number) =>
    (d.db.prepare(`SELECT at FROM trigger_fires WHERE trigger_id = ? AND at > ? ORDER BY at`).all(id, at - 3600_000) as Array<{ at: number }>).map((r) => r.at);
  const triggerOfBox = (box: string) =>
    (d.db.prepare(`SELECT trigger_id FROM trigger_fires WHERE box = ? AND finished_at IS NULL ORDER BY id DESC LIMIT 1`).get(box) as { trigger_id: string } | undefined)?.trigger_id;
  const closeBox = (box: string) => d.db.prepare(`UPDATE trigger_fires SET finished_at = ? WHERE box = ? AND finished_at IS NULL`).run(now(), box);

  /** Free slots held by boxes that no longer exist (torn down / lost across a restart). */
  async function reconcile(): Promise<void> {
    if (!d.liveBoxes) return;
    let live: Set<string>;
    try {
      live = new Set(await d.liveBoxes());
    } catch (e) {
      log(`[triggers] reconcile skipped: ${(e as Error).message.slice(0, 200)}`);
      return;
    }
    // Grace: a box that just started may not be listed yet.
    const rows = d.db.prepare(`SELECT id, box FROM trigger_fires WHERE box IS NOT NULL AND finished_at IS NULL AND at < ?`).all(now() - 120_000) as Array<{ id: number; box: string }>;
    const close = d.db.prepare(`UPDATE trigger_fires SET finished_at = ? WHERE id = ?`);
    for (const r of rows) if (!live.has(r.box)) close.run(now(), r.id);
    d.db.prepare(`DELETE FROM trigger_fires WHERE finished_at IS NOT NULL AND at < ?`).run(now() - 7 * 86_400_000);
  }

  /** Would a fire start right now? Pure: no row, no log (the watcher asks before it starts a follow round). */
  const admits = (t: TriggerRow, manual = false): Admission => admit({ enabled: manual ? true : t.enabled }, recentFires(t.id, now()), now());

  async function fire(t: TriggerRow, ctx: FireContext = {}): Promise<TriggerResult> {
    const at = now();
    // A manual "Run now" still respects the storm cap, but not the enabled switch: testing a paused
    // automation is exactly what the button is for. Runs already going never block a new one.
    const adm = admits(t, ctx.manual);
    if (!adm.ok) {
      const facts = subjectFacts(ctx.payload, ctx.match?.subject, ctx.match?.subject?.repo ?? (t.repos?.length === 1 ? t.repos[0] : undefined), ctx.event);
      // An event the storm cap holds back waits its turn rather than vanishing: a PR opened during a
      // busy hour still gets its review, later. Someone pressing "Run now" gets an answer instead,
      // a follow round waits in the watcher with its notes (so pushes meanwhile merge into one
      // round), and a schedule's next slot is its retry.
      const capped = adm.reason.startsWith("storm cap");
      if (capped && !ctx.manual && !ctx.follow && (ctx.event || ctx.parent) && countDeferred(d.db, t.id) < MAX_DEFERRED_PER_TRIGGER) {
        const r: TriggerResult = { at, outcome: "deferred", reason: `${adm.reason}; waits for the window to free` };
        const logId = markSkipped(d.db, t.id, r, at, facts);
        enqueueDeferred(d.db, t.id, ctx, at, logId);
        d.audit?.(t.owner, "trigger.defer", { trigger: t.id, outcome: adm.reason });
        log(`[triggers] ${t.id} deferred: ${adm.reason}`);
        return r;
      }
      const r: TriggerResult = { at, outcome: "skipped", reason: adm.reason };
      markSkipped(d.db, t.id, r, at, facts);
      d.audit?.(t.owner, "trigger.skip", { trigger: t.id, outcome: adm.reason });
      log(`[triggers] ${t.id} skipped: ${adm.reason}`);
      return r;
    }
    const extra: Record<string, unknown> = {
      trigger: { name: t.name, kind: t.kind },
      now: new Date(at).toISOString(),
      ...(ctx.match?.command !== undefined ? { command: ctx.match.command } : {}),
      ...(ctx.parent ? { parent: { box: ctx.parent.box, headline: ctx.parent.digest.headline, state: ctx.parent.digest.state, task: ctx.parent.digest.task } } : {}),
    };
    const rendered = renderTemplate(t.taskTemplate, templateContext(ctx.payload, extra));
    const task =
      rendered.text.trim() + (ctx.follow ? "\n" + ctx.follow.preface : "") + "\n" + unattendedPreamble({ name: t.name, kind: t.kind, prOnly: true }) + (t.quiet ? "\n" + quietPreamble(rendered.text) : "");

    let repos: StartRunInput["repos"];
    // The repo this event came from (a multi-repo automation fires once per event, in that repo).
    const subjectRepo = ctx.match?.subject?.repo ?? (t.repos?.length === 1 ? t.repos[0] : undefined);
    if (!ctx.parent && t.repos?.length) {
      // A PR event in the same repo: start on the PR's head branch so the agent sees what was pushed
      // (not once the PR is closed — its branch is often deleted on merge).
      const p = (ctx.payload ?? {}) as { pull_request?: { state?: string; head?: { ref?: string; repo?: { full_name?: string } | null } } };
      const pr = p.pull_request;
      const headRef = subjectRepo && ctx.match?.subject?.kind === "pr" && pr?.state !== "closed" && pr?.head?.repo?.full_name?.toLowerCase() === subjectRepo.toLowerCase() ? String(pr.head.ref ?? "") : "";
      // An event clones the repo it is about; a schedule / webhook / manual run without one clones every listed repo.
      repos = ctx.match?.subject?.repo ? [{ repo: ctx.match.subject.repo, ...(headRef ? { ref: headRef } : {}) }] : t.repos.map((repo) => ({ repo, ...(headRef && repo === subjectRepo ? { ref: headRef } : {}) }));
    }
    const startedBy: StartedBy = {
      kind: "trigger",
      triggerId: t.id,
      name: t.name,
      source: t.kind,
      ...(ctx.event ? { event: ctx.event } : {}),
      ...(ctx.follow ? { round: ctx.follow.round } : {}),
      ...(ctx.parent ? { parent: ctx.parent.box } : {}),
      ...(ctx.match?.subject && Number.isFinite(ctx.match.subject.number) ? { subject: { kind: ctx.match.subject.kind, number: ctx.match.subject.number, ...(subjectRepo ? { repo: subjectRepo } : {}) } } : {}),
    };

    const fireId = Number(d.db.prepare(`INSERT INTO trigger_fires (trigger_id, at) VALUES (?, ?)`).run(t.id, at).lastInsertRowid);
    let result: TriggerResult;
    try {
      const r = await d.startRun({ owner: t.owner, trigger: t, task, repos, ...(ctx.parent ? { after: ctx.parent.box } : {}), startedBy });
      if (r.ok) {
        d.db.prepare(`UPDATE trigger_fires SET box = ? WHERE id = ?`).run(r.box, fireId);
        result = { at, outcome: "started", box: r.box };
      } else {
        result = { at, outcome: "failed", reason: r.question.slice(0, 300) };
      }
    } catch (e) {
      result = { at, outcome: "failed", reason: (e as Error).message.slice(0, 300) };
    }
    if (result.outcome !== "started") d.db.prepare(`UPDATE trigger_fires SET finished_at = ? WHERE id = ?`).run(now(), fireId);
    markFired(d.db, t.id, result, at, { ...subjectFacts(ctx.payload, ctx.match?.subject, subjectRepo, ctx.event), ...(ctx.follow ? { round: ctx.follow.round } : {}) });
    d.audit?.(t.owner, "trigger.fire", { trigger: t.id, box: result.box, outcome: result.outcome });
    log(`[triggers] ${t.id} (${t.kind}) → ${result.outcome}${result.box ? ` ${result.box}` : ""}${result.reason ? `: ${result.reason}` : ""}`);
    for (const f of afterFire) {
      try {
        f(t, ctx, result);
      } catch (e) {
        log(`[triggers] after-fire hook: ${(e as Error).message.slice(0, 200)}`);
      }
    }
    return result;
  }

  /**
   * Events the storm cap held back start once their automation's window frees, oldest first, one
   * automation never starving another. A queue whose automation is gone or paused is dropped (its
   * rows read "skipped"); the first one still over the cap ends that automation's drain for this tick.
   */
  async function drainDeferred(): Promise<void> {
    for (const [id, queue] of listDeferred(d.db)) {
      const t = getTriggerById(d.db, id);
      if (!t) {
        dropDeferred(d.db, id, "the automation was deleted while this waited for the storm cap");
        continue;
      }
      if (!t.enabled) {
        const n = dropDeferred(d.db, id, "the automation was paused while this waited for the storm cap");
        log(`[triggers] ${id}: ${n} deferred event${n === 1 ? "" : "s"} dropped (paused)`);
        continue;
      }
      for (const f of queue) {
        if (!admits(t).ok) break;
        takeDeferred(d.db, f);
        const ctx = (f.ctx && typeof f.ctx === "object" ? f.ctx : {}) as FireContext;
        log(`[triggers] ${id}: deferred ${ctx.event ?? "event"} from ${new Date(f.at).toISOString()} starts now`);
        await fire(t, ctx).catch((e) => log(`[triggers] deferred ${id}: ${(e as Error).message}`));
      }
    }
  }

  /** Fire every due schedule once. Re-entrancy guarded: a slow start never double-fires a minute. */
  async function tick(): Promise<void> {
    if (ticking) return;
    ticking = true;
    try {
      // A full box listing is not free: reconcile on the first tick after start, then every 5 min.
      if (now() - lastReconcile > 300_000) {
        lastReconcile = now();
        await reconcile();
      }
      for (const t of dueSchedules(d.db, now())) {
        // Advance next_fire BEFORE the (slow) start, so a crash mid-start cannot refire in a loop.
        advanceNextFire(d.db, t.id, now());
        await fire(t).catch((e) => log(`[triggers] tick ${t.id}: ${(e as Error).message}`));
      }
      await drainDeferred().catch((e) => log(`[triggers] deferred drain: ${(e as Error).message}`));
    } finally {
      ticking = false;
    }
  }

  /**
   * The finish edge: a run reached done/failed and was archived. Closes its fire row, stamps
   * the trigger's last result, posts the receipt comment (when on and the run has a subject), and
   * fires any chain that follows this trigger. Answers whether the automation's box policy wants the
   * box destroyed now; the caller does it after its own finish work (follow-ups) is through.
   */
  async function onRunFinished(box: string, digest: RunDigest, startedBy: StartedBy | undefined, archiveId?: number, opts: { quiet?: boolean; events?: TraceEvent[] } = {}): Promise<{ destroy: boolean }> {
    const id = triggerOfBox(box) ?? (startedBy?.kind === "trigger" ? startedBy.triggerId : undefined);
    if (!id) return { destroy: false };
    closeBox(box);
    const t = getTriggerById(d.db, id);
    if (!t) return { destroy: false };
    markFinished(d.db, id, box, { state: digest.state, headline: digest.headline, ...(archiveId ? { archiveId } : {}) });
    // The ledger row the Automations page reads: quiet (nothing needed the operator) or a report, plus the result facts.
    markDeliveryFinished(d.db, id, box, opts.quiet === true, resultFacts(digest, opts.events ?? [], archiveId));
    const subj = startedBy?.kind === "trigger" ? startedBy.subject : undefined;
    const receiptRepo = subj?.repo;
    if (t.prComment && subj && receiptRepo && d.postComment) {
      const body = formatReceiptComment({
        triggerName: t.name,
        headline: digest.headline,
        box,
        state: digest.state,
        agentLabel: digest.provenance?.agentLabel,
        model: digest.provenance?.model,
        files: digest.files.length,
        questions: digest.questions.length,
        ...(digest.verified ? { verified: digest.verified.pass } : {}),
        ...(digest.usage ? { usage: digest.usage } : {}),
        ...(digest.startedAt && digest.endedAt ? { durationMs: digest.endedAt - digest.startedAt } : {}),
        ...(d.publicUrl ? { url: `${d.publicUrl.replace(/\/$/, "")}/dashboard/box/${encodeURIComponent(box)}` } : {}),
      });
      try {
        const url = await d.postComment(t.owner, receiptRepo, subj.number, body);
        if (typeof url === "string" && url) markDeliveryReceipt(d.db, id, box, url);
      } catch (e) {
        log(`[triggers] receipt comment on ${receiptRepo}#${subj.number} failed: ${(e as Error).message.slice(0, 200)}`);
      }
    }
    // Chains start (and carry the parent's patch) BEFORE the parent may be destroyed: fire awaits startRun.
    for (const c of chainsAfter(d.db, t.owner, id)) {
      if (c.spec.on !== "any" && digest.state !== "done") continue;
      await fire(c, { parent: { box, digest } }).catch((e) => log(`[triggers] chain ${c.id}: ${(e as Error).message}`));
    }
    return { destroy: shouldDestroyBox(t.spec.destroy, digest.state) };
  }

  /** A box torn down before it finished still frees its slot. */
  function forget(box: string): void {
    closeBox(box);
  }

  /** The quiet automation whose in-flight fire started `box`, if any (the finish edge asks before notifying). */
  function quietTriggerOf(box: string): TriggerRow | undefined {
    const id = triggerOfBox(box);
    const t = id ? getTriggerById(d.db, id) : undefined;
    return t?.quiet ? t : undefined;
  }

  function start(intervalMs = 20_000): { stop: () => void } {
    const timer = setInterval(() => void tick(), intervalMs);
    if (typeof timer.unref === "function") timer.unref();
    return { stop: () => clearInterval(timer) };
  }

  /** Register a hook that runs after every fire (immediate or deferred) with its context and result. */
  const onFire = (f: AfterFire) => void afterFire.push(f);

  return { fire, admits, onFire, tick, onRunFinished, forget, start, activeCount, reconcile, quietTriggerOf };
}

export type Dispatcher = ReturnType<typeof makeDispatcher>;
