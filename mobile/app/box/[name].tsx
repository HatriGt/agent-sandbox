import React, { useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useWatch } from "@/hooks/useWatch";
import { api, type BoxView } from "@/lib/api";
import { parseTrace } from "@/lib/trace";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { Composer } from "@/components/Composer";
import { QuestionCard } from "@/components/QuestionCard";
import { TraceRow } from "@/components/TranscriptView";
import { BoxActionsSheet } from "@/components/sheets/BoxActionsSheet";
import { ChangesSheet } from "@/components/sheets/ChangesSheet";
import { CheckpointsSheet } from "@/components/sheets/CheckpointsSheet";
import { PrSheet } from "@/components/sheets/PrSheet";
import { T } from "@/components/ui/AppText";
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

  const [sheet, setSheet] = useState<null | "changes" | "checkpoints" | "pr" | "actions">(null);
  const [asks, setAsks] = useState<AskEntry[]>([]);
  const [answering, setAnswering] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [stick, setStick] = useState(true);
  const scrollRef = useRef<ScrollView>(null);
  const wokeRef = useRef(false);

  const events = useMemo(() => parseTrace(log), [log]);
  const running = meta?.runState === "running";
  const waiting = meta?.runState === "waiting" && !!meta.question;
  const sleeping = meta?.boxStatus === "Stopped";
  const booting = !gone && !meta && log.length === 0;

  // Opening a sleeping box wakes it, same as the web thread.
  useEffect(() => {
    if (sleeping && !wokeRef.current && session) {
      wokeRef.current = true;
      api.wake(session).catch(() => {});
    }
  }, [sleeping, session]);

  // Last PR the agent mentioned in the log → PR dock chip.
  const pr = useMemo(() => {
    let last: { repo: string; number: number } | null = null;
    for (const m of log.matchAll(PR_RE)) last = { repo: m[1], number: Number(m[2]) };
    return last;
  }, [log]);

  const steer = async (text: string) => {
    setNote(null);
    try {
      const r = await api.resume(session, text);
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

  const boxForActions: BoxView | null = meta
    ? ({ ...meta, role: "session" } as BoxView)
    : null;

  if (gone) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }}>
        <View style={{ flex: 1, justifyContent: "center", padding: 28, gap: 12 }}>
          <T serif variant="h1">This machine no longer exists.</T>
          <T variant="body" tone="muted">
            It was destroyed or reaped — sandboxes are throwaway by design, and nothing outlives them.
          </T>
          <Pressable onPress={() => router.back()}>
            <T variant="body" tone="live">‹ Back</T>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

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
            paddingHorizontal: 12,
            borderBottomWidth: 1,
            borderBottomColor: palette.border,
          }}
        >
          <Pressable onPress={() => router.back()} hitSlop={12} style={{ padding: 4 }}>
            <T variant="h3" tone="muted">‹</T>
          </Pressable>
          <View style={{ flex: 1 }}>
            <T variant="body" weight="semibold" numberOfLines={1}>
              {meta?.title || meta?.task?.split("\n")[0] || session}
            </T>
            <T variant="micro" mono tone="faint" numberOfLines={1}>
              {session}
              {meta?.repos?.length ? ` · ${meta.repos.map((r) => r.name).join(", ")}` : ""}
            </T>
          </View>
          {meta ? <StatePill runState={meta.runState} boxStatus={meta.boxStatus} exitCode={meta.exitCode} /> : null}
          <Pressable onPress={() => setSheet("actions")} hitSlop={12} style={{ padding: 4 }}>
            <T variant="h3" tone="muted">⋯</T>
          </Pressable>
        </View>

        {/* Transcript */}
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
          {sleeping && (
            <View
              style={{ borderWidth: 1, borderColor: palette.sleep, borderRadius: radius.xl, padding: 12, marginBottom: 12 }}
            >
              <T variant="meta" tone="sleep" weight="medium">
                ☾ This machine was asleep — waking it now. The session and files survived.
              </T>
            </View>
          )}
          {events.map((e, i) => (
            <TraceRow key={i} event={e} streaming={running && i === events.length - 1 && e.kind === "say"} />
          ))}
          {running && events[events.length - 1]?.kind !== "say" && (
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center", paddingVertical: 10 }}>
              <WorkingDot color={palette.live} />
              <T variant="meta" tone="live">working{connected ? "" : " · reconnecting…"}</T>
            </View>
          )}
          {asks.length > 0 && (
            <View style={{ gap: 8, marginTop: 12 }}>
              {asks.map((a, i) => (
                <View
                  key={i}
                  style={{ borderWidth: 1.5, borderStyle: "dashed", borderColor: palette.lineStrong, borderRadius: radius.xl, padding: 12, gap: 6 }}
                >
                  <T variant="micro" tone="faint" weight="medium">
                    ASK · read-only co-pilot
                  </T>
                  <T variant="body" weight="medium">{a.q}</T>
                  {a.pending ? (
                    <T variant="meta" tone="muted">thinking…</T>
                  ) : (
                    <T variant="body" tone="muted" selectable>{a.a}</T>
                  )}
                </View>
              ))}
            </View>
          )}
        </ScrollView>

        {/* Dock chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0 }}
          contentContainerStyle={{ gap: 6, paddingHorizontal: 16, paddingVertical: 6 }}
        >
          {(
            [
              ["changes", "Changes"],
              ...(pr ? ([["pr", `PR #${pr.number}`]] as const) : []),
              ["checkpoints", "Checkpoints"],
            ] as const
          ).map(([key, label]) => (
            <Pressable
              key={key}
              onPress={() => setSheet(key)}
              style={{
                paddingVertical: 6,
                paddingHorizontal: 12,
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: palette.border,
                backgroundColor: palette.card,
              }}
            >
              <T variant="meta" weight="medium">{label}</T>
            </Pressable>
          ))}
          {meta?.queued?.length ? (
            <View style={{ paddingVertical: 6, paddingHorizontal: 12 }}>
              <T variant="meta" tone="faint">{meta.queued.length} queued</T>
            </View>
          ) : null}
        </ScrollView>

        {note ? (
          <T variant="micro" tone="muted" style={{ paddingHorizontal: 16, paddingBottom: 4 }}>
            {note}
          </T>
        ) : null}

        {/* Question card pinned above the composer */}
        {waiting && meta?.question ? (
          <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
            <QuestionCard question={meta.question} onAnswer={answer} busy={answering} />
          </View>
        ) : null}

        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
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
    </SafeAreaView>
  );
}
