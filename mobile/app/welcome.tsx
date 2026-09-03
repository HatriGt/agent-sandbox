import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/state/auth";
import { useTheme } from "@/theme/ThemeContext";
import { T } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";

/** Landing: the serif voice of the web landing page, one screen. */
export default function Welcome() {
  const router = useRouter();
  const { palette } = useTheme();
  const { loadAuthConfig, signedIn } = useAuth();
  const [mode, setMode] = useState<"saas" | "token" | null>(null);

  useEffect(() => {
    if (signedIn) router.replace("/(tabs)/home");
  }, [signedIn, router]);

  useEffect(() => {
    loadAuthConfig().then((c) => setMode(c?.mode ?? null));
  }, [loadAuthConfig]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }}>
      <View style={{ flex: 1, justifyContent: "center", padding: 28, gap: 16 }}>
        <T serif variant="display">
          Agent Sandbox
        </T>
        <T variant="lead" tone="muted">
          Delegate a coding task to an agent in a throwaway machine. Watch it live, answer when it needs
          you, review the diff, ship the PR — from your pocket.
        </T>
        <View style={{ gap: 10, marginTop: 24 }}>
          {mode !== "token" && (
            <>
              <Button title="Sign in" onPress={() => router.push("/sign-in")} />
              <Button title="Create an account" variant="secondary" onPress={() => router.push("/sign-up")} />
            </>
          )}
          <Button
            title="Connect to your own server"
            variant={mode === "token" ? "primary" : "ghost"}
            onPress={() => router.push("/connect-server")}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}
