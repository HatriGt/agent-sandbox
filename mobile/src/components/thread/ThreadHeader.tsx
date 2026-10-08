import React from "react";
import { View } from "react-native";
import { useNow } from "@/hooks/useNow";
import type { BoxView, FleetLifecycle, RunState } from "@/lib/api";
import { friendlyName, isSleeping } from "@/lib/format";
import { deadlineOf, deadlineShort, fmtClock } from "@/lib/lifecycle";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "../ui/AppText";
import { Icon, type IconName } from "../ui/Icon";
import { PressScale, WorkingDot } from "@/components/motion";

/**
 * The thread's masthead (web ThreadHeader): back · title + context line · state pill · ⓘ · ⋯.
 * The context line carries the elapsed clock (ticking while running, frozen once done) and the
 * deadline — "42m left of cap" / "sleeps in 4m" — from the fleet lifecycle facts.
 */

export type DisplayState = RunState | "sleeping";

/** Working · Needs you · Asleep · Done · Failed · Idle — the web RunPill/LiveStatePill words. */
function phaseWord(state: DisplayState, exitCode: number | null | undefined, stalled?: boolean): { word: string; tone: "live" | "attention" | "sleep" | "ok" | "destructive" | "muted" } {
  if (state === "running") return stalled ? { word: "Stalled", tone: "destructive" } : { word: "Working", tone: "live" };
  if (state === "waiting") return { word: "Needs you", tone: "attention" };
  if (state === "sleeping") return { word: "Asleep", tone: "sleep" };
  if (state === "done") {
    if (exitCode === 253 || exitCode === 254) return { word: "Stopped", tone: "muted" };
    return exitCode == null || exitCode === 0 ? { word: "Done", tone: "ok" } : { word: "Failed", tone: "destructive" };
  }
  return { word: "Idle", tone: "muted" };
}

function LiveStatePill({ state, exitCode, stalled }: { state: DisplayState; exitCode?: number | null; stalled?: boolean }) {
  const { palette } = useTheme();
  const { word, tone } = phaseWord(state, exitCode, stalled);
  const color =
    tone === "live" ? palette.live
    : tone === "attention" ? palette.attentionInk
    : tone === "sleep" ? palette.sleep
    : tone === "ok" ? palette.ok
    : tone === "destructive" ? palette.destructive
    : palette.mutedForeground;
  const bg = tone === "attention" ? palette.attention : tone === "muted" ? palette.secondary : `${color}1a`;
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={`State: ${word}`}
      style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 9, height: 22, borderRadius: radius.pill, backgroundColor: bg, flexShrink: 0 }}
    >
      {state === "running" && !stalled ? <WorkingDot color={color} size={6} /> : <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />}
      <T variant="micro" weight="medium" numberOfLines={1} style={{ color }}>
        {word}
      </T>
    </View>
  );
}

/** `mm:ss` from the first stamp → now while live, → the last stamp once done. */
function useElapsed(start: number | undefined, end: number | undefined, live: boolean): string | null {
  const now = useNow(1000, live && start !== undefined);
  if (start === undefined) return null;
  const stop = live ? now : end;
  if (stop === undefined) return null;
  return fmtClock(stop - start);
}

export function ThreadHeader({
  session,
  box,
  lifecycle,
  title,
  state,
  startedAt,
  endedAt,
  extras,
  onBack,
  onInfo,
  onMore,
}: {
  session: string;
  box: (Partial<BoxView> & Pick<BoxView, "runState" | "boxStatus">) | null;
  lifecycle: FleetLifecycle | undefined;
  title: string;
  state: DisplayState;
  startedAt?: number;
  endedAt?: number;
  /** Second-line chips: harness, workflow step, skills (capped by the caller). */
  extras: { key: string; label: string; icon: IconName; color?: string; dim?: boolean }[];
  onBack: () => void;
  onInfo: () => void;
  onMore: () => void;
}) {
  const { palette } = useTheme();
  const running = state === "running";
  const elapsed = useElapsed(startedAt, running ? undefined : endedAt, running);
  // The deadline shifts by the second only for idle-stop; a 30s cadence keeps the header quiet.
  const now = useNow(30_000, !!box && !!lifecycle && !isSleeping(box.boxStatus));
  const deadline =
    box && lifecycle
      ? deadlineShort(deadlineOf({ boxStatus: box.boxStatus, runState: box.runState, role: box.role ?? "session", uptime: box.uptime, lastOutputAt: box.lastOutputAt, kept: box.kept, asleepSec: box.asleepSec }, lifecycle, now))
      : null;
  const EXTRAS_MAX = 3;
  const shownExtras = extras.slice(0, EXTRAS_MAX);
  const extraOverflow = extras.length - shownExtras.length;
  const iconBtn = ({ pressed }: { pressed: boolean }) => ({ padding: 8, opacity: pressed ? 0.5 : 1 });

  return (
    <View
      style={{
        minHeight: 56,
        paddingVertical: 6,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 8,
        borderBottomWidth: 1,
        borderBottomColor: palette.border,
      }}
    >
      <PressScale onPress={onBack} hitSlop={12} scaleTo={0.9} accessibilityLabel="Back" style={iconBtn}>
        <Icon name="chevron-left" size={22} color={palette.mutedForeground} />
      </PressScale>
      {/* minWidth:0 lets this column shrink; without it a long title shoves the pill off the edge. */}
      <View style={{ flex: 1, minWidth: 0 }}>
        <T variant="body" weight="semibold" numberOfLines={1}>
          {title}
        </T>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <T variant="micro" mono tone="faint" numberOfLines={1} style={{ flexShrink: 1, minWidth: 0 }}>
            {friendlyName(session)}
          </T>
          {elapsed ? (
            <T variant="micro" mono tnum tone={running ? "live" : "faint"} style={{ flexShrink: 0 }} accessibilityLabel={`${running ? "Elapsed" : "Took"} ${elapsed}`}>
              {elapsed}
            </T>
          ) : null}
          {deadline ? (
            <T variant="micro" tone="faint" numberOfLines={1} style={{ flexShrink: 1, minWidth: 0 }}>
              · {deadline}
            </T>
          ) : null}
          {/* Two repo chips is all a 56px header can carry legibly; the rest are in the inspector. */}
          {box?.repos?.slice(0, 2).map((r) => (
            <View key={r.name} style={{ flexDirection: "row", alignItems: "center", gap: 3, flexShrink: 1, minWidth: 0 }}>
              <Icon name="git-branch" size={10} color={palette.faint} />
              <T variant="micro" mono tone="faint" numberOfLines={1} style={{ flexShrink: 1, minWidth: 0 }}>
                {r.name.split("/").pop()}
              </T>
            </View>
          ))}
          {box?.repos && box.repos.length > 2 ? (
            <T variant="micro" mono tone="faint" style={{ flexShrink: 0 }}>
              +{box.repos.length - 2}
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
      {box ? <LiveStatePill state={state} exitCode={box.exitCode} stalled={box.stalled} /> : null}
      <PressScale onPress={onInfo} hitSlop={8} scaleTo={0.9} accessibilityLabel="Run inspector" style={iconBtn}>
        <Icon name="info" size={18} color={palette.mutedForeground} />
      </PressScale>
      <PressScale onPress={onMore} hitSlop={8} scaleTo={0.9} accessibilityLabel="More actions" style={iconBtn}>
        <Icon name="more-horizontal" size={20} color={palette.mutedForeground} />
      </PressScale>
    </View>
  );
}
