/**
 * The dedicated pull-request screen — the phone counterpart of web's PullRequestPage. The PR sheet
 * on the thread stays the glance (state, +/−, merge); this is where you actually review: the
 * description, the commits, the real diffs, the checks and the conversation, plus the write
 * actions (merge, approve, request changes, comment, close/reopen/ready).
 *
 * `repo` is "owner/name" — a slash — so it travels as ONE url-encoded route segment and is
 * decoded here.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";
import { api, type PullDetail } from "@/lib/api";
import { toneColor, verdict, METHOD_HINT } from "@/lib/prVerdict";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { DiffText } from "@/components/DiffText";
import { MarkdownLite } from "@/components/MarkdownLite";
import { T } from "@/components/ui/AppText";
import { ArmButton } from "@/components/ui/ArmButton";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Icon, type IconName } from "@/components/ui/Icon";

type Tab = "conversation" | "commits" | "files" | "checks";
const TABS: { key: Tab; label: string; icon: IconName }[] = [
  { key: "conversation", label: "Conversation", icon: "message-square" },
  { key: "commits", label: "Commits", icon: "git-commit" },
  { key: "files", label: "Files", icon: "file-text" },
  { key: "checks", label: "Checks", icon: "check-circle" },
];

export default function PullRequestScreen() {
  const router = useRouter();
  const { palette } = useTheme();
  const params = useLocalSearchParams<{ repo: string; number: string; session?: string }>();
  const repo = decodeURIComponent(String(params.repo ?? ""));
  const number = Number(params.number ?? 0);
  const session = String(params.session ?? "");

  const [pr, setPr] = useState<PullDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("conversation");

  const load = useCallback(() => {
    if (!repo || !Number.isFinite(number)) return;
    api
      .pullDetail(repo, number)
      .then((d) => {
        setPr(d);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [repo, number]);
  useEffect(load, [load]);

  const v = verdict(pr);
  const tint = toneColor(palette as unknown as Record<string, string>, v.tone);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }} edges={["top"]}>
      <View style={{ flexDirection: "row", alignItems: "center", height: 52, paddingHorizontal: 12 }}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={{ padding: 8 }}>
          <T variant="body" tone="muted">
            ‹ Back
          </T>
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => void WebBrowser.openBrowserAsync(pr?.url ?? `https://github.com/${repo}/pull/${number}`)} hitSlop={12} style={{ padding: 8, flexDirection: "row", alignItems: "center", gap: 5 }}>
          <Icon name="github" size={13} color={palette.mutedForeground} />
          <T variant="meta" tone="muted">
            GitHub
          </T>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 0, gap: 14, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        {error && !pr ? (
          <View style={{ borderWidth: 1, borderColor: `${palette.destructive}55`, backgroundColor: `${palette.destructive}14`, borderRadius: radius.xl, padding: 12, gap: 4 }}>
            <T variant="meta" weight="semibold" style={{ color: palette.destructive }}>
              Couldn't load this pull request
            </T>
            <T variant="micro" tone="muted">
              {error}
            </T>
          </View>
        ) : null}

        {/* ---- header ---- */}
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
            <View style={{ width: 32, height: 32, borderRadius: radius.pill, backgroundColor: `${tint}22`, alignItems: "center", justifyContent: "center" }}>
              <Icon name={v.icon} size={15} color={tint} />
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
              <T serif variant="h2">
                {pr?.title ?? "Loading…"}
              </T>
              <T variant="meta" tone="muted">
                <T variant="meta" weight="semibold" style={{ color: tint }}>
                  {v.title}
                </T>
                {` · #${number}`}
                {pr ? ` · ${pr.author ?? "someone"} wants to merge ${pr.commits?.length ?? 0} ${(pr.commits?.length ?? 0) === 1 ? "commit" : "commits"}` : ""}
              </T>
              {pr ? (
                <T variant="micro" mono tone="faint" numberOfLines={2}>
                  {pr.head} → {pr.base}
                </T>
              ) : null}
            </View>
          </View>
          {!!pr?.labels?.length && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {pr.labels.map((l) => (
                <View key={l.name} style={{ borderWidth: 1, borderColor: l.color ? `#${l.color}66` : palette.border, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 }}>
                  <T variant="micro" weight="medium" style={l.color ? { color: `#${l.color}` } : undefined}>
                    {l.name}
                  </T>
                </View>
              ))}
            </View>
          )}
        </View>

        {pr ? <ActionBar pr={pr} session={session} repo={repo} number={number} onChanged={load} /> : null}

        {/* ---- tabs ---- */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4 }}>
          {TABS.map((t) => {
            const on = t.key === tab;
            const count = pr ? (t.key === "conversation" ? pr.comments?.length : t.key === "commits" ? pr.commits?.length : t.key === "files" ? pr.files?.length : pr.checkRuns?.length) : undefined;
            return (
              <Pressable
                key={t.key}
                onPress={() => setTab(t.key)}
                style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: on ? palette.card : "transparent", borderWidth: 1, borderColor: on ? palette.border : "transparent" }}
              >
                <Icon name={t.icon} size={12} color={on ? palette.foreground : palette.mutedForeground} />
                <T variant="meta" weight={on ? "semibold" : "medium"} tone={on ? "default" : "muted"}>
                  {t.label}
                  {count !== undefined ? ` ${count}` : ""}
                </T>
              </Pressable>
            );
          })}
        </ScrollView>

        {!pr ? (
          <T variant="meta" tone="muted">
            Loading pull request…
          </T>
        ) : tab === "conversation" ? (
          <Conversation pr={pr} session={session} repo={repo} number={number} onPosted={load} />
        ) : tab === "commits" ? (
          <Commits pr={pr} repo={repo} />
        ) : tab === "files" ? (
          <Files pr={pr} />
        ) : (
          <Checks pr={pr} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** Merge (or the reason you can't), approve, and the lifecycle verbs. */
function ActionBar({ pr, session, repo, number, onChanged }: { pr: PullDetail; session: string; repo: string; number: number; onChanged: () => void }) {
  const { palette } = useTheme();
  const v = verdict(pr);
  const [method, setMethod] = useState<"merge" | "squash" | "rebase">("merge");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Without a session there is no sandbox to run `gh` in — the screen is read-only (e.g. deep link).
  const canAct = !!session;
  const act = async (run: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setNote(null);
    try {
      await run();
      setNote(ok);
      onChanged();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ borderWidth: 1, borderColor: palette.border, borderRadius: radius.xl, padding: 12, gap: 10 }}>
      {!canAct ? (
        <T variant="micro" tone="muted">
          Open this PR from its run to merge, approve or comment.
        </T>
      ) : (
        <>
          {v.canMerge ? (
            <>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {(["merge", "squash", "rebase"] as const).map((m) => (
                  <Pressable
                    key={m}
                    onPress={() => setMethod(m)}
                    style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.md, borderWidth: 1, borderColor: m === method ? palette.ok : palette.border, backgroundColor: m === method ? `${palette.ok}14` : "transparent" }}
                  >
                    <T variant="micro" weight="semibold" style={{ color: m === method ? palette.ok : palette.foreground }}>
                      {m}
                    </T>
                    <T variant="micro" tone="faint">
                      {METHOD_HINT[m]}
                    </T>
                  </Pressable>
                ))}
              </View>
              <ArmButton title={`Merge (${method})`} armedTitle="Tap again to merge" variant="secondary" disabled={busy} onConfirm={() => act(() => api.mergePull(session, repo, number, { method }), `Merged #${number}`)} />
              <Button title="Auto-merge when ready" variant="ghost" small disabled={busy} onPress={() => void act(() => api.mergePull(session, repo, number, { method, auto: true }), "Auto-merge armed")} />
            </>
          ) : pr.state === "open" && v.blocked ? (
            <T variant="meta" tone="muted">
              {v.blocked}
            </T>
          ) : null}

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {pr.state === "open" && pr.reviewDecision !== "approved" && (
              <Button title="Approve" variant="outline" small disabled={busy} onPress={() => void act(() => api.approvePull(session, repo, number), `Approved #${number}`)} />
            )}
            {pr.state === "draft" && <Button title="Mark ready" variant="outline" small disabled={busy} onPress={() => void act(() => api.setPullState(session, repo, number, "ready"), "Ready for review")} />}
            {pr.state === "closed" ? (
              <Button title="Reopen" variant="outline" small disabled={busy} onPress={() => void act(() => api.setPullState(session, repo, number, "reopen"), `Reopened #${number}`)} />
            ) : pr.state !== "merged" ? (
              <ArmButton title="Close PR" armedTitle="Tap again to close" small disabled={busy} onConfirm={() => act(() => api.setPullState(session, repo, number, "close"), `Closed #${number}`)} />
            ) : null}
          </View>
        </>
      )}
      {note ? (
        <T variant="micro" tone="muted">
          {note}
        </T>
      ) : null}
    </View>
  );
}

