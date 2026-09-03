import React from "react";
import { Text, type TextProps, type TextStyle } from "react-native";
import { useTheme } from "@/theme/ThemeContext";
import { fonts, type } from "@/theme/tokens";

type Variant = keyof typeof type;
type Tone = "default" | "muted" | "faint" | "live" | "ok" | "destructive" | "attention" | "sleep" | "inverse";

export function T({
  variant = "body",
  tone = "default",
  weight,
  mono,
  serif,
  style,
  ...rest
}: TextProps & {
  variant?: Variant;
  tone?: Tone;
  weight?: "regular" | "medium" | "semibold";
  mono?: boolean;
  serif?: boolean;
}) {
  const { palette } = useTheme();
  const color =
    tone === "muted" ? palette.mutedForeground
    : tone === "faint" ? palette.faint
    : tone === "live" ? palette.live
    : tone === "ok" ? palette.ok
    : tone === "destructive" ? palette.destructive
    : tone === "attention" ? palette.attentionText
    : tone === "sleep" ? palette.sleep
    : tone === "inverse" ? palette.primaryForeground
    : palette.foreground;
  const family = serif
    ? fonts.serif
    : mono
      ? weight === "medium" || weight === "semibold"
        ? fonts.monoMedium
        : fonts.mono
      : weight === "semibold"
        ? fonts.sansSemi
        : weight === "medium"
          ? fonts.sansMedium
          : fonts.sans;
  const s: TextStyle = { ...type[variant], color, fontFamily: family };
  return <Text {...rest} style={[s, style]} />;
}
