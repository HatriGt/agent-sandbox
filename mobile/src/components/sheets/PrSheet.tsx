import React, { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { api, type PullInfo } from "@/lib/api";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "../ui/AppText";
import { ArmButton } from "../ui/ArmButton";
import { Button } from "../ui/Button";
import { Icon, type IconName } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";

export type PullRef = { repo: string; number: number };

/**
 * The web PullRequestFloat's verdict machine, shared shape: one look at PullInfo decides the
 * headline, its tone, and whether Merge is available — plus the sentence explaining why not.
 */
function verdict(info: PullInfo | null): {
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

function toneColor(palette: Record<string, string>, tone: string): string {
  return tone === "ok" ? palette.ok
    : tone === "destructive" ? palette.destructive
    : tone === "attention" ? palette.attentionText
    : tone === "sleep" ? palette.sleep
    : tone === "live" ? palette.live
    : palette.mutedForeground;
}

const METHOD_HINT: Record<"merge" | "squash" | "rebase", string> = {
  merge: "keep every commit",
  squash: "one clean commit",
  rebase: "replay, no merge commit",
};

/**
 * PR status + actions, at parity with the web card: a PR switcher when the run opened several,
 * a verdict header explaining exactly why merge is or isn't available, reviewers, checks,
 * Approve, method picker, Merge / auto-merge, and admin-override behind its own arm.
 */
export function PrSheet({
  session,
  pulls,
  visible,
  onClose,
}: {
  session: string;
  pulls: PullRef[];
  visible: boolean;
  onClose: () => void;
}) {
  const { palette } = useTheme();
  const many = pulls.length > 1;
  // With several PRs the sheet opens as a LIST; tapping a row drills into the detail view.
  const [picked, setPicked] = useState<string | null>(null);
  const keyOf = (p: PullRef) => `${p.repo}#${p.number}`;
  const active = pulls.find((p) => keyOf(p) === picked) ?? pulls[pulls.length - 1];
  const showList = many && picked === null;
  const { repo, number } = active;
  const [infos, setInfos] = useState<Record<string, PullInfo>>({});
  const pr = infos[keyOf(active)] ?? null;
  const [method, setMethod] = useState<"merge" | "squash" | "rebase">("squash");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState(false);

  const load = useCallback(() => {
    api
      .pull(repo, number)
      .then((i) => setInfos((m) => ({ ...m, [`${repo}#${number}`]: i })))
      .catch((e) => setNote(e instanceof Error ? e.message : String(e)));
  }, [repo, number]);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);
  // The list needs every PR's title/state, so fetch the rest once the sheet opens.
  useEffect(() => {
    if (!visible || !many) return;
    for (const p of pulls) {
      api
        .pull(p.repo, p.number)
        .then((i) => setInfos((m) => ({ ...m, [keyOf(p)]: i })))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, many, pulls.map(keyOf).join(" ")]);
  useEffect(() => {
    setNote(null);
    setApproved(false);
  }, [repo, number]);
  // Reopening the sheet starts back at the list.
  useEffect(() => {
    if (visible) setPicked(null);
  }, [visible]);

  const merge = async (opts?: { auto?: boolean; admin?: boolean }) => {
    setBusy(true);
    setNote(null);
    try {
      const r = await api.mergePull(session, repo, number, { method, ...opts });
      setNote(r.auto ? "Auto-merge armed — merges when checks pass." : "Merged.");
      load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    setApproving(true);
    setNote(null);
    try {
      await api.approvePull(session, repo, number);
      setApproved(true);
      load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setApproving(false);
    }
  };

  const v = verdict(pr);
  const vColor = toneColor(palette, v.tone);
  const checks = pr?.checks;

  return (
    <Sheet visible={visible} onClose={onClose} title={showList ? `${pulls.length} pull requests` : `PR #${number}`}>
      <View style={{ gap: 12, paddingBottom: 12 }}>
        {showList ? (
          // The GitHub "pr list" idiom: one row per PR — state icon, title, #number · verdict ·
          // author, and the diff size — grouped under their repo when the run touched several.
          <View style={{ gap: 2 }}>
            {[...new Set(pulls.map((p) => p.repo))].map((r) => (
              <React.Fragment key={r}>
                {new Set(pulls.map((q) => q.repo)).size > 1 && (
                  <T variant="micro" mono tone="faint" style={{ paddingTop: 6, paddingBottom: 2 }}>
                    {r}
                  </T>
                )}
                {pulls
                  .filter((p) => p.repo === r)
                  .map((p) => {
                    const i = infos[keyOf(p)];
                    const rv = verdict(i ?? null);
                    const rc = toneColor(palette, rv.tone);
                    return (
                      <Pressable
                        key={keyOf(p)}
                        onPress={() => setPicked(keyOf(p))}
                        style={({ pressed }) => ({
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 10,
                          paddingVertical: 10,
                          paddingHorizontal: 10,
                          borderRadius: radius.lg,
                          backgroundColor: pressed ? palette.accent : "transparent",
                        })}
                      >
                        <View
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: 12,
                            backgroundColor: `${rc}1f`,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Icon name={rv.icon} size={12} color={rc} />
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <T variant="meta" weight="medium" numberOfLines={1}>
                            {i?.title ?? `#${p.number}`}
                          </T>
                          <T variant="micro" tone="muted" numberOfLines={1}>
                            #{p.number}
                            {i ? ` · ${rv.title.toLowerCase()}${i.author ? ` · ${i.author}` : ""}` : " · loading…"}
                          </T>
                        </View>
                        {i && (
                          <T variant="micro" mono>
                            <T variant="micro" mono tone="ok">+{i.additions}</T>{" "}
                            <T variant="micro" mono tone="destructive">−{i.deletions}</T>
                          </T>
                        )}
                        <Icon name="chevron-right" size={14} color={palette.faint} />
                      </Pressable>
                    );
                  })}
              </React.Fragment>
            ))}
          </View>
        ) : (
          <>
        {many && (
          <Pressable
            onPress={() => setPicked(null)}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 4, opacity: pressed ? 0.6 : 1 })}
          >
            <Icon name="chevron-left" size={14} color={palette.mutedForeground} />
            <T variant="meta" tone="muted" weight="medium">
              All {pulls.length} pull requests
            </T>
          </Pressable>
        )}

        {!pr ? (
          <T tone="muted">Loading…</T>
        ) : (
          <>
            {/* Verdict header — the web card's coloured band */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                backgroundColor: `${vColor}1a`,
                borderRadius: radius.lg,
                paddingVertical: 10,
                paddingHorizontal: 12,
              }}
            >
              <Icon name={v.icon} size={16} color={vColor} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <T variant="body" weight="semibold" style={{ color: vColor }}>
                  {v.title}
                </T>
                <T variant="micro" mono tone="muted" numberOfLines={1}>
                  #{number}
                  {checks?.total ? ` · ${checks.success}/${checks.total} checks` : ` · ${repo}`}
                </T>
              </View>
              <Pressable onPress={() => WebBrowser.openBrowserAsync(pr.url)} hitSlop={8} style={{ padding: 6 }}>
                <Icon name="external-link" size={16} color={palette.mutedForeground} />
              </Pressable>
            </View>
            {v.blocked && (
              <T variant="meta" tone="muted">
                {v.blocked}
              </T>
            )}
            {note ? (
              <T variant="meta" tone="muted" selectable>
                {note}
              </T>
            ) : null}

            <T variant="lead" weight="semibold" selectable>
              {pr.title}
            </T>
            <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <T variant="meta" mono tone="muted">
                {pr.changedFiles} {pr.changedFiles === 1 ? "file" : "files"}
              </T>
              <T variant="meta" mono tone="ok">+{pr.additions}</T>
              <T variant="meta" mono tone="destructive">−{pr.deletions}</T>
              <T variant="meta" mono tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                {pr.head} → {pr.base}
              </T>
            </View>

            {/* Review — decision, reviewers, and Approve */}
            <View style={{ gap: 6 }}>
              <T variant="micro" tone="faint" weight="semibold">
                REVIEW
              </T>
              {pr.reviewers?.length ? (
                pr.reviewers.map((r) => (
                  <View key={r.login} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Icon name="user" size={13} color={palette.faint} />
                    <T variant="meta" style={{ flex: 1 }} numberOfLines={1}>
                      {r.login}
                    </T>
                    <T
                      variant="meta"
                      tone={r.state === "approved" ? "ok" : r.state === "changes_requested" ? "destructive" : "muted"}
                    >
                      {r.state === "approved" ? "Approved" : r.state === "changes_requested" ? "Changes requested" : r.state === "commented" ? "Commented" : "Review asked"}
                    </T>
                  </View>
                ))
              ) : (
                <T variant="meta" tone="muted">
                  {pr.reviewDecision === "approved" ? "Approved — no individual reviewers listed." : "No reviewers yet."}
                </T>
              )}
              {pr.state === "open" && pr.reviewDecision !== "approved" && !approved && (
                <Button
                  title={approving ? "Approving…" : "Approve this PR"}
                  small
                  variant="secondary"
                  loading={approving}
                  onPress={approve}
                  style={{ alignSelf: "flex-start" }}
                />
              )}
              {approved && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Icon name="check-circle" size={13} color={palette.ok} />
                  <T variant="meta" tone="ok">Approved with your connected account</T>
                </View>
              )}
            </View>

            {/* Checks */}
            {checks ? (
              <View style={{ gap: 4 }}>
                <T variant="micro" tone="faint" weight="semibold">
                  CHECKS
                </T>
                <T variant="meta" tone={checks.failure ? "destructive" : checks.pending ? "muted" : "ok"}>
                  {checks.failure
                    ? `✕ ${checks.failure} of ${checks.total} checks failing`
                    : checks.pending
                      ? `● ${checks.pending} of ${checks.total} checks pending`
                      : `✓ all ${checks.total} checks passing`}
                </T>
              </View>
            ) : null}

            {pr.state === "open" && (
              <>
                <View style={{ flexDirection: "row", gap: 6 }}>
                  {(["merge", "squash", "rebase"] as const).map((m) => (
                    <Pressable
                      key={m}
                      onPress={() => setMethod(m)}
                      style={{
                        flex: 1,
                        paddingVertical: 7,
                        borderRadius: radius.lg,
                        alignItems: "center",
                        backgroundColor: method === m ? palette.accent : "transparent",
                        borderWidth: 1,
                        borderColor: method === m ? palette.lineStrong : palette.border,
                      }}
                    >
                      <T variant="meta" weight={method === m ? "semibold" : "regular"}>{m}</T>
                      <T variant="micro" tone="faint" numberOfLines={1}>
                        {METHOD_HINT[m]}
                      </T>
                    </Pressable>
                  ))}
                </View>
                {v.canMerge && <Button title={`Merge (${method})`} onPress={() => merge()} loading={busy} />}
                <Button title="Enable auto-merge" variant="secondary" onPress={() => merge({ auto: true })} disabled={busy} />
                <ArmButton
                  title="Admin override merge"
                  armedTitle="Tap again to bypass protections"
                  onConfirm={() => merge({ admin: true })}
                />
              </>
            )}
          </>
        )}
          </>
        )}
      </View>
    </Sheet>
  );
}
