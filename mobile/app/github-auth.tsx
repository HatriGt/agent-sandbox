import React, { useEffect, useRef, useState } from "react";
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
 * in a WebView; once the dashboard page has finished loading (cookie present),
 * we inject a same-origin fetch that mints a device API key (with the CSRF
 * header the server requires) and post the token back to the app. From then on
 * the app is a normal bearer client, same as password login.
 *
 * The injection happens on onLoadEnd — not onNavigationStateChange — because
 * nav-state fires mid-redirect and the subsequent page load wipes the injected
 * script before it can answer. A retry timer covers SPA hydration races.
 */
export default function GithubAuth() {
  const router = useRouter();
  const { palette } = useTheme();
  const { completeGithubSignIn } = useAuth();
  const params = useLocalSearchParams<{ server?: string }>();
  const server = (typeof params.server === "string" && params.server ? params.server : DEFAULT_SERVER).replace(/\/+$/, "");
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const done = useRef(false);
  const attempts = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const webref = useRef<WebView>(null);

  useEffect(() => () => {
    if (retryTimer.current) clearInterval(retryTimer.current);
  }, []);

  const keyName = `${Platform.OS === "ios" ? "iPhone" : "Android"} · Agent Sandbox app`;
  // Idempotent: safe to inject repeatedly; only one mint runs per page.
  const mintScript = `
    (function () {
      try {
        if (window.__asbMinting) return; window.__asbMinting = true;
        fetch("/api-keys.json", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json", "x-requested-with": "agent-sandbox" },
          body: JSON.stringify({ name: ${JSON.stringify(keyName)} })
        })
          .then(function (r) { return r.text().then(function (t) { var b; try { b = JSON.parse(t); } catch (e) { b = {}; } return { status: r.status, ok: r.ok, body: b }; }); })
          .then(function (r) {
            window.ReactNativeWebView.postMessage(JSON.stringify(
              r.ok && r.body.token
                ? { asb: 1, kind: "key", token: r.body.token }
                : { asb: 1, kind: "error", message: (r.body.error || ("key mint failed (" + r.status + ")")) }
            ));
          })
          .catch(function (e) {
            window.__asbMinting = false;
            window.ReactNativeWebView.postMessage(JSON.stringify({ asb: 1, kind: "error", message: String((e && e.message) || e) }));
          });
      } catch (e) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ asb: 1, kind: "error", message: String((e && e.message) || e) }));
      }
    })(); true;
  `;

  const startMinting = () => {
    if (done.current) return;
    setFinishing(true);
    attempts.current = 0;
    if (retryTimer.current) clearInterval(retryTimer.current);
    webref.current?.injectJavaScript(mintScript);
    // Re-inject every 2s (idempotent) in case the SPA re-rendered or the first
    // injection landed during a transition; give up after ~16s.
    retryTimer.current = setInterval(() => {
      if (done.current) {
        if (retryTimer.current) clearInterval(retryTimer.current);
        return;
      }
      attempts.current += 1;
      if (attempts.current > 8) {
        if (retryTimer.current) clearInterval(retryTimer.current);
        setFinishing(false);
        setError("Signed in, but couldn't finish device setup. Try again — or sign in on the web, create an API key, and use 'Connect to your own server'.");
        return;
      }
      webref.current?.injectJavaScript(mintScript);
    }, 2000);
  };

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
        <View style={{ padding: 16, gap: 12 }}>
          <T variant="body" tone="destructive">✕ {error}</T>
          <Pressable
            onPress={() => {
              done.current = false;
              setError(null);
            }}
          >
            <T variant="body" tone="live">Try again</T>
          </Pressable>
        </View>
      ) : (
        <>
          {finishing && (
            <View
              style={{
                position: "absolute",
                top: 52,
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 2,
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
                backgroundColor: palette.background,
              }}
            >
              <ActivityIndicator color={palette.live} />
              <T variant="body" tone="muted">Setting up this device…</T>
            </View>
          )}
          <WebView
            ref={webref}
            source={{ uri: `${server}/auth/github` }}
            incognito
            onLoadEnd={(e) => {
              const url = e.nativeEvent.url ?? "";
              if (!done.current && url.startsWith(server) && /\/dashboard(\/|$|\?|#)/.test(url)) {
                startMinting();
              }
            }}
            onMessage={async (e) => {
              let msg: { asb?: number; kind?: string; token?: string; message?: string };
              try {
                msg = JSON.parse(e.nativeEvent.data);
              } catch {
                return;
              }
              if (msg.asb !== 1 || done.current) return;
              if (msg.kind === "key" && msg.token) {
                done.current = true;
                if (retryTimer.current) clearInterval(retryTimer.current);
                await completeGithubSignIn(server, msg.token);
                router.replace("/(tabs)/home");
              } else if (msg.kind === "error") {
                done.current = true;
                if (retryTimer.current) clearInterval(retryTimer.current);
                setFinishing(false);
                setError(msg.message ?? "GitHub sign-in failed.");
              }
            }}
            onError={(e) => {
              if (done.current) return;
              setFinishing(false);
              setError(e.nativeEvent.description || "Could not reach the server.");
            }}
            style={{ flex: 1, backgroundColor: palette.background }}
          />
        </>
      )}
    </SafeAreaView>
  );
}
