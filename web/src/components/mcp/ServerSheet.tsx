import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotion } from "@/lib/motion-pref";
import { Braces, Check, ChevronDown, Eye, EyeOff, KeyRound, Plus, Trash2, X, Zap } from "lucide-react";
import type { McpProbe, McpServerView, McpTransport } from "@/lib/api";
import { BrandGlyph } from "@/lib/brandIcon";
import { Button } from "@/components/ui/button";
import { ArmButton } from "@/components/ui/arm-button";
import { Collapse } from "@/components/ui/collapse";
import { Swap } from "@/components/ui/swap";
import { AnimatedTabs } from "@/components/ui/animated-tabs";
import { SheetContent } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Field, Input, inputClass } from "@/components/ui/field";
import { Kbd } from "@/components/ui/kbd";
import { JsonEditor, jsonErrorLine } from "@/components/JsonEditor";
import { cn } from "@/lib/utils";
import { StatusPill, Verdict, type Mutate } from "./Verdict";
import { TRANSPORTS, commandOf, draftOf, errMsg, fromDef, packageOf, previewJson, shellSplit, statusOf, toDef, validate, type Draft, type Health, type KV } from "./model";

const EASE = [0.22, 1, 0.36, 1] as const;
const SECRET_KEY = /token|secret|key|password|passwd|auth|credential|cookie/i;

/* ───────────────────────────── transport picker ───────────────────────────── */

