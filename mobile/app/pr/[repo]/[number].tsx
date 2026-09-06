/**
 * The dedicated pull-request screen — the phone counterpart of web's PullRequestPage. The PR sheet
 * on the thread stays the glance (state, +/−, merge); this is where you actually review: the
 * description, the commits, the real diffs, the checks and the conversation, plus the write
 * actions (merge, approve, request changes, comment, close/reopen/ready).
 *
 * The layout follows the app's own screens: SettingsScreen chrome (back row, serif h1), the
 * StatePill idiom (glyph + word in the state's hue, hairline pill), Card surfaces, mono stamps for
 * machine data, and the WorkingDot as the only motion — breathing while checks run, still otherwise.
 *
 * `repo` is "owner/name" — a slash — so it travels as ONE url-encoded route segment and is
 * decoded here.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";
import { api, type PullDetail } from "@/lib/api";
import { useAuth } from "@/state/auth";
import { toneColor, verdict, METHOD_HINT } from "@/lib/prVerdict";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { DiffText } from "@/components/DiffText";
import { MarkdownLite } from "@/components/MarkdownLite";
import { T } from "@/components/ui/AppText";
import { ArmButton } from "@/components/ui/ArmButton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Icon, type IconName } from "@/components/ui/Icon";
import { WorkingDot } from "@/components/ui/WorkingDot";

type Tab = "conversation" | "commits" | "files" | "checks";
const TABS: { key: Tab; label: string }[] = [
  { key: "conversation", label: "Talk" },
  { key: "commits", label: "Commits" },
  { key: "files", label: "Files" },
  { key: "checks", label: "Checks" },
];

/** Auth gate for deep links: a PR link opened while signed out lands on /welcome. */
export default function PullRequestRoute() {
  const { signedIn } = useAuth();
  if (!signedIn) return <Redirect href="/welcome" />;
  return <PullRequestScreen />;
}

function PullRequestScreen() {
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
    // A missing param coerces to 0; only a real PR number is worth a round trip.
    if (!repo || !Number.isInteger(number) || number <= 0) return;
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
      {/* SettingsScreen chrome: back row, everything else scrolls */}
      <View style={{ flexDirection: "row", alignItems: "center", height: 56, paddingHorizontal: 12 }}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={{ padding: 8 }}>
          <T variant="body" tone="muted">
            ‹ Back
          </T>
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable
          onPress={() => void WebBrowser.openBrowserAsync(pr?.url ?? `https://github.com/${repo}/pull/${number}`)}
          hitSlop={12}
          style={{ flexDirection: "row", alignItems: "center", gap: 4, padding: 8 }}
        >
          <T variant="meta" tone="muted">
            GitHub ↗
          </T>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 0, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {error && !pr ? (
          <Card style={{ borderColor: `${palette.destructive}55`, backgroundColor: `${palette.destructive}14` }}>
            <T variant="meta" weight="semibold" style={{ color: palette.destructive }}>
              Couldn't load this pull request
            </T>
            <T variant="micro" tone="muted" style={{ marginTop: 4 }}>
              {error}
            </T>
          </Card>
        ) : null}

        {/* ---- header: serif h1, then the meta line the thread header uses ---- */}
        <View style={{ gap: 8 }}>
          <T serif variant="h1">
            {pr?.title ?? "Pull request"}
            <T serif variant="h1" tone="faint">
              {"  #"}
              {number}
            </T>
          </T>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <VerdictPill title={v.title} icon={v.icon} tint={tint} live={v.tone === "live"} />
            {pr ? (
              <T variant="meta" tone="muted" style={{ flexShrink: 1 }}>
                <T variant="meta" weight="medium">
                  {pr.author ?? "someone"}
                </T>
                {` · ${pr.commits?.length ?? 0} ${(pr.commits?.length ?? 0) === 1 ? "commit" : "commits"}`}
              </T>
            ) : null}
          </View>
          {pr ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: palette.muted, borderRadius: radius.md, paddingHorizontal: 7, paddingVertical: 3, maxWidth: "100%" }}>
                <Icon name="git-branch" size={11} color={palette.mutedForeground} />
                <T variant="micro" mono numberOfLines={1} style={{ flexShrink: 1 }}>
                  {pr.head} → {pr.base}
                </T>
              </View>
              <T variant="micro" mono tone="faint" numberOfLines={1} style={{ flexShrink: 1 }}>
                {repo}
              </T>
            </View>
          ) : null}
          {!!pr?.labels?.length && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {pr.labels.map((l) => (
                <View key={l.name} style={{ borderWidth: 1, borderColor: l.color ? `#${l.color}55` : palette.border, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 }}>
                  <T variant="micro" weight="medium" style={l.color ? { color: `#${l.color}` } : undefined}>
                    {l.name}
                  </T>
                </View>
              ))}
            </View>
          )}
        </View>

        {pr ? <ActionBar pr={pr} session={session} repo={repo} number={number} onChanged={load} /> : null}

        {/* ---- section pills, the fleet filter-chip idiom: active = inked ---- */}
        <View style={{ flexDirection: "row", gap: 6, marginTop: 4 }}>
          {TABS.map((t) => {
            const on = t.key === tab;
            const count = pr
              ? t.key === "conversation"
                ? (pr.comments?.length ?? 0) + 1
                : t.key === "commits"
                  ? pr.commits?.length
                  : t.key === "files"
                    ? pr.files?.length
                    : pr.checkRuns?.length
              : undefined;
            return (
              <Pressable
                key={t.key}
                onPress={() => setTab(t.key)}
                style={{
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 5,
                  paddingVertical: 8,
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  borderColor: on ? "transparent" : palette.border,
                  backgroundColor: on ? palette.foreground : palette.card,
                }}
              >
                <T variant="micro" weight={on ? "semibold" : "medium"} style={{ color: on ? palette.background : palette.mutedForeground }}>
                  {t.label}
                </T>
                {count !== undefined ? (
                  <T variant="micro" mono style={{ color: on ? palette.background : palette.faint }}>
                    {count}
                  </T>
                ) : null}
              </Pressable>
            );
          })}
        </View>

        {!pr ? (
          <Card>
            <T variant="meta" tone="muted">
              Loading pull request…
            </T>
          </Card>
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

/** The verdict in the StatePill shape: hairline pill, glyph + word in the state's hue. */
function VerdictPill({ title, icon, tint, live }: { title: string; icon: IconName; tint: string; live: boolean }) {
  const { palette } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: palette.border,
        flexShrink: 0,
        alignSelf: "flex-start",
      }}
    >
      {live ? <WorkingDot color={tint} /> : <Icon name={icon} size={12} color={tint} />}
      <T variant="meta" weight="medium" numberOfLines={1} style={{ color: tint }}>
        {title}
      </T>
    </View>
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

  if (pr.state === "merged") return null;
  if (!canAct)
    return (
      <T variant="micro" tone="muted">
        Open this PR from its run to merge, approve or comment.
      </T>
    );

  return (
    <Card style={{ gap: 10 }}>
      {v.canMerge ? (
        <>
          <View style={{ flexDirection: "row", gap: 6 }}>
            {(["merge", "squash", "rebase"] as const).map((m) => {
              const on = m === method;
              return (
                <Pressable
                  key={m}
                  onPress={() => setMethod(m)}
                  style={{
                    flex: 1,
                    alignItems: "center",
                    paddingVertical: 7,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: on ? palette.ok : palette.border,
                    backgroundColor: on ? `${palette.ok}14` : "transparent",
                  }}
                >
                  <T variant="micro" weight="semibold" style={{ color: on ? palette.ok : palette.mutedForeground }}>
                    {m}
                  </T>
                </Pressable>
              );
            })}
          </View>
          <T variant="micro" tone="faint" style={{ marginTop: -4 }}>
            {METHOD_HINT[method]}
          </T>
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
        ) : (
          <ArmButton title="Close PR" armedTitle="Tap again to close" small disabled={busy} onConfirm={() => act(() => api.setPullState(session, repo, number, "close"), `Closed #${number}`)} />
        )}
      </View>
      {note ? (
        <T variant="micro" tone="muted" selectable>
          {note}
        </T>
      ) : null}
    </Card>
  );
}

