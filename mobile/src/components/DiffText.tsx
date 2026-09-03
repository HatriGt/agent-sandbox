import React from "react";
import { ScrollView, View } from "react-native";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "./ui/AppText";

/** Unified diff, read-only, horizontally scrollable. Green/red are the functional hues. */
export function DiffText({ diff }: { diff: string }) {
  const { palette } = useTheme();
  const lines = diff.split("\n");
  return (
    <View style={{ backgroundColor: palette.trace, borderRadius: radius.lg, paddingVertical: 8 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ paddingHorizontal: 10 }}>
          {lines.map((l, i) => {
            const color = l.startsWith("+") && !l.startsWith("+++")
              ? palette.ok
              : l.startsWith("-") && !l.startsWith("---")
                ? palette.destructive
                : l.startsWith("@@")
                  ? palette.live
                  : palette.traceFg;
            return (
              <T key={i} variant="code" mono selectable style={{ color }}>
                {l || " "}
              </T>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}
