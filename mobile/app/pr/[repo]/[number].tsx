/**
 * The dedicated pull-request screen — the phone counterpart of web's PullRequestPage. The PR sheet
 * on the thread stays the glance (state, +/−, merge); this is where you actually review: the
 * description, the commits, the real diffs, the checks and the conversation, plus the write
 * actions (merge, approve, request changes, comment, close/reopen/ready).
 *
 * The design centers on ONE painted element — the verdict orb, a soft glowing disc in the state's
 * hue ringed by two halos, breathing only while checks run. Everything else stays hairline cards
 * and quiet text, matching the web page. Motion is plain RN Animated (no reanimated, by policy).
 *
 * `repo` is "owner/name" — a slash — so it travels as ONE url-encoded route segment and is
 * decoded here.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, ScrollView, View } from "react-native";
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
  const failing = pr?.checkRuns?.filter((c) => c.status === "completed" && !["success", "neutral", "skipped"].includes(c.conclusion ?? "")).length ?? 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }} edges={["top"]}>
      {/* top bar: back on the left, GitHub escape on the right, nothing else */}
      <View style={{ flexDirection: "row", alignItems: "center", height: 48, paddingHorizontal: 8 }}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={{ flexDirection: "row", alignItems: "center", gap: 4, padding: 8 }}>
          <Icon name="chevron-left" size={16} color={palette.mutedForeground} />
          <T variant="meta" tone="muted" weight="medium">
            Back
          </T>
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable
          onPress={() => void WebBrowser.openBrowserAsync(pr?.url ?? `https://github.com/${repo}/pull/${number}`)}
          hitSlop={12}
          style={{ flexDirection: "row", alignItems: "center", gap: 5, padding: 8 }}
        >
          <T variant="micro" tone="muted" weight="medium">
            Open on GitHub
          </T>
          <Icon name="arrow-up-right" size={12} color={palette.mutedForeground} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, gap: 0, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        {error && !pr ? (
          <View style={{ borderWidth: 1, borderColor: `${palette.destructive}55`, backgroundColor: `${palette.destructive}14`, borderRadius: radius.xl, padding: 12, gap: 4, marginTop: 8 }}>
            <T variant="meta" weight="semibold" style={{ color: palette.destructive }}>
              Couldn't load this pull request
            </T>
            <T variant="micro" tone="muted">
              {error}
            </T>
          </View>
        ) : null}

        {/* ---- hero: the verdict orb, centered ---- */}
        <View style={{ alignItems: "center", paddingTop: 10 }}>
          <VerdictOrb tint={tint} icon={v.icon} live={v.tone === "live"} background={palette.background} />
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 14 }}>
            <T variant="meta" weight="semibold" style={{ color: tint }}>
              {v.title}
            </T>
            <T variant="micro" mono tone="faint">
              #{number}
            </T>
          </View>
          <T serif variant="h2" style={{ textAlign: "center", marginTop: 6, paddingHorizontal: 8 }}>
            {pr?.title ?? "Loading…"}
          </T>
          {pr ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: 5, marginTop: 8 }}>
              <T variant="meta" tone="muted">
                <T variant="meta" weight="medium">
                  {pr.author ?? "someone"}
                </T>
                {"  wants to merge"}
              </T>
              <BranchChip name={pr.head} />
              <Icon name="arrow-right" size={11} color={palette.faint} />
              <BranchChip name={pr.base} />
            </View>
          ) : null}
          {!!pr?.labels?.length && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 6, marginTop: 10 }}>
              {pr.labels.map((l) => (
                <View
                  key={l.name}
                  style={{
                    borderWidth: 1,
                    borderColor: l.color ? `#${l.color}55` : palette.border,
                    backgroundColor: l.color ? `#${l.color}14` : "transparent",
                    borderRadius: radius.pill,
                    paddingHorizontal: 8,
                    paddingVertical: 2,
                  }}
                >
                  <T variant="micro" weight="medium" style={l.color ? { color: `#${l.color}` } : undefined}>
                    {l.name}
                  </T>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* ---- stat strip: the four numbers a reviewer triages by ---- */}
        {pr ? (
          <View style={{ flexDirection: "row", gap: 8, marginTop: 18 }}>
            <Stat label="Commits" value={String(pr.commits?.length ?? 0)} onPress={() => setTab("commits")} />
            <Stat label="Files" value={String(pr.files?.length ?? pr.changedFiles ?? 0)} onPress={() => setTab("files")} />
            <Stat
              label="Lines"
              value={
                <>
                  <T variant="h3" weight="semibold" style={{ color: palette.ok }}>
                    +{pr.additions}
                  </T>
                  <T variant="h3" weight="semibold" style={{ color: palette.destructive }}>
                    {" "}−{pr.deletions}
                  </T>
                </>
              }
              onPress={() => setTab("files")}
            />
            <Stat
              label="Checks"
              value={
                pr.checks?.total ? (
                  <T variant="h3" weight="semibold" style={{ color: failing ? palette.destructive : pr.checks.pending ? palette.live : palette.ok }}>
                    {pr.checks.success}/{pr.checks.total}
                  </T>
                ) : (
                  "—"
                )
              }
              onPress={() => setTab("checks")}
            />
          </View>
        ) : null}

        {pr ? <ActionBar pr={pr} tint={tint} session={session} repo={repo} number={number} onChanged={load} /> : null}

        {/* ---- tabs: underline idiom, hairline base ---- */}
        <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: palette.border, marginTop: 22 }}>
          {TABS.map((t) => {
            const on = t.key === tab;
            const count = pr
              ? t.key === "conversation"
                ? pr.comments?.length
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
                  alignItems: "center",
                  gap: 3,
                  paddingVertical: 9,
                  borderBottomWidth: 2,
                  borderBottomColor: on ? palette.foreground : "transparent",
                  marginBottom: -1,
                }}
              >
                <Icon name={t.icon} size={14} color={on ? palette.foreground : palette.mutedForeground} />
                <T variant="micro" weight={on ? "semibold" : "medium"} tone={on ? "default" : "muted"}>
                  {t.label}
                  {count !== undefined ? ` ${count}` : ""}
                </T>
              </Pressable>
            );
          })}
        </View>

        <View style={{ marginTop: 14 }}>
          {!pr ? (
            <T variant="meta" tone="muted" style={{ textAlign: "center", paddingVertical: 24 }}>
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
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * The screen's one painted element: the state as a glowing disc in the verdict's hue, two hairline
 * halos around it. The outer glow breathes only while checks are running — a settled PR sits still.
 */
function VerdictOrb({ tint, icon, live, background }: { tint: string; icon: IconName; live: boolean; background: string }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!live) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [live, pulse]);
  return (
    <View style={{ width: 84, height: 84, alignItems: "center", justifyContent: "center" }}>
      <Animated.View
        style={{
          position: "absolute",
          width: 84,
          height: 84,
          borderRadius: 42,
          backgroundColor: tint,
          opacity: live ? pulse.interpolate({ inputRange: [0, 1], outputRange: [0.1, 0.24] }) : 0.12,
          transform: [{ scale: live ? pulse.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.06] }) : 1 }],
        }}
      />
      <View style={{ position: "absolute", width: 76, height: 76, borderRadius: 38, borderWidth: 1, borderColor: `${tint}59` }} />
      <View style={{ position: "absolute", width: 58, height: 58, borderRadius: 29, borderWidth: 1, borderColor: `${tint}33` }} />
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: tint,
          alignItems: "center",
          justifyContent: "center",
          shadowColor: tint,
          shadowOpacity: 0.5,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6,
        }}
      >
        {/* the icon sits on the tint, so it takes the page background as its "white" */}
        <Icon name={icon} size={19} color={background} />
      </View>
    </View>
  );
}

