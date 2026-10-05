import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { Brain, Check, ChevronRight, Download, FolderGit2, History, Link2, Pencil, Pin, PinOff, Plus, Search, ShieldCheck, Sparkles, Trash2, Upload, User, X } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError, type MemoryKind, type MemoryNote, type MemoryNotesResponse } from "@/lib/api";
import { useCached } from "@/lib/cache";
import { fmtAgo, friendlyName } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Collapse } from "@/components/ui/collapse";
import { EmptyState } from "@/components/ui/empty-state";
import { inputClass } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { Panel, SettingsPage, SettingsSection } from "@/components/ui/settings";
import { Switch } from "@/components/ui/switch";
import { Bar } from "@/components/thread/Skeletons";
import { FilterChip } from "@/components/ui/filter-chip";
import { Swap } from "@/components/ui/swap";
import { MemoryOverview } from "@/components/memory/MemoryOverview";
import { areaId, sectionId } from "@/components/memory/MemoryGraph";
import { Inline, NoteStatement, noteHeadline } from "@/components/memory/noteText";
import { isOperatorKind, KIND_ICON, KIND_LABEL, KIND_PLURAL, KINDS, plural } from "@/components/memory/kinds";

/**
 * Memory: what earlier runs left for future ones (src/memory-store.ts), typed and scoped.
 *   · You — preferences and rules that follow the operator into every run.
 *   · One knowledge base per repo — its notes filed by AREA (a part of the app: `billing/invoicing`),
 *     each area a page with the code it describes, the areas it links to, and its notes: domain
 *     knowledge first, then decisions, lessons, facts, playbooks. Notes without an area sit last.
 *   · Earlier — notes a newer one replaced; greyed, kept as history, out of MEMORY.md.
 * The sections sit in a rail (You, each repo with its areas, "Any repo", Earlier); one is open at a
 * time so a long list of repos reads as a table of contents, not a scroll. A note a box saved
 * without a repo checked out lands under "Any repo" until it is edited into a repo.
 * A note whose anchored code changed since is "unverified" until a run reaffirms it or the operator
 * marks it verified here.
 * Every row is a stored note; nothing here is derived or guessed. Pending rows are proposals the
 * thread toast did not settle yet — Keep/Forget inline. The header adds a preference or rule by
 * hand, moves the whole set in and out as one Markdown file, and turns the feature off.
 */

const REPO_KINDS: MemoryKind[] = ["domain", "decision", "lesson", "fact", "playbook"];

/** A repo's knowledge base: its areas (pages), biggest first, then the notes filed nowhere. */
type AreaGroup = { area: string; notes: MemoryNote[]; paths: string[]; links: string[]; stale: number };
function areaGroups(list: MemoryNote[]): AreaGroup[] {
  const by = new Map<string, MemoryNote[]>();
  for (const n of list) by.set(n.area ?? "", [...(by.get(n.area ?? "") ?? []), n]);
  const uniq = (xs: string[]) => [...new Set(xs)];
  return [...by.entries()]
    .map(([area, notes]) => ({ area, notes, paths: uniq(notes.flatMap((n) => n.paths ?? [])), links: uniq(notes.flatMap((n) => n.links ?? [])).filter((l) => l !== area), stale: notes.filter((n) => n.stale).length }))
    .sort((a, b) => (a.area === "" ? 1 : b.area === "" ? -1 : b.notes.length - a.notes.length || a.area.localeCompare(b.area)));
}

type Apply = (p: Promise<MemoryNotesResponse>, ok?: string) => Promise<void>;

