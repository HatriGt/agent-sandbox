import * as React from "react";
import { Braces, Check, ClipboardPaste, Copy, List, Pencil, Plug, Plus, RotateCcw, Trash2, WandSparkles, X, Zap } from "lucide-react";
import { toast } from "sonner";
import { api, type McpServersResponse, type McpServerView } from "@/lib/api";
import { useCached } from "@/lib/cache";
import { Button } from "@/components/ui/button";
import { Collapse } from "@/components/ui/collapse";
import { Swap } from "@/components/ui/swap";
import { AnimatedTabs } from "@/components/ui/animated-tabs";
import { FilterChip } from "@/components/ui/filter-chip";
import { Sheet } from "@/components/ui/sheet";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Kbd } from "@/components/ui/kbd";
import { ArmButton } from "@/components/ui/arm-button";
import { Switch } from "@/components/ui/switch";
import { DataTable, MetaLine, StatusDot, type Column } from "@/components/ui/data-table";
import { Bar } from "@/components/thread/Skeletons";
import { JsonEditor, jsonErrorLine } from "@/components/JsonEditor";
import { BrandGlyph } from "@/lib/brandIcon";
import { fmtAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useTick, Verdict, type Mutate } from "@/components/mcp/Verdict";
import { ServerSheet } from "@/components/mcp/ServerSheet";
import { describe, errMsg, statusOf, type Health, type Status } from "@/components/mcp/model";

/**
 * MCP servers — the tools every sandbox agent gets.
 *
 *   List  — a DataTable: server (brand glyph, name, what it runs or where it connects), transport,
 *           a status that tells the truth (off · on · checking · connected · failed · token expired),
 *           tool count and last check. Test / edit / remove / on-off sit in the trailing actions cell;
 *           the row opens the editor. A test's verdict lands under the table as chips (tools) or a
 *           plain-language explanation with a fix.
 *   Sheet — add/edit as a guided form: transport picker with a sentence each, one command line
 *           parsed into tokens, secret-aware key·value rows, and a live "what the agent sees" JSON —
 *           or the same server as JSON. ⌘↵ saves, Esc closes.
 *   Paste — the `{"mcpServers": …}` blob an IDE exports, imported in one go.
 *   JSON  — the whole store as an editable file; saving replaces it. Masked secrets left alone survive.
 */
type View = "list" | "json";
type Filter = "all" | "on" | "off" | "stdio" | "remote";

