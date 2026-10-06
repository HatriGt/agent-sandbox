import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { api, type AuditEventRow } from "@/lib/api";
import { describeEvent, eventKind, type AuditKind } from "@/lib/audit";
import { ago } from "@/lib/format";
import { useTheme } from "@/theme/ThemeContext";
import { SettingsScreen } from "@/components/SettingsScreen";
import { T } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Segmented } from "@/components/settings/Segmented";

const PAGE = 25;
type Filter = "all" | AuditKind | "failed";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "machines", label: "Machines" },
  { value: "code", label: "Code" },
  { value: "account", label: "Account" },
  { value: "failed", label: "Failed" },
];
const clock = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
const day = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
function dayKey(ms: number) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function dayLabel(ms: number) {
  const k = dayKey(ms);
  if (k === dayKey(Date.now())) return "Today";
  if (k === dayKey(Date.now() - 86400_000)) return "Yesterday";
  return day.format(ms);
}

/** Web AuditLog "Recent activity": a dense day-grouped timeline with filter chips and paging. */
export default function Audit() {
  const router = useRouter();
  const { palette } = useTheme();
  const [rows, setRows] = useState<AuditEventRow[] | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

  // Cursor is (at, id): `at` is not unique across a burst, so paging on it alone would drop rows.
  const load = useCallback(async (cursor?: { at: string; id: number }) => {
    setBusy(true);
    try {
      const r = await api.audit({ limit: PAGE, before: cursor?.at, beforeId: cursor?.id });
      setRows((prev) => [...(cursor ? (prev ?? []) : []), ...r.events]);
      if (r.events.length < PAGE) setDone(true);
    } catch {
      setRows((prev) => prev ?? []);
      setDone(true);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => void load(), [load]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, machines: 0, code: 0, account: 0, failed: 0 };
    for (const e of rows ?? []) {
      c.all++;
      c[eventKind(e)]++;
      if (e.status >= 400) c.failed++;
    }
    return c;
  }, [rows]);
  const visible = (rows ?? []).filter((e) => (filter === "all" ? true : filter === "failed" ? e.status >= 400 : eventKind(e) === filter));
  const more = () => {
    const last = rows?.[rows.length - 1];
    if (last) void load({ at: last.at, id: last.id });
  };

  return (
    <SettingsScreen title="Recent activity">
      <T variant="meta" tone="muted">
        kept 90 days · Every state-changing call made as you — from this console, an IDE or a script.
      </T>
      {rows && rows.length > 0 ? (
        <Segmented
          small
          value={filter}
          onChange={setFilter}
          options={FILTERS.filter((f) => f.value === "all" || counts[f.value] > 0 || f.value === filter).map((f) => ({ value: f.value, label: `${f.label} ${counts[f.value]}` }))}
        />
      ) : null}
      {rows === null ? (
        <T tone="muted">Loading…</T>
      ) : rows.length === 0 ? (
        <Card style={{ gap: 4 }}>
          <T variant="body" weight="medium">Nothing yet</T>
          <T variant="meta" tone="muted">Starting, answering, destroying — each action lands here with its time.</T>
        </Card>
      ) : visible.length === 0 ? (
        <Card style={{ gap: 4 }}>
          <T variant="body" weight="medium">{`No ${filter} events loaded`}</T>
          <T variant="meta" tone="muted">{done ? "There are none in the last 90 days." : "Load more to look further back."}</T>
        </Card>
      ) : (
        <View>
          {visible.map((e, i) => {
            const d = describeEvent(e);
            const at = Date.parse(e.at);
            const failed = e.status >= 400;
            const kind = eventKind(e);
            const prev = visible[i - 1];
            const newDay = Number.isFinite(at) && (!prev || dayKey(Date.parse(prev.at)) !== dayKey(at));
            const dot = failed ? palette.destructive : kind === "machines" ? palette.live : kind === "code" ? palette.ok : palette.faint;
            return (
              <React.Fragment key={e.id}>
                {newDay ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingTop: i === 0 ? 4 : 12, paddingBottom: 4 }}>
                    <T variant="micro" tone="faint" weight="medium" style={{ width: 48, textAlign: "right" }}>
                      {dayLabel(at)}
                    </T>
                    <View style={{ flex: 1, height: 1, backgroundColor: palette.border }} />
                  </View>
                ) : null}
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 6 }}>
                  <T variant="micro" mono tone="faint" style={{ width: 48, textAlign: "right", marginTop: 2 }}>
                    {Number.isFinite(at) ? clock.format(at) : "—"}
                  </T>
                  <View style={{ width: 6, height: 6, borderRadius: 3, marginTop: 7, backgroundColor: dot }} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <T variant="meta" tone={failed ? "muted" : "default"} numberOfLines={2}>
                      {d.verb}
                      {d.session ? (
                        <>
                          {" "}
                          <T variant="meta" mono style={{ textDecorationLine: "underline" }} onPress={() => router.push(`/box/${encodeURIComponent(d.session!)}`)}>
                            {d.session}
                          </T>
                        </>
                      ) : null}
                      {failed ? <T variant="meta" tone="destructive">{` · failed ${e.status}`}</T> : null}
                    </T>
                    <T variant="micro" tone="faint">
                      {Number.isFinite(at) ? ago(at) : ""}
                    </T>
                  </View>
                </View>
              </React.Fragment>
            );
          })}
        </View>
      )}
      {rows !== null && rows.length > 0 && !done ? <Button title="Show more" variant="ghost" small loading={busy} onPress={more} /> : null}
    </SettingsScreen>
  );
}