function Conversation({ pr, session, repo, number, onPosted }: { pr: PullDetail; session: string; repo: string; number: number; onPosted: () => void }) {
  const { palette } = useTheme();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const send = async (kind: "comment" | "request-changes") => {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    setNote(null);
    try {
      if (kind === "comment") await api.commentPull(session, repo, number, body);
      else await api.reviewPull(session, repo, number, kind, body);
      setText("");
      onPosted();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: 10 }}>
      <CommentCard author={pr.author} at={pr.createdAt} body={pr.body?.trim() || "_No description provided._"} />
      {pr.comments?.map((c) => (
        <CommentCard key={c.id} author={c.author} at={c.at} body={c.body} state={c.kind === "review" ? c.state : undefined} />
      ))}
      {!!pr.reviewers?.length && (
        <View style={{ borderWidth: 1, borderColor: palette.border, borderRadius: radius.xl, padding: 12, gap: 6 }}>
          <T variant="meta" tone="muted">
            Reviewers
          </T>
          {pr.reviewers.map((r) => (
            <View key={r.login} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <T variant="meta" style={{ flex: 1 }} numberOfLines={1}>
                {r.login}
              </T>
              <T variant="micro" style={{ color: r.state === "approved" ? palette.ok : r.state === "changes_requested" ? palette.destructive : palette.mutedForeground }}>
                {r.state === "approved" ? "Approved" : r.state === "changes_requested" ? "Changes requested" : r.state === "commented" ? "Commented" : "Review asked"}
              </T>
            </View>
          ))}
        </View>
      )}
      {pr.state !== "merged" && session ? (
        <View style={{ gap: 8 }}>
          <Field label="Leave a comment" value={text} onChangeText={setText} multiline placeholder="What should the author know?" style={{ minHeight: 88, textAlignVertical: "top" }} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button title="Comment" small disabled={busy || !text.trim()} onPress={() => void send("comment")} style={{ flex: 1 }} />
            <Button title="Request changes" variant="attention" small disabled={busy || !text.trim()} onPress={() => void send("request-changes")} style={{ flex: 1 }} />
          </View>
          {note ? (
            <T variant="micro" tone="muted">
              {note}
            </T>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** One authored body — the PR description or a comment — through the chat's markdown renderer. */
function CommentCard({ author, at, body, state }: { author?: string; at?: string; body: string; state?: string }) {
  const { palette } = useTheme();
  return (
    <View style={{ borderWidth: 1, borderColor: palette.border, borderRadius: radius.xl, overflow: "hidden" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: palette.muted, paddingHorizontal: 12, paddingVertical: 7 }}>
        <T variant="meta" weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>
          {author ?? "unknown"}
        </T>
        {state ? (
          <T variant="micro" style={{ color: state === "approved" ? palette.ok : state === "changes_requested" ? palette.destructive : palette.mutedForeground }}>
            {state === "approved" ? "Approved" : state === "changes_requested" ? "Changes requested" : "Commented"}
          </T>
        ) : null}
        {at ? (
          <T variant="micro" tone="faint" style={{ marginLeft: "auto" }}>
            {new Date(at).toLocaleDateString()}
          </T>
        ) : null}
      </View>
      <View style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
        <MarkdownLite text={body} />
      </View>
    </View>
  );
}

function Commits({ pr, repo }: { pr: PullDetail; repo: string }) {
  const { palette } = useTheme();
  if (!pr.commits?.length) return <Empty>No commits on this pull request.</Empty>;
  return (
    <View style={{ borderWidth: 1, borderColor: palette.border, borderRadius: radius.xl, overflow: "hidden" }}>
      {pr.commits.map((c, i) => (
        <Pressable
          key={c.sha}
          onPress={() => void WebBrowser.openBrowserAsync(`https://github.com/${repo}/commit/${c.sha}`)}
          style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: palette.border }}
        >
          <Icon name="git-commit" size={14} color={palette.mutedForeground} />
          <View style={{ flex: 1, minWidth: 0 }}>
            {/* Only the subject: a commit body belongs in the diff, not in a list row. */}
            <T variant="meta" weight="medium" numberOfLines={1}>
              {c.message.split("\n")[0]}
            </T>
            <T variant="micro" tone="muted" numberOfLines={1}>
              {c.author ?? "unknown"}
              {c.date ? ` · ${new Date(c.date).toLocaleDateString()}` : ""}
            </T>
          </View>
          <T variant="micro" mono tone="faint">
            {c.sha.slice(0, 7)}
          </T>
        </Pressable>
      ))}
    </View>
  );
}

function Files({ pr }: { pr: PullDetail }) {
  const { palette } = useTheme();
  const [open, setOpen] = useState<string | null>(null);
  if (!pr.files?.length) return <Empty>No files changed.</Empty>;
  return (
    <View style={{ gap: 8 }}>
      <T variant="meta" tone="muted">
        {pr.files.length} {pr.files.length === 1 ? "file" : "files"} · <T variant="meta" style={{ color: palette.ok }}>+{pr.additions}</T>{" "}
        <T variant="meta" style={{ color: palette.destructive }}>−{pr.deletions}</T>
        {pr.truncated ? " · truncated, open on GitHub for the rest" : ""}
      </T>
      {pr.files.map((f) => (
        <View key={f.path} style={{ borderWidth: 1, borderColor: palette.border, borderRadius: radius.xl, overflow: "hidden" }}>
          <Pressable onPress={() => setOpen((o) => (o === f.path ? null : f.path))} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10 }}>
            <Icon name={open === f.path ? "chevron-down" : "chevron-right"} size={13} color={palette.mutedForeground} />
            <T variant="micro" mono numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
              {f.path}
            </T>
            <T variant="micro" mono style={{ color: palette.ok }}>
              +{f.additions}
            </T>
            <T variant="micro" mono style={{ color: palette.destructive }}>
              −{f.deletions}
            </T>
          </Pressable>
          {open === f.path ? (
            <View style={{ paddingHorizontal: 8, paddingBottom: 8 }}>
              {f.patch ? (
                <DiffText diff={f.patch} />
              ) : (
                <T variant="micro" tone="muted">
                  No textual diff — the file is binary or too large to inline.
                </T>
              )}
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function Checks({ pr }: { pr: PullDetail }) {
  const { palette } = useTheme();
  if (!pr.checkRuns?.length) return <Empty>No checks reported on the head commit.</Empty>;
  return (
    <View style={{ borderWidth: 1, borderColor: palette.border, borderRadius: radius.xl, overflow: "hidden" }}>
      {pr.checkRuns.map((c, i) => {
        const running = c.status !== "completed";
        const ok = ["success", "neutral", "skipped"].includes(c.conclusion ?? "");
        const color = running ? palette.mutedForeground : ok ? palette.ok : palette.destructive;
        return (
          <Pressable
            key={`${c.name}-${i}`}
            disabled={!c.url}
            onPress={() => c.url && void WebBrowser.openBrowserAsync(c.url)}
            style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: palette.border }}
          >
            <Icon name={running ? "loader" : ok ? "check-circle" : "x-circle"} size={14} color={color} />
            <T variant="meta" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
              {c.name}
            </T>
            <T variant="micro" style={{ color }}>
              {running ? "running" : (c.conclusion ?? "done")}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  const { palette } = useTheme();
  return (
    <View style={{ borderWidth: 1, borderColor: palette.border, borderRadius: radius.xl, paddingVertical: 28, alignItems: "center" }}>
      <T variant="meta" tone="muted">
        {children}
      </T>
    </View>
  );
}
