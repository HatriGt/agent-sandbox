import * as React from "react";
import { ChevronDown } from "lucide-react";
import { api, type RunDigest } from "@/lib/api";
import { fmtDuration } from "@/lib/lifecycle";
import { cn } from "@/lib/utils";

const FILE_CAP = 6;

/**
 * The run receipt: what happened in this run at a glance — headline, plan, files, failed commands,
 * questions — pinned to the top of a finished thread. Everything comes from /digest.json (a pure
 * derivation of the trace); nothing is invented, and empty sections are simply absent. If the
 * digest cannot be fetched the card renders nothing.
 */
export function useRunDigest(box: string, finished: boolean, finishedKey: string | number): RunDigest | null {
  const [digest, setDigest] = React.useState<RunDigest | null>(null);
  React.useEffect(() => {
    setDigest(null);
    if (!finished) return;
    const ctrl = new AbortController();
    api
      .digest(box, ctrl.signal)
      .then((d) => {
        // Only show a receipt for a run that ended; a stale "running" digest is not one.
        if (d.state === "done" || d.state === "failed") setDigest(d);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [box, finished, finishedKey]);
  return digest;
}

export function DigestCard({ digest }: { digest: RunDigest }) {
  const [open, setOpen] = React.useState(true);

  const failed = digest.state === "failed";
  const duration = digest.startedAt && digest.endedAt && digest.endedAt > digest.startedAt ? fmtDuration(Math.round((digest.endedAt - digest.startedAt) / 1000)) : null;
  const hasBody = digest.plan.length > 0 || digest.files.length > 0 || digest.failedCommands.length > 0 || digest.questions.length > 0;
  const files = digest.files.slice(0, FILE_CAP);
  const moreFiles = digest.files.length - files.length;

  return (
    <div className="enter bg-card raised rounded-xl px-4 py-3">
      <button
        type="button"
        onClick={() => hasBody && setOpen((v) => !v)}
        aria-expanded={open}
        className={cn("flex w-full items-center gap-2.5 text-left", hasBody && "cursor-pointer")}
      >
        <span className={cn("size-2 shrink-0 rounded-full", failed ? "bg-destructive" : "bg-ok")} aria-hidden />
        <span className={cn("label shrink-0", failed ? "text-destructive" : "text-ok")}>{failed ? "Failed" : "Done"}</span>
        <span className="text-foreground min-w-0 flex-1 truncate text-meta">{digest.headline}</span>
        {duration && <span className="stamp text-muted-foreground shrink-0">{duration}</span>}
        {hasBody && <ChevronDown className={cn("text-muted-foreground size-3.5 shrink-0 transition-transform", open && "rotate-180")} aria-hidden />}
      </button>

      {digest.verified && (
        <p className={cn("mt-1.5 min-w-0 truncate pl-[18px] text-micro", digest.verified.pass ? "text-ok" : "text-destructive")}>
          {digest.verified.pass ? "✓ verified" : "UNVERIFIED"}
          {digest.verified.detail ? ` ${digest.verified.pass ? "·" : "—"} ${digest.verified.detail.length > 120 ? `${digest.verified.detail.slice(0, 120)}…` : digest.verified.detail}` : ""}
        </p>
      )}

      {open && hasBody && (
        <div className="mt-3 grid gap-x-8 gap-y-3 border-t pt-3 sm:grid-cols-2">
          {digest.plan.length > 0 && (
            <div className="min-w-0">
              <p className="label text-muted-foreground mb-1.5">Plan</p>
              <ul className="flex flex-col gap-1">
                {digest.plan.map((s, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-meta">
                    <span className={cn("mt-px w-3.5 shrink-0 text-center", s.failed ? "text-destructive" : s.state === "done" ? "text-ok" : "text-muted-foreground")} aria-hidden>
                      {s.failed ? "✕" : s.state === "done" ? "✓" : "·"}
                    </span>
                    <span className={cn("min-w-0", s.failed ? "text-destructive" : s.state === "done" ? "text-foreground" : "text-muted-foreground")}>{s.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(digest.files.length > 0 || digest.failedCommands.length > 0 || digest.questions.length > 0) && (
            <div className="flex min-w-0 flex-col gap-3">
              {digest.files.length > 0 && (
                <div className="min-w-0">
                  <p className="label text-muted-foreground mb-1.5">{digest.files.length === 1 ? "1 file changed" : `${digest.files.length} files changed`}</p>
                  <ul className="flex flex-col gap-0.5">
                    {files.map((f) => (
                      <li key={f.path} className="stamp text-muted-foreground flex items-baseline gap-2">
                        <span className="text-foreground min-w-0 truncate">{f.path}</span>
                        {f.additions > 0 && <span className="text-ok shrink-0">+{f.additions}</span>}
                        {f.deletions > 0 && <span className="text-destructive shrink-0">−{f.deletions}</span>}
                      </li>
                    ))}
                    {moreFiles > 0 && <li className="stamp text-muted-foreground">+{moreFiles} more</li>}
                  </ul>
                </div>
              )}
              {digest.failedCommands.length > 0 && (
                <div className="min-w-0">
                  <p className="label text-destructive mb-1.5">{digest.failedCommands.length === 1 ? "1 command failed" : `${digest.failedCommands.length} commands failed`}</p>
                  <ul className="flex flex-col gap-0.5">
                    {digest.failedCommands.map((c, i) => (
                      <li key={i} className="stamp text-destructive min-w-0 truncate">
                        {c.name}
                        {c.arg ? ` ${c.arg}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {digest.questions.length > 0 && (
                <p className="text-muted-foreground text-micro">
                  {digest.questions.length === 1 ? "1 question asked" : `${digest.questions.length} questions asked`}
                  {digest.questions.some((q) => !q.answer) ? " · not all answered" : ""}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
