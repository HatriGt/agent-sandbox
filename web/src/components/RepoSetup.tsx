import * as React from "react";
import { Loader2, Pencil, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { api, type RepoSetupProfile, type RepoSetupsResponse } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/components/ui/settings";
import { Bar } from "@/components/thread/Skeletons";
import { Swap } from "@/components/ui/swap";

/**
 * Repo setup (src/setup-profile.ts): what each repo installs, builds and tests with, learned once —
 * detected from its files on the first run, confirmed by the agent, editable here. Later runs
 * install before the agent starts and verify with the test command. Env vars are names only.
 */

const inputCls =
  "text-foreground placeholder:text-muted-foreground bg-muted focus:ring-ring h-8 rounded-md px-2.5 font-mono text-micro outline-none focus:ring-2";

const BY: Record<RepoSetupProfile["confirmedBy"], string> = { detected: "auto-detected", agent: "confirmed by the agent", user: "edited by you" };
const CMDS = ["install", "build", "test", "lint"] as const;

export function RepoSetup() {
  const [data, setData] = React.useState<RepoSetupsResponse | null>(null);
  React.useEffect(() => {
    const ctrl = new AbortController();
    api.repoSetups(ctrl.signal).then(setData).catch(() => {});
    return () => ctrl.abort();
  }, []);
  return (
    <SettingsSection id="repo-setup" title="Repo setup" meta="learned once · install · test · verify">
      <Swap state={!data ? "loading" : data.profiles.length === 0 ? "empty" : "list"}>
      {!data ? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading">
          <Bar className="h-12 w-full rounded-lg" />
        </div>
      ) : data.profiles.length === 0 ? (
        <p className="text-muted-foreground text-micro">No repos learned yet — the first run on a repo detects how it installs and tests.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {data.profiles.map((r) => (
            <SetupRow key={r.repo} repo={r.repo} profile={r.profile} onChange={setData} />
          ))}
        </div>
      )}
      </Swap>
    </SettingsSection>
  );
}

function SetupRow({ repo, profile: p, onChange }: { repo: string; profile: RepoSetupProfile; onChange: (r: RepoSetupsResponse) => void }) {
  const [editing, setEditing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const reset = async () => {
    setBusy(true);
    try {
      onChange(await api.resetRepoSetup(repo));
      toast.success(`${repo} will be re-detected on its next run`);
    } catch (e) {
      toast.error("Could not reset", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  if (editing) return <SetupForm repo={repo} profile={p} onDone={() => setEditing(false)} onChange={onChange} />;
  const rt = Object.entries(p.runtimes);
  return (
    <div className="border-border flex items-start gap-3 rounded-lg border p-3">
      <div className="min-w-0 flex-1">
        <div className="text-foreground text-meta font-medium">{repo}</div>
        <dl className="mt-1 grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-0.5 text-micro">
          {CMDS.filter((k) => p[k]).map((k) => (
            <React.Fragment key={k}>
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="text-foreground truncate font-mono">{p[k]}</dd>
            </React.Fragment>
          ))}
          {rt.length > 0 && (
            <>
              <dt className="text-muted-foreground">runtimes</dt>
              <dd className="text-foreground truncate font-mono">{rt.map(([k, v]) => `${k} ${v}`).join(", ")}</dd>
            </>
          )}
          {p.envVars.length > 0 && (
            <>
              <dt className="text-muted-foreground">env</dt>
              <dd className="text-foreground truncate font-mono">{p.envVars.join(", ")}</dd>
            </>
          )}
        </dl>
        {p.notes && <p className="text-muted-foreground mt-1 text-micro">{p.notes}</p>}
        <div className="text-faint mt-1 text-micro">{BY[p.confirmedBy]}</div>
      </div>
      <Button size="xs" variant="ghost" onClick={() => setEditing(true)} disabled={busy} aria-label={`Edit setup for ${repo}`}>
        <Pencil className="size-3.5" />
      </Button>
      <Button size="xs" variant="ghost" onClick={() => void reset()} disabled={busy} aria-label={`Reset setup for ${repo}`} title="Forget and re-detect on the next run">
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
      </Button>
    </div>
  );
}

function SetupForm({ repo, profile: p, onDone, onChange }: { repo: string; profile: RepoSetupProfile; onDone: () => void; onChange: (r: RepoSetupsResponse) => void }) {
  const [cmds, setCmds] = React.useState<Record<(typeof CMDS)[number], string>>({ install: p.install ?? "", build: p.build ?? "", test: p.test ?? "", lint: p.lint ?? "" });
  const [runtimes, setRuntimes] = React.useState(Object.entries(p.runtimes).map(([k, v]) => `${k} ${v}`).join(", "));
  const [env, setEnv] = React.useState(p.envVars.join(", "));
  const [notes, setNotes] = React.useState(p.notes ?? "");
  const [busy, setBusy] = React.useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
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
    } catch (err) {
      toast.error("Could not save", { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(e) => void save(e)} className="border-ring bg-card flex flex-col gap-2 rounded-lg border p-3">
      <div className="text-foreground text-meta font-medium">{repo}</div>
      {CMDS.map((k) => (
        <label key={k} className="grid grid-cols-[4.5rem_1fr] items-center gap-2 text-micro">
          <span className="text-muted-foreground">{k}</span>
          <input value={cmds[k]} onChange={(e) => setCmds({ ...cmds, [k]: e.target.value })} spellCheck={false} className={inputCls} placeholder={k === "test" ? "npm test" : ""} />
        </label>
      ))}
      <label className="grid grid-cols-[4.5rem_1fr] items-center gap-2 text-micro">
        <span className="text-muted-foreground">runtimes</span>
        <input value={runtimes} onChange={(e) => setRuntimes(e.target.value)} spellCheck={false} className={inputCls} placeholder="node 20, python 3.12" />
      </label>
      <label className="grid grid-cols-[4.5rem_1fr] items-center gap-2 text-micro">
        <span className="text-muted-foreground">env vars</span>
        <input value={env} onChange={(e) => setEnv(e.target.value)} spellCheck={false} className={inputCls} placeholder="DATABASE_URL, API_KEY" />
      </label>
      <label className="grid grid-cols-[4.5rem_1fr] items-center gap-2 text-micro">
        <span className="text-muted-foreground">notes</span>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
      </label>
      <span className="text-faint text-micro">Names only — never paste a secret value. The test command becomes the run's default verify check.</span>
      <div className="flex justify-end gap-2">
        <Button size="xs" variant="ghost" type="button" onClick={onDone}>
          Cancel
        </Button>
        <Button size="xs" type="submit" disabled={busy}>
          {busy && <Loader2 className="size-3.5 animate-spin" />} Save
        </Button>
      </div>
    </form>
  );
}
