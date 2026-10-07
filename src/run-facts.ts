import type { RunDigest } from "./digest.js";
import type { OutcomePr } from "./outcome.js";
import type { TraceEvent } from "./trace.js";

/**
 * What one automation delivery was ABOUT and what its run produced, in the few fields a table column
 * can show: the PR / issue / alert that fired it, and — once the run finished — the review verdict,
 * findings by severity, PRs opened, tests, diff size and the receipt comment. Stamped on the
 * delivery-log row at fire time (subject) and again at the finish edge (result), so the Runs page
 * reads one row per delivery instead of joining the archive. Everything here is derived from data
 * the system already records; nothing new runs in the box.
 */
export interface RunFacts {
  v: 1;
  /** The GitHub PR or issue the delivery was about (github / watch triggers, chain of one). */
  subject?: { kind: "pr" | "issue"; number: number; repo: string; url: string; title?: string; author?: string };
  /** The alert that fired a preset webhook (Sentry / Datadog / PagerDuty). */
  alert?: { source: string; title: string; severity?: string; url?: string };
  /** The event name (x-github-event / watch event / preset action), when there was one. */
  event?: string;
  /* ── filled when the run finished ── */
  state?: RunDigest["state"];
  headline?: string;
  archiveId?: number;
  /** PRs the run opened. */
  prs?: OutcomePr[];
  tests?: { passed: number; failed: number } | null;
  diff?: { files: number; additions: number; deletions: number } | null;
  /** Verified-outcomes result; null = no verification configured. */
  verified?: boolean | null;
  /** A review's verdict and findings, read from the agent's final reply (null = it said neither). */
  review?: ReviewFacts | null;
  /** The receipt comment the controller posted on the subject. */
  receiptUrl?: string;
  durationMs?: number | null;
  usd?: number | null;
}

export type Severity = "high" | "medium" | "low" | "info";

export interface ReviewFacts {
  /** approve: the reply ends with an approval; needs-work: it asks for changes; null: no verdict line. */
  verdict: "approve" | "needs-work" | null;
  /** Findings tallied by severity from ```findings fences / severity tables; absent when none were listed. */
  findings?: Record<Severity, number>;
  /** Findings the reviewer marked blocking (severity high, or the word "blocking"/"blocker"). */
  blocking: number;
}

/* ───────────────────────────── subject (fire time) ───────────────────────────── */

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** The subject a GitHub-shaped payload describes, for a match on `{kind, number}` bound to `repo`. */
export function subjectFacts(payload: unknown, match: { kind: "pr" | "issue"; number: number } | undefined, repo: string | undefined, event?: string): Pick<RunFacts, "subject" | "alert" | "event"> {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, any>;
  const out: Pick<RunFacts, "subject" | "alert" | "event"> = {};
  if (event) out.event = event;
  const alert = p.asb_alert;
  if (alert && typeof alert === "object") {
    const a = alert as Record<string, unknown>;
    const title = str(a.title);
    if (title) out.alert = { source: str(a.source) ?? "alert", title: title.slice(0, 200), ...(str(a.severity) ? { severity: str(a.severity) } : {}), ...(str(a.url) ? { url: str(a.url) } : {}) };
  }
  const fullRepo = repo ?? str(p.repository?.full_name);
  if (match && Number.isFinite(match.number) && fullRepo) {
    const obj = (match.kind === "pr" ? (p.pull_request ?? p.issue) : p.issue) as Record<string, any> | undefined;
    const url = str(obj?.html_url) ?? `https://github.com/${fullRepo}/${match.kind === "pr" ? "pull" : "issues"}/${match.number}`;
    out.subject = {
      kind: match.kind,
      number: match.number,
      repo: fullRepo,
      url,
      ...(str(obj?.title) ? { title: str(obj!.title)!.slice(0, 200) } : {}),
      ...(str(obj?.user?.login) ? { author: str(obj!.user.login) } : {}),
    };
  }
  return out;
}

/* ───────────────────────────── review (finish time) ───────────────────────────── */

const SEVERITY_WORDS: Record<string, Severity> = {
  critical: "high", blocker: "high", blocking: "high", high: "high", severe: "high", major: "high", error: "high",
  medium: "medium", moderate: "medium", warn: "medium", warning: "medium",
  low: "low", minor: "low", nit: "low", trivial: "low",
  info: "info", note: "info", informational: "info", suggestion: "info",
};

const severityOf = (w: string): Severity | null => SEVERITY_WORDS[w.trim().toLowerCase().replace(/^\[|\]$/g, "")] ?? null;

