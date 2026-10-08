import * as React from "react";
import { KeyRound, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, type RepoSetupsResponse, type SecretMeta, type SecretsResponse } from "@/lib/api";
import { fmtAgo } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { ArmButton } from "@/components/ui/arm-button";
import { Swap } from "@/components/ui/swap";
import { Input, inputClass } from "@/components/ui/field";
import { ListEmpty, ListSkeleton } from "@/components/ui/list-state";
import { Panel, PanelFooter, SettingsSection } from "@/components/ui/settings";
import { DataTable, type Column } from "@/components/ui/data-table";
import { cn } from "@/lib/utils";

/** Matches src/secrets-store.ts SECRET_NAME_RE: an env-var name, as the agent will see it. */
const NAME_RE = /^[A-Z_][A-Z0-9_]{0,127}$/;

const MASK = "•••• •••• ••••";

const describe = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The secrets vault (src/secrets-store.ts): names and grants only — a value never comes back from
 * the server, so the table shows a mask where a value would be and every write replaces, never
 * reveals. A grant is where the name already lives: a harness's `secrets` list or a repo setup
 * profile's `envVars`; the controller injects the granted names a run is entitled to as env vars.
 */
export function SecretsSettings() {
  const [data, setData] = React.useState<SecretsResponse | null>(null);
  const [setups, setSetups] = React.useState<RepoSetupsResponse["profiles"] | null>(null);
  const [name, setName] = React.useState("");
  const [value, setValue] = React.useState("");
  const [repo, setRepo] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  // Which row is being replaced (its name) — an inline masked input swaps in for the actions.
  const [replacing, setReplacing] = React.useState<string | null>(null);
  const nameRef = React.useRef<HTMLInputElement>(null);

  const load = React.useCallback(() => api.secrets().then(setData).catch(() => setData({ secrets: [] })), []);
  React.useEffect(() => void load(), [load]);
  React.useEffect(() => {
    api
      .repoSetups()
      .then((r) => setSetups(r.profiles))
      .catch(() => setSetups([]));
  }, []);

  const trimmed = name.trim().toUpperCase();
  const nameOk = trimmed === "" || NAME_RE.test(trimmed);
  const exists = !!data?.secrets.some((s) => s.name === trimmed);

  const save = async () => {
    if (saving || !trimmed || !NAME_RE.test(trimmed) || !value) return;
    setSaving(true);
    try {
      const r = await api.saveSecret(trimmed, value, repo || undefined);
      setData(r);
      setName("");
      setValue("");
      setRepo("");
      toast.success(exists ? `Replaced ${trimmed}` : `Saved ${trimmed}`, { description: repo ? `Granted to ${repo}; runs on that repo get it as an env var.` : "Grant it to a harness or a repo so runs can use it." });
    } catch (e) {
      toast.error("Could not save the secret", { description: describe(e) });
    } finally {
      setSaving(false);
    }
  };

  const replace = async (s: SecretMeta, next: string) => {
    try {
      setData(await api.saveSecret(s.name, next));
      setReplacing(null);
      toast.success(`Replaced ${s.name}`, { description: "Runs that start from now on get the new value." });
    } catch (e) {
      toast.error("Could not replace", { description: describe(e) });
    }
  };

  const remove = async (s: SecretMeta) => {
    try {
      setData(await api.removeSecret(s.name));
      toast.success(`Removed ${s.name}`, { description: s.grantedTo.length ? "Its grants were dropped too." : undefined });
    } catch (e) {
      toast.error("Could not remove", { description: describe(e) });
    }
  };

  const columns = React.useMemo<Column<SecretMeta>[]>(
    () => [
      {
        id: "name",
        header: "Name",
        primary: true,
        sort: (s) => s.name,
        cell: (s) => (
          <span className="flex min-w-0 items-center gap-2.5">
            <KeyRound className="text-muted-foreground size-4 shrink-0" aria-hidden />
            <span className="truncate font-mono">{s.name}</span>
          </span>
        ),
      },
      { id: "value", header: "Value", width: "w-36", hideBelow: "sm", cell: () => <span className="stamp text-muted-foreground select-none">{MASK}</span> },
      {
        id: "granted",
        header: "Granted to",
        cell: (s) =>
          s.grantedTo.length === 0 ? (
            <span className="text-faint text-micro">not granted — no run gets it yet</span>
          ) : (
            <span className="flex min-w-0 flex-wrap gap-1">
              {s.grantedTo.map((g) => (
                <span key={`${g.kind}:${g.id}`} className={cn("inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-micro", g.kind === "repo" ? "font-mono" : "")} title={g.kind === "repo" ? "Repo setup profile" : "Harness"}>
                  <span className="text-faint select-none">{g.kind === "repo" ? "repo" : "harness"}</span>
                  <span className="text-foreground truncate">{g.label}</span>
                </span>
              ))}
            </span>
          ),
      },
      { id: "updated", header: "Updated", width: "w-28", hideBelow: "md", sort: (s) => s.updatedAt, cell: (s) => <span className="text-muted-foreground text-micro tabular-nums">{fmtAgo(s.updatedAt / 1000)}</span> },
    ],
    []
  );

  const rows = data?.secrets ?? [];
  const state = data === null ? "loading" : rows.length === 0 ? "empty" : "list";

  return (
    <SettingsSection id="secrets" title="Secrets" meta={data ? `${rows.length} stored` : undefined} purpose="Tokens and keys a run may need as environment variables. Stored encrypted; a value is never shown again — only replaced. Grant a name to a harness or a repo and every run there gets it.">
      <Panel>
        <Swap state={state}>
          {state === "loading" ? (
            <ListSkeleton rows={2} />
          ) : state === "empty" ? (
            <ListEmpty
              icon={KeyRound}
              title="No secrets yet"
              line="When a run stops on a missing DEPLOY_TOKEN or NPM_TOKEN, you can provide it once from the thread — or add it here ahead of time."
              action={
                <Button size="sm" variant="outline" onClick={() => nameRef.current?.focus()}>
                  <Plus />
                  Add your first secret
                </Button>
              }
            />
          ) : (
            <DataTable
              aria-label="Secrets"
              bordered={false}
              rows={rows}
              columns={columns}
              rowKey={(s) => s.name}
              search={rows.length > 8 ? { placeholder: "Search secrets", text: (s) => `${s.name} ${s.grantedTo.map((g) => g.label).join(" ")}` } : undefined}
              actions={(s) =>
                replacing === s.name ? (
                  <ReplaceInput name={s.name} onSubmit={(v) => replace(s, v)} onCancel={() => setReplacing(null)} />
                ) : (
                  <span className="flex items-center gap-1">
                    <Button size="xs" variant="ghost" onClick={() => setReplacing(s.name)} className="text-muted-foreground">
                      <RefreshCw className="size-3.5" />
                      Replace
                    </Button>
                    <ArmButton size="icon-sm" variant="ghost" icon={<Trash2 />} label={`Remove ${s.name}`} armedLabel="Remove?" onConfirm={() => remove(s)} className="text-muted-foreground hover:text-destructive" />
                  </span>
                )
              }
            />
          )}
        </Swap>
        <PanelFooter className="flex-wrap">
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void save()}
            placeholder="NAME — e.g. DEPLOY_TOKEN"
            aria-label="Secret name"
            aria-invalid={!nameOk || undefined}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            className={cn("placeholder:text-muted-foreground text-foreground h-8 w-44 min-w-0 rounded-md bg-transparent px-1 font-mono text-meta outline-none", !nameOk && "text-destructive")}
          />
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void save()}
            placeholder={exists ? "new value — replaces the stored one" : "value"}
            aria-label="Secret value"
            autoComplete="off"
            spellCheck={false}
            className="placeholder:text-muted-foreground text-foreground h-8 min-w-0 flex-1 basis-40 rounded-md bg-transparent px-1 font-mono text-meta outline-none"
          />
          <select value={repo} onChange={(e) => setRepo(e.target.value)} aria-label="Grant to repo" className={cn(inputClass, "h-8 w-auto max-w-[14rem] cursor-pointer px-2 text-micro")}>
            <option value="">No grant yet</option>
            {(setups ?? []).map((p) => (
              <option key={p.repo} value={p.repo}>
                grant to {p.repo}
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" onClick={() => void save()} loading={saving} disabled={!trimmed || !NAME_RE.test(trimmed) || !value}>
            <Plus />
            {exists ? "Replace" : "Add"}
          </Button>
        </PanelFooter>
      </Panel>
    </SettingsSection>
  );
}

/** The in-row Replace control: one masked input, Enter saves, Escape backs out. */
function ReplaceInput({ name, onSubmit, onCancel }: { name: string; onSubmit: (value: string) => Promise<void>; onCancel: () => void }) {
  const [v, setV] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const submit = async () => {
    if (!v || busy) return;
    setBusy(true);
    try {
      await onSubmit(v);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      <Input
        mono
        type="password"
        autoFocus
        autoComplete="off"
        spellCheck={false}
        aria-label={`New value for ${name}`}
        placeholder="new value"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void submit();
          if (e.key === "Escape") onCancel();
        }}
        className="h-7 w-44 text-micro"
      />
      <Button size="xs" variant="outline" onClick={() => void submit()} loading={busy} disabled={!v}>
        Save
      </Button>
      <Button size="xs" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </span>
  );
}
