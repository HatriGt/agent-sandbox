import React, { useCallback, useEffect, useState } from "react";
import { Switch, View } from "react-native";
import { api, type SkillView } from "@/lib/api";
import { useTheme } from "@/theme/ThemeContext";
import { SettingsScreen } from "@/components/SettingsScreen";
import { T } from "@/components/ui/AppText";
import { Card } from "@/components/ui/Card";

/** Skills library: view + enable/disable (authoring stays on desktop). */
export default function Skills() {
  const { palette } = useTheme();
  const [skills, setSkills] = useState<SkillView[] | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => {
    api.skills().then((r) => setSkills(r.skills)).catch((e) => setNote(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(load, [load]);

  const toggle = async (s: SkillView, enabled: boolean) => {
    try {
      const r = await api.skillMutate({ action: "toggle", name: s.name, enabled });
      setSkills(r.skills);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <SettingsScreen title="Skills">
      <T variant="body" tone="muted">
        Reusable playbooks synced into every sandbox. Mention one in a task to make the agent follow it.
      </T>
      {note ? <T variant="meta" tone="destructive">{note}</T> : null}
      {skills === null ? (
        <T tone="muted">Loading…</T>
      ) : skills.length === 0 ? (
        <T tone="muted">No skills yet — add them from the desktop dashboard.</T>
      ) : (
        skills.map((s) => (
          <Card key={s.name}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <T variant="body" weight="semibold" mono numberOfLines={1}>
                  /{s.name}
                </T>
                <T variant="meta" tone="muted" numberOfLines={2} style={{ marginTop: 2 }}>
                  {s.description}
                </T>
              </View>
              <Switch value={s.enabled} onValueChange={(v) => toggle(s, v)} trackColor={{ true: palette.live }} />
            </View>
          </Card>
        ))
      )}
    </SettingsScreen>
  );
}
