import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Pressable, ScrollView, View } from "react-native";
import { shortDuration, shortPath, type DerivedTask, type TaskBoard, type TaskEvidence } from "@/lib/planTasks";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "./ui/AppText";
import { Icon } from "./ui/Icon";
import { Sheet } from "./ui/Sheet";

/**
 * The agent's plan joined to the work it actually did — mobile presentation of
 * the web's PlanBoard. Two faces of one board:
 *  - `PlanChip`: a dock pill carrying the fraction and a determinate progress
 *    ring, always visible while a plan exists (the phone's answer to the web's
 *    docked aside — the plan must never scroll away).
 *  - `PlanSheet`: the full evidence board in a bottom sheet — step marks that
 *    stamp in, per-step files/commands, and what the active step is doing
 *    right now.
 */

function evidenceSummary(e: TaskEvidence): string {
  const parts: string[] = [];
  if (e.files.length) parts.push(`${e.files.length} file${e.files.length > 1 ? "s" : ""}`);
  else if (e.commands.length) parts.push(`${e.commands.length} command${e.commands.length > 1 ? "s" : ""}`);
  else if (e.steps) parts.push(`${e.steps} step${e.steps > 1 ? "s" : ""}`);
  if (e.ms !== undefined) parts.push(shortDuration(e.ms));
  return parts.join(" · ");
}

/** A completed step STAMPS in — spring scale, the one loud moment. */
function StepMark({ state, live, failed }: { state: DerivedTask["state"]; live?: boolean; failed?: boolean }) {
  const { palette } = useTheme();
  const scale = useRef(new Animated.Value(state === "done" ? 0.5 : 1)).current;
  const halo = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (state === "done") {
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 24, bounciness: 12 }).start();
    }
  }, [state, scale]);
  useEffect(() => {
    if (state !== "active" || !live) return;
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancelled || reduced) return;
      loop = Animated.loop(
        Animated.timing(halo, { toValue: 1, duration: 2400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      );
      loop.start();
    });
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [state, live, halo]);

  if (state === "done") {
    const c = failed ? palette.destructive : palette.ok;
    return (
      <Animated.View
        style={{
          width: 20,
          height: 20,
          borderRadius: 6,
          backgroundColor: `${c}26`,
          alignItems: "center",
          justifyContent: "center",
          transform: [{ scale }],
        }}
      >
        <Icon name="check" size={11} color={c} />
      </Animated.View>
    );
  }
  if (state === "active") {
    return (
      <View style={{ width: 20, height: 20, alignItems: "center", justifyContent: "center" }}>
        {live && (
          <Animated.View
            style={{
              position: "absolute",
              width: 20,
              height: 20,
              borderRadius: 6,
              backgroundColor: `${palette.live}33`,
              opacity: halo.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.6, 0, 0.6] }),
              transform: [{ scale: halo.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.5, 1] }) }],
            }}
          />
        )}
        <View
          style={{
            width: 20,
            height: 20,
            borderRadius: 6,
            backgroundColor: `${palette.live}1a`,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="disc" size={11} color={palette.live} />
        </View>
      </View>
    );
  }
  return (
    <View
      style={{
        width: 20,
        height: 20,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: palette.border,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon name="circle" size={7} color={palette.faint} />
    </View>
  );
}

/** Determinate 2px progress rail, animating width as steps complete. */
function ProgressRail({ done, total, complete, failed }: { done: number; total: number; complete: boolean; failed?: boolean }) {
  const { palette } = useTheme();
  const w = useRef(new Animated.Value(total ? done / total : 0)).current;
  useEffect(() => {
    Animated.timing(w, { toValue: total ? done / total : 0, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [done, total, w]);
  return (
    <View style={{ height: 2, backgroundColor: palette.border, overflow: "hidden" }}>
      <Animated.View
        style={{
          height: 2,
          width: w.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }),
          backgroundColor: complete ? (failed ? palette.destructive : palette.ok) : palette.live,
        }}
      />
    </View>
  );
}

function TaskRow({ task, live, last }: { task: DerivedTask; live?: boolean; last: boolean }) {
  const { palette } = useTheme();
  const [open, setOpen] = useState(false);
  const e = task.evidence;
  const hasDetail = e.files.length > 0 || e.commands.length > 0 || e.steps > 0;
  const active = task.state === "active";
  const summary = evidenceSummary(e);

  return (
    <View
      style={{
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: active && live ? `${palette.live}66` : open ? palette.lineStrong : "transparent",
        backgroundColor: active && live ? `${palette.live}10` : palette.card,
        marginBottom: last ? 0 : 6,
        opacity: task.state === "done" && !open ? 0.85 : 1,
        overflow: "hidden",
      }}
    >
      <Pressable
        disabled={!hasDetail}
        onPress={() => setOpen((o) => !o)}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "flex-start",
          gap: 10,
          paddingHorizontal: 12,
          paddingVertical: 10,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <StepMark state={task.state} live={live} failed={e.failed} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <T
            variant="body"
            weight={active ? "medium" : "regular"}
            tone={task.state === "done" ? "muted" : "default"}
            style={task.state === "done" ? { textDecorationLine: "line-through" } : undefined}
          >
            {task.text}
          </T>
          {/* What this step is doing RIGHT NOW — the one thing a watcher wants mid-run. */}
          {active && live && e.latest ? (
            <T variant="micro" tone="live" numberOfLines={1}>
              {e.latest.name}
              {e.latest.arg ? `  ${shortPath(e.latest.arg.split("\n")[0])}` : ""}
            </T>
          ) : null}
          {summary && !open ? (
            <T variant="micro" mono tone="faint">
              {summary}
            </T>
          ) : null}
        </View>
        {e.failed && task.state !== "done" ? <Icon name="alert-triangle" size={13} color={palette.destructive} style={{ marginTop: 3 }} /> : null}
        {hasDetail ? (
          <Icon name={open ? "chevron-down" : "chevron-right"} size={14} color={palette.faint} style={{ marginTop: 3 }} />
        ) : null}
      </Pressable>
      {open && hasDetail ? (
        <View style={{ paddingLeft: 42, paddingRight: 12, paddingBottom: 10, gap: 6 }}>
          {summary ? (
            <T variant="micro" mono tone="faint">
              {summary}
            </T>
          ) : null}
          {e.files.length > 0 && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
              {e.files.map((f) => (
                <View
                  key={f}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 4,
                    backgroundColor: palette.muted,
                    borderRadius: radius.md,
                    paddingHorizontal: 6,
                    paddingVertical: 3,
                    maxWidth: "100%",
                  }}
                >
                  <Icon name="file" size={10} color={palette.mutedForeground} />
                  <T variant="micro" mono tone="muted" numberOfLines={1}>
                    {shortPath(f)}
                  </T>
                </View>
              ))}
            </View>
          )}
          {e.commands.map((c) => (
            <View key={c} style={{ flexDirection: "row", gap: 6 }}>
              <T variant="micro" mono style={{ color: palette.ok }}>
                $
              </T>
              <T variant="micro" mono tone="muted" style={{ flex: 1 }}>
                {c}
              </T>
            </View>
          ))}
          {(e.others.length > 0 || e.failed) && (
            <T variant="micro" tone="faint">
              {e.others.map((o) => `${o.name}${o.n > 1 ? ` ×${o.n}` : ""}`).join(" · ")}
              {e.failed ? (e.others.length ? " · " : "") : ""}
              {e.failed ? <T variant="micro" tone="destructive">a call failed</T> : null}
            </T>
          )}
        </View>
      ) : null}
    </View>
  );
}

