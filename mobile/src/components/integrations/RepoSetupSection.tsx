import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { api, type RepoSetupProfile, type RepoSetupsResponse } from "@/lib/api";
import { AcctSection } from "@/components/settings/AcctSections";
import { T } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";

/**
 * Repo setup (web: RepoSetup.tsx): what each repo installs, builds and tests with — detected on the
 * first run, confirmed by the agent, editable here. Env vars are names only, never values.
 */
const CMDS = ["install", "build", "test", "lint"] as const;
const BY: Record<RepoSetupProfile["confirmedBy"], string> = { detected: "auto-detected", agent: "confirmed by the agent", user: "edited by you" };
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function RepoSetupSection() {
  const [data, setData] = useState<RepoSetupsResponse | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    api.repoSetups().then(setData).catch(() => {});
  }, []);

  return (
    <AcctSection title="Repo setup" meta="learned once · install · test · verify">
      {note ? <T variant="meta" tone="muted">{note}</T> : null}
      {!data ? (
        <T tone="muted">Loading…</T>
      ) : data.profiles.length === 0 ? (
        <T variant="micro" tone="muted">
          No repos learned yet — the first run on a repo detects how it installs and tests.
        </T>
      ) : (
        data.profiles.map((r) => <SetupRow key={r.repo} repo={r.repo} profile={r.profile} onChange={setData} onNote={setNote} />)
      )}
    </AcctSection>
  );
}

function SetupRow({ repo, profile: p, onChange, onNote }: { repo: string; profile: RepoSetupProfile; onChange: (r: RepoSetupsResponse) => void; onNote: (m: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const reset = async () => {
    setBusy(true);
    try {
      onChange(await api.resetRepoSetup(repo));
      onNote(`${repo} will be re-detected on its next run`);
    } catch (e) {
      onNote(`Could not reset — ${msg(e)}`);
    } finally {
      setBusy(false);
    }
  };
  if (editing) return <SetupForm repo={repo} profile={p} onDone={() => setEditing(false)} onChange={onChange} onNote={onNote} />;
  const rt = Object.entries(p.runtimes);
  const line = (k: string, v: string) => (
    <T key={k} variant="micro" numberOfLines={1}>
      <T variant="micro" tone="muted">{`${k}  `}</T>
      <T variant="micro" mono>
        {v}
      </T>
    </T>
  );
  return (
    <Card>
      <T variant="meta" weight="medium" numberOfLines={1}>
        {repo}
      </T>
      <View style={{ marginTop: 4, gap: 2 }}>
        {CMDS.filter((k) => p[k]).map((k) => line(k, p[k] as string))}
        {rt.length > 0 ? line("runtimes", rt.map(([k, v]) => `${k} ${v}`).join(", ")) : null}
        {p.envVars.length > 0 ? line("env", p.envVars.join(", ")) : null}
      </View>
      {p.notes ? (
        <T variant="micro" tone="muted" style={{ marginTop: 4 }}>
          {p.notes}
        </T>
      ) : null}
      <T variant="micro" tone="faint" style={{ marginTop: 4 }}>
        {BY[p.confirmedBy]}
      </T>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
        <Button title="Edit" small variant="ghost" disabled={busy} onPress={() => setEditing(true)} />
        <Button title="Reset" small variant="ghost" loading={busy} onPress={() => void reset()} />
      </View>
      <T variant="micro" tone="faint">
        Reset forgets and re-detects on the next run.
      </T>
    </Card>
  );
}

function SetupForm({ repo, profile: p, onDone, onChange, onNote }: { repo: string; profile: RepoSetupProfile; onDone: () => void; onChange: (r: RepoSetupsResponse) => void; onNote: (m: string) => void }) {
  const [cmds, setCmds] = useState<Record<(typeof CMDS)[number], string>>({ install: p.install ?? "", build: p.build ?? "", test: p.test ?? "", lint: p.lint ?? "" });
  const [runtimes, setRuntimes] = useState(Object.entries(p.runtimes).map(([k, v]) => `${k} ${v}`).join(", "));
  const [env, setEnv] = useState(p.envVars.join(", "));
  const [notes, setNotes] = useState(p.notes ?? "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const rt: Record<string, string> = {};
      for (const part of runtimes.split(",")) {
        const [k, v] = part.trim().split(/\s+/);
        if (k && v) rt[k] = v;
      }
      const body: Partial<RepoSetupProfile> = {
        ...Object.fromEntries(CMDS.filter((k) => cmds[k].trim()).map((k) => [k, cmds[k].trim()])),
        runtimes: rt,
        envVars: env.split(/[,\s]+/).filter(Boolean),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      };
      onChange(await api.saveRepoSetup(repo, body));
      onDone();
    } catch (e) {
      onNote(`Could not save — ${msg(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <T variant="meta" weight="medium" numberOfLines={1}>
        {repo}
      </T>
      <View style={{ gap: 10, marginTop: 8 }}>
        {CMDS.map((k) => (
          <Field key={k} label={k} value={cmds[k]} onChangeText={(v) => setCmds({ ...cmds, [k]: v })} placeholder={k === "test" ? "npm test" : ""} autoCapitalize="none" autoCorrect={false} mono />
        ))}
        <Field label="runtimes" value={runtimes} onChangeText={setRuntimes} placeholder="node 20, python 3.12" autoCapitalize="none" autoCorrect={false} mono />
        <Field label="env vars" value={env} onChangeText={setEnv} placeholder="DATABASE_URL, API_KEY" autoCapitalize="characters" autoCorrect={false} mono />
        <Field label="notes" value={notes} onChangeText={setNotes} />
        <T variant="micro" tone="faint">
          Names only — never paste a secret value. The test command becomes the run's default verify check.
        </T>
        <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
          <Button title="Cancel" small variant="ghost" onPress={onDone} />
          <Button title="Save" small loading={busy} onPress={() => void save()} />
        </View>
      </View>
    </Card>
  );
}
