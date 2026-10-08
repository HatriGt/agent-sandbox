import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import type { SkillView } from "@/lib/api";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "@/components/ui/AppText";
import { Icon } from "@/components/ui/Icon";
import { Sheet } from "@/components/ui/Sheet";
import { FadeInUp, haptic, PressScale, stagger } from "@/components/motion";

/**
 * The Skills menu (web Toolbar.tsx SkillsMenu): every enabled skill as a row; the current one is
 * checked and tapping it again clears the pick. Empty state links to the Skills page.
 */
export function SkillsSheet({
  visible,
  onClose,
  skills,
  current,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  /** null while loading. */
  skills: SkillView[] | null;
  current: string | null;
  onPick: (name: string | null) => void;
}) {
  const { palette } = useTheme();
  const router = useRouter();
  return (
    <Sheet visible={visible} onClose={onClose} title="Skills">
      {skills === null ? (
        <T variant="micro" tone="muted" style={{ paddingHorizontal: 4, paddingVertical: 8 }}>
          Loading skills…
        </T>
      ) : skills.length === 0 ? (
        <View style={{ gap: 4, paddingHorizontal: 4, paddingVertical: 8 }}>
          <T variant="meta" weight="medium">
            No skills yet
          </T>
          <T variant="micro" tone="muted">
            A skill is a saved playbook the agent runs with your message — add or enable one first.
          </T>
          <PressScale
            onPress={() => {
              onClose();
              router.push("/settings/skills");
            }}
            hitSlop={8}
            style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 }}
          >
            <Icon name="zap" size={12} color={palette.live} />
            <T variant="micro" weight="medium" tone="live">
              Open Skills
            </T>
          </PressScale>
        </View>
      ) : (
        <View style={{ gap: 2, paddingBottom: 8 }}>
          <T variant="micro" tone="faint" style={{ paddingHorizontal: 4, paddingBottom: 4 }}>
            Runs with the rest of your message · type / to filter
          </T>
          {skills.map((s, i) => {
            const on = current === s.name;
            return (
              <FadeInUp key={s.name} delay={stagger(i, 25)}>
                <PressScale
                  onPress={() => {
                    haptic("selection");
                    onPick(on ? null : s.name);
                    onClose();
                  }}
                  accessibilityRole="menuitem"
                  accessibilityState={{ selected: on }}
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
                  <Icon name="zap" size={13} color={on ? palette.live : palette.mutedForeground} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <T variant="meta" mono weight="medium" numberOfLines={1}>
                      /{s.name}
                    </T>
                    {s.description ? (
                      <T variant="micro" tone="faint" numberOfLines={1}>
                        {s.description}
                      </T>
                    ) : null}
                  </View>
                  {on ? <Icon name="check" size={14} color={palette.live} /> : null}
                </PressScale>
              </FadeInUp>
            );
          })}
        </View>
      )}
    </Sheet>
  );
}
