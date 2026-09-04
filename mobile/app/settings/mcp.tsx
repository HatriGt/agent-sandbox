import React, { useCallback, useEffect, useState } from "react";
import { Switch, View } from "react-native";
import { api, type McpServerView } from "@/lib/api";
import { useTheme } from "@/theme/ThemeContext";
import { SettingsScreen } from "@/components/SettingsScreen";
import { T } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

/** MCP servers the sandbox agent gets: list, enable/disable, health-test. */
export default function McpServers() {
  const { palette } = useTheme();
  const [servers, setServers] = useState<McpServerView[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  const load = useCallback(() => {
    api.mcpServers().then((r) => setServers(r.servers)).catch((e) => setNote(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(load, [load]);

  const toggle = async (s: McpServerView, enabled: boolean) => {
    try {
      const r = await api.mcpMutate({ action: "toggle", name: s.name, enabled });
      setServers(r.servers);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
  };

  const test = async (name: string) => {
    setTesting(name);
    setNote(null);
    try {
      const r = await api.mcpTest(name);
      setNote(r.ok ? `✓ ${name} answered the MCP handshake.` : `✕ ${name}: ${r.error ?? "failed"}`);
    } catch (e) {
      setNote(`✕ ${name}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTesting(null);
    }
  };

  return (
    <SettingsScreen title="MCP servers">
      <T variant="body" tone="muted">
        Extra tools every sandbox agent gets. Add or edit servers from the desktop dashboard; toggle and
        health-check them here.
      </T>
      {note ? <T variant="meta" tone="muted">{note}</T> : null}
      {servers === null ? (
        <T tone="muted">Loading…</T>
      ) : servers.length === 0 ? (
        <T tone="muted">No MCP servers configured.</T>
      ) : (
        servers.map((s) => (
          <Card key={s.name}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <T variant="body" weight="semibold" numberOfLines={1}>
                  {s.name}
                </T>
                <T variant="micro" mono tone="faint" numberOfLines={1}>
                  {s.type} · {s.url ?? s.command ?? ""}
                </T>
                {s.tokenExpired ? (
                  <T variant="micro" tone="destructive">
                    ✕ token expired
                  </T>
                ) : null}
              </View>
              <Switch value={s.enabled} onValueChange={(v) => toggle(s, v)} trackColor={{ true: palette.live }} />
            </View>
            <View style={{ marginTop: 8 }}>
              <Button title="Test connection" small variant="secondary" loading={testing === s.name} onPress={() => test(s.name)} />
            </View>
          </Card>
        ))
      )}
    </SettingsScreen>
  );
}
