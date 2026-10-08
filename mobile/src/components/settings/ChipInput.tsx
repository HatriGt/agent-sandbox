import React, { useState } from "react";
import { View } from "react-native";
import { PressScale } from "@/components/motion";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "@/components/ui/AppText";
import { Field } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";

/** A list of short strings as removable chips plus an add field (Enter / comma / blur commits). */
export function ChipInput({
  label,
  values,
  onChange,
  placeholder,
  hint,
  disabled,
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  hint?: string;
  disabled?: boolean;
}) {
  const { palette } = useTheme();
  const [draft, setDraft] = useState("");
  const commit = (text: string = draft) => {
    const parts = text.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    const next = [...values];
    for (const p of parts) if (!next.includes(p)) next.push(p);
    setDraft("");
    if (next.length !== values.length) onChange(next);
  };
  return (
    <View style={{ gap: 8 }}>
      <T variant="meta" weight="medium" tone="muted">
        {label}
      </T>
      {values.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {values.map((v) => (
            <View key={v} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4, paddingLeft: 10, paddingRight: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.secondary }}>
              <T variant="micro" mono numberOfLines={1}>
                {v}
              </T>
              <PressScale scaleTo={0.9} disabled={disabled} hitSlop={8} onPress={() => onChange(values.filter((x) => x !== v))} accessibilityRole="button" accessibilityLabel={`Remove ${v}`}>
                <Icon name="x" size={12} color={palette.mutedForeground} />
              </PressScale>
            </View>
          ))}
        </View>
      ) : null}
      <Field
        value={draft}
        onChangeText={(t) => (t.endsWith(",") ? commit(t.slice(0, -1)) : setDraft(t))}
        onSubmitEditing={() => commit()}
        onBlur={() => commit()}
        blurOnSubmit={false}
        placeholder={placeholder}
        hint={hint}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!disabled}
        returnKeyType="done"
      />
    </View>
  );
}
