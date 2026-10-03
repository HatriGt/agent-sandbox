import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { api, type AuditEventRow } from "@/lib/api";
import { describeEvent, eventKind, type AuditKind } from "@/lib/audit";
import { ago, friendlyName } from "@/lib/format";
import { useTheme } from "@/theme/ThemeContext";
import { SettingsScreen } from "@/components/SettingsScreen";
import { T } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/settings/Segmented";

const PAGE = 40;
type Filter = "all" | AuditKind | "failed";
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The stored audit trail, read-only: who did what, newest first. */
export default function Audit() {
  const { palette } = useTheme();
  const [rows, setRows] = useState<AuditEventRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    api
      .audit({ limit: PAGE })
      .then((r) => {
        setRows(r.events);
        setMore(r.events.length === PAGE);
      })
      .catch((e) => setError(msg(e)));
  }, []);

  const loadMore = async () => {
    const last = rows?.[rows.length - 1];
    if (!last) return;
    setLoading(true);
    try {
      const r = await api.audit({ limit: PAGE, before: last.at, beforeId: last.id });
      setRows((cur) => [...(cur ?? []), ...r.events]);
      setMore(r.events.length === PAGE);
    } catch (e) {
      setError(msg(e));
    } finally {
      setLoading(false);
    }
  };

  const shown = (rows ?? []).filter((e) => (filter === "all" ? true : filter === "failed" ? e.status >= 400 : eventKind(e) === filter));

  return (
    <SettingsScreen title="Audit log">
      <Segmented
        small
        value={filter}
        onChange={setFilter}
        options={[
          { value: "all", label: "All" },
          { value: "machines", label: "Machines" },
          { value: "code", label: "Code" },
          { value: "account", label: "Account" },
          { value: "failed", label: "Failed" },
        ]}
      />
      {error ? (
        <T variant="meta" tone="destructive">
          {error}
        </T>
      ) : null}
      {rows === null && !error ? <T tone="muted">Loading…</T> : null}
      {rows && shown.length === 0 ? <T tone="muted">Nothing here.</T> : null}
      <View>
        {shown.map((e) => {
          const { verb, session } = describeEvent(e);
          const failed = e.status >= 400;
          const kind = eventKind(e);
          const dot = failed ? palette.destructive : kind === "machines" ? palette.live : kind === "code" ? palette.ok : palette.faint;
          return (
            <View key={e.id} style={{ flexDirection: "row", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: palette.border }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, marginTop: 7, backgroundColor: dot }} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <T variant="body" numberOfLines={2}>
                  {verb}
                  {session ? ` ${friendlyName(session)}` : ""}
                </T>
                <T variant="micro" tone={failed ? "destructive" : "faint"} numberOfLines={1}>
                  {ago(Date.parse(e.at))}
                  {e.client ? ` · ${e.client}` : ""}
                  {failed ? ` · failed (${e.status})` : ""}
                </T>
              </View>
            </View>
          );
        })}
      </View>
      {more ? <Button title="Load more" variant="ghost" loading={loading} onPress={() => void loadMore()} /> : null}
    </SettingsScreen>
  );
}
