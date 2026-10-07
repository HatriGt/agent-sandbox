import { ArrowUpRight } from "lucide-react";
import type { Automation, AutomationDelivery, RunFacts } from "@/lib/api";
import { fmtAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { deliveryLine, deliveryTone } from "@/components/Automations";

/**
 * One automation's deliveries as a table whose columns follow what the automation does: a PR review
 * shows the PR, verdict, findings and the comment it left; an alert shows the alert and the fix; a
 * schedule or chain shows the headline and what it changed. Columns come from `columnsFor`, cells
 * read the per-delivery facts (src/run-facts.ts), so older rows without facts show dashes.
 */

type Col = "time" | "outcome" | "subject" | "alert" | "verdict" | "findings" | "headline" | "result" | "duration" | "comment";

const HEAD: Record<Col, string> = {
  time: "When",
  outcome: "Outcome",
  subject: "Pull request / issue",
  alert: "Alert",
  verdict: "Verdict",
  findings: "Findings",
  headline: "What happened",
  result: "Result",
  duration: "Took",
  comment: "Comment",
};

/** The column set for an automation: what its deliveries are about decides what is worth a column. */
export function columnsFor(a: Automation | undefined): Col[] {
  if (a?.kind === "github") {
    return a.spec.event === "pr_opened"
      ? ["time", "outcome", "subject", "verdict", "findings", "comment", "duration"]
      : ["time", "outcome", "subject", "headline", "result", "comment", "duration"];
  }
  if (a?.kind === "webhook" && a.spec.preset) return ["time", "outcome", "alert", "headline", "result", "duration"];
  return ["time", "outcome", "headline", "result", "duration"];
}

const dash = <span className="text-faint">—</span>;
const ext = (url: string, body: React.ReactNode, className?: string) => (
  <a href={url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className={cn("hover:underline underline-offset-2", className)}>
    {body}
  </a>
);

function took(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${(s / 3600).toFixed(1)}h`;
}

function cell(col: Col, d: AutomationDelivery, f: RunFacts | undefined): React.ReactNode {
  switch (col) {
    case "time":
      return (
        <span className="stamp tabular" title={new Date(d.at).toLocaleString()}>
          {fmtAgo(Math.round(d.at / 1000))}
        </span>
      );
    case "outcome": {
      const running = d.outcome === "fired" && f && !f.state;
      const word = running ? "running" : d.outcome === "fired" ? (f?.state ?? "fired") : deliveryLine(d);
      return (
        <span className={cn("font-medium", running ? "text-live" : f?.state === "failed" ? "text-destructive" : deliveryTone(d))}>
          {d.test ? `test · ${word}` : word}
          {d.quiet && <span className="text-faint ml-1.5 font-normal">quiet</span>}
        </span>
      );
    }
    case "subject":
      return f?.subject
        ? ext(
            f.subject.url,
            <span className="block truncate">
              <span className="tabular">#{f.subject.number}</span> {f.subject.title ?? ""}
              {f.subject.author && <span className="text-faint"> @{f.subject.author}</span>}
            </span>,
            "text-foreground/90 block min-w-0",
          )
        : d.detail ? <span className="text-faint block truncate" title={d.detail}>{d.detail}</span> : dash;
    case "alert":
      if (!f?.alert) return d.detail ? <span className="text-faint block truncate">{d.detail}</span> : dash;
      return (
        <span className="block truncate" title={f.alert.title}>
          <span className="text-muted-foreground">{f.alert.source}</span> {f.alert.url ? ext(f.alert.url, f.alert.title) : f.alert.title}
        </span>
      );
    case "verdict":
      return f?.review?.verdict === "approve" ? <span className="text-ok font-medium">Approved</span> : f?.review?.verdict === "needs-work" ? <span className="text-attention-text font-medium">Needs work</span> : dash;
    case "findings": {
      const c = f?.review?.findings;
      if (!c) return dash;
      const bits = [c.high ? <span key="h" className="text-destructive">{c.high} high</span> : null, c.medium ? <span key="m">{c.medium} med</span> : null, c.low ? <span key="l" className="text-muted-foreground">{c.low} low</span> : null].filter(Boolean);
      return bits.length ? <span className="flex gap-2 tabular">{bits}</span> : <span className="text-ok">none</span>;
    }
    case "headline":
      return f?.headline ? <span className="block truncate" title={f.headline}>{f.headline}</span> : d.detail && !f?.subject ? <span className="text-faint block truncate">{d.detail}</span> : dash;
    case "result": {
      const parts: React.ReactNode[] = [];
      for (const pr of f?.prs ?? []) parts.push(ext(pr.url, `PR #${pr.number}`, "text-live"));
      if (f?.tests) parts.push(<span className={f.tests.failed ? "text-destructive" : "text-ok"}>{f.tests.failed ? `${f.tests.failed} failing` : `${f.tests.passed} pass`}</span>);
      if (f?.diff?.files) parts.push(<span className="tabular">+{f.diff.additions} −{f.diff.deletions}</span>);
      return parts.length ? <span className="flex gap-2">{parts.map((p, i) => <span key={i}>{p}</span>)}</span> : dash;
    }
    case "duration":
      return f?.durationMs ? <span className="tabular text-muted-foreground">{took(f.durationMs)}</span> : dash;
    case "comment":
      return f?.receiptUrl ? ext(f.receiptUrl, "view ↗", "text-muted-foreground") : dash;
  }
}

export function RunsTable({ a, rows, onOpenBox }: { a: Automation | undefined; rows: AutomationDelivery[]; onOpenBox: (box: string) => void }) {
  const cols = columnsFor(a);
  return (
    <div className="bg-card overflow-x-auto rounded-xl border shadow-e1">
      <table className="w-full min-w-[640px] table-fixed text-meta">
        <thead>
          <tr className="border-b">
            {cols.map((c) => (
              <th key={c} scope="col" className={cn("label text-faint px-3 py-2 text-left font-normal", WIDTH[c])}>
                {HEAD[c]}
              </th>
            ))}
            <th className="w-8" aria-label="Open" />
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => {
            const openable = d.outcome === "fired" && !!d.box;
            return (
              <tr
                key={d.id}
                onClick={openable ? () => onOpenBox(d.box!) : undefined}
                className={cn("group/run border-b last:border-b-0", openable && "hover:bg-muted/40 cursor-pointer")}
                tabIndex={openable ? 0 : undefined}
                aria-label={openable ? `Open ${d.box}` : undefined}
                onKeyDown={openable ? (e) => e.key === "Enter" && onOpenBox(d.box!) : undefined}
              >
                {cols.map((c) => (
                  <td key={c} className="min-w-0 overflow-hidden px-3 py-2.5 align-middle">
                    {cell(c, d, d.facts)}
                  </td>
                ))}
                <td className="pr-3">{openable && <ArrowUpRight className="text-faint group-hover/run:text-muted-foreground size-3.5" aria-hidden />}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const WIDTH: Record<Col, string> = {
  time: "w-24",
  outcome: "w-32",
  subject: "w-auto",
  alert: "w-auto",
  verdict: "w-28",
  findings: "w-36",
  headline: "w-auto",
  result: "w-40",
  duration: "w-16",
  comment: "w-20",
};
