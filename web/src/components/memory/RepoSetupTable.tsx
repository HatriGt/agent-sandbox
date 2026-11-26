import * as React from "react";
import { Loader2, Pencil, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { api, type RepoSetupProfile, type RepoSetupsResponse } from "@/lib/api";
import { fmtAgo } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { ArmButton } from "@/components/ui/arm-button";
import { DataTable, stopRow, type Column } from "@/components/ui/data-table";
import { SettingsSection } from "@/components/ui/settings";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Bar } from "@/components/thread/Skeletons";
import { Swap } from "@/components/ui/swap";
import { plural } from "@/components/memory/kinds";

/**
 * Repo setup (src/setup-profile.ts) as the Memory page's "Repo setup" view: what each repo
 * installs, builds and tests with, learned once — detected from its files on the first run,
 * confirmed by the agent, editable here. One single-line row per repo (Repo · Install · Build ·
 * Test · Lint · Runtimes · Env · Source · actions), the full text of a cell in its title, the
 * editor in a sheet. Later runs install before the agent starts and verify with the test command;
 * that happens even with memory off, so this view never dims with the notes. Env vars are names
 * only — their values live in Integrations › Secrets, granted by repo.
 */

export type RepoSetupRow = RepoSetupsResponse["profiles"][number];

const inputCls =
  "text-foreground placeholder:text-muted-foreground bg-muted focus:ring-ring h-8 rounded-md px-2.5 font-mono text-micro outline-none focus:ring-2";

/** One word per origin, for the Source cell; the long form is its title. */
const BY: Record<RepoSetupProfile["confirmedBy"], { short: string; long: string }> = {
  detected: { short: "detected", long: "Auto-detected from the repo's files; not yet confirmed by a run" },
  agent: { short: "agent confirmed", long: "Confirmed by the agent at the end of a run" },
  user: { short: "edited by you", long: "Edited here" },
};
const CMDS = ["install", "build", "test", "lint"] as const;

/** Repo and every command, for the page search. */
export const setupSearchText = (r: RepoSetupRow) =>
  `${r.repo} ${CMDS.map((k) => r.profile[k] ?? "").join(" ")} ${Object.entries(r.profile.runtimes).map(([k, v]) => `${k} ${v}`).join(" ")} ${r.profile.envVars.join(" ")} ${r.profile.notes ?? ""}`.toLowerCase();

function Mono({ text, faint }: { text?: string; faint?: boolean }) {
  return text ? (
    <span className={faint ? "text-muted-foreground block truncate font-mono text-micro" : "text-foreground block truncate font-mono text-micro"} title={text}>
      {text}
    </span>
  ) : (
    <span className="text-faint text-meta">—</span>
  );
}

