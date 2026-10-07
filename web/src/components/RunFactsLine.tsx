import type { RunFacts } from "@/lib/api";
import { cn } from "@/lib/utils";

const VERDICT: Record<"approve" | "needs-work", { word: string; tone: string }> = {
  approve: { word: "Approved", tone: "text-ok" },
  "needs-work": { word: "Needs work", tone: "text-attention-text" },
};

/**
 * What one delivery was about and what its run produced, as one compact line: the PR/issue or alert,
 * the review verdict + findings, opened PRs, tests, diff, and the receipt comment link. Renders
 * nothing for a delivery with no facts (older rows, skips).
 */
export function RunFactsLine({ f, className }: { f?: RunFacts; className?: string }) {
  if (!f) return null;
  const parts: React.ReactNode[] = [];
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  if (f.subject) {
    parts.push(
      <a key="s" href={f.subject.url} target="_blank" rel="noreferrer" onClick={stop} className="text-foreground/85 hover:text-foreground min-w-0 truncate underline-offset-2 hover:underline">
        {f.subject.kind === "pr" ? "PR" : "Issue"} #{f.subject.number}
        {f.subject.title ? ` ${f.subject.title}` : ""}
        {f.subject.author ? <span className="text-faint"> · @{f.subject.author}</span> : null}
      </a>,
    );
  } else if (f.alert) {
    const body = `${f.alert.source}${f.alert.severity ? ` ${f.alert.severity}` : ""}: ${f.alert.title}`;
    parts.push(
      f.alert.url ? (
        <a key="a" href={f.alert.url} target="_blank" rel="noreferrer" onClick={stop} className="text-foreground/85 min-w-0 truncate hover:underline">
          {body}
        </a>
      ) : (
        <span key="a" className="text-foreground/85 min-w-0 truncate">
          {body}
        </span>
      ),
    );
  }
  if (f.review?.verdict) {
    const v = VERDICT[f.review.verdict];
    parts.push(
      <span key="v" className={cn("font-medium", v.tone)}>
        {v.word}
      </span>,
    );
  }
  if (f.review?.findings) {
    const { high, medium, low } = f.review.findings;
    const bits = [high && `${high} high`, medium && `${medium} med`, low && `${low} low`].filter(Boolean);
    if (bits.length) parts.push(<span key="f" className={high ? "text-destructive" : undefined}>{bits.join(" · ")}</span>);
  }
  for (const pr of f.prs ?? []) {
    parts.push(
      <a key={pr.url} href={pr.url} target="_blank" rel="noreferrer" onClick={stop} className="text-live hover:underline">
        opened #{pr.number}
      </a>,
    );
  }
  if (f.tests) parts.push(<span key="t" className={f.tests.failed ? "text-destructive" : "text-ok"}>{f.tests.failed ? `${f.tests.failed} tests failing` : `${f.tests.passed} tests pass`}</span>);
  if (f.diff && f.diff.files > 0) parts.push(<span key="d" className="tabular">{f.diff.files} files +{f.diff.additions} −{f.diff.deletions}</span>);
  if (f.receiptUrl) {
    parts.push(
      <a key="r" href={f.receiptUrl} target="_blank" rel="noreferrer" onClick={stop} className="hover:text-foreground underline-offset-2 hover:underline">
        comment ↗
      </a>,
    );
  }
  if (parts.length === 0) return null;
  return (
    <span className={cn("text-muted-foreground flex min-w-0 flex-wrap items-baseline gap-x-2 text-micro", className)}>
      {parts.map((p, i) => (
        <span key={i} className="flex min-w-0 items-baseline gap-x-2">
          {i > 0 && <span className="text-faint" aria-hidden>·</span>}
          {p}
        </span>
      ))}
    </span>
  );
}
