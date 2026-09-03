import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import type { BoxView } from "@/lib/api";
import { questionHeadline } from "@/lib/question";
import { ago } from "@/lib/format";
import { useTheme } from "@/theme/ThemeContext";
import { T } from "./ui/AppText";
import { Card } from "./ui/Card";
import { StatePill } from "./ui/StatePill";

export function boxLabel(b: BoxView): string {
  return b.title || b.task?.split("\n")[0] || b.name;
}

/** One machine, triage-ready: title, state (icon+word+color), and what it needs. */
export function BoxCard({ box, onLongPress }: { box: BoxView; onLongPress?: (b: BoxView) => void }) {
  const router = useRouter();
  const { palette } = useTheme();
  const waiting = box.runState === "waiting";
  const q = waiting ? questionHeadline(box.question) : "";
  return (
    <Card
      onPress={() => router.push(`/box/${encodeURIComponent(box.name)}`)}
      onLongPress={onLongPress ? () => onLongPress(box) : undefined}
      attention={waiting}
    >
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
        <T variant="meta" numberOfLines={2} style={{ marginTop: 6, color: palette.attentionInk }}>
          ◆ {q}
        </T>
      ) : null}
      <View style={{ flexDirection: "row", gap: 10, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
        <T variant="micro" mono style={{ color: waiting ? palette.attentionInk : palette.faint }}>
          {box.name}
        </T>
        {box.repos?.map((r) => (
          <T key={r.name} variant="micro" mono style={{ color: waiting ? palette.attentionInk : palette.faint }}>
            {r.name}
            {r.branch ? `@${r.branch}` : ""}
          </T>
        ))}
        {box.lastOutputAt ? (
          <T variant="micro" style={{ color: waiting ? palette.attentionInk : palette.faint }}>
            {ago(box.lastOutputAt * 1000)}
          </T>
        ) : null}
        {box.kept ? (
          <T variant="micro" style={{ color: waiting ? palette.attentionInk : palette.faint }}>
            pinned
          </T>
        ) : null}
        {box.queued?.length ? (
          <T variant="micro" style={{ color: waiting ? palette.attentionInk : palette.faint }}>
            {box.queued.length} queued
          </T>
        ) : null}
      </View>
    </Card>
  );
}
