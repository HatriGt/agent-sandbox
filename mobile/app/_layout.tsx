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

// Hold the native splash until fonts and the stored credential are loaded, so
// the first frame is the real app (the web dashboard inlines a shell skeleton
// for the same reason).
void SplashScreen.preventAutoHideAsync();

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
          animation: "fade",
          animationDuration: 160,
        }}
      >
        <Stack.Screen name="new" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
      </Stack>
      {intro && <AnimatedSplash onDone={() => setIntro(false)} />}
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <Shell />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