export function RepoSetupView({
  data,
  error,
  filtering,
  rows,
  onChange,
}: {
  data: RepoSetupsResponse | null;
  error: string | null;
  /** The page's search is on: `rows` is the subset that matches. */
  filtering: boolean;
  rows: RepoSetupRow[];
  onChange: (r: RepoSetupsResponse) => void;
}) {
  const [editing, setEditing] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const shown = editing ? (data?.profiles.find((r) => r.repo === editing) ?? null) : null;
  const reset = async (repo: string) => {
    setBusy(repo);
    try {
      onChange(await api.resetRepoSetup(repo));
      toast.success(`${repo} will be re-detected on its next run`);
    } catch (e) {
      toast.error("Could not reset", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };
  const columns = React.useMemo<Column<RepoSetupRow>[]>(
    () => [
      {
        id: "repo",
        primary: true,
        header: "Repo",
        width: "w-72",
        fitMax: 280,
        sort: (r) => r.repo,
        cell: (r) => (
          <span className="text-foreground block truncate font-mono text-meta font-medium" title={r.repo}>
            {r.repo}
          </span>
        ),
      },
      { id: "install", header: "Install", width: "w-36", fitMax: 136, hideBelow: "md", sort: (r) => r.profile.install, cell: (r) => <Mono text={r.profile.install} /> },
      { id: "build", header: "Build", minFlex: 128, hideBelow: "lg", sort: (r) => r.profile.build, cell: (r) => <Mono text={r.profile.build} /> },
      { id: "test", header: "Test", width: "w-36", fitMax: 136, hideBelow: "sm", sort: (r) => r.profile.test, cell: (r) => <Mono text={r.profile.test} /> },
      { id: "lint", header: "Lint", width: "w-32", fitMax: 120, hideBelow: "lg", sort: (r) => r.profile.lint, cell: (r) => <Mono text={r.profile.lint} /> },
      {
        id: "runtimes",
        header: "Runtimes",
        width: "w-24",
        fitMax: 96,
        hideBelow: "md",
        sort: (r) => Object.entries(r.profile.runtimes).map(([k, v]) => `${k} ${v}`).join(", "),
        cell: (r) => <Mono faint text={Object.entries(r.profile.runtimes).map(([k, v]) => `${k} ${v}`).join(", ")} />,
      },
      {
        id: "env",
        header: "Env",
        width: "w-40",
        fitMax: 150,
        hideBelow: "lg",
        sort: (r) => r.profile.envVars.length,
        cell: (r) => {
          const vs = r.profile.envVars;
          return vs.length ? (
            <span className="text-muted-foreground block truncate font-mono text-micro" title={vs.join("\n")}>
              {vs[0]}
              {vs.length > 1 && <span className="text-faint"> +{vs.length - 1}</span>}
            </span>
          ) : (
            <span className="text-faint text-meta">—</span>
          );
        },
      },
      {
        id: "source",
        header: "Source",
        width: "w-36",
        fitMax: 140,
        hideBelow: "sm",
        sort: (r) => r.profile.confirmedBy,
        cell: (r) => (
          <span className="text-muted-foreground block truncate text-meta" title={[BY[r.profile.confirmedBy].long, r.profile.notes, `${fmtAgo(r.updatedAt / 1000)}`].filter(Boolean).join("\n")}>
            {BY[r.profile.confirmedBy].short}
          </span>
        ),
      },
    ],
    [],
  );
  return (
    <SettingsSection
      id="memory-setup"
      title="Repo setup"
      meta={data ? plural(data.profiles.length, "repo") : undefined}
      purpose="How each repo installs, builds and tests — detected on its first run, confirmed by the agent. Runs install before the agent starts and verify with the test command, memory on or off."
      stacked
    >
      <Swap state={!data ? (error ? "error" : "loading") : data.profiles.length === 0 ? "empty" : "list"}>
        {!data && error ? (
          <p role="alert" className="text-destructive text-meta">
            Could not load repo setups: {error}
          </p>
        ) : !data ? (
          <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading">
            <Bar className="h-12 w-full rounded-lg" />
          </div>
        ) : data.profiles.length === 0 ? (
          <p className="text-muted-foreground text-meta">No repos learned yet — the first run on a repo detects how it installs and tests.</p>
        ) : (
          <DataTable
            aria-label="Repo setup"
            rows={rows}
            columns={columns}
            rowKey={(r) => r.repo}
            onRowClick={(r) => setEditing(r.repo)}
            rowLabel={(r) => `Edit setup for ${r.repo}`}
            initialSort={{ id: "repo", dir: "asc" }}
            empty={filtering ? "No repo setup matches." : undefined}
            actions={(r) => (
              <span className="inline-flex items-center justify-end gap-1.5" onClick={stopRow} onKeyDown={stopRow}>
                <Button size="sm" variant="ghost" className="h-8 px-2.5" onClick={() => setEditing(r.repo)} disabled={busy === r.repo} aria-label={`Edit setup for ${r.repo}`} title="Edit">
                  <Pencil className="size-3.5" />
                </Button>
                <ArmButton size="icon-xs" variant="ghost" icon={<RotateCcw className="size-3.5" />} label={`Reset setup for ${r.repo}`} armedLabel="Forget and re-detect?" onConfirm={() => void reset(r.repo)} disabled={busy === r.repo} />
              </span>
            )}
          />
        )}
      </Swap>

      <Sheet open={!!shown} onOpenChange={(o) => !o && setEditing(null)}>
        {shown && (
          <SheetContent title={shown.repo} description={[BY[shown.profile.confirmedBy].long, shown.profile.notes].filter(Boolean).join(" · ")} className="w-[min(30rem,calc(100vw-1rem))]">
            <SetupForm
              key={shown.repo}
              repo={shown.repo}
              profile={shown.profile}
              onDone={() => setEditing(null)}
              onChange={(r) => {
                onChange(r);
                toast.success(`Setup for ${shown.repo} saved`);
              }}
            />
          </SheetContent>
        )}
      </Sheet>
    </SettingsSection>
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
  const field = (label: string, node: React.ReactNode) => (
    <label key={label} className="grid grid-cols-[4.5rem_1fr] items-center gap-2 text-micro">
      <span className="text-muted-foreground label">{label}</span>
      {node}
    </label>
  );
  return (
    <form onSubmit={(e) => void save(e)} className="flex flex-col gap-2.5">
      {CMDS.map((k) => field(k, <input value={cmds[k]} onChange={(e) => setCmds({ ...cmds, [k]: e.target.value })} spellCheck={false} className={inputCls} placeholder={k === "test" ? "npm test" : ""} />))}
      {field("runtimes", <input value={runtimes} onChange={(e) => setRuntimes(e.target.value)} spellCheck={false} className={inputCls} placeholder="node 20, python 3.12" />)}
      {field("env vars", <input value={env} onChange={(e) => setEnv(e.target.value)} spellCheck={false} className={inputCls} placeholder="DATABASE_URL, API_KEY" />)}
      {field("notes", <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />)}
      <p className="text-faint text-micro">Names only — never paste a secret value; values are granted by repo under Integrations › Secrets. The test command becomes the run's default verify check.</p>
      <div className="flex justify-end gap-2 pt-1">
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
