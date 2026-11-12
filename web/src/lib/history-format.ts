import type { LedgerRow as HistoryRun } from "@/lib/api";

/**
 * How one archived run reads in a list. Kept apart from the History page so the home page can use
 * them without loading that page (and, through its review view, the code editor) up front.
 */
export function titleOf(r: HistoryRun): string {
  const t = (r.task ?? "").trim();
  if (t) {
    const firstLine = t.split("\n")[0];
    return firstLine.length > 90 ? `${firstLine.slice(0, 89)}…` : firstLine;
  }
  return (r.headline ?? "").trim() || "Untitled run";
}

export function runDuration(run: HistoryRun): number | null {
  // Archive stamps are epoch ms (see HistoryRun); fmtDuration and fmtAgo both speak seconds.
  return run.startedAt && run.endedAt && run.endedAt > run.startedAt ? Math.round((run.endedAt - run.startedAt) / 1000) : null;
}

export function tokensOf(r: HistoryRun): number | null {
  return r.inputTokens != null || r.outputTokens != null ? (r.inputTokens ?? 0) + (r.outputTokens ?? 0) : null;
}
