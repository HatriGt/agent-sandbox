/**
 * The PR verdict machine, shared by the PR sheet and the dedicated PR screen (and mirroring
 * web/src/components/pr/verdict.ts): one look at PullInfo decides the headline, its tone, and
 * whether Merge is available — plus the sentence explaining why not.
 */
import type { PullInfo } from "@/lib/api";
import type { IconName } from "@/components/ui/Icon";

export function verdict(info: PullInfo | null): {
  title: string;
  icon: IconName;
  tone: "ok" | "destructive" | "attention" | "sleep" | "muted" | "live";
  canMerge: boolean;
  blocked?: string;
} {
  if (!info) return { title: "Pull request", icon: "git-pull-request", tone: "muted", canMerge: false };
  if (info.state === "merged") return { title: "Merged", icon: "git-merge", tone: "sleep", canMerge: false };
  if (info.state === "closed") return { title: "Closed", icon: "x-circle", tone: "destructive", canMerge: false };
  if (info.state === "draft")
    return { title: "Draft", icon: "edit-3", tone: "muted", canMerge: false, blocked: "Drafts can't merge — mark it ready for review on GitHub first." };
  if (info.checks && info.checks.failure > 0)
    return {
      title: "Checks failing",
      icon: "x-circle",
      tone: "destructive",
      canMerge: false,
      blocked: `${info.checks.failure} ${info.checks.failure === 1 ? "check is" : "checks are"} failing — fix or re-run them, then merge here.`,
    };
  if (info.reviewDecision === "changes_requested")
    return { title: "Changes requested", icon: "alert-circle", tone: "attention", canMerge: false, blocked: "A reviewer requested changes — push an update or get a re-approval." };
  if (info.checks && info.checks.pending > 0)
    return {
      title: "Checks running",
      icon: "loader",
      tone: "live",
      canMerge: false,
      blocked: `${info.checks.pending} ${info.checks.pending === 1 ? "check is" : "checks are"} still running — Merge appears when they pass.`,
    };
  if (info.mergeable === false)
    return { title: "Merge conflicts", icon: "git-pull-request", tone: "attention", canMerge: false, blocked: "The branch conflicts with its base — ask the agent to rebase and resolve, then merge." };
  return { title: "Ready to merge", icon: "git-pull-request", tone: "ok", canMerge: true };
}

export function toneColor(palette: Record<string, string>, tone: string): string {
  return tone === "ok" ? palette.ok
    : tone === "destructive" ? palette.destructive
    : tone === "attention" ? palette.attentionText
    : tone === "sleep" ? palette.sleep
    : tone === "live" ? palette.live
    : palette.mutedForeground;
}

export const METHOD_HINT: Record<"merge" | "squash" | "rebase", string> = {
  merge: "keep every commit",
  squash: "one clean commit",
  rebase: "replay, no merge commit",
};

