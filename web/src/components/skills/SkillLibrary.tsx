import * as React from "react";
import { ArrowUpRight, Download, Files, PenLine, Plus, Sparkles, Zap } from "lucide-react";
import { toast } from "sonner";
import type { SkillView } from "@/lib/api";
import { fmtAgo } from "@/lib/format";
import { SkillMark } from "@/lib/skillGlyph";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Switch } from "@/components/ui/switch";
import { StaggerItem } from "@/components/ui/swap";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DataTable, MetaLine, StatusDot, type Column } from "@/components/ui/data-table";
import { byteLength, type Draft, fmtKb, type Mutate, type SkillSource, sourceOf, TEMPLATES } from "./model";

/* ───────────────────────────── table ───────────────────────────── */

/** SKILL.md plus every attached file, in bytes. */
const sizeOf = (s: SkillView) => byteLength(s.content) + (s.files ?? []).reduce((n, f) => n + byteLength(f.content), 0);

const COLUMNS: Column<SkillView>[] = [
  {
    id: "name",
    header: "Name",
    primary: true,
    sort: (s) => s.name,
    cell: (s) => (
      <span className={cn("flex min-w-0 items-center gap-3 transition-opacity duration-200", !s.enabled && "opacity-55")}>
        <SkillTile name={s.name} enabled={s.enabled} />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="stamp text-foreground truncate text-[13px] font-medium">/{s.name}</span>
          <MetaLine parts={[<span title={s.description}>{s.description}</span>]} />
        </span>
      </span>
    ),
  },
  {
    id: "source",
    header: "Source",
    width: "w-28",
    hideBelow: "md",
    sort: (s) => sourceOf(s.name),
    cell: (s) => (sourceOf(s.name) === "starter" ? <SourceBadge source="starter" /> : <span>Yours</span>),
  },
  {
    id: "scope",
    header: "Scope",
    width: "w-36",
    sort: (s) => (s.enabled ? 0 : 1),
    cell: (s) => <StatusDot tone={s.enabled ? "live" : "muted"}>{s.enabled ? "Every sandbox" : "Off"}</StatusDot>,
  },
  {
    id: "size",
    header: "Files",
    width: "w-28",
    align: "end",
    hideBelow: "sm",
    sort: sizeOf,
    cell: (s) => {
      const files = (s.files?.length ?? 0) + 1;
      return (
        <span className="tabular inline-flex items-center gap-2" title={`${files} file${files > 1 ? "s" : ""}`}>
          <span className="inline-flex items-center gap-1">
            <Files className="size-3" aria-hidden />
            {files}
          </span>
          <span className="text-faint">{fmtKb(sizeOf(s))}</span>
        </span>
      );
    },
  },
  {
    id: "updated",
    header: "Updated",
    width: "w-28",
    hideBelow: "lg",
    sort: (s) => s.updatedAt,
    cell: (s) => <span className="tabular">{fmtAgo(Math.floor(s.updatedAt / 1000))}</span>,
  },
];

/**
 * The library as a table: `/name` with its glyph and "when" line, source, scope, files + weight,
 * last edit. The row opens the editor; the trailing cell holds Edit and the on/off switch.
 */
export function SkillTable({ skills, loading, onOpen, onMutate, toolbar, empty }: { skills: SkillView[]; loading?: boolean; onOpen: (s: SkillView) => void; onMutate: Mutate; toolbar?: React.ReactNode; empty?: React.ReactNode }) {
  return (
    <DataTable
      aria-label="Skills"
      rows={skills}
      columns={COLUMNS}
      rowKey={(s) => s.name}
      onRowClick={onOpen}
      rowLabel={(s) => `Edit skill ${s.name}`}
      loading={loading}
      search={{ placeholder: "Search skills", text: (s) => `${s.name} ${s.description}` }}
      toolbar={toolbar}
      actions={(s) => <SkillActions skill={s} onOpen={() => onOpen(s)} onMutate={onMutate} />}
      empty={empty}
      minWidth="min-w-[40rem]"
    />
  );
}