function headline(complete: boolean, live: boolean | undefined, failed: boolean): string {
  if (complete) return failed ? "Complete, not clean" : "Plan complete";
  return live ? "Working the plan" : "Plan";
}

/** Dock pill: fraction + one pip per step — the collapsed dock rail, sideways. */
export function PlanChip({ board, live, onPress }: { board: TaskBoard; live?: boolean; onPress: () => void }) {
  const { palette } = useTheme();
  const { tasks, done, complete } = board;
  const failed = tasks.some((t) => t.evidence.failed);
  const color = complete ? (failed ? palette.destructive : palette.ok) : palette.live;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingVertical: 7,
        paddingHorizontal: 12,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: complete ? palette.border : `${palette.live}55`,
        backgroundColor: palette.card,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Icon name={complete ? "check-circle" : "check-square"} size={13} color={color} />
      <T variant="meta" weight="medium">
        Plan
      </T>
      <T variant="micro" mono tone="faint">
        {done}/{tasks.length}
      </T>
      <View style={{ flexDirection: "row", gap: 2.5, alignItems: "center" }}>
        {tasks.map((t, i) => (
          <View
            key={`${i}-${t.text}`}
            style={{
              width: 4,
              height: 10,
              borderRadius: 2,
              backgroundColor:
                t.state === "done"
                  ? t.evidence.failed
                    ? palette.destructive
                    : palette.ok
                  : t.state === "active"
                    ? palette.live
                    : palette.border,
            }}
          />
        ))}
      </View>
    </Pressable>
  );
}

/** The full evidence board, in a bottom sheet. */
export function PlanSheet({
  board,
  live,
  visible,
  onClose,
}: {
  board: TaskBoard | null;
  live?: boolean;
  visible: boolean;
  onClose: () => void;
}) {
  const { palette } = useTheme();
  if (!board) return null;
  const { tasks, done, complete } = board;
  const failedSteps = tasks.filter((t) => t.evidence.failed).length;
  return (
    <Sheet visible={visible} onClose={onClose} title={headline(complete, live, failedSteps > 0)} scroll={false}>
      <View style={{ gap: 0, paddingBottom: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 8 }}>
          <T variant="micro" mono tone="muted">
            {done}/{tasks.length} steps
          </T>
          {board.ms !== undefined ? (
            <T variant="micro" mono tone="faint">
              · {shortDuration(board.ms)} total
            </T>
          ) : null}
          {failedSteps > 0 ? (
            <T variant="micro" tone="destructive">
              · {failedSteps} step{failedSteps === 1 ? "" : "s"} hit a failed call
            </T>
          ) : null}
        </View>
        <View style={{ borderRadius: 2, overflow: "hidden", marginBottom: 10 }}>
          <ProgressRail done={done} total={tasks.length} complete={complete} failed={failedSteps > 0} />
        </View>
        <ScrollView style={{ maxHeight: 440 }} contentContainerStyle={{ backgroundColor: `${palette.muted}66`, borderRadius: radius.xl, padding: 8 }}>
          {tasks.map((t, i) => (
            <TaskRow key={`${i}-${t.text}`} task={t} live={live} last={i === tasks.length - 1} />
          ))}
        </ScrollView>
      </View>
    </Sheet>
  );
}
