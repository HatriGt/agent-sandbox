import React, { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "./ui/AppText";
import { PressScale } from "@/components/motion";

/**
 * Unified diff, read-only, horizontally scrollable. Green/red are the functional hues.
 * `maxLines` folds a long diff behind a "… n more lines" tap (the per-edit diff inside a tool row
 * must not turn the thread into a scroll of code); omit it to show everything.
 */
export function DiffText({ diff, maxLines }: { diff: string; maxLines?: number }) {
  const { palette } = useTheme();
  const [all, setAll] = useState(false);
  const lines = diff.replace(/\n$/, "").split("\n");
  const capped = maxLines !== undefined && !all && lines.length > maxLines;
  const shown = capped ? lines.slice(0, maxLines) : lines;
  return (
    <View style={{ backgroundColor: palette.trace, borderRadius: radius.lg, paddingVertical: 8 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ paddingHorizontal: 10 }}>
          {shown.map((l, i) => {
            const color = l.startsWith("+") && !l.startsWith("+++")
              ? palette.ok
              : l.startsWith("-") && !l.startsWith("---")
                ? palette.destructive
                : l.startsWith("@@")
                  ? palette.live
                  : l.startsWith("diff ") || l.startsWith("index ")
                    ? palette.faint
                    : palette.traceFg;
            return (
              <T key={i} variant="code" mono selectable style={{ color }}>
                {l || " "}
              </T>
            );
          })}
        </View>
      </ScrollView>
      {capped ? (
        <PressScale onPress={() => setAll(true)} hitSlop={6} style={{ paddingHorizontal: 10, paddingTop: 6 }}>
          <T variant="micro" mono style={{ color: palette.faint }}>
            … {lines.length - shown.length} more lines
          </T>
        </PressScale>
      ) : null}
    </View>
  );
}

export interface DiffSection {
  path: string;
  diff: string;
}

/**
 * Split one multi-file unified patch (`git diff` output) into per-file sections on
 * `diff --git a/… b/…` headers. Text before the first header (none in practice) is dropped; a patch
 * with no headers at all is returned as a single "(patch)" section so nothing is swallowed.
 */
export function splitUnifiedDiff(text: string): DiffSection[] {
  const out: DiffSection[] = [];
  let cur: DiffSection | null = null;
  for (const line of text.replace(/\r/g, "").split("\n")) {
    const h = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (h) {
      cur = { path: h[2], diff: line };
      out.push(cur);
      continue;
    }
    if (cur) cur.diff += `\n${line}`;
  }
  if (out.length === 0 && text.trim()) return [{ path: "(patch)", diff: text }];
  return out;
}
