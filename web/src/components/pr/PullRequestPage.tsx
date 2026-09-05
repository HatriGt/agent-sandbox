/**
 * The dedicated pull-request page: everything you'd read on the GitHub PR page, without leaving
 * the console. The thread's PR card stays the glance (state, +/−, merge); this is the place you
 * actually review — the description, the commits, the real diffs, the checks and the conversation,
 * plus the write actions (merge, approve, request changes, comment, close/reopen/ready).
 *
 * Deep-linkable at /dashboard/box/:name/pr/:owner/:repo/:number, so a review survives a reload and
 * can be pasted to someone else.
 *
 * The design centers on ONE painted element — the verdict orb, a soft glowing disc in the state's
 * hue with an ambient halo that breathes only while checks run. Everything else stays in the
 * console's quiet vocabulary: hairline cards, one accent at a time, motion only where state moves.
 */
import * as React from "react";
import { ArrowLeft, ArrowUpRight, CircleCheck, CircleDashed, CircleX, FileDiff, GitBranch, GitCommitHorizontal, MessageSquare, ShieldCheck, Users } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { api, type PullDetail } from "@/lib/api";
import { diffForNewFile, parseUnifiedDiff, type ParsedDiff } from "@/lib/diff";
import { FileMark } from "@/lib/fileIcon";
import { useGo } from "@/lib/route";
import { cn } from "@/lib/utils";
import { DiffView } from "@/components/thread/FilePane";
import { Markdown } from "@/components/ui/markdown";
import { PageEnter } from "@/components/ui/page";
import { ApproveControl, CommentComposer, LifecycleControl, MergeControl, PolicyRescue } from "./PullActions";
import { reviewLabel, verdict, type MergeMethod, type Verdict } from "./verdict";

