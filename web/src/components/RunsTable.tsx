import { ArrowUpRight } from "lucide-react";
import type { Automation, AutomationDelivery, RunFacts } from "@/lib/api";
import { fmtAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { deliveryLine } from "@/components/Automations";
import { DataTable, StatusDot, stopRow, type Column } from "@/components/ui/data-table";

/**
 * One automation's deliveries as a table whose columns follow what the automation does: a PR review
 * shows the PR, verdict, findings and the comment it left; an alert shows the alert and the fix; a
 * schedule or chain shows the headline and what it changed. Columns come from `columnsFor`, cells
 * read the per-delivery facts (src/run-facts.ts), so older rows without facts show dashes.
 */

type Col = "time" | "outcome" | "subject" | "repo" | "author" | "alert" | "severity" | "verdict" | "findings" | "headline" | "result" | "duration" | "comment";

const HEAD: Record<Col, string> = {
  time: "When",
  outcome: "Status",
  subject: "Pull request",
  repo: "Repository",
  author: "Author",
  alert: "Alert",
  severity: "Severity",
  verdict: "Verdict",
  findings: "Findings",
  headline: "What happened",
  result: "Result",
  duration: "Took",
  comment: "Comment",
};

/** The column set for an automation, in reading order: what it was about, where, who, how it went, what it left. */
export function columnsFor(a: Automation | undefined): Col[] {
  if (a?.kind === "github" || a?.kind === "watch") {
    return a.kind === "github" && a.spec.event === "pr_opened"
      ? ["subject", "repo", "author", "outcome", "verdict", "findings", "comment", "duration", "time"]
      : ["subject", "repo", "author", "outcome", "headline", "result", "comment", "duration", "time"];
  }
  if (a?.kind === "webhook" && a.spec.preset) return ["alert", "severity", "outcome", "headline", "result", "duration", "time"];
  return ["headline", "outcome", "result", "duration", "time"];
}

const dash = <span className="text-faint">—</span>;
const ext = (url: string, body: React.ReactNode, className?: string) => (
  <a href={url} target="_blank" rel="noreferrer" onClick={stopRow} className={cn("hover:underline underline-offset-2", className)}>
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
      const tone = running ? "live" : f?.state === "failed" ? "destructive" : d.outcome === "fired" ? "ok" : d.outcome === "skipped" ? "muted" : "destructive";
      return (
        <StatusDot tone={tone} pulse={!!running} className="max-w-full">
          <span className="truncate">{d.test ? `test · ${word}` : word}</span>
          {d.quiet && <span className="text-faint font-normal">quiet</span>}
        </StatusDot>
      );
    }
    case "subject":
      return f?.subject
        ? ext(
            f.subject.url,
            <span className="flex min-w-0 items-center gap-2">
              <span className="text-muted-foreground tabular shrink-0 font-mono text-micro">#{f.subject.number}</span>
              <span className="truncate">{f.subject.title ?? `${f.subject.kind === "pr" ? "PR" : "Issue"} #${f.subject.number}`}</span>
              <ArrowUpRight className="text-faint size-3 shrink-0 opacity-0 transition-opacity group-hover/row:opacity-100" aria-hidden />
            </span>,
            "text-foreground block min-w-0",
          )
        : d.detail ? <span className="text-faint block truncate" title={d.detail}>{d.detail}</span> : dash;
    case "repo": {
      const r = f?.subject?.repo;
      if (!r) return dash;
      const [owner, name] = r.split("/");
      return ext(
        `https://github.com/${r}`,
        <span className="block truncate text-meta" title={r}>
          <span className="text-faint">{owner}/</span>
          <span className="text-muted-foreground">{name}</span>
        </span>,
        "block min-w-0",
      );
    }
    case "author":
      return f?.subject?.author
        ? ext(
            `https://github.com/${f.subject.author}`,
            <span className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-meta">
              <img src={`https://github.com/${f.subject.author}.png?size=32`} alt="" className="size-4 shrink-0 rounded-full" loading="lazy" />
              <span className="truncate">{f.subject.author}</span>
            </span>,
            "block min-w-0",
          )
        : dash;
    case "severity":
      return f?.alert?.severity ? <span className={cn("text-meta capitalize", /crit|high|error|p1/i.test(f.alert.severity) ? "text-destructive" : "text-muted-foreground")}>{f.alert.severity}</span> : dash;
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

const SORT: Partial<Record<Col, (d: AutomationDelivery) => number | string | null | undefined>> = {
  time: (d) => d.at,
  duration: (d) => d.facts?.durationMs,
  subject: (d) => d.facts?.subject?.number,
  repo: (d) => d.facts?.subject?.repo,
  author: (d) => d.facts?.subject?.author,
};

const openable = (d: AutomationDelivery) => d.outcome === "fired" && !!d.box;

export function RunsTable({ a, rows, onOpenBox }: { a: Automation | undefined; rows: AutomationDelivery[]; onOpenBox: (box: string) => void }) {
  const columns: Column<AutomationDelivery>[] = [
    ...columnsFor(a).map((c) => ({
      id: c,
      header: c === "subject" && a?.kind === "github" && a.spec.event !== "pr_opened" ? "Pull request / issue" : HEAD[c],
      width: WIDTH[c],
      sort: SORT[c],
      hideBelow: HIDE_BELOW[c],
      align: c === "duration" || c === "time" ? ("end" as const) : undefined,
      primary: c === "subject" || c === "headline" || c === "alert",
      cell: (d: AutomationDelivery) => cell(c, d, d.facts),
    })),
    {
      id: "open",
      header: <span className="sr-only">Open</span>,
      width: "w-8",
      cell: (d) => openable(d) && <ArrowUpRight className="text-faint size-3.5 transition-[color,translate] duration-200 ease-(--ease-out-quint) group-hover/row:text-foreground group-hover/row:translate-x-0.5 group-hover/row:-translate-y-0.5" aria-hidden />,
    },
  ];
  return (
    <DataTable
      aria-label="Runs"
      rows={rows}
      columns={columns}
      rowKey={(d) => String(d.id)}
      rowClickable={openable}
      onRowClick={(d) => onOpenBox(d.box!)}
      rowLabel={(d) => `Open ${d.box}`}
      search={{ placeholder: "Search runs", text: (d) => [d.facts?.subject ? `#${d.facts.subject.number} ${d.facts.subject.title ?? ""} ${d.facts.subject.author ?? ""} ${d.facts.subject.repo}` : "", d.facts?.headline ?? "", d.facts?.alert?.title ?? "", d.detail ?? ""].join(" ") }}
      minWidth="min-w-[760px]"
      size="sm"
      resizeKey={`runs:${a?.kind ?? "x"}:${a?.kind === "github" ? a.spec.event : ""}`}
    />
  );
}

/** Starting widths; the flexible columns (no width) share what's left. Users can drag any header edge. */
const WIDTH: Partial<Record<Col, string>> = {
  repo: "w-48",
  author: "w-36",
  severity: "w-24",
  time: "w-24",
  outcome: "w-28",
  verdict: "w-28",
  findings: "w-36",
  result: "w-40",
  duration: "w-16",
  comment: "w-24",
};

const HIDE_BELOW: Partial<Record<Col, "sm" | "md" | "lg">> = { author: "lg", findings: "md", comment: "md", duration: "sm", severity: "md", result: "md" };
