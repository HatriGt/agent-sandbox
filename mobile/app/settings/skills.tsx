// Skills library: list + enable/disable, read a playbook's content, import from a GitHub repo.
// Authoring stays on the web.
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, Switch, View } from "react-native";
import { api, type SkillView } from "@/lib/api";
import { ago } from "@/lib/format";
import { useTheme } from "@/theme/ThemeContext";
import { SettingsScreen } from "@/components/SettingsScreen";
import { MarkdownLite } from "@/components/MarkdownLite";
import { T } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { Sheet } from "@/components/ui/Sheet";
import { listRepoSkills, loadRepoSkill, parseRepoInput, type RepoRef, type RepoSkillEntry } from "@/components/settings/skillImport";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function Skills() {
  const { palette } = useTheme();
  const [skills, setSkills] = useState<SkillView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const load = useCallback(() => {
    api.skills().then((r) => setSkills(r.skills)).catch((e) => setError(msg(e)));
  }, []);
  useEffect(load, [load]);

  const toggle = async (s: SkillView, enabled: boolean) => {
    setError(null);
    setSkills((cur) => (cur ?? []).map((x) => (x.name === s.name ? { ...x, enabled } : x)));
    try {
      setSkills((await api.skillMutate({ action: "toggle", name: s.name, enabled })).skills);
    } catch (e) {
      setSkills((cur) => (cur ?? []).map((x) => (x.name === s.name ? { ...x, enabled: !enabled } : x)));
      setError(msg(e));
    }
  };

  const shown = skills?.find((s) => s.name === viewing) ?? null;

  return (
    <SettingsScreen title="Skills">
      <T variant="body" tone="muted">
        Reusable playbooks synced into every sandbox. Mention one in a task to make the agent follow it. Tap one to read it.
      </T>
      <View style={{ flexDirection: "row" }}>
        <Button small variant="secondary" title="Import from GitHub" onPress={() => setImporting(true)} />
      </View>
      {error ? (
        <T variant="meta" tone="destructive">
          {error}
        </T>
      ) : null}
      {info ? (
        <T variant="meta" tone="muted">
          {info}
        </T>
      ) : null}
      {skills === null && !error ? (
        <T tone="muted">Loading…</T>
      ) : skills?.length === 0 ? (
        <T tone="muted">No skills yet — import some from a GitHub repo, or write one on the web.</T>
      ) : (
        skills?.map((s) => (
          <Card key={s.name} onPress={() => setViewing(s.name)} style={!s.enabled ? { opacity: 0.75 } : undefined}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <T variant="body" weight="semibold" mono numberOfLines={1}>
                  /{s.name}
                </T>
                <T variant="meta" tone="muted" numberOfLines={2} style={{ marginTop: 2 }}>
                  {s.description}
                </T>
              </View>
              <Switch value={s.enabled} onValueChange={(v) => void toggle(s, v)} trackColor={{ true: palette.live }} accessibilityLabel={`/${s.name} ${s.enabled ? "on" : "off"}`} />
            </View>
          </Card>
        ))
      )}

      <Sheet visible={shown !== null} onClose={() => setViewing(null)} title={shown ? `/${shown.name}` : ""}>
        {shown ? (
          <View style={{ gap: 12, paddingBottom: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <T variant="meta" tone="muted">
                  {shown.description}
                </T>
                <T variant="micro" tone="faint">
                  Updated {ago(shown.updatedAt)}
                </T>
              </View>
              <Switch value={shown.enabled} onValueChange={(v) => void toggle(shown, v)} trackColor={{ true: palette.live }} />
            </View>
            <MarkdownLite text={shown.content} />
          </View>
        ) : null}
      </Sheet>

      <ImportSheet
        visible={importing}
        existing={new Set((skills ?? []).map((s) => s.name))}
        onClose={() => setImporting(false)}
        onImported={(n, next) => {
          if (next) setSkills(next);
          else load();
          setInfo(n === 1 ? "Imported 1 skill." : `Imported ${n} skills.`);
        }}
      />
    </SettingsScreen>
  );
}

function ImportSheet({ visible, existing, onClose, onImported }: { visible: boolean; existing: Set<string>; onClose: () => void; onImported: (count: number, skills?: SkillView[]) => void }) {
  const { palette } = useTheme();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [found, setFound] = useState<{ ref: RepoRef; branch: string; entries: RepoSkillEntry[]; authed: boolean } | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setFound(null);
      setPicked({});
      setErr(null);
      setProgress(null);
    }
  }, [visible]);

  const browse = async () => {
    setErr(null);
    setFound(null);
    setPicked({});
    setLoading(true);
    try {
      const ref = parseRepoInput(input);
      const r = await listRepoSkills(ref);
      if (!r.entries.length) setErr("No skills here — the repo has no SKILL.md folders or skills/ markdown.");
      else {
        setFound({ ref, ...r });
        // Preselect everything that isn't already in the library.
        setPicked(Object.fromEntries(r.entries.filter((e) => !existing.has(e.name)).map((e) => [e.path, true])));
      }
    } catch (e) {
      setErr(msg(e));
    } finally {
      setLoading(false);
    }
  };

  const pickedCount = Object.values(picked).filter(Boolean).length;

  const doImport = async () => {
    if (!found || !pickedCount) return;
    setBusy(true);
    setErr(null);
    const entries = found.entries.filter((f) => picked[f.path]);
    let saved = 0;
    let last: SkillView[] | undefined;
    const failed: string[] = [];
    for (let i = 0; i < entries.length; i++) {
      const f = entries[i];
      setProgress(`Importing ${i + 1} of ${entries.length}: ${f.name}`);
      try {
        const d = await loadRepoSkill(found.ref, found.branch, f);
        const { skipped: _skipped, ...skill } = d;
        last = (await api.skillMutate({ action: "upsert", skill: { ...skill, enabled: true } })).skills;
        saved++;
      } catch (e) {
        failed.push(`/${f.name}: ${msg(e)}`);
      }
    }
    setProgress(null);
    setBusy(false);
    if (failed.length) setErr(failed.join("\n"));
    if (saved) onImported(saved, last);
    if (!failed.length) onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Import from GitHub">
      <View style={{ gap: 12, paddingBottom: 8 }}>
        <Field
          mono
          label="Repository"
          value={input}
          onChangeText={setInput}
          placeholder="anthropics/skills or https://github.com/…/tree/main/skills/foo"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          onSubmitEditing={() => void browse()}
          returnKeyType="search"
          hint="Every SKILL.md folder, plus loose markdown under skills/ or commands/. Private repos work when a saved GitHub token covers them."
        />
        <View style={{ flexDirection: "row" }}>
          <Button small title="Browse" variant="secondary" loading={loading} disabled={!input.trim()} onPress={() => void browse()} />
        </View>
        {err ? (
          <T variant="meta" tone="destructive">
            {err}
          </T>
        ) : null}
        {found ? (
          <>
            <T variant="micro" tone="faint">
              {found.ref.owner}/{found.ref.repo} @ {found.branch}
              {found.authed ? " · using your token" : ""} · {found.entries.length} found
            </T>
            {found.entries.map((e) => {
              const on = !!picked[e.path];
              const dup = existing.has(e.name);
              return (
                <Pressable
                  key={e.path}
                  onPress={() => setPicked((p) => ({ ...p, [e.path]: !on }))}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: palette.border, opacity: pressed ? 0.7 : 1 })}
                >
                  <View style={{ width: 20, height: 20, borderRadius: 6, borderWidth: 1, borderColor: on ? palette.foreground : palette.lineStrong, backgroundColor: on ? palette.foreground : "transparent", alignItems: "center", justifyContent: "center" }}>
                    {on ? <Icon name="check" size={13} color={palette.background} /> : null}
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <T variant="body" mono numberOfLines={1}>
                      /{e.name}
                      {dup ? (
                        <T variant="micro" tone="muted">
                          {"  "}replaces yours
                        </T>
                      ) : null}
                    </T>
                    <T variant="micro" tone="faint" numberOfLines={1}>
                      {e.path}
                      {e.kind === "dir" ? ` · ${e.fileCount} ${e.fileCount === 1 ? "file" : "files"}` : ""}
                    </T>
                  </View>
                </Pressable>
              );
            })}
            {progress ? (
              <T variant="micro" tone="muted">
                {progress}
              </T>
            ) : null}
            <Button title={pickedCount ? `Import ${pickedCount}` : "Import"} loading={busy} disabled={!pickedCount} onPress={() => void doImport()} />
          </>
        ) : null}
      </View>
    </Sheet>
  );
}
