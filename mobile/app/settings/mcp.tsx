import React, { useCallback, useEffect, useState } from "react";
import { Pressable, Switch, View } from "react-native";
import { api, type McpProbe, type McpServerView } from "@/lib/api";
import { useTheme } from "@/theme/ThemeContext";
import { SettingsScreen } from "@/components/SettingsScreen";
import { T } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { McpServerSheet } from "@/components/settings/McpServerSheet";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** MCP servers every sandbox agent gets: add / edit / remove, enable/disable, health-test. */
export default function McpServers() {
  const { palette } = useTheme();
  const [servers, setServers] = useState<McpServerView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [probes, setProbes] = useState<Record<string, McpProbe | { error: string }>>({});
  const [sheet, setSheet] = useState<{ open: boolean; initial?: McpServerView }>({ open: false });

  const load = useCallback(() => {
    api.mcpServers().then((r) => setServers(r.servers)).catch((e) => setError(msg(e)));
  }, []);
  useEffect(load, [load]);

  const toggle = async (s: McpServerView, enabled: boolean) => {
    setError(null);
    setServers((cur) => (cur ?? []).map((x) => (x.name === s.name ? { ...x, enabled } : x))); // optimistic
    try {
      setServers((await api.mcpMutate({ action: "toggle", name: s.name, enabled })).servers);
    } catch (e) {
      setServers((cur) => (cur ?? []).map((x) => (x.name === s.name ? { ...x, enabled: !enabled } : x)));
      setError(msg(e));
    }
  };

  const test = async (name: string) => {
    setTesting(name);
    setError(null);
    try {
      const r = await api.mcpTest(name);
      setProbes((p) => ({ ...p, [name]: r }));
    } catch (e) {
      setProbes((p) => ({ ...p, [name]: { error: msg(e) } }));
    } finally {
      setTesting(null);
    }
  };

  const probeLine = (name: string) => {
    const r = probes[name];
    if (!r) return null;
    if ("error" in r)
      return (
        <T variant="micro" tone="destructive">
          ✕ {r.error}
        </T>
      );
    return (
      <T variant="micro" tone={r.ok ? "ok" : "destructive"} numberOfLines={3}>
        {r.ok ? `✓ Answered the MCP handshake${r.tools?.length ? ` · ${r.tools.length} ${r.tools.length === 1 ? "tool" : "tools"}` : ""}${r.detail ? ` — ${r.detail}` : ""}` : `✕ ${r.detail || "failed"}${r.status ? ` (HTTP ${r.status})` : ""}`}
      </T>
    );
  };

  return (
    <SettingsScreen title="MCP servers">
      <T variant="body" tone="muted">
        Extra tools every sandbox agent gets on its next run. Tap a server to edit it.
      </T>
      <View style={{ flexDirection: "row" }}>
        <Button small title="+ Add server" variant="secondary" onPress={() => setSheet({ open: true })} />
      </View>
      {error ? (
        <T variant="meta" tone="destructive">
          {error}
        </T>
      ) : null}
      {servers === null && !error ? (
        <T tone="muted">Loading…</T>
      ) : servers?.length === 0 ? (
        <T tone="muted">No MCP servers configured.</T>
      ) : (
        servers?.map((s) => (
          <Card key={s.name} onPress={() => setSheet({ open: true, initial: s })} style={!s.enabled ? { opacity: 0.75 } : undefined}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <T variant="body" weight="semibold" numberOfLines={1}>
                  {s.name}
                </T>
                <T variant="micro" mono tone="faint" numberOfLines={1}>
                  {s.type} · {s.url ?? [s.command ?? "", ...(s.args ?? [])].join(" ")}
                </T>
                {s.tokenExpired ? (
                  <T variant="micro" tone="destructive">
                    ✕ token expired
                  </T>
                ) : null}
              </View>
              <Switch value={s.enabled} onValueChange={(v) => void toggle(s, v)} trackColor={{ true: palette.live }} accessibilityLabel={`${s.name} ${s.enabled ? "on" : "off"}`} />
            </View>
            <View style={{ marginTop: 8, flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Button title="Test connection" small variant="secondary" loading={testing === s.name} onPress={() => void test(s.name)} />
              <View style={{ flex: 1 }} />
              <Pressable onPress={() => setSheet({ open: true, initial: s })} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Edit ${s.name}`}>
                <Icon name="edit-2" size={15} color={palette.mutedForeground} />
              </Pressable>
            </View>
            {probeLine(s.name) ? <View style={{ marginTop: 6 }}>{probeLine(s.name)}</View> : null}
          </Card>
        ))
      )}
      <McpServerSheet visible={sheet.open} initial={sheet.initial} onClose={() => setSheet((s) => ({ ...s, open: false }))} onSaved={(r) => setServers(r.servers)} />
    </SettingsScreen>
  );
}
