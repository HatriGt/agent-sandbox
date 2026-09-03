import React, { useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { useAuth } from "@/state/auth";
import { DEFAULT_SERVER } from "@/lib/config";
import { useTheme } from "@/theme/ThemeContext";
import { T } from "@/components/ui/AppText";

/**
 * "Sign in with GitHub" — the same server flow the web uses (/auth/github →
 * GitHub → callback sets the HttpOnly session cookie → /dashboard). We run it
 * in a WebView; when it lands on /dashboard the session cookie exists inside
 * the WebView, so we inject a same-origin fetch that mints a device API key
 * (with the CSRF header the server requires) and post the token back to the
 * app. From then on the app is a normal bearer client, same as password login.
 */
export default function GithubAuth() {
  const router = useRouter();
  const { palette } = useTheme();
  const { completeGithubSignIn } = useAuth();
  const params = useLocalSearchParams<{ server?: string }>();
  const server = (typeof params.server === "string" && params.server ? params.server : DEFAULT_SERVER).replace(/\/+$/, "");
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const minted = useRef(false);
  const webref = useRef<WebView>(null);

  const keyName = `${Platform.OS === "ios" ? "iPhone" : "Android"} · Agent Sandbox app`;
  const mintScript = `
    (function () {
      if (window.__asbMinting) return; window.__asbMinting = true;
      fetch("/api-keys.json", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "x-requested-with": "agent-sandbox" },
        body: JSON.stringify({ name: ${JSON.stringify(keyName)} })
      })
        .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
        .then(function (r) {
          window.ReactNativeWebView.postMessage(JSON.stringify(
            r.ok && r.body.token ? { kind: "key", token: r.body.token } : { kind: "error", message: r.body.error || "could not create a device key" }
          ));
        })
        .catch(function (e) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ kind: "error", message: String(e && e.message || e) }));
        });
    })(); true;
  `;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.background }} edges={["top", "bottom"]}>
      <View
        style={{
          height: 52,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 16,
          borderBottomWidth: 1,
          borderBottomColor: palette.border,
        }}
      >
        <T variant="body" weight="semibold">
          Sign in with GitHub
        </T>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <T variant="body" tone="muted">Cancel</T>
        </Pressable>
      </View>
      {error ? (
        <View style={{ padding: 16, gap: 8 }}>
          <T variant="body" tone="destructive">✕ {error}</T>
          <Pressable onPress={() => setError(null)}>
            <T variant="body" tone="live">Try again</T>
          </Pressable>
        </View>
      ) : finishing ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}>
          <ActivityIndicator color={palette.live} />
          <T variant="body" tone="muted">Setting up this device…</T>
        </View>
      ) : (
        <WebView
          ref={webref}
          source={{ uri: `${server}/auth/github` }}
          incognito
          onNavigationStateChange={(nav) => {
            // The callback redirects to /dashboard once the session cookie is set.
            if (!minted.current && nav.url.startsWith(server) && /\/dashboard(\/|$|\?)/.test(nav.url)) {
              minted.current = true;
              setFinishing(true);
              webref.current?.injectJavaScript(mintScript);
            }
          }}
          onMessage={async (e) => {
            try {
              const msg = JSON.parse(e.nativeEvent.data) as { kind: string; token?: string; message?: string };
              if (msg.kind === "key" && msg.token) {
                await completeGithubSignIn(server, msg.token);
                router.replace("/(tabs)/home");
              } else {
                setFinishing(false);
                minted.current = false;
                setError(msg.message ?? "GitHub sign-in failed.");
              }
            } catch {
              /* not our message */
            }
          }}
          onError={(e) => {
            setFinishing(false);
            minted.current = false;
            setError(e.nativeEvent.description || "Could not reach the server.");
          }}
          style={{ flex: 1, backgroundColor: palette.background, opacity: finishing ? 0 : 1 }}
        />
      )}
    </SafeAreaView>
  );
}
