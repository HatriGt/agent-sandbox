import React, { memo, useMemo, useState } from "react";
import { Alert, View, type StyleProp, type ViewStyle } from "react-native";
import { useRouter } from "expo-router";
import { api, type BoxView } from "@/lib/api";
import { keepAction, sleepAction, type BoxAction } from "@/lib/box-actions";
import { parseQuestion, questionChoices, questionHeadline } from "@/lib/question";
import { ago, friendlyName, isSleeping } from "@/lib/format";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "./ui/AppText";
import { Card } from "./ui/Card";
import { Icon } from "./ui/Icon";
import { StatePill } from "./ui/StatePill";
import { UsageMeter } from "./ui/UsageMeter";
import { SwipeRow, type SwipeAction } from "./ui/SwipeRow";
import { haptic, PressScale } from "@/components/motion";

export function boxLabel(b: BoxView): string {
  return b.title || b.task?.split("\n")[0] || b.name;
}

/**
 * One-tap answers on the inbox card (docs/plan-demo-parity.md bet 1): the same ≤ 3 choices the
 * notification offers. The label is the chip; the whole option is sent. Free text lives in the Thread.
 * `amber` inverts the ink for the attention card; Home's compact rows use the plain variant.
 */
export function InboxChoices({ box, question, amber = true, style }: { box: string; question: string; amber?: boolean; style?: StyleProp<ViewStyle> }) {
  const { palette } = useTheme();
  const choices = useMemo(() => questionChoices(parseQuestion(question)), [question]);
  const [sent, setSent] = useState<number | null>(null);
  const ink = amber ? palette.attentionInk : palette.foreground;
  const onInk = amber ? palette.attention : palette.background;
  if (choices.length === 0) return null;
  const answer = async (i: number) => {
    if (sent != null) return;
    setSent(i);
    haptic("light");
    try {
      await api.resume(box, choices[i].answer, { force: true });
      haptic("success");
    } catch (e) {
      setSent(null);
      Alert.alert("Could not send the answer", e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Quick answers" style={[{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }, style]}>
      {choices.map((c, i) => (
        <PressScale
          key={c.answer}
          disabled={sent != null}
          onPress={() => void answer(i)}
          hitSlop={{ top: 6, bottom: 6 }}
          accessibilityRole="button"
          accessibilityLabel={`Answer: ${c.answer}`}
        >
          <View
            style={{
              borderWidth: 1,
              borderColor: amber ? ink : sent === i ? ink : palette.lineStrong,
              borderRadius: radius.md,
              paddingHorizontal: 10,
              paddingVertical: 6,
              opacity: sent != null && sent !== i ? 0.45 : 1,
              backgroundColor: sent === i ? ink : "transparent",
            }}
          >
            <T variant="meta" weight="semibold" numberOfLines={1} style={{ color: sent === i ? onInk : ink }}>
              {c.label}
            </T>
          </View>
        </PressScale>
      ))}
    </View>
  );
}

/**
 * One machine, triage-ready: title, state (icon+word+color), and what it needs. Swipe left for the
 * two most-used controls (sleep/wake, keep/release); long-press opens the full sheet.
 */
export const BoxCard = memo(function BoxCard({
  box,
  onLongPress,
  onChanged,
}: {
  box: BoxView;
  onLongPress?: (b: BoxView) => void;
  /** Called after a swipe action commits, so the list can refresh before the next poll. */
  onChanged?: () => void;
}) {
  const router = useRouter();
  const { palette } = useTheme();
  const waiting = box.runState === "waiting";
  const running = box.runState === "running";
  const sleeping = isSleeping(box.boxStatus);
  const q = waiting ? questionHeadline(box.question) : "";
  const ink = waiting ? palette.attentionInk : palette.faint;

  const act = ({ label, run }: BoxAction) => {
    haptic("light");
    run()
      .then(() => {
        haptic("success");
        onChanged?.();
      })
      .catch((e: unknown) => Alert.alert(`Could not ${label.toLowerCase()}`, e instanceof Error ? e.message : String(e)));
  };
  // Same controls and copy as the ⋯ sheet; a disabled one (sleep while busy) simply isn't offered.
  const actions: SwipeAction[] = [keepAction(box), sleepAction(box)]
    .filter((a) => !a.disabled)
    .map((a) => ({ label: a.label, icon: a.icon, onPress: () => act(a) }));

  return (
    <SwipeRow actions={actions}>
    <PressScale
      onPress={() => router.push(`/box/${encodeURIComponent(box.name)}`)}
      onLongPress={onLongPress ? () => onLongPress(box) : undefined}
      accessibilityRole="button"
      accessibilityLabel={boxLabel(box)}
      accessibilityHint={onLongPress ? "Double tap to open. Double tap and hold for more actions." : "Double tap to open."}
    >
      <Card attention={waiting}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <T
            variant="body"
            weight="semibold"
            numberOfLines={1}
            style={{ flex: 1, minWidth: 0, color: waiting ? palette.attentionInk : palette.foreground }}
          >
            {boxLabel(box)}
          </T>
          {!waiting && <StatePill runState={box.runState} boxStatus={box.boxStatus} exitCode={box.exitCode} />}
        </View>
        {waiting && q ? (
          <View style={{ flexDirection: "row", gap: 6, marginTop: 6, alignItems: "flex-start" }}>
            <Icon name="help-circle" size={14} color={palette.attentionInk} style={{ marginTop: 2 }} />
            <T variant="meta" numberOfLines={2} style={{ flex: 1, color: palette.attentionInk }}>
              {q}
            </T>
          </View>
        ) : null}
        {waiting && box.question ? <InboxChoices box={box.name} question={box.question} /> : null}
        <View style={{ flexDirection: "row", gap: 12, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, maxWidth: "100%" }}>
            <Icon name="box" size={11} color={ink} />
            <T variant="micro" mono numberOfLines={1} style={{ color: ink, flexShrink: 1 }}>
              {friendlyName(box.name)}
            </T>
          </View>
          {/* A repo can be `some-long-name@feature/very-long-branch`; the row wraps, but one chip
              wider than the card still needs to ellipsise rather than run past the border. */}
          {box.repos?.map((r) => (
            <View key={r.name} style={{ flexDirection: "row", alignItems: "center", gap: 4, maxWidth: "100%" }}>
              <Icon name="git-branch" size={11} color={ink} />
              <T variant="micro" mono numberOfLines={1} style={{ color: ink, flexShrink: 1 }}>
                {r.name.split("/").pop()}
                {r.branch ? `@${r.branch}` : ""}
              </T>
            </View>
          ))}
          {box.lastOutputAt ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Icon name="clock" size={11} color={ink} />
              <T variant="micro" style={{ color: ink }}>
                {ago(box.lastOutputAt * 1000)}
              </T>
            </View>
          ) : null}
          {box.kept ? <Icon name="bookmark" size={11} color={ink} /> : null}
          {box.queued?.length ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Icon name="inbox" size={11} color={ink} />
              <T variant="micro" style={{ color: ink }}>
                {box.queued.length}
              </T>
            </View>
          ) : null}
        </View>
        {/* Vitals as meters, and only while awake: mergeWithMemory drops the numbers for a sleeping
            box, and a frozen meter would read as live. Skipped on an amber "needs you" card, whose
            ink is inverted and whose one job is the question. */}
        {!waiting && (box.memUsage || box.disk) ? (
          <View style={{ flexDirection: "row", gap: 12, marginTop: 6, alignItems: "center", flexWrap: "wrap" }}>
            <UsageMeter kind="memory" usage={box.memUsage} />
            <UsageMeter kind="disk" usage={box.disk} />
          </View>
        ) : null}
      </Card>
    </PressScale>
    </SwipeRow>
  );
},
// The fleet poll hands back fresh objects every 4s; compare by content so unchanged cards skip rendering.
(a, b) => a.onLongPress === b.onLongPress && a.onChanged === b.onChanged && JSON.stringify(a.box) === JSON.stringify(b.box));