function BranchChip({ name }: { name: string }) {
  const { palette } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: palette.muted, borderRadius: radius.md, paddingHorizontal: 7, paddingVertical: 2, maxWidth: 150 }}>
      <Icon name="git-branch" size={10} color={palette.mutedForeground} />
      <T variant="micro" mono numberOfLines={1} style={{ flexShrink: 1 }}>
        {name}
      </T>
    </View>
  );
}

function Stat({ label, value, onPress }: { label: string; value: React.ReactNode; onPress: () => void }) {
  const { palette } = useTheme();
  return (
    <Pressable onPress={onPress} style={{ flex: 1, borderWidth: 1, borderColor: palette.border, borderRadius: radius.lg, paddingVertical: 9, alignItems: "center", gap: 1 }}>
      {typeof value === "string" ? (
        <T variant="h3" weight="semibold">
          {value}
        </T>
      ) : (
        <View style={{ flexDirection: "row" }}>{value}</View>
      )}
      <T variant="micro" tone="muted">
        {label}
      </T>
    </Pressable>
  );
}

/** Merge (or the reason you can't), approve, and the lifecycle verbs. */
function ActionBar({ pr, tint, session, repo, number, onChanged }: { pr: PullDetail; tint: string; session: string; repo: string; number: number; onChanged: () => void }) {
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
      <T variant="micro" tone="muted" style={{ textAlign: "center", marginTop: 14 }}>
        Open this PR from its run to merge, approve or comment.
      </T>
    );

  return (
    <View style={{ borderWidth: 1, borderColor: palette.border, backgroundColor: palette.card, borderRadius: radius.xl, padding: 12, gap: 10, marginTop: 10 }}>
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
                  <T variant="micro" weight="semibold" style={{ color: on ? palette.ok : palette.foreground }}>
                    {m}
                  </T>
                </Pressable>
              );
            })}
          </View>
          <T variant="micro" tone="faint" style={{ textAlign: "center", marginTop: -4 }}>
            {METHOD_HINT[method]}
          </T>
          <ArmButton title={`Merge (${method})`} armedTitle="Tap again to merge" variant="secondary" disabled={busy} onConfirm={() => act(() => api.mergePull(session, repo, number, { method }), `Merged #${number}`)} />
          <Button title="Auto-merge when ready" variant="ghost" small disabled={busy} onPress={() => void act(() => api.mergePull(session, repo, number, { method, auto: true }), "Auto-merge armed")} />
        </>
      ) : pr.state === "open" && v.blocked ? (
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tint, marginTop: 6 }} />
          <T variant="meta" tone="muted" style={{ flex: 1 }}>
            {v.blocked}
          </T>
        </View>
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
    <View style={{ gap: 12 }}>
      {/* a hairline rail threads the timeline dots, so the conversation reads as one flow */}
      <View style={{ position: "relative", gap: 12 }}>
        <View style={{ position: "absolute", left: 5, top: 14, bottom: 14, width: 1, backgroundColor: palette.border }} />
        <TimelineItem author={pr.author} at={pr.createdAt} body={pr.body?.trim() || "_No description provided._"} />
        {pr.comments?.map((c) => (
          <TimelineItem key={c.id} author={c.author} at={c.at} body={c.body} state={c.kind === "review" ? c.state : undefined} />
        ))}
      </View>
      {!!pr.reviewers?.length && (
        <View style={{ borderWidth: 1, borderColor: palette.border, borderRadius: radius.xl, padding: 12, gap: 8 }}>
          <T variant="micro" tone="muted" weight="semibold">
            REVIEWERS
          </T>
          {pr.reviewers.map((r) => (
            <View key={r.login} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <T variant="meta" weight="medium" style={{ flex: 1 }} numberOfLines={1}>
                {r.login}
              </T>
              <ReviewBadge state={r.state} />
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

function ReviewBadge({ state }: { state?: string }) {
  const { palette } = useTheme();
  const color = state === "approved" ? palette.ok : state === "changes_requested" ? palette.destructive : palette.mutedForeground;
  const label = state === "approved" ? "Approved" : state === "changes_requested" ? "Changes requested" : state === "commented" ? "Commented" : "Review asked";
  return (
    <View style={{ backgroundColor: `${color}1a`, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 }}>
      <T variant="micro" weight="medium" style={{ color }}>
        {label}
      </T>
    </View>
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

/** One authored body on the timeline — the PR description or a comment. */
function TimelineItem({ author, at, body, state }: { author?: string; at?: string; body: string; state?: string }) {
  const { palette } = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: 10 }}>
      <View style={{ width: 11, height: 11, borderRadius: 6, borderWidth: 2, borderColor: palette.mutedForeground, backgroundColor: palette.background, marginTop: 13 }} />
      <View style={{ flex: 1, minWidth: 0, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.card, borderRadius: radius.xl }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingTop: 9 }}>
          <T variant="meta" weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>
            {author ?? "unknown"}
          </T>
          {state ? <ReviewBadge state={state} /> : null}
          {at ? (
            <T variant="micro" tone="faint" style={{ marginLeft: "auto" }}>
              {relativeTime(at)}
            </T>
          ) : null}
        </View>
        <View style={{ paddingHorizontal: 12, paddingTop: 4, paddingBottom: 10 }}>
          <MarkdownLite text={body} />
        </View>
      </View>
    </View>
  );
}

function Commits({ pr, repo }: { pr: PullDetail; repo: string }) {
  const { palette } = useTheme();
  if (!pr.commits?.length) return <Empty icon="git-commit">No commits on this pull request.</Empty>;
  return (
    <View style={{ position: "relative", gap: 10 }}>
      <View style={{ position: "absolute", left: 5, top: 14, bottom: 14, width: 1, backgroundColor: palette.border }} />
      {pr.commits.map((c) => (
        <View key={c.sha} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ width: 11, height: 11, borderRadius: 6, borderWidth: 2, borderColor: palette.mutedForeground, backgroundColor: palette.background }} />
          <Pressable
            onPress={() => void WebBrowser.openBrowserAsync(`https://github.com/${repo}/commit/${c.sha}`)}
            style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: palette.border, borderRadius: radius.xl, paddingHorizontal: 12, paddingVertical: 10 }}
          >
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
        </View>
      ))}
    </View>
  );
}