export function MemoryPage({ onBack }: { onBack: () => void }) {
  const cached = useCached("memory-notes", (signal) => api.memoryNotes(signal));
  const data = cached.data ?? null;
  const notes = data?.notes ?? null;
  const [composing, setComposing] = React.useState(false);
  const [viewSel, setViewSel] = React.useState<string | null>(null);
  const revealRef = React.useRef<string | null>(null);
  const [kindFilter, setKindFilter] = React.useState<MemoryKind | "all">("all");
  const [query, setQuery] = React.useState("");
  const reviewRef = React.useRef<HTMLElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const apply = React.useCallback<Apply>(
    async (p, ok) => {
      try {
        cached.setData(await p);
        if (ok) toast.success(ok);
      } catch (e) {
        toast.error((e as Error).message);
      }
    },
    [cached],
  );

  const model = React.useMemo(() => {
    const all = notes ?? [];
    const byId = new Map(all.map((n) => [n.id, n]));
    const q = query.trim().toLowerCase();
    const matches = (n: MemoryNote) =>
      (kindFilter === "all" || n.kind === kindFilter) &&
      (!q || (q.startsWith("area:") ? (n.area ?? "").includes(q.slice(5).trim()) : `${n.text} ${n.why ?? ""} ${n.repo ?? ""} ${n.area ?? ""} ${(n.paths ?? []).join(" ")}`.toLowerCase().includes(q)));
    const liveAll = all.filter((n) => n.until == null);
    const counts = Object.fromEntries(KINDS.map((k) => [k, liveAll.filter((n) => n.kind === k).length])) as Record<MemoryKind, number>;
    // Pending proposals sit only in the review strip at the top, oldest first (closest to auto-keep).
    const pending = liveAll.filter((n) => n.status === "pending").sort((a, b) => a.at - b.at);
    const live = liveAll.filter((n) => n.status !== "pending" && matches(n)).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.at - a.at);
    const earlier = all.filter((n) => n.until != null && matches(n)).sort((a, b) => (b.until ?? 0) - (a.until ?? 0));
    const you = live.filter((n) => isOperatorKind(n.kind));
    const byRepo = new Map<string, MemoryNote[]>();
    for (const n of live) {
      if (isOperatorKind(n.kind)) continue;
      const k = n.repo ?? "";
      byRepo.set(k, [...(byRepo.get(k) ?? []), n]);
    }
    // Repos alphabetically, "any repo" last — repo notes are what a run reaches for first.
    const repos = [...byRepo.entries()].sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
    // Who replaced an earlier note: the live note whose `supersedes` points at it.
    const replacedBy = new Map<string, MemoryNote>();
    for (const n of all) if (n.supersedes && byId.has(n.supersedes)) replacedBy.set(n.supersedes, n);
    const filtering = kindFilter !== "all" || !!q;
    // Rail entries: every repo that has any live note (filtered or not), so the table of contents is stable while searching.
    const allRepos = [...new Set(liveAll.filter((n) => !isOperatorKind(n.kind) && n.status !== "pending").map((n) => n.repo ?? ""))].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
    const totals = new Map<string, number>();
    for (const n of liveAll) if (!isOperatorKind(n.kind) && n.status !== "pending") totals.set(n.repo ?? "", (totals.get(n.repo ?? "") ?? 0) + 1);
    const youTotal = liveAll.filter((n) => isOperatorKind(n.kind) && n.status !== "pending").length;
    const earlierTotal = all.filter((n) => n.until != null).length;
    const views = [
      { key: "you", label: "You", total: youTotal, count: you.length },
      ...allRepos.map((repo) => ({ key: `repo:${repo}`, label: repo || "Any repo", repo, total: totals.get(repo) ?? 0, count: byRepo.get(repo)?.length ?? 0, groups: areaGroups(byRepo.get(repo) ?? []) })),
      ...(earlierTotal ? [{ key: "earlier", label: "Earlier", total: earlierTotal, count: earlier.length }] : []),
    ];
    const defaultView = allRepos.find((r) => r !== "") != null ? `repo:${allRepos.find((r) => r !== "")}` : "you";
    return {
      liveAll,
      counts,
      pending,
      you,
      repos,
      earlier,
      replacedBy,
      filtering,
      views,
      defaultView,
    };
  }, [notes, kindFilter, query]);
  const view = viewSel && model.views.some((v) => v.key === viewSel) ? viewSel : model.defaultView;
  const viewOf = React.useCallback(
    (elId: string): string => {
      if (elId === "memory-you") return "you";
      for (const v of model.views) if ("repo" in v && (elId === sectionId(v.repo!) || elId.startsWith(`${sectionId(v.repo!)}-area-`))) return v.key;
      const id = elId.replace(/^mem-note-/, "");
      const n = notes?.find((x) => x.id === id);
      if (!n) return view;
      if (n.until != null) return "earlier";
      if (n.status === "pending") return view;
      return isOperatorKind(n.kind) ? "you" : `repo:${n.repo ?? ""}`;
    },
    [model.views, notes, view],
  );

  const exportMd = async () => {
    try {
      const blob = await api.memoryExport();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = "memory.md";
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } catch (e) {
      toast.error("Could not export", { description: (e as Error).message });
    }
  };
  const importMd = async (file: File | undefined) => {
    if (!file) return;
    try {
      const markdown = await file.text();
      const before = notes?.length ?? 0;
      const r = await api.memoryImport(markdown);
      cached.setData(r);
      const added = Math.max(0, r.notes.length - before);
      toast.success(added ? `Imported ${plural(added, "note")}` : "Nothing new to import");
    } catch (e) {
      toast.error("Could not import", { description: (e as Error).message });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  /** From the graph or a link chip: open the section the target lives in (clearing filters), scroll to it, flash it. */
  const reveal = (elId: string) => {
    setQuery("");
    setKindFilter("all");
    setViewSel(viewOf(elId));
    revealRef.current = elId;
    setTick((t) => t + 1);
  };
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    const elId = revealRef.current;
    if (!elId) return;
    revealRef.current = null;
    // A SettingsSection carries its id on the heading (`<id>-h`); rows and area pages on themselves.
    const el = document.getElementById(elId) ?? document.getElementById(`${elId}-h`);
    if (!el) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    el.classList.remove("mm-flash");
    void el.offsetWidth;
    el.classList.add("mm-flash");
    setTimeout(() => el.classList.remove("mm-flash"), 2000);
  }, [tick, view]);
  const rowProps = (n: MemoryNote) => ({
    note: n,
    onPin: (pinned: boolean) => void apply(api.memoryNoteUpdate({ id: n.id, pinned })),
    onSave: (patch: { text?: string; area?: string; paths?: string; links?: string; repo?: string }) => apply(api.memoryNoteUpdate({ id: n.id, ...patch }), patch.repo !== undefined ? (patch.repo ? `Filed under ${patch.repo}` : "Moved out of its repo") : "Note updated"),
    onDelete: () => void apply(api.memoryNoteDelete(n.id), "Forgotten"),
    onKeep: () => void apply(api.memoryNoteUpdate({ id: n.id, status: "kept" }), "Kept"),
    onVerify: n.stale ? () => void apply(api.memoryNoteUpdate({ id: n.id, verified: true }), "Marked verified") : undefined,
    onArea: (area: string) => reveal(areaId(n.repo ?? "", area)),
    onPromote: n.kind === "playbook" ? () => promote(n) : undefined,
  });
  const promote = async (n: MemoryNote) => {
    try {
      const r = await api.memoryPromote(n.id);
      cached.setData({ enabled: r.enabled, notes: r.notes });
      toast.success(`Skill "${r.skill.name}" drafted`, {
        action: {
          label: "Open",
          onClick: () => location.assign("/dashboard/skills"),
        },
      });
    } catch (e) {
      const msg = e instanceof ApiError && e.status === 409 ? "A skill with that name already exists" : (e as Error).message;
      toast.error("Could not promote", { description: msg });
    }
  };

  const total = notes?.length ?? 0;
  const selectNote = (id: string) => reveal(`mem-note-${id}`);
  const dim = !data?.enabled && "opacity-60";

  return (
    <SettingsPage
      title="Memory"
      purpose="What your agents learned on earlier runs — your preferences, and a knowledge base per repo of how the product works, filed by area — handed to every new run as MEMORY.md."
      back={{ label: "Back", onClick: onBack, mobileOnly: true }}
      actions={
        data && (
          <>
            <Button variant="outline" size="sm" onClick={() => setComposing((v) => !v)} aria-expanded={composing} aria-controls="memory-composer">
              <Plus className="size-4" />
              Add
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void exportMd()} disabled={!total} title="Download every note as one Markdown file">
              <Download className="size-4" />
              Export
            </Button>
            <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()} title="Add notes from a Markdown export">
              <Upload className="size-4" />
              Import
            </Button>
            <input ref={fileRef} type="file" accept=".md,text/markdown,text/plain" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void importMd(e.target.files?.[0])} />
            <label className="ml-1 flex items-center gap-2 text-meta">
              <span className={cn(data.enabled ? "text-foreground" : "text-muted-foreground")}>On</span>
              <Switch
                size="sm"
                checked={data.enabled}
                onCheckedChange={(on) => void apply(api.memoryNoteUpdate({ enabled: on }), on ? "Memory on" : "Memory off — runs start from scratch")}
                aria-label="Memory across runs"
              />
            </label>
          </>
        )
      }
    >
      <Collapse open={composing}>
        <Composer
          id="memory-composer"
          onCancel={() => setComposing(false)}
          onAdd={async (add) => {
            await apply(api.memoryNoteAdd(add), "Added");
            setComposing(false);
          }}
        />
      </Collapse>

      <Swap state={cached.error && !notes ? "error" : !notes ? "loading" : total === 0 ? "empty" : "list"}>
      {cached.error && !notes ? (
        <EmptyState icon={Brain} tone="destructive" title="Could not load memory" line={cached.error} />
      ) : !notes ? (
        <ul className="flex flex-col gap-2" aria-busy>
          {[0, 1, 2].map((i) => (
            <Bar key={i} className="h-10 rounded-lg" />
          ))}
        </ul>
      ) : total === 0 ? (
        <MemoryOverview notes={[]} pending={0} onReview={() => {}} onSelect={() => {}} onSection={() => {}} />
      ) : (
        <>
          <div className="flex flex-col gap-4">
            <MemoryOverview notes={notes} pending={model.pending.length} onReview={() => reviewRef.current?.focus()} onSelect={selectNote} onSection={(id) => reveal(id)} />

            <Collapse open={model.pending.length > 0}>
              <section
                ref={reviewRef}
                tabIndex={-1}
                aria-labelledby="memory-review-title"
                className="border-attention/40 bg-card shadow-e1 focus-visible:ring-ring rounded-xl border border-l-4 focus-visible:ring-2 focus-visible:outline-none"
              >
                <header className="flex flex-wrap items-baseline gap-x-2 px-3.5 pt-3 pb-1">
                  <h2 id="memory-review-title" className="text-foreground text-body font-medium">
                    Waiting for you <span className="text-attention-text tabular-nums">· {model.pending.length}</span>
                  </h2>
                  <p className="text-muted-foreground text-micro">Proposed by runs — kept automatically unless you forget them.</p>
                </header>
                <ul className={cn("divide-y", dim)}>
                  <AnimatePresence initial={false}>
                    {model.pending.map((n) => (
                      <NoteRow key={n.id} {...rowProps(n)} showRepo />
                    ))}
                  </AnimatePresence>
                </ul>
              </section>
            </Collapse>

            <div className="flex flex-wrap items-center gap-2">
              <div role="radiogroup" aria-label="Filter by kind" className="flex flex-wrap gap-1.5">
                <FilterChip group="memory-kind" active={kindFilter === "all"} onClick={() => setKindFilter("all")} label="All" count={model.liveAll.length} />
                {KINDS.map((k) => (
                  <FilterChip key={k} group="memory-kind" active={kindFilter === k} onClick={() => setKindFilter(kindFilter === k ? "all" : k)} label={KIND_PLURAL[k]} count={model.counts[k]} />
                ))}
              </div>
              <label className="relative ml-auto w-full sm:w-56">
                <span className="sr-only">Search notes</span>
                <Search className="text-faint pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" aria-hidden />
                <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setQuery("")} placeholder="Search notes · area:billing" className={cn(inputClass, "h-8 pl-8")} />
              </label>
            </div>
          </div>

          <div className="flex flex-col gap-4 md:grid md:grid-cols-[13.5rem_minmax(0,1fr)] md:items-start">
            <nav aria-label="Memory sections" className="md:sticky md:top-3">
              <ul className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 md:mx-0 md:flex-col md:overflow-visible md:px-0 md:pb-0">
                {model.views.map((v) => {
                  const active = v.key === view;
                  const Icon = v.key === "you" ? User : v.key === "earlier" ? History : FolderGit2;
                  const groups = "groups" in v ? v.groups.filter((g) => g.area) : [];
                  const stale = groups.reduce((a, g) => a + g.stale, 0);
                  return (
                    <li key={v.key} className="shrink-0">
                      <button
                        type="button"
                        aria-current={active ? "page" : undefined}
                        onClick={() => setViewSel(v.key)}
                        className={cn(
                          "focus-visible:ring-ring relative flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-meta focus-visible:ring-2 focus-visible:outline-none",
                          active ? "text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                        )}
                      >
                        {active && <motion.span layoutId="memory-view" className="bg-card border-line-strong absolute inset-0 rounded-lg border" transition={{ type: "spring", stiffness: 520, damping: 42, mass: 0.7 }} aria-hidden />}
                        <Icon className="relative size-3.5 shrink-0 opacity-70" aria-hidden />
                        <span className="relative min-w-0 flex-1 truncate">{v.label}</span>
                        <span className="text-faint relative shrink-0 text-micro tabular-nums">{model.filtering && v.count !== v.total ? `${v.count}/${v.total}` : v.total}</span>
                      </button>
                      <Collapse open={active && groups.length > 0} className="hidden md:block">
                        <ul className="mt-1 mb-1 ml-3 border-l pl-2" aria-label={`Areas of ${v.label}`}>
                          {groups.map((g) => (
                            <li key={g.area}>
                              <button
                                type="button"
                                onClick={() => reveal(areaId("repo" in v ? v.repo : "", g.area))}
                                className="text-muted-foreground hover:text-foreground focus-visible:ring-ring flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-micro focus-visible:ring-2 focus-visible:outline-none"
                              >
                                <span className="min-w-0 flex-1 truncate">{g.area}</span>
                                <span className="text-faint tabular-nums">{g.notes.length}</span>
                                {g.stale > 0 && <span className="text-faint" title={`${g.stale} unverified`}>?</span>}
                              </button>
                            </li>
                          ))}
                          {stale > 0 && <li className="text-faint px-1.5 pt-1 text-micro tabular-nums">{stale} unverified</li>}
                        </ul>
                      </Collapse>
                    </li>
                  );
                })}
              </ul>
            </nav>

            <Swap state={view} className="min-w-0">
              {view === "you" && (
                <SettingsSection id="memory-you" title="You" meta={plural(model.you.length, "note")} purpose="Preferences and rules — in every run's MEMORY.md, whatever the repo.">
                  {model.you.length ? (
                    <Panel>
                      <ul className={cn("divide-y", dim)}>
                        <AnimatePresence initial={false}>
                          {model.you.map((n) => (
                            <NoteRow key={n.id} {...rowProps(n)} />
                          ))}
                        </AnimatePresence>
                      </ul>
                    </Panel>
                  ) : (
                    <p className="text-muted-foreground text-meta">{model.filtering ? "No preference or rule matches." : "No preferences yet — say how you like things done during a run, or add one above."}</p>
                  )}
                </SettingsSection>
              )}

              {model.views.map((v) => {
                if (v.key !== view || !("repo" in v)) return null;
                const repo = v.repo!;
                const groups = v.groups;
                const pages = groups.filter((g) => g.area);
                const list = groups.flatMap((g) => g.notes);
                return (
                  <SettingsSection
                    key={v.key}
                    id={sectionId(repo)}
                    title={repo || "Any repo"}
                    meta={pages.length ? `${plural(pages.length, "area")} · ${plural(list.length, "note")}` : plural(list.length, "note")}
                    purpose={
                      repo
                        ? "Knowledge base — how this product works, by area. Runs read the areas a task is about and keep them current."
                        : "Saved by runs that had no repo checked out, so they belong to no knowledge base. Edit a note and give it a repo to file it."
                    }
                  >
                    {!list.length ? (
                      <p className="text-muted-foreground text-meta">No note here matches.</p>
                    ) : (
                      <>
                        {pages.length > 1 && (
                          <nav aria-label={`Areas of ${repo || "any repo"}`} className="mb-2 flex flex-wrap gap-1.5 md:hidden">
                            {pages.map((g) => (
                              <button
                                key={g.area}
                                type="button"
                                onClick={() => reveal(areaId(repo, g.area))}
                                className="bg-muted/50 text-muted-foreground hover:text-foreground hover:border-line-strong focus-visible:ring-ring inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-micro focus-visible:ring-2 focus-visible:outline-none"
                              >
                                {g.area}
                                <span className="text-faint tabular-nums">{g.notes.length}</span>
                                {g.stale > 0 && <span className="text-faint" title={`${g.stale} unverified`}>· {g.stale}?</span>}
                              </button>
                            ))}
                          </nav>
                        )}
                        <Panel>
                          {groups.map((g) => (
                            <div key={g.area || "unfiled"} id={g.area ? areaId(repo, g.area) : undefined} className="scroll-mt-24 border-b last:border-b-0">
                              <AreaHeader group={g} onArea={(a) => reveal(areaId(repo, a))} unfiled={!g.area} />
                              {REPO_KINDS.map((kind) => {
                                const rows = g.notes.filter((n) => n.kind === kind);
                                if (!rows.length) return null;
                                return (
                                  <div key={kind}>
                                    {g.notes.length > 3 && (
                                      <h4 className="text-faint px-3.5 pt-2 pb-0.5 text-micro font-medium tracking-wide uppercase">
                                        {KIND_PLURAL[kind]} <span className="tabular-nums">· {rows.length}</span>
                                      </h4>
                                    )}
                                    <ul className={cn("divide-y", dim)}>
                                      <AnimatePresence initial={false}>
                                        {rows.map((n) => (
                                          <NoteRow key={n.id} {...rowProps(n)} inArea={!!g.area} />
                                        ))}
                                      </AnimatePresence>
                                    </ul>
                                  </div>
                                );
                              })}
                            </div>
                          ))}
                        </Panel>
                      </>
                    )}
                  </SettingsSection>
                );
              })}

              {view === "earlier" && (
                <SettingsSection id="memory-earlier" title="Earlier" meta={plural(model.earlier.length, "replaced note")} purpose="Notes a newer one replaced — kept as history, out of MEMORY.md.">
                  {!model.earlier.length ? (
                    <p className="text-muted-foreground text-meta">No replaced note matches.</p>
                  ) : (
                    <Panel id="memory-earlier-list">
                      <ul className="divide-y">
                        <AnimatePresence initial={false}>
                        {model.earlier.map((n) => (
                          <motion.li
                            key={n.id}
                            id={`mem-note-${n.id}`}
                            layout="position"
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0 }}
                            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                            className="text-muted-foreground flex scroll-mt-24 items-start gap-3 overflow-hidden px-3.5 py-2.5"
                          >
                            <KindGlyph kind={n.kind} />
                            <div className="min-w-0 flex-1">
                              <p className="text-meta leading-snug break-words line-through decoration-faint">
                                <Inline text={noteHeadline(n.text)} />
                              </p>
                              <p className="text-faint mt-0.5 text-micro">
                                {model.replacedBy.get(n.id) ? (
                                  <>
                                    replaced by <span className="text-muted-foreground">“{noteHeadline(model.replacedBy.get(n.id)!.text)}”</span>
                                  </>
                                ) : (
                                  "replaced"
                                )}
                                {n.until != null && ` · ${fmtAgo(Math.floor(n.until / 1000))}`}
                                {n.repo && ` · ${n.repo}`}
                              </p>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Delete from history"
                              title="Forget"
                              className="hover:text-destructive shrink-0"
                              onClick={() => void apply(api.memoryNoteDelete(n.id), "Forgotten")}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </motion.li>
                        ))}
                        </AnimatePresence>
                      </ul>
                    </Panel>
                  )}
                </SettingsSection>
              )}
            </Swap>
          </div>
        </>
      )}
      </Swap>
    </SettingsPage>
  );
}

