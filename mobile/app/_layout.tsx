import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { AnimatedSplash } from "@/components/AnimatedSplash";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from "@expo-google-fonts/inter";
import { GeistMono_400Regular, GeistMono_500Medium } from "@expo-google-fonts/geist-mono";
import { HedvigLettersSerif_400Regular } from "@expo-google-fonts/hedvig-letters-serif";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ThemeProvider, useTheme } from "@/theme/ThemeContext";
import { AuthProvider, useAuth } from "@/state/auth";
import { PushBridge } from "@/components/PushBridge";
import { ShareIntentProvider } from "expo-share-intent";
import { ShareBridge } from "@/components/ShareBridge";
import { Toasts } from "@/components/Toasts";

// Hold the native splash until fonts and the stored credential are loaded, so
// the first frame is the real app (the web dashboard inlines a shell skeleton
// for the same reason).
void SplashScreen.preventAutoHideAsync();

/** Content screens: platform push so the iOS edge swipe-back tracks the finger. */
const PUSH = { animation: "default", gestureEnabled: true, fullScreenGestureEnabled: true } as const;
/** Auth, redirects and the tab shell cross-fade: there is no "back" to them. */
const FADE = { animation: "fade", animationDuration: 160, gestureEnabled: false } as const;
const FADE_SCREENS = ["index", "welcome", "sign-in", "sign-up", "connect-server", "github-auth", "(tabs)", "dashboard/box/[name]", "dashboard/pr/[repo]/[number]"];

function Shell() {
  const { palette, dark } = useTheme();
  const { ready } = useAuth();
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    GeistMono_400Regular,
    GeistMono_500Medium,
    HedvigLettersSerif_400Regular,
  });

  // Native splash hands off to the in-app AnimatedSplash for a live intro
  // (spring mark, orb pop, spark to the gap) instead of a hard cut to the UI.
  const [intro, setIntro] = useState(true);
  useEffect(() => {
    if (fontsLoaded && ready) void SplashScreen.hideAsync();
  }, [fontsLoaded, ready]);

  if (!fontsLoaded || !ready) return <View style={{ flex: 1, backgroundColor: palette.background }} />;

  return (
    <>
      <StatusBar style={dark ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: palette.background },
          // Platform push by default so every content screen gets the native transition and the
          // iOS edge swipe-back tracks the finger. Only the auth/boot screens below cross-fade.
          ...PUSH,
        }}
      >
        {FADE_SCREENS.map((name) => (
          <Stack.Screen key={name} name={name} options={FADE} />
        ))}
        {/* Boot is replaced in place by the box once it attaches; swiping back mid-boot would orphan it. */}
        <Stack.Screen name="booting" options={{ gestureEnabled: false, fullScreenGestureEnabled: false }} />
      </Stack>
      <PushBridge />
      <ShareBridge />
      <Toasts />
      {intro && <AnimatedSplash onDone={() => setIntro(false)} />}
    </>
  );
}

export default function RootLayout() {
  return (
    <ShareIntentProvider>
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <Shell />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
    </ShareIntentProvider>
  );
}
