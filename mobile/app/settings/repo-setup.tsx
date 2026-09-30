import React, { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { api, type RepoSetupProfile } from "@/lib/api";
import { SettingsScreen } from "@/components/SettingsScreen";
import { T } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";

/**
 * Repo setup (src/setup-profile.ts): how each repo installs, builds and tests — detected on the
 * first run, confirmed by the agent, editable here. Env vars are names only, never values.
 */
const CMDS = ["install", "build", "test", "lint"] as const;
const BY: Record<RepoSetupProfile["confirmedBy"], string> = { detected: "auto-detected", agent: "confirmed by the agent", user: "edited by you" };

type Row = { repo: string; profile: RepoSetupProfile };

export default function RepoSetupScreen() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const load = useCallback(() => {
    api.repoSetups().then((r) => setRows(r.profiles)).catch((e) => setNote(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(load, [load]);

  const reset = async (repo: string) => {
    try {
      setRows((await api.resetRepoSetup(repo)).profiles);
      setNote(`${repo} will be re-detected on its next run.`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <SettingsScreen title="Repo setup">
      <T variant="body" tone="muted">
        Learned once per repo: runs install before the agent starts and verify with the test command.
      </T>
      {note ? <T variant="meta" tone="muted">{note}</T> : null}
      {rows === null ? (
        <T tone="muted">Loading…</T>
      ) : rows.length === 0 ? (
        <T tone="muted">No repos learned yet — the first run on a repo detects its setup.</T>
      ) : (
        rows.map((r) =>
          editing === r.repo ? (
            <SetupForm
              key={r.repo}
              row={r}
              onCancel={() => setEditing(null)}
              onSaved={(next) => {
                setRows(next);
                setEditing(null);
              }}
              onError={setNote}
            />
          ) : (
            <Card key={r.repo}>
              <T variant="body" weight="semibold" numberOfLines={1}>
                {r.repo}
              </T>
              {CMDS.filter((k) => r.profile[k]).map((k) => (
                <T key={k} variant="micro" numberOfLines={1}>
                  <T variant="micro" tone="muted">{k} </T>
                  <T variant="micro" mono>{r.profile[k]}</T>
                </T>
              ))}
              {Object.keys(r.profile.runtimes).length ? (
                <T variant="micro" mono tone="muted" numberOfLines={1}>
                  {Object.entries(r.profile.runtimes).map(([k, v]) => `${k} ${v}`).join(", ")}
                </T>
              ) : null}
              {r.profile.envVars.length ? (
                <T variant="micro" mono tone="muted" numberOfLines={2}>
                  env: {r.profile.envVars.join(", ")}
                </T>
              ) : null}
              <T variant="micro" tone="faint">{BY[r.profile.confirmedBy]}</T>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                <Button title="Edit" small variant="secondary" onPress={() => setEditing(r.repo)} />
                <Button title="Reset" small variant="secondary" onPress={() => reset(r.repo)} />
              </View>
            </Card>
          )
        )
      )}
    </SettingsScreen>
  );
}

function SetupForm({ row, onCancel, onSaved, onError }: { row: Row; onCancel: () => void; onSaved: (rows: Row[]) => void; onError: (m: string) => void }) {
  const p = row.profile;
  const [cmds, setCmds] = useState<Record<(typeof CMDS)[number], string>>({ install: p.install ?? "", build: p.build ?? "", test: p.test ?? "", lint: p.lint ?? "" });
  const [env, setEnv] = useState(p.envVars.join(", "));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const body: Partial<RepoSetupProfile> = {
        ...Object.fromEntries(CMDS.filter((k) => cmds[k].trim()).map((k) => [k, cmds[k].trim()])),
        runtimes: p.runtimes,
        envVars: env.split(/[,\s]+/).filter(Boolean),
        ...(p.notes ? { notes: p.notes } : {}),
      };
      onSaved((await api.saveRepoSetup(row.repo, body)).profiles);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <T variant="body" weight="semibold" numberOfLines={1}>
        {row.repo}
      </T>
      <View style={{ gap: 10, marginTop: 8 }}>
        {CMDS.map((k) => (
          <Field key={k} label={k} value={cmds[k]} onChangeText={(v) => setCmds({ ...cmds, [k]: v })} autoCapitalize="none" autoCorrect={false} mono />
        ))}
        <Field label="Env var names" hint="Names only — never a secret value." value={env} onChangeText={setEnv} autoCapitalize="characters" autoCorrect={false} mono />
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button title="Save" small loading={busy} onPress={save} />
          <Button title="Cancel" small variant="secondary" onPress={onCancel} />
        </View>
      </View>
    </Card>
  );
}
