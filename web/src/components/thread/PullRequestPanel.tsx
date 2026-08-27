import * as React from "react";
import { ArrowUpRight, FileDiff, GitBranch, GitMerge, GitPullRequest, GitPullRequestDraft, GitPullRequestClosed, User } from "lucide-react";
import { motion } from "motion/react";
import { api, type PullInfo } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The run's pull request, pinned to the top-right of the thread instead of sitting in the
 * conversation: a tinted header with the state and number, a link out, then quiet fact rows
 * (branches, changes, author). The transcript keeps only the link chip where the URL appeared.
 * Data comes from `/pr.json` (GitHub via the connected account); until it lands the header shows
 * what the URL alone tells us.
 */
export function PullRequestPanel({ url, repo, number, className }: { url: string; repo: string; number: number; className?: string }) {
  const [info, setInfo] = React.useState<PullInfo | null>(null);
  React.useEffect(() => {
    const ctrl = new AbortController();
    api.pull(repo, number, ctrl.signal).then(setInfo).catch(() => {});
    return () => ctrl.abort();
  }, [repo, number]);

  const state = info?.state ?? "open";
  const Icon = state === "merged" ? GitMerge : state === "draft" ? GitPullRequestDraft : state === "closed" ? GitPullRequestClosed : GitPullRequest;
  const headline = state === "merged" ? "Merged" : state === "draft" ? "Draft pull request" : state === "closed" ? "Closed" : "Open pull request";
  const tone =
    state === "merged"
      ? "bg-sleep/12 text-sleep border-sleep/25"
      : state === "closed"
        ? "bg-destructive/8 text-destructive border-destructive/25"
        : state === "draft"
          ? "bg-muted text-muted-foreground border-border"
          : "bg-ok/10 text-ok border-ok/25";

  return (
    <motion.aside
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      aria-label={`Pull request #${number}`}
      className={cn("bg-card/95 w-72 rounded-xl border p-1.5 shadow-[0_1px_2px_oklch(0_0_0/0.05),0_12px_32px_-16px_oklch(0_0_0/0.35)] backdrop-blur", className)}
    >
      <div className={cn("flex items-center gap-2.5 rounded-lg border px-2.5 py-2", tone)}>
        <Icon className="size-4 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-meta font-semibold">{headline}</p>
          <p className="stamp truncate opacity-80">
            #{number} · {repo}
          </p>
        </div>
        <a href={url} target="_blank" rel="noreferrer noopener" aria-label="Open on GitHub" className="hover:bg-card/60 grid size-7 shrink-0 cursor-pointer place-items-center rounded-md transition-colors">
          <ArrowUpRight className="size-4" aria-hidden />
        </a>
      </div>
      <p className="text-foreground truncate px-2.5 pt-2.5 pb-1 text-meta font-medium" title={info?.title}>
        {info?.title ?? <span className="bg-muted inline-block h-3 w-40 animate-pulse rounded" />}
      </p>
      <dl className="px-2.5 pb-1.5">
        <Row icon={GitBranch} label="Branch">
          {info ? (
            <span className="truncate font-mono">
              {info.head} <span className="opacity-50">→</span> {info.base}
            </span>
          ) : (
            "…"
          )}
        </Row>
        <Row icon={FileDiff} label="Changes">
          {info ? (
            <>
              {info.changedFiles} {info.changedFiles === 1 ? "file" : "files"}
              <span className="text-ok ml-2">+{info.additions}</span> <span className="text-destructive">−{info.deletions}</span>
            </>
          ) : (
            "…"
          )}
        </Row>
        {info?.author && (
          <Row icon={User} label="Author">
            {info.author}
          </Row>
        )}
      </dl>
    </motion.aside>
  );
}

function Row({ icon: Icon, label, children }: { icon: React.ComponentType<{ className?: string }>; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 py-1 text-meta">
      <dt className="text-muted-foreground flex w-20 shrink-0 items-center gap-1.5">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </dt>
      <dd className="text-foreground flex min-w-0 flex-1 items-center justify-end truncate tabular-nums">{children}</dd>
    </div>
  );
}