function TransportPicker({ value, onChange }: { value: McpTransport; onChange: (t: McpTransport) => void }) {
  const still = useReducedMotion();
  const id = React.useId();
  const current = TRANSPORTS.find((t) => t.value === value) ?? TRANSPORTS[0];
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const move = (from: number, step: number) => {
    const j = (from + step + TRANSPORTS.length) % TRANSPORTS.length;
    onChange(TRANSPORTS[j].value);
    refs.current[j]?.focus();
  };
  return (
    <div className="flex flex-col gap-2">
      <div role="radiogroup" aria-label="Transport" className="bg-muted grid grid-cols-3 gap-0.5 rounded-lg p-0.5">
        {TRANSPORTS.map((t, i) => {
          const on = t.value === value;
          return (
            <button
              key={t.value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              onClick={() => onChange(t.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowDown") move(i, 1);
                else if (e.key === "ArrowLeft" || e.key === "ArrowUp") move(i, -1);
                else return;
                e.preventDefault();
              }}
              className={cn(
                "relative isolate flex h-11 cursor-pointer flex-col items-center justify-center gap-0 rounded-md px-2 outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/40",
                on ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {on && <motion.span layoutId={`${id}-pill`} className="bg-card shadow-e1 absolute inset-0 -z-10 rounded-md" transition={still ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 42, mass: 0.7 }} aria-hidden />}
              <span className="text-meta font-medium leading-tight">{t.label}</span>
              <span className={cn("stamp leading-tight transition-colors", on ? "text-muted-foreground" : "text-faint")}>{t.short}</span>
            </button>
          );
        })}
      </div>
      <div className="relative h-[2.1rem] overflow-hidden">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.p
            key={current.value}
            initial={still ? { opacity: 0 } : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={still ? { opacity: 0 } : { opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: EASE }}
            className="text-muted-foreground text-micro leading-snug"
          >
            {current.blurb}
          </motion.p>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ───────────────────────────── command tokens ───────────────────────────── */

/** The pasted command line, echoed back as tokens so the split is visible before it is saved. */
function Tokens({ line }: { line: string }) {
  const parts = shellSplit(line);
  if (parts.length < 2) return null;
  const pkg = packageOf(parts[0], parts.slice(1));
  return (
    <ul className="flex flex-wrap items-center gap-1" aria-label="Parsed command">
      {parts.map((p, i) => {
        const isPkg = p === pkg || p.replace(/@(latest|next|\d[\w.-]*)$/, "") === pkg;
        return (
          <li key={i} className={cn("stamp max-w-full truncate rounded-md border px-1.5 py-0.5", i === 0 ? "bg-muted text-foreground" : isPkg ? "border-live/30 bg-live/8 text-live" : "text-muted-foreground bg-card")}>
            {p}
          </li>
        );
      })}
    </ul>
  );
}

/* ───────────────────────────── key · value rows ───────────────────────────── */

function KVRows({ label, rows, onChange, keyPlaceholder, valuePlaceholder, addLabel, hint }: { label: string; rows: KV[]; onChange: (r: KV[]) => void; keyPlaceholder: string; valuePlaceholder: string; addLabel: string; hint: string }) {
  const still = useReducedMotion();
  const [shown, setShown] = React.useState<Record<number, boolean>>({});
  const update = (i: number, patch: Partial<KV>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const cell = cn(inputClass, "h-9 px-2.5 font-mono text-code");
  const lastKey = React.useRef<HTMLInputElement | null>(null);
  const add = () => {
    onChange([...rows, { k: "", v: "", secret: false }]);
    requestAnimationFrame(() => lastKey.current?.focus());
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="label text-muted-foreground flex items-baseline gap-1.5">
          {label}
          {rows.length > 0 && <span className="text-faint font-normal tabular-nums">{rows.length}</span>}
        </span>
        <span className="text-faint text-micro">{hint}</span>
      </div>
      {rows.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          <AnimatePresence initial={false}>
            {rows.map((r, i) => {
              const sensitive = r.secret || SECRET_KEY.test(r.k);
              const hidden = sensitive && !shown[i] && !r.secret;
              return (
                <motion.li
                  key={i}
                  layout={!still}
                  initial={still ? { opacity: 0 } : { opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, transition: { duration: 0.1 } }}
                  transition={{ duration: 0.18, ease: EASE }}
                  className="grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)_auto] items-center gap-1.5"
                >
                  <input ref={i === rows.length - 1 ? lastKey : undefined} value={r.k} onChange={(e) => update(i, { k: e.target.value })} placeholder={keyPlaceholder} aria-label={`${label} name ${i + 1}`} spellCheck={false} autoCapitalize="off" className={cell} />
                  <div className="relative">
                    <input
                      type={hidden ? "password" : "text"}
                      value={r.v}
                      onChange={(e) => update(i, { v: e.target.value, secret: false })}
                      onFocus={(e) => r.secret && e.currentTarget.select()}
                      placeholder={r.secret ? "" : valuePlaceholder}
                      aria-label={`${label} value ${i + 1}`}
                      spellCheck={false}
                      autoCapitalize="off"
                      autoComplete="off"
                      className={cn(cell, r.secret && "text-muted-foreground pr-[4.5rem]", sensitive && !r.secret && "pr-9")}
                    />
                    {r.secret ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-muted-foreground bg-muted absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-1 rounded px-1.5 py-0.5 text-micro font-medium">
                            <KeyRound className="size-3" aria-hidden /> stored
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>Saved on the server and never sent back. Type to replace it; leave it to keep it.</TooltipContent>
                      </Tooltip>
                    ) : (
                      sensitive && (
                        <button type="button" onClick={() => setShown((s) => ({ ...s, [i]: !s[i] }))} aria-label={hidden ? "Show value" : "Hide value"} aria-pressed={!hidden} className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1 grid size-7 -translate-y-1/2 cursor-pointer place-items-center rounded transition-colors">
                          {hidden ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                        </button>
                      )
                    )}
                  </div>
                  <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={`Remove ${r.k || "row"}`} className="text-muted-foreground hover:text-destructive hover:bg-muted grid size-9 cursor-pointer place-items-center rounded-md transition-colors">
                    <X className="size-3.5" />
                  </button>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
      <button type="button" onClick={add} className="text-muted-foreground hover:text-foreground hover:bg-muted -ml-1.5 flex h-7 w-fit cursor-pointer items-center gap-1 rounded-md px-1.5 text-micro font-medium transition-colors">
        <Plus className="size-3" aria-hidden /> {addLabel}
      </button>
    </div>
  );
}

/* ───────────────────────────── preview ───────────────────────────── */

function Preview({ name, def }: { name: string; def: Record<string, unknown> }) {
  const [open, setOpen] = React.useState(false);
  const text = previewJson(name, def);
  return (
    <div className="bg-muted/40 rounded-lg border">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left">
        <Braces className="text-muted-foreground size-3.5" aria-hidden />
        <span className="text-foreground text-meta font-medium whitespace-nowrap">What the agent sees</span>
        <span className="text-faint hidden truncate text-micro sm:inline">~/.agent-sandbox/mcp.json</span>
        <ChevronDown className={cn("text-muted-foreground ml-auto size-4 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]", open && "rotate-180")} aria-hidden />
      </button>
      <Collapse open={open}>
        <pre className="text-code text-muted-foreground max-h-56 overflow-auto border-t px-3 py-2.5 font-mono leading-relaxed whitespace-pre">{text}</pre>
      </Collapse>
    </div>
  );
}

/* ───────────────────────────── the sheet ───────────────────────────── */

export function ServerSheet({
  initial,
  health,
  testing,
  onTest,
  onMutate,
  onClose,
}: {
  initial?: McpServerView;
  health?: Health;
  testing: boolean;
  onTest: (name: string) => Promise<McpProbe>;
  onMutate: Mutate;
  onClose: () => void;
}) {
  const [d, setD] = React.useState<Draft>(() => draftOf(initial));
  const patch = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const [touched, setTouched] = React.useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<"fields" | "json">("fields");
  const [jsonText, setJsonText] = React.useState("");
  const [jsonErr, setJsonErr] = React.useState<{ msg: string; line: number | null } | null>(null);
  const errors = validate(d);
  const show = (k: keyof typeof errors) => (submitted || touched[k] ? errors[k] : undefined);
  const valid = Object.keys(errors).length === 0;
  const dirty = JSON.stringify(d) !== JSON.stringify(draftOf(initial));
  const def = React.useMemo(() => toDef(d), [d]);
  const { command, args } = commandOf(d);
  const glyphHint = `${d.name} ${d.type === "stdio" ? d.commandLine : d.url}`;

  const switchMode = (m: "fields" | "json") => {
    if (m === mode) return;
    if (m === "json") {
      setJsonText(JSON.stringify(def, null, 2));
      setJsonErr(null);
      setMode("json");
      return;
    }
    try {
      setD(fromDef(jsonText, d));
      setMode("fields");
    } catch (e) {
      const msg = errMsg(e);
      setJsonErr({ msg, line: jsonErrorLine(jsonText, msg) });
    }
  };

  const save = async () => {
    if (busy) return;
    let draft = d;
    if (mode === "json") {
      try {
        draft = fromDef(jsonText, d);
        setD(draft);
      } catch (e) {
        const msg = errMsg(e);
        setJsonErr({ msg, line: jsonErrorLine(jsonText, msg) });
        return;
      }
    }
    setSubmitted(true);
    if (Object.keys(validate(draft)).length) {
      if (mode === "json") setMode("fields");
      return;
    }
    setBusy(true);
    setErr(null);
    const name = draft.name.trim();
    const cmd = commandOf(draft);
    try {
      await onMutate(
        {
          action: "upsert",
          previousName: initial?.name,
          server: {
            name,
            type: draft.type,
            command: draft.type === "stdio" ? cmd.command : undefined,
            args: draft.type === "stdio" ? cmd.args : undefined,
            url: draft.type !== "stdio" ? draft.url.trim() : undefined,
            env: Object.fromEntries(draft.env.filter((r) => r.k.trim()).map((r) => [r.k.trim(), r.v])),
            headers: draft.type !== "stdio" ? Object.fromEntries(draft.headers.filter((r) => r.k.trim()).map((r) => [r.k.trim(), r.v])) : undefined,
            enabled: initial?.enabled ?? true,
          },
        },
        initial ? (initial.name !== name ? `Renamed to ${name}` : `Saved ${name}`) : `Added ${name} — every sandbox gets it on its next run`
      );
      onClose();
    } catch (e) {
      setErr(errMsg(e));
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!initial) return;
    setBusy(true);
    try {
      await onMutate({ action: "remove", name: initial.name }, `Removed ${initial.name}`);
      onClose();
    } catch (e) {
      setErr(errMsg(e));
      setBusy(false);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void save();
    }
  };

  return (
    <SheetContent
      title={initial ? initial.name : "Add MCP server"}
      description={initial ? "Changes reach every sandbox on its next run or turn." : "A set of tools every sandbox agent gets, from its next run."}
      className="w-[min(34rem,100vw)] p-0 sm:w-[min(34rem,calc(100vw-1rem))] [&>div:first-child]:px-6 [&>div:first-child]:pt-6"
      onKeyDown={onKey}
    >
      <form
        className="flex h-full flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="flex flex-col gap-6 px-6 pb-6">
          <div className="-mt-1 flex items-center justify-between gap-3">
            <AnimatedTabs ariaLabel="Editor" value={mode} onChange={switchMode} items={[{ value: "fields", label: "Fields" }, { value: "json", icon: <Braces className="size-3" />, label: "JSON" }]} />
            {mode === "fields" && !initial && (
              <span className="text-faint hidden text-micro sm:inline">
                Copying from a README? <button type="button" onClick={() => switchMode("json")} className="text-muted-foreground hover:text-foreground cursor-pointer underline decoration-dotted underline-offset-2">Paste its JSON</button>
              </span>
            )}
          </div>

          {initial && initial.type !== "stdio" && mode === "fields" && (
            <div className="bg-muted/40 -mt-2 flex flex-col gap-2.5 rounded-lg border p-3">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-foreground text-meta font-medium">Connection</p>
                    <StatusPill status={statusOf(initial, health, testing)} />
                  </div>
                  <p className="text-muted-foreground mt-0.5 text-micro">{dirty ? "Tests what is saved — save first to test these edits." : health ? "Re-run the handshake to refresh the verdict." : "Not checked yet — run the handshake the agent does at startup."}</p>
                </div>
                <Button type="button" size="sm" variant="outline" loading={testing} onClick={() => void onTest(initial.name)}>
                  <Zap className="size-3.5" /> Test
                </Button>
              </div>
              <Collapse open={!!health}>{health && <Verdict health={health} />}</Collapse>
            </div>
          )}

          <Swap state={mode} y={6}>
            {mode === "json" ? (
              <div className="flex flex-col gap-2">
                <JsonEditor
                  value={jsonText}
                  onChange={(v) => {
                    setJsonText(v);
                    setJsonErr(null);
                  }}
                  onSave={() => void save()}
                  errorLine={jsonErr?.line ?? null}
                  className="h-80"
                />
                <p className={cn("text-micro leading-snug", jsonErr ? "text-destructive" : "text-faint")} role={jsonErr ? "alert" : undefined}>
                  {jsonErr ? `${jsonErr.msg}${jsonErr.line ? ` (line ${jsonErr.line})` : ""}` : "One server: the object under its name in an mcpServers file. A whole file with a single entry works too."}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-6">
                <TransportPicker value={d.type} onChange={(type) => patch({ type })} />

                <Field label="Name" error={show("name")} hint={show("name") ? undefined : "Short and lowercase; tools appear to the agent as name__tool."}>
                  {(w) => (
                    <div className="relative">
                      <span className="pointer-events-none absolute top-1/2 left-2.5 grid size-5 -translate-y-1/2 place-items-center" aria-hidden>
                        <BrandGlyph hint={glyphHint} transport={d.type} className="size-4" />
                      </span>
                      <Input {...w} mono autoFocus={!initial} value={d.name} onChange={(e) => patch({ name: e.target.value })} onBlur={() => setTouched((t) => ({ ...t, name: true }))} placeholder="postgres" spellCheck={false} autoCapitalize="off" className="pl-9" />
                    </div>
                  )}
                </Field>

                <Swap state={d.type === "stdio"} y={6}>
                  {d.type === "stdio" ? (
                    <Field label="Command" error={show("commandLine")} hint={show("commandLine") ? undefined : args.length ? `${command} with ${args.length} argument${args.length === 1 ? "" : "s"}` : "The full line from the README — quotes are respected, arguments split for you."}>
                      {(w) => (
                        <div className="flex flex-col gap-2">
                          <Input {...w} mono value={d.commandLine} onChange={(e) => patch({ commandLine: e.target.value })} onBlur={() => setTouched((t) => ({ ...t, commandLine: true }))} placeholder="npx -y @modelcontextprotocol/server-postgres" spellCheck={false} autoCapitalize="off" />
                          <Tokens line={d.commandLine} />
                        </div>
                      )}
                    </Field>
                  ) : (
                    <Field label="Endpoint URL" error={show("url")} hint={show("url") ? undefined : d.type === "sse" ? "Usually ends in /sse." : "Usually ends in /mcp."}>
                      {(w) => <Input {...w} mono value={d.url} onChange={(e) => patch({ url: e.target.value })} onBlur={() => setTouched((t) => ({ ...t, url: true }))} placeholder={d.type === "sse" ? "https://mcp.example.com/sse" : "https://mcp.example.com/mcp"} spellCheck={false} inputMode="url" autoCapitalize="off" />}
                    </Field>
                  )}
                </Swap>

                {d.type !== "stdio" && <KVRows label="Headers" rows={d.headers} onChange={(headers) => patch({ headers })} keyPlaceholder="Authorization" valuePlaceholder="Bearer …" addLabel="Add header" hint="Sent with every request" />}
                <KVRows label="Environment" rows={d.env} onChange={(env) => patch({ env })} keyPlaceholder={d.type === "stdio" ? "DATABASE_URL" : "API_KEY"} valuePlaceholder="value" addLabel="Add variable" hint={d.type === "stdio" ? "Set for the process in the sandbox" : "Available to the agent's run"} />

                <Preview name={d.name.trim()} def={def} />
              </div>
            )}
          </Swap>

          <Collapse open={!!err}>
            <p className="bg-destructive/10 text-destructive rounded-lg px-3 py-2 text-meta" role="alert">
              {err}
            </p>
          </Collapse>
        </div>

        <div className="bg-popover sticky bottom-0 mt-auto flex items-center gap-2 border-t px-6 py-4">
          {initial && <ArmButton size="sm" variant="ghost" icon={<Trash2 />} label="Remove" armedLabel={`Remove ${initial.name}?`} onConfirm={remove} disabled={busy} className="text-muted-foreground hover:text-destructive" />}
          <span className="text-faint ml-auto hidden items-center gap-1 text-micro sm:inline-flex">
            <Kbd>⌘</Kbd>
            <Kbd>↵</Kbd> save · <Kbd>Esc</Kbd> close
          </span>
          <Button type="button" size="sm" variant="ghost" onClick={onClose} className="ml-auto sm:ml-0">
            Cancel
          </Button>
          <Button type="submit" size="sm" loading={busy} disabled={mode === "fields" && submitted && !valid} className="min-w-[6rem]">
            <Check />
            {initial ? "Save" : "Add server"}
          </Button>
        </div>
      </form>
    </SheetContent>
  );
}