type Tab = "conversation" | "commits" | "files" | "checks";
const EASE = [0.22, 1, 0.36, 1] as const;

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
  const back = () => go({ view: "box", name: session });
  const failing = pr?.checkRuns?.filter((c) => c.status === "completed" && !["success", "neutral", "skipped"].includes(c.conclusion ?? "")).length ?? 0;

  return (
    <PageEnter className="mx-auto flex w-full max-w-4xl flex-col px-4 py-6 sm:px-6">
      {/* ---- breadcrumb row ---- */}
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={back} className="text-muted-foreground hover:text-foreground group flex w-fit cursor-pointer items-center gap-1.5 text-meta font-medium transition-colors">
          <ArrowLeft className="size-3.5 transition-transform duration-200 group-hover:-translate-x-0.5" aria-hidden />
          {session}
        </button>
        <a
          href={pr?.url ?? `https://github.com/${repo}/pull/${number}`}
          target="_blank"
          rel="noreferrer noopener"
          className="text-muted-foreground hover:text-foreground group flex shrink-0 items-center gap-1 text-micro font-medium transition-colors"
        >
          Open on GitHub
          <ArrowUpRight className="size-3 transition-transform duration-200 group-hover:translate-x-px group-hover:-translate-y-px" aria-hidden />
        </a>
      </div>

      {error && !pr ? (
        <div role="alert" className="border-destructive/30 bg-destructive/8 mt-4 rounded-xl border px-4 py-3">
          <p className="text-destructive text-meta font-medium">Couldn't load this pull request</p>
          <p className="text-foreground/80 mt-1 text-micro whitespace-pre-wrap">{error}</p>
        </div>
      ) : null}

      {/* ---- hero: the verdict orb, the title, the branch line ---- */}
      <header className="mt-6 flex flex-col items-center text-center">
        <VerdictOrb v={v} />
        <p className={cn("mt-4 flex items-center gap-1.5 text-meta font-semibold", v.text)}>
          {v.title}
          <span className="text-faint font-mono text-micro font-normal tabular-nums">#{number}</span>
        </p>
        <h1 className="text-foreground mt-1.5 max-w-2xl text-h1 font-semibold tracking-[-0.02em] text-balance break-words">
          {pr?.title ?? <span className="bg-muted inline-block h-7 w-80 max-w-full animate-pulse rounded-md align-middle" />}
        </h1>
        {pr && (
          <p className="text-muted-foreground mt-2 text-meta">
            {pr.author ? <b className="text-foreground font-medium">{pr.author}</b> : "someone"} wants to merge into{" "}
            <BranchChip name={pr.base} /> from <BranchChip name={pr.head} />
          </p>
        )}
        {!!pr?.labels?.length && (
          <div className="mt-3 flex flex-wrap justify-center gap-1.5">
            {pr.labels.map((l) => (
              <span key={l.name} className="rounded-full border px-2 py-0.5 text-micro font-medium" style={l.color ? { borderColor: `#${l.color}55`, color: `#${l.color}`, backgroundColor: `#${l.color}14` } : undefined}>
                {l.name}
              </span>
            ))}
          </div>
        )}
      </header>

      {/* ---- stat strip: the four numbers a reviewer triages by ---- */}
      {pr && (
        <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Commits" value={String(pr.commits?.length ?? 0)} onClick={() => setTab("commits")} />
          <Stat label="Files changed" value={String(pr.files?.length ?? pr.changedFiles ?? 0)} onClick={() => setTab("files")} />
          <Stat
            label="Lines"
            value={
              <>
                <span className="text-ok">+{pr.additions}</span> <span className="text-destructive">−{pr.deletions}</span>
              </>
            }
            onClick={() => setTab("files")}
          />
          <Stat
            label="Checks"
            value={
              pr.checks?.total ? (
                <span className={failing ? "text-destructive" : pr.checks.pending ? "text-live" : "text-ok"}>
                  {pr.checks.success}/{pr.checks.total}
                </span>
              ) : (
                "—"
              )
            }
            onClick={() => setTab("checks")}
          />
        </div>
      )}

      {/* ---- actions ---- */}
      {pr && <ActionBar pr={pr} v={v} session={session} repo={repo} number={number} onChanged={() => void load()} />}

      {/* ---- tabs ---- */}
      <div role="tablist" aria-label="Pull request sections" className="mt-7 flex w-full max-w-full gap-1 overflow-x-auto border-b pb-px">
        <TabButton on={tab === "conversation"} onClick={() => setTab("conversation")} icon={<MessageSquare className="size-3.5" />} label="Conversation" count={pr?.comments?.length} />
        <TabButton on={tab === "commits"} onClick={() => setTab("commits")} icon={<GitCommitHorizontal className="size-3.5" />} label="Commits" count={pr?.commits?.length} />
        <TabButton on={tab === "files"} onClick={() => setTab("files")} icon={<FileDiff className="size-3.5" />} label="Files changed" count={pr?.files?.length} />
        <TabButton on={tab === "checks"} onClick={() => setTab("checks")} icon={<ShieldCheck className="size-3.5" />} label="Checks" count={pr?.checkRuns?.length} />
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18, ease: EASE }} className="mt-4">
          {!pr ? (
            <div className="flex flex-col gap-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="bg-muted h-16 animate-pulse rounded-xl" style={{ opacity: 1 - i * 0.25 }} />
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
        </motion.div>
      </AnimatePresence>
    </PageEnter>
  );
}

/**
 * The page's one painted element: the PR's state as a soft glowing disc in the verdict's hue,
 * ringed by two ambient halos. The halo breathes only while the state is actually in motion
 * (checks running) — a settled PR sits still.
 */
function VerdictOrb({ v }: { v: Verdict }) {
  const Icon = v.icon;
  return (
    <div className="relative grid size-20 place-items-center" role="img" aria-label={v.title}>
      {/* ambient glow, clipped to nothing at reduced motion since it's decorative */}
      <span aria-hidden className={cn("absolute inset-0 rounded-full blur-2xl", v.live && "wake-halo")} style={{ backgroundColor: v.hue, opacity: 0.28 }} />
      <span aria-hidden className="absolute inset-1 rounded-full border" style={{ borderColor: `color-mix(in oklab, ${v.hue} 35%, transparent)` }} />
      <span aria-hidden className="absolute inset-3.5 rounded-full border" style={{ borderColor: `color-mix(in oklab, ${v.hue} 20%, transparent)` }} />
      <motion.span
        key={v.title}
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 26 }}
        className="relative grid size-11 place-items-center rounded-full text-white shadow-e2"
        style={{ background: `radial-gradient(circle at 32% 28%, color-mix(in oklab, ${v.hue} 65%, white), ${v.hue})` }}
      >
        <Icon className="size-5" aria-hidden />
      </motion.span>
    </div>
  );
}

