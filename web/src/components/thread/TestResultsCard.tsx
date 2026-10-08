import * as React from "react";
import { Check, ChevronDown, Circle, X } from "lucide-react";
import { Collapse } from "@/components/ui/collapse";
import type { TestReport, TestStatus } from "@/lib/testReport";
import { cn } from "@/lib/utils";

/**
 * A test run as a result card: summary chips (passed / failed / skipped · duration), then each file
 * as a collapsible group of cases with their timing. Failed files open by default; passing ones stay
 * folded so a green run is one glance. A "raw output" toggle keeps the terminal text one click away.
 */
export function TestResultsCard({ report, onRaw, rawOpen }: { report: TestReport; onRaw?: () => void; rawOpen?: boolean }) {
  const total = report.passed + report.failed + report.skipped;
  return (
    <div className="bg-card overflow-hidden rounded-xl border shadow-e1">
      <div className="flex flex-wrap items-center gap-2 border-b px-3.5 py-2.5">
        <Chip status="pass" n={report.passed} label="passed" />
        {report.failed > 0 && <Chip status="fail" n={report.failed} label="failed" />}
        {report.skipped > 0 && <Chip status="skip" n={report.skipped} label="skipped" />}
        <span className="text-muted-foreground ml-auto flex items-center gap-2 text-meta">
          {report.durationMs != null && <span className="tabular">{fmtMs(report.durationMs)}</span>}
          <span className="label opacity-70">{report.runner}</span>
          {onRaw && (
            <button type="button" onClick={onRaw} className="hover:text-foreground cursor-pointer text-micro underline-offset-2 hover:underline">
              {rawOpen ? "hide raw" : "raw output"}
            </button>
          )}
        </span>
      </div>
      {report.files.length > 0 ? (
        <ul className="divide-y">
          {report.files.map((f) => (
            <FileGroup key={f.name} file={f} defaultOpen={f.status === "fail" || report.files.length === 1} />
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground px-3.5 py-2.5 text-meta">
          {total} {total === 1 ? "test" : "tests"} — the runner printed only a summary.
        </p>
      )}
    </div>
  );
}

function Chip({ status, n, label }: { status: TestStatus; n: number; label: string }) {
  const Icon = status === "pass" ? Check : status === "fail" ? X : Circle;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-meta font-medium",
        status === "pass" && "bg-ok/10 text-ok",
        status === "fail" && "bg-destructive/10 text-destructive",
        status === "skip" && "bg-warn/20 text-warn-text"
      )}
    >
      <span className={cn("grid size-4 place-items-center rounded-full border-[1.5px]", status === "pass" && "border-ok", status === "fail" && "border-destructive", status === "skip" && "border-attention-text")}>
        <Icon className="size-2.5" strokeWidth={3} aria-hidden />
      </span>
      <span className="tabular">{n}</span> {label}
    </span>
  );
}

function FileGroup({ file, defaultOpen }: { file: TestReport["files"][number]; defaultOpen: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen);
  const fails = file.tests.filter((t) => t.status === "fail").length;
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="hover:bg-muted/60 flex w-full cursor-pointer items-center gap-2.5 px-3.5 py-2 text-left"
      >
        <ChevronDown className={cn("text-muted-foreground size-3.5 shrink-0 transition-transform", !open && "-rotate-90")} aria-hidden />
        <StatusDot status={file.status} />
        <span className="text-foreground min-w-0 flex-1 truncate font-mono text-meta">{file.name}</span>
        <span className="text-muted-foreground tabular text-micro">
          {fails > 0 ? `${fails} failing · ` : ""}
          {file.tests.length || file.total || 0} {(file.tests.length || file.total) === 1 ? "test" : "tests"}
        </span>
      </button>
      <Collapse open={open && file.tests.length > 0}>
        <ul>
          {file.tests.map((t, i) => (
            <li key={`${i}-${t.name}`} className={cn("flex items-center gap-2.5 border-t py-1.5 pr-3.5 pl-10 text-meta", t.status === "fail" ? "text-foreground" : "text-foreground")}>
              <StatusDot status={t.status} small />
              <span className="min-w-0 flex-1 truncate">{t.name}</span>
              {t.ms != null && <span className={cn("tabular text-micro", t.status === "fail" ? "text-destructive" : "text-muted-foreground")}>{fmtMs(t.ms)}</span>}
            </li>
          ))}
        </ul>
      </Collapse>
    </li>
  );
}

function StatusDot({ status, small }: { status: TestStatus; small?: boolean }) {
  const Icon = status === "pass" ? Check : status === "fail" ? X : Circle;
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full border-[1.5px]",
        small ? "size-3.5" : "size-4",
        status === "pass" && "border-ok text-ok",
        status === "fail" && "border-destructive text-destructive",
        status === "skip" && "border-attention-text text-attention-text"
      )}
      aria-label={status}
    >
      <Icon className={small ? "size-2" : "size-2.5"} strokeWidth={3} aria-hidden />
    </span>
  );
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}
