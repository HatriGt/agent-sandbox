import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/state/auth";
import { DEFAULT_SERVER } from "@/lib/config";
import { useTheme } from "@/theme/ThemeContext";
import { T } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";

export default function SignIn() {
  const router = useRouter();
  const { palette } = useTheme();
  const { signInWithPassword } = useAuth();
  const [server, setServer] = useState(DEFAULT_SERVER);
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithPassword(server.trim(), login.trim(), password);
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
            Sign in
          </T>
          <Field label="Server" value={server} onChangeText={setServer} autoCapitalize="none" keyboardType="url" mono />
          <Field label="Username or email" value={login} onChangeText={setLogin} autoCapitalize="none" autoCorrect={false} />
          <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry />
          {error ? (
            <T variant="meta" tone="destructive">
              ✕ {error}
            </T>
          ) : null}
          <Button title="Sign in" onPress={submit} loading={busy} disabled={!login.trim() || !password} />
          <Button
            title="Sign in with GitHub"
            variant="secondary"
            onPress={() => router.push({ pathname: "/github-auth", params: { server: server.trim() } })}
          />
          <Button title="Use a token instead" variant="ghost" onPress={() => router.push("/connect-server")} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
