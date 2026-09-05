/**
 * "Can I merge this, and if not why not?" as one derived value — the single source of truth for
 * both PR surfaces (the thread's `PullRequestFloat` chip/card and the dedicated PR page). The
 * precedence is deliberate: terminal states first, then the blockers in the order GitHub itself
 * applies them, so the sentence in `blocked` always names the thing you actually have to fix.
 */
import type * as React from "react";
import { CircleDashed, CircleX, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from "lucide-react";
import type { PullInfo } from "@/lib/api";

export interface Verdict {
  title: string;
  short: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  /** Tailwind classes for the header band, the small round chip, and bare text. */
  header: string;
  chip: string;
  text: string;
  canMerge: boolean;
  /** One sentence explaining WHY merge is unavailable, shown under the header for open PRs. */
  blocked?: string;
}

export function verdict(info: PullInfo | null): Verdict {
  if (!info) return { title: "Pull request", short: "PR", icon: GitPullRequest, header: "bg-muted text-foreground", chip: "bg-muted text-muted-foreground", text: "text-muted-foreground", canMerge: false };
  if (info.state === "merged") return { title: "Merged", short: "merged", icon: GitMerge, header: "bg-sleep/10 text-sleep", chip: "bg-sleep/20 text-sleep", text: "text-sleep", canMerge: false };
  if (info.state === "closed") return { title: "Closed", short: "closed", icon: GitPullRequestClosed, header: "bg-destructive/8 text-destructive", chip: "bg-destructive/10 text-destructive", text: "text-destructive", canMerge: false };
  if (info.state === "draft") return { title: "Draft", short: "draft", icon: GitPullRequestDraft, header: "bg-muted text-foreground", chip: "bg-muted text-muted-foreground", text: "text-muted-foreground", canMerge: false, blocked: "Drafts can't merge — mark it ready for review first." };
  if (info.checks && info.checks.failure > 0) return { title: "Checks failing", short: "checks failing", icon: CircleX, header: "bg-destructive/8 text-destructive", chip: "bg-destructive/10 text-destructive", text: "text-destructive", canMerge: false, blocked: `${info.checks.failure} ${info.checks.failure === 1 ? "check is" : "checks are"} failing — fix or re-run them, then merge here.` };
  if (info.reviewDecision === "changes_requested") return { title: "Changes requested", short: "changes requested", icon: GitPullRequest, header: "bg-attention/20 text-attention-text", chip: "bg-attention/20 text-attention-text", text: "text-attention-text", canMerge: false, blocked: "A reviewer requested changes — push an update or get a re-approval." };
  if (info.checks && info.checks.pending > 0) return { title: "Checks running", short: "checks running", icon: CircleDashed, header: "bg-live/10 text-live", chip: "bg-live/10 text-live", text: "text-live", canMerge: false, blocked: `${info.checks.pending} ${info.checks.pending === 1 ? "check is" : "checks are"} still running — the Merge button appears when they pass.` };
  if (info.mergeable === false) return { title: "Merge conflicts", short: "conflicts", icon: GitPullRequest, header: "bg-attention/20 text-attention-text", chip: "bg-attention/20 text-attention-text", text: "text-attention-text", canMerge: false, blocked: "The branch conflicts with its base — ask the agent to rebase and resolve, then merge." };
  return { title: "Ready to merge", short: "ready to merge", icon: GitPullRequest, header: "bg-ok/10 text-ok", chip: "bg-ok/20 text-ok", text: "text-ok", canMerge: true };
}

export function reviewLabel(s: string) {
  return s === "approved" ? "Approved" : s === "changes_requested" ? "Changes requested" : s === "commented" ? "Commented" : "Review asked";
}

export type MergeMethod = "merge" | "squash" | "rebase";
export const METHOD_LABEL: Record<MergeMethod, { label: string; hint: string }> = {
  merge: { label: "Merge commit", hint: "keep every commit, add a merge commit" },
  squash: { label: "Squash & merge", hint: "one clean commit on the base branch" },
  rebase: { label: "Rebase & merge", hint: "replay the commits, no merge commit" },
};