/** "3d ago" beats a raw locale timestamp in a timeline. */
function relativeTime(at: string): string {
  const s = (Date.now() - new Date(at).getTime()) / 1000;
  if (!Number.isFinite(s) || s < 0) return new Date(at).toLocaleDateString();
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(at).toLocaleDateString();
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
        <Card style={{ gap: 8 }}>
          <T variant="micro" tone="muted" weight="medium">
            Reviewers
          </T>
          {pr.reviewers.map((r) => (
            <View key={r.login} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <T variant="meta" style={{ flex: 1 }} numberOfLines={1}>
                {r.login}
              </T>
              <T
                variant="micro"
                weight="medium"
                style={{ color: r.state === "approved" ? palette.ok : r.state === "changes_requested" ? palette.destructive : palette.mutedForeground }}
              >
                {r.state === "approved" ? "Approved" : r.state === "changes_requested" ? "Changes requested" : r.state === "commented" ? "Commented" : "Review asked"}
              </T>
            </View>
          ))}
        </Card>
      )}
      {pr.state !== "merged" && session ? (
        <View style={{ gap: 8 }}>
          <Field label="Leave a comment" value={text} onChangeText={setText} multiline placeholder="What should the author know?" style={{ minHeight: 88, textAlignVertical: "top" }} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button title="Comment" small disabled={busy || !text.trim()} onPress={() => void send("comment")} style={{ flex: 1 }} />
            <Button title="Request changes" variant="attention" small disabled={busy || !text.trim()} onPress={() => void send("request-changes")} style={{ flex: 1 }} />
          </View>
          {note ? (
            <T variant="micro" tone="muted" selectable>
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
    <Card style={{ padding: 0, overflow: "hidden" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, borderBottomWidth: 1, borderBottomColor: palette.border, paddingHorizontal: 14, paddingVertical: 8 }}>
        <T variant="meta" weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>
          {author ?? "unknown"}
        </T>
        {state ? (
          <T variant="micro" weight="medium" style={{ color: state === "approved" ? palette.ok : state === "changes_requested" ? palette.destructive : palette.mutedForeground }}>
            {state === "approved" ? "Approved" : state === "changes_requested" ? "Changes requested" : "Commented"}
          </T>
        ) : null}
        {at ? (
          <T variant="micro" mono tone="faint" style={{ marginLeft: "auto" }}>
            {relativeTime(at)}
          </T>
        ) : null}
      </View>
      <View style={{ paddingHorizontal: 14, paddingVertical: 10 }}>
        <MarkdownLite text={body} />
      </View>
    </Card>
  );
}

function Commits({ pr, repo }: { pr: PullDetail; repo: string }) {
  const { palette } = useTheme();
  if (!pr.commits?.length) return <Empty>No commits on this pull request.</Empty>;
  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      {pr.commits.map((c, i) => (
        <Pressable
          key={c.sha}
          onPress={() => void WebBrowser.openBrowserAsync(`https://github.com/${repo}/commit/${c.sha}`)}
          style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: palette.border }}
        >
          <Icon name="git-commit" size={14} color={palette.mutedForeground} />
          <View style={{ flex: 1, minWidth: 0 }}>
            {/* Only the subject: a commit body belongs in the diff, not in a list row. */}
            <T variant="meta" weight="medium" numberOfLines={1}>
              {c.message.split("\n")[0]}
            </T>
            <T variant="micro" tone="muted" numberOfLines={1}>
              {c.author ?? "unknown"}
              {c.date ? ` · ${relativeTime(c.date)}` : ""}
            </T>
          </View>
          <View style={{ backgroundColor: palette.muted, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2 }}>
            <T variant="micro" mono tone="muted">
              {c.sha.slice(0, 7)}
            </T>
          </View>
        </Pressable>
      ))}
    </Card>
  );
}

