import * as Haptics from "expo-haptics";

/** The app's haptic vocabulary. Fire-and-forget: a device without a taptic engine just stays silent. */
export type HapticKind = "selection" | "light" | "medium" | "success" | "warning";

export function haptic(kind: HapticKind): void {
  const p =
    kind === "selection"
      ? Haptics.selectionAsync()
      : kind === "light"
        ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        : kind === "medium"
          ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
          : Haptics.notificationAsync(kind === "success" ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning);
  p.catch(() => {});
}