function BranchChip({ name }: { name: string }) {
  return (
    <span className="bg-muted text-foreground inline-flex max-w-56 items-center gap-1 rounded-md px-1.5 py-px align-middle font-mono text-micro">
      <GitBranch className="size-2.5 shrink-0 opacity-60" aria-hidden />
      <span className="truncate">{name}</span>
    </span>
  );
}

function Stat({ label, value, onClick }: { label: string; value: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="hover:border-line-strong group cursor-pointer rounded-xl border px-3.5 py-2.5 text-left transition-colors">
      <span className="text-foreground block text-h3 font-semibold tracking-[-0.01em] tabular-nums">{value}</span>
      <span className="text-muted-foreground group-hover:text-foreground block text-micro transition-colors">{label}</span>
    </button>
  );
}

function TabButton({ on, onClick, icon, label, count }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string; count?: number }) {
  return (
    <button type="button" role="tab" aria-selected={on} onClick={onClick} className={cn("relative flex h-9 shrink-0 cursor-pointer items-center gap-1.5 px-3 text-meta font-medium transition-colors", on ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
      {icon}
      {label}
      {count !== undefined && <span className={cn("bg-muted rounded-full px-1.5 py-px text-micro tabular-nums", on ? "text-foreground" : "text-faint")}>{count}</span>}
      {on && <motion.span layoutId="pr-tab" className="bg-foreground absolute inset-x-2 -bottom-px h-0.5 rounded-full" transition={{ type: "spring", stiffness: 500, damping: 40 }} aria-hidden />}
    </button>
  );
}

/** Merge (or the reason you can't), approve, and the lifecycle verbs, in one band under the stats. */
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
  if (pr.state === "merged" || (pr.state === "closed" && !v.blocked)) {
    // Terminal states need only reopen (LifecycleControl handles it) — no empty merge band.
    return (
      <div className="mt-4 flex justify-center">
        <LifecycleControl session={session} repo={repo} number={number} state={pr.state} onDone={onChanged} />
      </div>
    );
  }
  return (
    <div className="raised bg-card mt-4 rounded-xl border p-2.5">
      {v.canMerge ? (
        <MergeControl busy={busy} onMerge={(m, a) => void merge(m, a)} />
      ) : (
        v.blocked && (
          <p className="text-muted-foreground flex items-start gap-2 px-1.5 pt-1 pb-1.5 text-meta">
            <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full" style={{ backgroundColor: v.hue }} />
            {v.blocked}
          </p>
        )
      )}
      {error && (
        <div role="alert" className="border-destructive/30 bg-destructive/8 mx-1.5 mt-2 rounded-lg border px-2.5 py-2">
          <p className="text-destructive text-micro font-medium">Merge failed</p>
          <p className="text-foreground/80 mt-0.5 text-micro whitespace-pre-wrap">{error}</p>
          {policyBlocked && <PolicyRescue busy={busy} onAuto={() => void merge("merge", true)} onAdmin={() => void merge("merge", false, true)} />}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2 px-1.5 pb-1">
        {pr.state === "open" && pr.reviewDecision !== "approved" && <ApproveControl session={session} repo={repo} number={number} onApproved={onChanged} />}
        <LifecycleControl session={session} repo={repo} number={number} state={pr.state} onDone={onChanged} />
      </div>
    </div>
  );
}

function Conversation({ pr, session, repo, number, onPosted }: { pr: PullDetail; session: string; repo: string; number: number; onPosted: () => void }) {
  return (
    <div className="flex flex-col">
      {/* the timeline: a hairline rail threads the avatars, so the conversation reads as one flow */}
      <div className="relative flex flex-col gap-4">
        <span aria-hidden className="bg-border absolute top-4 bottom-4 left-[13px] w-px" />
        <TimelineItem author={pr.author} at={pr.createdAt} body={pr.body?.trim() || "_No description provided._"} />
        {pr.comments?.map((c) => (
          <TimelineItem key={c.id} author={c.author} at={c.at} body={c.body} verdict={c.kind === "review" ? c.state : undefined} />
        ))}
      </div>
      {!!pr.reviewers?.length && (
        <section className="mt-4 rounded-xl border px-4 py-3">
          <p className="text-muted-foreground mb-2 flex items-center gap-1.5 text-micro font-medium tracking-wide uppercase">
            <Users className="size-3" aria-hidden /> Reviewers
          </p>
          <div className="flex flex-col gap-2">
            {pr.reviewers.map((r) => (
              <div key={r.login} className="flex items-center gap-2.5 text-meta">
                <img src={`https://github.com/${encodeURIComponent(r.login)}.png?size=48`} alt="" width={22} height={22} className="bg-muted size-[22px] rounded-full" loading="lazy" />
                <span className="text-foreground flex-1 truncate font-medium">{r.login}</span>
                <ReviewBadge state={r.state} />
              </div>
            ))}
          </div>
        </section>
      )}
      {pr.state !== "merged" && (
        <div className="mt-4">
          <CommentComposer session={session} repo={repo} number={number} onPosted={onPosted} />
        </div>
      )}
    </div>
  );
}

function ReviewBadge({ state }: { state: string }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-micro font-medium",
        state === "approved" ? "bg-ok/10 text-ok" : state === "changes_requested" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"
      )}
    >
      {reviewLabel(state)}
    </span>
  );
}