/** The header of one knowledge-base page: the area, the code it describes, the areas it links to. */
function AreaHeader({ group: g, onArea, unfiled }: { group: AreaGroup; onArea: (area: string) => void; unfiled: boolean }) {
  return (
    <div className="bg-muted/40 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-3.5 py-2">
      <h3 className="text-foreground text-meta font-medium">
        {unfiled ? <span className="text-muted-foreground">Not filed under an area</span> : g.area}
        <span className="text-faint ml-1.5 text-micro font-normal tabular-nums">{plural(g.notes.length, "note")}</span>
        {g.stale > 0 && <span className="text-muted-foreground ml-1.5 text-micro font-normal tabular-nums">· {g.stale} unverified</span>}
      </h3>
      {g.paths.length > 0 && (
        <p className="text-faint flex min-w-0 flex-wrap items-center gap-1 text-micro">
          <span>code</span>
          {g.paths.slice(0, 5).map((p) => (
            <code key={p} className="bg-muted rounded px-1 py-px font-mono text-[11px] break-all">
              {p}
            </code>
          ))}
          {g.paths.length > 5 && <span>+{g.paths.length - 5}</span>}
        </p>
      )}
      {g.links.length > 0 && (
        <p className="text-faint flex flex-wrap items-center gap-1 text-micro">
          <Link2 className="size-3" aria-hidden />
          {g.links.map((l) => (
            <button key={l} type="button" onClick={() => onArea(l)} className="hover:text-foreground focus-visible:ring-ring rounded-sm underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:outline-none">
              {l}
            </button>
          ))}
        </p>
      )}
    </div>
  );
}

