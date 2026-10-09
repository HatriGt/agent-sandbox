import React, { useCallback, useEffect, useState } from "react";
import { Image, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as WebBrowser from "expo-web-browser";
import { api, type AccountView, type AccountsResponse } from "@/lib/api";
import { useTheme } from "@/theme/ThemeContext";
import { SettingsSection } from "@/components/ui/SettingsSection";
import { T } from "@/components/ui/AppText";
import { ArmButton } from "@/components/ui/ArmButton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { Segmented } from "@/components/settings/Segmented";
import { FadeIn, FadeInUp, stagger } from "@/components/motion";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** GitHub accounts (web: Accounts.tsx): avatar · login · default · masked token · orgs; "Add account" sheet. */
export function AccountsSection() {
  const [data, setData] = useState<AccountsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    api.accounts().then(setData).catch((e) => setError(msg(e)));
  }, []);
  const setAccounts = useCallback((accounts: AccountView[]) => setData((d) => ({ oauth: d?.oauth ?? false, accounts })), []);
  const accounts = data?.accounts ?? null;
  const oauth = data?.oauth ?? false;

  return (
    <SettingsSection title="GitHub accounts" meta="clone · read PRs · push">
      {error ? (
        <FadeIn style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
          <T variant="meta" tone="destructive" style={{ flex: 1 }}>
            {error}
          </T>
          <Button small variant="ghost" title="Dismiss" onPress={() => setError(null)} />
        </FadeIn>
      ) : null}
      {note ? (
        <T variant="meta" tone="muted">
          {note}
        </T>
      ) : null}
      {accounts === null && !error ? <T tone="muted">Loading…</T> : null}
      {accounts?.length === 0 ? (
        <Card style={{ alignItems: "center", gap: 4 }}>
          <T variant="meta" weight="medium">
            No account connected
          </T>
          <T variant="meta" tone="muted" style={{ textAlign: "center" }}>
            Sandboxes can only reach public repositories until you add one.
          </T>
          <Button small variant="outline" title="+ Add account" onPress={() => setAdding(true)} style={{ marginTop: 8 }} />
        </Card>
      ) : null}
      {accounts?.map((a, i) => (
        <FadeInUp key={a.login} delay={stagger(i)}>
          <AccountRow account={a} onChanged={setAccounts} onNote={setNote} />
        </FadeInUp>
      ))}
      {accounts && accounts.length > 0 ? (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <T variant="micro" tone="muted">
            {accounts.length} connected
          </T>
          <Button small variant="outline" title="+ Add account" onPress={() => setAdding(true)} />
        </View>
      ) : null}
      <Sheet visible={adding} onClose={() => setAdding(false)} title="Add a GitHub account">
        <T variant="meta" tone="muted" style={{ marginBottom: 12 }}>
          The token is verified with GitHub, stored on your server under its login, and never shown again.
        </T>
        {adding ? (
          <AddAccount
            oauth={oauth}
            onDone={(list, login) => {
              setAccounts(list);
              setNote(`Connected ${login}`);
              setAdding(false);
            }}
          />
        ) : null}
      </Sheet>
    </SettingsSection>
  );
}

function AccountRow({ account: a, onChanged, onNote }: { account: AccountView; onChanged: (l: AccountView[]) => void; onNote: (m: string) => void }) {
  const { palette } = useTheme();
  const [busy, setBusy] = useState(false);
  const makeDefault = async () => {
    setBusy(true);
    try {
      onChanged((await api.setDefaultAccount(a.login)).accounts);
    } catch (e) {
      onNote(`Could not update — ${msg(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Image source={{ uri: `https://github.com/${encodeURIComponent(a.login)}.png?size=64` }} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: palette.muted }} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <T variant="body" weight="medium" numberOfLines={1} style={{ flexShrink: 1 }}>
              {a.login}
            </T>
            {a.isDefault ? (
              <T variant="micro" tone="live" weight="semibold" accessibilityLabel="Default — used for task-only runs (no repository attached)">
                ★ default
              </T>
            ) : null}
          </View>
          <T variant="micro" mono tone="muted" numberOfLines={1}>
            🔒 {a.tokenHint} · {a.type === "fine-grained" ? "fine-grained" : a.type === "classic" ? "classic" : "token"}
            {a.orgs.length ? ` · ${a.orgs.join(", ")}` : ""}
          </T>
        </View>
      </View>
      {a.isDefault ? (
        <T variant="micro" tone="faint" style={{ marginTop: 6 }}>
          Used for task-only runs (no repository attached)
        </T>
      ) : null}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
        {!a.isDefault ? <Button small variant="ghost" title="Make default" loading={busy} onPress={() => void makeDefault()} /> : null}
        <ArmButton
          small
          variant="ghost"
          title={`Remove ${a.login}`}
          armedTitle="Remove"
          disabled={busy}
          onConfirm={async () => {
            try {
              onChanged((await api.removeAccount(a.login)).accounts);
              onNote(`Removed ${a.login}`);
            } catch (e) {
              onNote(`Could not update — ${msg(e)}`);
            }
          }}
        />
      </View>
      <T variant="micro" tone="faint" style={{ marginTop: 4 }}>
        Remove — sandboxes lose this account's access
      </T>
    </Card>
  );
}

function AddAccount({ oauth, onDone }: { oauth: boolean; onDone: (list: AccountView[], login: string) => void }) {
  const [mode, setMode] = useState<"oauth" | "pat">(oauth ? "oauth" : "pat");
  return (
    <View style={{ gap: 16, paddingBottom: 8 }}>
      {oauth ? (
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "oauth", label: "Sign in with GitHub" },
            { value: "pat", label: "Paste a token" },
          ]}
        />
      ) : null}
      {mode === "oauth" ? <DeviceFlow onDone={onDone} /> : <PatForm onDone={onDone} />}
      {!oauth ? (
        <T variant="micro" tone="muted">
          Prefer one-click sign-in? Set <T variant="micro" mono>GITHUB_OAUTH_CLIENT_ID</T> on the controller (a GitHub OAuth App with device flow; no secret needed).
        </T>
      ) : null}
    </View>
  );
}