export function McpServers() {
  const cached = useCached("mcp", (signal) => api.mcpServers(signal));
  const servers = cached.data?.servers ?? null;
  const config = cached.data?.config ?? null;
  const [view, setView] = React.useState<View>("list");
  const [filter, setFilter] = React.useState<Filter>("all");
  useTick(30_000);
  const [editing, setEditing] = React.useState<{ server?: McpServerView } | null>(null);
  // Keep the last draft so <SheetContent> stays mounted through the close animation (see motion contract);
  // `seq` bumps per open so each open gets a fresh ServerSheet instead of a stale draft.
  const lastEditing = React.useRef<{ seq: number; server?: McpServerView } | null>(null);
  const openedRef = React.useRef<object | null>(null);
  if (editing && openedRef.current !== editing) {
    openedRef.current = editing;
    lastEditing.current = { seq: (lastEditing.current?.seq ?? 0) + 1, server: editing.server };
  }
  const shown = lastEditing.current;
  const [pasting, setPasting] = React.useState(false);
  const [health, setHealth] = React.useState<Record<string, Health>>({});
  const [testing, setTesting] = React.useState<Record<string, boolean>>({});

  const mutate = React.useCallback<Mutate>(
    async (body, ok) => {
      const r = await api.mcpMutate(body);
      cached.setData(r);
      if (ok) toast.success(ok);
      return r;
    },
    [cached]
  );

  const test = React.useCallback((name: string) => {
    setTesting((t) => ({ ...t, [name]: true }));
    return api
      .mcpTest(name)
      .then((r) => {
        setHealth((h) => ({ ...h, [name]: { ...r, at: Date.now() } }));
        return r;
      })
      .catch((e: unknown) => {
        const r = { ok: false, detail: errMsg(e), at: Date.now() };
        setHealth((h) => ({ ...h, [name]: r }));
        return r;
      })
      .finally(() => setTesting((t) => ({ ...t, [name]: false })));
  }, []);
  const dismiss = React.useCallback((name: string) => setHealth((h) => Object.fromEntries(Object.entries(h).filter(([k]) => k !== name))), []);

  const all = servers ?? [];
  const counts = {
    all: all.length,
    on: all.filter((s) => s.enabled).length,
    off: all.filter((s) => !s.enabled).length,
    stdio: all.filter((s) => s.type === "stdio").length,
    remote: all.filter((s) => s.type !== "stdio").length,
  };
  const visible = all.filter((s) => {
    if (filter === "on" && !s.enabled) return false;
    if (filter === "off" && s.enabled) return false;
    if (filter === "stdio" && s.type !== "stdio") return false;
    if (filter === "remote" && s.type === "stdio") return false;
    return true;
  });
  const noMatchLine = { all: "", on: "No servers are on.", off: "Every server is on.", stdio: "No command servers.", remote: "No remote servers." }[filter];
  const verdicts = visible.filter((s) => s.type !== "stdio" && health[s.name]);
  const columns = React.useMemo(() => serverColumns(health, testing), [health, testing]);
  const hasServers = !!servers && servers.length > 0;

  return (
    <section aria-labelledby="mcp-h" className="scroll-mt-6">
      <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-3">
        <h2 id="mcp-h" className="text-foreground text-h3 font-semibold tracking-[-0.01em]">
          MCP servers
        </h2>
        {servers && (
          <span className="text-muted-foreground text-meta tabular-nums">
            {servers.length === 0 ? "none yet" : `${counts.on} of ${servers.length} on`}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {hasServers && (
            <AnimatedTabs
              ariaLabel="View"
              className="h-8"
              value={view}
              onChange={setView}
              items={[
                { value: "list", icon: <List className="size-3.5" />, label: "List" },
                { value: "json", icon: <Braces className="size-3.5" />, label: "JSON" },
              ]}
            />
          )}
          {view === "list" && hasServers && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="outline" onClick={() => setPasting(true)} aria-label="Paste config" className="px-2.5">
                    <ClipboardPaste />
                    <span className="hidden md:inline">Paste</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Import the mcpServers JSON your IDE exports</TooltipContent>
              </Tooltip>
              <Button size="sm" onClick={() => setEditing({})}>
                <Plus />
                Add server
              </Button>
            </>
          )}
        </div>
      </div>

      <Collapse open={!!cached.error}>
        <p role="alert" className="bg-destructive/10 text-destructive mb-3 rounded-lg px-3 py-2 text-meta">
          {cached.error}
        </p>
      </Collapse>

      <Swap state={view}>
        {view === "json" ? (
          <JsonView config={config} onSave={(json) => mutate({ action: "replace", json }, "Configuration saved")} />
        ) : servers === null ? (
          <ListSkeleton />
        ) : servers.length === 0 ? (
          <EmptyState onAdd={() => setEditing({})} onPaste={() => setPasting(true)} />
        ) : (
          <div className="flex flex-col gap-3">
            <DataTable
              aria-label="MCP servers"
              rows={visible}
              columns={columns}
              rowKey={(s) => s.name}
              onRowClick={(s) => setEditing({ server: s })}
              rowLabel={(s) => `Open ${s.name}`}
              rowProps={(s) => ({ className: cn(!s.enabled && "[&_td]:text-muted-foreground") })}
              search={{ placeholder: "Search servers", text: (s) => [s.name, s.type, s.command, ...(s.args ?? []), s.url, ...Object.keys(s.env ?? {}), ...Object.keys(s.headers ?? {})].filter(Boolean).join(" ") }}
              toolbar={
                <div role="radiogroup" aria-label="Filter servers" className="flex flex-wrap items-center gap-1.5">
                  <FilterChip group="mcp" active={filter === "all"} onClick={() => setFilter("all")} label="All" count={counts.all} />
                  <FilterChip group="mcp" active={filter === "on"} onClick={() => setFilter("on")} label="On" count={counts.on} tone="live" />
                  <FilterChip group="mcp" active={filter === "off"} onClick={() => setFilter("off")} label="Off" count={counts.off} />
                  <span className="bg-border mx-0.5 hidden h-4 w-px sm:block" aria-hidden />
                  <FilterChip group="mcp" active={filter === "stdio"} onClick={() => setFilter("stdio")} label="Command" count={counts.stdio} className="hidden sm:flex" />
                  <FilterChip group="mcp" active={filter === "remote"} onClick={() => setFilter("remote")} label="Remote" count={counts.remote} className="hidden sm:flex" />
                </div>
              }
              actions={(s) => <ServerActions server={s} health={health[s.name]} testing={!!testing[s.name]} onTest={() => void test(s.name)} onEdit={() => setEditing({ server: s })} onMutate={mutate} />}
              empty={
                <span className="flex flex-col items-center gap-1">
                  <span className="text-foreground text-body font-medium">Nothing here</span>
                  <span className="text-meta">{noMatchLine}</span>
                  <Button size="xs" variant="ghost" className="mt-2" onClick={() => setFilter("all")}>
                    Show all
                  </Button>
                </span>
              }
              minWidth="min-w-[44rem]"
            />
            <Collapse open={verdicts.length > 0}>
              <div className="flex flex-col gap-2">
                {verdicts.map((s) => (
                  <Verdict key={s.name} title={s.name} health={health[s.name]} onDismiss={() => dismiss(s.name)} onRetry={() => void test(s.name)} retrying={!!testing[s.name]} />
                ))}
              </div>
            </Collapse>
            <p className="text-faint flex items-center gap-2 px-1 text-micro">
              <Plug className="size-3" aria-hidden />
              Every sandbox gets the servers that are on, from its next run or turn.
            </p>
          </div>
        )}
      </Swap>

      <Sheet open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        {shown && <ServerSheet key={shown.seq} initial={shown.server} health={shown.server ? health[shown.server.name] : undefined} testing={shown.server ? !!testing[shown.server.name] : false} onTest={test} onMutate={mutate} onClose={() => setEditing(null)} />}
      </Sheet>
      <Dialog open={pasting} onOpenChange={setPasting}>
        {pasting && <PasteDialog onMutate={mutate} onClose={() => setPasting(false)} />}
      </Dialog>
    </section>
  );
}

/* ───────────────────────────── table ───────────────────────────── */

const TONE: Record<Status["kind"], React.ComponentProps<typeof StatusDot>["tone"]> = {
  off: "muted",
  on: "live",
  checking: "live",
  connected: "ok",
  failed: "destructive",
  expired: "destructive",
};

function serverColumns(health: Record<string, Health>, testing: Record<string, boolean>): Column<McpServerView>[] {
  return [
    {
      id: "server",
      header: "Server",
      primary: true,
      sort: (s) => s.name,
      cell: (s) => {
        const secrets = Object.keys(s.env ?? {}).length + Object.keys(s.headers ?? {}).length;
        return (
          <span className="flex min-w-0 items-center gap-3">
            <span className={cn("bg-card grid size-8 shrink-0 place-items-center rounded-lg border shadow-e1", !s.enabled && "opacity-55 grayscale")} aria-hidden>
              <BrandGlyph hint={`${s.name} ${s.command ?? ""} ${(s.args ?? []).join(" ")} ${s.url ?? ""}`} transport={s.type} className="size-4" />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className={cn("truncate", !s.enabled && "text-muted-foreground")}>{s.name}</span>
              <MetaLine parts={[<span title={s.url ?? [s.command, ...(s.args ?? [])].filter(Boolean).join(" ")}>{describe(s)}</span>, secrets > 0 && `${secrets} ${secrets === 1 ? "secret" : "secrets"}`]} />
            </span>
          </span>
        );
      },
    },
    {
      id: "transport",
      header: "Transport",
      width: "w-28",
      hideBelow: "md",
      sort: (s) => s.type,
      cell: (s) => <span className="stamp">{s.type}</span>,
    },
    {
      id: "status",
      header: "Status",
      width: "w-36",
      sort: (s) => statusOf(s, health[s.name], !!testing[s.name]).word,
      cell: (s) => {
        const st = statusOf(s, health[s.name], !!testing[s.name]);
        return (
          <StatusDot tone={TONE[st.kind]} pulse={st.kind === "checking"}>
            {st.word}
          </StatusDot>
        );
      },
    },
    {
      id: "tools",
      header: "Tools",
      width: "w-20",
      align: "end",
      hideBelow: "sm",
      sort: (s) => health[s.name]?.tools?.length,
      cell: (s) => {
        const n = health[s.name]?.tools?.length;
        return n == null ? <span className="text-faint" title={s.type === "stdio" ? "Counted inside the sandbox at run time" : "Not tested yet"}>—</span> : <span className="tabular-nums">{n}</span>;
      },
    },
    {
      id: "checked",
      header: "Last checked",
      width: "w-32",
      hideBelow: "lg",
      sort: (s) => health[s.name]?.at,
      cell: (s) => {
        const h = health[s.name];
        return h ? <span className="tabular-nums">{fmtAgo(Math.floor(h.at / 1000))}</span> : <span className="text-faint">never</span>;
      },
    },
  ];
}

/** Trailing actions of a server row: test (remote only), edit, remove, on/off. */
function ServerActions({ server: s, health, testing, onTest, onEdit, onMutate }: { server: McpServerView; health?: Health; testing: boolean; onTest: () => void; onEdit: () => void; onMutate: Mutate }) {
  const [busy, setBusy] = React.useState(false);
  const toggle = () => {
    setBusy(true);
    onMutate({ action: "toggle", name: s.name, enabled: !s.enabled }, s.enabled ? `${s.name} is off` : `${s.name} is on — every sandbox gets it on its next run`)
      .catch((e: unknown) => toast.error("Could not update", { description: errMsg(e) }))
      .finally(() => setBusy(false));
  };
  const remove = async () => {
    await onMutate({ action: "remove", name: s.name }, `Removed ${s.name}`).catch((e: unknown) => toast.error("Could not remove", { description: errMsg(e) }));
  };
  return (
    <span className="inline-flex items-center gap-1">
      {s.type !== "stdio" && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="xs" variant="ghost" onClick={onTest} loading={testing} disabled={!s.enabled && !health} className="text-muted-foreground">
              <Zap className="size-3.5" />
              Test
            </Button>
          </TooltipTrigger>
          <TooltipContent>Run the MCP handshake and list its tools</TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="icon-xs" variant="ghost" onClick={onEdit} aria-label={`Edit ${s.name}`}>
            <Pencil />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Edit</TooltipContent>
      </Tooltip>
      <ArmButton size="icon-xs" variant="ghost" icon={<Trash2 />} label={`Remove ${s.name}`} armedLabel="Remove?" onConfirm={remove} className="hover:text-destructive" />
      <Tooltip>
        {/* A span, not the Switch itself: TooltipTrigger asChild injects an onClick that Switch's prop spread would let override its own toggle. */}
        <TooltipTrigger asChild>
          <span className="ml-1 inline-flex">
            <Switch checked={s.enabled} onCheckedChange={toggle} disabled={busy} aria-label={s.enabled ? `Disable ${s.name}` : `Enable ${s.name}`} />
          </span>
        </TooltipTrigger>
        <TooltipContent>{s.enabled ? "On — given to every new run and turn" : "Off — kept, not given to the agent"}</TooltipContent>
      </Tooltip>
    </span>
  );
}

/* ───────────────────────────── loading / empty ───────────────────────────── */

function ListSkeleton() {
  return (
    <div className="bg-card overflow-hidden rounded-xl border shadow-e1" aria-busy="true" aria-label="Loading servers">
      <div className="bg-muted/30 flex items-center gap-1.5 border-b px-4 py-2.5">
        <Bar className="h-8 w-16 rounded-full" />
        <Bar className="h-8 w-14 rounded-full" />
        <Bar className="h-8 w-14 rounded-full" />
        <Bar className="ml-auto h-8 w-32 rounded-full" />
      </div>
      <ul className="divide-y">
        {[0, 1, 2].map((i) => (
          <li key={i} className="flex items-center gap-3 px-4 py-3">
            <Bar className="size-10 rounded-[10px]" />
            <div className="flex flex-1 flex-col gap-2">
              <div className="flex items-center gap-2">
                <Bar className="h-3.5 w-24" />
                <Bar className="h-4 w-10 rounded-full" />
              </div>
              <Bar className="h-3 w-56" />
            </div>
            <Bar className="hidden h-6 w-14 rounded-md sm:block" />
            <Bar className="h-5 w-9 rounded-full" />
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyState({ onAdd, onPaste }: { onAdd: () => void; onPaste: () => void }) {
  return (
    <div className="enter bg-card relative overflow-hidden rounded-xl border p-6 shadow-e1 sm:p-8">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(60%_100%_at_50%_0%,color-mix(in_oklab,var(--live)_10%,transparent),transparent)]" aria-hidden />
      <div className="relative flex flex-col items-center text-center">
        <span className="bg-card text-live grid size-12 place-items-center rounded-xl border shadow-e1" aria-hidden>
          <Plug className="size-5" strokeWidth={1.75} />
        </span>
        <p className="text-foreground mt-4 text-lead font-medium">Give the agent more tools</p>
        <p className="text-muted-foreground mt-1 max-w-[40ch] text-meta">
          An MCP server hands the agent extra tools — Jira, a database, your own API. It already has shell, files, GitHub and the web; anything added here is available in every sandbox on its next run.
        </p>
      </div>
      <div className="relative mt-6 grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={onAdd} className="group bg-background hover-raise hover:border-line-strong flex cursor-pointer items-start gap-3 rounded-xl border p-4 text-left transition-colors">
          <span className="bg-primary text-primary-foreground grid size-8 shrink-0 place-items-center rounded-lg shadow-e1" aria-hidden>
            <Plus className="size-4" />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-foreground text-meta font-medium">Add a server</span>
            <span className="text-muted-foreground text-micro leading-snug">A command the sandbox runs, or a URL it connects to — with its secrets.</span>
          </span>
        </button>
        <button type="button" onClick={onPaste} className="group bg-background hover-raise hover:border-line-strong flex cursor-pointer items-start gap-3 rounded-xl border p-4 text-left transition-colors">
          <span className="bg-muted text-muted-foreground group-hover:text-foreground grid size-8 shrink-0 place-items-center rounded-lg transition-colors" aria-hidden>
            <ClipboardPaste className="size-4" />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-foreground text-meta font-medium">Paste a config</span>
            <span className="text-muted-foreground text-micro leading-snug">
              The <span className="stamp">mcpServers</span> JSON from Cursor, Claude Code or VS Code, imported as-is.
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}

/* ───────────────────────────── paste config ───────────────────────────── */

function PasteDialog({ onMutate, onClose }: { onMutate: Mutate; onClose: () => void }) {
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const parsed = React.useMemo(() => {
    if (!text.trim()) return null;
    try {
      const v: unknown = JSON.parse(text);
      if (!v || typeof v !== "object" || Array.isArray(v)) return { error: "Expected a JSON object.", line: 1 };
      const map = "mcpServers" in v && v.mcpServers && typeof v.mcpServers === "object" ? v.mcpServers : "name" in v ? { one: v } : v;
      return { names: Object.keys(map as object) };
    } catch (e) {
      const msg = errMsg(e);
      return { error: msg, line: jsonErrorLine(text, msg) };
    }
  }, [text]);
  const names: string[] = parsed !== null && "names" in parsed && parsed.names ? parsed.names : [];
  const count = names.length;
  const submit = async () => {
    if (count === 0 || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onMutate({ action: "import", json: text }, `Imported ${count} server${count === 1 ? "" : "s"}`);
      onClose();
    } catch (e) {
      setErr(errMsg(e));
      setBusy(false);
    }
  };
  return (
    <DialogContent
      title="Paste config"
      description="The mcpServers JSON from Cursor, Claude Code, VS Code or Claude Desktop. Servers with the same name are replaced."
      className="w-[min(40rem,calc(100vw-2rem))]"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void submit();
        }
      }}
    >
      <div className="flex flex-col gap-3">
        <JsonEditor value={text} onChange={setText} onSave={() => void submit()} errorLine={parsed && "error" in parsed ? parsed.line : null} className="h-64" />
        <div className={cn("min-h-[1.25rem] text-micro", parsed && "error" in parsed ? "text-destructive" : "text-muted-foreground")} role={parsed && "error" in parsed ? "alert" : undefined}>
          {parsed === null ? (
            <span className="stamp text-faint">{'{ "mcpServers": { "name": { "command": "npx", "args": ["…"] } } }'}</span>
          ) : "error" in parsed ? (
            `${parsed.error}${parsed.line ? ` (line ${parsed.line})` : ""}`
          ) : (
            <span className="flex flex-wrap items-center gap-1.5">
              <Check className="text-ok size-3.5" aria-hidden />
              {count} server{count === 1 ? "" : "s"} found
              {names.slice(0, 6).map((n) => (
                <span key={n} className="stamp bg-muted text-foreground rounded-md px-1.5 py-0.5">
                  {n}
                </span>
              ))}
              {count > 6 && <span className="text-faint">+{count - 6} more</span>}
            </span>
          )}
        </div>
        <Collapse open={!!err}>
          <p className="bg-destructive/10 text-destructive rounded-lg px-3 py-2 text-meta" role="alert">
            {err}
          </p>
        </Collapse>
        <div className="flex items-center gap-2">
          <span className="text-faint hidden items-center gap-1 text-micro sm:inline-flex">
            <Kbd>⌘</Kbd>
            <Kbd>↵</Kbd> import
          </span>
          <Button type="button" size="sm" variant="ghost" onClick={onClose} className="ml-auto">
            Cancel
          </Button>
          <Button size="sm" loading={busy} disabled={count === 0} onClick={() => void submit()}>
            <ClipboardPaste />
            Import{count > 0 ? ` ${count}` : ""}
          </Button>
        </div>
      </div>
    </DialogContent>
  );
}

/* ───────────────────────────── JSON view ───────────────────────────── */

function JsonView({ config, onSave }: { config: McpServersResponse["config"] | null; onSave: (json: string) => Promise<unknown> }) {
  const pristine = React.useMemo(() => (config ? JSON.stringify(config, null, 2) : ""), [config]);
  const [text, setText] = React.useState(pristine);
  const [busy, setBusy] = React.useState(false);
  const touched = React.useRef(false);
  // A background refresh replaces the pristine text unless you have started editing.
  React.useEffect(() => {
    if (!touched.current) setText(pristine);
  }, [pristine]);

  const parsed = React.useMemo(() => {
    try {
      const v: unknown = JSON.parse(text);
      if (!v || typeof v !== "object" || !("mcpServers" in v) || !v.mcpServers || typeof v.mcpServers !== "object") return { error: 'Top level must be { "mcpServers": { … } }', line: 1 };
      return { value: v, count: Object.keys(v.mcpServers).length };
    } catch (e) {
      const msg = errMsg(e);
      return { error: msg, line: jsonErrorLine(text, msg) };
    }
  }, [text]);
  const dirty = text !== pristine;

  const save = async () => {
    if (!dirty || "error" in parsed) return;
    setBusy(true);
    try {
      await onSave(text);
      touched.current = false;
    } catch (e) {
      toast.error("Could not save", { description: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };

  if (!config) {
    return (
      <div className="bg-card rounded-xl border p-4">
        <Bar className="h-64 w-full" />
      </div>
    );
  }
  return (
    <div className="bg-card overflow-hidden rounded-xl border shadow-e1">
      <div className="bg-muted/30 flex flex-wrap items-center gap-1.5 border-b px-3 py-2 sm:px-4">
        <span className="stamp text-muted-foreground min-w-0 truncate">~/.agent-sandbox/mcp.json</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-faint hidden text-micro lg:inline">· Claude Code / Cursor format</span>
          </TooltipTrigger>
          <TooltipContent>The same file Cursor and Claude Code read. "disabled": true keeps a server off.</TooltipContent>
        </Tooltip>
        <div className="ml-auto flex items-center gap-1">
          <Button size="xs" variant="ghost" onClick={() => "value" in parsed && setText(JSON.stringify(parsed.value, null, 2))} disabled={"error" in parsed}>
            <WandSparkles /> Format
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              navigator.clipboard
                .writeText(text)
                .then(() => toast.success("Copied"))
                .catch((e: unknown) => toast.error("Could not copy", { description: errMsg(e) }));
            }}
          >
            <Copy /> Copy
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={!dirty}
            onClick={() => {
              setText(pristine);
              touched.current = false;
            }}
          >
            <RotateCcw /> Reset
          </Button>
          <Button size="xs" disabled={!dirty || "error" in parsed} loading={busy} onClick={() => void save()} className="ml-1 min-w-[4.5rem]">
            <Check />
            Save
          </Button>
        </div>
      </div>
      <JsonEditor
        value={text}
        onChange={(v) => {
          touched.current = true;
          setText(v);
        }}
        onSave={() => void save()}
        errorLine={"error" in parsed ? parsed.line : null}
        className="h-[60vh] rounded-none border-0"
      />
      <p className={cn("flex items-center gap-1.5 border-t px-4 py-2 text-micro", "error" in parsed ? "text-destructive" : "text-muted-foreground")} role={"error" in parsed ? "alert" : undefined}>
        {"error" in parsed ? (
          <>
            <X className="size-3 shrink-0" aria-hidden />
            {parsed.error}
            {parsed.line ? ` (line ${parsed.line})` : ""}
          </>
        ) : (
          <>
            <span className="tabular-nums">
              {parsed.count} server{parsed.count === 1 ? "" : "s"}
            </span>
            {dirty && (
              <span className="text-attention-text inline-flex items-center gap-1">
                · unsaved <Kbd>⌘S</Kbd>
              </span>
            )}
            <span className="text-faint ml-auto hidden sm:inline">Masked secrets left untouched stay as stored.</span>
          </>
        )}
      </p>
    </div>
  );
}