/** Add a preference, rule, or a piece of domain knowledge by hand. */
function Composer({ id, onAdd, onCancel }: { id: string; onAdd: (add: { kind: MemoryKind; text: string; repo?: string; area?: string; paths?: string; links?: string }) => Promise<void>; onCancel: () => void }) {
  const [kind, setKind] = React.useState<"preference" | "rule" | "domain">("preference");
  const [text, setText] = React.useState("");
  const [repo, setRepo] = React.useState("");
  const [area, setArea] = React.useState("");
  const [paths, setPaths] = React.useState("");
  const [links, setLinks] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const ref = React.useRef<HTMLTextAreaElement>(null);
  React.useEffect(() => {
    ref.current?.focus();
  }, []);
  const submit = async () => {
    const t = text.trim();
    if (!t || busy) return;
    if (kind === "domain" && (!repo.trim() || !area.trim())) return;
    setBusy(true);
    try {
      await onAdd(kind === "domain" ? { kind, text: t, repo: repo.trim(), area: area.trim(), paths: paths.trim() || undefined, links: links.trim() || undefined } : { kind, text: t });
      setText("");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      id={id}
      className="bg-muted/40 mb-2 flex flex-col gap-2.5 rounded-xl border px-3.5 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          ariaLabel="Kind of note"
          size="xs"
          value={kind}
          onChange={setKind}
          options={[
            {
              value: "preference",
              label: "Preference",
              title: "How you like things done, anywhere",
            },
            {
              value: "rule",
              label: "Rule",
              title: "When X, do Y — a standing instruction",
            },
            {
              value: "domain",
              label: "Domain",
              title: "How the product works, filed under an area of a repo",
            },
          ]}
        />
        <span className="text-muted-foreground text-micro">
          {kind === "preference"
            ? "Taste that follows you into every run — “reply short”, “always pnpm”."
            : kind === "rule"
              ? "A trigger and what to do — “when I say deploy, run the tests first”."
              : "An entity, a flow, a business rule — “annual plans are invoiced on the 1st”. Filed under an area so runs find it."}
        </span>
      </div>
      {kind === "domain" && (
        <div className="grid gap-2 sm:grid-cols-2">
          <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repo" className={cn(inputClass, "h-8")} aria-label="Repo" required />
          <input value={area} onChange={(e) => setArea(e.target.value)} placeholder="area · billing/invoicing" className={cn(inputClass, "h-8")} aria-label="Area" required />
          <input value={paths} onChange={(e) => setPaths(e.target.value)} placeholder="code paths · src/billing/*, src/api/invoices.ts" className={cn(inputClass, "h-8 font-mono text-[12px]")} aria-label="Code paths" />
          <input value={links} onChange={(e) => setLinks(e.target.value)} placeholder="related areas · orders/refunds" className={cn(inputClass, "h-8")} aria-label="Related areas" />
        </div>
      )}
      <textarea
        ref={ref}
        value={text}
        maxLength={kind === "domain" ? 600 : 400}
        rows={2}
        placeholder={kind === "preference" ? "Keep replies short; prefer pure SVG over chart libraries" : kind === "rule" ? "When I say “ship it”, run the tests and open a PR instead of pushing to main" : "A refund reopens the order for 24 hours; after that it needs a new order"}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && !e.shiftKey) (e.preventDefault(), void submit());
        }}
        className={cn(inputClass, "h-auto resize-none py-2")}
        aria-label={`${KIND_LABEL[kind]} text`}
      />
      <div className="flex items-center gap-1">
        <Button type="submit" size="sm" disabled={!text.trim() || (kind === "domain" && (!repo.trim() || !area.trim()))} loading={busy}>
          <Check className="size-4" />
          Remember
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <span className="text-faint ml-auto text-micro tabular-nums">
          {text.length}/{kind === "domain" ? 600 : 400}
        </span>
      </div>
    </form>
  );
}

