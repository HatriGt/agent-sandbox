import React, { useEffect, useState } from "react";
import { View } from "react-native";
import type { ProviderView } from "@/lib/api";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "@/components/ui/AppText";
import { Field } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { Sheet } from "@/components/ui/Sheet";
import { FadeInUp, haptic, PressScale, stagger } from "@/components/motion";

interface Choice {
  id: string;
  label: string;
  group: string;
  provider?: string;
}

/**
 * The Model menu (web thread/ModelPicker via the composer toolbar): the deployment's models first,
 * then every saved provider's list under its own heading; one search box over all of them.
 */
export function ModelSheet({
  visible,
  onClose,
  models,
  defaultModel,
  model,
  providers,
  provider,
  providerModel,
  onPick,
  onPickProvider,
}: {
  visible: boolean;
  onClose: () => void;
  models: { id: string; label: string }[];
  defaultModel: string | null;
  model: string | null;
  providers: ProviderView[];
  provider: string | null;
  providerModel: string | null;
  onPick: (m: { id: string; label: string }) => void;
  onPickProvider: (provider: string, model: string | null) => void;
}) {
  const { palette } = useTheme();
  const [q, setQ] = useState("");
  useEffect(() => {
    if (visible) setQ("");
  }, [visible]);
  const provChoices: Choice[] = providers.flatMap((p) => (p.models ?? []).map((id) => ({ id, label: id, group: p.label, provider: p.id })));
  const all: Choice[] = [...models.map((m) => ({ ...m, group: provChoices.length ? "Deployment" : "" })), ...provChoices];
  const needle = q.trim().toLowerCase();
  const shown = needle ? all.filter((c) => c.label.toLowerCase().includes(needle) || c.id.toLowerCase().includes(needle)) : all;
  const groups = shown.reduce<{ name: string; items: Choice[] }[]>((acc, c) => {
    const g = acc.find((x) => x.name === c.group);
    if (g) g.items.push(c);
    else acc.push({ name: c.group, items: [c] });
    return acc;
  }, []);
  const isOn = (c: Choice) => (c.provider ? provider === c.provider && providerModel === c.id : !provider && c.id === (model ?? defaultModel));

  return (
    <Sheet visible={visible} onClose={onClose} title="Model">
      <View style={{ gap: 8, paddingBottom: 8 }}>
        {all.length > 8 ? <Field placeholder="Search models…" value={q} onChangeText={setQ} autoCapitalize="none" autoCorrect={false} accessibilityLabel="Search models" /> : null}
        {groups.length === 0 ? (
          <T variant="meta" tone="faint" style={{ paddingHorizontal: 4 }}>
            Nothing matches "{q.trim()}".
          </T>
        ) : null}
        {groups.map((g) => (
          <View key={g.name || "models"} style={{ gap: 2 }}>
            {g.name ? (
              <T variant="micro" weight="semibold" tone="faint" style={{ paddingHorizontal: 8, paddingTop: 8, paddingBottom: 2, letterSpacing: 0.6, textTransform: "uppercase" }}>
                {g.name}
              </T>
            ) : null}
            {g.items.map((c, i) => {
              const on = isOn(c);
              return (
                <FadeInUp key={`${c.provider ?? "d"}:${c.id}`} delay={stagger(i, 20)}>
                  <PressScale
                    onPress={() => {
                      haptic("selection");
                      if (c.provider) onPickProvider(c.provider, c.id);
                      else onPick(c);
                      onClose();
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                      paddingVertical: 10,
                      paddingHorizontal: 10,
                      borderRadius: radius.lg,
                      backgroundColor: on ? palette.accent : pressed ? palette.muted : "transparent",
                    })}
                  >
                    <T variant="body" weight={on ? "semibold" : "regular"} mono={!!c.provider} numberOfLines={1} style={{ flex: 1 }}>
                      {c.label}
                    </T>
                    {!c.provider && c.id === defaultModel ? (
                      <T variant="micro" tone="faint">
                        default
                      </T>
                    ) : null}
                    {on ? <Icon name="check" size={14} color={palette.live} /> : null}
                  </PressScale>
                </FadeInUp>
              );
            })}
          </View>
        ))}
      </View>
    </Sheet>
  );
}
