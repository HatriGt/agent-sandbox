import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, View, type ViewToken } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFleet } from "@/hooks/useFleet";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { useNow } from "@/hooks/useNow";
import { useWatch } from "@/hooks/useWatch";
import { api, type BoxView } from "@/lib/api";
import { isSleeping, tierGib, usageLevel } from "@/lib/format";
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
import { OutcomeView, useOutcome } from "@/components/OutcomeCard";
import { AttemptGroupCard } from "@/components/AttemptGroupCard";
import { TurnRail, type Turn } from "@/components/TurnRail";
import { SleepingCard, WakingCard } from "@/components/WakingCard";
import { Button } from "@/components/ui/Button";
import { groupEvents, shareItems, ThreadRow, type ThreadItem } from "@/components/TranscriptView";
import { BoxActionsSheet, currentMemoryTier } from "@/components/sheets/BoxActionsSheet";
import { ChangesSheet } from "@/components/sheets/ChangesSheet";
import { PrSheet } from "@/components/sheets/PrSheet";
import { RunInspectorSheet } from "@/components/thread/RunInspectorSheet";
import { ThreadHeader, type DisplayState } from "@/components/thread/ThreadHeader";
import { T } from "@/components/ui/AppText";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Sheet } from "@/components/ui/Sheet";
import { UsageMeter } from "@/components/ui/UsageMeter";
import { CodeRefSession } from "@/components/CodeRef";
import { AgentLoader, FadeInUp, haptic, PressScale, TypingDots, WorkingDot } from "@/components/motion";

type AskEntry = { q: string; a?: string; pending: boolean };

const VIEWABILITY = { itemVisiblePercentThreshold: 10 };

const PR_RE = /github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/g;

