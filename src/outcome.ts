/**
 * The outcome card (docs/plan-demo-parity.md bet 2): one record answering the three questions a
 * returning user has — what did I get, can I trust it, what did it cost — plus why the run started.
 *
 * Built at the archive moment from facts the system already has (the digest, the raw log) and
 * persisted inside the archived digest (digest.outcome), so it survives teardown. Only "followed by" is resolved at READ time: the chained child starts after
 * the parent is archived. Every unknown is null — never a guessed zero (PRODUCT.md: no made-up
 * numbers). Pure except resolveFollowedBy, which reads the db.
 */
import type { Db } from "./db.js";
import type { RunDigest } from "./digest.js";
import type { TraceEvent } from "./trace.js";
import { costUsd, sumUsage } from "./cost.js";
import { describeStartedBy, type StartedBy } from "./started-by.js";
import { parseTestCounts, type TestCounts } from "./test-counts.js";
import type { FollowupView } from "./pr-followups.js";

export interface OutcomePr {
  url: string;
  repo: string;
  number: number;
}

export interface RunOutcome {
  v: 1;
  state: RunDigest["state"];
  header: {
    startedBy: StartedBy | null;
    /** "github ‹triage›: issue #12", "dashboard", … */
    label: string | null;
    /** Where the reason lives: the issue/PR on GitHub, or the parent run in the dashboard. */
    link: { href: string; external: boolean } | null;
  };
  result: {
    /** PRs the run opened (from `gh pr create` / a create-pull-request tool result). */
    prs: OutcomePr[];
    /** Workspace diff size; null when the file list could not be read at archive time. */
    diff: { files: number; additions: number; deletions: number } | null;
    /** Resolved on read: the run that was chained / handed off after this one. */
    followedBy?: { box: string; archiveId: number | null } | null;
    /** CI fixes / review rounds on this run's PR ("Fixed failing check `test` · 2nd attempt"). */
    followups?: Array<FollowupView & { line?: string }>;
  };
  trust: {
    /** Parsed test counts — from the verify command if it ran a runner, else the last test run in
     *  the trace. null when no recognised runner output exists: show the exit code instead. */
    tests: (TestCounts & { source: "verify" | "trace" }) | null;
    exitCode: number | null;
    verified: { pass: boolean; mode: string } | null;
    /** The verify command that ran (e.g. the repo setup's test command) — "Tested with `npm test`". */
    testedWith: string | null;
    /** Automation-started runs push through the PR-only guard (src/pr-only.ts). */
    prOnly: boolean;
    questions: number;
    openQuestions: number;
    blocked: number;
  };
  cost: {
    durationMs: number | null;
    tokens: { input: number; output: number } | null;
    /** Dollars only for a priced model; null = unpriced (render "—"). */
    usd: number | null;
    model: string | null;
  };
  /** Facts this run left in memory (src/memory-store.ts); absent on outcomes archived before it existed. */
  remembered?: number;
}

export interface OutcomeInput {
  digest: RunDigest;
  events?: TraceEvent[];
  /** The raw log, for summing every turn's ⟦usage⟧ line. */
  log?: string;
  /** False when the file list was not captured (box already stopped): diff becomes null. */
  filesKnown?: boolean;
  /** The archived unified diff, used for a size when the file list was not captured. */
  diffText?: string;
  env?: NodeJS.ProcessEnv;
}

const PR_URL = /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/g;

/** PRs the run OPENED. A PR URL merely mentioned (the task, a review) is not a result. */
export function openedPrs(events: TraceEvent[]): OutcomePr[] {
  const out = new Map<string, OutcomePr>();
  for (const ev of events) {
    if (ev.kind !== "tool" || ev.failed) continue;
    const creates = /\bpr\s+create\b/.test(ev.arg ?? "") || /create_?pull_?request/i.test(ev.name);
    if (!creates) continue;
    for (const m of (ev.result ?? "").matchAll(PR_URL)) if (!out.has(m[0])) out.set(m[0], { url: m[0], repo: m[1], number: Number(m[2]) });
  }
  return [...out.values()];
}

function diffSizeOf(text: string): { files: number; additions: number; deletions: number } {
  let files = 0, additions = 0, deletions = 0;
  for (const l of text.split("\n")) {
    if (l.startsWith("diff --git ")) files++;
    else if (l.startsWith("+") && !l.startsWith("+++")) additions++;
    else if (l.startsWith("-") && !l.startsWith("---")) deletions++;
  }
  return { files, additions, deletions };
}

