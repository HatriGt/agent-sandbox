import * as React from "react";
import { ArrowRight, Check, ChevronDown, Circle, GitMerge, GitPullRequest, GitPullRequestDraft, X } from "lucide-react";
import { api, type PullInfo } from "@/lib/api";
import { AnimatePresence, motion } from "motion/react";
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
        status === "skip" && "bg-attention/20 text-attention-text"
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
          {file.tests.length} {file.tests.length === 1 ? "test" : "tests"}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && file.tests.length > 0 && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            {file.tests.map((t, i) => (
              <li key={`${i}-${t.name}`} className={cn("flex items-center gap-2.5 border-t py-1.5 pr-3.5 pl-10 text-meta", t.status === "fail" ? "text-foreground" : "text-foreground")}>
                <StatusDot status={t.status} small />
                <span className="min-w-0 flex-1 truncate">{t.name}</span>
                {t.ms != null && <span className={cn("tabular text-micro", t.status === "fail" ? "text-destructive" : "text-muted-foreground")}>{fmtMs(t.ms)}</span>}
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
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

/**
 * A pull request the agent opened — the way a PR reads on GitHub: state glyph, "#142 Title", then
 * repo · head → base · +adds −dels · files. Metadata is fetched through a connected account; until it
 * arrives (or if the repo is private to another account) the card still works as a link.
 */
export function PullRequestCard({ url, repo, number }: { url: string; repo: string; number: number }) {
  const [info, setInfo] = React.useState<PullInfo | null>(null);
  React.useEffect(() => {
    const ctrl = new AbortController();
    api.pull(repo, number, ctrl.signal).then(setInfo).catch(() => {});
    return () => ctrl.abort();
  }, [repo, number]);
  const state = info?.state ?? "open";
  const Icon = state === "merged" ? GitMerge : state === "draft" ? GitPullRequestDraft : GitPullRequest;
  const tone =
    state === "merged" ? "bg-sleep/20 text-sleep" : state === "closed" ? "bg-destructive/10 text-destructive" : state === "draft" ? "bg-muted text-muted-foreground" : "bg-ok/10 text-ok";
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="bg-card hover:border-line-strong group flex w-full max-w-[60ch] items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors"
    >
      <span className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-md", tone)}>
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-foreground flex items-baseline gap-1.5 text-body">
          <span className="text-muted-foreground shrink-0 tabular">#{number}</span>
          <span className="truncate font-medium">{info?.title ?? "Pull request"}</span>
        </span>
        <span className="stamp text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="truncate">{repo}</span>
          {info && (
            <>
              <span className="opacity-40">·</span>
              <span className="truncate">
                {info.head} <span className="opacity-60">→</span> {info.base}
              </span>
              <span className="opacity-40">·</span>
              <span className="text-ok">+{info.additions}</span>
              <span className="text-destructive">−{info.deletions}</span>
              <span>
                {info.changedFiles} {info.changedFiles === 1 ? "file" : "files"}
              </span>
              <span className={cn("label rounded px-1.5 py-0.5", tone)}>{state}</span>
            </>
          )}
        </span>
      </span>
      <ArrowRight className="text-muted-foreground mt-1.5 size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
    </a>
  );
}