/** Same grammar the console's findings block renders (web/src/lib/viz-extra.ts parseFindings): one per line. */
function parseFindingLines(src: string): Array<{ severity: Severity; text: string }> | null {
  const lines = src.split("\n").map((l) => l.trim().replace(/^[-*•]\s+/, "")).filter(Boolean);
  if (lines.length === 0 || lines.length > 40) return null;
  const out: Array<{ severity: Severity; text: string }> = [];
  for (const line of lines) {
    let severity: Severity | null = null;
    let text = "";
    if (line.includes("|")) {
      const parts = line.split("|").map((p) => p.trim());
      severity = severityOf(parts[0]);
      if (!severity || parts.length < 2) return null;
      text = parts.slice(1).filter(Boolean).join(" — ");
    } else {
      const bracket = line.match(/^\[([^\]]+)\]\s*(.+)$/);
      const colon = bracket ? null : line.match(/^([A-Za-z]+)\s*[:\-–—]\s*(.+)$/);
      const m = bracket ?? colon;
      severity = m ? severityOf(m[1]) : null;
      if (!m || !severity) return null;
      text = m[2].trim();
    }
    if (!text) return null;
    out.push({ severity, text });
  }
  return out;
}

const FENCE_RE = /```(?:findings|issues|risks)[^\n]*\n([\s\S]*?)```/g;
const SEVERITY_HEADER = /^(severity|level|priority|sev)$/i;

/** Findings from every ```findings fence plus any GFM table with a severity column. */
function findingsIn(text: string): Array<{ severity: Severity; text: string }> {
  const all: Array<{ severity: Severity; text: string }> = [];
  for (const m of text.matchAll(FENCE_RE)) {
    const f = parseFindingLines(m[1]);
    if (f) all.push(...f);
  }
  // GFM tables: a header row, a rule row, body rows; one column headed severity.
  const lines = text.split("\n");
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!/^\s*\|/.test(lines[i]) || !/^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) continue;
    const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    const head = cells(lines[i]);
    const sev = head.findIndex((h) => SEVERITY_HEADER.test(h));
    if (sev < 0) continue;
    let j = i + 2;
    for (; j < lines.length && /^\s*\|/.test(lines[j]); j++) {
      const row = cells(lines[j]);
      const s = severityOf(row[sev] ?? "");
      if (!s) continue;
      all.push({ severity: s, text: row.filter((_, k) => k !== sev).join(" — ") });
    }
    i = j - 1;
  }
  return all;
}

const APPROVE_RE = /\b(approve[ds]?|approval|lgtm|looks good to me|ship it|no (?:blocking )?(?:issues|findings|problems) found|nothing (?:serious|blocking))\b/i;
const NEEDS_WORK_RE = /\b(needs? work|needs? changes|request(?:ed|ing)? changes|changes requested|do not merge|don'?t merge|not ready|blocked|must (?:be )?fix(?:ed)?)\b/i;

/**
 * Read the review out of the agent's final reply. The verdict is the LAST line that names one (the
 * reviewer skills end with "approve" or "needs work"); a reply that lists findings but never says
 * which way it leans has verdict null. Null when the reply has neither a verdict nor findings — a
 * fix-it run, not a review.
 */
export function reviewFacts(events: TraceEvent[]): ReviewFacts | null {
  const says = events.filter((e): e is Extract<TraceEvent, { kind: "say" }> => e.kind === "say");
  if (!says.length) return null;
  // The last reply carries the verdict; findings may be spread over the last few.
  const tail = says.slice(-3).map((s) => s.text).join("\n");
  const found = findingsIn(tail);
  let verdict: ReviewFacts["verdict"] = null;
  const last = says[says.length - 1].text.replace(/```[\s\S]*?```/g, "");
  for (const line of last.split("\n").map((l) => l.trim()).filter(Boolean)) {
    if (NEEDS_WORK_RE.test(line)) verdict = "needs-work";
    else if (APPROVE_RE.test(line)) verdict = "approve";
  }
  if (!verdict && !found.length) return null;
  const findings: Record<Severity, number> = { high: 0, medium: 0, low: 0, info: 0 };
  for (const f of found) findings[f.severity]++;
  const blocking = found.filter((f) => f.severity === "high" || /\bblock(?:ing|er)\b/i.test(f.text)).length;
  return { verdict, ...(found.length ? { findings } : {}), blocking };
}

/* ───────────────────────────── result (finish time) ───────────────────────────── */

/** The finish-edge half of the facts, from the archived digest (its outcome card) and the trace. */
export function resultFacts(digest: RunDigest, events: TraceEvent[], archiveId: number | undefined): Partial<RunFacts> {
  const o = digest.outcome;
  return {
    state: digest.state,
    headline: digest.headline,
    ...(archiveId ? { archiveId } : {}),
    prs: o?.result.prs ?? [],
    tests: o?.trust.tests ? { passed: o.trust.tests.passed, failed: o.trust.tests.failed } : null,
    diff: o?.result.diff ?? null,
    verified: o?.trust.verified ? o.trust.verified.pass : digest.verified ? digest.verified.pass : null,
    review: reviewFacts(events),
    durationMs: o?.cost.durationMs ?? null,
    usd: o?.cost.usd ?? null,
  };
}
