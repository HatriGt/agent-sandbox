// Memory across runs (web: components/Memory.tsx). Two segments — You (preferences/rules the
// operator sets) and Knowledge (what each repo learned, grouped by repo then area). Read + the
// actions that matter: keep, pin, verify, delete, promote a playbook. The graph stays on web.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Switch, View } from "react-native";
import { useRouter } from "expo-router";
import { ApiError, api, type MemoryKind, type MemoryNote } from "@/lib/api";
import { useTheme } from "@/theme/ThemeContext";
import { SettingsScreen } from "@/components/SettingsScreen";
import { T } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { MemoryNoteRow, type NoteActions } from "@/components/settings/MemoryNoteRow";
import { Segmented } from "@/components/settings/Segmented";
import { KINDS, KIND_PLURAL, isOperatorKind } from "@/components/settings/memoryKinds";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
type Seg = "you" | "knowledge";

export default function MemoryPage() {
  const router = useRouter();
  const { palette } = useTheme();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [notes, setNotes] = useState<MemoryNote[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [seg, setSeg] = useState<Seg>("you");
  const [repo, setRepo] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);

  // Add composer (You only).
  const [addKind, setAddKind] = useState<Extract<MemoryKind, "preference" | "rule">>("preference");
  const [addText, setAddText] = useState("");
  const [adding, setAdding] = useState(false);

  const apply = (r: { enabled: boolean; notes: MemoryNote[] }) => {
    setEnabled(r.enabled);
    setNotes(r.notes);
  };
  const load = useCallback(async () => {
    try {
      apply(await api.memoryNotes());
      setError(null);
    } catch (e) {
      setError(msg(e));
    }
  }, []);
  useEffect(() => void load(), [load]);

  // Same partition as the web: live = not superseded; pending first (oldest first, closest to auto-keep).
  const view = useMemo(() => {
    const all = notes ?? [];
    const live = all.filter((n) => n.until == null);
    const sortLive = (xs: MemoryNote[]) =>
      [...xs].sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending") || Number(!!b.pinned) - Number(!!a.pinned) || b.at - a.at);
    const you = sortLive(live.filter((n) => isOperatorKind(n.kind)));
    const byRepo = new Map<string, MemoryNote[]>();
    for (const n of live) {
      if (isOperatorKind(n.kind)) continue;
      const k = n.repo ?? "";
      byRepo.set(k, [...(byRepo.get(k) ?? []), n]);
    }
    const repos = [...byRepo.keys()].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
    const pendingCount = live.filter((n) => n.status === "pending").length;
    return { you, byRepo, repos, pendingCount, sortLive };
  }, [notes]);

  const currentRepo = repo !== null && view.byRepo.has(repo) ? repo : (view.repos[0] ?? "");
  const repoNotes = view.sortLive(view.byRepo.get(currentRepo) ?? []);
  const areas = useMemo(() => {
    const m = new Map<string, MemoryNote[]>();
    for (const n of repoNotes) {
      const a = n.area ?? "";
      m.set(a, [...(m.get(a) ?? []), n]);
    }
    return [...m.entries()].sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
  }, [repoNotes]);

  const toggleEnabled = async (v: boolean) => {
    setToggling(true);
    setError(null);
    try {
      apply(await api.memoryNoteUpdate({ enabled: v }));
    } catch (e) {
      setError(msg(e));
    } finally {
      setToggling(false);
    }
  };

  const actions: NoteActions = {
    onKeep: async (n) => apply(await api.memoryNoteUpdate({ id: n.id, status: "kept" })),
    onPin: async (n, pinned) => apply(await api.memoryNoteUpdate({ id: n.id, pinned })),
    onVerify: async (n) => apply(await api.memoryNoteUpdate({ id: n.id, verified: true })),
    onDelete: async (n) => apply(await api.memoryNoteDelete(n.id)),
    onPromote: async (n) => {
      try {
        const r = await api.memoryPromote(n.id);
        setNotes(r.notes);
        setInfo(`Skill /${r.skill.name} ${r.enabled ? "created and enabled" : "created"}.`);
      } catch (e) {
        throw new Error(e instanceof ApiError && e.status === 409 ? "A skill with that name already exists." : msg(e));
      }
    },
  };

  const add = async () => {
    const text = addText.trim();
    if (!text) return;
    setAdding(true);
    setError(null);
    try {
      apply(await api.memoryNoteAdd({ kind: addKind, text }));
      setAddText("");
    } catch (e) {
      setError(msg(e));
    } finally {
      setAdding(false);
    }
  };

  const grouped = (xs: MemoryNote[]) => {
    const out: { kind: MemoryKind; notes: MemoryNote[] }[] = [];
    for (const k of KINDS) {
      const ns = xs.filter((n) => n.kind === k);
      if (ns.length) out.push({ kind: k, notes: ns });
    }
    return out;
  };

  return (
    <SettingsScreen title="Memory">
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <T variant="body" weight="semibold">
              Remember across runs
            </T>
            <T variant="micro" tone="faint">
              Preferences, rules and what each repo taught the agent are carried into the next run.
            </T>
          </View>
          <Switch value={!!enabled} disabled={enabled === null || toggling} onValueChange={(v) => void toggleEnabled(v)} trackColor={{ true: palette.live }} />
        </View>
      </Card>
      {error ? (
        <T variant="meta" tone="destructive">
          {error}
        </T>
      ) : null}
      {info ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <T variant="meta" tone="muted" style={{ flex: 1 }}>
            {info}
          </T>
          <Button small variant="ghost" title="Skills" onPress={() => router.push("/settings/skills")} />
        </View>
      ) : null}
      {view.pendingCount ? (
        <T variant="meta" weight="medium">
          {view.pendingCount === 1 ? "1 note is waiting for you" : `${view.pendingCount} notes are waiting for you`} — kept automatically after a while.
        </T>
      ) : null}

      <Segmented
        value={seg}
        onChange={setSeg}
        options={[
          { value: "you", label: `You${view.you.length ? ` · ${view.you.length}` : ""}` },
          { value: "knowledge", label: `Knowledge${view.repos.length ? ` · ${view.repos.length} ${view.repos.length === 1 ? "repo" : "repos"}` : ""}` },
        ]}
      />

      {notes === null && !error ? (
        <T variant="meta" tone="faint">
          Loading…
        </T>
      ) : null}

      {seg === "you" && notes !== null ? (
        <>
          <Card style={{ gap: 10 }}>
            <T variant="meta" weight="medium" tone="muted">
              Add
            </T>
            <Segmented
              small
              value={addKind}
              onChange={setAddKind}
              options={[
                { value: "preference", label: "Preference" },
                { value: "rule", label: "Rule" },
              ]}
            />
            <Field
              value={addText}
              onChangeText={setAddText}
              placeholder={addKind === "preference" ? "e.g. Prefer small, focused PRs" : "e.g. Never force-push to main"}
              multiline
              style={{ minHeight: 64, textAlignVertical: "top" }}
            />
            <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
              <Button small title="Save" loading={adding} disabled={!addText.trim()} onPress={() => void add()} />
            </View>
          </Card>
          {view.you.length === 0 ? (
            <T variant="meta" tone="muted">
              Nothing yet. Preferences shape how the agent works; rules are hard limits it never crosses.
            </T>
          ) : (
            grouped(view.you).map((g) => (
              <Card key={g.kind} style={{ paddingTop: 10 }}>
                <T variant="micro" weight="semibold" tone="muted" style={{ marginBottom: 2 }}>
                  {KIND_PLURAL[g.kind]}
                </T>
                {g.notes.map((n) => (
                  <MemoryNoteRow key={n.id} note={n} actions={actions} />
                ))}
              </Card>
            ))
          )}
        </>
      ) : null}

      {seg === "knowledge" && notes !== null ? (
        <>
          {view.repos.length > 1 ? (
            <Segmented small value={currentRepo} onChange={setRepo} options={view.repos.map((r) => ({ value: r, label: r || "any repo" }))} />
          ) : null}
          {view.repos.length === 0 ? (
            <T variant="meta" tone="muted">
              Nothing learned yet. Runs write down facts, decisions, lessons and playbooks per repo as they go.
            </T>
          ) : (
            areas.map(([area, ns]) => (
              <Card key={area || "__none"} style={{ paddingTop: 10 }}>
                <T variant="micro" weight="semibold" tone="muted" style={{ marginBottom: 2 }}>
                  {area || (areas.length > 1 ? "elsewhere" : currentRepo || "any repo")}
                  {` · ${ns.length}`}
                  {ns.some((n) => n.stale) ? ` · ${ns.filter((n) => n.stale).length} to verify` : ""}
                </T>
                {ns.map((n) => (
                  <MemoryNoteRow key={n.id} note={n} actions={actions} />
                ))}
              </Card>
            ))
          )}
        </>
      ) : null}
    </SettingsScreen>
  );
}
