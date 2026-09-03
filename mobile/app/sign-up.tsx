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

export default function SignUp() {
  const router = useRouter();
  const { palette } = useTheme();
  const { signUp } = useAuth();
  const [server, setServer] = useState(DEFAULT_SERVER);
  const [login, setLogin] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signUp(server.trim(), { login: login.trim(), name: name.trim(), email: email.trim(), password });
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
            Create an account
          </T>
          <Field label="Server" value={server} onChangeText={setServer} autoCapitalize="none" keyboardType="url" mono />
          <Field label="Username" value={login} onChangeText={setLogin} autoCapitalize="none" autoCorrect={false} />
          <Field label="Name" value={name} onChangeText={setName} />
          <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
          <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry />
          {error ? (
            <T variant="meta" tone="destructive">
              ✕ {error}
            </T>
          ) : null}
          <Button title="Create account" onPress={submit} loading={busy} disabled={!login.trim() || !password} />
          <Button title="I already have one" variant="ghost" onPress={() => router.replace("/sign-in")} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