function SkillActions({ skill: s, onOpen, onMutate }: { skill: SkillView; onOpen: () => void; onMutate: Mutate }) {
  const [busy, setBusy] = React.useState(false);
  const toggle = (next: boolean) => {
    setBusy(true);
    onMutate({ action: "toggle", name: s.name, enabled: next })
      .catch((e: unknown) => toast.error("Could not update", { description: e instanceof Error ? e.message : String(e) }))
      .finally(() => setBusy(false));
  };
  return (
    <span className="inline-flex items-center gap-1.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="icon-xs" variant="ghost" onClick={onOpen} aria-label={`Edit ${s.name}`}>
            <PenLine />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Edit</TooltipContent>
      </Tooltip>
      <Tooltip>
        {/* A span, not the Switch itself: TooltipTrigger asChild injects an onClick that Switch's prop spread would let override its own toggle. */}
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <Switch checked={s.enabled} onCheckedChange={toggle} disabled={busy} aria-label={s.enabled ? `Disable ${s.name}` : `Enable ${s.name}`} />
          </span>
        </TooltipTrigger>
        <TooltipContent>{s.enabled ? "On — synced into every sandbox on its next turn" : "Off — kept, not given to the agent"}</TooltipContent>
      </Tooltip>
    </span>
  );
}

/**
 * The skill's glyph as a plain icon — no plate, no tint — sized and coloured like every other icon
 * in a row. Keeps the old tile's footprint so columns don't shift. Enabled reads as muted ink,
 * off as faint ink; the row's hover lifts it to the foreground.
 */
export function SkillTile({ name, enabled = true, className }: { name: string; enabled?: boolean; className?: string }) {
  return (
    <span className={cn("pointer-events-none grid size-8 shrink-0 place-items-center transition-colors duration-200", enabled ? "text-muted-foreground group-hover:text-foreground" : "text-faint", className)} aria-hidden>
      <SkillMark name={name} size={16} />
    </span>
  );
}

/** Where the skill came from: `starter` (seeded by the controller) is marked; your own are quiet. */
export function SourceBadge({ source, className }: { source: SkillSource; className?: string }) {
  if (source === "custom") return null;
  return (
    <span className={cn("text-muted-foreground bg-muted inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-px text-micro", className)} title="Seeded with your account — edit or delete freely">
      <Sparkles className="size-2.5" aria-hidden />
      starter
    </span>
  );
}

/* ───────────────────────────── templates + empty state ───────────────────────────── */

/**
 * A template card reads like the skill it will become: glyph, `/name`, what it is for, and the
 * first line of the playbook in the author's voice. Hover lifts a hair and shows the verb.
 */
function TemplateCard({ t, index, onPick, surface }: { t: (typeof TEMPLATES)[number]; index: number; onPick: (d: Draft) => void; surface: "card" | "background" }) {
  const firstLine = t.content.split("\n")[0].replace(/^\d+\.\s*/, "");
  return (
    <StaggerItem index={index} className="h-full">
      <button
        type="button"
        onClick={() => onPick({ name: t.name, description: t.description, content: t.content })}
        className={cn(
          "group hover:border-line-strong focus-visible:ring-ring/40 flex h-full w-full cursor-pointer flex-col rounded-xl border p-4 text-left outline-none focus-visible:ring-2",
          "transition-[border-color,box-shadow,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.985] [@media(hover:hover)]:hover:-translate-y-px [@media(hover:hover)]:hover:shadow-e2",
          surface === "card" ? "bg-card" : "bg-background"
        )}
      >
        <span className="flex items-center gap-2.5">
          <SkillMark name={t.name} size={16} className="text-muted-foreground group-hover:text-live transition-colors duration-200" />
          <span className="stamp text-foreground text-[13px] font-medium">/{t.name}</span>
          <span className="text-live ml-auto flex items-center gap-1 text-micro font-medium opacity-0 transition-[opacity,transform] duration-150 ease-out group-hover:opacity-100 group-focus-visible:opacity-100 [@media(hover:hover)]:-translate-x-1 [@media(hover:hover)]:group-hover:translate-x-0" aria-hidden>
            Use
            <ArrowUpRight className="size-3" />
          </span>
        </span>
        <span className="text-foreground/90 mt-3 text-meta leading-snug font-medium">{t.blurb}</span>
        <span className="text-muted-foreground mt-1 line-clamp-2 text-micro leading-snug">“{firstLine}”</span>
        <span className="text-faint tabular mt-3 text-micro">{t.steps} steps · edit before it goes live</span>
      </button>
    </StaggerItem>
  );
}

/**
 * Templates, shown under a short list: the three playbooks most teams want first. Once the list is
 * long the user knows what a skill is and the strip steps aside.
 */
