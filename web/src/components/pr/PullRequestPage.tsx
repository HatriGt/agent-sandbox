/**
 * The dedicated pull-request page: everything you'd read on the GitHub PR page, without leaving
 * the console. The thread's PR card stays the glance (state, +/−, merge); this is the place you
 * actually review — the description, the commits, the real diffs, the checks and the conversation,
 * plus the write actions (merge, approve, request changes, comment, close/reopen/ready).
 *
 * Deep-linkable at /dashboard/box/:name/pr/:owner/:repo/:number, so a review survives a reload and
 * can be pasted to someone else.
 */
import * as React from "react";
import { ArrowLeft, CircleCheck, CircleDashed, CircleX, ExternalLink, FileDiff, GitBranch, GitCommitHorizontal, Globe, MessageSquare, ShieldCheck, Users } from "lucide-react";
import { api, type PullDetail } from "@/lib/api";
import { diffForNewFile, parseUnifiedDiff, type ParsedDiff } from "@/lib/diff";
import { FileMark } from "@/lib/fileIcon";
import { useGo } from "@/lib/route";
import { cn } from "@/lib/utils";
import { DiffView } from "@/components/thread/FilePane";
import { Markdown } from "@/components/ui/markdown";
import { PageEnter } from "@/components/ui/page";
import { ApproveControl, CommentComposer, LifecycleControl, MergeControl, PolicyRescue } from "./PullActions";
import { reviewLabel, verdict, type MergeMethod } from "./verdict";
import { toast } from "sonner";

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
  const Icon = v.icon;
  const back = () => go({ view: "box", name: session });

  return (
    <PageEnter className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-5 sm:px-6">
      <button type="button" onClick={back} className="text-muted-foreground hover:text-foreground flex w-fit cursor-pointer items-center gap-1.5 text-meta font-medium transition-colors">
        <ArrowLeft className="size-3.5" aria-hidden />
        Back to the thread
      </button>

      {error && !pr ? (
        <div role="alert" className="border-destructive/30 bg-destructive/8 rounded-xl border px-4 py-3">
          <p className="text-destructive text-meta font-medium">Couldn't load this pull request</p>
          <p className="text-foreground/80 mt-1 text-micro whitespace-pre-wrap">{error}</p>
        </div>
      ) : null}

      {/* ---- header ---- */}
      <header className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <span className={cn("mt-0.5 grid size-9 shrink-0 place-items-center rounded-full", v.chip)}>
            <Icon className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-foreground text-title font-semibold break-words">
              {pr?.title ?? <span className="bg-muted inline-block h-5 w-72 max-w-full animate-pulse rounded align-middle" />}
            </h1>
            <p className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-meta">
              <span className={cn("font-medium", v.text)}>{v.title}</span>
              <span aria-hidden>·</span>
              <span className="tabular-nums">#{number}</span>
              {pr && (
                <>
                  <span aria-hidden>·</span>
                  <span>
                    {pr.author ? <b className="text-foreground font-medium">{pr.author}</b> : "someone"} wants to merge {pr.commits?.length ?? 0}{" "}
                    {(pr.commits?.length ?? 0) === 1 ? "commit" : "commits"}
                  </span>
                </>
              )}
            </p>
            {pr && (
              <p className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-1.5 font-mono text-micro">
                <GitBranch className="size-3" aria-hidden />
                {pr.head} <span className="opacity-50">→</span> {pr.base}
                <span className="text-faint not-italic">in {repo}</span>
              </p>
            )}
            {!!pr?.labels?.length && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {pr.labels.map((l) => (
                  <span key={l.name} className="rounded-full border px-2 py-0.5 text-micro font-medium" style={l.color ? { borderColor: `#${l.color}66`, color: `#${l.color}` } : undefined}>
                    {l.name}
                  </span>
                ))}
              </div>
            )}
          </div>
          <a href={pr?.url ?? `https://github.com/${repo}/pull/${number}`} target="_blank" rel="noreferrer noopener" className="hover:bg-muted text-muted-foreground hover:text-foreground flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-micro font-medium transition-colors">
            <Globe className="size-3.5" aria-hidden />
            GitHub
          </a>
        </div>

        {/* ---- actions ---- */}
        {pr && <ActionBar pr={pr} session={session} repo={repo} number={number} onChanged={() => void load()} />}
      </header>

      {/* ---- tabs ---- */}
      <div role="tablist" aria-label="Pull request sections" className="bg-muted/50 flex w-fit max-w-full gap-0.5 overflow-x-auto rounded-lg p-0.5">
        <TabButton on={tab === "conversation"} onClick={() => setTab("conversation")} icon={<MessageSquare className="size-3.5" />} label="Conversation" count={pr?.comments?.length} />
        <TabButton on={tab === "commits"} onClick={() => setTab("commits")} icon={<GitCommitHorizontal className="size-3.5" />} label="Commits" count={pr?.commits?.length} />
        <TabButton on={tab === "files"} onClick={() => setTab("files")} icon={<FileDiff className="size-3.5" />} label="Files changed" count={pr?.files?.length} />
        <TabButton on={tab === "checks"} onClick={() => setTab("checks")} icon={<ShieldCheck className="size-3.5" />} label="Checks" count={pr?.checkRuns?.length} />
      </div>

      {!pr ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-muted h-16 animate-pulse rounded-xl" />
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
    </PageEnter>
  );
}

