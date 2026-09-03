import React, { useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { useWatch } from "@/hooks/useWatch";
import { api, type BoxView } from "@/lib/api";
import { parseTrace } from "@/lib/trace";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { Composer } from "@/components/Composer";
import { QuestionCard } from "@/components/QuestionCard";
import { groupEvents, ThreadRow } from "@/components/TranscriptView";
import { BoxActionsSheet } from "@/components/sheets/BoxActionsSheet";
import { ChangesSheet } from "@/components/sheets/ChangesSheet";
import { CheckpointsSheet } from "@/components/sheets/CheckpointsSheet";
import { PrSheet } from "@/components/sheets/PrSheet";
import { T } from "@/components/ui/AppText";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Sheet } from "@/components/ui/Sheet";
import { FadeInUp, TypingDots } from "@/components/ui/Motion";
import { StatePill } from "@/components/ui/StatePill";
import { WorkingDot } from "@/components/ui/WorkingDot";

type AskEntry = { q: string; a?: string; pending: boolean };

const PR_RE = /github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/g;

/** The Thread — the screen you live in. */
export default function Thread() {
  const router = useRouter();
  const { palette } = useTheme();
  const { name } = useLocalSearchParams<{ name: string }>();
  const session = typeof name === "string" ? name : "";
  const { meta, log, connected, gone, refresh } = useWatch(session || undefined);

  const [sheet, setSheet] = useState<null | "changes" | "checkpoints" | "pr" | "actions" | "model">(null);
  const [models, setModels] = useState<{ id: string; label: string; tier: string }[]>([]);
  const [currentModel, setCurrentModel] = useState<string | null>(null);
  const [pickedModel, setPickedModel] = useState<string | null>(null);
  const keyboardInset = useKeyboardInset();
  const [asks, setAsks] = useState<AskEntry[]>([]);
  const [answering, setAnswering] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [stick, setStick] = useState(true);
  const scrollRef = useRef<ScrollView>(null);
  const wokeRef = useRef(false);
  const buzzedRef = useRef(false);
  const mountedAt = useRef(Date.now());

  const events = useMemo(() => parseTrace(log), [log]);
  const items = useMemo(() => groupEvents(events), [events]);
  const running = meta?.runState === "running";
  const waiting = meta?.runState === "waiting" && !!meta.question;
  const sleeping = meta?.boxStatus === "Stopped";
  const booting = !gone && !meta && log.length === 0;
  // Animate entrances only for items that appear after mount, not the history dump.
  const animate = Date.now() - mountedAt.current > 1500;

  useEffect(() => {
    if (sleeping && !wokeRef.current && session) {
      wokeRef.current = true;
      api.wake(session).catch(() => {});
    }
  }, [sleeping, session]);

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

  // Haptic nudge the moment the agent stops on a question while you're watching.
  useEffect(() => {
    if (waiting && !buzzedRef.current) {
      buzzedRef.current = true;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    }
    if (!waiting) buzzedRef.current = false;
  }, [waiting]);

  const pr = useMemo(() => {
    let last: { repo: string; number: number } | null = null;
    for (const m of log.matchAll(PR_RE)) last = { repo: m[1], number: Number(m[2]) };
    return last;
  }, [log]);

  const steer = async (text: string) => {
    setNote(null);
    try {
      const r = await api.resume(session, text, pickedModel ? { model: pickedModel } : {});
      if ("queued" in r && r.queued) setNote("Queued — delivered when this turn ends.");
      await refresh();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
      throw e;
    }
  };

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

  const boxForActions: BoxView | null = meta ? ({ ...meta, role: "session" } as BoxView) : null;

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

  const chips: { key: "changes" | "pr" | "checkpoints"; label: string; icon: IconName }[] = [
    { key: "changes", label: "Changes", icon: "file-plus" },
    ...(pr ? ([{ key: "pr" as const, label: `PR #${pr.number}`, icon: "git-pull-request" as IconName }]) : []),
    { key: "checkpoints", label: "Checkpoints", icon: "rotate-ccw" },
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }} edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        {/* Header — one row, 56px, like the web thread */}
        <View
          style={{
            height: 56,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            paddingHorizontal: 8,
            borderBottomWidth: 1,
            borderBottomColor: palette.border,
          }}
        >
          <Pressable onPress={() => router.back()} hitSlop={12} style={{ padding: 8 }}>
            <Icon name="chevron-left" size={22} color={palette.mutedForeground} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <T variant="body" weight="semibold" numberOfLines={1}>
              {meta?.title || meta?.task?.split("\n")[0] || session}
            </T>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <T variant="micro" mono tone="faint" numberOfLines={1}>
                {session}
              </T>
              {meta?.repos?.map((r) => (
                <View key={r.name} style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                  <Icon name="git-branch" size={10} color={palette.faint} />
                  <T variant="micro" mono tone="faint" numberOfLines={1}>
                    {r.name.split("/").pop()}
                  </T>
                </View>
              ))}
            </View>
          </View>
          {meta ? <StatePill runState={meta.runState} boxStatus={meta.boxStatus} exitCode={meta.exitCode} /> : null}
          <Pressable onPress={() => setSheet("actions")} hitSlop={12} style={{ padding: 8 }}>
            <Icon name="more-horizontal" size={20} color={palette.mutedForeground} />
          </Pressable>
        </View>

        {/* Transcript */}
        <View style={{ flex: 1 }}>
          <ScrollView
            ref={scrollRef}
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
            onScroll={(e) => {
              const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
              setStick(contentOffset.y + layoutMeasurement.height > contentSize.height - 80);
            }}
            scrollEventThrottle={100}
            onContentSizeChange={() => {
              if (stick) scrollRef.current?.scrollToEnd({ animated: false });
            }}
          >
            {booting && (
              <View style={{ alignItems: "center", paddingVertical: 60, gap: 12 }}>
                <WorkingDot color={palette.live} size={12} />
                <T variant="body" tone="muted">Booting a fresh machine…</T>
              </View>
            )}
            {!booting && meta?.runState === "idle" && items.length === 0 && (
              <View style={{ alignItems: "center", paddingVertical: 60, gap: 12, paddingHorizontal: 20 }}>
                <Icon name="box" size={28} color={palette.faint} />
                <T variant="body" tone="muted" style={{ textAlign: "center" }}>
                  {session.startsWith("pool-")
                    ? "A warm, empty machine from the pool — pre-booted, waiting to be claimed. Send a task below and it starts here instantly."
                    : "Nothing has happened on this machine yet. Send a message below to start."}
                </T>
              </View>
            )}
            {sleeping && (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  borderWidth: 1,
                  borderColor: palette.sleep,
                  borderRadius: radius.xl,
                  padding: 12,
                  marginBottom: 12,
                }}
              >
                <Icon name="moon" size={14} color={palette.sleep} />
                <T variant="meta" tone="sleep" weight="medium" style={{ flex: 1 }}>
                  This machine was asleep — waking it now. The session and files survived.
                </T>
              </View>
            )}
            {items.map((it, i) => (
              <ThreadRow key={i} item={it} animate={animate && i >= items.length - 2} />
            ))}
            {running && (
              <FadeInUp>
                <View style={{ flexDirection: "row", gap: 10, alignItems: "center", paddingVertical: 12 }}>
                  <TypingDots color={palette.live} />
                  <T variant="meta" tone="live" weight="medium">
                    working{connected ? "" : " · reconnecting…"}
                  </T>
                </View>
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
          </ScrollView>

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
          {chips.map((c) => (
            <Pressable
              key={c.key}
              onPress={() => setSheet(c.key)}
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
              <T variant="meta" weight="medium">{c.label}</T>
            </Pressable>
          ))}
          {models.length > 0 && (
            <Pressable
              onPress={() => setSheet("model")}
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
              <Icon name="cpu" size={13} color={pickedModel ? palette.live : palette.mutedForeground} />
              <T variant="meta" weight="medium" tone={pickedModel ? "live" : "default"}>
                {models.find((m) => m.id === (pickedModel ?? currentModel))?.label ?? "Model"}
              </T>
            </Pressable>
          )}
          {meta?.queued?.length ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 7, paddingHorizontal: 10 }}>
              <Icon name="inbox" size={13} color={palette.faint} />
              <T variant="meta" tone="faint">{meta.queued.length} queued</T>
            </View>
          ) : null}
        </ScrollView>

        {note ? (
          <T variant="micro" tone="muted" style={{ paddingHorizontal: 16, paddingBottom: 4 }}>
            {note}
          </T>
        ) : null}

        {waiting && meta?.question ? (
          <FadeInUp style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
            <QuestionCard question={meta.question} onAnswer={answer} busy={answering} />
          </FadeInUp>
        ) : null}

        <View style={{ paddingHorizontal: 16, paddingBottom: 8 + keyboardInset }}>
          <Composer onSend={steer} onAsk={ask} running={running} disabled={booting} />
        </View>
      </KeyboardAvoidingView>

      <ChangesSheet session={session} repos={meta?.repos ?? []} visible={sheet === "changes"} onClose={() => setSheet(null)} />
      <CheckpointsSheet session={session} visible={sheet === "checkpoints"} onClose={() => setSheet(null)} onReverted={refresh} />
      {pr ? (
        <PrSheet session={session} repo={pr.repo} number={pr.number} visible={sheet === "pr"} onClose={() => setSheet(null)} />
      ) : null}
      <BoxActionsSheet
        box={boxForActions}
        visible={sheet === "actions"}
        onClose={() => setSheet(null)}
        onChanged={refresh}
        onDestroyed={() => router.back()}
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
                <View style={{ flex: 1 }}>
                  <T variant="body" weight={active ? "semibold" : "regular"}>
                    {m.label}
                  </T>
                  <T variant="micro" mono tone="faint">
                    {m.id}
                    {m.id === currentModel ? " · current" : ""}
                  </T>
                </View>
                {active && <Icon name="check" size={16} color={palette.ok} />}
              </Pressable>
            );
          })}
        </View>
      </Sheet>
    </SafeAreaView>
  );
}