export function TemplateStrip({ existing, onPick, onNew }: { existing: Record<string, true>; onPick: (d: Draft) => void; onNew: () => void }) {
  const open = TEMPLATES.filter((t) => !existing[t.name]);
  if (!open.length) return null;
  return (
    <section aria-labelledby="tpl-h" className="mt-10">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 id="tpl-h" className="text-foreground text-h3 font-semibold tracking-[-0.01em]">
          Start from a template
        </h2>
        <span className="text-muted-foreground text-meta">Opens in the editor — edit before it goes live</span>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {open.map((t, i) => (
          <li key={t.name} className="min-w-0">
            <TemplateCard t={t} index={i} onPick={onPick} surface="card" />
          </li>
        ))}
        {open.length < 3 && (
          <li className="min-w-0">
            <StaggerItem index={open.length} className="h-full">
              <button
                type="button"
                onClick={onNew}
                className="text-muted-foreground hover:text-foreground hover:border-line-strong flex h-full min-h-[7.5rem] w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-meta transition-colors"
              >
                <Plus className="size-4" />
                Blank skill
              </button>
            </StaggerItem>
          </li>
        )}
      </ul>
    </section>
  );
}

/** No skills yet: say what one is in one breath, show how it fires, then three ways in. */
export function EmptyState({ onPick, onNew, onImport }: { onPick: (d: Draft) => void; onNew: () => void; onImport: () => void }) {
  return (
    <div className="enter">
      <div className="bg-card relative overflow-hidden rounded-2xl border p-6 shadow-e1 sm:p-8">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full opacity-60 blur-3xl"
          style={{ background: "radial-gradient(closest-side, color-mix(in oklch, var(--live) 18%, transparent), transparent)" }}
        />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-start md:gap-10">
          <div className="min-w-0 flex-1">
            <span className="bg-live/10 text-live grid size-11 place-items-center rounded-xl" aria-hidden>
              <Zap className="size-5" strokeWidth={1.75} />
            </span>
            <h2 className="text-foreground mt-4 text-h2 font-semibold tracking-[-0.015em]">Teach the agent how you work</h2>
            <p className="text-muted-foreground mt-2 max-w-[46ch] text-body leading-relaxed">
              A skill is a playbook — how you review PRs, cut a release, fix CI — written once as markdown and followed in every sandbox. It fires when you type{" "}
              <span className="stamp text-foreground bg-muted rounded px-1 py-0.5">/name</span> in chat, or on its own when a task matches its description.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button size="sm" onClick={onNew}>
                <PenLine />
                Write your own
                <Kbd className="text-primary-foreground/70 border-primary-foreground/20 hidden bg-transparent sm:inline-flex">n</Kbd>
              </Button>
              <Button size="sm" variant="outline" onClick={onImport}>
                <Download />
                Import from GitHub
              </Button>
            </div>
          </div>
          <ul className="text-meta grid shrink-0 gap-2 md:w-64">
            {[
              ["1", "Write the steps in markdown", "Headings, lists, fenced code — anything the agent can read."],
              ["2", "Give it a name and a “when”", "The name is the /command; the description is what it auto-matches on."],
              ["3", "Save — it is in every sandbox", "Synced on the next turn. Turn it off any time without deleting."],
            ].map(([n, t, d]) => (
              <li key={n} className="bg-background/60 flex items-start gap-3 rounded-lg border px-3 py-2.5">
                <span className="text-muted-foreground stamp mt-0.5 shrink-0">{n}</span>
                <span className="min-w-0">
                  <span className="text-foreground block font-medium">{t}</span>
                  <span className="text-muted-foreground block text-micro leading-snug">{d}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <section aria-labelledby="tpl-empty-h" className="mt-8">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 id="tpl-empty-h" className="text-foreground text-h3 font-semibold tracking-[-0.01em]">
            Or start from a template
          </h2>
          <span className="text-muted-foreground text-meta">Three playbooks most teams want first</span>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TEMPLATES.map((t, i) => (
            <li key={t.name} className="min-w-0">
              <TemplateCard t={t} index={i} onPick={onPick} surface="card" />
            </li>
          ))}
          <li className="min-w-0 sm:col-span-2 lg:col-span-3">
            <button
              type="button"
              onClick={onNew}
              className="text-muted-foreground hover:text-foreground hover:border-line-strong flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed py-3 text-meta transition-colors"
            >
              <Plus className="size-4" />
              Blank skill
            </button>
          </li>
        </ul>
      </section>
    </div>
  );
}