/** Kind marker: a glyph plus a short label. Never coloured — amber on this page means "needs you" only. */
function KindGlyph({ kind }: { kind: MemoryKind }) {
  const Icon = KIND_ICON[kind];
  return (
    <span className="text-muted-foreground mt-0.5 inline-flex w-24 shrink-0 items-center gap-1.5 text-micro font-medium whitespace-nowrap max-sm:w-auto" title={KIND_LABEL[kind]}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="max-sm:sr-only">{KIND_LABEL[kind]}</span>
    </span>
  );
}

/** A playbook's text is a title line plus steps; split it so the steps can fold. */
function splitPlaybook(text: string): { title: string; steps: string[] } {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return { title: lines[0] ?? text, steps: lines.slice(1) };
}

function NoteRow({
  note,
  onPin,
  onSave,
  onDelete,
  onKeep,
  onPromote,
  onVerify,
  onArea,
  showRepo,
  inArea,
}: {
  note: MemoryNote;
  onPin: (pinned: boolean) => void;
  onSave: (patch: { text?: string; area?: string; paths?: string; links?: string; repo?: string }) => Promise<void>;
  onDelete: () => void;
  onKeep: () => void;
  onPromote?: () => void;
  onVerify?: () => void;
  onArea?: (area: string) => void;
  showRepo?: boolean;
  /** The row sits under its area's header: don't repeat the area on the row. */
  inArea?: boolean;
}) {
  const [editing, setEditing] = React.useState(false);
  const [stepsOpen, setStepsOpen] = React.useState(false);
  const stepsId = React.useId();
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const historyId = React.useId();
  const history = note.history ?? [];
  const [draft, setDraft] = React.useState(note.text);
  const kb = !isOperatorKind(note.kind);
  const [dArea, setDArea] = React.useState(note.area ?? "");
  const [dPaths, setDPaths] = React.useState((note.paths ?? []).join(", "));
  const [dLinks, setDLinks] = React.useState((note.links ?? []).join(", "));
  const [dRepo, setDRepo] = React.useState(note.repo ?? "");
  const startEdit = () => {
    setDraft(note.text);
    setDRepo(note.repo ?? "");
    setDArea(note.area ?? "");
    setDPaths((note.paths ?? []).join(", "));
    setDLinks((note.links ?? []).join(", "));
    setEditing(true);
  };
  const ref = React.useRef<HTMLTextAreaElement>(null);
  React.useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  const save = async () => {
    const t = draft.trim();
    if (!t) return setEditing(false);
    const patch: { text?: string; area?: string; paths?: string; links?: string; repo?: string } = {};
    if (t !== note.text) patch.text = t;
    if (kb) {
      if (dRepo.trim().toLowerCase() !== (note.repo ?? "")) patch.repo = dRepo.trim();
      if (dArea.trim() !== (note.area ?? "")) patch.area = dArea.trim();
      if (dPaths.trim() !== (note.paths ?? []).join(", ")) patch.paths = dPaths.trim();
      if (dLinks.trim() !== (note.links ?? []).join(", ")) patch.links = dLinks.trim();
    }
    if (Object.keys(patch).length) await onSave(patch);
    setEditing(false);
  };
  const pending = note.status === "pending";
  const playbook = note.kind === "playbook";
  const uses = note.uses ?? 0;
  const proven = playbook && uses >= 2;

  return (
    <motion.li
      id={`mem-note-${note.id}`}
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className="group flex scroll-mt-24 items-start gap-3 overflow-hidden px-3.5 py-2.5"
    >
      <KindGlyph kind={note.kind} />
      {editing ? (
        <form
          className="flex min-w-0 flex-1 flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <textarea
            ref={ref}
            value={draft}
            maxLength={playbook ? 1200 : note.kind === "domain" ? 600 : 400}
            rows={playbook ? 6 : 2}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") (setDraft(note.text), setEditing(false));
              if (e.key === "Enter" && !e.shiftKey && !playbook) (e.preventDefault(), void save());
            }}
            className={cn(inputClass, "h-auto resize-none py-1.5")}
            aria-label="Note text"
          />
          {kb && (
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
              <input value={dRepo} onChange={(e) => setDRepo(e.target.value)} placeholder="repo · owner/name" className={cn(inputClass, "h-7 text-micro", !note.repo && "border-line-strong")} aria-label="Repo this note belongs to" />
              <input value={dArea} onChange={(e) => setDArea(e.target.value)} placeholder="area · billing/invoicing" className={cn(inputClass, "h-7 text-micro")} aria-label="Area" />
              <input value={dPaths} onChange={(e) => setDPaths(e.target.value)} placeholder="code paths, comma-separated" className={cn(inputClass, "h-7 font-mono text-[11px]")} aria-label="Code paths" />
              <input value={dLinks} onChange={(e) => setDLinks(e.target.value)} placeholder="related areas, comma-separated" className={cn(inputClass, "h-7 text-micro")} aria-label="Related areas" />
            </div>
          )}
          <div className="flex items-center gap-1">
            <Button type="submit" size="sm">
              <Check className="size-4" />
              Save
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => (setDraft(note.text), setEditing(false))}>
              <X className="size-4" />
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="min-w-0 flex-1">
          {playbook ? <PlaybookText text={note.text} open={stepsOpen} onToggle={() => setStepsOpen((v) => !v)} id={stepsId} /> : <NoteStatement text={note.text} />}
          {note.why && <p className="text-muted-foreground mt-0.5 text-meta leading-snug break-words">{note.why}</p>}
          <p className="text-faint mt-0.5 text-micro tabular-nums">
            {note.source && note.source !== "operator" && note.source !== "you" ? (
              <>
                from{" "}
                <a
                  href={`/dashboard/box/${encodeURIComponent(note.source)}`}
                  className="hover:text-foreground focus-visible:ring-ring rounded-sm underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:outline-none"
                >
                  {friendlyName(note.source)}
                </a>
              </>
            ) : (
              "added by you"
            )}{" "}
            · {fmtAgo(Math.floor(note.at / 1000))}
            {showRepo && ` · ${note.repo ?? (isOperatorKind(note.kind) ? "about you" : "any repo")}`}
            {note.area && !inArea && (
              <>
                {" · "}
                <button type="button" onClick={() => onArea?.(note.area!)} className="hover:text-foreground focus-visible:ring-ring rounded-sm underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:outline-none">
                  {note.area}
                </button>
              </>
            )}
            {note.pinned && " · pinned"}
            {playbook && uses > 0 && ` · used ${uses}×`}
            {note.paths && note.paths.length > 0 && (
              <>
                {" · "}
                <span className="font-mono">{note.paths.slice(0, 2).join(", ")}</span>
                {note.paths.length > 2 && ` +${note.paths.length - 2}`}
              </>
            )}
          </p>
          {note.stale && (
            <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 text-micro">
              <span>
                Unverified since {fmtAgo(Math.floor(note.stale.at / 1000))} — <span className="font-mono">{note.stale.paths.slice(0, 2).join(", ")}</span> changed in{" "}
                <a href={`/dashboard/box/${encodeURIComponent(note.stale.box)}`} className="hover:text-foreground underline-offset-2 hover:underline">
                  {friendlyName(note.stale.box)}
                </a>
                . The next run in this area will confirm or replace it.
              </span>
              {onVerify && (
                <Button size="xs" variant="outline" onClick={onVerify} aria-label={`Mark verified: ${noteHeadline(note.text).slice(0, 60)}`}>
                  <ShieldCheck className="size-3.5" />
                  Still true
                </Button>
              )}
            </p>
          )}
          {history.length > 0 && (
            <div className="mt-1">
              <button
                type="button"
                onClick={() => setHistoryOpen((v) => !v)}
                aria-expanded={historyOpen}
                aria-controls={historyId}
                className="text-faint hover:text-foreground focus-visible:ring-ring inline-flex cursor-pointer items-center gap-1 rounded-sm text-micro focus-visible:ring-2 focus-visible:outline-none"
              >
                <ChevronRight className={cn("size-3 transition-transform motion-reduce:transition-none", historyOpen && "rotate-90")} aria-hidden />
                <History className="size-3" aria-hidden />
                {plural(history.length, "earlier version")}
              </button>
              <Collapse open={historyOpen}>
                <ol id={historyId} className="border-border mt-1.5 ml-1.5 flex flex-col gap-1.5 border-l pl-3">
                  {history.map((v) => (
                    <li key={v.id} className="min-w-0">
                      <p className="text-muted-foreground text-meta leading-snug break-words">
                        <Inline text={noteHeadline(v.text)} />
                      </p>
                      <p className="text-faint mt-0.5 text-micro tabular-nums">
                        {v.source && v.source !== "operator" && v.source !== "you" ? (
                          <>
                            from{" "}
                            <a href={`/dashboard/box/${encodeURIComponent(v.source)}`} className="hover:text-foreground focus-visible:ring-ring rounded-sm underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:outline-none">
                              {friendlyName(v.source)}
                            </a>
                          </>
                        ) : (
                          "added by you"
                        )}{" "}
                        · {fmtAgo(Math.floor(v.at / 1000))}
                        {v.until != null && ` · replaced ${fmtAgo(Math.floor(v.until / 1000))}`}
                      </p>
                    </li>
                  ))}
                </ol>
              </Collapse>
            </div>
          )}
          {pending && (
            <div className="mt-1.5 flex items-center gap-1">
              <Button size="xs" onClick={onKeep} aria-label={`Keep: ${noteHeadline(note.text).slice(0, 60)}`}>
                <Check className="size-3.5" />
                Keep
              </Button>
              <Button size="xs" variant="ghost" className="hover:text-destructive" onClick={onDelete} aria-label={`Forget: ${noteHeadline(note.text).slice(0, 60)}`}>
                Forget
              </Button>
            </div>
          )}
        </div>
      )}
      {!editing && (
        <div
          className={cn(
            "flex shrink-0 items-center gap-0.5 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none max-sm:opacity-100",
            proven ? "opacity-100" : "opacity-40",
          )}
        >
          {onPromote && (
            <Button
              variant={proven ? "outline" : "ghost"}
              size="xs"
              onClick={onPromote}
              title={proven ? `Used ${uses} times — make it a skill` : "Make this playbook a SKILL.md draft"}
              className={cn(!proven && "text-muted-foreground")}
            >
              <Sparkles className="size-3.5" />
              {proven ? `Promote · used ${uses}×` : "Promote to skill"}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-pressed={!!note.pinned}
            aria-label={note.pinned ? "Unpin note" : "Pin note (never evicted)"}
            title={note.pinned ? "Unpin" : "Pin — never evicted"}
            onClick={() => onPin(!note.pinned)}
          >
            {note.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Edit note" title="Edit" onClick={startEdit}>
            <Pencil className="size-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Delete note" title="Forget" className="hover:text-destructive" onClick={onDelete}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      )}
    </motion.li>
  );
}

/** Playbook: the first line is its title; the rest are steps, folded by default. */
function PlaybookText({ text, open, onToggle, id }: { text: string; open: boolean; onToggle: () => void; id: string }) {
  const { title, steps } = splitPlaybook(text);
  return (
    <>
      <p className="text-foreground text-body font-medium leading-snug break-words">
        <Inline text={title} />
      </p>
      {steps.length > 0 && (
        <>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={id}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring -ml-1 mt-0.5 inline-flex items-center gap-0.5 rounded-sm px-1 text-meta focus-visible:ring-2 focus-visible:outline-none"
          >
            <ChevronRight className={cn("size-3.5 transition-transform duration-150 motion-reduce:transition-none", open && "rotate-90")} aria-hidden />
            {plural(steps.length, "step")}
          </button>
          <Collapse open={open}>
            <ol id={id} className="text-muted-foreground mt-1 flex list-decimal flex-col gap-0.5 pl-5 text-meta leading-snug marker:text-faint marker:tabular-nums">
              {steps.map((st, i) => (
                <li key={i} className="break-words">
                  <Inline text={st.replace(/^(\d+[.)]|[-*•])\s+/, "")} />
                </li>
              ))}
            </ol>
          </Collapse>
        </>
      )}
    </>
  );
}
