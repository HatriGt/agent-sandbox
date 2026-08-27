import * as React from "react";
import { ArrowUpRight, Check, CircleCheck, CircleDashed, CircleX, FileDiff, GitBranch, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, Globe, Loader2, Users, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { api, type PullInfo } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The run's pull request as a floating control: a small chip pinned to the top-right of the thread
 * (state icon · #number · state), which opens a card with everything you'd check before merging —
 * a verdict header ("Ready to merge" / "Checks failing" / "Merged" …) with the check count and a
 * Merge action, then Review (decision + reviewers), Committed (files, +/−), Branch, and a link out.
 * Merge runs `gh pr merge` inside the sandbox with the run's own GitHub identity; it asks twice.
 */
export function PullRequestFloat({ session, url, repo, number }: { session: string; url: string; repo: string; number: number }) {
  const [info, setInfo] = React.useState<PullInfo | null>(null);
  const [open, setOpen] = React.useState(false);
  const load = React.useCallback((signal?: AbortSignal) => api.pull(repo, number, signal).then(setInfo).catch(() => {}), [repo, number]);
  React.useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);
  // Close on Escape / outside click.
  const rootRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const v = verdict(info);
  const Icon = v.icon;

  return (
    <div ref={rootRef} className="relative flex shrink-0 items-center">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Pull request #${number}: ${v.title}`}
        className={cn(
          "bg-card hover:border-line-strong flex h-6 cursor-pointer items-center gap-1.5 rounded-full border pr-2.5 pl-1 text-micro font-semibold transition-[border-color,box-shadow]",
          open && "border-line-strong"
        )}
      >
        <span className={cn("grid size-4 place-items-center rounded-full", v.chip)}>
          <Icon className="size-2.5" aria-hidden />
        </span>
        <span className="text-foreground tabular-nums">#{number}</span>
        <span className={cn("hidden sm:inline", v.text)}>{v.short}</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            role="dialog"
            aria-label={`Pull request #${number}`}
            className="bg-card absolute top-full right-0 z-40 mt-2 w-[22rem] rounded-2xl border p-1.5 shadow-[0_1px_2px_oklch(0_0_0/0.06),0_24px_48px_-20px_oklch(0_0_0/0.45)]"
          >
            <Header info={info} v={v} url={url} session={session} repo={repo} number={number} onMerged={() => void load()} onClose={() => setOpen(false)} />
            <div className="px-2.5 pt-3 pb-2">
              <p className="text-foreground truncate text-meta font-medium" title={info?.title}>
                {info?.title ?? <span className="bg-muted inline-block h-3 w-48 animate-pulse rounded align-middle" />}
              </p>
            </div>
            <Section label="Review" right={info ? (info.state === "merged" ? "Merged" : info.state === "closed" ? "Closed" : info.state === "draft" ? "Draft" : "Open") : "…"}>
              {info?.reviewers?.length ? (
                info.reviewers.map((r) => (
                  <Row key={r.login} icon={<img src={`https://github.com/${encodeURIComponent(r.login)}.png?size=40`} alt="" width={18} height={18} className="bg-muted size-[18px] rounded-full" loading="lazy" />} label={r.login} right={reviewLabel(r.state)} tone={r.state === "approved" ? "text-ok" : r.state === "changes_requested" ? "text-destructive" : undefined} />
                ))
              ) : (
                <Row icon={<Users className="size-3.5" />} label="No reviewers" right={info?.reviewDecision === "approved" ? "Approved" : ""} />
              )}
            </Section>
            <Section label="Committed">
              <Row
                icon={<FileDiff className="size-3.5" />}
                label={info ? `${info.changedFiles} ${info.changedFiles === 1 ? "file" : "files"} committed` : "…"}
                right={
                  info ? (
                    <>
                      <span className="text-ok">+{info.additions}</span> <span className="text-destructive">−{info.deletions}</span>
                    </>
                  ) : (
                    ""
                  )
                }
              />
              <Row
                icon={<GitBranch className="size-3.5" />}
                label={
                  info ? (
                    <span className="truncate font-mono text-micro">
                      {info.head} <span className="opacity-50">→</span> {info.base}
                    </span>
                  ) : (
                    "…"
                  )
                }
                right={info?.author ?? ""}
              />
            </Section>
            {info?.checks && info.checks.total > 0 && (
              <Section label="Checks" right={`${info.checks.success}/${info.checks.total}`}>
                <Row icon={<CircleCheck className="text-ok size-3.5" />} label="Passing" right={String(info.checks.success)} />
                {info.checks.failure > 0 && <Row icon={<CircleX className="text-destructive size-3.5" />} label="Failing" right={String(info.checks.failure)} tone="text-destructive" />}
                {info.checks.pending > 0 && <Row icon={<CircleDashed className="text-muted-foreground size-3.5 animate-spin [animation-duration:3s]" />} label="Running" right={String(info.checks.pending)} />}
              </Section>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function verdict(info: PullInfo | null) {
  if (!info) return { title: "Pull request", short: "PR", icon: GitPullRequest, header: "bg-muted text-foreground", chip: "bg-muted text-muted-foreground", text: "text-muted-foreground", canMerge: false };
  if (info.state === "merged") return { title: "Merged", short: "merged", icon: GitMerge, header: "bg-sleep/12 text-sleep", chip: "bg-sleep/15 text-sleep", text: "text-sleep", canMerge: false };
  if (info.state === "closed") return { title: "Closed", short: "closed", icon: GitPullRequestClosed, header: "bg-destructive/8 text-destructive", chip: "bg-destructive/10 text-destructive", text: "text-destructive", canMerge: false };
  if (info.state === "draft") return { title: "Draft", short: "draft", icon: GitPullRequestDraft, header: "bg-muted text-foreground", chip: "bg-muted text-muted-foreground", text: "text-muted-foreground", canMerge: false };
  if (info.checks && info.checks.failure > 0) return { title: "Checks failing", short: "checks failing", icon: CircleX, header: "bg-destructive/8 text-destructive", chip: "bg-destructive/10 text-destructive", text: "text-destructive", canMerge: false };
  if (info.reviewDecision === "changes_requested") return { title: "Changes requested", short: "changes requested", icon: GitPullRequest, header: "bg-attention/15 text-attention-text", chip: "bg-attention/20 text-attention-text", text: "text-attention-text", canMerge: false };
  if (info.checks && info.checks.pending > 0) return { title: "Checks running", short: "checks running", icon: CircleDashed, header: "bg-live/10 text-live", chip: "bg-live/12 text-live", text: "text-live", canMerge: false };
  if (info.mergeable === false) return { title: "Merge conflicts", short: "conflicts", icon: GitPullRequest, header: "bg-attention/15 text-attention-text", chip: "bg-attention/20 text-attention-text", text: "text-attention-text", canMerge: false };
  return { title: "Ready to merge", short: "ready to merge", icon: GitPullRequest, header: "bg-ok/12 text-ok", chip: "bg-ok/15 text-ok", text: "text-ok", canMerge: true };
}

function reviewLabel(s: string) {
  return s === "approved" ? "Approved" : s === "changes_requested" ? "Changes requested" : s === "commented" ? "Commented" : "Review asked";
}

function Header({ info, v, url, session, repo, number, onMerged, onClose }: { info: PullInfo | null; v: ReturnType<typeof verdict>; url: string; session: string; repo: string; number: number; onMerged: () => void; onClose: () => void }) {
  const [armed, setArmed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 5000);
    return () => window.clearTimeout(t);
  }, [armed]);
  const merge = async () => {
    if (!armed) return setArmed(true);
    setBusy(true);
    try {
      await api.mergePull(session, repo, number);
      toast.success(`Merged #${number}`);
      onMerged();
    } catch (e) {
      toast.error("Merge failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
      setArmed(false);
    }
  };
  const Icon = v.icon;
  return (
    <div className={cn("flex items-center gap-2.5 rounded-xl px-3 py-2.5", v.header)}>
      <div className="min-w-0 flex-1">
        <p className="text-body font-semibold">{v.title}</p>
        <p className="stamp flex items-center gap-1.5 opacity-85">
          <Icon className="size-3" aria-hidden />#{number}
          {info?.checks?.total ? <span>· {info.checks.total} checks</span> : <span className="truncate">· {repo.split("/")[1]}</span>}
        </p>
      </div>
      <a href={url} target="_blank" rel="noreferrer noopener" aria-label="Open on GitHub" className="hover:bg-card/70 grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg transition-colors">
        <Globe className="size-4" aria-hidden />
      </a>
      {v.canMerge ? (
        <Button size="sm" onClick={() => void merge()} disabled={busy} className={cn("bg-ok hover:bg-ok/90 text-white", armed && "ring-ok/40 ring-2")}>
          {busy ? <Loader2 className="animate-spin" /> : <GitMerge />}
          {armed ? "Confirm merge" : "Merge"}
        </Button>
      ) : (
        <button type="button" onClick={onClose} aria-label="Close" className="hover:bg-card/70 grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg transition-colors">
          {info?.state === "merged" ? <Check className="size-4" aria-hidden /> : <X className="size-4" aria-hidden />}
        </button>
      )}
      {url.length === 0 && <ArrowUpRight className="hidden" />}
    </div>
  );
}

function Section({ label, right, children }: { label: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="px-2.5 pb-2">
      <div className="text-muted-foreground flex items-center justify-between pt-1.5 pb-1 text-meta">
        <span>{label}</span>
        {right && <span className="text-foreground">{right}</span>}
      </div>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function Row({ icon, label, right, tone }: { icon: React.ReactNode; label: React.ReactNode; right?: React.ReactNode; tone?: string }) {
  return (
    <div className="flex items-center gap-2 py-1 text-meta">
      <span className="text-muted-foreground grid size-[18px] shrink-0 place-items-center">{icon}</span>
      <span className="text-foreground min-w-0 flex-1 truncate">{label}</span>
      {right !== undefined && right !== "" && <span className={cn("text-muted-foreground shrink-0 tabular-nums", tone)}>{right}</span>}
    </div>
  );
}