/** One authored body on the timeline — the PR description or a comment — with the chat's markdown. */
function TimelineItem({ author, at, body, verdict: v }: { author?: string; at?: string; body: string; verdict?: string }) {
  return (
    <article className="relative flex gap-3">
      {author ? (
        <img src={`https://github.com/${encodeURIComponent(author)}.png?size=56`} alt="" width={28} height={28} className="bg-muted ring-background relative z-10 mt-1 size-7 shrink-0 rounded-full ring-4" loading="lazy" />
      ) : (
        <span aria-hidden className="bg-muted ring-background relative z-10 mt-1 size-7 shrink-0 rounded-full ring-4" />
      )}
      <div className="raised bg-card min-w-0 flex-1 overflow-hidden rounded-xl border">
        <div className="flex items-baseline gap-2 px-3.5 pt-2.5">
          <span className="text-foreground truncate text-meta font-semibold">{author ?? "unknown"}</span>
          {v && <ReviewBadge state={v} />}
          {at && (
            <time dateTime={at} title={new Date(at).toLocaleString()} className="text-faint ml-auto shrink-0 text-micro">
              {relativeTime(at)}
            </time>
          )}
        </div>
        <div className="prose-agent text-foreground px-3.5 pt-1 pb-3">
          <Markdown>{body}</Markdown>
        </div>
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
    <div className="relative flex flex-col gap-2.5">
      {/* the same rail idiom as the conversation — commits are a timeline too */}
      <span aria-hidden className="bg-border absolute top-3 bottom-3 left-[13px] w-px" />
      {pr.commits.map((c) => (
        <div key={c.sha} className="relative flex items-center gap-3">
          <span aria-hidden className="border-line-strong bg-background ring-background relative z-10 ml-2 grid size-[11px] shrink-0 place-items-center rounded-full border-2 ring-4" />
          <a href={`https://github.com/${repo}/commit/${c.sha}`} target="_blank" rel="noreferrer noopener" className="hover:border-line-strong group flex min-w-0 flex-1 items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-colors">
            <div className="min-w-0 flex-1">
              {/* Only the subject line: a commit body belongs in the diff, not in a list row. */}
              <p className="text-foreground truncate text-meta font-medium">{c.message.split("\n")[0]}</p>
              <p className="text-muted-foreground mt-0.5 text-micro">
                {c.author ?? "unknown"}
                {c.date ? ` · ${relativeTime(c.date)}` : ""}
              </p>
            </div>
            <code className="bg-muted text-muted-foreground group-hover:text-foreground shrink-0 rounded-md px-1.5 py-0.5 font-mono text-micro transition-colors">{c.sha.slice(0, 7)}</code>
          </a>
        </div>
      ))}
    </div>
  );
}

