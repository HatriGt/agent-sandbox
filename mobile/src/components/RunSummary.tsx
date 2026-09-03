import React, { useState } from "react";
import { View } from "react-native";
import * as Clipboard from "expo-clipboard";
import type { TraceEvent } from "@/lib/trace";
import { runStats, toMarkdown } from "@/lib/transcript-tools";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "./ui/AppText";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";

/** End-of-run receipt: outcome, stats sentence, copy transcript + run again. */
export function RunSummary({
  events,
  exitCode,
  title,
  session,
  onRunAgain,
}: {
  events: TraceEvent[];
  exitCode?: number | null;
  title: string;
  session: string;
  onRunAgain?: () => void;
}) {
  const { palette } = useTheme();
  const [copied, setCopied] = useState(false);
  const ok = exitCode == null || exitCode === 0;
  const interrupted = exitCode === 254 || exitCode === 253;
  const stats = runStats(events);
  const bits = [
    `${stats.steps} steps`,
    stats.files ? `${stats.files} files` : null,
    stats.commands ? `${stats.commands} commands` : null,
    stats.failed ? `${stats.failed} failed` : null,
  ].filter(Boolean);

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: ok ? palette.ok : interrupted ? palette.border : palette.destructive,
        borderRadius: radius.xl,
        padding: 14,
        marginVertical: 10,
        gap: 8,
        backgroundColor: palette.card,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Icon
          name={ok ? "check-circle" : interrupted ? "pause-circle" : "x-circle"}
          size={16}
          color={ok ? palette.ok : interrupted ? palette.mutedForeground : palette.destructive}
        />
        <T variant="body" weight="semibold" style={{ flex: 1 }}>
          {ok ? "Completed" : interrupted ? "Run interrupted" : "Exited with an error"}
        </T>
        <T variant="micro" mono tone="faint">
          {bits.join(" · ")}
        </T>
      </View>
      {!ok && !interrupted ? (
        <T variant="meta" tone="muted">
          code {exitCode}
        </T>
      ) : null}
      {interrupted ? (
        <T variant="meta" tone="muted">
          {exitCode === 254 ? "the sandbox restarted mid-run — send a message to continue" : "stopped by you to deliver a message immediately"}
        </T>
      ) : null}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button
          title={copied ? "Copied" : "Copy transcript"}
          small
          variant="secondary"
          onPress={async () => {
            await Clipboard.setStringAsync(toMarkdown(events, { title, machine: session }));
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          }}
        />
        {onRunAgain && <Button title="Run again" small variant="outline" onPress={onRunAgain} />}
      </View>
    </View>
  );
}
