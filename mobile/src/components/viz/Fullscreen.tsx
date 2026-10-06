import React from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { T } from "../ui/AppText";
import { Icon, type IconName } from "../ui/Icon";

const ZOOMS = [0.5, 0.75, 1, 1.5, 2, 3];

/**
 * The mobile counterpart of web's viz-fullscreen dialog: a full-screen modal for diagrams
 * (graph / sequence / mermaid). Content pans in both directions; zoom via the − / + buttons
 * (and native pinch on iOS through ScrollView's zoom scale). `children(zoom)` lets a diagram
 * redraw at the zoom instead of being bitmap-scaled.
 */
export function VizFullscreen({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: (zoom: number) => React.ReactNode;
}) {
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();
  const [zi, setZi] = React.useState(2);
  React.useEffect(() => {
    if (visible) setZi(2);
  }, [visible]);
  const zoom = ZOOMS[zi];
  return (
    <Modal visible={visible} onRequestClose={onClose} animationType="fade" presentationStyle="fullScreen" statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: palette.background, paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, height: 44, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: palette.border }}>
          <T variant="meta" weight="medium" numberOfLines={1} style={{ flex: 1 }}>
            {title}
          </T>
          <ZoomButton icon="minus" label="Zoom out" disabled={zi === 0} onPress={() => setZi((z) => Math.max(0, z - 1))} />
          <T variant="micro" tone="muted" style={{ width: 40, textAlign: "center", fontVariant: ["tabular-nums"] }}>
            {Math.round(zoom * 100)}%
          </T>
          <ZoomButton icon="plus" label="Zoom in" disabled={zi === ZOOMS.length - 1} onPress={() => setZi((z) => Math.min(ZOOMS.length - 1, z + 1))} />
          <ZoomButton icon="x" label="Close" onPress={onClose} />
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }} maximumZoomScale={3} minimumZoomScale={0.5} bouncesZoom>
          <ScrollView horizontal contentContainerStyle={{ padding: 16, flexGrow: 1, justifyContent: "center", alignItems: "center" }}>
            {children(zoom)}
          </ScrollView>
        </ScrollView>
      </View>
    </Modal>
  );
}

function ZoomButton({ icon, label, onPress, disabled }: { icon: IconName; label: string; onPress: () => void; disabled?: boolean }) {
  const { palette } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        width: 32,
        height: 32,
        borderRadius: radius.md,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? palette.muted : "transparent",
        opacity: disabled ? 0.35 : 1,
      })}
    >
      <Icon name={icon} size={16} color={palette.foreground} />
    </Pressable>
  );
}

/** "Expand" chip that opens a block's fullscreen view; sits under an inline diagram. */
export function ExpandAction({ onPress }: { onPress: () => void }) {
  const { palette } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel="Open fullscreen"
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-end", opacity: pressed ? 0.6 : 1 })}
    >
      <Icon name="maximize-2" size={11} color={palette.mutedForeground} />
      <T variant="micro" tone="muted">
        Fullscreen
      </T>
    </Pressable>
  );
}
