import * as React from "react";
import { ArrowLeft, Download, Plus } from "lucide-react";
import { AnimatePresence, type HTMLMotionProps, motion } from "motion/react";
import { useReducedMotion } from "@/lib/motion-pref";
import { toast } from "sonner";
import { api, type SkillView } from "@/lib/api";
import { useCached } from "@/lib/cache";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { FilterChip } from "@/components/ui/filter-chip";
import { ImportDialog } from "@/components/skills/ImportDialog";
import { type Draft, type Mutate, sourceOf } from "@/components/skills/model";
import { SkillEditor } from "@/components/skills/SkillEditor";
import { EmptyState, SkillTable, TemplateStrip } from "@/components/skills/SkillLibrary";
import { SkillRail } from "@/components/skills/SkillRail";
import { fmtAgo } from "@/lib/format";

/**
 * Skills: the playbooks every sandbox gets. Two surfaces in one page — the library (a DataTable with
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
  const [filter, setFilter] = React.useState<Filter>("all");
  const [editing, setEditing] = React.useState<Editing | null>(null);
  const [importing, setImporting] = React.useState<{ repo?: string } | null>(null);
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

  // `n` starts a skill — only while the library is the surface (`/` belongs to the table's search).
  React.useEffect(() => {
    if (editing || importing) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (typing || e.metaKey || e.ctrlKey || e.altKey || e.key !== "n") return;
      e.stopImmediatePropagation();
      newSkill();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [editing, importing, newSkill]);

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
    return true;
  });
  const existing = React.useMemo(() => Object.fromEntries((skills ?? []).map((s) => [s.name, true as const])), [skills]);
  const filtered = filter !== "all";
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
                  {skills?.length === 0 ? (
                    <EmptyState onPick={(d) => open({ draft: d })} onNew={newSkill} onImport={() => setImporting({})} />
                  ) : (
                    <SkillTable
                      skills={visible}
                      loading={skills === null}
                      onOpen={(s) => open({ initial: s })}
                      onMutate={mutate}
                      toolbar={
                        <div role="radiogroup" aria-label="Filter skills" className="flex flex-wrap items-center gap-1">
                          <FilterChip group="skills" active={filter === "all"} onClick={() => setFilter("all")} label="All" count={counts.all} />
                          <FilterChip group="skills" active={filter === "on"} onClick={() => setFilter("on")} label="On" count={counts.on} />
                          <FilterChip group="skills" active={filter === "off"} onClick={() => setFilter("off")} label="Off" count={counts.off} />
                          {counts.starter > 0 && counts.custom > 0 && (
                            <>
                              <FilterChip group="skills" active={filter === "starter"} onClick={() => setFilter("starter")} label="Starter" count={counts.starter} />
                              <FilterChip group="skills" active={filter === "custom"} onClick={() => setFilter("custom")} label="Yours" count={counts.custom} />
                            </>
                          )}
                        </div>
                      }
                      empty={
                        <span className="flex flex-col items-center gap-1">
                          <span className="text-foreground text-body font-medium">Nothing matches</span>
                          <span className="text-meta">No skill in this filter.</span>
                          <Button size="xs" variant="ghost" className="mt-2" onClick={() => setFilter("all")}>
                            Clear filters
                          </Button>
                        </span>
                      }
                    />
                  )}
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
