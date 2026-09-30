import * as React from "react";
import { ArrowLeft, Download, Plus, Search, X } from "lucide-react";
import { AnimatePresence, type HTMLMotionProps, motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import { api, type SkillView } from "@/lib/api";
import { useCached } from "@/lib/cache";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Swap } from "@/components/ui/swap";
import { ImportDialog } from "@/components/skills/ImportDialog";
import { type Draft, type Mutate, sourceOf } from "@/components/skills/model";
import { SkillEditor } from "@/components/skills/SkillEditor";
import { EmptyState, SkillList, SkillListSkeleton, TemplateStrip } from "@/components/skills/SkillLibrary";
import { SkillRail } from "@/components/skills/SkillRail";
import { fmtAgo } from "@/lib/format";

/**
 * Skills: the playbooks every sandbox gets. Two surfaces in one page — the library (a list with
 * search `/`, filter chips and a curated template strip) and the editor, which takes the whole page
 * when a skill is opened and slides back out to the list. Import is a dialog over the library.
 * `n` starts a new skill while the list has focus.
 */

type Filter = "all" | "on" | "off" | "starter" | "custom";
type Editing = { initial?: SkillView; draft?: Draft; key: number };

export function SkillsPage({ onBack }: { onBack: () => void }) {
  const still = useReducedMotion();
  const cached = useCached("skills", (signal) => api.skills(signal));
  const skills = cached.data?.skills ?? null;
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<Filter>("all");
  const [editing, setEditing] = React.useState<Editing | null>(null);
  const [importing, setImporting] = React.useState<{ repo?: string } | null>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const seq = React.useRef(0);
  const open = React.useCallback((e: Omit<Editing, "key">) => setEditing({ ...e, key: ++seq.current }), []);

  const mutate = React.useCallback<Mutate>(
    async (body, ok) => {
      const r = await api.skillMutate(body);
      cached.setData(r);
      if (ok) toast.success(ok);
      return r;
    },
    [cached]
  );

  const newSkill = React.useCallback(() => open({ draft: { name: "", description: "", content: "" } }), [open]);

  // `/` focuses search, `n` starts a skill — only while the library is the surface.
  React.useEffect(() => {
    if (editing || importing) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/" && skills?.length) {
        e.preventDefault();
        e.stopImmediatePropagation();
        searchRef.current?.focus();
      } else if (e.key === "n") {
        e.stopImmediatePropagation();
        newSkill();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [editing, importing, skills, newSkill]);

  const q = query.trim().toLowerCase();
  const counts = React.useMemo(() => {
    const c = { all: 0, on: 0, off: 0, starter: 0, custom: 0 };
    for (const s of skills ?? []) {
      c.all++;
      c[s.enabled ? "on" : "off"]++;
      c[sourceOf(s.name)]++;
    }
    return c;
  }, [skills]);
  const visible = (skills ?? []).filter((s) => {
    if (filter === "on" && !s.enabled) return false;
    if (filter === "off" && s.enabled) return false;
    if ((filter === "starter" || filter === "custom") && sourceOf(s.name) !== filter) return false;
    return !q || `${s.name} ${s.description}`.toLowerCase().includes(q);
  });
  const existing = React.useMemo(() => Object.fromEntries((skills ?? []).map((s) => [s.name, true as const])), [skills]);
  const filtered = !!q || filter !== "all";
  const lastEdited = React.useMemo(() => (skills?.length ? Math.max(...skills.map((s) => s.updatedAt)) : 0), [skills]);

  const EASE = [0.22, 1, 0.36, 1] as const;
  const slide = (dir: 1 | -1): Pick<HTMLMotionProps<"div">, "initial" | "animate" | "exit" | "transition"> => ({
    initial: still ? { opacity: 0 } : { opacity: 0, x: 24 * dir },
    animate: { opacity: 1, x: 0 },
    exit: still ? { opacity: 0 } : { opacity: 0, x: -16 * dir, transition: { duration: 0.14, ease: EASE } },
    transition: { duration: 0.22, ease: EASE },
  });

  return (
    <div className="relative h-full min-h-0 min-w-0 overflow-hidden">
      <AnimatePresence mode="popLayout" initial={false}>
        {editing ? (
          <motion.div key={`editor-${editing.key}`} {...slide(1)} className="absolute inset-0">
            <SkillEditor
              initial={editing.initial}
              draft={editing.draft}
              onMutate={mutate}
              onSaved={(s) => setEditing((e) => (e ? { ...e, initial: s, draft: undefined } : e))}
              onClose={() => setEditing(null)}
            />
          </motion.div>
        ) : (
          <motion.div key="library" {...slide(-1)} className="absolute inset-0 overflow-y-auto">
            <div className="mx-auto max-w-6xl px-5 py-6 md:px-8 md:py-8">
              <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 mb-3 md:hidden" aria-label="Back to machines">
                <ArrowLeft className="size-4" />
                Machines
              </Button>

              <header className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div className="min-w-0">
                  <h1 className="text-foreground font-serif text-h1 font-normal tracking-[-0.01em]">Skills</h1>
                  <p className="text-muted-foreground mt-1 text-meta">
                    {skills && skills.length > 0 ? (
                      <span className="tabular">
                        {skills.length} skill{skills.length === 1 ? "" : "s"} · {counts.on} on
                        {lastEdited > 0 && <> · edited {fmtAgo(Math.floor(lastEdited / 1000))}</>}
                      </span>
                    ) : (
                      <>
                        Playbooks every sandbox follows — invoke one with <span className="stamp text-foreground">/name</span> in chat, or the agent picks it up when it fits.
                      </>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => setImporting({})}>
                    <Download />
                    Import
                  </Button>
                  <Button size="sm" onClick={newSkill}>
                    <Plus />
                    New skill
                    <Kbd className="text-primary-foreground/70 border-primary-foreground/20 hidden bg-transparent sm:inline-flex">n</Kbd>
                  </Button>
                </div>
              </header>

              {cached.error && (
                <p role="alert" className="text-destructive mb-4 text-meta">
                  {cached.error}
                </p>
              )}

              <div className={cn("grid gap-10", skills && skills.length > 0 && "xl:grid-cols-[minmax(0,1fr)_17rem] xl:gap-12")}>
                <div className="min-w-0">
                  {skills && skills.length > 0 && (
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <label className="bg-card focus-within:border-ring focus-within:ring-ring/40 flex h-9 min-w-0 basis-full items-center gap-2 rounded-lg border px-3 transition-[border-color,box-shadow] duration-150 focus-within:ring-2 sm:basis-auto sm:flex-1 sm:max-w-xs">
                        <Search className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
                        <input
                          ref={searchRef}
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          onKeyDown={(e) => e.key === "Escape" && (query ? setQuery("") : e.currentTarget.blur())}
                          placeholder="Search skills"
                          aria-label="Search skills"
                          className="text-foreground placeholder:text-muted-foreground h-full w-full min-w-0 bg-transparent text-meta outline-none"
                        />
                        {query ? (
                          <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="text-muted-foreground hover:text-foreground cursor-pointer">
                            <X className="size-3.5" />
                          </button>
                        ) : (
                          <Kbd className="hidden sm:inline-flex">/</Kbd>
                        )}
                      </label>
                      <div role="radiogroup" aria-label="Filter skills" className="flex flex-wrap items-center gap-1">
                        <FilterChip active={filter === "all"} onClick={() => setFilter("all")} label="All" count={counts.all} />
                        <FilterChip active={filter === "on"} onClick={() => setFilter("on")} label="On" count={counts.on} />
                        <FilterChip active={filter === "off"} onClick={() => setFilter("off")} label="Off" count={counts.off} />
                        {counts.starter > 0 && counts.custom > 0 && (
                          <>
                            <FilterChip active={filter === "starter"} onClick={() => setFilter("starter")} label="Starter" count={counts.starter} />
                            <FilterChip active={filter === "custom"} onClick={() => setFilter("custom")} label="Yours" count={counts.custom} />
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  <Swap state={skills === null ? "loading" : skills.length === 0 ? "empty" : visible.length === 0 ? "none" : "list"}>
                    {skills === null ? (
                      <SkillListSkeleton />
                    ) : skills.length === 0 ? (
                      <EmptyState onPick={(d) => open({ draft: d })} onNew={newSkill} onImport={() => setImporting({})} />
                    ) : visible.length === 0 ? (
                      <div className="rounded-xl border border-dashed py-12 text-center">
                        <p className="text-foreground text-lead font-medium">Nothing matches</p>
                        <p className="text-muted-foreground mt-1 text-meta">{q ? `No skill matches “${query.trim()}”` : "No skill in this filter"}.</p>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="mt-3"
                          onClick={() => {
                            setQuery("");
                            setFilter("all");
                          }}
                        >
                          Clear filters
                        </Button>
                      </div>
                    ) : (
                      <SkillList skills={visible} onOpen={(s) => open({ initial: s })} onMutate={mutate} />
                    )}
                  </Swap>
                  {skills && skills.length > 0 && skills.length <= 6 && !filtered && <TemplateStrip existing={existing} onPick={(d) => open({ draft: d })} onNew={newSkill} />}
                </div>

                {skills && skills.length > 0 && <SkillRail skills={skills} onOpen={(s) => open({ initial: s })} onImport={(repo) => setImporting({ repo })} className="xl:sticky xl:top-2 xl:self-start" />}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ImportDialog
        open={!!importing}
        presetRepo={importing?.repo}
        onClose={() => setImporting(null)}
        existing={existing}
        onImported={async (count) => {
          cached.setData(await api.skills());
          toast.success(`Imported ${count} skill${count === 1 ? "" : "s"} — every sandbox gets them on its next turn`);
        }}
        onEditOne={(d) => {
          setImporting(null);
          open({ draft: d });
        }}
      />
    </div>
  );
}

function FilterChip({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      disabled={count === 0 && !active}
      className={cn(
        "flex h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-meta font-medium transition-[background-color,border-color,color,transform] duration-150",
        "disabled:cursor-default disabled:opacity-45",
        active ? "border-foreground/20 bg-foreground text-background" : "bg-card text-muted-foreground hover:text-foreground hover:border-line-strong active:scale-[0.97]"
      )}
    >
      {label}
      <span className={cn("tabular rounded-full px-1.5 py-px text-micro font-semibold", active ? "bg-background/20 text-background" : "bg-muted text-muted-foreground")}>{count}</span>
    </button>
  );
}