function Files({ pr }: { pr: PullDetail }) {
  const { palette } = useTheme();
  const [open, setOpen] = useState<string | null>(null);
  if (!pr.files?.length) return <Empty>No files changed.</Empty>;
  return (
    <View style={{ gap: 8 }}>
      <T variant="micro" mono tone="muted" style={{ paddingHorizontal: 2 }}>
        {pr.files.length} {pr.files.length === 1 ? "file" : "files"} ·{" "}
        <T variant="micro" mono style={{ color: palette.ok }}>
          +{pr.additions}
        </T>{" "}
        <T variant="micro" mono style={{ color: palette.destructive }}>
          −{pr.deletions}
        </T>
        {pr.truncated ? " · truncated — open GitHub for the rest" : ""}
      </T>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        {pr.files.map((f, i) => {
          const on = open === f.path;
          return (
            <View key={f.path} style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: palette.border }}>
              <Pressable onPress={() => setOpen(on ? null : f.path)} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 10 }}>
                <Icon name={on ? "chevron-down" : "chevron-right"} size={13} color={palette.mutedForeground} />
                <T variant="micro" mono numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
                  {f.path}
                </T>
                {f.status !== "modified" ? (
                  <T variant="micro" tone="faint">
                    {f.status}
                  </T>
                ) : null}
                <T variant="micro" mono style={{ color: palette.ok }}>
                  +{f.additions}
                </T>
                <T variant="micro" mono style={{ color: palette.destructive }}>
                  −{f.deletions}
                </T>
              </Pressable>
              {on ? (
                <View style={{ borderTopWidth: 1, borderTopColor: palette.border, paddingHorizontal: 10, paddingVertical: 8 }}>
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
          );
        })}
      </Card>
    </View>
  );
}

function Checks({ pr }: { pr: PullDetail }) {
  const { palette } = useTheme();
  if (!pr.checkRuns?.length) return <Empty>No checks reported on the head commit.</Empty>;
  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      {pr.checkRuns.map((c, i) => {
        const running = c.status !== "completed";
        const ok = ["success", "neutral", "skipped"].includes(c.conclusion ?? "");
        const color = running ? palette.live : ok ? palette.ok : palette.destructive;
        return (
          <Pressable
            key={`${c.name}-${i}`}
            disabled={!c.url}
            onPress={() => c.url && void WebBrowser.openBrowserAsync(c.url)}
            style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 11, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: palette.border }}
          >
            {/* state = color + icon + word, always all three; running gets the one motion (liveness) */}
            {running ? <WorkingDot color={color} /> : <Icon name={ok ? "check" : "x"} size={13} color={color} />}
            <T variant="meta" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
              {c.name}
            </T>
            <T variant="micro" weight="medium" style={{ color }}>
              {running ? "running" : (c.conclusion ?? "done")}
            </T>
            {c.url ? <Icon name="external-link" size={12} color={palette.faint} /> : null}
          </Pressable>
        );
      })}
    </Card>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  const { palette } = useTheme();
  return (
    <View style={{ borderWidth: 1, borderStyle: "dashed", borderColor: palette.border, borderRadius: radius.xl, paddingVertical: 32, alignItems: "center" }}>
      <T variant="meta" tone="muted">
        {children}
      </T>
    </View>
  );
}
