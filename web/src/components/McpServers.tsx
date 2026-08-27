import * as React from "react";
import { Braces, Check, KeyRound, Loader2, Pencil, Plug, Plus, SearchX, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api, type McpServerView, type McpTransport } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Bar } from "@/components/thread/Skeletons";
import { BrandIcon } from "@/lib/brandIcon";
import { cn } from "@/lib/utils";

export type McpFilter = "all" | "enabled" | "disabled" | "stdio" | "remote";

/**
 * MCP servers as a dense table: brand tile · name (+ transport) · target · secret keys · on/off ·
 * edit · remove. The parent owns search and filter; this list reports its counts back up. Editing
 * opens the same form as adding, prefilled, and renaming moves the entry (secrets are kept unless
 * you type new ones — the masked values never round-trip).
 */
export function McpServers({ query = "", filter = "all", onCount }: { query?: string; filter?: McpFilter; onCount?: (total: number, enabled: number) => void }) {
  const [servers, setServers] = React.useState<McpServerView[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [dialog, setDialog] = React.useState<{ mode: "add" } | { mode: "edit"; server: McpServerView } | null>(null);

  React.useEffect(() => {
    api
      .mcpServers()
      .then((r) => setServers(r.servers))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  React.useEffect(() => {
    if (servers) onCount?.(servers.length, servers.filter((s) => s.enabled).length);
  }, [servers, onCount]);

  const mutate = async (body: Record<string, unknown>, ok?: string) => {
    const r = await api.mcpMutate(body);
    setServers(r.servers);
    if (ok) toast.success(ok);
  };

  const q = query.trim().toLowerCase();
  const visible = (servers ?? []).filter((s) => {
    if (filter === "enabled" && !s.enabled) return false;
    if (filter === "disabled" && s.enabled) return false;
    if (filter === "stdio" && s.type !== "stdio") return false;
    if (filter === "remote" && s.type === "stdio") return false;
    if (!q) return true;
    return [s.name, s.type, s.command, ...(s.args ?? []), s.url, ...Object.keys(s.env ?? {}), ...Object.keys(s.headers ?? {})].filter(Boolean).join(" ").toLowerCase().includes(q);
  });

  return (
    <div>
      <div className="bg-card overflow-hidden rounded-xl border">
        {error && (
          <p role="alert" className="text-destructive border-b px-4 py-3 text-meta">
            {error}
          </p>
        )}
        {servers === null ? (
          <div className="divide-y">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Bar className="size-9 rounded-lg" />
                <Bar className="h-3 w-24" />
                <Bar className="h-2.5 w-56" />
                <Bar className="ml-auto h-5 w-9 rounded-full" />
              </div>
            ))}
          </div>
        ) : servers.length === 0 ? (
          <Empty icon={<Plug className="size-5" />} title="No MCP servers yet" line="The agent already has shell, files, GitHub and the web. Add Jira, Slack, a database…" action={<Button size="sm" onClick={() => setDialog({ mode: "add" })}><Plus />Add server</Button>} />
        ) : visible.length === 0 ? (
          <Empty icon={<SearchX className="size-5" />} title="Nothing matches" line={q ? `No server matches “${query.trim()}”${filter !== "all" ? ` in ${filter}` : ""}.` : `No ${filter} servers.`} />
        ) : (
          <table className="w-full table-fixed border-collapse text-left">
            <thead className="sr-only">
              <tr>
                <th>Server</th>
                <th>Target</th>
                <th>Secrets</th>
                <th>Enabled</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {visible.map((s) => (
                <ServerRow key={s.name} server={s} onMutate={mutate} onEdit={() => setDialog({ mode: "edit", server: s })} />
              ))}
            </tbody>
          </table>
        )}
        {servers !== null && servers.length > 0 && (
          <div className="bg-muted/40 flex items-center justify-between gap-3 border-t px-4 py-2">
            <span className="text-muted-foreground text-micro">
              {visible.length === servers.length ? `${servers.length} server${servers.length === 1 ? "" : "s"}` : `${visible.length} of ${servers.length}`} · {servers.filter((s) => s.enabled).length} on
            </span>
            <Button size="sm" onClick={() => setDialog({ mode: "add" })}>
              <Plus />
              Add server
            </Button>
          </div>
        )}
      </div>

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        {dialog?.mode === "add" && (
          <DialogContent title="Add an MCP server" description="Available to the agent inside every sandbox from its next run or turn. Secrets stay on your server and are never shown again.">
            <AddServer onMutate={mutate} onDone={() => setDialog(null)} />
          </DialogContent>
        )}
        {dialog?.mode === "edit" && (
          <DialogContent title={`Edit ${dialog.server.name}`} description="Rename, change the command or URL, or replace secrets. Leave a secret field empty to keep the stored value.">
            <ServerForm initial={dialog.server} onMutate={mutate} onDone={() => setDialog(null)} />
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

function Empty({ icon, title, line, action }: { icon: React.ReactNode; title: string; line: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <span className="bg-muted text-muted-foreground grid size-10 place-items-center rounded-lg">{icon}</span>
      <p className="text-foreground mt-3 text-body font-medium">{title}</p>
      <p className="text-muted-foreground mt-1 max-w-sm text-meta">{line}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

function ServerRow({ server: s, onMutate, onEdit }: { server: McpServerView; onMutate: (b: Record<string, unknown>, ok?: string) => Promise<void>; onEdit: () => void }) {
  const [armed, setArmed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);
  const run = (b: Record<string, unknown>, ok?: string) => {
    setBusy(true);
    onMutate(b, ok)
      .catch((e: unknown) => toast.error("Could not update", { description: e instanceof Error ? e.message : String(e) }))
      .finally(() => {
        setBusy(false);
        setArmed(false);
      });
  };
  const target = s.type === "stdio" ? [s.command, ...(s.args ?? [])].join(" ") : s.url ?? "";
  const keys = [...Object.keys(s.env ?? {}), ...Object.keys(s.headers ?? {})];
  return (
    <tr className={cn("group transition-colors", !s.enabled && "text-muted-foreground")}>
      <td className="w-[42%] py-2.5 pl-3 pr-2 align-middle sm:w-[32%]">
        <div className="flex items-center gap-3">
          <BrandIcon hint={`${s.name} ${target}`} transport={s.type} className={cn(!s.enabled && "opacity-50 grayscale")} />
          <div className="min-w-0">
            <p className={cn("truncate text-body font-medium", s.enabled ? "text-foreground" : "text-muted-foreground")}>{s.name}</p>
            <p className="label text-muted-foreground whitespace-nowrap">{s.type === "stdio" ? "stdio · local" : `${s.type} · remote`}</p>
          </div>
        </div>
      </td>
      <td className="hidden py-2.5 pr-2 align-middle sm:table-cell">
        <p className="stamp text-muted-foreground truncate" title={target}>
          {target}
        </p>
      </td>
      <td className="hidden w-[18%] py-2.5 pr-2 align-middle md:table-cell">
        {keys.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="stamp text-muted-foreground inline-flex max-w-full items-center gap-1 truncate">
                <KeyRound className="size-3 shrink-0" aria-hidden />
                <span className="truncate">{keys.join(", ")}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent>Stored on the server, masked here</TooltipContent>
          </Tooltip>
        )}
      </td>
      <td className="w-14 py-2.5 pr-1 align-middle">
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" role="switch" aria-checked={s.enabled} disabled={busy} onClick={() => run({ action: "toggle", name: s.name, enabled: !s.enabled })} className={cn("relative h-5 w-9 cursor-pointer rounded-full transition-colors", s.enabled ? "bg-live" : "bg-muted-foreground/30")} aria-label={s.enabled ? "Disable" : "Enable"}>
              <span className={cn("bg-card absolute top-0.5 size-4 rounded-full shadow-xs transition-[left]", s.enabled ? "left-[1.125rem]" : "left-0.5")} />
            </button>
          </TooltipTrigger>
          <TooltipContent>{s.enabled ? "On — given to every new run and turn" : "Off — kept, not given to the agent"}</TooltipContent>
        </Tooltip>
      </td>
      <td className="w-[5.5rem] py-2.5 pr-2 align-middle">
        <div className="flex items-center justify-end gap-0.5">
          {armed ? (
            <>
              <Button size="sm" variant="destructive" onClick={() => run({ action: "remove", name: s.name }, `Removed ${s.name}`)} disabled={busy}>
                <Trash2 /> Remove
              </Button>
              <Button size="icon-sm" variant="ghost" onClick={() => setArmed(false)} aria-label="Cancel">
                <X />
              </Button>
            </>
          ) : (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon-sm" variant="ghost" onClick={onEdit} aria-label={`Edit ${s.name}`}>
                    <Pencil />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Edit or rename</TooltipContent>
              </Tooltip>
              <Button size="icon-sm" variant="ghost" onClick={() => setArmed(true)} aria-label={`Remove ${s.name}`}>
                <Trash2 />
              </Button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

function kvParse(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

function AddServer({ onMutate, onDone }: { onMutate: (b: Record<string, unknown>, ok?: string) => Promise<void>; onDone: () => void }) {
  const [tab, setTab] = React.useState<"form" | "json">("form");
  return (
    <div>
      <div role="tablist" className="bg-muted mb-5 inline-flex h-9 items-center gap-0.5 rounded-lg p-0.5">
        <Tab active={tab === "form"} onClick={() => setTab("form")} icon={<Plus className="size-3.5" />} label="Form" />
        <Tab active={tab === "json"} onClick={() => setTab("json")} icon={<Braces className="size-3.5" />} label="Paste JSON" />
      </div>
      {tab === "form" ? <ServerForm onMutate={onMutate} onDone={onDone} /> : <JsonImport onMutate={onMutate} onDone={onDone} />}
    </div>
  );
}

function Tab({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button type="button" role="tab" aria-selected={active} onClick={onClick} className={cn("flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-3 text-meta font-medium", active ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}>
      {icon}
      {label}
    </button>
  );
}

const field = "text-foreground placeholder:text-muted-foreground bg-muted focus:ring-ring h-10 w-full rounded-md px-3 text-meta outline-none focus:ring-2";

/** Add or edit. With `initial`, the form is prefilled and saves with `previousName` so renames move the entry. */
function ServerForm({ initial, onMutate, onDone }: { initial?: McpServerView; onMutate: (b: Record<string, unknown>, ok?: string) => Promise<void>; onDone: () => void }) {
  const [name, setName] = React.useState(initial?.name ?? "");
  const [type, setType] = React.useState<McpTransport>(initial?.type ?? "stdio");
  const [command, setCommand] = React.useState(initial ? [initial.command, ...(initial.args ?? [])].filter(Boolean).map((p) => (/\s/.test(p!) ? JSON.stringify(p) : p)).join(" ") : "");
  const [url, setUrl] = React.useState(initial?.url ?? "");
  const [env, setEnv] = React.useState("");
  const [headers, setHeaders] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const storedEnv = Object.keys(initial?.env ?? {});
  const storedHeaders = Object.keys(initial?.headers ?? {});
  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const parts = (command.trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []).map((p) => p.replace(/^["']|["']$/g, ""));
      const newEnv = kvParse(env);
      const newHeaders = kvParse(headers);
      await onMutate(
        {
          action: "upsert",
          previousName: initial?.name,
          server: {
            name: name.trim(),
            type,
            command: type === "stdio" ? parts[0] : undefined,
            args: type === "stdio" ? parts.slice(1) : undefined,
            url: type !== "stdio" ? url.trim() : undefined,
            // Empty → keep what is stored (masked values never round-trip); anything typed replaces it.
            env: Object.keys(newEnv).length || !initial ? newEnv : undefined,
            headers: type !== "stdio" ? (Object.keys(newHeaders).length || !initial ? newHeaders : undefined) : undefined,
            enabled: initial?.enabled ?? true,
          },
        },
        initial ? (initial.name !== name.trim() ? `Renamed to ${name.trim()}` : `Saved ${name.trim()}`) : `Added ${name.trim()}`
      );
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <label className="flex flex-col gap-1.5">
          <span className="label text-muted-foreground">Name</span>
          <div className="flex items-center gap-2.5">
            <BrandIcon hint={`${name} ${command} ${url}`} transport={type} className="size-10" />
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="atlassian" className={cn(field, "font-mono")} />
          </div>
        </label>
        <div className="flex flex-col gap-1.5">
          <span className="label text-muted-foreground">Transport</span>
          <div role="radiogroup" className="bg-muted inline-flex h-10 items-center gap-0.5 rounded-md p-0.5">
            {(["stdio", "http", "sse"] as McpTransport[]).map((t) => (
              <button key={t} type="button" role="radio" aria-checked={type === t} onClick={() => setType(t)} className={cn("h-9 cursor-pointer rounded px-3 text-meta font-medium", type === t ? "bg-card text-foreground shadow-xs" : "text-muted-foreground")}>
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>
      {type === "stdio" ? (
        <label className="flex flex-col gap-1.5">
          <span className="label text-muted-foreground">Command</span>
          <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx -y @modelcontextprotocol/server-postgres" className={cn(field, "font-mono")} />
          <span className="text-muted-foreground text-micro">Runs inside the sandbox; arguments split on spaces (quote to keep them together).</span>
        </label>
      ) : (
        <label className="flex flex-col gap-1.5">
          <span className="label text-muted-foreground">URL</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://mcp.example.com/mcp" className={cn(field, "font-mono")} />
        </label>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="label text-muted-foreground">Environment</span>
          <textarea value={env} onChange={(e) => setEnv(e.target.value)} rows={3} placeholder={storedEnv.length ? `Stored: ${storedEnv.join(", ")}\nType KEY=value to replace` : "JIRA_EMAIL=me@example.com\nJIRA_API_TOKEN=…"} className={cn(field, "h-auto resize-none py-2 font-mono")} />
          <span className="text-muted-foreground text-micro">One KEY=value per line.</span>
        </label>
        {type !== "stdio" && (
          <label className="flex flex-col gap-1.5">
            <span className="label text-muted-foreground">Headers</span>
            <textarea value={headers} onChange={(e) => setHeaders(e.target.value)} rows={3} placeholder={storedHeaders.length ? `Stored: ${storedHeaders.join(", ")}\nType Name=value to replace` : "Authorization=Bearer …"} className={cn(field, "h-auto resize-none py-2 font-mono")} />
            <span className="text-muted-foreground text-micro">One Name=value per line.</span>
          </label>
        )}
      </div>
      {err && (
        <p className="text-destructive text-meta" role="alert">
          {err}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" disabled={busy || !name.trim() || (type === "stdio" ? !command.trim() : !url.trim())}>
          {busy ? <Loader2 className="animate-spin" /> : <Check />}
          {initial ? "Save changes" : "Save server"}
        </Button>
      </div>
    </form>
  );
}

function JsonImport({ onMutate, onDone }: { onMutate: (b: Record<string, unknown>, ok?: string) => Promise<void>; onDone: () => void }) {
  const [json, setJson] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await onMutate({ action: "import", json }, "Imported");
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <textarea
        autoFocus
        value={json}
        onChange={(e) => setJson(e.target.value)}
        rows={9}
        spellCheck={false}
        placeholder={'{\n  "mcpServers": {\n    "atlassian": {\n      "command": "npx",\n      "args": ["-y", "mcp-remote", "https://mcp.atlassian.com/v1/sse"]\n    }\n  }\n}'}
        className="text-foreground placeholder:text-muted-foreground/60 bg-muted focus:ring-ring w-full resize-y rounded-md px-3 py-2 font-mono text-meta outline-none focus:ring-2"
      />
      <p className="text-muted-foreground text-micro">Accepts the `mcpServers` block from Claude Code, Cursor, VS Code or Claude Desktop. Same-name servers are replaced.</p>
      {err && (
        <p className="text-destructive text-meta" role="alert">
          {err}
        </p>
      )}
      <div className="flex justify-end">
        <Button onClick={() => void submit()} disabled={busy || !json.trim()}>
          {busy ? <Loader2 className="animate-spin" /> : <Braces />}
          Import
        </Button>
      </div>
    </div>
  );
}
