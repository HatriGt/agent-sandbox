import type { Db } from "./db.js";
import type { RunDigest } from "./digest.js";
import type { StartedBy } from "./started-by.js";
import {
  admit,
  formatReceiptComment,
  renderTemplate,
  templateContext,
  unattendedPreamble,
  type GithubMatch,
} from "./triggers.js";
import { advanceNextFire, chainsAfter, dueSchedules, getTriggerById, markFinished, markFired, markSkipped, type TriggerResult, type TriggerRow } from "./trigger-store.js";

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
  /** Post a receipt comment on an issue/PR with the owner's GitHub token. */
  postComment?(owner: string, repo: string, number: number, body: string): Promise<void>;
  audit?(owner: string, action: string, detail: { trigger: string; box?: string; outcome: string }): void;
  publicUrl?: string;
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
}

export function makeDispatcher(d: DispatcherDeps) {
  const now = () => (d.now ? d.now() : Date.now());
  const log = (m: string) => (d.log ? d.log(m) : console.error(m));
  /** triggerId → boxes it started that have not finished yet (+ in-flight starts). */
  const active = new Map<string, Set<string>>();
  const starting = new Map<string, number>();
  const fires = new Map<string, number[]>();
  /** box → trigger id, for the finish edge. */
  const boxTrigger = new Map<string, string>();
  let ticking = false;

  const activeCount = (id: string) => (active.get(id)?.size ?? 0) + (starting.get(id) ?? 0);

  async function fire(t: TriggerRow, ctx: FireContext = {}): Promise<TriggerResult> {
    const at = now();
    const recent = (fires.get(t.id) ?? []).filter((x) => at - x < 3600_000);
    // A manual "Run now" still respects concurrency and the storm cap, but not the enabled switch:
    // testing a paused automation is exactly what the button is for.
    const adm = admit({ enabled: ctx.manual ? true : t.enabled, concurrency: t.concurrency }, activeCount(t.id), recent, at);
    if (!adm.ok) {
      const r: TriggerResult = { at, outcome: "skipped", reason: adm.reason };
      markSkipped(d.db, t.id, r, at);
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
    const task = rendered.text.trim() + "\n" + unattendedPreamble({ name: t.name, kind: t.kind, prOnly: true });

    let repos: StartRunInput["repos"];
    if (!ctx.parent && t.repo) {
      // PR opened in the same repo: start on the PR's head branch so the agent reviews what was pushed.
      const p = (ctx.payload ?? {}) as Record<string, any>;
      const headRef = ctx.match?.subject?.kind === "pr" && p.pull_request?.head?.repo?.full_name === t.repo ? String(p.pull_request.head.ref ?? "") : "";
      repos = [{ repo: t.repo, ...(headRef ? { ref: headRef } : {}) }];
    }
    const startedBy: StartedBy = {
      kind: "trigger",
      triggerId: t.id,
      name: t.name,
      source: t.kind,
      ...(ctx.event ? { event: ctx.event } : {}),
      ...(ctx.match?.subject && Number.isFinite(ctx.match.subject.number) ? { subject: { ...ctx.match.subject, ...(t.repo ? { repo: t.repo } : {}) } } : {}),
    };

    fires.set(t.id, [...recent, at]);
    starting.set(t.id, (starting.get(t.id) ?? 0) + 1);
    let result: TriggerResult;
    try {
      const r = await d.startRun({ owner: t.owner, trigger: t, task, repos, ...(ctx.parent ? { after: ctx.parent.box } : {}), startedBy });
      if (r.ok) {
        const set = active.get(t.id) ?? new Set<string>();
        set.add(r.box);
        active.set(t.id, set);
        boxTrigger.set(r.box, t.id);
        result = { at, outcome: "started", box: r.box };
      } else {
        result = { at, outcome: "failed", reason: r.question.slice(0, 300) };
      }
    } catch (e) {
      result = { at, outcome: "failed", reason: (e as Error).message.slice(0, 300) };
    } finally {
      starting.set(t.id, Math.max(0, (starting.get(t.id) ?? 1) - 1));
    }
    markFired(d.db, t.id, result, at);
    d.audit?.(t.owner, "trigger.fire", { trigger: t.id, box: result.box, outcome: result.outcome });
    log(`[triggers] ${t.id} (${t.kind}) → ${result.outcome}${result.box ? ` ${result.box}` : ""}${result.reason ? `: ${result.reason}` : ""}`);
    return result;
  }

  /** Fire every due schedule once. Re-entrancy guarded: a slow start never double-fires a minute. */
  async function tick(): Promise<void> {
    if (ticking) return;
    ticking = true;
    try {
      for (const t of dueSchedules(d.db, now())) {
        // Advance next_fire BEFORE the (slow) start, so a crash mid-start cannot refire in a loop.
        advanceNextFire(d.db, t.id, now());
        await fire(t).catch((e) => log(`[triggers] tick ${t.id}: ${(e as Error).message}`));
      }
    } finally {
      ticking = false;
    }
  }

  /**
   * The finish edge: a run reached done/failed and was archived. Frees the concurrency slot, stamps
   * the trigger's last result, posts the receipt comment (when on and the run has a subject), and
   * fires any chain that follows this trigger.
   */
  async function onRunFinished(box: string, digest: RunDigest, startedBy: StartedBy | undefined, archiveId?: number): Promise<void> {
    const id = boxTrigger.get(box) ?? (startedBy?.kind === "trigger" ? startedBy.triggerId : undefined);
    if (!id) return;
    boxTrigger.delete(box);
    active.get(id)?.delete(box);
    const t = getTriggerById(d.db, id);
    if (!t) return;
    markFinished(d.db, id, box, { state: digest.state, headline: digest.headline, ...(archiveId ? { archiveId } : {}) });
    const subj = startedBy?.kind === "trigger" ? startedBy.subject : undefined;
    if (t.prComment && subj && t.repo && d.postComment) {
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
      await d.postComment(t.owner, t.repo, subj.number, body).catch((e) => log(`[triggers] receipt comment on ${t.repo}#${subj.number} failed: ${(e as Error).message.slice(0, 200)}`));
    }
    for (const c of chainsAfter(d.db, t.owner, id)) {
      if (c.spec.on !== "any" && digest.state !== "done") continue;
      await fire(c, { parent: { box, digest } }).catch((e) => log(`[triggers] chain ${c.id}: ${(e as Error).message}`));
    }
  }

  /** A box torn down before it finished still frees its slot. */
  function forget(box: string): void {
    const id = boxTrigger.get(box);
    if (!id) return;
    boxTrigger.delete(box);
    active.get(id)?.delete(box);
  }

  function start(intervalMs = 20_000): { stop: () => void } {
    const timer = setInterval(() => void tick(), intervalMs);
    if (typeof timer.unref === "function") timer.unref();
    return { stop: () => clearInterval(timer) };
  }

  return { fire, tick, onRunFinished, forget, start, activeCount };
}

export type Dispatcher = ReturnType<typeof makeDispatcher>;
