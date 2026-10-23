import React from "react";
import { useColorScheme, View } from "react-native";
import { PressScale } from "@/components/motion";
import { useTheme } from "@/theme/ThemeContext";
import { DEFAULT_THEME, THEMES, type Scheme, type Theme } from "@/theme/themes";
import { radius } from "@/theme/tokens";
import { T } from "@/components/ui/AppText";
import { Icon } from "@/components/ui/Icon";
import { Sheet } from "@/components/ui/Sheet";

const SCHEMES: { scheme: Scheme; label: string }[] = [
  { scheme: "light", label: "Light" },
  { scheme: "dark", label: "Dark" },
];

/**
 * The theme picker: "Match system" on top, then a two-column grid of theme cards per scheme. A tap
 * commits at once and the sheet stays up, so the whole app re-paints behind it and the user can
 * compare two themes without reopening. No transition: a theme switch is not a moment.
 */
export function ThemeSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { palette, pref, setPref } = useTheme();
  const os: Scheme = useColorScheme() === "light" ? "light" : "dark";
  const systemLabel = THEMES.find((t) => t.id === DEFAULT_THEME[os])!.label;
  return (
    <Sheet visible={visible} onClose={onClose} title="Theme">
      <View style={{ gap: 18, paddingBottom: 12 }}>
        <PressScale
          onPress={() => setPref("system")}
          haptic="selection"
          accessibilityRole="button"
          accessibilityState={{ selected: pref === "system" }}
          style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: palette.border }}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <T variant="body" weight={pref === "system" ? "semibold" : "regular"}>
              Match system
            </T>
            <T variant="micro" tone="faint">
              {`Light or Black with the OS. Now ${systemLabel}.`}
            </T>
          </View>
          {pref === "system" ? <Icon name="check" size={16} color={palette.foreground} /> : null}
        </PressScale>
        {SCHEMES.map(({ scheme, label }) => (
          <View key={scheme} style={{ gap: 10 }}>
            <T variant="micro" tone="muted" weight="semibold" style={{ textTransform: "uppercase", letterSpacing: 0.6 }}>
              {label}
            </T>
            <Grid themes={THEMES.filter((t) => t.scheme === scheme)} active={pref} onPick={(t) => setPref(t.id)} />
          </View>
        ))}
      </View>
    </Sheet>
  );
}

/** Rows of two; an odd last row keeps a blank cell so the card does not stretch to full width. */
function Grid({ themes, active, onPick }: { themes: Theme[]; active: string; onPick: (t: Theme) => void }) {
  const rows: Theme[][] = [];
  for (let i = 0; i < themes.length; i += 2) rows.push(themes.slice(i, i + 2));
  return (
    <View style={{ gap: 12 }}>
      {rows.map((row, i) => (
        <View key={i} style={{ flexDirection: "row", gap: 12 }}>
          {row.map((t) => (
            <ThemeCard key={t.id} theme={t} active={t.id === active} onPress={() => onPick(t)} />
          ))}
          {row.length === 1 ? <View style={{ flex: 1 }} /> : null}
        </View>
      ))}
    </View>
  );
}

/**
 * A miniature console in the theme's own tones: rail strip, sheet, a user bubble, two text lines
 * and the live dot. The ring on the active card is the current theme's `ring`, with a 2px gap so it
 * never merges with the preview's own edge.
 */
function ThemeCard({ theme, active, onPress }: { theme: Theme; active: boolean; onPress: () => void }) {
  const { palette } = useTheme();
  const p = theme.palette;
  return (
    <PressScale onPress={onPress} haptic="selection" scaleTo={0.97} accessibilityRole="button" accessibilityLabel={`${theme.label}. ${theme.description}`} accessibilityState={{ selected: active }} style={{ flex: 1, gap: 6 }}>
      <View style={{ padding: 2, borderRadius: radius.xl, borderWidth: 2, borderColor: active ? palette.ring : "transparent" }}>
        <View style={{ height: 88, flexDirection: "row", borderRadius: radius.lg, overflow: "hidden", backgroundColor: p.background, borderWidth: 1, borderColor: p.lineStrong }}>
          <View style={{ width: 20, backgroundColor: p.rail, paddingTop: 8, alignItems: "center", gap: 5 }}>
            <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: p.foreground, opacity: 0.8 }} />
            <View style={{ width: 8, height: 2, borderRadius: 1, backgroundColor: p.faint }} />
            <View style={{ width: 8, height: 2, borderRadius: 1, backgroundColor: p.faint }} />
          </View>
          <View style={{ flex: 1, padding: 7 }}>
            <View style={{ flex: 1, backgroundColor: p.card, borderRadius: radius.sm, borderWidth: 1, borderColor: p.border, padding: 7, gap: 5 }}>
              <View style={{ alignSelf: "flex-end", width: 34, height: 11, borderRadius: 6, backgroundColor: p.secondary }} />
              <View style={{ width: "78%", height: 3, borderRadius: 2, backgroundColor: p.foreground }} />
              <View style={{ width: "52%", height: 3, borderRadius: 2, backgroundColor: p.mutedForeground }} />
              <View style={{ flex: 1 }} />
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: p.live }} />
                <View style={{ width: 20, height: 2, borderRadius: 1, backgroundColor: p.faint }} />
              </View>
            </View>
          </View>
        </View>
      </View>
      <View style={{ paddingHorizontal: 4 }}>
        <T variant="meta" weight={active ? "semibold" : "medium"}>
          {theme.label}
        </T>
        <T variant="micro" tone="muted" numberOfLines={1}>
          {theme.description}
        </T>
      </View>
    </PressScale>
  );
}
