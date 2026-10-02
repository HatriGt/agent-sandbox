import * as React from "react";
import { Brain, Check, ChevronRight, Download, Pencil, Pin, PinOff, Plus, Search, Sparkles, Trash2, Upload, X } from "lucide-react";
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
import { MemoryOverview } from "@/components/memory/MemoryOverview";
import { isOperatorKind, KIND_ICON, KIND_LABEL, KIND_PLURAL, KINDS, plural } from "@/components/memory/kinds";

/**
 * Memory: what earlier runs left for future ones (src/memory-store.ts), typed and scoped.
 *   · You — preferences and rules that follow the operator into every run.
 *   · One section per repo — playbooks, lessons, decisions, facts the runs on that repo learned.
 *   · Earlier — notes a newer one replaced; greyed, kept as history, out of MEMORY.md.
 * Every row is a stored note; nothing here is derived or guessed. Pending rows are proposals the
 * thread toast did not settle yet — Keep/Forget inline. The header adds a preference or rule by
 * hand, moves the whole set in and out as one Markdown file, and turns the feature off.
 */

const REPO_KINDS: MemoryKind[] = ["playbook", "lesson", "decision", "fact"];

type Apply = (p: Promise<MemoryNotesResponse>, ok?: string) => Promise<void>;

export function MemoryPage({ onBack }: { onBack: () => void }) {
  const cached = useCached("memory-notes", (signal) => api.memoryNotes(signal));
  const data = cached.data ?? null;
  const notes = data?.notes ?? null;
  const [composing, setComposing] = React.useState(false);
  const [earlierOpen, setEarlierOpen] = React.useState(false);
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
    const matches = (n: MemoryNote) => (kindFilter === "all" || n.kind === kindFilter) && (!q || `${n.text} ${n.why ?? ""} ${n.repo ?? ""}`.toLowerCase().includes(q));
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
    return {
      liveAll,
      counts,
      pending,
      you,
      repos,
      earlier,
      replacedBy,
      filtering,
    };
  }, [notes, kindFilter, query]);

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

  const rowProps = (n: MemoryNote) => ({
    note: n,
    onPin: (pinned: boolean) => void apply(api.memoryNoteUpdate({ id: n.id, pinned })),
    onSave: (text: string) => apply(api.memoryNoteUpdate({ id: n.id, text }), "Note updated"),
    onDelete: () => void apply(api.memoryNoteDelete(n.id), "Forgotten"),
    onKeep: () => void apply(api.memoryNoteUpdate({ id: n.id, status: "kept" }), "Kept"),
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
  const dim = !data?.enabled && "opacity-60";

  return (
    <SettingsPage
      title="Memory"
      purpose="What your agents learned on earlier runs — your preferences, each repo's playbooks, lessons and facts — handed to every new run as MEMORY.md."
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

      {cached.error && !notes ? (
        <EmptyState icon={Brain} tone="destructive" title="Could not load memory" line={cached.error} />
      ) : !notes ? (
        <ul className="flex flex-col gap-2" aria-busy>
          {[0, 1, 2].map((i) => (
            <Bar key={i} className="h-10 rounded-lg" />
          ))}
        </ul>
      ) : total === 0 ? (
        <EmptyState
          icon={Brain}
          title="Nothing remembered yet"
          line="Runs add notes as they go — a correction becomes a lesson, a recurring task a playbook, a stated preference follows you everywhere. Or add a preference above."
        />
      ) : (
        <>
          <div className="flex flex-col gap-4">
            <MemoryOverview live={model.liveAll} pending={model.pending.length} onReview={() => reviewRef.current?.focus()} />

            {model.pending.length > 0 && (
              <section
                ref={reviewRef}
                tabIndex={-1}
                aria-labelledby="memory-review-title"
                className="border-attention/60 bg-attention/5 focus-visible:ring-ring rounded-xl border border-l-4 focus-visible:ring-2 focus-visible:outline-none"
              >
                <header className="flex flex-wrap items-baseline gap-x-2 px-3.5 pt-3 pb-1">
                  <h2 id="memory-review-title" className="text-foreground text-body font-medium">
                    Waiting for you <span className="text-attention-text tabular-nums">· {model.pending.length}</span>
                  </h2>
                  <p className="text-muted-foreground text-micro">Proposed by runs — kept automatically unless you forget them.</p>
                </header>
                <ul className={cn("divide-y", dim)}>
                  {model.pending.map((n) => (
                    <NoteRow key={n.id} {...rowProps(n)} showRepo />
                  ))}
                </ul>
              </section>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <div role="radiogroup" aria-label="Filter by kind" className="flex flex-wrap gap-1.5">
                <FilterChip active={kindFilter === "all"} onClick={() => setKindFilter("all")} label="All" count={model.liveAll.length} />
                {KINDS.map((k) => (
                  <FilterChip key={k} active={kindFilter === k} onClick={() => setKindFilter(kindFilter === k ? "all" : k)} label={KIND_PLURAL[k]} count={model.counts[k]} />
                ))}
              </div>
              <label className="relative ml-auto w-full sm:w-56">
                <span className="sr-only">Search notes</span>
                <Search className="text-faint pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" aria-hidden />
                <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setQuery("")} placeholder="Search notes" className={cn(inputClass, "h-8 pl-8")} />
              </label>
            </div>
          </div>

          {model.filtering && !model.you.length && !model.repos.length && !model.earlier.length && (
            <p className="text-muted-foreground py-6 text-center text-meta" role="status">
              No notes match.{" "}
              <button type="button" className="text-foreground underline underline-offset-2" onClick={() => (setQuery(""), setKindFilter("all"))}>
                Clear filters
              </button>
            </p>
          )}

          {(!model.filtering || model.you.length > 0) && (
            <SettingsSection id="memory-you" title="You" meta={plural(model.you.length, "note")} purpose="Preferences and rules — in every run's MEMORY.md, whatever the repo.">
              {model.you.length ? (
                <Panel>
                  <ul className={cn("divide-y", dim)}>
                    {model.you.map((n) => (
                      <NoteRow key={n.id} {...rowProps(n)} />
                    ))}
                  </ul>
                </Panel>
              ) : (
                <p className="text-muted-foreground text-meta">No preferences yet — say how you like things done during a run, or add one above.</p>
              )}
            </SettingsSection>
          )}

          {model.repos.map(([repo, list]) => (
            <SettingsSection key={repo || "global"} id={`memory-${repo.replace(/[^\w-]/g, "-") || "global"}`} title={repo || "Any repo"} meta={plural(list.length, "note")}>
              <Panel>
                {REPO_KINDS.map((kind) => {
                  const rows = list.filter((n) => n.kind === kind);
                  if (!rows.length) return null;
                  return (
                    <div key={kind} className="border-b last:border-b-0">
                      <h3 className="text-muted-foreground bg-muted/40 border-b px-3.5 py-1.5 text-micro font-medium tracking-wide uppercase">
                        {KIND_PLURAL[kind]} <span className="text-faint tabular-nums">· {rows.length}</span>
                      </h3>
                      <ul className={cn("divide-y", dim)}>
                        {rows.map((n) => (
                          <NoteRow key={n.id} {...rowProps(n)} />
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </Panel>
            </SettingsSection>
          ))}

          {model.earlier.length > 0 && (
            <SettingsSection
              id="memory-earlier"
              title={
                <button
                  type="button"
                  onClick={() => setEarlierOpen((v) => !v)}
                  aria-expanded={earlierOpen || model.filtering}
                  aria-controls="memory-earlier-list"
                  className="focus-visible:ring-ring -ml-1 inline-flex items-center gap-1 rounded-md px-1 focus-visible:ring-2 focus-visible:outline-none"
                >
                  <ChevronRight className={cn("text-muted-foreground size-4 transition-transform duration-150 motion-reduce:transition-none", earlierOpen && "rotate-90")} aria-hidden />
                  Earlier
                </button>
              }
              meta={plural(model.earlier.length, "replaced note")}
            >
              <Collapse open={earlierOpen || model.filtering}>
                <Panel id="memory-earlier-list">
                  <ul className="divide-y">
                    {model.earlier.map((n) => (
                      <li key={n.id} className="text-muted-foreground flex items-start gap-3 px-3.5 py-2.5">
                        <KindGlyph kind={n.kind} />
                        <div className="min-w-0 flex-1">
                          <p className="text-meta leading-snug break-words line-through decoration-faint">{n.text}</p>
                          <p className="text-faint mt-0.5 text-micro">
                            {model.replacedBy.get(n.id) ? (
                              <>
                                replaced by <span className="text-muted-foreground">“{model.replacedBy.get(n.id)!.text}”</span>
                              </>
                            ) : (
                              "replaced"
                            )}
                            {n.until != null && ` · ${fmtAgo(Math.floor(n.until / 1000))}`}
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
                      </li>
                    ))}
                  </ul>
                </Panel>
              </Collapse>
            </SettingsSection>
          )}
        </>
      )}
    </SettingsPage>
  );
}

/** Add a preference or rule by hand. Other kinds come from runs; a hand-written "fact" is a preference. */
function Composer({ id, onAdd, onCancel }: { id: string; onAdd: (add: { kind: MemoryKind; text: string }) => Promise<void>; onCancel: () => void }) {
  const [kind, setKind] = React.useState<"preference" | "rule">("preference");
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const ref = React.useRef<HTMLTextAreaElement>(null);
  React.useEffect(() => {
    ref.current?.focus();
  }, []);
  const submit = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await onAdd({ kind, text: t });
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
          ]}
        />
        <span className="text-muted-foreground text-micro">
          {kind === "preference" ? "Taste that follows you into every run — “reply short”, “always pnpm”." : "A trigger and what to do — “when I say deploy, run the tests first”."}
        </span>
      </div>
      <textarea
        ref={ref}
        value={text}
        maxLength={400}
        rows={2}
        placeholder={kind === "preference" ? "Keep replies short; prefer pure SVG over chart libraries" : "When I say “ship it”, run the tests and open a PR instead of pushing to main"}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && !e.shiftKey) (e.preventDefault(), void submit());
        }}
        className={cn(inputClass, "h-auto resize-none py-2")}
        aria-label={`${KIND_LABEL[kind]} text`}
      />
      <div className="flex items-center gap-1">
        <Button type="submit" size="sm" disabled={!text.trim()} loading={busy}>
          <Check className="size-4" />
          Remember
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <span className="text-faint ml-auto text-micro tabular-nums">{text.length}/400</span>
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
  showRepo,
}: {
  note: MemoryNote;
  onPin: (pinned: boolean) => void;
  onSave: (text: string) => Promise<void>;
  onDelete: () => void;
  onKeep: () => void;
  onPromote?: () => void;
  showRepo?: boolean;
}) {
  const [editing, setEditing] = React.useState(false);
  const [stepsOpen, setStepsOpen] = React.useState(false);
  const stepsId = React.useId();
  const [draft, setDraft] = React.useState(note.text);
  const ref = React.useRef<HTMLTextAreaElement>(null);
  React.useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  const save = async () => {
    const t = draft.trim();
    if (!t || t === note.text) return setEditing(false);
    await onSave(t);
    setEditing(false);
  };
  const pending = note.status === "pending";
  const playbook = note.kind === "playbook";
  const uses = note.uses ?? 0;
  const proven = playbook && uses >= 2;

  return (
    <li className="group flex items-start gap-3 px-3.5 py-2.5">
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
            maxLength={playbook ? 1200 : 400}
            rows={playbook ? 6 : 2}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") (setDraft(note.text), setEditing(false));
              if (e.key === "Enter" && !e.shiftKey && !playbook) (e.preventDefault(), void save());
            }}
            className={cn(inputClass, "h-auto resize-none py-1.5")}
            aria-label="Note text"
          />
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
          {playbook ? <PlaybookText text={note.text} open={stepsOpen} onToggle={() => setStepsOpen((v) => !v)} id={stepsId} /> : <p className="text-foreground text-body leading-snug break-words">{note.text}</p>}
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
            {note.pinned && " · pinned"}
            {playbook && uses > 0 && ` · used ${uses}×`}
          </p>
          {pending && (
            <div className="mt-1.5 flex items-center gap-1">
              <Button size="xs" onClick={onKeep} aria-label={`Keep: ${note.text.slice(0, 60)}`}>
                <Check className="size-3.5" />
                Keep
              </Button>
              <Button size="xs" variant="ghost" className="hover:text-destructive" onClick={onDelete} aria-label={`Forget: ${note.text.slice(0, 60)}`}>
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
          <Button variant="ghost" size="icon-sm" aria-label="Edit note" title="Edit" onClick={() => (setDraft(note.text), setEditing(true))}>
            <Pencil className="size-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Delete note" title="Forget" className="hover:text-destructive" onClick={onDelete}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      )}
    </li>
  );
}

/** Playbook: the first line is its title; the rest are steps, folded by default. */
function PlaybookText({ text, open, onToggle, id }: { text: string; open: boolean; onToggle: () => void; id: string }) {
  const { title, steps } = splitPlaybook(text);
  return (
    <>
      <p className="text-foreground text-body font-medium leading-snug break-words">{title}</p>
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
            <ol id={id} className="text-muted-foreground mt-1 flex flex-col gap-0.5 border-l pl-3 text-meta leading-snug">
              {steps.map((st, i) => (
                <li key={i} className="break-words">
                  {st}
                </li>
              ))}
            </ol>
          </Collapse>
        </>
      )}
    </>
  );
}
