import React, { useState } from "react";
import { View } from "react-native";
import { PressScale } from "@/components/motion";
import { radius } from "@/theme/tokens";
import { useTheme } from "@/theme/ThemeContext";
import { T } from "@/components/ui/AppText";
import { Field } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { Sheet } from "@/components/ui/Sheet";

export interface PickerOption {
  value: string;
  label: string;
  hint?: string;
}

/**
 * A single-choice list in a sheet, with an optional search box (the parent handles the query when
 * `onSearch` is given, e.g. repos from the server; otherwise it filters locally).
 */
export function PickerSheet({
  visible,
  title,
  options,
  value,
  onPick,
  onClose,
  onSearch,
  searching,
  allowNone,
  noneLabel = "None",
  emptyText = "Nothing to pick.",
}: {
  visible: boolean;
  title: string;
  options: PickerOption[];
  value?: string;
  onPick: (v: string | undefined) => void;
  onClose: () => void;
  onSearch?: (q: string) => void;
  searching?: boolean;
  allowNone?: boolean;
  noneLabel?: string;
  emptyText?: string;
}) {
  const { palette } = useTheme();
  const [q, setQ] = useState("");
  const shown = onSearch ? options : options.filter((o) => !q || `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const pick = (v: string | undefined) => {
    onPick(v);
    onClose();
  };
  const row = (o: PickerOption | null) => {
    const v = o?.value;
    const on = v === value;
    return (
      <PressScale
        key={v ?? "__none"}
        onPress={() => pick(v)}
        haptic="selection"
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: palette.border }}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <T variant="body" weight={on ? "semibold" : "regular"} numberOfLines={1} tone={o ? "default" : "muted"}>
            {o ? o.label : noneLabel}
          </T>
          {o?.hint ? (
            <T variant="micro" tone="faint" numberOfLines={1}>
              {o.hint}
            </T>
          ) : null}
        </View>
        {on ? <Icon name="check" size={16} color={palette.foreground} /> : null}
      </PressScale>
    );
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      {(options.length > 6 || onSearch) && (
        <View style={{ marginBottom: 8 }}>
          <Field
            placeholder="Search"
            value={q}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={(t) => {
              setQ(t);
              onSearch?.(t);
            }}
          />
        </View>
      )}
      {allowNone ? row(null) : null}
      {searching ? (
        <T variant="micro" tone="faint" style={{ paddingVertical: 8 }}>
          Searching…
        </T>
      ) : null}
      {shown.length === 0 && !searching ? (
        <T variant="meta" tone="muted" style={{ paddingVertical: 8 }}>
          {emptyText}
        </T>
      ) : null}
      {shown.map((o) => row(o))}
    </Sheet>
  );
}

/** The row that opens a PickerSheet: label on the left, current value + chevron on the right. */
export function PickerRow({ label, value, placeholder = "Choose", onPress }: { label: string; value?: string; placeholder?: string; onPress: () => void }) {
  const { palette } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <T variant="meta" weight="medium" tone="muted">
        {label}
      </T>
      <PressScale
        onPress={onPress}
        accessibilityRole="button"
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          borderWidth: 1,
          borderColor: palette.input,
          borderRadius: radius.lg,
          paddingHorizontal: 12,
          paddingVertical: 12,
          backgroundColor: palette.card,
        }}
      >
        <T variant="body" tone={value ? "default" : "faint"} numberOfLines={1} style={{ flex: 1 }}>
          {value ?? placeholder}
        </T>
        <Icon name="chevron-down" size={16} color={palette.faint} />
      </PressScale>
    </View>
  );
}
