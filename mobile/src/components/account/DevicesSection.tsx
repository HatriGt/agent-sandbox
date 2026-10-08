import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { api, type SessionRow } from "@/lib/api";
import { ago } from "@/lib/format";
import { useTheme } from "@/theme/ThemeContext";
import { radius } from "@/theme/tokens";
import { AcctSection } from "@/components/settings/AcctSections";
import { T } from "@/components/ui/AppText";
import { ArmButton } from "@/components/ui/ArmButton";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Same UA → "Browser · OS" reading as web Sessions.describe. */
function describe(ua: string | null): { label: string; mobile: boolean } {
  const s = ua ?? "";
  const mobile = /Mobile|iPhone|Android/i.test(s);
  const browser = /Edg\//.test(s) ? "Edge" : /OPR\//.test(s) ? "Opera" : /Chrome\//.test(s) ? "Chrome" : /Safari\//.test(s) ? "Safari" : /Firefox\//.test(s) ? "Firefox" : "Browser";
  const os = /iPhone|iPad/.test(s) ? "iOS" : /Android/.test(s) ? "Android" : /Mac OS X/.test(s) ? "macOS" : /Windows/.test(s) ? "Windows" : /Linux/.test(s) ? "Linux" : "";
  return { label: [browser, os].filter(Boolean).join(" · "), mobile };
}

/** Web Sessions: where you are signed in; sign one out without changing your password. */
export function DevicesSection() {
  const { palette } = useTheme();
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "destructive"; text: string } | null>(null);

  const load = useCallback(() => {
    api.sessions().then((r) => setRows(r.sessions)).catch(() => setRows([]));
  }, []);
  useEffect(load, [load]);

  const revoke = async (s: SessionRow) => {
    setNote(null);
    try {
      await api.revokeSession(s.id);
      setRows((prev) => prev?.filter((x) => x.id !== s.id) ?? prev);
      setNote({ tone: "ok", text: "Device signed out" });
      load();
    } catch (e) {
      setNote({ tone: "destructive", text: `Could not sign that device out: ${msg(e)}` });
    }
  };
  const revokeOthers = async () => {
    setNote(null);
    try {
      const r = await api.revokeOtherSessions();
      setRows((prev) => prev?.filter((s) => s.current) ?? prev);
      setNote({ tone: "ok", text: `Signed out ${r.revoked} ${r.revoked === 1 ? "device" : "devices"}` });
      load();
    } catch (e) {
      setNote({ tone: "destructive", text: `Could not sign the other devices out: ${msg(e)}` });
    }
  };
  // This device first, then most recently active.
  const sorted = useMemo(
    () => (rows ?? []).slice().sort((a, b) => Number(b.current) - Number(a.current) || Date.parse(b.lastSeenAt ?? "") - Date.parse(a.lastSeenAt ?? "")),
    [rows],
  );
  const others = sorted.filter((s) => !s.current);

  return (
    <AcctSection title="Signed-in devices" meta={rows ? `${rows.length} · 30-day cap` : "30-day cap"} purpose="Browser sessions holding your account. Sign one out if you do not recognise it; your password stays.">
      {others.length > 0 ? (
        <ArmButton
          title="Sign out everywhere else"
          armedTitle={`Sign out ${others.length} ${others.length === 1 ? "device" : "devices"}?`}
          variant="ghost"
          onConfirm={revokeOthers}
        />
      ) : null}
      {note ? <T variant="meta" tone={note.tone}>{note.text}</T> : null}
      {rows === null ? (
        <T tone="muted">Loading…</T>
      ) : rows.length === 0 ? (
        <Card style={{ gap: 4 }}>
          <T variant="body" weight="medium">No browser sessions</T>
          <T variant="meta" tone="muted">You are signed in with an access token, so there is nothing to sign out here.</T>
        </Card>
      ) : (
        sorted.map((s) => {
          const d = describe(s.userAgent);
          const seen = s.lastSeenAt && Number.isFinite(Date.parse(s.lastSeenAt)) ? ago(Date.parse(s.lastSeenAt)) : null;
          return (
            <Card key={s.id}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: s.current ? `${palette.live}1a` : palette.muted }}>
                  <Icon name={d.mobile ? "smartphone" : "monitor"} size={14} color={s.current ? palette.live : palette.mutedForeground} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <T variant="meta" weight="medium" numberOfLines={1} style={{ flexShrink: 1 }}>
                      {d.label}
                    </T>
                    {s.current ? (
                      <View style={{ backgroundColor: `${palette.live}1a`, borderRadius: radius.pill, paddingHorizontal: 6 }}>
                        <T variant="micro" tone="live" weight="medium">this device</T>
                      </View>
                    ) : null}
                  </View>
                  <T variant="micro" tone="faint" numberOfLines={1}>
                    {[s.ip, seen ? `active ${seen}` : null].filter(Boolean).join(" · ") || "no activity yet"}
                  </T>
                </View>
                {!s.current ? <ArmButton title="Sign out" armedTitle="Sign out?" small onConfirm={() => revoke(s)} /> : null}
              </View>
            </Card>
          );
        })
      )}
    </AcctSection>
  );
}
