/**
 * The write actions on a pull request, shared by the thread's PR card and the dedicated PR page:
 * merge (two-stage, with the method menu and auto-merge), the branch-policy rescue, approve, and
 * the lifecycle verbs (close / reopen / mark ready). Every one of them runs `gh` inside the run's
 * own sandbox with the owner's token; failures stay INLINE in gh's own words, because a vanishing
 * toast made a refused merge look like a broken button.
 */
import * as React from "react";
import { Check, ChevronDown, CircleCheck, GitMerge, GitPullRequestClosed, Loader2, MessageSquare, RotateCcw, ShieldAlert, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { METHOD_LABEL, type MergeMethod } from "./verdict";

/**
 * The two ways past a branch-policy refusal, as ONE quiet decision row — not a stack of shouting
 * buttons. "Auto-merge" is the primary (the patient, policy-respecting path); "admin override" is
 * a text-weight action that swaps in place into an explicit amber confirm, so the bypass exists
 * without being dressed as a peer of the safe choice.
 */
export function PolicyRescue({ busy, onAuto, onAdmin }: { busy: boolean; onAuto: () => void; onAdmin: () => void }) {
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
          <motion.div key="confirm" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }} className="flex w-full items-center gap-2">
            <span className="text-attention-text flex min-w-0 items-center gap-1.5 text-micro">
              <ShieldAlert className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">Skips the policy's requirements.</span>
            </span>
            <button type="button" disabled={busy} onClick={onAdmin} className="bg-attention text-attention-ink hover:bg-attention/85 ml-auto flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-micro font-semibold transition-colors disabled:opacity-60">
              {busy ? <Loader2 className="size-3 animate-spin" /> : <GitMerge className="size-3" aria-hidden />}
              Merge anyway
            </button>
            <button type="button" onClick={() => setArmed(false)} className="text-muted-foreground hover:text-foreground shrink-0 cursor-pointer text-micro underline-offset-2 hover:underline">
              cancel
            </button>
          </motion.div>
        ) : (
          <motion.div key="choices" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }} className="flex w-full items-center gap-2">
            <button type="button" disabled={busy} onClick={onAuto} title="GitHub merges the moment approvals and checks are satisfied" className="bg-sleep/15 text-sleep hover:bg-sleep/25 flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-micro font-semibold transition-colors disabled:opacity-60">
              {busy ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" aria-hidden />}
              Auto-merge when ready
            </button>
            <button type="button" disabled={busy} onClick={() => setArmed(true)} className="text-muted-foreground hover:text-attention-text ml-auto shrink-0 cursor-pointer text-micro font-medium underline-offset-2 hover:underline">
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
export function MergeControl({ busy, onMerge }: { busy: boolean; onMerge: (method: MergeMethod, auto: boolean) => void }) {
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
          className={cn("bg-ok hover:bg-ok/85 flex h-9 flex-1 cursor-pointer items-center justify-center gap-2 text-meta font-semibold text-white transition-colors disabled:opacity-60", armed && "bg-ok/90 ring-ok/40 ring-2 ring-inset")}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <GitMerge className="size-4" aria-hidden />}
          {busy ? "Merging…" : armed ? "Confirm merge" : METHOD_LABEL[method].label}
        </button>
        <button type="button" disabled={busy} onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-label="Merge options" className="bg-ok hover:bg-ok/85 grid w-9 cursor-pointer place-items-center text-white transition-colors disabled:opacity-60">
          <ChevronDown className={cn("size-4 transition-transform duration-200", menu && "rotate-180")} aria-hidden />
        </button>
      </div>
      <AnimatePresence initial={false}>
        {menu && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
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
                    className={cn("flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-meta transition-colors", on ? "bg-ok/10 text-foreground" : "hover:bg-muted text-foreground")}
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
export function ApproveControl({ session, repo, number, onApproved }: { session: string; repo: string; number: number; onApproved: () => void }) {
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
        <button type="button" disabled={busy} onClick={() => void approve()} className="bg-ok/10 text-ok hover:bg-ok/20 flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-micro font-semibold transition-colors disabled:opacity-60">
          {busy ? <Loader2 className="size-3 animate-spin" /> : <ThumbsUp className="size-3" aria-hidden />}
          Approve this PR
        </button>
      )}
      {error && <p className="text-destructive mt-1 text-micro whitespace-pre-wrap">{error}</p>}
    </div>
  );
}

