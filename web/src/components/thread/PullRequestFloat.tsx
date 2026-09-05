import * as React from "react";
import { ArrowUpRight, Check, ChevronDown, CircleCheck, CircleDashed, CircleX, FileDiff, GitBranch, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, Globe, Loader2, ShieldAlert, Sparkles, ThumbsUp, Users, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { api, type PullInfo } from "@/lib/api";
import { cn } from "@/lib/utils";

export type PullRef = { url: string; repo: string; number: number };

/**
 * The run's pull request(s) as a floating control: a small chip pinned to the top-right of the
 * thread (state icon · #number · state, plus a +N badge when the run opened several), which opens
 * a card with everything you'd check before merging — a PR switcher when there is more than one,
 * a verdict header ("Ready to merge" / "Checks failing" / "Merged" …) with the check count and a
 * Merge action, then Review (decision + reviewers + Approve), Committed (files, +/−), Branch, and
 * a link out. Merge and Approve run `gh` inside the sandbox with the run's own GitHub identity.
 */
export function PullRequestFloat({ session, pulls }: { session: string; pulls: PullRef[] }) {
  const many = pulls.length > 1;
  // With several PRs the card opens as a LIST; drilling into a row shows the detail view.
  const [picked, setPicked] = React.useState<string | null>(null);
  const active = pulls.find((p) => p.url === picked) ?? pulls[pulls.length - 1];
  const showList = many && picked === null;
  const { url, repo, number } = active;
  const [open, setOpen] = React.useState(false);
  // One PullInfo per PR so the list rows and the detail view never show another PR's state.
  const [infos, setInfos] = React.useState<Record<string, PullInfo>>({});
  const info = infos[url] ?? null;
  const load = React.useCallback(
    (signal?: AbortSignal) => api.pull(repo, number, signal).then((i) => setInfos((m) => ({ ...m, [url]: i }))).catch(() => {}),
    [repo, number, url]
  );
  React.useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);
  // The list needs every PR's title/state, so prefetch the rest once the card opens.
  React.useEffect(() => {
    if (!open || !many) return;
    const ctrl = new AbortController();
    for (const p of pulls) {
      if (infos[p.url]) continue;
      api.pull(p.repo, p.number, ctrl.signal).then((i) => setInfos((m) => ({ ...m, [p.url]: i }))).catch(() => {});
    }
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, many, pulls.map((p) => p.url).join(" ")]);
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
        {many ? (
          <span className="text-foreground tabular-nums">{pulls.length} PRs</span>
        ) : (
          <>
            <span className="text-foreground tabular-nums">#{number}</span>
            <span className={cn("hidden sm:inline", v.text)}>{v.short}</span>
          </>
        )}
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
            className="bg-card absolute top-full right-0 z-40 mt-2 w-[22rem] rounded-xl border p-1.5 shadow-e4"
          >
            {showList ? (
              <PullList pulls={pulls} infos={infos} onPick={(u) => setPicked(u)} />
            ) : (
              <>
            {many && (
              <button
                type="button"
                onClick={() => setPicked(null)}
                className="text-muted-foreground hover:text-foreground mb-1 flex cursor-pointer items-center gap-1 px-1.5 pt-0.5 text-micro font-medium transition-colors"
              >
                <ChevronDown className="size-3 rotate-90" aria-hidden />
                All {pulls.length} pull requests
              </button>
            )}
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
              {info && info.state === "open" && info.reviewDecision !== "approved" && <ApproveControl session={session} repo={repo} number={number} onApproved={() => void load()} />}
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
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * All the run's PRs as a scannable list — the GitHub "pr list" idiom rather than tabs: a state
 * icon, #number, the title, and a one-word verdict per row, grouped under their repo when the run
 * touched more than one. A row drills into the full detail/merge view.
 */
function PullList({ pulls, infos, onPick }: { pulls: PullRef[]; infos: Record<string, PullInfo>; onPick: (url: string) => void }) {
  const repos = [...new Set(pulls.map((p) => p.repo))];
  return (
    <div className="flex flex-col pb-1">
      <p className="text-muted-foreground px-2.5 pt-1.5 pb-1 text-meta">Pull requests from this run</p>
      {repos.map((r) => (
        <React.Fragment key={r}>
          {repos.length > 1 && <p className="text-faint px-2.5 pt-1 pb-0.5 font-mono text-micro">{r}</p>}
          {pulls
            .filter((p) => p.repo === r)
            .map((p) => {
              const i = infos[p.url];
              const pv = verdict(i ?? null);
              const PIcon = pv.icon;
              return (
                <button
                  key={p.url}
                  type="button"
                  onClick={() => onPick(p.url)}
                  className="hover:bg-muted flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors"
                >
                  <span className={cn("grid size-5 shrink-0 place-items-center rounded-full", pv.chip)}>
                    <PIcon className="size-3" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-foreground block truncate text-meta font-medium">
                      {i?.title ?? <span className="bg-muted inline-block h-3 w-40 animate-pulse rounded align-middle" />}
                    </span>
                    <span className="text-muted-foreground block truncate text-micro">
                      <span className="tabular-nums">#{p.number}</span>
                      {i ? (
                        <>
                          {" · "}
                          <span className={pv.text}>{pv.short}</span>
                          {i.author ? ` · ${i.author}` : ""}
                        </>
                      ) : null}
                    </span>
                  </span>
                  {i && (
                    <span className="shrink-0 text-micro tabular-nums">
                      <span className="text-ok">+{i.additions}</span> <span className="text-destructive">−{i.deletions}</span>
                    </span>
                  )}
                  <ChevronDown className="text-faint size-3.5 shrink-0 -rotate-90" aria-hidden />
                </button>
              );
            })}
        </React.Fragment>
      ))}
    </div>
  );
}

function verdict(info: PullInfo | null): {
  title: string;
  short: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  header: string;
  chip: string;
  text: string;
  canMerge: boolean;
  /** One sentence explaining WHY merge is unavailable, shown under the header for open PRs. */
  blocked?: string;
} {
  if (!info) return { title: "Pull request", short: "PR", icon: GitPullRequest, header: "bg-muted text-foreground", chip: "bg-muted text-muted-foreground", text: "text-muted-foreground", canMerge: false };
  if (info.state === "merged") return { title: "Merged", short: "merged", icon: GitMerge, header: "bg-sleep/10 text-sleep", chip: "bg-sleep/20 text-sleep", text: "text-sleep", canMerge: false };
  if (info.state === "closed") return { title: "Closed", short: "closed", icon: GitPullRequestClosed, header: "bg-destructive/8 text-destructive", chip: "bg-destructive/10 text-destructive", text: "text-destructive", canMerge: false };
  if (info.state === "draft") return { title: "Draft", short: "draft", icon: GitPullRequestDraft, header: "bg-muted text-foreground", chip: "bg-muted text-muted-foreground", text: "text-muted-foreground", canMerge: false, blocked: "Drafts can't merge — mark it ready for review on GitHub first." };
  if (info.checks && info.checks.failure > 0) return { title: "Checks failing", short: "checks failing", icon: CircleX, header: "bg-destructive/8 text-destructive", chip: "bg-destructive/10 text-destructive", text: "text-destructive", canMerge: false, blocked: `${info.checks.failure} ${info.checks.failure === 1 ? "check is" : "checks are"} failing — fix or re-run them, then merge here.` };
  if (info.reviewDecision === "changes_requested") return { title: "Changes requested", short: "changes requested", icon: GitPullRequest, header: "bg-attention/20 text-attention-text", chip: "bg-attention/20 text-attention-text", text: "text-attention-text", canMerge: false, blocked: "A reviewer requested changes — push an update or get a re-approval." };
  if (info.checks && info.checks.pending > 0) return { title: "Checks running", short: "checks running", icon: CircleDashed, header: "bg-live/10 text-live", chip: "bg-live/10 text-live", text: "text-live", canMerge: false, blocked: `${info.checks.pending} ${info.checks.pending === 1 ? "check is" : "checks are"} still running — the Merge button appears when they pass.` };
  if (info.mergeable === false) return { title: "Merge conflicts", short: "conflicts", icon: GitPullRequest, header: "bg-attention/20 text-attention-text", chip: "bg-attention/20 text-attention-text", text: "text-attention-text", canMerge: false, blocked: "The branch conflicts with its base — ask the agent to rebase and resolve, then merge." };
  return { title: "Ready to merge", short: "ready to merge", icon: GitPullRequest, header: "bg-ok/10 text-ok", chip: "bg-ok/20 text-ok", text: "text-ok", canMerge: true };
}

function reviewLabel(s: string) {
  return s === "approved" ? "Approved" : s === "changes_requested" ? "Changes requested" : s === "commented" ? "Commented" : "Review asked";
}

type MergeMethod = "merge" | "squash" | "rebase";
const METHOD_LABEL: Record<MergeMethod, { label: string; hint: string }> = {
  merge: { label: "Merge commit", hint: "keep every commit, add a merge commit" },
  squash: { label: "Squash & merge", hint: "one clean commit on the base branch" },
  rebase: { label: "Rebase & merge", hint: "replay the commits, no merge commit" },
};

function Header({ info, v, url, session, repo, number, onMerged, onClose }: { info: PullInfo | null; v: ReturnType<typeof verdict>; url: string; session: string; repo: string; number: number; onMerged: () => void; onClose: () => void }) {
  const [busy, setBusy] = React.useState(false);
  // A failed merge's reason STAYS in the card (gh's own message, e.g. "not mergeable: the base
  // branch policy prohibits the merge") — a vanishing toast made the button look simply broken.
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<"merged" | "auto" | null>(null);
  // The last failure decides the retry offer: a branch-policy refusal is exactly what --auto solves.
  const policyBlocked = !!error && /policy prohibits|--auto/.test(error);

  const merge = async (method: MergeMethod, auto: boolean, admin = false) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.mergePull(session, repo, number, { method, auto, admin });
      setResult(r.auto ? "auto" : "merged");
      toast.success(r.auto ? `Auto-merge armed for #${number}` : `Merged #${number}`);
      onMerged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const Icon = v.icon;
  return (
    <>
      <div className={cn("flex items-center gap-2.5 rounded-xl px-3 py-2.5", result ? "bg-sleep/10 text-sleep" : v.header)}>
        <div className="min-w-0 flex-1">
          <p className="text-body font-semibold">{result === "merged" ? "Merged" : result === "auto" ? "Auto-merge armed" : v.title}</p>
          <p className="stamp flex items-center gap-1.5 opacity-85">
            <Icon className="size-3" aria-hidden />#{number}
            {result === "auto" ? <span>· merges when requirements are met</span> : info?.checks?.total ? <span>· {info.checks.total} checks</span> : <span className="truncate">· {repo.split("/")[1]}</span>}
          </p>
        </div>
        <a href={url} target="_blank" rel="noreferrer noopener" aria-label="Open on GitHub" className="hover:bg-card/60 grid size-8 shrink-0 cursor-pointer place-items-center rounded-md transition-colors">
          <Globe className="size-4" aria-hidden />
        </a>
        {result ? (
          <motion.span initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 420, damping: 22 }} className="bg-sleep/20 text-sleep grid size-8 shrink-0 place-items-center rounded-md">
            <GitMerge className="size-4" aria-hidden />
          </motion.span>
        ) : (
          !v.canMerge && (
            <button type="button" onClick={onClose} aria-label="Close" className="hover:bg-card/60 grid size-8 shrink-0 cursor-pointer place-items-center rounded-md transition-colors">
              {info?.state === "merged" ? <Check className="size-4" aria-hidden /> : <X className="size-4" aria-hidden />}
            </button>
          )
        )}
        {url.length === 0 && <ArrowUpRight className="hidden" />}
      </div>
      {/* Why the button is missing, in words — the card should never leave "can I merge?" implicit. */}
      {!result && !v.canMerge && info && info.state === "open" && (
        <p className="text-muted-foreground px-3 pt-1.5 text-micro">{v.blocked ?? ""}</p>
      )}
      {!result && v.canMerge && <MergeControl busy={busy} onMerge={merge} />}
      {error && (
        <div role="alert" className="border-destructive/30 bg-destructive/8 mx-1.5 mt-1.5 rounded-lg border px-2.5 py-2">
          <p className="text-destructive text-micro font-medium">Merge failed</p>
          <p className="text-foreground/80 mt-0.5 text-micro whitespace-pre-wrap">{error}</p>
          {policyBlocked && <PolicyRescue busy={busy} onAuto={() => void merge("merge", true)} onAdmin={() => void merge("merge", false, true)} />}
        </div>
      )}
    </>
  );
}

/**
 * The two ways past a branch-policy refusal, as ONE quiet decision row — not a stack of shouting
 * buttons. "Auto-merge" is the primary (the patient, policy-respecting path); "admin override" is
 * a text-weight action that swaps in place into an explicit amber confirm (transitions.dev
 * text-states-swap), so the bypass exists without being dressed as a peer of the safe choice.
 */
function PolicyRescue({ busy, onAuto, onAdmin }: { busy: boolean; onAuto: () => void; onAdmin: () => void }) {
  const [armed, setArmed] = React.useState(false);
  React.useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 5000);
    return () => window.clearTimeout(t);
  }, [armed]);
  return (
    <div className="mt-2.5 flex min-h-7 items-center gap-2">
      <AnimatePresence mode="wait" initial={false}>
        {armed ? (
          <motion.div
            key="confirm"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className="flex w-full items-center gap-2"
          >
            <span className="text-attention-text flex min-w-0 items-center gap-1.5 text-micro">
              <ShieldAlert className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">Skips the policy's requirements.</span>
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={onAdmin}
              className="bg-attention text-attention-ink hover:bg-attention/85 ml-auto flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-micro font-semibold transition-colors disabled:opacity-60"
            >
              {busy ? <Loader2 className="size-3 animate-spin" /> : <GitMerge className="size-3" aria-hidden />}
              Merge anyway
            </button>
            <button type="button" onClick={() => setArmed(false)} className="text-muted-foreground hover:text-foreground shrink-0 cursor-pointer text-micro underline-offset-2 hover:underline">
              cancel
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="choices"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className="flex w-full items-center gap-2"
          >
            <button
              type="button"
              disabled={busy}
              onClick={onAuto}
              title="GitHub merges the moment approvals and checks are satisfied"
              className="bg-sleep/15 text-sleep hover:bg-sleep/25 flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-micro font-semibold transition-colors disabled:opacity-60"
            >
              {busy ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" aria-hidden />}
              Auto-merge when ready
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setArmed(true)}
              className="text-muted-foreground hover:text-attention-text ml-auto shrink-0 cursor-pointer text-micro font-medium underline-offset-2 hover:underline"
            >
              use admin override…
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * The merge decision as one control: a two-stage primary action (Merge → Confirm, disarming after
 * 5s) beside a chevron that morphs open a method menu — merge commit / squash / rebase, plus
 * auto-merge — so the choice GitHub gives you exists here too instead of hiding behind a default.
 */
function MergeControl({ busy, onMerge }: { busy: boolean; onMerge: (method: MergeMethod, auto: boolean) => void }) {
  const [method, setMethod] = React.useState<MergeMethod>("merge");
  const [menu, setMenu] = React.useState(false);
  const [armed, setArmed] = React.useState(false);
  React.useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 5000);
    return () => window.clearTimeout(t);
  }, [armed]);
  return (
    <div className="px-1.5 pt-1.5">
      <div className="flex items-stretch gap-px overflow-hidden rounded-lg">
        <button
          type="button"
          disabled={busy}
          onClick={() => (armed ? onMerge(method, false) : setArmed(true))}
          className={cn(
            "bg-ok hover:bg-ok/85 flex h-9 flex-1 cursor-pointer items-center justify-center gap-2 text-meta font-semibold text-white transition-colors disabled:opacity-60",
            armed && "bg-ok/90 ring-ok/40 ring-2 ring-inset"
          )}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <GitMerge className="size-4" aria-hidden />}
          {busy ? "Merging…" : armed ? "Confirm merge" : METHOD_LABEL[method].label}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setMenu((m) => !m)}
          aria-expanded={menu}
          aria-label="Merge options"
          className="bg-ok hover:bg-ok/85 grid w-9 cursor-pointer place-items-center text-white transition-colors disabled:opacity-60"
        >
          <ChevronDown className={cn("size-4 transition-transform duration-200", menu && "rotate-180")} aria-hidden />
        </button>
      </div>
      <AnimatePresence initial={false}>
        {menu && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div role="radiogroup" aria-label="Merge method" className="mt-1.5 flex flex-col gap-0.5 rounded-lg border p-1">
              {(Object.keys(METHOD_LABEL) as MergeMethod[]).map((m) => {
                const on = m === method;
                return (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => {
                      setMethod(m);
                      setMenu(false);
                      setArmed(false);
                    }}
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-meta transition-colors",
                      on ? "bg-ok/10 text-foreground" : "hover:bg-muted text-foreground"
                    )}
                  >
                    <span className={cn("grid size-4 shrink-0 place-items-center rounded-full border", on ? "border-ok bg-ok text-white" : "border-line-strong")} aria-hidden>
                      {on && <Check className="size-2.5" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{METHOD_LABEL[m].label}</span>
                      <span className="text-muted-foreground block text-micro">{METHOD_LABEL[m].hint}</span>
                    </span>
                  </button>
                );
              })}
              <div className="mx-1 my-0.5 h-px bg-border" aria-hidden />
              <button
                type="button"
                onClick={() => {
                  setMenu(false);
                  onMerge(method, true);
                }}
                className="hover:bg-sleep/10 text-foreground flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-meta transition-colors"
              >
                <Sparkles className="text-sleep size-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">Auto-merge when ready</span>
                  <span className="text-muted-foreground block text-micro">GitHub merges the moment approvals and checks are satisfied</span>
                </span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Approve, right where the review state lives: a quiet text-weight action (approving is additive,
 * merging is the loud one). Failures — usually GitHub refusing self-approval — stay inline in
 * gh's own words instead of vanishing in a toast.
 */
function ApproveControl({ session, repo, number, onApproved }: { session: string; repo: string; number: number; onApproved: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.approvePull(session, repo, number);
      setDone(true);
      toast.success(`Approved #${number}`);
      onApproved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="pt-1">
      {done ? (
        <span className="text-ok flex items-center gap-1.5 text-micro font-medium">
          <CircleCheck className="size-3.5" aria-hidden /> Approved with your connected account
        </span>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => void approve()}
          className="bg-ok/10 text-ok hover:bg-ok/20 flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-micro font-semibold transition-colors disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-3 animate-spin" /> : <ThumbsUp className="size-3" aria-hidden />}
          Approve this PR
        </button>
      )}
      {error && <p className="text-destructive mt-1 text-micro whitespace-pre-wrap">{error}</p>}
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