function Files({ pr }: { pr: PullDetail }) {
  const { palette } = useTheme();
  const [open, setOpen] = useState<string | null>(null);
  if (!pr.files?.length) return <Empty icon="file-text">No files changed.</Empty>;
  const total = pr.additions + pr.deletions;
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 2 }}>
        <T variant="meta" tone="muted" style={{ flexShrink: 1 }}>
          {pr.files.length} {pr.files.length === 1 ? "file" : "files"} ·{" "}
          <T variant="meta" weight="medium" style={{ color: palette.ok }}>
            +{pr.additions}
          </T>{" "}
          <T variant="meta" weight="medium" style={{ color: palette.destructive }}>
            −{pr.deletions}
          </T>
          {pr.truncated ? " · truncated" : ""}
        </T>
        {/* the +/− balance as a tiny two-tone bar, the classic diffstat at a glance */}
        {total > 0 ? (
          <View style={{ flexDirection: "row", width: 72, height: 5, borderRadius: 3, overflow: "hidden" }}>
            <View style={{ width: `${(pr.additions / total) * 100}%`, backgroundColor: palette.ok }} />
            <View style={{ flex: 1, backgroundColor: palette.destructive }} />
          </View>
        ) : null}
      </View>
      {pr.files.map((f) => {
        const on = open === f.path;
        return (
          <View key={f.path} style={{ borderWidth: 1, borderColor: on ? palette.mutedForeground : palette.border, borderRadius: radius.xl, overflow: "hidden" }}>
            <Pressable onPress={() => setOpen(on ? null : f.path)} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10 }}>
              <Icon name={on ? "chevron-down" : "chevron-right"} size={13} color={palette.mutedForeground} />
              <T variant="micro" mono numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
                {f.path}
              </T>
              {f.status !== "modified" ? (
                <T variant="micro" tone="faint">
                  {f.status}
                </T>
              ) : null}
              <T variant="micro" mono weight="medium" style={{ color: palette.ok }}>
                +{f.additions}
              </T>
              <T variant="micro" mono weight="medium" style={{ color: palette.destructive }}>
                −{f.deletions}
              </T>
            </Pressable>
            {on ? (
              <View style={{ borderTopWidth: 1, borderTopColor: palette.border, paddingHorizontal: 8, paddingVertical: 8 }}>
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
    </View>
  );
}

function Checks({ pr }: { pr: PullDetail }) {
  const { palette } = useTheme();
  if (!pr.checkRuns?.length) return <Empty icon="check-circle">No checks reported on the head commit.</Empty>;
  return (
    <View style={{ gap: 8 }}>
      {pr.checkRuns.map((c, i) => {
        const running = c.status !== "completed";
        const ok = ["success", "neutral", "skipped"].includes(c.conclusion ?? "");
        const color = running ? palette.live : ok ? palette.ok : palette.destructive;
        return (
          <Pressable
            key={`${c.name}-${i}`}
            disabled={!c.url}
            onPress={() => c.url && void WebBrowser.openBrowserAsync(c.url)}
            style={{ flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: palette.border, borderRadius: radius.xl, paddingHorizontal: 12, paddingVertical: 11 }}
          >
            <Icon name={running ? "loader" : ok ? "check-circle" : "x-circle"} size={15} color={color} />
            <T variant="meta" weight="medium" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
              {c.name}
            </T>
            <View style={{ backgroundColor: `${color}1a`, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 }}>
              <T variant="micro" weight="medium" style={{ color }}>
                {running ? "running" : (c.conclusion ?? "done")}
              </T>
            </View>
            {c.url ? <Icon name="arrow-up-right" size={12} color={palette.faint} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function Empty({ icon, children }: { icon: IconName; children: React.ReactNode }) {
  const { palette } = useTheme();
  return (
    <View style={{ borderWidth: 1, borderStyle: "dashed", borderColor: palette.border, borderRadius: radius.xl, paddingVertical: 32, alignItems: "center", gap: 8 }}>
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: palette.muted, alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={15} color={palette.mutedForeground} />
      </View>
      <T variant="meta" tone="muted">
        {children}
      </T>
    </View>
  );
}
