import React from "react";
import { TextInput, View, type TextInputProps } from "react-native";
import { useTheme } from "@/theme/ThemeContext";
import { fonts, radius, type } from "@/theme/tokens";
import { T } from "./AppText";

export function Field({
  label,
  hint,
  mono,
  style,
  ...rest
}: TextInputProps & { label?: string; hint?: string; mono?: boolean }) {
  const { palette } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {label ? (
        <T variant="meta" weight="medium" tone="muted">
          {label}
        </T>
      ) : null}
      <TextInput
        placeholderTextColor={palette.faint}
        {...rest}
        style={[
          {
            borderWidth: 1,
            borderColor: palette.input,
            borderRadius: radius.lg,
            paddingHorizontal: 12,
            paddingVertical: 12,
            color: palette.foreground,
            backgroundColor: palette.card,
            fontFamily: mono ? fonts.mono : fonts.sans,
            fontSize: mono ? type.code.fontSize : type.body.fontSize,
          },
          style,
        ]}
      />
      {hint ? (
        <T variant="micro" tone="faint">
          {hint}
        </T>
      ) : null}
    </View>
  );
}
