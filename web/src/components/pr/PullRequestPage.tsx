/**
 * The dedicated pull-request page: everything you'd read on the GitHub PR page, without leaving
 * the console. The thread's PR card stays the glance (state, +/−, merge); this is the place you
 * actually review — the description, the commits, the real diffs, the checks and the conversation,
 * plus the write actions (merge, approve, request changes, comment, close/reopen/ready).
 *
 * Deep-linkable at /dashboard/box/:name/pr/:owner/:repo/:number, so a review survives a reload and
 * can be pasted to someone else.
 *
 * The layout follows the console's own pages (Fleet, the thread header): a left-aligned h1 with a
 * tinted state pill and stamp-set machine data underneath, filter-chip section pills, hairline
 * divide-y cards, dashed empty states. No hero, one accent at a time, motion only where state moves.
 */
import * as React from "react";
import { ArrowLeft, ArrowUpRight, Check, CircleDashed, FileDiff, GitBranch, GitCommitHorizontal, MessageSquare, ShieldCheck, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { api, type PullDetail } from "@/lib/api";
import { diffForNewFile, parseUnifiedDiff, type ParsedDiff } from "@/lib/diff";
import { FileMark } from "@/lib/fileIcon";
import { useGo } from "@/lib/route";
import { cn } from "@/lib/utils";
import { DiffView } from "@/components/thread/FilePane";
import { Bar } from "@/components/thread/Skeletons";
import { Markdown } from "@/components/ui/markdown";
import { ApproveControl, CommentComposer, LifecycleControl, MergeControl, PolicyRescue } from "./PullActions";
import { reviewLabel, verdict, type MergeMethod, type Verdict } from "./verdict";

type Tab = "conversation" | "commits" | "files" | "checks";

export function PullRequestPage({ session, repo, number }: { session: string; repo: string; number: number }) {
  const go = useGo();
  const [pr, setPr] = React.useState<PullDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<Tab>("conversation");

  const load = React.useCallback(
    (signal?: AbortSignal) =>
      api
        .pullDetail(repo, number, signal)
        .then((d) => {
          setPr(d);
          setError(null);
        })
        .catch((e: unknown) => {
          if (signal?.aborted) return;
          setError(e instanceof Error ? e.message : String(e));
        }),
    [repo, number]
  );
  React.useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const v = verdict(pr);

  return (
    <div className="h-full min-w-0 overflow-y-auto">
      <div className="mx-auto max-w-[880px] px-5 py-7 md:px-8 md:py-9">
        {/* ---- header, in the Fleet page's shape: back, h1, meta line ---- */}
        <header className="mb-5">
          <button
            type="button"
            onClick={() => go({ view: "box", name: session })}
            className="text-muted-foreground hover:text-foreground -ml-1 mb-3 flex w-fit cursor-pointer items-center gap-1.5 rounded-md px-1 text-meta font-medium transition-colors"
          >
            <ArrowLeft className="size-4" aria-hidden />
            <span className="stamp">{session}</span>
          </button>

          {error && !pr ? (
            <div role="alert" className="border-destructive/30 bg-destructive/8 mb-4 rounded-xl border px-4 py-3">
              <p className="text-destructive text-meta font-medium">Couldn't load this pull request</p>
              <p className="text-foreground/80 mt-1 text-micro whitespace-pre-wrap">{error}</p>
            </div>
          ) : null}

          <h1 className="text-foreground text-h1 font-semibold tracking-[-0.02em] break-words">
            {pr?.title ?? <Bar className="inline-block h-6 w-80 max-w-full align-middle" />}
            <span className="text-faint ml-2.5 font-normal tracking-normal">#{number}</span>
          </h1>

          {/* The meta line, the thread header's idiom: state pill first, then stamp-set data. */}
          <div className="text-muted-foreground mt-2 flex min-h-6 flex-wrap items-center gap-x-2.5 gap-y-1.5 text-meta">
            <StatusPill v={v} />
            {pr && (
              <>
                <span>
                  <b className="text-foreground font-medium">{pr.author ?? "someone"}</b> wants to merge{" "}
                  {pr.commits?.length ?? 0} {(pr.commits?.length ?? 0) === 1 ? "commit" : "commits"}
                </span>
                <span className="stamp bg-muted text-foreground inline-flex max-w-full min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5">
                  <GitBranch className="size-3 shrink-0 opacity-60" aria-hidden />
                  <span className="truncate">{pr.head}</span>
                  <span className="text-muted-foreground shrink-0">→</span>
                  <span className="truncate">{pr.base}</span>
                </span>
                <a
                  href={pr.url ?? `https://github.com/${repo}/pull/${number}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="hover:text-foreground flex items-center gap-0.5 text-micro font-medium transition-colors"
                >
                  {repo}
                  <ArrowUpRight className="size-3" aria-hidden />
                </a>
              </>
            )}
          </div>
          {!!pr?.labels?.length && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {pr.labels.map((l) => (
                <span key={l.name} className="label rounded-full border px-2 py-0.5" style={l.color ? { borderColor: `#${l.color}55`, color: `#${l.color}` } : undefined}>
                  {l.name}
                </span>
              ))}
            </div>
          )}
        </header>

        {/* ---- actions ---- */}
        {pr && <ActionBar pr={pr} v={v} session={session} repo={repo} number={number} onChanged={() => void load()} />}

        {/* ---- section pills, the Fleet filter-chip idiom ---- */}
        <div role="tablist" aria-label="Pull request sections" className="scrollbar-none mt-6 mb-3 flex items-center gap-1 overflow-x-auto">
          <SectionChip on={tab === "conversation"} onClick={() => setTab("conversation")} icon={MessageSquare} label="Conversation" count={pr ? (pr.comments?.length ?? 0) + 1 : undefined} />
          <SectionChip on={tab === "commits"} onClick={() => setTab("commits")} icon={GitCommitHorizontal} label="Commits" count={pr?.commits?.length} />
          <SectionChip on={tab === "files"} onClick={() => setTab("files")} icon={FileDiff} label="Files changed" count={pr?.files?.length} />
          <SectionChip on={tab === "checks"} onClick={() => setTab("checks")} icon={ShieldCheck} label="Checks" count={pr?.checkRuns?.length} />
        </div>

        {!pr ? (
          <div className="overflow-hidden rounded-xl border">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-4 border-b px-4 py-4 last:border-b-0">
                <Bar className="h-2.5 w-24" />
                <Bar className="h-3 flex-1" />
                <Bar className="h-3 w-24" />
              </div>
            ))}
          </div>
        ) : tab === "conversation" ? (
          <Conversation pr={pr} session={session} repo={repo} number={number} onPosted={() => void load()} />
        ) : tab === "commits" ? (
          <Commits pr={pr} repo={repo} />
        ) : tab === "files" ? (
          <Files pr={pr} />
        ) : (
          <Checks pr={pr} />
        )}
      </div>
    </div>
  );
}

