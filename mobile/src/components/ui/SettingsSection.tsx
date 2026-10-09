import React from "react";
import { View } from "react-native";
import { T } from "@/components/ui/AppText";

/** Section heading in web SettingsSection order: title · meta, purpose, optional trailing action. */
export function SettingsSection({ title, meta, purpose, action, children }: { title: string; meta?: string; purpose?: string; action?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <View style={{ gap: 10, marginTop: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <T variant="h3" weight="semibold" style={{ flex: 1 }}>
          {title}
          {meta ? <T variant="micro" tone="faint">{`  ${meta}`}</T> : null}
        </T>
        {action}
      </View>
      {purpose ? (
        <T variant="meta" tone="muted">
          {purpose}
        </T>
      ) : null}
      {children}
    </View>
  );
}
