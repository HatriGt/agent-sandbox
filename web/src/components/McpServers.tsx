import * as React from "react";
import { Braces, Check, Globe, Loader2, Plug, Plus, Terminal, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api, type McpServerView, type McpTransport } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Bar } from "@/components/thread/Skeletons";
import { cn } from "@/lib/utils";

/**
 * MCP servers for the sandbox agent. Every enabled server here is handed to `claude` inside each
 * sandbox on the next run or turn — the same JSON your IDE uses, stored once on your server.
 * Two ways in: a form, or "Paste JSON" that accepts `{"mcpServers": {...}}` from Claude Code,
 * Cursor, VS Code or Claude Desktop. Secrets (env / header values) come back masked.
 */
export function McpServers() {
  const [servers, setServers] = React.useState<McpServerView[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<"none" | "form" | "json">("none");

  const load = React.useCallback(() => {
    api
      .mcpServers()
      .then((r) => {
        setServers(r.servers);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  React.useEffect(load, [load]);

  const mutate = async (body: Record<string, unknown>, ok?: string) => {
    const r = await api.mcpMutate(body);
    setServers(r.servers);
    if (ok) toast.success(ok);
  };

  return (
    <section aria-labelledby="mcp">
      <header className="mb-5">
        <h2 id="mcp" className="text-foreground text-h2 font-semibold tracking-[-0.015em]">
          MCP servers
        </h2>
        <p className="text-muted-foreground mt-2 max-w-[68ch] text-body">
          Tools the agent can call inside every sandbox — Jira, Slack, a database, your internal APIs. Add a server here
          once and it is available on the next run or turn of every machine, so the agent never has to stop and ask for
          access it could have had. Same JSON your IDE speaks.
        </p>
      </header>

      {error && (
        <p role="alert" className="text-destructive mb-4 text-meta">
          {error}
        </p>
      )}

      {servers === null ? (
        <div className="flex flex-col gap-2">
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center gap-4 rounded-xl border px-4 py-3.5">
              <Bar className="size-9 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Bar className="h-3 w-40" />
                <Bar className="h-2.5 w-64" />
              </div>
              <Bar className="h-6 w-10 rounded-full" />
            </div>
          ))}
        </div>
      ) : servers.length === 0 && mode === "none" ? (
        <div className="rounded-xl border border-dashed px-6 py-10 text-center">
          <Plug className="text-muted-foreground mx-auto size-6" aria-hidden />
          <p className="text-foreground mt-3 text-lead font-medium">No MCP servers yet</p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-[48ch] text-meta">
            The agent has Bash, file tools, GitHub via <code className="font-mono">gh</code>, and web fetch. Anything else —
            Jira, Slack, databases — arrives as an MCP server.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {servers.map((s) => (
            <ServerRow key={s.name} server={s} onMutate={mutate} />
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant={mode === "form" ? "secondary" : "outline"} size="sm" onClick={() => setMode(mode === "form" ? "none" : "form")}>
          <Plus />
          Add a server
        </Button>
        <Button variant={mode === "json" ? "secondary" : "outline"} size="sm" onClick={() => setMode(mode === "json" ? "none" : "json")}>
          <Braces />
          Paste JSON
        </Button>
      </div>

      {mode === "form" && <ServerForm onDone={() => setMode("none")} onMutate={mutate} />}
      {mode === "json" && <JsonImport onDone={() => setMode("none")} onMutate={mutate} />}
    </section>
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
  const target = s.type === "stdio" ? [s.command, ...(s.args ?? [])].join(" ") : s.url;
  const secrets = [...Object.keys(s.env ?? {}), ...Object.keys(s.headers ?? {})];
  return (
    <li className={cn("bg-card flex flex-wrap items-center gap-4 rounded-xl border px-4 py-3.5", !s.enabled && "opacity-60")}>
      <span className="bg-muted text-foreground grid size-9 shrink-0 place-items-center rounded-lg">
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-foreground text-body font-medium">{s.name}</p>
          <span className="label text-muted-foreground">{s.type}</span>
          {!s.enabled && <span className="label text-muted-foreground">disabled</span>}
        </div>
        <p className="stamp text-muted-foreground mt-1 truncate" title={target}>
          {target}
        </p>
        {secrets.length > 0 && (
          <p className="text-muted-foreground mt-0.5 truncate text-micro">
            {s.env && Object.keys(s.env).length > 0 && <>env: {Object.entries(s.env).map(([k, v]) => `${k}=${v}`).join(" · ")}</>}
            {s.headers && Object.keys(s.headers).length > 0 && (
              <>
                {s.env && Object.keys(s.env).length > 0 && <span className="mx-1.5 opacity-40">·</span>}
                headers: {Object.keys(s.headers).join(", ")}
              </>
            )}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              role="switch"
              aria-checked={s.enabled}
              disabled={busy}
              onClick={() => run({ action: "toggle", name: s.name, enabled: !s.enabled })}
              className={cn("relative h-6 w-10 cursor-pointer rounded-full transition-colors", s.enabled ? "bg-live" : "bg-muted-foreground/30")}
              aria-label={s.enabled ? "Disable" : "Enable"}
            >
              <span className={cn("bg-card absolute top-0.5 size-5 rounded-full shadow-xs transition-[left]", s.enabled ? "left-[1.125rem]" : "left-0.5")} />
            </button>
          </TooltipTrigger>
          <TooltipContent>{s.enabled ? "Given to every new run and turn" : "Kept, but not given to the agent"}</TooltipContent>
        </Tooltip>
        {armed ? (
          <>
            <Button size="sm" variant="destructive" onClick={() => run({ action: "remove", name: s.name }, `Removed ${s.name}`)} disabled={busy}>
              <Trash2 />
              Confirm
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
      </div>
    </li>
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

function ServerForm({ onDone, onMutate }: { onDone: () => void; onMutate: (b: Record<string, unknown>, ok?: string) => Promise<void> }) {
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
      const parts = command.trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
      const clean = parts.map((p) => p.replace(/^["']|["']$/g, ""));
      await onMutate(
        {
          action: "upsert",
          server: {
            name: name.trim(),
            type,
            command: type === "stdio" ? clean[0] : undefined,
            args: type === "stdio" ? clean.slice(1) : undefined,
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

  const field = "text-foreground placeholder:text-muted-foreground bg-muted focus:ring-ring h-9 w-full rounded-md px-3 text-meta outline-none focus:ring-2";
  return (
    <div className="enter bg-card mt-3 rounded-xl border p-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <label className="flex flex-col gap-1">
          <span className="label text-muted-foreground">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="atlassian" className={cn(field, "font-mono")} />
        </label>
        <div className="flex flex-col gap-1">
          <span className="label text-muted-foreground">Transport</span>
          <div role="radiogroup" className="bg-muted inline-flex h-9 items-center gap-0.5 rounded-md p-0.5">
            {(["stdio", "http", "sse"] as McpTransport[]).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={type === t}
                onClick={() => setType(t)}
                className={cn("h-8 cursor-pointer rounded px-3 text-meta font-medium", type === t ? "bg-card text-foreground shadow-xs" : "text-muted-foreground")}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>
      {type === "stdio" ? (
        <label className="mt-3 flex flex-col gap-1">
          <span className="label text-muted-foreground">Command</span>
          <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx -y @modelcontextprotocol/server-postgres postgres://…" className={cn(field, "font-mono")} />
        </label>
      ) : (
        <label className="mt-3 flex flex-col gap-1">
          <span className="label text-muted-foreground">URL</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://mcp.example.com/mcp" className={cn(field, "font-mono")} />
        </label>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="label text-muted-foreground">Environment (KEY=value per line)</span>
          <textarea value={env} onChange={(e) => setEnv(e.target.value)} rows={3} placeholder={"JIRA_EMAIL=me@example.com\nJIRA_API_TOKEN=…"} className={cn(field, "h-auto resize-none py-2 font-mono")} />
        </label>
        {type !== "stdio" && (
          <label className="flex flex-col gap-1">
            <span className="label text-muted-foreground">Headers (Name=value per line)</span>
            <textarea value={headers} onChange={(e) => setHeaders(e.target.value)} rows={3} placeholder={"Authorization=Bearer …"} className={cn(field, "h-auto resize-none py-2 font-mono")} />
          </label>
        )}
      </div>
      {err && (
        <p className="text-destructive mt-2 text-micro" role="alert">
          {err}
        </p>
      )}
      <div className="mt-3 flex items-center gap-2">
        <Button onClick={() => void submit()} disabled={busy || !name.trim() || (type === "stdio" ? !command.trim() : !url.trim())}>
          {busy ? <Loader2 className="animate-spin" /> : <Check />}
          Save server
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <p className="text-muted-foreground ml-auto text-micro">Secrets are stored on your server, never shown again.</p>
      </div>
    </div>
  );
}

function JsonImport({ onDone, onMutate }: { onDone: () => void; onMutate: (b: Record<string, unknown>, ok?: string) => Promise<void> }) {
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
    <div className="enter bg-card mt-3 rounded-xl border p-4">
      <p className="text-muted-foreground text-meta">
        Paste the <code className="font-mono">mcpServers</code> block from Claude Code, Cursor, VS Code or Claude Desktop. Existing
        servers with the same name are replaced.
      </p>
      <textarea
        value={json}
        onChange={(e) => setJson(e.target.value)}
        rows={8}
        spellCheck={false}
        placeholder={'{\n  "mcpServers": {\n    "atlassian": {\n      "command": "npx",\n      "args": ["-y", "mcp-remote", "https://mcp.atlassian.com/v1/sse"]\n    }\n  }\n}'}
        className="text-foreground placeholder:text-muted-foreground/60 bg-muted focus:ring-ring mt-3 w-full resize-y rounded-md px-3 py-2 font-mono text-meta outline-none focus:ring-2"
      />
      {err && (
        <p className="text-destructive mt-2 text-micro" role="alert">
          {err}
        </p>
      )}
      <div className="mt-3 flex items-center gap-2">
        <Button onClick={() => void submit()} disabled={busy || !json.trim()}>
          {busy ? <Loader2 className="animate-spin" /> : <Braces />}
          Import
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
