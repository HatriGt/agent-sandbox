import React, { useState } from "react";
import { View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";

/**
 * A secret the server returns exactly once (user token, webhook secret). Lives only in component
 * state — never written to storage — and disappears when the parent unmounts or calls onDone.
 */
export function OneTimeSecret({ label, value, hint, onDone }: { label: string; value: string; hint?: string; onDone?: () => void }) {
  const { palette } = useTheme();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await Clipboard.setStringAsync(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <View style={{ gap: 8, padding: 12, borderRadius: radius.lg, borderWidth: 1, borderColor: palette.lineStrong, backgroundColor: palette.muted }}>
      <T variant="meta" weight="semibold">
        {label}
      </T>
      <T variant="micro" mono selectable>
        {value}
      </T>
      <T variant="micro" tone="muted">
        {hint ?? "Shown once. Copy it now — it cannot be retrieved later."}
      </T>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button small title={copied ? "Copied" : "Copy"} variant="secondary" onPress={() => void copy()} />
        {onDone ? <Button small title="Done" variant="ghost" onPress={onDone} /> : null}
      </View>
    </View>
  );
}