function PatForm({ onDone }: { onDone: (list: AccountView[], login: string) => void }) {
  const { palette } = useTheme();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const add = async () => {
    const t = token.trim();
    if (!t || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.addAccount(t);
      onDone(r.accounts, r.added);
    } catch (e) {
      setErr(msg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: 10 }}>
      <Field label="Personal access token" autoFocus placeholder="ghp_… or github_pat_…" value={token} onChangeText={setToken} autoCapitalize="none" autoCorrect={false} mono secureTextEntry />
      <T variant="micro" tone="muted">
        Scopes: <T variant="micro" mono>repo</T>, <T variant="micro" mono>read:org</T>; add <T variant="micro" mono>workflow</T> to trigger Actions.{" "}
        <T variant="micro" style={{ color: palette.live }} onPress={() => void WebBrowser.openBrowserAsync("https://github.com/settings/tokens/new?scopes=repo,read:org,workflow&description=agent-sandbox")}>
          Create one ↗
        </T>
      </T>
      {err ? (
        <T variant="meta" tone="destructive">
          {err}
        </T>
      ) : null}
      <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
        <Button title={busy ? "Verifying…" : "Add account"} loading={busy} disabled={!token.trim()} onPress={() => void add()} />
      </View>
    </View>
  );
}

type Device =
  | { phase: "idle" }
  | { phase: "starting" }
  | { phase: "waiting"; code: string; uri: string; device: string; interval: number; expiresAt: number }
  | { phase: "failed"; message: string };

function DeviceFlow({ onDone }: { onDone: (list: AccountView[], login: string) => void }) {
  const { palette } = useTheme();
  const [state, setState] = useState<Device>({ phase: "idle" });
  const [copied, setCopied] = useState(false);
  const start = async () => {
    setState({ phase: "starting" });
    try {
      const r = await api.deviceStart();
      setState({ phase: "waiting", code: r.user_code, uri: r.verification_uri, device: r.device_code, interval: Math.max(5, r.interval), expiresAt: Date.now() + r.expires_in * 1000 });
    } catch (e) {
      setState({ phase: "failed", message: msg(e) });
    }
  };
  useEffect(() => {
    if (state.phase !== "waiting") return;
    let cancelled = false;
    let interval = state.interval;
    let timer: NodeJS.Timeout | number | undefined;
    const tick = async () => {
      if (cancelled) return;
      if (Date.now() > state.expiresAt) return setState({ phase: "failed", message: "The code expired. Start again." });
      try {
        const r = await api.devicePoll(state.device);
        if (cancelled) return;
        if (r.status === "done") return onDone(r.accounts, r.login);
        if (r.status === "expired") return setState({ phase: "failed", message: "The code expired. Start again." });
        if (r.status === "denied") return setState({ phase: "failed", message: "You declined the authorisation on GitHub." });
        if (r.status === "error") return setState({ phase: "failed", message: r.message });
        if ("interval" in r && r.interval) interval = r.interval;
      } catch {
        /* transient */
      }
      timer = setTimeout(tick, interval * 1000);
    };
    timer = setTimeout(tick, interval * 1000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [state, onDone]);

  const steps = ["Start", "Approve on GitHub", "Connected"];
  const active = state.phase === "waiting" ? 1 : 0;
  const failed = state.phase === "failed";
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }} accessibilityLabel="Progress">
        {steps.map((s, i) => (
          <View key={s} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: i < active ? palette.ok : i === active ? (failed ? palette.destructive : palette.live) : palette.border }} />
            <T variant="micro" tone={i === active ? "default" : "muted"} weight={i === active ? "medium" : "regular"}>
              {s}
            </T>
          </View>
        ))}
      </View>
      {state.phase === "waiting" ? (
        <View style={{ gap: 10 }}>
          <T variant="meta" tone="muted">
            Enter this code at{" "}
            <T variant="meta" weight="medium" style={{ color: palette.live }} onPress={() => void WebBrowser.openBrowserAsync(state.uri)}>
              {state.uri.replace(/^https?:\/\//, "")} ↗
            </T>
          </T>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <T variant="h2" mono selectable style={{ letterSpacing: 2 }}>
              {state.code}
            </T>
            <Button
              small
              variant="outline"
              title={copied ? "Copied" : "Copy"}
              onPress={() =>
                void Clipboard.setStringAsync(state.code).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1400);
                })
              }
            />
          </View>
          <T variant="micro" tone="muted" accessibilityRole="text">
            Waiting for approval on GitHub…
          </T>
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          <T variant="meta" tone="muted">
            A one-time code on github.com — nothing to paste.
          </T>
          <View style={{ flexDirection: "row" }}>
            <Button title="Sign in with GitHub" loading={state.phase === "starting"} onPress={() => void start()} />
          </View>
          {failed ? (
            <T variant="meta" tone="destructive">
              {state.message}
            </T>
          ) : null}
        </View>
      )}
    </View>
  );
}