function TabButton({ on, onClick, icon, label, count }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string; count?: number }) {
  return (
    <button type="button" role="tab" aria-selected={on} onClick={onClick} className={cn("flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-3 text-meta font-medium transition-colors", on ? "bg-card text-foreground shadow-e1" : "text-muted-foreground hover:text-foreground")}>
      {icon}
      {label}
      {count !== undefined && <span className={cn("tabular-nums", on ? "text-muted-foreground" : "text-faint")}>{count}</span>}
    </button>
  );
}

/** Merge (or the reason you can't), approve, and the lifecycle verbs, in one band under the header. */
function ActionBar({ pr, session, repo, number, onChanged }: { pr: PullDetail; session: string; repo: string; number: number; onChanged: () => void }) {
  const v = verdict(pr);
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
  return (
    <div className="rounded-xl border p-2.5">
      {v.canMerge ? (
        <MergeControl busy={busy} onMerge={(m, a) => void merge(m, a)} />
      ) : (
        pr.state === "open" && v.blocked && <p className="text-muted-foreground px-1 pb-2 text-meta">{v.blocked}</p>
      )}
      {error && (
        <div role="alert" className="border-destructive/30 bg-destructive/8 mt-1.5 rounded-lg border px-2.5 py-2">
          <p className="text-destructive text-micro font-medium">Merge failed</p>
          <p className="text-foreground/80 mt-0.5 text-micro whitespace-pre-wrap">{error}</p>
          {policyBlocked && <PolicyRescue busy={busy} onAuto={() => void merge("merge", true)} onAdmin={() => void merge("merge", false, true)} />}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2 px-1">
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
        <section className="rounded-xl border p-3">
          <p className="text-muted-foreground mb-2 flex items-center gap-1.5 text-meta">
            <Users className="size-3.5" aria-hidden /> Reviewers
          </p>
          <div className="flex flex-col gap-1.5">
            {pr.reviewers.map((r) => (
              <div key={r.login} className="flex items-center gap-2 text-meta">
                <img src={`https://github.com/${encodeURIComponent(r.login)}.png?size=40`} alt="" width={20} height={20} className="bg-muted size-5 rounded-full" loading="lazy" />
                <span className="text-foreground flex-1 truncate">{r.login}</span>
                <span className={cn("text-micro", r.state === "approved" ? "text-ok" : r.state === "changes_requested" ? "text-destructive" : "text-muted-foreground")}>{reviewLabel(r.state)}</span>
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
      <div className="bg-muted/50 flex items-center gap-2 border-b px-3 py-2">
        {author && <img src={`https://github.com/${encodeURIComponent(author)}.png?size=40`} alt="" width={20} height={20} className="bg-muted size-5 rounded-full" loading="lazy" />}
        <span className="text-foreground text-meta font-medium">{author ?? "unknown"}</span>
        {v && <span className={cn("text-micro font-medium", v === "approved" ? "text-ok" : v === "changes_requested" ? "text-destructive" : "text-muted-foreground")}>{reviewLabel(v)}</span>}
        {at && <span className="text-faint ml-auto text-micro">{new Date(at).toLocaleString()}</span>}
      </div>
      <div className="prose-agent text-foreground px-3 py-2.5">
        <Markdown>{body}</Markdown>
      </div>
    </article>
  );
}

function Commits({ pr, repo }: { pr: PullDetail; repo: string }) {
  if (!pr.commits?.length) return <Empty>No commits on this pull request.</Empty>;
  return (
    <ul className="divide-y overflow-hidden rounded-xl border">
      {pr.commits.map((c) => (
        <li key={c.sha} className="flex items-start gap-3 px-3 py-2.5">
          <GitCommitHorizontal className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            {/* Only the subject line: a commit body belongs in the diff, not in a list row. */}
            <p className="text-foreground truncate text-meta font-medium">{c.message.split("\n")[0]}</p>
            <p className="text-muted-foreground text-micro">
              {c.author ?? "unknown"}
              {c.date ? ` · ${new Date(c.date).toLocaleDateString()}` : ""}
            </p>
          </div>
          <a href={`https://github.com/${repo}/commit/${c.sha}`} target="_blank" rel="noreferrer noopener" className="text-muted-foreground hover:text-foreground shrink-0 font-mono text-micro transition-colors">
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
      <p className="text-muted-foreground text-meta">
        {pr.files.length} {pr.files.length === 1 ? "file" : "files"} · <span className="text-ok">+{pr.additions}</span> <span className="text-destructive">−{pr.deletions}</span>
        {pr.truncated && <span className="text-attention-text"> · truncated, open on GitHub for the rest</span>}
      </p>
      {pr.files.map((f) => (
        <div key={f.path} className="overflow-hidden rounded-xl border">
          <button type="button" onClick={() => setOpen((o) => (o === f.path ? null : f.path))} aria-expanded={open === f.path} className="hover:bg-muted/60 flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left transition-colors">
            <FileMark path={f.path} className="size-4 shrink-0" />
            <span className="text-foreground min-w-0 flex-1 truncate font-mono text-micro">{f.path}</span>
            <span className="shrink-0 text-micro tabular-nums">
              <span className="text-ok">+{f.additions}</span> <span className="text-destructive">−{f.deletions}</span>
            </span>
          </button>
          {open === f.path && <FilePatch file={f} />}
        </div>
      ))}
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
  if (!parsed) return <p className="text-muted-foreground border-t px-3 py-3 text-meta">No textual diff — the file is binary or too large to inline.</p>;
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
        return (
          <li key={`${c.name}-${i}`} className="flex items-center gap-2.5 px-3 py-2.5">
            {running ? <CircleDashed className="text-muted-foreground size-4 shrink-0 animate-spin [animation-duration:3s]" aria-hidden /> : ok ? <CircleCheck className="text-ok size-4 shrink-0" aria-hidden /> : <CircleX className="text-destructive size-4 shrink-0" aria-hidden />}
            <span className="text-foreground min-w-0 flex-1 truncate text-meta">{c.name}</span>
            <span className={cn("shrink-0 text-micro", running ? "text-muted-foreground" : ok ? "text-ok" : "text-destructive")}>{running ? "running" : (c.conclusion ?? "done")}</span>
            {c.url && (
              <a href={c.url} target="_blank" rel="noreferrer noopener" aria-label={`Open ${c.name}`} className="text-muted-foreground hover:text-foreground shrink-0 transition-colors">
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground rounded-xl border px-4 py-8 text-center text-meta">{children}</p>;
}
