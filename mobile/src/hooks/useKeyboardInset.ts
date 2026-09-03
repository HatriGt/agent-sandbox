import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

/**
 * Keyboard height as a bottom inset. On Android with SDK 54's always-on
 * edge-to-edge, adjustResize does not resize the window, so
 * KeyboardAvoidingView never moves — we pad manually from keyboard events.
 * iOS keeps using KeyboardAvoidingView (behavior="padding"), so this returns 0.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    if (Platform.OS === "ios") return;
    const show = Keyboard.addListener("keyboardDidShow", (e) => setInset(e.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardDidHide", () => setInset(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return inset;
}
