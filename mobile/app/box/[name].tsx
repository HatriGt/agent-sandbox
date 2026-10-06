import React, { useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useFleet } from "@/hooks/useFleet";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { useWatch } from "@/hooks/useWatch";
import { api, type BoxView } from "@/lib/api";
import { friendlyName, isSleeping, tierGib, usageLevel } from "@/lib/format";
import { deriveTaskBoard } from "@/lib/planTasks";
import { splitReplies } from "@/lib/replies";
import { parseTrace } from "@/lib/trace";
import { useAuth } from "@/state/auth";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { Composer } from "@/components/Composer";
import { PlanChip, PlanSheet } from "@/components/PlanBoard";
import { MemoryBumpCard } from "@/components/MemoryCard";
import { MemorySaveCard } from "@/components/MemorySaveCard";
import { QueuedChip, QueuedSheet } from "@/components/QueuedList";
import { ScheduledCard } from "@/components/ScheduledCard";
import { draftKeyForBox } from "@/lib/draft";
import { QuestionCard } from "@/components/QuestionCard";
import { DigestCard } from "@/components/DigestCard";
import { OutcomeCard } from "@/components/OutcomeCard";
import { AttemptGroupCard } from "@/components/AttemptGroupCard";
import { RunSummary } from "@/components/RunSummary";
import { TurnRail, type Turn } from "@/components/TurnRail";
import { SleepingCard, WakingCard } from "@/components/WakingCard";
import { Button } from "@/components/ui/Button";
import { groupEvents, ThreadRow } from "@/components/TranscriptView";
import { BoxActionsSheet, currentMemoryTier } from "@/components/sheets/BoxActionsSheet";
import { ChangesSheet } from "@/components/sheets/ChangesSheet";
import { PrSheet } from "@/components/sheets/PrSheet";
import { T } from "@/components/ui/AppText";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Sheet } from "@/components/ui/Sheet";
import { FadeInUp, TypingDots } from "@/components/ui/Motion";
import { StatePill } from "@/components/ui/StatePill";
import { UsageMeter } from "@/components/ui/UsageMeter";
import { WorkingDot } from "@/components/ui/WorkingDot";
import { CodeRefSession } from "@/components/CodeRef";

type AskEntry = { q: string; a?: string; pending: boolean };

const PR_RE = /github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/g;

/** expo-router route error boundary: a render bug degrades to a retry screen, never a crash. */
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0f0f12" }}>
      <View style={{ flex: 1, justifyContent: "center", padding: 28, gap: 12 }}>
        <T serif variant="h1">
          Something broke rendering this thread.
        </T>
        <T variant="meta" tone="muted" selectable>
          {error.message}
        </T>
        <Button title="Try again" onPress={() => void retry()} />
      </View>
    </SafeAreaView>
  );
}

/**
 * Auth gate for deep links (asb://box/<name>, App Links): arriving signed out
 * must not crash — land on /welcome instead. No target carry-over after
 * sign-in; the user re-taps the link.
 */
export default function ThreadRoute() {
  const { signedIn } = useAuth();
  if (!signedIn) return <Redirect href="/welcome" />;
  return <Thread />;
}

