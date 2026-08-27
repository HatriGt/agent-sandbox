import * as React from "react";
import { Braces, Check, Globe, Loader2, Plug, Plus, Terminal, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api, type McpServerView, type McpTransport } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Bar } from "@/components/thread/Skeletons";
import { cn } from "@/lib/utils";

/**
 * MCP servers as a compact list — transport glyph · name · target · secret keys — with an on/off
 * switch and remove on each row. "Add server" opens one dialog with two tabs: a form, or the
 * `mcpServers` JSON any agentic IDE exports. Hints sit under the fields they explain.
 */
export function McpServers() {
  const [servers, setServers] = React.useState<McpServerView[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);

  React.useEffect(() => {
    api
      .mcpServers()
      .then((r) => setServers(r.servers))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const mutate = async (body: Record<string, unknown>, ok?: string) => {
    const r = await api.mcpMutate(body);
    setServers(r.servers);
    if (ok) toast.success(ok);
  };

  const enabled = servers?.filter((s) => s.enabled).length ?? 0;
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
            {[0, 1].map((i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Bar className="size-8 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Bar className="h-3 w-28" />
                  <Bar className="h-2.5 w-64" />
                </div>
                <Bar className="h-5 w-9 rounded-full" />
              </div>
            ))}
          </div>
        ) : servers.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-10 text-center">
            <Plug className="text-muted-foreground size-6" aria-hidden />
            <p className="text-foreground mt-3 text-body font-medium">No MCP servers</p>
            <p className="text-muted-foreground mt-1 text-meta">The agent has shell, files, GitHub and web. Add Jira, Slack or a database here.</p>
          </div>
        ) : (
          <ul className="divide-y">
            {servers.map((s) => (
              <ServerRow key={s.name} server={s} onMutate={mutate} />
            ))}
          </ul>
        )}
        <div className="bg-muted/40 flex items-center justify-between gap-3 border-t px-4 py-2.5">
          <span className="text-muted-foreground text-micro">{servers?.length ? `${enabled} of ${servers.length} enabled · given to every new run and turn` : "Form, or paste your IDE's mcpServers JSON"}</span>
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus />
            Add server
          </Button>
        </div>
      </div>
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent title="Add an MCP server" description="Available to the agent inside every sandbox from its next run or turn. Secrets are stored on your server and never shown again.">
          <AddServer onMutate={mutate} onDone={() => setAdding(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ServerRow({ server: s, onMutate }: { server: McpServerView; onMutate: (b: Record<string, unknown>, ok?: string) => Promise<void> }) {
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
  const Icon = s.type === "stdio" ? Terminal : Globe;
  const target = s.type === "stdio" ? [s.command, ...(s.args ?? [])].join(" ") : s.url ?? "";
  const keys = [...Object.keys(s.env ?? {}), ...Object.keys(s.headers ?? {})];
  return (
    <li className={cn("flex items-center gap-3 px-4 py-3", !s.enabled && "opacity-60")}>
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", s.type === "stdio" ? "bg-[#89e051]/15 text-[#3f8f1a] dark:text-[#89e051]" : "bg-live/12 text-live")}>
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-foreground text-body font-medium">{s.name}</span>
          <span className="label text-muted-foreground">{s.type}</span>
        </div>
        <p className="stamp text-muted-foreground mt-0.5 truncate" title={target}>
          {target}
          {keys.length > 0 && (
            <>
              <span className="mx-1.5 opacity-40">·</span>
              <Lockish /> {keys.join(", ")}
            </>
          )}
        </p>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" role="switch" aria-checked={s.enabled} disabled={busy} onClick={() => run({ action: "toggle", name: s.name, enabled: !s.enabled })} className={cn("relative h-5 w-9 cursor-pointer rounded-full transition-colors", s.enabled ? "bg-live" : "bg-muted-foreground/30")} aria-label={s.enabled ? "Disable" : "Enable"}>
            <span className={cn("bg-card absolute top-0.5 size-4 rounded-full shadow-xs transition-[left]", s.enabled ? "left-[1.125rem]" : "left-0.5")} />
          </button>
        </TooltipTrigger>
        <TooltipContent>{s.enabled ? "On — given to every new run and turn" : "Off — kept, not given to the agent"}</TooltipContent>
      </Tooltip>
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
        <Button size="icon-sm" variant="ghost" onClick={() => setArmed(true)} aria-label={`Remove ${s.name}`}>
          <Trash2 />
        </Button>
      )}
    </li>
  );
}

function Lockish() {
  return <span aria-hidden>🔒</span>;
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

function ServerForm({ onMutate, onDone }: { onMutate: (b: Record<string, unknown>, ok?: string) => Promise<void>; onDone: () => void }) {
  const [name, setName] = React.useState("");
  const [type, setType] = React.useState<McpTransport>("stdio");
  const [command, setCommand] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [env, setEnv] = React.useState("");
  const [headers, setHeaders] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const parts = (command.trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []).map((p) => p.replace(/^["']|["']$/g, ""));
      await onMutate(
        {
          action: "upsert",
          server: {
            name: name.trim(),
            type,
            command: type === "stdio" ? parts[0] : undefined,
            args: type === "stdio" ? parts.slice(1) : undefined,
            url: type !== "stdio" ? url.trim() : undefined,
            env: kvParse(env),
            headers: type !== "stdio" ? kvParse(headers) : undefined,
            enabled: true,
          },
        },
        `Added ${name.trim()}`
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
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="atlassian" className={cn(field, "font-mono")} />
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
          <span className="text-muted-foreground text-micro">Runs inside the sandbox; arguments are split on spaces (quote to keep them together).</span>
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
          <textarea value={env} onChange={(e) => setEnv(e.target.value)} rows={3} placeholder={"JIRA_EMAIL=me@example.com\nJIRA_API_TOKEN=…"} className={cn(field, "h-auto resize-none py-2 font-mono")} />
          <span className="text-muted-foreground text-micro">One KEY=value per line.</span>
        </label>
        {type !== "stdio" && (
          <label className="flex flex-col gap-1.5">
            <span className="label text-muted-foreground">Headers</span>
            <textarea value={headers} onChange={(e) => setHeaders(e.target.value)} rows={3} placeholder={"Authorization=Bearer …"} className={cn(field, "h-auto resize-none py-2 font-mono")} />
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
          Save server
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