/** The verdict as a StatePill: tinted, ringed, icon + word, breathing only while checks run. */
function StatusPill({ v }: { v: Verdict }) {
  const Icon = v.icon;
  return (
    <span className={cn("label inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 font-medium ring-1 ring-inset", v.chip, v.live ? "ring-live/20" : "ring-current/15")}>
      <Icon className={cn("size-3 shrink-0", v.live && "breathe")} aria-hidden />
      {v.title}
    </span>
  );
}

/** A section switcher in the Fleet's FilterChip shape: pill, count badge, active = inked. */
function SectionChip({ on, onClick, icon: Icon, label, count }: { on: boolean; onClick: () => void; icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>; label: string; count?: number }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      onClick={onClick}
      className={cn(
        "flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-meta font-medium transition-[background-color,border-color,color,transform] duration-150",
        on ? "border-foreground/20 bg-foreground text-background" : "bg-card text-muted-foreground hover:text-foreground hover:border-line-strong active:scale-[0.97]"
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {label}
      {count !== undefined && (
        <span className={cn("tabular rounded-full px-1.5 py-px text-micro font-semibold", on ? "bg-background/20 text-background" : "bg-muted text-muted-foreground")}>{count}</span>
      )}
    </button>
  );
}

/** Merge (or the reason you can't), approve, and the lifecycle verbs, in one band under the header. */
function ActionBar({ pr, v, session, repo, number, onChanged }: { pr: PullDetail; v: Verdict; session: string; repo: string; number: number; onChanged: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const policyBlocked = !!error && /policy prohibits|--auto/.test(error);
  const merge = async (method: MergeMethod, auto: boolean, admin = false) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.mergePull(session, repo, number, { method, auto, admin });
      toast.success(r.auto ? `Auto-merge armed for #${number}` : `Merged #${number}`);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  if (pr.state === "merged") return null;
  return (
    <div className="rounded-xl border p-2.5">
      {v.canMerge ? (
        <MergeControl busy={busy} onMerge={(m, a) => void merge(m, a)} />
      ) : (
        pr.state === "open" && v.blocked && <p className="text-muted-foreground px-1.5 pt-0.5 pb-1 text-meta">{v.blocked}</p>
      )}
      {error && (
        <div role="alert" className="border-destructive/30 bg-destructive/8 mx-1.5 mt-2 rounded-lg border px-2.5 py-2">
          <p className="text-destructive text-micro font-medium">Merge failed</p>
          <p className="text-foreground/80 mt-0.5 text-micro whitespace-pre-wrap">{error}</p>
          {policyBlocked && <PolicyRescue busy={busy} onAuto={() => void merge("merge", true)} onAdmin={() => void merge("merge", false, true)} />}
        </div>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-2 px-1.5 pb-0.5">
        {pr.state === "open" && pr.reviewDecision !== "approved" && <ApproveControl session={session} repo={repo} number={number} onApproved={onChanged} />}
        <LifecycleControl session={session} repo={repo} number={number} state={pr.state} onDone={onChanged} />
      </div>
    </div>
  );
}

function Conversation({ pr, session, repo, number, onPosted }: { pr: PullDetail; session: string; repo: string; number: number; onPosted: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <Comment author={pr.author} at={pr.createdAt} body={pr.body?.trim() || "_No description provided._"} />
      {pr.comments?.map((c) => (
        <Comment key={c.id} author={c.author} at={c.at} body={c.body} verdict={c.kind === "review" ? c.state : undefined} />
      ))}
      {!!pr.reviewers?.length && (
        <section className="rounded-xl border px-4 py-3">
          <h2 className="label text-muted-foreground mb-2">Reviewers</h2>
          <div className="flex flex-col gap-1.5">
            {pr.reviewers.map((r) => (
              <div key={r.login} className="flex items-center gap-2 text-meta">
                <img src={`https://github.com/${encodeURIComponent(r.login)}.png?size=40`} alt="" width={20} height={20} className="bg-muted size-5 rounded-full" loading="lazy" />
                <span className="text-foreground flex-1 truncate">{r.login}</span>
                <span className={cn("label", r.state === "approved" ? "text-ok" : r.state === "changes_requested" ? "text-destructive" : "text-muted-foreground")}>{reviewLabel(r.state)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      {pr.state !== "merged" && <CommentComposer session={session} repo={repo} number={number} onPosted={onPosted} />}
    </div>
  );
}

/** One authored body — the PR description or a comment — rendered with the same markdown as chat. */
function Comment({ author, at, body, verdict: v }: { author?: string; at?: string; body: string; verdict?: string }) {
  return (
    <article className="overflow-hidden rounded-xl border">
      <div className="flex items-center gap-2 border-b px-3.5 py-2">
        {author && <img src={`https://github.com/${encodeURIComponent(author)}.png?size=40`} alt="" width={20} height={20} className="bg-muted size-5 rounded-full" loading="lazy" />}
        <span className="text-foreground text-meta font-medium">{author ?? "unknown"}</span>
        {v && <span className={cn("label", v === "approved" ? "text-ok" : v === "changes_requested" ? "text-destructive" : "text-muted-foreground")}>{reviewLabel(v)}</span>}
        {at && (
          <time dateTime={at} title={new Date(at).toLocaleString()} className="stamp text-faint ml-auto">
            {relativeTime(at)}
          </time>
        )}
      </div>
      <div className="prose-agent text-foreground px-3.5 py-2.5">
        <Markdown>{body}</Markdown>
      </div>
    </article>
  );
}

/** "3d ago" beats a raw locale timestamp in a timeline; the exact time stays in the title. */
function relativeTime(at: string): string {
  const s = (Date.now() - new Date(at).getTime()) / 1000;
  if (!Number.isFinite(s) || s < 0) return new Date(at).toLocaleDateString();
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(at).toLocaleDateString();
}

function Commits({ pr, repo }: { pr: PullDetail; repo: string }) {
  if (!pr.commits?.length) return <Empty>No commits on this pull request.</Empty>;
  return (
    <ul className="divide-y overflow-hidden rounded-xl border">
      {pr.commits.map((c) => (
        <li key={c.sha} className="hover:bg-muted/40 flex items-center gap-3 px-3.5 py-2.5 transition-colors">
          <GitCommitHorizontal className="text-muted-foreground size-4 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            {/* Only the subject line: a commit body belongs in the diff, not in a list row. */}
            <p className="text-foreground truncate text-meta font-medium">{c.message.split("\n")[0]}</p>
            <p className="text-muted-foreground mt-0.5 text-micro">
              {c.author ?? "unknown"}
              {c.date ? ` · ${relativeTime(c.date)}` : ""}
            </p>
          </div>
          <a href={`https://github.com/${repo}/commit/${c.sha}`} target="_blank" rel="noreferrer noopener" className="stamp bg-muted text-muted-foreground hover:text-foreground shrink-0 rounded-md px-1.5 py-0.5 transition-colors">
            {c.sha.slice(0, 7)}
          </a>
        </li>
      ))}
    </ul>
  );
}

function Files({ pr }: { pr: PullDetail }) {
  const [open, setOpen] = React.useState<string | null>(null);
  if (!pr.files?.length) return <Empty>No files changed.</Empty>;
  return (
    <div className="flex flex-col gap-2">
      <p className="stamp text-muted-foreground px-1">
        {pr.files.length} {pr.files.length === 1 ? "file" : "files"} · <span className="text-ok">+{pr.additions}</span> <span className="text-destructive">−{pr.deletions}</span>
        {pr.truncated && <span className="text-attention-text"> · truncated, open on GitHub for the rest</span>}
      </p>
      <div className="divide-y overflow-hidden rounded-xl border">
        {pr.files.map((f) => {
          const on = open === f.path;
          return (
            <div key={f.path}>
              <button type="button" onClick={() => setOpen(on ? null : f.path)} aria-expanded={on} className="hover:bg-muted/40 flex w-full cursor-pointer items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors">
                <FileMark path={f.path} className="size-4 shrink-0" />
                <span className="stamp text-foreground min-w-0 flex-1 truncate">{f.path}</span>
                {f.status !== "modified" && <span className="label text-faint shrink-0">{f.status}</span>}
                <span className="stamp shrink-0">
                  <span className="text-ok">+{f.additions}</span> <span className="text-destructive">−{f.deletions}</span>
                </span>
              </button>
              <AnimatePresence initial={false}>
                {on && (
                  <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
                    <FilePatch file={f} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** One file's patch through the same parser and two-gutter renderer the thread's file pane uses. */
function FilePatch({ file }: { file: NonNullable<PullDetail["files"]>[number] }) {
  const parsed: ParsedDiff | null = React.useMemo(() => {
    if (!file.patch) return null;
    // The API returns hunks WITHOUT the `diff --git`/`+++` preamble parseUnifiedDiff tolerates,
    // which is fine — it keys off `@@`. An added file with no patch is still worth showing empty.
    return file.status === "added" && !file.patch.startsWith("@@") ? diffForNewFile(file.patch) : parseUnifiedDiff(file.patch);
  }, [file.patch, file.status]);
  if (!parsed) return <p className="text-muted-foreground border-t px-3.5 py-3 text-meta">No textual diff — the file is binary or too large to inline.</p>;
  return (
    <div className="max-h-[32rem] overflow-auto border-t">
      <DiffView diff={parsed} path={file.path} />
    </div>
  );
}

function Checks({ pr }: { pr: PullDetail }) {
  if (!pr.checkRuns?.length) return <Empty>No checks reported on the head commit.</Empty>;
  return (
    <ul className="divide-y overflow-hidden rounded-xl border">
      {pr.checkRuns.map((c, i) => {
        const running = c.status !== "completed";
        const ok = ["success", "neutral", "skipped"].includes(c.conclusion ?? "");
        const inner = (
          <>
            {running ? (
              <CircleDashed className="text-live size-3 shrink-0 breathe" aria-hidden strokeWidth={2.5} />
            ) : ok ? (
              <Check className="text-ok size-3 shrink-0" aria-hidden strokeWidth={2.5} />
            ) : (
              <X className="text-destructive size-3 shrink-0" aria-hidden strokeWidth={2.5} />
            )}
            <span className="text-foreground min-w-0 flex-1 truncate text-meta">{c.name}</span>
            <span className={cn("label shrink-0", running ? "text-live" : ok ? "text-ok" : "text-destructive")}>{running ? "running" : (c.conclusion ?? "done")}</span>
            {c.url && <ArrowUpRight className="text-faint size-3.5 shrink-0" aria-hidden />}
          </>
        );
        return (
          <li key={`${c.name}-${i}`}>
            {c.url ? (
              <a href={c.url} target="_blank" rel="noreferrer noopener" className="hover:bg-muted/40 flex items-center gap-2.5 px-3.5 py-2.5 transition-colors">
                {inner}
              </a>
            ) : (
              <div className="flex items-center gap-2.5 px-3.5 py-2.5">{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed py-12 text-center">
      <p className="text-muted-foreground text-meta">{children}</p>
    </div>
  );
}