/**
 * Write a comment, or submit it as a review verdict. One textarea with three exits, because on
 * GitHub they are the same box — "Request changes" without words is useless, so it stays disabled
 * until there are some.
 */
export function CommentComposer({ session, repo, number, onPosted }: { session: string; repo: string; number: number; onPosted: () => void }) {
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState<"comment" | "request-changes" | "approve" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const send = async (kind: "comment" | "request-changes" | "approve") => {
    const body = text.trim();
    if (!body && kind !== "approve") return;
    setBusy(kind);
    setError(null);
    try {
      if (kind === "comment") await api.commentPull(session, repo, number, body);
      else await api.reviewPull(session, repo, number, kind, body || undefined);
      setText("");
      toast.success(kind === "comment" ? "Comment posted" : kind === "approve" ? `Approved #${number}` : "Changes requested");
      onPosted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const empty = !text.trim();
  return (
    <div className="rounded-xl border p-2.5">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="Leave a comment…"
        className="placeholder:text-faint text-foreground w-full resize-y bg-transparent text-meta outline-none"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" disabled={empty || busy !== null} onClick={() => void send("comment")} className="bg-foreground text-background flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-micro font-semibold transition-opacity hover:opacity-85 disabled:opacity-40">
          {busy === "comment" ? <Loader2 className="size-3 animate-spin" /> : <MessageSquare className="size-3" aria-hidden />}
          Comment
        </button>
        <button type="button" disabled={empty || busy !== null} onClick={() => void send("request-changes")} className="bg-attention/20 text-attention-text hover:bg-attention/30 flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-micro font-semibold transition-colors disabled:opacity-40">
          {busy === "request-changes" ? <Loader2 className="size-3 animate-spin" /> : <ThumbsDown className="size-3" aria-hidden />}
          Request changes
        </button>
        <button type="button" disabled={busy !== null} onClick={() => void send("approve")} className="bg-ok/10 text-ok hover:bg-ok/20 flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-micro font-semibold transition-colors disabled:opacity-40">
          {busy === "approve" ? <Loader2 className="size-3 animate-spin" /> : <ThumbsUp className="size-3" aria-hidden />}
          Approve
        </button>
      </div>
      {error && <p className="text-destructive mt-1.5 text-micro whitespace-pre-wrap">{error}</p>}
    </div>
  );
}

/**
 * Close / reopen / mark ready for review. Closing discards nothing but is outward-facing, so it
 * arms first (the same two-stage idiom as merge); reopen and ready are cheap and fire directly.
 */
export function LifecycleControl({ session, repo, number, state, onDone }: { session: string; repo: string; number: number; state: "open" | "closed" | "merged" | "draft"; onDone: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const [armed, setArmed] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 5000);
    return () => window.clearTimeout(t);
  }, [armed]);
  const act = async (action: "close" | "reopen" | "ready") => {
    setBusy(true);
    setError(null);
    try {
      await api.setPullState(session, repo, number, action);
      toast.success(action === "close" ? `Closed #${number}` : action === "reopen" ? `Reopened #${number}` : `#${number} is ready for review`);
      setArmed(false);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  if (state === "merged") return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {state === "draft" && (
        <button type="button" disabled={busy} onClick={() => void act("ready")} className="hover:bg-muted flex h-7 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-micro font-medium transition-colors disabled:opacity-60">
          {busy ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" aria-hidden />}
          Mark ready for review
        </button>
      )}
      {state === "closed" ? (
        <button type="button" disabled={busy} onClick={() => void act("reopen")} className="hover:bg-muted flex h-7 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-micro font-medium transition-colors disabled:opacity-60">
          {busy ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" aria-hidden />}
          Reopen
        </button>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => (armed ? void act("close") : setArmed(true))}
          className={cn("flex h-7 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-micro font-medium transition-colors disabled:opacity-60", armed ? "border-destructive/40 bg-destructive/8 text-destructive" : "text-muted-foreground hover:text-foreground hover:bg-muted")}
        >
          {busy ? <Loader2 className="size-3 animate-spin" /> : <GitPullRequestClosed className="size-3" aria-hidden />}
          {armed ? "Confirm close" : "Close pull request"}
        </button>
      )}
      {error && <p className="text-destructive w-full text-micro whitespace-pre-wrap">{error}</p>}
    </div>
  );
}