/** expo-router route error boundary: a render bug degrades to a retry screen, never a crash. */
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  const { palette } = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }}>
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

  const [sheet, setSheet] = useState<null | "changes" | "pr" | "actions" | "model" | "plan" | "queued" | "inspector">(null);
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
  const stickRef = useRef(true);
  stickRef.current = stick;
  const listRef = useRef<FlatList<ThreadItem>>(null);
  const [topIndex, setTopIndex] = useState(0);
  const [viewportH, setViewportH] = useState(0);
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
  // Every log tick re-parses into fresh objects; shareItems keeps the old object for each unchanged
  // row so memoized rows skip re-rendering and only the growing tail does work.
  const prevItems = useRef<ThreadItem[]>([]);
  const items = useMemo(() => (prevItems.current = shareItems(prevItems.current, groupEvents(events, { done }))), [events, done]);

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
  // One shared 10s tick (useNow) instead of a private interval; the tick's first value lands on
  // activation, so `lastWake` keeps that initial double render from firing twice.
  const autoWake = sleeping && !!session && !sleptHere;
  const wakeTick = useNow(10_000, autoWake);
  const lastWake = useRef(0);
  useEffect(() => {
    if (!autoWake) return;
    setWakingSince((w) => w ?? Date.now());
    if (Date.now() - lastWake.current < 2000) return;
    lastWake.current = Date.now();
    api.wake(session).catch((e) => setNote(`Could not wake — ${e instanceof Error ? e.message : e}. Retrying…`));
  }, [autoWake, session, wakeTick]);
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
  // Long-press on a message: Copy / Quote (+ Revert when that message has a restore point).
  const [msgActions, setMsgActions] = useState<{ text: string; revert?: () => void } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const pullRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);
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
      haptic("success");
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
      haptic("warning");
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

  // The run's clock for the header (web Thread `stamps`): first stamped event → now while running,
  // → the last stamp once done. Tool spans end at call stamp + duration.
  const stamps = useMemo(() => {
    let first: number | undefined;
    let last: number | undefined;
    for (const e of events) {
      const at = "at" in e ? e.at : undefined;
      if (at === undefined) continue;
      if (first === undefined) first = at;
      const end = e.kind === "tool" && e.ms !== undefined ? at + e.ms : at;
      if (last === undefined || end > last) last = end;
    }
    return { first, last };
  }, [events]);
  const finished = !sleeping && done && items.length > 0;
  // Keyed by exit code + how many turns you sent, so a resume that finishes again refetches.
  const outcomeKey = `${merged?.exitCode}:${persisted.size}`;
  const outcome = useOutcome(session, outcomeKey, finished && merged?.exitCode !== undefined);
  const displayState: DisplayState = sleeping ? "sleeping" : (merged?.runState ?? "idle");
  const title = merged?.title || merged?.task?.split("\n")[0] || session;

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
      haptic("light");
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
      haptic("success");
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

  const hasTask = !!merged?.task;
  const turns = useMemo<Turn[]>(() => {
    const out: Turn[] = hasTask ? [{ key: "task", kind: "task", index: -1 }] : [];
    items.forEach((it, i) => {
      if (it.kind === "ask") out.push({ key: `ask-${i}`, kind: "question", index: i });
      else if (it.kind === "you") out.push({ key: `you-${i}`, kind: "you", index: i });
    });
    return out;
  }, [items, hasTask]);

  // One stable revert callback per revertable message, so memoized rows keep their props identical.
  const revertFns = useMemo(() => {
    const m = new Map<number, (text: string) => void>();
    if (!canRevertNow) return m;
    msgIndexOf.forEach((msg, i) => {
      if (revertable.has(msg)) m.set(i, (text) => setRevertAsk({ message: msg, text }));
    });
    return m;
  }, [msgIndexOf, revertable, canRevertNow]);

  const lastIndex = items.length - 1;
  const openActions = useCallback((text: string, revert?: () => void) => setMsgActions({ text, revert }), []);
  const renderItem = useCallback(
    ({ item, index }: { item: ThreadItem; index: number }) => (
      <ThreadRow
        item={item}
        session={session}
        animate={animate && index >= lastIndex - 1}
        live={running && index === lastIndex}
        onRevert={revertFns.get(index)}
        onActions={openActions}
      />
    ),
    [session, animate, lastIndex, running, revertFns, openActions],
  );
  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems.find((v) => v.index != null);
    if (first?.index != null) setTopIndex(first.index);
  }).current;

  if (gone) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }}>
        <View style={{ flex: 1, justifyContent: "center", padding: 28, gap: 12 }}>
          <Icon name="wind" size={32} color={palette.faint} />
          <T serif variant="h1">This machine no longer exists.</T>
          <T variant="body" tone="muted">
            It was destroyed or reaped — sandboxes are throwaway by design, and nothing outlives them.
          </T>
          <PressScale onPress={() => router.back()} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Icon name="arrow-left" size={16} color={palette.live} />
            <T variant="body" tone="live">Back</T>
          </PressScale>
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
        <ThreadHeader
          session={session}
          box={merged}
          lifecycle={fleetSnap?.lifecycle}
          title={title}
          state={displayState}
          startedAt={stamps.first}
          endedAt={stamps.last}
          extras={extras}
          onBack={() => router.back()}
          onInfo={() => setSheet("inspector")}
          onMore={() => setSheet("actions")}
        />

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
          <FlatList
            ref={listRef}
            style={{ flex: 1 }}
            data={items}
            renderItem={renderItem}
            // Index keys are stable here: the transcript only grows at the tail (a revert re-keys by
            // refetching, which remounts anyway), and a row's identity is its position in the log.
            keyExtractor={(_it, i) => String(i)}
            contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void pullRefresh()} tintColor={palette.mutedForeground} colors={[palette.mutedForeground]} />}
            initialNumToRender={20}
            maxToRenderPerBatch={12}
            windowSize={11}
            removeClippedSubviews={Platform.OS === "android"}
            onViewableItemsChanged={onViewable}
            viewabilityConfig={VIEWABILITY}
            onLayout={(e) => setViewportH(e.nativeEvent.layout.height)}
            onScroll={(e) => {
              const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
              const atEnd = contentOffset.y + layoutMeasurement.height > contentSize.height - 80;
              if (atEnd !== stickRef.current) setStick(atEnd);
            }}
            scrollEventThrottle={100}
            onContentSizeChange={() => {
              if (stickRef.current) listRef.current?.scrollToEnd({ animated: false });
            }}
            onScrollToIndexFailed={(info) => listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true })}
            ListHeaderComponent={
              <>
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
            {merged?.task ? <ThreadRow item={{ kind: "you", text: merged.task }} onActions={openActions} /> : null}
              </>
            }
            ListFooterComponent={
              <>
            {/* Optimistic echoes — sent but not yet in the durable log */}
            {pendingEchoes.map((r, i) => (
              <FadeInUp key={`echo-${i}`}>
                <ThreadRow item={{ kind: "you", text: r }} onActions={openActions} />
              </FadeInUp>
            ))}
            {/* The run receipt — the archived outcome, attempts, then the server digest. The state
                word lives in the header pill; copy-transcript / run-again in the ⋯ sheet. */}
            {finished && merged?.exitCode !== undefined && (
              <>
                <AttemptGroupCard box={session} fetchKey={outcomeKey} />
                {outcome ? <OutcomeView outcome={outcome} /> : null}
                <DigestCard session={session} fetchKey={outcomeKey} />
              </>
            )}
            {running && (
              <FadeInUp>
                <View style={{ flexDirection: "row", gap: 10, alignItems: "center", paddingVertical: 12 }}>
                  <AgentLoader color={palette.live} size={16} />
                  <T variant="meta" tone="live" weight="medium" style={{ flex: 1 }}>
                    {stopping ? "stopping…" : "working"}
                    {connected ? "" : " · reconnecting…"}
                  </T>
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
              </>
            }
          />

          <TurnRail
            turns={turns}
            visible={!stick}
            topIndex={topIndex}
            viewportH={viewportH}
            onJump={(t) =>
              t.index < 0
                ? listRef.current?.scrollToOffset({ offset: 0, animated: true })
                : listRef.current?.scrollToIndex({ index: t.index, animated: true, viewOffset: 12 })
            }
          />

          {/* Scroll-to-bottom pill */}
          {!stick && (
            <PressScale
              onPress={() => listRef.current?.scrollToEnd({ animated: true })}
              hitSlop={10}
              accessibilityLabel="Scroll to latest"
              style={{
                position: "absolute",
                bottom: 12,
                alignSelf: "center",
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                backgroundColor: palette.popover,
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
            </PressScale>
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
            <PressScale
              key={c.key}
              haptic="selection"
              hitSlop={{ top: 6, bottom: 6 }}
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
            </PressScale>
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
                haptic("success");
                void refresh();
              }}
              onError={(m) => setNote(`Could not add memory — ${m}`)}
            />
          </FadeInUp>
        ) : null}

        {waiting && merged?.question ? (
          <FadeInUp style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
            <QuestionCard question={merged.question} onAnswer={answer} busy={answering} session={session} repo={merged.repos?.[0]?.name ?? null} />
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
            onStop={() => void stop()}
            accessoryLeft={
              models.length > 0 ? (
                <PressScale
                  onPress={() => setSheet("model")}
                  hitSlop={10}
                  accessibilityLabel="Choose model"
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
                </PressScale>
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

      {/* Message actions — long-press on a bubble or the agent's prose */}
      <Sheet visible={!!msgActions} onClose={() => setMsgActions(null)} title="Message">
        <View style={{ gap: 4, paddingBottom: 12 }}>
          {(
            [
              {
                key: "copy",
                icon: "copy" as IconName,
                label: "Copy",
                run: async () => {
                  await Clipboard.setStringAsync(msgActions?.text ?? "");
                  setNote("Copied.");
                },
              },
              {
                key: "quote",
                icon: "corner-down-right" as IconName,
                label: "Quote into composer",
                run: () => {
                  const quoted = (msgActions?.text ?? "").split("\n").map((l) => `> ${l}`).join("\n");
                  setPrefill({ text: `${quoted}\n\n`, nonce: Date.now() });
                },
              },
              ...(msgActions?.revert
                ? [
                    {
                      key: "revert",
                      icon: "rotate-ccw" as IconName,
                      label: "Revert to before this message",
                      // The confirm is another Sheet; let this one finish leaving before it opens.
                      run: ((revert: () => void) => () => void setTimeout(revert, 260))(msgActions.revert),
                    },
                  ]
                : []),
            ] as { key: string; icon: IconName; label: string; run: () => void | Promise<void> }[]
          ).map((a) => (
            <PressScale
              key={a.key}
              haptic="light"
              onPress={() => {
                setMsgActions(null);
                void a.run();
              }}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                paddingVertical: 12,
                paddingHorizontal: 12,
                borderRadius: radius.lg,
                backgroundColor: pressed ? palette.accent : "transparent",
              })}
            >
              <Icon name={a.icon} size={15} color={palette.mutedForeground} />
              <T variant="body">{a.label}</T>
            </PressScale>
          ))}
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
      <RunInspectorSheet
        visible={sheet === "inspector"}
        onClose={() => setSheet(null)}
        session={session}
        box={merged}
        lifecycle={fleetSnap?.lifecycle}
        events={events}
        running={running}
        startedAt={stamps.first}
        endedAt={stamps.last}
        outcome={outcome}
        queued={merged?.queued ?? []}
      />
      <Sheet visible={sheet === "model"} onClose={() => setSheet(null)} title="Model">
        <View style={{ gap: 4, paddingBottom: 12 }}>
          <T variant="meta" tone="muted" style={{ marginBottom: 6 }}>
            Applies to your next message on this machine.
          </T>
          {models.map((m) => {
            const active = m.id === (pickedModel ?? currentModel);
            return (
              <PressScale
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
              </PressScale>
            );
          })}
        </View>
      </Sheet>
    </SafeAreaView>
    </CodeRefSession.Provider>
  );
}
