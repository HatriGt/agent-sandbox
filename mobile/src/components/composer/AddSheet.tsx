import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { api, type RepoInfo } from "@/lib/api";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "@/components/ui/AppText";
import { Field } from "@/components/ui/Field";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Sheet } from "@/components/ui/Sheet";
import { animateLayout, FadeInUp, haptic, PressScale, stagger } from "@/components/motion";

export interface PickedRepo {
  repo: string;
  ref?: string;
  defaultBranch?: string;
  private?: boolean;
}

function MenuRow({ icon, label, hint, onPress }: { icon: IconName; label: string; hint: string; onPress: () => void }) {
  const { palette } = useTheme();
  return (
    <PressScale
      onPress={() => {
        haptic("selection");
        onPress();
      }}
      accessibilityRole="menuitem"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 10,
        paddingVertical: 12,
        borderRadius: radius.lg,
        backgroundColor: pressed ? palette.accent : "transparent",
      })}
    >
      <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: palette.muted, alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={14} color={palette.mutedForeground} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <T variant="body" weight="medium">
          {label}
        </T>
        <T variant="micro" tone="muted">
          {hint}
        </T>
      </View>
      <Icon name="chevron-right" size={14} color={palette.faint} />
    </PressScale>
  );
}

/**
 * The composer's "+" menu (web Toolbar.tsx PlusMenu): attach a repository, or add an image. The
 * repository row turns the sheet into the web's RepoPicker — search, then tap to toggle.
 */
export function AddSheet({
  visible,
  onClose,
  picked,
  onToggleRepo,
  onPickImage,
  startOnRepos = false,
}: {
  visible: boolean;
  onClose: () => void;
  picked: PickedRepo[];
  onToggleRepo: (r: RepoInfo) => void;
  onPickImage: (camera: boolean) => void;
  /** Open straight on the repository search (a starter that needs a repo). */
  startOnRepos?: boolean;
}) {
  const { palette } = useTheme();
  const [mode, setMode] = useState<"menu" | "repos">(startOnRepos ? "repos" : "menu");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<RepoInfo[] | null>(null);
  useEffect(() => {
    if (visible) {
      setMode(startOnRepos ? "repos" : "menu");
      setQ("");
    }
  }, [visible, startOnRepos]);
  useEffect(() => {
    if (!visible || mode !== "repos") return;
    let cancelled = false;
    const t = setTimeout(() => {
      api
        .repos(q.trim())
        .then((r) => !cancelled && setResults(r.repos.slice(0, 12)))
        .catch(() => !cancelled && setResults([]));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [visible, mode, q]);

  return (
    <Sheet visible={visible} onClose={onClose} title={mode === "repos" ? "Attach a repository" : "Add to the task"}>
      {mode === "menu" ? (
        <View style={{ gap: 2, paddingBottom: 8 }}>
          <MenuRow
            icon="git-branch"
            label={picked.length ? "Add another repository" : "Attach a repository"}
            hint="Clone it into the sandbox before the agent starts"
            onPress={() => {
              animateLayout();
              setMode("repos");
            }}
          />
          <MenuRow icon="image" label="Add an image" hint="A screenshot, a whiteboard, a bug" onPress={() => onPickImage(false)} />
          <MenuRow icon="camera" label="Take a photo" hint="Photograph it and delegate it" onPress={() => onPickImage(true)} />
        </View>
      ) : (
        <View style={{ gap: 10, paddingBottom: 8 }}>
          <Field placeholder="Search repos…" value={q} onChangeText={setQ} autoCapitalize="none" autoCorrect={false} autoFocus mono />
          {results === null ? (
            <T variant="meta" tone="faint" style={{ paddingHorizontal: 4 }}>
              Loading repositories…
            </T>
          ) : results.length === 0 ? (
            <T variant="meta" tone="faint" style={{ paddingHorizontal: 4 }}>
              {q.trim() ? `Nothing matches "${q.trim()}".` : "No repositories yet — connect a GitHub account under Integrations."}
            </T>
          ) : (
            results.map((r, i) => {
              const on = picked.some((p) => p.repo.toLowerCase() === r.fullName.toLowerCase());
              return (
                <FadeInUp key={r.fullName} delay={stagger(i, 25)}>
                  <PressScale
                    onPress={() => {
                      haptic("selection");
                      onToggleRepo(r);
                    }}
                    accessibilityRole="checkbox"
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
                    <Icon name={on ? "check-circle" : "circle"} size={16} color={on ? palette.live : palette.faint} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <T variant="meta" mono numberOfLines={1}>
                        {r.fullName}
                        {r.private ? " · private" : ""}
                      </T>
                      {r.description ? (
                        <T variant="micro" tone="faint" numberOfLines={1}>
                          {r.description}
                        </T>
                      ) : null}
                    </View>
                  </PressScale>
                </FadeInUp>
              );
            })
          )}
        </View>
      )}
    </Sheet>
  );
}
