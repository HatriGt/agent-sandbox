import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/state/auth";
import { DEFAULT_SERVER } from "@/lib/config";
import { useTheme } from "@/theme/ThemeContext";
import { T } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";

/** Self-host path: server URL + operator token or an asb_ API key. */
export default function ConnectServer() {
  const router = useRouter();
  const { palette } = useTheme();
  const { connectWithToken } = useAuth();
  const [server, setServer] = useState(DEFAULT_SERVER);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await connectWithToken(server.trim(), token);
      router.replace("/(tabs)/home");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 24, gap: 14 }} keyboardShouldPersistTaps="handled">
          <T serif variant="h1" style={{ marginBottom: 8 }}>
            Connect
          </T>
          <T variant="body" tone="muted">
            Point the app at your controller and paste the operator token (or an asb_ API key). It is
            stored in the device keychain and sent only as a request header.
          </T>
          <Field label="Server URL" value={server} onChangeText={setServer} autoCapitalize="none" keyboardType="url" mono />
          <Field label="Token" value={token} onChangeText={setToken} autoCapitalize="none" secureTextEntry mono />
          {error ? (
            <T variant="meta" tone="destructive">
              ✕ {error}
            </T>
          ) : null}
          <Button title="Connect" onPress={submit} loading={busy} disabled={!server.trim() || !token.trim()} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
