import React, { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { api, type Me } from "@/lib/api";
import { serverUrl } from "@/lib/config";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { SettingsScreen } from "@/components/SettingsScreen";
import { T } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/settings/Segmented";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Same clients, instructions and snippets as web Connect.tsx. */
const CLIENTS = [
  { id: "claude", label: "Claude Code", how: "Run in a terminal:", snippet: (u: string, k: string) => `claude mcp add --transport http agent-sandbox ${u} --header "Authorization: Bearer ${k}"` },
  { id: "cursor", label: "Cursor", how: "~/.cursor/mcp.json (or the project's .cursor/mcp.json):", snippet: (u: string, k: string) => JSON.stringify({ mcpServers: { "agent-sandbox": { url: u, headers: { Authorization: `Bearer ${k}` } } } }, null, 2) },
  { id: "vscode", label: "VS Code", how: ".vscode/mcp.json:", snippet: (u: string, k: string) => JSON.stringify({ servers: { "agent-sandbox": { type: "http", url: u, headers: { Authorization: `Bearer ${k}` } } } }, null, 2) },
  { id: "windsurf", label: "Windsurf", how: "~/.codeium/windsurf/mcp_config.json:", snippet: (u: string, k: string) => JSON.stringify({ mcpServers: { "agent-sandbox": { serverUrl: u, headers: { Authorization: `Bearer ${k}` } } } }, null, 2) },
  { id: "curl", label: "Any client / CI", how: "Plain HTTP with a bearer:", snippet: (u: string, k: string) => `curl -H "Authorization: Bearer ${k}" ${u.replace(/\/mcp$/, "")}/fleet.json` },
] as const;
type ClientId = (typeof CLIENTS)[number]["id"];

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  const { palette } = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
      <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: done ? palette.ok : palette.muted }}>
        <T variant="micro" weight="semibold" style={{ color: done ? "#ffffff" : palette.mutedForeground }}>
          {done ? "✓" : n}
        </T>
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 8 }}>
        <T variant="h3" weight="semibold">
          {title}
        </T>
        {children}
      </View>
    </View>
  );
}

/** Web Connect: mint a key, paste it into a client config, prove it works. */
export default function Connect() {
  const router = useRouter();
  const { palette } = useTheme();
  const mcpUrl = `${serverUrl()}/mcp`;
  const [key, setKey] = useState<string | null>(null);
  const [minting, setMinting] = useState(false);
  const [client, setClient] = useState<ClientId>(CLIENTS[0].id);
  const [copied, setCopied] = useState<string | null>(null);
  const [test, setTest] = useState<{ state: "idle" | "busy" | "ok" | "fail"; who?: Me | null }>({ state: "idle" });
  const [error, setError] = useState<string | null>(null);

  const mint = async () => {
    if (minting) return;
    setMinting(true);
    setError(null);
    try {
      const k = await api.createApiKey(`${CLIENTS.find((c) => c.id === client)?.label ?? "IDE"} · ${new Date().toLocaleDateString()}`);
      setKey(k.token);
      setTest({ state: "idle" });
    } catch (e) {
      setError(`Could not create a key: ${msg(e)}`);
    } finally {
      setMinting(false);
    }
  };
  const copy = async (what: string, text: string) => {
    await Clipboard.setStringAsync(text);
    setCopied(what);
    setTimeout(() => setCopied(null), 1600);
  };
  const runTest = async () => {
    if (!key) return;
    setTest({ state: "busy" });
    const who = await api.whoIs(key).catch(() => null);
    setTest({ state: who ? "ok" : "fail", who });
  };
  const c = CLIENTS.find((x) => x.id === client)!;
  const snippet = c.snippet(mcpUrl, key ?? "asb_…your key…");

  return (
    <SettingsScreen title="Connect your IDE">
      <T variant="meta" tone="muted">
        Your editor delegates tasks to machines through the MCP endpoint. This key identifies you; every machine it starts is yours alone.
      </T>
      {error ? <T variant="meta" tone="destructive">{error}</T> : null}

      <Step n={1} title="Your API key" done={!!key}>
        {key ? (
          <>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ flex: 1, minWidth: 0, backgroundColor: palette.muted, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 8 }}>
                <T variant="code" mono selectable numberOfLines={1}>
                  {key}
                </T>
              </View>
              <Button small variant="outline" title={copied === "key" ? "Copied" : "Copy"} onPress={() => void copy("key", key)} />
            </View>
            <T variant="micro" tone="muted">
              Shown once. It is already filled into the config below. Revoke it any time from Account.
            </T>
          </>
        ) : (
          <>
            <View style={{ flexDirection: "row" }}>
              <Button title={minting ? "Creating…" : "Create a key"} loading={minting} onPress={() => void mint()} />
            </View>
            <T variant="meta" tone="muted">
              One key per IDE is a good habit — revoke one without touching the others.
            </T>
          </>
        )}
      </Step>

      <Step n={2} title="Add the server to your editor" done={copied === "snippet"}>
        <Segmented small value={client} onChange={setClient} options={CLIENTS.map((x) => ({ value: x.id, label: x.label }))} />
        <T variant="meta" tone="muted">
          {c.how}
        </T>
        <View style={{ backgroundColor: palette.card, borderWidth: 1, borderColor: palette.border, borderRadius: radius.xl, padding: 12, gap: 8 }}>
          <T variant="code" mono selectable tone={key ? "default" : "muted"}>
            {snippet}
          </T>
          <View style={{ flexDirection: "row" }}>
            <Button small variant="outline" title={copied === "snippet" ? "Copied" : "Copy"} disabled={!key} onPress={() => void copy("snippet", snippet)} />
          </View>
        </View>
        <T variant="micro" tone="faint">
          Endpoint {mcpUrl} · header Authorization: Bearer &lt;key&gt;
        </T>
      </Step>

      <Step n={3} title="Test the connection" done={test.state === "ok"}>
        <View style={{ flexDirection: "row" }}>
          <Button
            variant="outline"
            title={test.state === "busy" ? "Testing…" : test.state === "ok" ? "Connected" : "Test connection"}
            loading={test.state === "busy"}
            disabled={!key}
            onPress={() => void runTest()}
          />
        </View>
        {test.state === "ok" && test.who?.kind === "user" ? (
          <T variant="meta" tone="ok">
            Recognised as {test.who.login} — your IDE will be too.
          </T>
        ) : null}
        {test.state === "fail" ? (
          <T variant="meta" tone="destructive">
            The key was refused.{" "}
            <T variant="meta" tone="destructive" style={{ textDecorationLine: "underline" }} onPress={() => void mint()}>
              Make a new one
            </T>
          </T>
        ) : null}
      </Step>

      <View style={{ flexDirection: "row", marginTop: 16 }}>
        <Button title="Done" onPress={() => router.back()} />
      </View>
    </SettingsScreen>
  );
}
