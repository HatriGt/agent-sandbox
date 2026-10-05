import * as React from "react";
import { AlertOctagon, AlertTriangle, Info, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { severityOf, sortFindings, type Finding, type Severity } from "@/lib/viz-extra";
import { VizFrame } from "./VizFrame";
import { RollNumber, useRowEntrance } from "./motion";

const SEVERITY: Record<Severity, { icon: React.ReactNode; tone: string; word: string }> = {
  high: { icon: <AlertOctagon className="size-3" strokeWidth={2.5} />, tone: "bg-destructive/12 text-destructive", word: "high" },
  medium: { icon: <AlertTriangle className="size-3" strokeWidth={2.5} />, tone: "bg-warn/25 text-warn-text", word: "medium" },
  low: { icon: <Info className="size-3" strokeWidth={2.5} />, tone: "bg-muted text-muted-foreground", word: "low" },
  info: { icon: <MessageSquare className="size-3" strokeWidth={2.5} />, tone: "bg-live/12 text-live", word: "info" },
};

/**
 * ```findings (and severity-column tables) → a review list ranked by severity. Each row: a pill
 * carrying both a glyph and the severity WORD (never colour alone), a mono `where` chip, the
 * finding. The footer tallies per severity so the shape of the review reads at a glance.
 */
export function FindingsBlock({ findings, source }: { findings: Finding[]; source: string }) {
  const rows = React.useMemo(() => sortFindings(findings), [findings]);
  const tally = (["high", "medium", "low", "info"] as const).map((s) => [s, rows.filter((f) => f.severity === s).length] as const).filter(([, n]) => n > 0);
  const entrance = useRowEntrance(rows.map((f) => `${f.severity}|${f.where ?? ""}|${f.text}`));
  return (
    <VizFrame title={`${rows.length} finding${rows.length === 1 ? "" : "s"}`} source={source}>
      <ul className="m-0 list-none p-0" aria-label="findings by severity">
        {rows.map((f, i) => {
          const s = SEVERITY[f.severity];
          const key = `${f.severity}|${f.where ?? ""}|${f.text}`;
          return (
            <li key={key} className={cn("flex items-start gap-3 px-4 py-2 text-body", i > 0 && "border-t", entrance(key).className)} style={entrance(key).style}>
              <span className={cn("mt-0.5 inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-1.5 text-micro font-semibold", s.tone)} data-severity={f.severity}>
                <span className="viz-mark grid place-items-center" aria-hidden>
                  {s.icon}
                </span>
                {s.word}
              </span>
              <span className="min-w-0 flex-1 leading-relaxed">
                {f.where && <code className="bg-muted text-muted-foreground mr-2 rounded px-1.5 py-0.5 font-mono text-micro [overflow-wrap:anywhere]">{f.where}</code>}
                <span className={cn(f.severity === "info" ? "text-muted-foreground" : "text-foreground")}>{f.text}</span>
              </span>
            </li>
          );
        })}
      </ul>
      <div className="text-muted-foreground flex items-center gap-3 border-t px-4 py-1.5 text-micro">
        {tally.map(([s, n], i) => (
          <React.Fragment key={s}>
            {i > 0 && <span className="opacity-40">·</span>}
            <span className="tabular-nums">
              <RollNumber text={String(n)} /> {SEVERITY[s].word}
            </span>
          </React.Fragment>
        ))}
      </div>
    </VizFrame>
  );
}

const SEVERITY_HEADER = /^(severity|level|risk|priority)$/i;
const WHERE_HEADER = /^(where|location|file|line|path|module|method)$/i;

/**
 * A GFM table with a severity column whose every body cell is a severity word → findings. The
 * `where` column is one headed where/location/file/…; the finding text is the remaining columns
 * joined with " — ". Null for any other table (caller falls back to the data table).
 */
export function findingsFromTable(head: string[], texts: string[][]): Finding[] | null {
  const sev = head.findIndex((h) => SEVERITY_HEADER.test(h.trim()));
  if (sev < 0 || texts.length === 0 || texts.length > 40) return null;
  const whereCol = head.findIndex((h, i) => i !== sev && WHERE_HEADER.test(h.trim()));
  const out: Finding[] = [];
  for (const row of texts) {
    const severity = severityOf(row[sev] ?? "");
    if (!severity) return null;
    const text = row.filter((_, i) => i !== sev && i !== whereCol).filter(Boolean).join(" — ");
    if (!text) return null;
    out.push({ severity, where: whereCol >= 0 && row[whereCol] ? row[whereCol] : undefined, text });
  }
  return out;
}