function Files({ pr }: { pr: PullDetail }) {
  const [open, setOpen] = React.useState<string | null>(null);
  if (!pr.files?.length) return <Empty>No files changed.</Empty>;
  const total = pr.additions + pr.deletions;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pb-1">
        <p className="text-muted-foreground text-meta">
          {pr.files.length} {pr.files.length === 1 ? "file" : "files"} · <span className="text-ok font-medium">+{pr.additions}</span>{" "}
          <span className="text-destructive font-medium">−{pr.deletions}</span>
          {pr.truncated && <span className="text-attention-text"> · truncated, open on GitHub for the rest</span>}
        </p>
        {/* the +/− balance as a tiny two-tone bar, the classic diffstat at a glance */}
        {total > 0 && (
          <span aria-hidden className="flex h-1.5 w-24 overflow-hidden rounded-full">
            <span className="bg-ok" style={{ width: `${(pr.additions / total) * 100}%` }} />
            <span className="bg-destructive flex-1" />
          </span>
        )}
      </div>
      {pr.files.map((f) => {
        const on = open === f.path;
        return (
          <div key={f.path} className={cn("overflow-hidden rounded-xl border transition-colors", on && "border-line-strong")}>
            <button type="button" onClick={() => setOpen(on ? null : f.path)} aria-expanded={on} className="hover:bg-muted/50 flex w-full cursor-pointer items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors">
              <FileMark path={f.path} className="size-4 shrink-0" />
              <span className="text-foreground min-w-0 flex-1 truncate font-mono text-micro">{f.path}</span>
              {f.status !== "modified" && <span className="text-faint shrink-0 text-micro">{f.status}</span>}
              <span className="shrink-0 text-micro font-medium tabular-nums">
                <span className="text-ok">+{f.additions}</span> <span className="text-destructive">−{f.deletions}</span>
              </span>
            </button>
            <AnimatePresence initial={false}>
              {on && (
                <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} transition={{ duration: 0.22, ease: EASE }} className="overflow-hidden">
                  <FilePatch file={f} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
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
    <ul className="flex flex-col gap-2">
      {pr.checkRuns.map((c, i) => {
        const running = c.status !== "completed";
        const ok = ["success", "neutral", "skipped"].includes(c.conclusion ?? "");
        const Row = c.url ? "a" : "div";
        return (
          <li key={`${c.name}-${i}`}>
            <Row
              {...(c.url ? { href: c.url, target: "_blank", rel: "noreferrer noopener" } : {})}
              className={cn("group flex items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-colors", c.url && "hover:border-line-strong cursor-pointer")}
            >
              {running ? (
                <CircleDashed className="text-live size-4 shrink-0 animate-spin [animation-duration:3s]" aria-hidden />
              ) : ok ? (
                <CircleCheck className="text-ok size-4 shrink-0" aria-hidden />
              ) : (
                <CircleX className="text-destructive size-4 shrink-0" aria-hidden />
              )}
              <span className="text-foreground min-w-0 flex-1 truncate text-meta font-medium">{c.name}</span>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-micro font-medium",
                  running ? "bg-live/10 text-live" : ok ? "bg-ok/10 text-ok" : "bg-destructive/10 text-destructive"
                )}
              >
                {running ? "running" : (c.conclusion ?? "done")}
              </span>
              {c.url && <ArrowUpRight className="text-faint group-hover:text-foreground size-3.5 shrink-0 transition-colors" aria-hidden />}
            </Row>
          </li>
        );
      })}
    </ul>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-10 text-center">
      <span aria-hidden className="bg-muted grid size-9 place-items-center rounded-full">
        <CircleDashed className="text-muted-foreground size-4" />
      </span>
      <p className="text-muted-foreground text-meta">{children}</p>
    </div>
  );
}