/** The Thread — the screen you live in. */
function Thread() {
  const nav = useRouter();
  // Opened from a notification or link there is no stack underneath: "back" must land on Home,
  // not close the app.
  const router = useMemo(
    () => ({ ...nav, back: () => (nav.canGoBack() ? nav.back() : nav.replace("/(tabs)/home")) }),
    [nav],
  );
  const { palette } = useTheme();
  const { name } = useLocalSearchParams<{ name: string }>();
  const session = typeof name === "string" ? name : "";
  const { meta, log, connected, gone, refresh } = useWatch(session || undefined);

  const [sheet, setSheet] = useState<null | "changes" | "pr" | "actions" | "model" | "plan" | "queued">(null);
  const [stopping, setStopping] = useState(false);
  const [models, setModels] = useState<{ id: string; label: string; tier: string }[]>([]);
  const [currentModel, setCurrentModel] = useState<string | null>(null);
  const [pickedModel, setPickedModel] = useState<string | null>(null);
  const keyboardInset = useKeyboardInset();
  const [asks, setAsks] = useState<AskEntry[]>([]);
  const [answering, setAnswering] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<{ text: string; nonce: number } | null>(null);
  const [stick, setStick] = useState(true);
  const scrollRef = useRef<ScrollView>(null);
  const [scrollY, setScrollY] = useState(0);
  const [viewportH, setViewportH] = useState(0);
  const turnYs = useRef(new Map<string, number>());
  const [turnTick, setTurnTick] = useState(0);
  const buzzedRef = useRef(false);
  const mountedAt = useRef(Date.now());

  // The fleet sweep is authoritative for lifecycle state (the watch hub serves
  // a cached snapshot that can be stale for a stopped box — the web treats the
  // fleet poll the same way). Merge the fleet row over the watch meta.
  const { snap: fleetSnap } = useFleet(!!session);
  const fleetBox = fleetSnap?.boxes.find((b) => b.name === session) ?? null;
  const merged = useMemo(() => {
    if (!meta && !fleetBox) return null;
    return { ...(meta ?? {}), ...(fleetBox ?? {}) } as NonNullable<typeof meta> & Partial<BoxView>;
  }, [meta, fleetBox]);

  const events = useMemo(() => parseTrace(log), [log]);
  const done = merged?.runState === "done";
  const items = useMemo(() => groupEvents(events, { done }), [events, done]);

  // Optimistic echoes: a sent message shows instantly; the durable ⟦you⟧ log line replaces it once
  // the round-trip lands. Same mechanism as the web (see mobile/src/lib/replies.ts for the
  // retire-once subtlety around the bounded log tail).
  const [replies, setReplies] = useState<string[]>([]);
  const [settled, setSettled] = useState<Set<string>>(() => new Set());
  const persisted = useMemo(
    () => new Set(events.filter((e) => e.kind === "you").map((e) => e.text.trim())),
    [events],
  );
  const { pending: pendingEchoes, nowSettled } = splitReplies(replies, persisted, settled);
  useEffect(() => {
    if (!nowSettled.length) return;
    setSettled((s) => {
      const next = new Set(s);
      for (const r of nowSettled) next.add(r.trim());
      return next;
    });
    setReplies((rs) => rs.filter((r) => !nowSettled.includes(r)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowSettled.join("\u0000")]);
  // The plan joined to evidence — chip in the dock, full board in a sheet.
  const board = useMemo(() => deriveTaskBoard(events), [events]);
  const running = merged?.runState === "running";
  const waiting = merged?.runState === "waiting" && !!merged.question;
  const sleeping = isSleeping(merged?.boxStatus);
  const poolFree = fleetBox?.role === "pool-free";
  const booting = !gone && !merged && log.length === 0;
  // Animate entrances only for items that appear after mount, not the history dump.
  const animate = Date.now() - mountedAt.current > 1500;

  // Auto-wake, with visible progress. NOT one-shot: /wake.json is idempotent, so while the box
  // still reports sleeping we re-nudge it every 10s. The old fire-once ref armed itself forever
  // when the single wake call failed (server restart, "Draining" 503, network blip) — this reused
  // route instance then never woke that box again and the card sat on "Reconnecting the transcript".
  const [wakingSince, setWakingSince] = useState<number | null>(null);
  // "Sleep now" from the ⋯ sheet: the thread stays open, so without this flag the auto-wake below
  // would bounce the box straight back up. Cleared by an explicit Wake tap or leaving the thread.
  const [sleptHere, setSleptHere] = useState(false);
  useEffect(() => {
    if (!sleeping || !session || sleptHere) return;
    setWakingSince((w) => w ?? Date.now());
    let cancelled = false;
    const fire = () => {
      api.wake(session).catch((e) => {
        if (!cancelled) setNote(`Could not wake — ${e instanceof Error ? e.message : e}. Retrying…`);
      });
    };
    fire();
    const t = setInterval(fire, 10_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [sleeping, session, sleptHere]);
  // The card lingers ~1.4s after awake so "Awake" is actually seen.
  useEffect(() => {
    if (!sleeping && wakingSince != null) {
      const t = setTimeout(() => setWakingSince(null), 1400);
      return () => clearTimeout(t);
    }
  }, [sleeping, wakingSince]);
  // A different box on this reused route instance must not inherit the old waking card — nor the
  // previous box's optimistic echoes, answered questions, or queued model override.
  useEffect(() => {
    setWakingSince(null);
    setSleptHere(false);
    setNote(null);
    setReplies([]);
    setSettled(new Set());
    setAsks([]);
    setPickedModel(null);
  }, [session]);

  useEffect(() => {
    if (!session) return;
    api
      .models(session)
      .then((r) => {
        setModels(r.models);
        setCurrentModel(r.current);
      })
      .catch(() => {});
  }, [session]);

  // Which operator messages have a restore point. Refetched whenever the run settles.
  const [revertable, setRevertable] = useState<Set<number>>(new Set());
  const [revertAsk, setRevertAsk] = useState<{ message: number; text: string } | null>(null);
  const [reverting, setReverting] = useState(false);
  useEffect(() => {
    if (!session || running) return;
    api
      .revertPoints(session)
      .then((r) => setRevertable(new Set(r.messages)))
      .catch(() => {});
  }, [session, running]);
  const canRevertNow = !sleeping && !running;

  // Message ordinal per grouped item, matching the web: task = 1; each `you`
  // increments — but an ask+answer PAIR counts once (the web folds them into
  // one `asked` item that never gets a revert button).
  const msgIndexOf = useMemo(() => {
    const map = new Map<number, number>();
    let n = 1;
    items.forEach((it, i) => {
      if (it.kind === "ask") {
        n += 1; // the pair's single increment (answered or not)
      } else if (it.kind === "you") {
        if (items[i - 1]?.kind === "ask") return; // the answer half of the pair: no button
        n += 1;
        map.set(i, n);
      }
    });
    return map;
  }, [items]);

  const doRevert = async () => {
    if (!revertAsk) return;
    setReverting(true);
    try {
      await api.revert(session, revertAsk.message);
      setRevertAsk(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      await refresh();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
      setRevertAsk(null);
    } finally {
      setReverting(false);
    }
  };

  // Out-of-memory rescue — same behavior as the web thread: when the agent was OOM-killed (exit
  // 137) or memory is critically full mid-run, offer one tap that raises the tier to the next size
  // up and resumes the task. `bumped` remembers the rescue so the card does not re-offer while the
  // fleet poll still carries pre-resize metrics.
  const nextMemoryTier = useMemo(() => {
    const cur = tierGib(currentMemoryTier(merged?.mem, fleetSnap?.lifecycle.memoryDefault));
    if (cur == null) return null;
    const bigger = (fleetSnap?.lifecycle.memoryTiers ?? [])
      .map((t) => ({ t, g: tierGib(t) ?? Infinity }))
      .filter((x) => x.g > cur)
      .sort((a, b) => a.g - b.g);
    return bigger[0]?.t ?? null;
  }, [merged?.mem, fleetSnap?.lifecycle.memoryTiers, fleetSnap?.lifecycle.memoryDefault]);
  const [bumped, setBumped] = useState<string | null>(null);
  useEffect(() => setBumped(null), [session]);
  const oomKilled = !sleeping && !running && merged?.exitCode === 137;
  const memPressure = !sleeping && running && usageLevel(merged?.memUsage) === "critical";
  const showMemoryCard = !!nextMemoryTier && (oomKilled || memPressure) && bumped !== `${session}:${nextMemoryTier}`;

  // Haptic nudge the moment the agent stops on a question while you're watching.
  useEffect(() => {
    if (waiting && !buzzedRef.current) {
      buzzedRef.current = true;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    }
    if (!waiting) buzzedRef.current = false;
  }, [waiting]);

  // Every PR the run mentioned, de-duped in order of appearance — the sheet offers a switcher.
  const pulls = useMemo(() => {
    const seen = new Map<string, { repo: string; number: number }>();
    for (const m of log.matchAll(PR_RE)) seen.set(`${m[1]}#${m[2]}`, { repo: m[1], number: Number(m[2]) });
    return [...seen.values()];
  }, [log]);
  const pr = pulls.length ? pulls[pulls.length - 1] : null;

  const steer = async (text: string) => {
    setNote(null);
    setReplies((rs) => [...rs, text]); // echo now — the round-trip must not gate the bubble
    try {
      const r = await api.resume(session, text, pickedModel ? { model: pickedModel } : {});
      if ("queued" in r && r.queued) setNote("Queued — delivered when this turn ends.");
      await refresh();
    } catch (e) {
      // Drop ONE echo of this text, not every duplicate — an earlier identical send may be in
      // flight or already delivered.
      setReplies((rs) => {
        const at = rs.lastIndexOf(text);
        return at === -1 ? rs : [...rs.slice(0, at), ...rs.slice(at + 1)];
      });
      setNote(e instanceof Error ? e.message : String(e));
      throw e;
    }
  };

  // Stop the running turn (web: RunPill WatchPill). The session is kept — a message picks it back up.
  useEffect(() => {
    if (!running) setStopping(false);
  }, [running]);
  const stop = async () => {
    setStopping(true);
    setNote(null);
    try {
      await api.interrupt(session);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      await refresh();
    } catch (e) {
      setStopping(false);
      setNote(`Could not stop — ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const queuedCount = merged?.queued?.length ?? 0;
  useEffect(() => {
    if (queuedCount === 0) setSheet((s) => (s === "queued" ? null : s));
  }, [queuedCount]);

  const answer = async (text: string) => {
    setAnswering(true);
    setNote(null);
    try {
      await api.resume(session, text, { force: true });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      await refresh();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setAnswering(false);
    }
  };

  const ask = async (q: string) => {
    setAsks((a) => [...a, { q, pending: true }]);
    try {
      const r = await api.ask(session, q);
      setAsks((a) => a.map((e) => (e.q === q && e.pending ? { q, a: r.answer, pending: false } : e)));
    } catch (e) {
      setAsks((a) =>
        a.map((en) => (en.q === q && en.pending ? { q, a: `✕ ${e instanceof Error ? e.message : e}`, pending: false } : en)),
      );
    }
  };

  const boxForActions: BoxView | null = merged ? ({ role: "session", ...merged } as BoxView) : null;

  const turns = useMemo<Turn[]>(() => {
    void turnTick;
    const out: Turn[] = [];
    const taskY = turnYs.current.get("task");
    if (taskY !== undefined) out.push({ key: "task", kind: "task", y: taskY });
    items.forEach((it, i) => {
      const y = turnYs.current.get(`${it.kind}-${i}`);
      if (y === undefined) return;
      if (it.kind === "ask") out.push({ key: `ask-${i}`, kind: "question", y });
      else if (it.kind === "you") out.push({ key: `you-${i}`, kind: "you", y });
    });
    return out.sort((a, b) => a.y - b.y);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, turnTick]);

  if (gone) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }}>
        <View style={{ flex: 1, justifyContent: "center", padding: 28, gap: 12 }}>
          <Icon name="wind" size={32} color={palette.faint} />
          <T serif variant="h1">This machine no longer exists.</T>
          <T variant="body" tone="muted">
            It was destroyed or reaped — sandboxes are throwaway by design, and nothing outlives them.
          </T>
          <Pressable onPress={() => router.back()} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Icon name="arrow-left" size={16} color={palette.live} />
            <T variant="body" tone="live">Back</T>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // Second header line: harness, workflow step, skills. Capped so the header stays two lines; the
  // overflow becomes "+k".
  const extras: { key: string; label: string; icon: IconName; color?: string; dim?: boolean }[] = [];
  if (merged?.harness) extras.push({ key: "harness", label: merged.harness.name, icon: "sliders" });
  if (merged?.workflow) {
    const w = merged.workflow;
    extras.push({
      key: "workflow",
      label: `step ${w.step}/${w.total} · ${w.line}`,
      icon: "layers",
      color: w.state === "failed" ? palette.destructive : w.state === "done" ? palette.ok : palette.live,
    });
  }
  for (const s of merged?.skills ?? []) extras.push({ key: `skill-${s.name}`, label: `/${s.name}`, icon: "zap", dim: s.how === "auto" });
  const EXTRAS_MAX = 3;
  const shownExtras = extras.slice(0, EXTRAS_MAX);
  const extraOverflow = extras.length - shownExtras.length;

  const chips: { key: "changes" | "pr" | "files"; label: string; icon: IconName }[] = [
    { key: "changes", label: "Changes", icon: "file-plus" },
    { key: "files", label: "Files", icon: "folder" },
    ...(pr
      ? ([{ key: "pr" as const, label: pulls.length > 1 ? `PR #${pr.number} +${pulls.length - 1}` : `PR #${pr.number}`, icon: "git-pull-request" as IconName }])
      : []),
  ];

  return (
    <CodeRefSession.Provider value={session || null}>
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }} edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        {/* Header — one row, 56px, like the web thread (grows by one chip line for harness /
            workflow / skills, never more) */}
        <View
          style={{
            minHeight: 56,
            paddingVertical: 6,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            paddingHorizontal: 8,
            borderBottomWidth: 1,
            borderBottomColor: palette.border,
          }}
        >
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            style={({ pressed }) => ({ padding: 8, opacity: pressed ? 0.5 : 1, transform: [{ scale: pressed ? 0.92 : 1 }] })}
          >
            <Icon name="chevron-left" size={22} color={palette.mutedForeground} />
          </Pressable>
          {/* minWidth:0 lets this column actually shrink; without it a long title or a third repo
              chip widens the row and shoves the state pill and ⋯ past the right edge. */}
          <View style={{ flex: 1, minWidth: 0 }}>
            <T variant="body" weight="semibold" numberOfLines={1}>
              {merged?.title || merged?.task?.split("\n")[0] || session}
            </T>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <T variant="micro" mono tone="faint" numberOfLines={1} style={{ flexShrink: 1, minWidth: 0 }}>
                {friendlyName(session)}
              </T>
              {/* Two chips is all a 56px header can carry legibly; the rest are in the ⋯ menu. */}
              {merged?.repos?.slice(0, 2).map((r) => (
                <View key={r.name} style={{ flexDirection: "row", alignItems: "center", gap: 3, flexShrink: 1, minWidth: 0 }}>
                  <Icon name="git-branch" size={10} color={palette.faint} />
                  <T variant="micro" mono tone="faint" numberOfLines={1} style={{ flexShrink: 1, minWidth: 0 }}>
                    {r.name.split("/").pop()}
                  </T>
                </View>
              ))}
              {merged && merged.repos && merged.repos.length > 2 ? (
                <T variant="micro" mono tone="faint" style={{ flexShrink: 0 }}>
                  +{merged.repos.length - 2}
                </T>
              ) : null}
            </View>
            {shownExtras.length > 0 ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
                {shownExtras.map((x) => (
                  <View
                    key={x.key}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 3,
                      flexShrink: 1,
                      minWidth: 0,
                      paddingHorizontal: 6,
                      paddingVertical: 1,
                      borderRadius: radius.pill,
                      backgroundColor: palette.secondary,
                      opacity: x.dim ? 0.6 : 1,
                    }}
                  >
                    <Icon name={x.icon} size={9} color={x.color ?? palette.faint} />
                    <T variant="micro" numberOfLines={1} style={{ flexShrink: 1, minWidth: 0, color: x.color ?? palette.mutedForeground }}>
                      {x.label}
                    </T>
                  </View>
                ))}
                {extraOverflow > 0 ? (
                  <T variant="micro" mono tone="faint" style={{ flexShrink: 0 }}>
                    +{extraOverflow}
                  </T>
                ) : null}
              </View>
            ) : null}
          </View>
          {merged ? <StatePill runState={merged.runState} boxStatus={merged.boxStatus} exitCode={merged.exitCode} /> : null}
          <Pressable
            onPress={() => setSheet("actions")}
            hitSlop={12}
            style={({ pressed }) => ({ padding: 8, opacity: pressed ? 0.5 : 1, transform: [{ scale: pressed ? 0.92 : 1 }] })}
          >
            <Icon name="more-horizontal" size={20} color={palette.mutedForeground} />
          </Pressable>
        </View>

        {/* Vitals strip: memory and disk against their caps. Its own row rather than crowding the
            56px header, and only while awake — the controller drops these numbers for a sleeping box
            so a meter never shows a frozen value that looks live. The ⋯ menu is where you act on it. */}
        {!sleeping && (merged?.memUsage || merged?.disk) ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 16,
              paddingHorizontal: 16,
              paddingVertical: 7,
              borderBottomWidth: 1,
              borderBottomColor: palette.border,
            }}
          >
            <UsageMeter kind="memory" usage={merged?.memUsage} fluid style={{ flex: 1 }} />
            <UsageMeter kind="disk" usage={merged?.disk} fluid style={{ flex: 1 }} />
          </View>
        ) : null}

        {/* Transcript */}
        <View style={{ flex: 1 }}>
          <ScrollView
            ref={scrollRef}
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
            onScroll={(e) => {
              const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
              setStick(contentOffset.y + layoutMeasurement.height > contentSize.height - 80);
              setScrollY(contentOffset.y);
              setViewportH(layoutMeasurement.height);
            }}
            scrollEventThrottle={100}
            onContentSizeChange={() => {
              if (stick) scrollRef.current?.scrollToEnd({ animated: false });
            }}
          >
            {booting && (
              <View style={{ alignItems: "center", paddingVertical: 60, gap: 12 }}>
                <WorkingDot color={palette.live} size={12} />
                {/* This state is "first snapshot not here yet" — almost always an EXISTING thread
                    being opened (fresh boots go through app/booting.tsx). Claiming a machine is
                    booting here was a lie that flashed on every open of an awake box. */}
                <T variant="body" tone="muted">Opening the thread…</T>
              </View>
            )}
            {!booting && !sleeping && merged?.runState === "idle" && items.length === 0 && (
              // A just-delegated box reports `idle` until its run sentinel is written (a few seconds
              // after boot/claim). That window is "starting", not "idle": inviting a message there
              // invites a duplicate task. A claimed box or one that already carries a task is a run
              // being set up — only a genuinely unused box gets the empty-idle copy.
              (fleetBox?.role === "pool-claimed" || !!merged.task) && merged.exitCode == null ? (
                <View style={{ alignItems: "center", paddingVertical: 60, gap: 12 }}>
                  <WorkingDot color={palette.live} size={12} />
                  <T variant="body" tone="muted">Starting up — the sandbox is getting your task ready…</T>
                </View>
              ) : (
                <View style={{ alignItems: "center", paddingVertical: 60, gap: 12, paddingHorizontal: 20 }}>
                  <Icon name="box" size={28} color={palette.faint} />
                  <T variant="body" tone="muted" style={{ textAlign: "center" }}>
                    {poolFree
                      ? "A warm, empty machine from the pool — pre-booted, waiting to be claimed. Send a task below and it starts here instantly."
                      : "Nothing has happened on this machine yet. Send a message below to start."}
                  </T>
                </View>
              )
            )}
            {sleeping && sleptHere ? (
              <SleepingCard
                onWake={() => {
                  setSleptHere(false);
                  setWakingSince(Date.now());
                  api.wake(session).catch((e) => setNote(`Could not wake — ${e instanceof Error ? e.message : e}.`));
                }}
              />
            ) : (
              // Gate on wakingSince (set by the auto-wake effect one commit after `sleeping` flips)
              // so the card never starts its clock at screen-mount time and flashes "stuck".
              wakingSince != null && (
                <WakingCard
                  sleeping={sleeping}
                  startedAt={wakingSince}
                  onRetry={() => {
                    setWakingSince(Date.now());
                    api.wake(session).catch((e) => setNote(`Could not wake — ${e instanceof Error ? e.message : e}.`));
                  }}
                />
              )
            )}
            {/* The task that started this run — pinned first, like the web's Task bubble. */}
            {merged?.task ? (
              <View
                onLayout={(e) => {
                  turnYs.current.set("task", e.nativeEvent.layout.y);
                  setTurnTick((t) => t + 1);
                }}
              >
                <ThreadRow item={{ kind: "you", text: merged.task }} />
              </View>
            ) : null}
            {items.map((it, i) => {
              const msgIndex = msgIndexOf.get(i);
              const revertableHere =
                it.kind === "you" && msgIndex !== undefined && revertable.has(msgIndex) && canRevertNow;
              const isTurn = it.kind === "you" || it.kind === "ask";
              const row = (
                <ThreadRow
                  key={isTurn ? undefined : i}
                  item={it}
                  session={session}
                  animate={animate && i >= items.length - 2}
                  live={running && i === items.length - 1}
                  onRevert={
                    revertableHere && msgIndex !== undefined
                      ? (text) => setRevertAsk({ message: msgIndex, text })
                      : undefined
                  }
                />
              );
              return isTurn ? (
                <View
                  key={i}
                  onLayout={(e) => {
                    turnYs.current.set(`${it.kind}-${i}`, e.nativeEvent.layout.y);
                    setTurnTick((t) => t + 1);
                  }}
                >
                  {row}
                </View>
              ) : (
                <React.Fragment key={i}>{row}</React.Fragment>
              );
            })}
            {/* Optimistic echoes — sent but not yet in the durable log */}
            {pendingEchoes.map((r, i) => (
              <FadeInUp key={`echo-${i}`}>
                <ThreadRow item={{ kind: "you", text: r }} />
              </FadeInUp>
            ))}
            {!sleeping && merged?.runState === "done" && items.length > 0 && (
              <RunSummary
                events={events}
                exitCode={merged?.exitCode}
                title={merged?.title || merged?.task?.split("\n")[0] || session}
                session={session}
                onRunAgain={() => router.push({ pathname: "/new", params: { task: merged?.task ?? "" } })}
              />
            )}
            {/* The digest ("run receipt") — server-derived detail under the summary pill. Keyed by
                exit code + how many turns you sent, so a resume that finishes again refetches. */}
            {!sleeping && merged?.runState === "done" && merged.exitCode !== undefined && items.length > 0 && (
              <>
                <AttemptGroupCard box={session} fetchKey={`${merged.exitCode}:${persisted.size}`} />
                <OutcomeCard session={session} fetchKey={`${merged.exitCode}:${persisted.size}`} />
                <DigestCard session={session} fetchKey={`${merged.exitCode}:${persisted.size}`} />
              </>
            )}
            {running && (
              <FadeInUp>
                <View style={{ flexDirection: "row", gap: 10, alignItems: "center", paddingVertical: 12 }}>
                  <TypingDots color={palette.live} />
                  <T variant="meta" tone="live" weight="medium" style={{ flex: 1 }}>
                    {stopping ? "stopping…" : "working"}
                    {connected ? "" : " · reconnecting…"}
                  </T>
                  <Pressable
                    onPress={() => void stop()}
                    disabled={stopping}
                    hitSlop={8}
                    accessibilityLabel="Stop the running turn"
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                      paddingVertical: 5,
                      paddingHorizontal: 11,
                      borderRadius: radius.pill,
                      borderWidth: 1,
                      borderColor: palette.border,
                      opacity: stopping ? 0.5 : pressed ? 0.7 : 1,
                    })}
                  >
                    <Icon name="square" size={10} color={palette.foreground} />
                    <T variant="micro" weight="medium">
                      {stopping ? "Stopping…" : "Stop"}
                    </T>
                  </Pressable>
                </View>
                {merged?.stalled && !stopping ? (
                  <T variant="micro" tone="faint" style={{ marginTop: -6, paddingBottom: 8 }}>
                    stalled — no output for a while
                  </T>
                ) : null}
              </FadeInUp>
            )}
            {asks.length > 0 && (
              <View style={{ gap: 8, marginTop: 12 }}>
                {asks.map((a, i) => (
                  <View
                    key={i}
                    style={{
                      borderWidth: 1.5,
                      borderStyle: "dashed",
                      borderColor: palette.lineStrong,
                      borderRadius: radius.xl,
                      padding: 12,
                      gap: 6,
                    }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                      <Icon name="eye" size={12} color={palette.faint} />
                      <T variant="micro" tone="faint" weight="semibold">
                        Ask · read-only co-pilot
                      </T>
                    </View>
                    <T variant="body" weight="medium">{a.q}</T>
                    {a.pending ? <TypingDots color={palette.faint} /> : <T variant="body" tone="muted" selectable>{a.a}</T>}
                  </View>
                ))}
              </View>
            )}
            {/* What this chat scheduled — under the transcript so a long list scrolls with it. */}
            {!booting ? (
              <View style={{ marginTop: 12 }}>
                <ScheduledCard
                  box={session}
                  runState={merged?.runState}
                  onNote={setNote}
                  onPrefill={(text) => setPrefill({ text, nonce: Date.now() })}
                />
              </View>
            ) : null}
          </ScrollView>

          <TurnRail
            turns={turns}
            visible={!stick}
            scrollY={scrollY}
            viewportH={viewportH}
            onJump={(y) => scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true })}
          />

          {/* Scroll-to-bottom pill */}
          {!stick && (
            <Pressable
              onPress={() => scrollRef.current?.scrollToEnd({ animated: true })}
              style={{
                position: "absolute",
                bottom: 12,
                alignSelf: "center",
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                backgroundColor: palette.popover,
                borderWidth: 1,
                borderColor: palette.border,
                borderRadius: radius.pill,
                paddingVertical: 6,
                paddingHorizontal: 12,
                shadowColor: "#000",
                shadowOpacity: 0.15,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 3 },
                elevation: 6,
              }}
            >
              <Icon name="arrow-down" size={14} color={palette.foreground} />
              <T variant="micro" weight="medium">Latest</T>
            </Pressable>
          )}
        </View>

        {/* Dock chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0 }}
          contentContainerStyle={{ gap: 6, paddingHorizontal: 16, paddingVertical: 6 }}
        >
          {board ? <PlanChip board={board} live={running} onPress={() => setSheet("plan")} /> : null}
          {chips.map((c) => (
            <Pressable
              key={c.key}
              onPress={() => (c.key === "files" ? router.push(`/files/${encodeURIComponent(session)}`) : setSheet(c.key))}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                paddingVertical: 7,
                paddingHorizontal: 12,
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: palette.border,
                backgroundColor: palette.card,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Icon name={c.icon} size={13} color={palette.mutedForeground} />
              <T variant="meta" weight="medium" numberOfLines={1}>{c.label}</T>
            </Pressable>
          ))}
          {queuedCount > 0 ? <QueuedChip count={queuedCount} onPress={() => setSheet("queued")} /> : null}
        </ScrollView>

        {/* Notes a run just produced — Keep / Forget. Fixed above the dock so the decision is at hand. */}
        <MemorySaveCard key={session} memoryNew={meta?.memoryNew} />


        {note ? (
          <T variant="micro" tone="muted" style={{ paddingHorizontal: 16, paddingBottom: 4 }}>
            {note}
          </T>
        ) : null}

        {showMemoryCard && nextMemoryTier ? (
          <FadeInUp style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
            <MemoryBumpCard
              session={session}
              kind={oomKilled ? "oom" : "pressure"}
              nextTier={nextMemoryTier}
              memUsage={merged?.memUsage}
              onDone={() => {
                setBumped(`${session}:${nextMemoryTier}`);
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
                void refresh();
              }}
              onError={(m) => setNote(`Could not add memory — ${m}`)}
            />
          </FadeInUp>
        ) : null}

        {waiting && merged?.question ? (
          <FadeInUp style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
            <QuestionCard question={merged.question} onAnswer={answer} busy={answering} />
          </FadeInUp>
        ) : null}

        <View style={{ paddingHorizontal: 16, paddingBottom: 8 + keyboardInset }}>
          <Composer
            key={session}
            session={session}
            draftKey={draftKeyForBox(session)}
            prefill={prefill}
            onSend={steer}
            onAsk={ask}
            running={running}
            sleeping={sleeping}
            disabled={booting}
            accessoryLeft={
              models.length > 0 ? (
                <Pressable
                  onPress={() => setSheet("model")}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 5,
                    paddingVertical: 4,
                    paddingHorizontal: 10,
                    borderRadius: radius.pill,
                    borderWidth: 1,
                    borderColor: pickedModel ? palette.live : palette.border,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Icon name="cpu" size={11} color={pickedModel ? palette.live : palette.faint} />
                  {/* Model names run long ("Claude Sonnet 5 (thinking)") and this chip shares a row
                      with both lane toggles — cap it rather than let it push them off. */}
                  <T variant="micro" weight="medium" numberOfLines={1} tone={pickedModel ? "live" : "faint"} style={{ maxWidth: 120 }}>
                    {models.find((m) => m.id === (pickedModel ?? currentModel))?.label ?? "Model"}
                  </T>
                </Pressable>
              ) : null
            }
          />
        </View>
      </KeyboardAvoidingView>

      {/* Revert confirm — quotes the message it rolls back to */}
      <Sheet visible={!!revertAsk} onClose={() => setRevertAsk(null)} title="Revert to before this message?">
        <View style={{ gap: 12, paddingBottom: 12 }}>
          <View
            style={{
              backgroundColor: palette.secondary,
              borderRadius: radius.lg,
              padding: 12,
              borderLeftWidth: 3,
              borderLeftColor: palette.lineStrong,
            }}
          >
            <T variant="body" numberOfLines={4}>
              {revertAsk?.text}
            </T>
          </View>
          <T variant="meta" tone="muted">
            The sandbox and the agent's memory return to the state before this message was delivered — the
            later work in this thread is discarded. Anything already pushed to GitHub stays.
          </T>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button title="Keep everything" variant="secondary" style={{ flex: 1 }} onPress={() => setRevertAsk(null)} />
            <Button title={reverting ? "Reverting…" : "Revert"} variant="destructive" style={{ flex: 1 }} loading={reverting} onPress={doRevert} />
          </View>
        </View>
      </Sheet>

      <PlanSheet board={board} live={running} visible={sheet === "plan"} onClose={() => setSheet(null)} />
      <QueuedSheet
        session={session}
        visible={sheet === "queued"}
        onClose={() => setSheet(null)}
        queuedCount={queuedCount}
        onChanged={() => void refresh()}
      />
      <ChangesSheet session={session} repos={merged?.repos ?? []} visible={sheet === "changes"} onClose={() => setSheet(null)} />
      {pulls.length ? (
        <PrSheet session={session} pulls={pulls} visible={sheet === "pr"} onClose={() => setSheet(null)} />
      ) : null}
      <BoxActionsSheet
        box={boxForActions}
        log={log}
        memoryTiers={fleetSnap?.lifecycle.memoryTiers}
        memoryDefault={fleetSnap?.lifecycle.memoryDefault}
        diskTiers={fleetSnap?.lifecycle.diskTiers}
        visible={sheet === "actions"}
        onClose={() => setSheet(null)}
        onChanged={refresh}
        onSlept={() => setSleptHere(true)}
        onDestroyed={() => router.back()}
        onRunAgain={
          merged?.task
            ? () => {
                setSheet(null);
                router.push({ pathname: "/new", params: { task: merged?.task ?? "" } });
              }
            : undefined
        }
      />
      <Sheet visible={sheet === "model"} onClose={() => setSheet(null)} title="Model">
        <View style={{ gap: 4, paddingBottom: 12 }}>
          <T variant="meta" tone="muted" style={{ marginBottom: 6 }}>
            Applies to your next message on this machine.
          </T>
          {models.map((m) => {
            const active = m.id === (pickedModel ?? currentModel);
            return (
              <Pressable
                key={m.id}
                onPress={() => {
                  setPickedModel(m.id === currentModel ? null : m.id);
                  setSheet(null);
                }}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  paddingVertical: 12,
                  paddingHorizontal: 12,
                  borderRadius: radius.lg,
                  backgroundColor: active ? palette.accent : "transparent",
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Icon name="cpu" size={15} color={active ? palette.foreground : palette.faint} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T variant="body" weight={active ? "semibold" : "regular"} numberOfLines={1}>
                    {m.label}
                  </T>
                  <T variant="micro" mono tone="faint" numberOfLines={1}>
                    {m.id}
                    {m.id === currentModel ? " · current" : ""}
                  </T>
                </View>
                {active && (
                  <View style={{ flexShrink: 0 }}>
                    <Icon name="check" size={16} color={palette.ok} />
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      </Sheet>
    </SafeAreaView>
    </CodeRefSession.Provider>
  );
}
