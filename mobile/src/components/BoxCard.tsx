import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import type { BoxView } from "@/lib/api";
import { questionHeadline } from "@/lib/question";
import { ago, friendlyName } from "@/lib/format";
import { useTheme } from "@/theme/ThemeContext";
import { T } from "./ui/AppText";
import { Card } from "./ui/Card";
import { Icon } from "./ui/Icon";
import { Pressably } from "./ui/Motion";
import { StatePill } from "./ui/StatePill";
import { UsageMeter } from "./ui/UsageMeter";

export function boxLabel(b: BoxView): string {
  return b.title || b.task?.split("\n")[0] || b.name;
}

/** One machine, triage-ready: title, state (icon+word+color), and what it needs. */
export function BoxCard({ box, onLongPress }: { box: BoxView; onLongPress?: (b: BoxView) => void }) {
  const router = useRouter();
  const { palette } = useTheme();
  const waiting = box.runState === "waiting";
  const q = waiting ? questionHeadline(box.question) : "";
  const ink = waiting ? palette.attentionInk : palette.faint;

  return (
    <Pressably
      onPress={() => router.push(`/box/${encodeURIComponent(box.name)}`)}
      onLongPress={onLongPress ? () => onLongPress(box) : undefined}
    >
      <Card attention={waiting}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <T
            variant="body"
            weight="semibold"
            numberOfLines={1}
            style={{ flex: 1, color: waiting ? palette.attentionInk : palette.foreground }}
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
        <View style={{ flexDirection: "row", gap: 12, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Icon name="box" size={11} color={ink} />
            <T variant="micro" mono style={{ color: ink }}>
              {friendlyName(box.name)}
            </T>
          </View>
          {box.repos?.map((r) => (
            <View key={r.name} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Icon name="git-branch" size={11} color={ink} />
              <T variant="micro" mono style={{ color: ink }}>
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
    </Pressably>
  );
}
