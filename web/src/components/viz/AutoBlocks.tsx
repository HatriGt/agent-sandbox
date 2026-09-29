import * as React from "react";
import { AlertTriangle, ArrowRight, ArrowUpRight, Book, Check, CircleDot, Copy, Eye, EyeOff, File, Folder, GitCommitHorizontal, GitPullRequest, Link2, Link as LinkIcon, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { VizFrame } from "./VizFrame";
import type { CommandLine, Comparison, CronSpec, EnvVar, FileEntry, IniSection, JwtDecoded, LinkItem, StackTrace, UrlParts } from "@/lib/viz-auto-types";

/**
 * Renderers for the automatic visualizers (lib/viz-auto.ts). Same rules as every other block:
 * VizFrame card, tokens only, state carried by a glyph and a word as well as a colour, the raw
 * source one click away.
 */

function CopyIcon({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = React.useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          window.setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard blocked */
        }
      }}
      aria-label={label}
      className="text-muted-foreground hover:text-foreground grid size-6 shrink-0 cursor-pointer place-items-center rounded-md opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-60"
    >
      {done ? <Check className="pop-in text-ok size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

// ---------------------------------------------------------------- env

export function EnvBlock({ vars, source }: { vars: EnvVar[]; source: string }) {
  const [shown, setShown] = React.useState<Set<string>>(new Set());
  const secrets = vars.filter((v) => v.secret).length;
  const allShown = secrets > 0 && vars.every((v) => !v.secret || shown.has(v.key));
  const toggleAll = () => setShown(allShown ? new Set() : new Set(vars.filter((v) => v.secret).map((v) => v.key)));
  return (
    <VizFrame
      title={`env · ${vars.length} ${vars.length === 1 ? "variable" : "variables"}`}
      source={source}
      rawLanguage="bash"
      actions={
        secrets > 0 && (
          <button type="button" onClick={toggleAll} className="text-muted-foreground hover:text-foreground mr-1 flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-micro">
            {allShown ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
            {allShown ? "Hide secrets" : `${secrets} ${secrets === 1 ? "secret" : "secrets"} masked`}
          </button>
        )
      }
    >
      <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-5 px-4 py-2">
        {vars.map((v) => {
          const visible = !v.secret || shown.has(v.key);
          return (
            <div key={v.key} className="group/row contents">
              <dt className="text-foreground flex items-center py-1 font-mono text-code font-medium">{v.key}</dt>
              <dd className="m-0 flex min-w-0 items-center gap-1.5 py-1">
                <span className={cn("min-w-0 truncate font-mono text-code", visible ? "text-muted-foreground" : "text-faint tracking-[0.2em]")}>{visible ? v.value || "∅" : "••••••••"}</span>
                {v.secret && (
                  <button type="button" onClick={() => setShown((s) => new Set(visible ? [...s].filter((k) => k !== v.key) : [...s, v.key]))} aria-label={visible ? "Hide value" : "Reveal value"} className="text-muted-foreground hover:text-foreground grid size-6 shrink-0 cursor-pointer place-items-center rounded-md">
                    {visible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </button>
                )}
                <CopyIcon text={v.value} label={`Copy ${v.key}`} />
                {v.comment && <span className="text-faint ml-auto hidden truncate text-micro sm:inline">{v.comment}</span>}
              </dd>
            </div>
          );
        })}
      </dl>
    </VizFrame>
  );
}

// ---------------------------------------------------------------- stack trace

export function StackTraceBlock({ trace, source }: { trace: StackTrace; source: string }) {
  const [vendors, setVendors] = React.useState(false);
  const firstApp = trace.frames.findIndex((f) => !f.vendor);
  // Runs of vendor frames fold into one disclosure row each, so the app's own frames stand out.
  const rows: ({ kind: "frame"; i: number } | { kind: "fold"; from: number; to: number })[] = [];
  for (let i = 0; i < trace.frames.length; i++) {
    if (trace.frames[i].vendor && !vendors) {
      let j = i;
      while (j < trace.frames.length && trace.frames[j].vendor) j++;
      rows.push({ kind: "fold", from: i, to: j });
      i = j - 1;
    } else rows.push({ kind: "frame", i });
  }
  const folded = trace.frames.filter((f) => f.vendor).length;
  return (
    <VizFrame title={`${trace.language === "js" ? "JavaScript" : trace.language === "py" ? "Python" : trace.language === "java" ? "Java" : trace.language === "go" ? "Go" : trace.language === "rust" ? "Rust" : ""} stack trace · ${trace.frames.length} frames`.trim()} source={source}>
      <div className="border-destructive/30 bg-destructive/6 border-l-2 px-4 py-2.5">
        <p className="text-destructive m-0 flex items-start gap-2 text-meta font-medium">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 break-words">{trace.message}</span>
        </p>
      </div>
      <ol className="m-0 list-none p-0 font-mono text-code">
        {rows.map((r, k) =>
          r.kind === "fold" ? (
            <li key={k} className="border-t">
              <button type="button" onClick={() => setVendors(true)} className="text-faint hover:text-muted-foreground flex w-full cursor-pointer items-center gap-2 px-4 py-1 text-left text-micro">
                <span className="opacity-60">⋯</span>
                {r.to - r.from} framework {r.to - r.from === 1 ? "frame" : "frames"}
              </button>
            </li>
          ) : (
            <li key={k} className={cn("flex items-baseline gap-3 border-t px-4 py-1", r.i === firstApp && "bg-attention/10", trace.frames[r.i].vendor && "text-faint")}>
              <span className="text-faint w-5 shrink-0 text-right tabular-nums">{r.i + 1}</span>
              <span className={cn("min-w-0 truncate", trace.frames[r.i].vendor ? "" : "text-foreground font-medium")}>{trace.frames[r.i].fn ?? "<anonymous>"}</span>
              {trace.frames[r.i].file && (
                <span className="text-muted-foreground ml-auto shrink-0 truncate text-micro">
                  {trace.frames[r.i].file}
                  {trace.frames[r.i].line != null && `:${trace.frames[r.i].line}`}
                  {trace.frames[r.i].col != null && `:${trace.frames[r.i].col}`}
                </span>
              )}
            </li>
          )
        )}
      </ol>
      {vendors && folded > 0 && (
        <button type="button" onClick={() => setVendors(false)} className="text-faint hover:text-muted-foreground w-full cursor-pointer border-t px-4 py-1 text-left text-micro">
          Hide framework frames
        </button>
      )}
    </VizFrame>
  );
}

// ---------------------------------------------------------------- files

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) (v /= 1024), i++;
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}

export function FileListBlock({ entries, source }: { entries: FileEntry[]; source: string }) {
  const sorted = [...entries].sort((a, b) => (a.kind === "dir" ? 0 : 1) - (b.kind === "dir" ? 0 : 1));
  const max = Math.max(...entries.map((e) => e.bytes ?? 0), 1);
  const total = entries.reduce((n, e) => n + (e.kind === "file" ? e.bytes ?? 0 : 0), 0);
  return (
    <VizFrame title={`${entries.length} ${entries.length === 1 ? "entry" : "entries"}`} source={source}>
      <ul className="m-0 list-none p-0">
        {sorted.map((e, i) => (
          <li key={e.name} className={cn("flex items-center gap-3 px-4 py-1.5 text-meta", i > 0 && "border-t")}>
            {e.kind === "dir" ? <Folder className="text-live size-3.5 shrink-0" aria-label="folder" /> : e.kind === "link" ? <Link2 className="text-muted-foreground size-3.5 shrink-0" aria-label="link" /> : <File className="text-muted-foreground size-3.5 shrink-0" aria-hidden />}
            <span className={cn("min-w-0 flex-1 truncate font-mono text-code", e.kind === "dir" ? "text-foreground font-medium" : "text-foreground")}>{e.name}</span>
            {e.modified && <span className="text-faint hidden shrink-0 text-micro sm:inline">{e.modified}</span>}
            <span className="flex w-28 shrink-0 items-center justify-end gap-2">
              {e.bytes != null && e.kind !== "dir" && (
                <span className="bg-muted h-1 w-10 overflow-hidden rounded-full" aria-hidden>
                  <span className="bg-live/70 block h-full rounded-full" style={{ width: `${Math.max(4, (e.bytes / max) * 100)}%` }} />
                </span>
              )}
              <span className="text-muted-foreground text-micro tabular-nums">{e.bytes != null ? humanBytes(e.bytes) : e.sizeText ?? ""}</span>
            </span>
          </li>
        ))}
      </ul>
      {total > 0 && <p className="text-faint m-0 border-t px-4 py-1.5 text-right text-micro tabular-nums">{humanBytes(total)} in files</p>}
    </VizFrame>
  );
}

// ---------------------------------------------------------------- links

const LINK_ICON: Record<LinkItem["kind"], React.ReactNode> = {
  pr: <GitPullRequest className="size-3.5" />,
  issue: <CircleDot className="size-3.5" />,
  commit: <GitCommitHorizontal className="size-3.5" />,
  repo: <Book className="size-3.5" />,
  doc: <Book className="size-3.5" />,
  other: <LinkIcon className="size-3.5" />,
};

export function LinksBlock({ links, source }: { links: LinkItem[]; source: string }) {
  return (
    <VizFrame title={`${links.length} ${links.length === 1 ? "link" : "links"}`} source={source}>
      <ul className="m-0 grid list-none gap-1.5 p-2 sm:grid-cols-2">
        {links.map((l) => (
          <li key={l.url} className="min-w-0">
            <a href={l.url} target="_blank" rel="noopener noreferrer" className="group/link hover:bg-muted hover:border-line-strong flex min-w-0 items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors">
              <span className={cn("grid size-7 shrink-0 place-items-center rounded-md", l.kind === "pr" ? "bg-ok/12 text-ok" : l.kind === "issue" ? "bg-attention/25 text-attention-text" : l.kind === "commit" ? "bg-live/12 text-live" : "bg-muted text-muted-foreground")}>{LINK_ICON[l.kind]}</span>
              <span className="min-w-0 flex-1">
                <span className="text-foreground block truncate text-meta font-medium">{l.label ?? l.ref ?? l.url.replace(/^https?:\/\//, "")}</span>
                <span className="text-faint block truncate text-micro">{l.ref && l.label ? `${l.ref} · ` : ""}{l.host}</span>
              </span>
              <ArrowUpRight className="text-muted-foreground size-3.5 shrink-0 opacity-0 transition-opacity group-hover/link:opacity-100" aria-hidden />
            </a>
          </li>
        ))}
      </ul>
    </VizFrame>
  );
}

// ---------------------------------------------------------------- commands

export function CommandBlock({ commands, source }: { commands: CommandLine[]; source: string }) {
  const [all, setAll] = React.useState(false);
  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(commands.map((c) => c.cmd).join("\n"));
      setAll(true);
      window.setTimeout(() => setAll(false), 1500);
    } catch {
      /* blocked */
    }
  };
  return (
    <VizFrame
      title={`${commands.length} ${commands.length === 1 ? "command" : "commands"}`}
      source={source}
      rawLanguage="bash"
      actions={
        commands.length > 1 && (
          <button type="button" onClick={copyAll} className="text-muted-foreground hover:text-foreground mr-1 flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-micro">
            {all ? <Check className="text-ok size-3" /> : <Copy className="size-3" />}
            {all ? "Copied" : "Copy all"}
          </button>
        )
      }
    >
      <div className="bg-trace text-trace-fg flex flex-col">
        {commands.map((c, i) => (
          <div key={i} className="group/row flex flex-col">
            {c.comment && <span className="text-trace-fg/50 px-4 pt-2 font-mono text-micro"># {c.comment}</span>}
            <div className="flex items-center gap-2 px-4 py-1.5">
              <span className="text-ok shrink-0 select-none font-mono text-code" aria-hidden>
                $
              </span>
              {/* A span, not <code>: the prose inline-code chip style would paint it. */}
              <span className="min-w-0 flex-1 font-mono text-code whitespace-pre-wrap [overflow-wrap:anywhere]">{c.cmd}</span>
              <CopyIcon text={c.cmd} />
            </div>
          </div>
        ))}
      </div>
    </VizFrame>
  );
}

// ---------------------------------------------------------------- comparison

function fmt(n: number, unit?: string): string {
  const s = Math.abs(n) >= 1000 ? Math.round(n).toLocaleString() : Number.isInteger(n) ? String(n) : n.toFixed(n < 1 ? 2 : 1);
  return unit ? `${s}${unit.length <= 2 ? "" : " "}${unit}` : s;
}

export function ComparisonBlock({ rows, source }: { rows: Comparison[]; source: string }) {
  return (
    <VizFrame title="Before → after" source={source}>
      <ul className="m-0 list-none p-0">
        {rows.map((r, i) => {
          const numeric = r.beforeNum != null && r.afterNum != null;
          const delta = numeric ? r.afterNum! - r.beforeNum! : 0;
          const pct = numeric && r.beforeNum ? (delta / Math.abs(r.beforeNum)) * 100 : null;
          const improved = r.betterWhen ? (r.betterWhen === "lower" ? delta < 0 : delta > 0) : null;
          const tone = !numeric || delta === 0 ? "text-muted-foreground bg-muted" : improved === null ? "text-live bg-live/12" : improved ? "text-ok bg-ok/12" : "text-destructive bg-destructive/12";
          const max = numeric ? Math.max(Math.abs(r.beforeNum!), Math.abs(r.afterNum!), 1e-9) : 1;
          return (
            <li key={i} className={cn("flex flex-col gap-1.5 px-4 py-2.5", i > 0 && "border-t")}>
              <div className="flex items-center gap-3">
                <span className="text-foreground min-w-0 flex-1 truncate text-meta font-medium">{r.label}</span>
                <span className="text-muted-foreground text-meta tabular-nums">{numeric ? fmt(r.beforeNum!, r.unit) : r.before}</span>
                <ArrowRight className="text-faint size-3.5 shrink-0" aria-hidden />
                <span className="text-foreground text-meta font-semibold tabular-nums">{numeric ? fmt(r.afterNum!, r.unit) : r.after}</span>
                <span className={cn("inline-flex w-16 items-center justify-center gap-1 rounded-md px-1.5 py-0.5 text-micro font-medium tabular-nums", tone)}>
                  {numeric && delta !== 0 ? delta < 0 ? <TrendingDown className="size-3" /> : <TrendingUp className="size-3" /> : <Minus className="size-3" />}
                  {pct != null ? `${pct > 0 ? "+" : ""}${Math.round(pct)}%` : numeric ? fmt(delta, r.unit) : "—"}
                </span>
              </div>
              {numeric && (
                <span className="flex flex-col gap-0.5" aria-hidden>
                  <span className="bg-muted h-0.75 w-full overflow-hidden rounded-full"><span className="bg-faint/50 block h-full rounded-full" style={{ width: `${(Math.abs(r.beforeNum!) / max) * 100}%` }} /></span>
                  <span className="bg-muted h-0.75 w-full overflow-hidden rounded-full"><span className={cn("block h-full rounded-full", improved === false ? "bg-destructive/70" : "bg-live")} style={{ width: `${(Math.abs(r.afterNum!) / max) * 100}%` }} /></span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </VizFrame>
  );
}

// ---------------------------------------------------------------- cron

export function CronBlock({ specs, source }: { specs: CronSpec[]; source: string }) {
  return (
    <VizFrame title={`${specs.length === 1 ? "Schedule" : `${specs.length} schedules`}`} source={source}>
      <ul className="m-0 list-none p-0">
        {specs.map((s, i) => (
          <li key={i} className={cn("px-4 py-3", i > 0 && "border-t")}>
            <p className="text-foreground m-0 text-body font-medium">{s.description}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {s.expr.startsWith("@") ? (
                <span className="bg-muted rounded-md px-2 py-1 font-mono text-code">{s.expr}</span>
              ) : (
                s.fields.map((f) => (
                  <span key={f.label} className="bg-muted flex flex-col items-center rounded-md px-2 py-1" title={f.meaning}>
                    <span className="text-foreground font-mono text-code">{f.value}</span>
                    <span className="text-faint text-[10px] leading-tight">{f.label}</span>
                  </span>
                ))
              )}
            </div>
          </li>
        ))}
      </ul>
    </VizFrame>
  );
}

// ---------------------------------------------------------------- url

export function UrlBlock({ url, source }: { url: UrlParts; source: string }) {
  const segs = url.path.split("/").filter(Boolean);
  return (
    <VizFrame title="URL" source={source}>
      <div className="flex flex-wrap items-center gap-1 px-4 py-3 font-mono text-code">
        <span className="text-faint">{url.protocol}://</span>
        <span className="text-foreground font-medium">{url.host}</span>
        {segs.map((s, i) => (
          <React.Fragment key={i}>
            <span className="text-faint">/</span>
            <span className="bg-muted text-foreground rounded px-1.5 py-0.5">{decodeURIComponent(s)}</span>
          </React.Fragment>
        ))}
        {url.hash && <span className="text-live">#{url.hash}</span>}
      </div>
      {url.query.length > 0 && (
        <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-5 border-t px-4 py-2">
          {url.query.map((q, i) => (
            <div key={i} className="group/row contents">
              <dt className="text-muted-foreground py-0.5 font-mono text-code">{q.key}</dt>
              <dd className="m-0 flex min-w-0 items-center gap-1 py-0.5">
                <span className="text-foreground min-w-0 truncate font-mono text-code">{q.value || "∅"}</span>
                <CopyIcon text={q.value} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </VizFrame>
  );
}

// ---------------------------------------------------------------- jwt

function claimText(k: string, v: unknown): string {
  if ((k === "exp" || k === "iat" || k === "nbf") && typeof v === "number") return `${v} · ${new Date(v * 1000).toLocaleString()}`;
  return typeof v === "string" ? v : JSON.stringify(v);
}
function rel(sec: number): string {
  const d = Math.abs(sec);
  const u = d < 60 ? [d, "s"] : d < 3600 ? [Math.round(d / 60), "m"] : d < 86400 ? [Math.round(d / 3600), "h"] : [Math.round(d / 86400), "d"];
  return `${u[0]}${u[1]}`;
}

export function JwtBlock({ jwt, source }: { jwt: JwtDecoded; source: string }) {
  const left = jwt.exp != null ? jwt.exp - Date.now() / 1000 : null;
  return (
    <VizFrame
      title="JWT · decoded, not verified"
      source={source}
      actions={
        left != null && (
          <span className={cn("mr-1 rounded-md px-1.5 py-0.5 text-micro font-medium", jwt.expired ? "bg-destructive/12 text-destructive" : "bg-ok/12 text-ok")}>
            {jwt.expired ? `expired ${rel(left)} ago` : `expires in ${rel(left)}`}
          </span>
        )
      }
    >
      {[
        ["header", jwt.header],
        ["payload", jwt.payload],
      ].map(([name, obj]) => (
        <div key={name as string} className="border-t first:border-t-0">
          <p className="label text-faint m-0 px-4 pt-2">{name as string}</p>
          <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-5 px-4 pt-1 pb-2">
            {Object.entries(obj as Record<string, unknown>).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground py-0.5 font-mono text-code">{k}</dt>
                <dd className="text-foreground m-0 min-w-0 truncate py-0.5 font-mono text-code">{claimText(k, v)}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </VizFrame>
  );
}

// ---------------------------------------------------------------- ini

export function IniBlock({ sections, source }: { sections: IniSection[]; source: string }) {
  return (
    <VizFrame title={`${sections.length} ${sections.length === 1 ? "section" : "sections"}`} source={source} rawLanguage="ini">
      {sections.map((s, i) => (
        <div key={s.name ?? i} className={cn(i > 0 && "border-t")}>
          {s.name && <p className="text-foreground m-0 px-4 pt-2.5 font-mono text-code font-semibold">[{s.name}]</p>}
          <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-6 px-4 pt-1 pb-2.5">
            {s.rows.map((r) => (
              <div key={r.key} className="contents">
                <dt className="text-muted-foreground py-0.5 font-mono text-code">{r.key}</dt>
                <dd className="text-foreground m-0 min-w-0 py-0.5 font-mono text-code break-all">{r.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </VizFrame>
  );
}

