import React, { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { api, type AccountsResponse } from "@/lib/api";
import { useTheme } from "@/theme/ThemeContext";
import { SettingsScreen } from "@/components/SettingsScreen";
import { T } from "@/components/ui/AppText";
import { ArmButton } from "@/components/ui/ArmButton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";

/** GitHub accounts: device flow (great on mobile) or paste a PAT. */
export default function GithubAccounts() {
  const { palette } = useTheme();
  const [data, setData] = useState<AccountsResponse | null>(null);
  const [pat, setPat] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [device, setDevice] = useState<{ code: string; uri: string } | null>(null);
  const polling = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(() => {
    api.accounts().then(setData).catch((e) => setNote(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(() => {
    load();
    return () => {
      if (polling.current) clearInterval(polling.current);
    };
  }, [load]);

  const startDevice = async () => {
    setNote(null);
    try {
      const d = await api.deviceStart();
      setDevice({ code: d.user_code, uri: d.verification_uri });
      void WebBrowser.openBrowserAsync(d.verification_uri);
      polling.current = setInterval(async () => {
        try {
          const r = await api.devicePoll(d.device_code);
          if (r.status === "done") {
            if (polling.current) clearInterval(polling.current);
            setDevice(null);
            setNote(`Connected ${r.login}.`);
            load();
          } else if (r.status !== "pending") {
            if (polling.current) clearInterval(polling.current);
            setDevice(null);
            setNote(r.status === "error" ? r.message : `Device flow ${r.status}.`);
          }
        } catch {
          /* transient */
        }
      }, (d.interval || 5) * 1000);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
  };

  const addPat = async () => {
    setNote(null);
    try {
      const r = await api.addAccount(pat.trim());
      setNote(`Added ${r.added}.`);
      setPat("");
      load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <SettingsScreen title="GitHub accounts">
      {note ? <T variant="meta" tone="muted">{note}</T> : null}
      {data?.accounts.map((a) => (
        <Card key={a.login}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <T variant="body" weight="semibold" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
              {a.login}
            </T>
            {a.isDefault ? (
              <T variant="micro" tone="ok" weight="medium">
                default
              </T>
            ) : null}
          </View>
          <T variant="micro" mono tone="faint" style={{ marginTop: 2 }}>
            {a.type} · {a.tokenHint}
            {a.orgs.length ? ` · ${a.orgs.join(", ")}` : ""}
          </T>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
            {!a.isDefault && (
              <Button
                title="Make default"
                small
                variant="secondary"
                onPress={() => api.setDefaultAccount(a.login).then(load).catch((e) => setNote(String(e.message ?? e)))}
              />
            )}
            <ArmButton
              title="Remove"
              armedTitle="Tap again to remove"
              small
              onConfirm={async () => {
                await api.removeAccount(a.login);
                load();
              }}
            />
          </View>
        </Card>
      ))}
      {data && data.accounts.length === 0 && (
        <T variant="body" tone="muted">
          No GitHub account yet — the agent needs one to clone private repos and push.
        </T>
      )}
      {device ? (
        <Card>
          <T variant="body">Enter this code at {device.uri}:</T>
          <T variant="h1" mono selectable style={{ marginVertical: 8, letterSpacing: 2, color: palette.live }}>
            {device.code}
          </T>
          <T variant="micro" tone="faint">
            Waiting for GitHub…
          </T>
        </Card>
      ) : (
        data?.oauth !== false && <Button title="Sign in with GitHub (device flow)" onPress={startDevice} />
      )}
      <T variant="meta" weight="medium" tone="muted" style={{ marginTop: 8 }}>
        Or paste a personal access token
      </T>
      <Field placeholder="ghp_… or github_pat_…" value={pat} onChangeText={setPat} autoCapitalize="none" mono secureTextEntry />
      <Button title="Add token" variant="secondary" disabled={!pat.trim()} onPress={addPat} />
    </SettingsScreen>
  );
}
