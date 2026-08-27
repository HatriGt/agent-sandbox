import * as React from "react";
import { Braces, Check, ChevronDown, Copy, KeyRound, List, Loader2, Plus, RotateCcw, Search, Trash2, WandSparkles, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { api, type McpServersResponse, type McpServerView, type McpTransport } from "@/lib/api";
import { useCached } from "@/lib/cache";
import { BrandGlyph } from "@/lib/brandIcon";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Bar } from "@/components/thread/Skeletons";
import { JsonEditor, jsonErrorLine } from "@/components/JsonEditor";
import { cn } from "@/lib/utils";

/**
 * MCP servers, two ways to look at the same store:
 *
 *   List — one row per server (brand glyph · name · transport · target · env count · switch). A row
 *          opens in place into an editor: name, transport, command + args, URL, env and headers as
 *          key/value rows. Secret values arrive masked; leaving one alone keeps what is stored.
 *   JSON — the whole config as the `{"mcpServers": …}` file every IDE speaks, in a real editor
 *          (gutter, colours, error line). Format, copy, reset, save. Saving replaces the store;
 *          masked secrets that were not touched survive.
 */
type View = "list" | "json";
type Filter = "all" | "on" | "off";
const MASKED = /^(••••|.{2}….{3})$/;

export function McpServers() {
  const cached = useCached("mcp", (signal) => api.mcpServers(signal));
  const servers = cached.data?.servers ?? null;
  const config = cached.data?.config ?? null;
  const [view, setView] = React.useState<View>("list");
  const [filter, setFilter] = React.useState<Filter>("all");
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState<string | null>(null); // row being edited, or "__new__"

  const mutate = React.useCallback(
    async (body: Record<string, unknown>, ok?: string) => {
      const r = await api.mcpMutate(body);
      cached.setData(r);
      if (ok) toast.success(ok);
      return r;
    },
    [cached]
  );

  const q = query.trim().toLowerCase();
  const visible = (servers ?? []).filter((s) => {
    if (filter === "on" && !s.enabled) return false;
    if (filter === "off" && s.enabled) return false;
    if (!q) return true;
    return [s.name, s.type, s.command, ...(s.args ?? []), s.url, ...Object.keys(s.env ?? {}), ...Object.keys(s.headers ?? {})].filter(Boolean).join(" ").toLowerCase().includes(q);
  });
  const onCount = servers?.filter((s) => s.enabled).length ?? 0;

  return (
    <section aria-labelledby="mcp-h">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 id="mcp-h" className="text-foreground text-h3 font-semibold tracking-[-0.01em]">
          MCP servers
        </h2>
        {servers && (
          <span className="text-muted-foreground text-meta">
            {servers.length} · {onCount} on
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {view === "list" && (
            <>
              <label className="bg-card focus-within:ring-ring flex h-8 items-center gap-1.5 rounded-md border px-2 focus-within:ring-2">
                <Search className="text-muted-foreground size-3.5" aria-hidden />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter" aria-label="Filter servers" className="text-foreground placeholder:text-muted-foreground w-28 bg-transparent text-meta outline-none focus:w-44 transition-[width]" />
                {query && (
                  <button type="button" onClick={() => setQuery("")} aria-label="Clear" className="text-muted-foreground hover:text-foreground cursor-pointer">
                    <X className="size-3.5" />
                  </button>
                )}
              </label>
              <Segmented value={filter} onChange={setFilter} options={[["all", "All"], ["on", "On"], ["off", "Off"]]} />
            </>
          )}
          <Segmented
            value={view}
            onChange={setView}
            options={[
              ["list", <><List className="size-3.5" /> List</>],
              ["json", <><Braces className="size-3.5" /> JSON</>],
            ]}
          />
          {view === "list" && (
            <Button size="sm" onClick={() => setOpen(open === "__new__" ? null : "__new__")}>
              <Plus />
              Add
            </Button>
          )}
        </div>
      </div>

      {cached.error && (
        <p role="alert" className="text-destructive mb-3 text-meta">
          {cached.error}
        </p>
      )}

      {view === "json" ? (
        <JsonView config={config} onSave={(json) => mutate({ action: "replace", json }, "Configuration saved")} />
      ) : (
        <div className="bg-card overflow-hidden rounded-xl border">
          <AnimatePresence initial={false}>
            {open === "__new__" && (
              <Expand key="new">
                <ServerEditor onMutate={mutate} onDone={() => setOpen(null)} />
              </Expand>
            )}
          </AnimatePresence>
          {servers === null ? (
            <ul className="divide-y">
              {[0, 1, 2, 3].map((i) => (
                <li key={i} className="flex items-center gap-3 px-4 py-3">
                  <Bar className="size-4 rounded" />
                  <Bar className="h-3 w-28" />
                  <Bar className="h-2.5 w-64" />
                  <Bar className="ml-auto h-5 w-9 rounded-full" />
                </li>
              ))}
            </ul>
          ) : servers.length === 0 ? (
            <Empty title="No MCP servers yet" line="The agent already has shell, files, GitHub and the web. Add Jira, a database, your API — or paste your IDE's JSON in the JSON view." />
          ) : visible.length === 0 ? (
            <Empty title="Nothing matches" line={q ? `No server matches “${query.trim()}”.` : filter === "on" ? "No servers are on." : "No servers are off."} />
          ) : (
            <ul className="divide-y">
              {visible.map((s) => (
                <li key={s.name}>
                  <ServerRow server={s} open={open === s.name} onToggleOpen={() => setOpen(open === s.name ? null : s.name)} onMutate={mutate} />
                  <AnimatePresence initial={false}>
                    {open === s.name && (
                      <Expand key="edit">
                        <ServerEditor initial={s} onMutate={mutate} onDone={() => setOpen(null)} />
                      </Expand>
                    )}
                  </AnimatePresence>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, React.ReactNode][] }) {
  return (
    <div role="radiogroup" className="bg-muted inline-flex h-8 items-center gap-0.5 rounded-md p-0.5">
      {options.map(([k, label]) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} onClick={() => onChange(k)} className={cn("flex h-7 cursor-pointer items-center gap-1.5 rounded px-2.5 text-micro font-medium transition-colors", value === k ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Expand({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
      <div className="bg-muted/30 border-b px-4 py-4">{children}</div>
    </motion.div>
  );
}

function Empty({ title, line }: { title: string; line: string }) {
  return (
    <div className="px-6 py-10 text-center">
      <p className="text-foreground text-body font-medium">{title}</p>
      <p className="text-muted-foreground mx-auto mt-1 max-w-md text-meta">{line}</p>
    </div>
  );
}

/* ───────────────────────────── list row ───────────────────────────── */

function ServerRow({ server: s, open, onToggleOpen, onMutate }: { server: McpServerView; open: boolean; onToggleOpen: () => void; onMutate: (b: Record<string, unknown>, ok?: string) => Promise<unknown> }) {
  const [busy, setBusy] = React.useState(false);
  const target = s.type === "stdio" ? [s.command, ...(s.args ?? [])].join(" ") : s.url ?? "";
  const envN = Object.keys(s.env ?? {}).length;
  const hdrN = Object.keys(s.headers ?? {}).length;
  const toggle = () => {
    setBusy(true);
    onMutate({ action: "toggle", name: s.name, enabled: !s.enabled })
      .catch((e: unknown) => toast.error("Could not update", { description: e instanceof Error ? e.message : String(e) }))
      .finally(() => setBusy(false));
  };
  return (
    <div className={cn("group flex items-center gap-3 px-4 py-2.5 transition-colors", open ? "bg-muted/30" : "hover:bg-muted/40")}>
      <button type="button" onClick={onToggleOpen} aria-expanded={open} className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left">
        <BrandGlyph hint={`${s.name} ${target}`} transport={s.type} className={cn(!s.enabled && "opacity-40 grayscale")} />
        <span className={cn("shrink-0 text-body font-medium", s.enabled ? "text-foreground" : "text-muted-foreground")}>{s.name}</span>
        <span className="label text-muted-foreground shrink-0 rounded border px-1 py-px">{s.type}</span>
        <span className="stamp text-muted-foreground min-w-0 flex-1 truncate" title={target}>
          {target}
        </span>
        {(envN > 0 || hdrN > 0) && (
          <span className="stamp text-muted-foreground hidden shrink-0 items-center gap-1 sm:inline-flex">
            <KeyRound className="size-3" aria-hidden />
            {envN > 0 && `${envN} env`}
            {envN > 0 && hdrN > 0 && " · "}
            {hdrN > 0 && `${hdrN} hdr`}
          </span>
        )}
        <ChevronDown className={cn("text-muted-foreground size-3.5 shrink-0 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" role="switch" aria-checked={s.enabled} disabled={busy} onClick={toggle} className={cn("relative h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors", s.enabled ? "bg-live" : "bg-muted-foreground/30")} aria-label={s.enabled ? `Disable ${s.name}` : `Enable ${s.name}`}>
            <span className={cn("bg-card absolute top-0.5 size-4 rounded-full shadow-xs transition-[left]", s.enabled ? "left-[1.125rem]" : "left-0.5")} />
          </button>
        </TooltipTrigger>
        <TooltipContent>{s.enabled ? "On — given to every new run and turn" : "Off — kept, not given to the agent"}</TooltipContent>
      </Tooltip>
    </div>
  );
}

/* ───────────────────────────── inline editor ───────────────────────────── */

type KV = { k: string; v: string; secret: boolean };
const toKV = (m?: Record<string, string>): KV[] => Object.entries(m ?? {}).map(([k, v]) => ({ k, v, secret: MASKED.test(v) }));
const fromKV = (rows: KV[]) => Object.fromEntries(rows.filter((r) => r.k.trim()).map((r) => [r.k.trim(), r.v]));

function ServerEditor({ initial, onMutate, onDone }: { initial?: McpServerView; onMutate: (b: Record<string, unknown>, ok?: string) => Promise<unknown>; onDone: () => void }) {
  const [name, setName] = React.useState(initial?.name ?? "");
  const [type, setType] = React.useState<McpTransport>(initial?.type ?? "stdio");
  const [command, setCommand] = React.useState(initial?.command ?? "");
  const [args, setArgs] = React.useState((initial?.args ?? []).join("\n"));
  const [url, setUrl] = React.useState(initial?.url ?? "");
  const [env, setEnv] = React.useState<KV[]>(() => toKV(initial?.env));
  const [headers, setHeaders] = React.useState<KV[]>(() => toKV(initial?.headers));
  const [busy, setBusy] = React.useState(false);
  const [armed, setArmed] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const valid = name.trim() && (type === "stdio" ? command.trim() : /^https?:\/\//.test(url.trim()));

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await onMutate(
        {
          action: "upsert",
          previousName: initial?.name,
          server: {
            name: name.trim(),
            type,
            command: type === "stdio" ? command.trim() : undefined,
            args: type === "stdio" ? args.split("\n").map((a) => a.trim()).filter(Boolean) : undefined,
            url: type !== "stdio" ? url.trim() : undefined,
            env: fromKV(env),
            headers: type !== "stdio" ? fromKV(headers) : undefined,
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
  const remove = async () => {
    if (!initial) return;
    setBusy(true);
    try {
      await onMutate({ action: "remove", name: initial.name }, `Removed ${initial.name}`);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const field = "text-foreground placeholder:text-muted-foreground bg-card focus:ring-ring h-9 w-full rounded-md border px-2.5 font-mono text-meta outline-none focus:ring-2";
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) void save();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <Field label="Name">
          <div className="flex items-center gap-2">
            <BrandGlyph hint={`${name} ${command} ${url}`} transport={type} />
            <input autoFocus={!initial} value={name} onChange={(e) => setName(e.target.value)} placeholder="atlassian" className={field} />
          </div>
        </Field>
        <Field label="Transport">
          <div role="radiogroup" className="bg-muted inline-flex h-9 items-center gap-0.5 rounded-md p-0.5">
            {(["stdio", "http", "sse"] as McpTransport[]).map((t) => (
              <button key={t} type="button" role="radio" aria-checked={type === t} onClick={() => setType(t)} className={cn("h-8 cursor-pointer rounded px-3 text-meta font-medium", type === t ? "bg-card text-foreground shadow-xs" : "text-muted-foreground")}>
                {t}
              </button>
            ))}
          </div>
        </Field>
      </div>

      {type === "stdio" ? (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <Field label="Command" hint="Runs inside the sandbox.">
            <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" className={field} />
          </Field>
          <Field label="Arguments" hint="One per line.">
            <textarea value={args} onChange={(e) => setArgs(e.target.value)} rows={Math.max(2, Math.min(6, args.split("\n").length))} placeholder={"-y\n@modelcontextprotocol/server-postgres"} className={cn(field, "h-auto resize-y py-1.5")} />
          </Field>
        </div>
      ) : (
        <Field label="URL">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://mcp.example.com/mcp" className={field} />
        </Field>
      )}

      <KVTable label="Environment" rows={env} onChange={setEnv} keyPlaceholder="DATABASE_URL" />
      {type !== "stdio" && <KVTable label="Headers" rows={headers} onChange={setHeaders} keyPlaceholder="Authorization" />}

      {err && (
        <p className="text-destructive text-meta" role="alert">
          {err}
        </p>
      )}
      <div className="flex items-center gap-2">
        {initial &&
          (armed ? (
            <>
              <Button type="button" size="sm" variant="destructive" onClick={() => void remove()} disabled={busy}>
                <Trash2 /> Remove {initial.name}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setArmed(false)}>
                Keep
              </Button>
            </>
          ) : (
            <Button type="button" size="sm" variant="ghost" onClick={() => setArmed(true)} className="text-muted-foreground hover:text-destructive">
              <Trash2 /> Remove
            </Button>
          ))}
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={busy || !valid}>
            {busy ? <Loader2 className="animate-spin" /> : <Check />}
            {initial ? "Save" : "Add server"}
          </Button>
        </div>
      </div>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="label text-muted-foreground flex items-baseline gap-2">
        {label}
        {hint && <span className="font-normal normal-case tracking-normal opacity-70">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function KVTable({ label, rows, onChange, keyPlaceholder }: { label: string; rows: KV[]; onChange: (r: KV[]) => void; keyPlaceholder: string }) {
  const update = (i: number, patch: Partial<KV>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const cell = "text-foreground placeholder:text-muted-foreground bg-card focus:ring-ring h-8 w-full rounded-md border px-2 font-mono text-meta outline-none focus:ring-2";
  return (
    <div className="flex flex-col gap-1.5">
      <span className="label text-muted-foreground flex items-center gap-2">
        {label}
        {rows.length > 0 && <span className="font-normal normal-case tracking-normal opacity-70">{rows.length}</span>}
      </span>
      {rows.length > 0 && (
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] gap-1.5">
          {rows.map((r, i) => (
            <React.Fragment key={i}>
              <input value={r.k} onChange={(e) => update(i, { k: e.target.value })} placeholder={keyPlaceholder} aria-label={`${label} key ${i + 1}`} className={cell} />
              <div className="relative">
                <input
                  value={r.v}
                  onChange={(e) => update(i, { v: e.target.value, secret: false })}
                  onFocus={(e) => r.secret && e.currentTarget.select()}
                  placeholder="value"
                  aria-label={`${label} value ${i + 1}`}
                  className={cn(cell, r.secret && "text-muted-foreground pr-20")}
                />
                {r.secret && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-muted-foreground absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1 text-micro">
                        <KeyRound className="size-3" aria-hidden /> stored
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>Secret — shown masked. Type a new value to replace it; leave it to keep it.</TooltipContent>
                  </Tooltip>
                )}
              </div>
              <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={`Remove ${r.k || "row"}`} className="text-muted-foreground hover:text-destructive grid size-8 cursor-pointer place-items-center rounded-md">
                <X className="size-3.5" />
              </button>
            </React.Fragment>
          ))}
        </div>
      )}
      <button type="button" onClick={() => onChange([...rows, { k: "", v: "", secret: false }])} className="text-muted-foreground hover:text-foreground flex w-fit cursor-pointer items-center gap-1 text-micro">
        <Plus className="size-3" aria-hidden /> Add {label.toLowerCase() === "headers" ? "header" : "variable"}
      </button>
    </div>
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
      const v = JSON.parse(text) as { mcpServers?: Record<string, unknown> };
      if (!v || typeof v !== "object" || !v.mcpServers || typeof v.mcpServers !== "object") return { error: 'Top level must be { "mcpServers": { … } }', line: 1 };
      return { value: v, count: Object.keys(v.mcpServers).length };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { error: msg, line: jsonErrorLine(text, msg) };
    }
  }, [text]);
  const dirty = text !== pristine;

  const format = () => {
    if ("value" in parsed && parsed.value) setText(JSON.stringify(parsed.value, null, 2));
  };
  const save = async () => {
    if (!dirty || "error" in parsed) return;
    setBusy(true);
    try {
      await onSave(text);
      touched.current = false;
    } catch (e) {
      toast.error("Could not save", { description: e instanceof Error ? e.message : String(e) });
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
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="stamp text-muted-foreground">~/.agent-sandbox/mcp.json · Claude Code / Cursor format · `disabled: true` = off</span>
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={format} disabled={"error" in parsed}>
            <WandSparkles /> Format
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void navigator.clipboard.writeText(text);
              toast.success("Copied");
            }}
          >
            <Copy /> Copy
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!dirty}
            onClick={() => {
              setText(pristine);
              touched.current = false;
            }}
          >
            <RotateCcw /> Reset
          </Button>
          <Button size="sm" disabled={!dirty || "error" in parsed || busy} onClick={() => void save()}>
            {busy ? <Loader2 className="animate-spin" /> : <Check />}
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
        minRows={18}
        className="max-h-[70vh] [&_textarea]:max-h-[70vh]"
      />
      <p className={cn("text-micro", "error" in parsed ? "text-destructive" : "text-muted-foreground")} role={"error" in parsed ? "alert" : undefined}>
        {"error" in parsed ? `${parsed.error}${parsed.line ? ` (line ${parsed.line})` : ""}` : `${parsed.count} server${parsed.count === 1 ? "" : "s"}${dirty ? " · unsaved changes — ⌘S to save" : ""}. Secrets show masked; untouched ones stay as stored when you save.`}
      </p>
    </div>
  );
}
