import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";
import { api, setUnauthorizedHandler, type AuthConfig, type Me } from "@/lib/api";
import { loadConfig, setBearer, setServerUrl } from "@/lib/config";

type AuthState = {
  ready: boolean;
  signedIn: boolean;
  me: Me | null;
  config: AuthConfig | null;
  refreshMe: () => Promise<void>;
  loadAuthConfig: () => Promise<AuthConfig | null>;
  /** Self-host: server URL + operator token / asb_ API key. */
  connectWithToken: (url: string, token: string) => Promise<void>;
  /** SaaS: password sign-in; mints a device API key so no cookie/CSRF handling is needed. */
  signInWithPassword: (url: string, login: string, password: string) => Promise<void>;
  signUp: (url: string, u: { login: string; name: string; email: string; password: string }) => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [config, setConfig] = useState<AuthConfig | null>(null);

  const refreshMe = useCallback(async () => {
    try {
      const m = await api.me();
      setMe(m);
      setSignedIn(true);
    } catch {
      setSignedIn(false);
      setMe(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const { token } = await loadConfig();
      if (token) await refreshMe();
      setReady(true);
    })();
  }, [refreshMe]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setSignedIn(false);
      setMe(null);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const loadAuthConfig = useCallback(async () => {
    try {
      const c = await api.authConfig();
      setConfig(c);
      return c;
    } catch {
      return null;
    }
  }, []);

  // After a cookie sign-in, mint a device-scoped API key and switch to bearer auth:
  // per-device revocation for free, and no cookie/CSRF handling in native code.
  const mintDeviceKey = useCallback(async () => {
    try {
      const name = `${Platform.OS === "ios" ? "iPhone" : "Android"} · Agent Sandbox app`;
      const created = await api.createApiKey(name);
      await setBearer(created.token);
    } catch {
      // Cookie session still works (RN's native networking persists cookies).
    }
  }, []);

  const signInWithPassword = useCallback(
    async (url: string, login: string, password: string) => {
      await setServerUrl(url);
      await setBearer(null);
      await api.login(login, password);
      await mintDeviceKey();
      await refreshMe();
    },
    [mintDeviceKey, refreshMe],
  );

  const signUp = useCallback(
    async (url: string, u: { login: string; name: string; email: string; password: string }) => {
      await setServerUrl(url);
      await setBearer(null);
      await api.signup(u);
      await api.login(u.login, u.password);
      await mintDeviceKey();
      await refreshMe();
    },
    [mintDeviceKey, refreshMe],
  );

  const connectWithToken = useCallback(
    async (url: string, token: string) => {
      await setServerUrl(url);
      const clean = token.trim();
      const ok = await (async () => {
        try {
          return await api.verifyToken(clean);
        } catch {
          return false;
        }
      })();
      if (!ok) throw new Error("That token was not accepted by the server.");
      await setBearer(clean);
      await refreshMe();
    },
    [refreshMe],
  );

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* bearer-only sessions have nothing to log out */
    }
    await setBearer(null);
    setSignedIn(false);
    setMe(null);
  }, []);

  const value = useMemo(
    () => ({ ready, signedIn, me, config, refreshMe, loadAuthConfig, connectWithToken, signInWithPassword, signUp, signOut }),
    [ready, signedIn, me, config, refreshMe, loadAuthConfig, connectWithToken, signInWithPassword, signUp, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