function headerOf(sb: StartedBy | undefined): RunOutcome["header"] {
  if (!sb) return { startedBy: null, label: null, link: null };
  let label = describeStartedBy(sb) ?? null;
  let link: RunOutcome["header"]["link"] = null;
  if (sb.kind === "trigger") {
    if (sb.subject) {
      label = `${label}: ${sb.subject.kind === "pr" ? "PR" : "issue"} #${sb.subject.number}`;
      if (sb.subject.repo) link = { href: `https://github.com/${sb.subject.repo}/${sb.subject.kind === "pr" ? "pull" : "issues"}/${sb.subject.number}`, external: true };
    } else if (sb.event) label = `${label}: ${sb.event}`;
    if (!link && sb.parent) link = { href: `/dashboard/box/${encodeURIComponent(sb.parent)}`, external: false };
  } else if (sb.kind === "followup") {
    link = { href: `https://github.com/${sb.pr.repo}/pull/${sb.pr.number}`, external: true };
  } else if (sb.kind === "after") {
    link = { href: `/dashboard/box/${encodeURIComponent(sb.parent)}`, external: false };
  }
  return { startedBy: sb, label, link };
}

export function buildOutcome(i: OutcomeInput): RunOutcome {
  const d = i.digest;
  const events = i.events ?? [];

  // Tests: the verify command's output is authoritative; else the LAST recognised runner output.
  let tests: RunOutcome["trust"]["tests"] = null;
  if (d.verified?.tests) tests = { ...d.verified.tests, source: "verify" };
  else {
    for (const ev of events) {
      if (ev.kind !== "tool") continue;
      const c = parseTestCounts(ev.result);
      if (c) tests = { ...c, source: "trace" };
    }
  }

  let diff: RunOutcome["result"]["diff"] = null;
  if (i.filesKnown !== false && (i.filesKnown || d.files.length)) {
    diff = { files: d.files.length, additions: d.files.reduce((a, f) => a + f.additions, 0), deletions: d.files.reduce((a, f) => a + f.deletions, 0) };
  } else if (i.diffText) diff = diffSizeOf(i.diffText);

  // Tokens: every turn's usage line (each is that turn's total); fall back to the digest's last one.
  const summed = i.log ? sumUsage(i.log) : { inputTokens: 0, outputTokens: 0 };
  const hasSum = summed.inputTokens + summed.outputTokens > 0;
  const tokens = hasSum
    ? { input: summed.inputTokens, output: summed.outputTokens }
    : d.usage
      ? { input: d.usage.inputTokens, output: d.usage.outputTokens }
      : null;
  const model = d.provenance?.model ?? null;
  const usd = (tokens ? costUsd({ inputTokens: tokens.input, outputTokens: tokens.output }, model ?? undefined, i.env) : undefined) ?? null;

  const startedAt = d.startedAt;
  const durationMs = startedAt !== undefined && d.endedAt !== undefined && d.endedAt >= startedAt ? d.endedAt - startedAt : null;

  const sb = d.provenance?.startedBy;
  return {
    v: 1,
    state: d.state,
    header: headerOf(sb),
    result: { prs: openedPrs(events), diff },
    trust: {
      tests,
      exitCode: d.exitCode ?? null,
      verified: d.verified ? { pass: d.verified.pass, mode: d.verified.mode } : null,
      testedWith: d.verified?.mode === "command" && d.verified.command ? d.verified.command : null,
      prOnly: sb?.kind === "trigger" || sb?.kind === "followup",
      questions: d.questions.length,
      openQuestions: d.questions.filter((q) => q.answer === undefined).length,
      blocked: d.blocked?.length ?? 0,
    },
    cost: {
      durationMs,
      tokens,
      usd,
      model,
    },
    ...(d.remembered ? { remembered: d.remembered } : {}),
  };
}

/** The stored outcome, or one derived from the digest alone for rows archived before it existed. */
export function outcomeOf(digest: RunDigest | null | undefined, diffText?: string): RunOutcome | null {
  if (!digest) return null;
  const stored = (digest as { outcome?: RunOutcome }).outcome;
  if (stored && stored.v === 1) return stored;
  return buildOutcome({ digest, ...(diffText ? { diffText } : {}) });
}

/**
 * The run that followed `box`: a chain trigger (startedBy.parent) or an `after:` handoff. Checks the
 * archive first (a finished child has an id to link), then live boxes' started-by records.
 */
export function resolveFollowedBy(
  db: Db,
  owner: string,
  box: string,
  ownsBox: (box: string) => boolean = () => true
): { box: string; archiveId: number | null } | null {
  try {
    const archived = db
      .prepare(
        `SELECT id, box FROM run_archive WHERE owner = ? AND json_extract(digest_json, '$.provenance.startedBy.parent') = ?
         ORDER BY id ASC LIMIT 1`
      )
      .get(owner, box) as { id: number; box: string } | undefined;
    if (archived) return { box: archived.box, archiveId: Number(archived.id) };
    const live = db
      .prepare(`SELECT box FROM run_started_by WHERE json_extract(started_by_json, '$.parent') = ? ORDER BY at ASC LIMIT 1`)
      .get(box) as { box: string } | undefined;
    return live && ownsBox(live.box) ? { box: live.box, archiveId: null } : null;
  } catch {
    return null; // json_extract on a corrupt row: "followed by" is simply unknown
  }
}
