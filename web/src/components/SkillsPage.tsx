import * as React from "react";
import { ArrowLeft, Check, Download, Eye, FileUp, Github, Loader2, Maximize2, Minimize2, PenLine, Plus, Search, Trash2, Upload, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { api, type SkillView } from "@/lib/api";
import { useCached } from "@/lib/cache";
import { fmtAgo } from "@/lib/format";
import { SkillMark } from "@/lib/skillGlyph";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Markdown } from "@/components/ui/markdown";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CodeEditor } from "@/components/CodeEditor";
import { Bar } from "@/components/thread/Skeletons";
import { fetchRepoFile, listRepoSkills, parseRepoInput, parseSkillMd, toSkillMd, type RepoRef, type RepoSkillFile } from "@/lib/skillImport";
import { cn } from "@/lib/utils";

/**
 * Skills: the playbooks every sandbox gets. A plain table — name, when the agent uses it, updated,
 * on/off — in the same shape as the fleet and MCP lists; a row opens the editor sheet, where the
 * instructions get a real markdown editor (CodeMirror: syntax colours, undo, ⌘F, ⌘S) with a
 * preview tab. No decoration that isn't information.
 */

type Draft = { name: string; description: string; content: string };

const TEMPLATES: (Draft & { blurb: string })[] = [
  {
    name: "review-pr",
    blurb: "A consistent PR review, your way",
    description: "Use when asked to review a pull request in any of our repos.",
    content:
      "1. Read the PR description and every changed file before commenting.\n" +
      "2. Check: correctness first, then tests, then naming and structure.\n" +
      "3. Flag anything that changes public behaviour without a test.\n" +
      "4. Summarise as: verdict (approve / needs work), then findings ordered by severity.\n" +
      "5. Be specific — file and line for every finding, no vague advice.",
  },
  {
    name: "release-notes",
    blurb: "Turn merged work into notes people read",
    description: "Use when asked to write release notes or a changelog entry.",
    content:
      "1. List the commits/PRs since the last tag.\n" +
      "2. Group into: Features, Fixes, Internal. Drop anything users cannot observe.\n" +
      "3. One line each, plain language, lead with the user benefit.\n" +
      "4. End with upgrade/migration steps only if something breaks.",
  },
  {
    name: "fix-ci",
    blurb: "Diagnose a red pipeline methodically",
    description: "Use when a CI pipeline or test run is failing and the task is to fix it.",
    content:
      "1. Reproduce locally first — run the exact failing command from the CI log.\n" +
      "2. Read the FIRST error, not the last; later failures usually cascade.\n" +
      "3. Fix the cause, not the assertion. Never skip or delete a failing test to go green.\n" +
      "4. Re-run the full suite before declaring it fixed.",
  },
];

export function SkillsPage({ onBack }: { onBack: () => void }) {
  const cached = useCached("skills", (signal) => api.skills(signal));
  const skills = cached.data?.skills ?? null;
  const [query, setQuery] = React.useState("");
  const [editing, setEditing] = React.useState<{ initial?: SkillView; draft?: Draft } | null>(null);
  const [browsing, setBrowsing] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  // Import from disk: one file opens in the editor for review, several are saved straight in.
  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const drafts = await Promise.all(Array.from(files).map(async (f) => parseSkillMd(await f.text(), f.name)));
    if (drafts.length === 1) return setEditing({ draft: drafts[0] });
    let saved = 0;
    for (const d of drafts) {
      try {
        await api.skillMutate({ action: "upsert", skill: { ...d, enabled: true } });
        saved++;
      } catch (e) {
        toast.error(`Could not import /${d.name}`, { description: e instanceof Error ? e.message : String(e) });
      }
    }
    cached.setData(await api.skills());
    if (saved) toast.success(`Imported ${saved} skill${saved === 1 ? "" : "s"}`);
  };

  const mutate = React.useCallback(
    async (body: Record<string, unknown>, ok?: string) => {
      const r = await api.skillMutate(body);
      cached.setData(r);
      if (ok) toast.success(ok);
      return r;
    },
    [cached]
  );

  const q = query.trim().toLowerCase();
  const visible = (skills ?? []).filter((s) => !q || `${s.name} ${s.description}`.toLowerCase().includes(q));
  const onCount = skills?.filter((s) => s.enabled).length ?? 0;

  return (
    <div className="h-full min-w-0 overflow-y-auto">
      <div className="mx-auto max-w-4xl px-5 py-6 md:px-8 md:py-8">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 mb-3 md:hidden" aria-label="Back to machines">
          <ArrowLeft className="size-4" />
          Machines
        </Button>

        <header className="mb-6">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-foreground text-h1 font-semibold tracking-[-0.02em]">Skills</h1>
            {skills && skills.length > 0 && (
              <span className="text-muted-foreground text-meta">
                {skills.length} · {onCount} on
              </span>
            )}
            <div className="ml-auto flex items-center gap-2">
              {(skills?.length ?? 0) > 0 && (
                <label className="bg-card focus-within:ring-ring flex h-8 items-center gap-1.5 rounded-md border px-2 transition-shadow focus-within:ring-2">
                  <Search className="text-muted-foreground size-3.5" aria-hidden />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Filter"
                    aria-label="Filter skills"
                    className="text-foreground placeholder:text-muted-foreground w-24 bg-transparent text-meta outline-none transition-[width] focus:w-40"
                  />
                  {query && (
                    <button type="button" onClick={() => setQuery("")} aria-label="Clear" className="text-muted-foreground hover:text-foreground cursor-pointer">
                      <X className="size-3.5" />
                    </button>
                  )}
                </label>
              )}
              <input
                ref={fileRef}
                type="file"
                accept=".md,.markdown,.txt"
                multiple
                className="hidden"
                onChange={(e) => {
                  void importFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline">
                    <Download />
                    Import
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => fileRef.current?.click()}>
                    <FileUp />
                    From SKILL.md files…
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setBrowsing(true)}>
                    <Github />
                    From a GitHub repository…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button size="sm" onClick={() => setEditing({ draft: { name: "", description: "", content: "" } })}>
                <Plus />
                New skill
              </Button>
            </div>
          </div>
          <p className="text-muted-foreground mt-1 text-meta">
            Playbooks every sandbox follows — invoke one with <span className="stamp text-foreground">/name</span> in chat, or the agent picks it up when it fits.
          </p>
        </header>

        {cached.error && (
          <p role="alert" className="text-destructive mb-4 text-meta">
            {cached.error}
          </p>
        )}

        {skills === null ? (
          <div className="overflow-hidden rounded-xl border">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-4 border-b px-4 py-3.5 last:border-b-0">
                <Bar className="h-3 w-32" />
                <Bar className="h-3 flex-1" />
                <Bar className="h-3 w-16" />
                <Bar className="h-5 w-9 rounded-full" />
              </div>
            ))}
          </div>
        ) : skills.length === 0 ? (
          <EmptyState onPick={(d) => setEditing({ draft: d })} />
        ) : visible.length === 0 ? (
          <div className="rounded-xl border border-dashed py-12 text-center">
            <p className="text-foreground text-lead font-medium">Nothing matches</p>
            <p className="text-muted-foreground mt-1 text-meta">No skill matches “{query.trim()}”.</p>
          </div>
        ) : (
          <SkillTable skills={visible} onOpen={(s) => setEditing({ initial: s })} onMutate={mutate} />
        )}
      </div>

      <RepoBrowser
        open={browsing}
        onClose={() => setBrowsing(false)}
        existing={new Set((skills ?? []).map((s) => s.name))}
        onImported={async (count) => {
          cached.setData(await api.skills());
          toast.success(`Imported ${count} skill${count === 1 ? "" : "s"} — every sandbox gets them on its next turn`);
        }}
        onEditOne={(d) => {
          setBrowsing(false);
          setEditing({ draft: d });
        }}
      />

      <AnimatePresence>
        {editing && <EditorSheet key="sheet" initial={editing.initial} draft={editing.draft} onMutate={mutate} onClose={() => setEditing(null)} />}
      </AnimatePresence>
    </div>
  );
}

/* ───────────────────────────── table ───────────────────────────── */

const COLS = "md:grid-cols-[12rem_minmax(0,1fr)_6.5rem_3rem]";

function SkillTable({
  skills,
  onOpen,
  onMutate,
}: {
  skills: SkillView[];
  onOpen: (s: SkillView) => void;
  onMutate: (b: Record<string, unknown>, ok?: string) => Promise<unknown>;
}) {
  return (
    <div className="overflow-hidden rounded-xl border">
      <div className={cn("label text-muted-foreground bg-muted/60 hidden items-center gap-3 border-b px-4 py-2 md:grid", COLS)}>
        <span>Skill</span>
        <span>When the agent uses it</span>
        <span>Updated</span>
        <span className="text-right">On</span>
      </div>
      <ul className="divide-y">
        <AnimatePresence initial={false}>
          {skills.map((s) => (
            <SkillRow key={s.name} skill={s} onOpen={() => onOpen(s)} onMutate={onMutate} />
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}

function SkillRow({
  skill: s,
  onOpen,
  onMutate,
}: {
  skill: SkillView;
  onOpen: () => void;
  onMutate: (b: Record<string, unknown>, ok?: string) => Promise<unknown>;
}) {
  const [busy, setBusy] = React.useState(false);
  const toggle = () => {
    setBusy(true);
    onMutate({ action: "toggle", name: s.name, enabled: !s.enabled })
      .catch((e: unknown) => toast.error("Could not update", { description: e instanceof Error ? e.message : String(e) }))
      .finally(() => setBusy(false));
  };
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.18 }}
      className={cn("group hover:bg-muted/50 relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 transition-colors md:gap-3", COLS)}
    >
      {/* The row IS the edit action: a stretched button under the content; the switch sits above it. */}
      <button
        type="button"
        onClick={onOpen}
        disabled={busy}
        aria-label={`Edit skill ${s.name}`}
        className="focus-visible:ring-ring absolute inset-0 cursor-pointer focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
      />

      <span className={cn("flex min-w-0 items-center gap-2.5", !s.enabled && "opacity-50")}>
        <SkillMark name={s.name} size={16} className="text-muted-foreground" />
        <span className="stamp text-foreground truncate text-meta font-medium">/{s.name}</span>
      </span>

      <span className={cn("text-muted-foreground col-span-2 min-w-0 truncate text-meta md:col-span-1", !s.enabled && "opacity-60")} title={s.description}>
        {s.description}
      </span>

      <span className="text-faint stamp hidden md:block">{fmtAgo(Math.floor(s.updatedAt / 1000))}</span>

      <span className="relative col-start-2 row-start-1 flex justify-end md:col-start-auto md:row-start-auto">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              role="switch"
              aria-checked={s.enabled}
              disabled={busy}
              onClick={toggle}
              className={cn("relative h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors", s.enabled ? "bg-live" : "bg-muted-foreground/40")}
              aria-label={s.enabled ? `Disable ${s.name}` : `Enable ${s.name}`}
            >
              <span className={cn("bg-card absolute top-0.5 size-4 rounded-full shadow-e1 transition-[left] duration-200", s.enabled ? "left-[1.125rem]" : "left-0.5")} />
            </button>
          </TooltipTrigger>
          <TooltipContent>{s.enabled ? "On — synced into every sandbox on its next turn" : "Off — kept, not given to the agent"}</TooltipContent>
        </Tooltip>
      </span>
    </motion.li>
  );
}

/* ───────────────────────────── empty state ───────────────────────────── */

function EmptyState({ onPick }: { onPick: (d: Draft) => void }) {
  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="border-b px-5 py-6">
        <p className="text-foreground text-body font-medium">No skills yet</p>
        <p className="text-muted-foreground mt-1 max-w-lg text-meta">
          A skill is a playbook — how you review PRs, cut a release, fix CI — written once and followed in every
          sandbox. Start from a template or write your own.
        </p>
      </div>
      <ul className="divide-y">
        {TEMPLATES.map((t) => (
          <li key={t.name}>
            <button
              type="button"
              onClick={() => onPick({ name: t.name, description: t.description, content: t.content })}
              className="group hover:bg-muted/50 flex w-full cursor-pointer items-center gap-3 px-5 py-3 text-left transition-colors"
            >
              <SkillMark name={t.name} size={16} className="text-muted-foreground" />
              <span className="stamp text-foreground w-36 shrink-0 truncate text-meta font-medium">/{t.name}</span>
              <span className="text-muted-foreground min-w-0 flex-1 truncate text-meta">{t.blurb}</span>
              <span className="text-live shrink-0 text-meta font-medium opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                Use template →
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ───────────────────────────── editor sheet ───────────────────────────── */

function EditorSheet({
  initial,
  draft,
  onMutate,
  onClose,
}: {
  initial?: SkillView;
  draft?: Draft;
  onMutate: (b: Record<string, unknown>, ok?: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [name, setName] = React.useState(initial?.name ?? draft?.name ?? "");
  const [description, setDescription] = React.useState(initial?.description ?? draft?.description ?? "");
  const [content, setContent] = React.useState(initial?.content ?? draft?.content ?? "");
  const [tab, setTab] = React.useState<"write" | "preview">("write");
  const [busy, setBusy] = React.useState(false);
  const [armed, setArmed] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const nameRef = React.useRef<HTMLInputElement>(null);
  const valid = /^[a-z0-9][a-z0-9-]{0,49}$/.test(name.trim()) && description.trim() && content.trim();

  // The sheet's width is yours: drag the left edge (remembered across sessions), or go full screen
  // for a long playbook. Esc steps out of full screen first, then closes.
  const MIN_W = 512;
  const [width, setWidth] = React.useState(() => {
    const w = Number(localStorage.getItem("skillSheetW"));
    return Number.isFinite(w) && w >= MIN_W ? w : 672;
  });
  const [full, setFull] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const startDrag = (e: React.PointerEvent) => {
    if (full) return;
    e.preventDefault();
    setDragging(true);
    const at = (x: number) => Math.min(Math.max(window.innerWidth - x, MIN_W), window.innerWidth - 80);
    const move = (ev: PointerEvent) => setWidth(at(ev.clientX));
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDragging(false);
      localStorage.setItem("skillSheetW", String(Math.round(at(ev.clientX))));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  React.useEffect(() => {
    if (!initial) nameRef.current?.focus();
  }, [initial]);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (full) setFull(false);
      else onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, full]);

  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onMutate(
        {
          action: "upsert",
          previousName: initial?.name,
          skill: { name: name.trim(), description: description.trim(), content, enabled: initial?.enabled ?? true },
        },
        initial ? "Skill saved" : `/${name.trim()} is live — every sandbox gets it on its next turn`
      );
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!armed) return setArmed(true);
    setBusy(true);
    try {
      await onMutate({ action: "remove", name: initial!.name }, `/${initial!.name} removed`);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setArmed(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={initial ? `Edit skill ${initial.name}` : "New skill"}>
      <motion.button
        type="button"
        aria-label="Close"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/30"
      />
      <motion.div
        initial={{ x: "104%" }}
        animate={{ x: 0 }}
        exit={{ x: "104%" }}
        transition={{ type: "spring", stiffness: 380, damping: 38 }}
        style={full ? undefined : { width: `min(${Math.round(width)}px, 100%)` }}
        className={cn(
          "bg-card absolute flex flex-col shadow-e5",
          dragging && "select-none",
          full ? "inset-0 w-auto" : "inset-y-0 right-0 w-full border-l"
        )}
      >
        {/* Drag the left edge to resize; the width is remembered. */}
        {!full && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize editor"
            onPointerDown={startDrag}
            className="group absolute inset-y-0 -left-1 z-10 hidden w-2.5 cursor-col-resize sm:block"
          >
            <span className={cn("absolute inset-y-0 left-1 w-[2px] transition-colors", dragging ? "bg-live" : "group-hover:bg-live/50")} />
          </div>
        )}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b px-5">
          <SkillMark name={name || "skill"} size={18} className="text-muted-foreground" />
          <h2 className="text-foreground min-w-0 flex-1 truncate text-body font-semibold">
            {initial ? <span className="stamp">/{initial.name}</span> : "New skill"}
          </h2>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={() => setFull((v) => !v)} aria-label={full ? "Exit full screen" : "Full screen"} className="text-muted-foreground hidden sm:inline-flex">
                {full ? <Minimize2 /> : <Maximize2 />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{full ? "Exit full screen · Esc" : "Full screen"}</TooltipContent>
          </Tooltip>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 px-5 py-4">
          <div className="grid shrink-0 gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
            <label className="flex flex-col gap-1.5">
              <span className="label text-muted-foreground">Name</span>
              <div className="focus-within:ring-ring bg-background flex h-9 items-center rounded-md border transition-shadow focus-within:ring-2">
                <span className="text-muted-foreground stamp pl-2.5">/</span>
                <input
                  ref={nameRef}
                  value={name}
                  onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, "-"))}
                  placeholder="review-pr"
                  spellCheck={false}
                  className="stamp text-foreground placeholder:text-muted-foreground h-full w-full bg-transparent pr-2.5 pl-0.5 text-meta outline-none"
                />
              </div>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="label text-muted-foreground">When should the agent use it?</span>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Use when reviewing a pull request in any of our repos."
                className="bg-background focus:ring-ring h-9 rounded-md border px-2.5 text-meta outline-none transition-shadow focus:ring-2"
              />
            </label>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-1.5">
            <div className="flex shrink-0 items-center justify-between">
              <span className="label text-muted-foreground">Instructions</span>
              <div className="flex items-center gap-3">
                <span className={cn("tabular text-micro", content.length > 60_000 ? "text-destructive" : "text-faint")}>
                  {content.length.toLocaleString()} / 65,536
                </span>
                <div role="radiogroup" aria-label="Editor mode" className="bg-muted inline-flex h-7 items-center gap-0.5 rounded-md p-0.5">
                  <TabChip active={tab === "write"} onClick={() => setTab("write")} icon={<PenLine className="size-3" />} label="Write" />
                  <TabChip active={tab === "preview"} onClick={() => setTab("preview")} icon={<Eye className="size-3" />} label="Preview" />
                </div>
              </div>
            </div>
            <div className="bg-background min-h-0 flex-1 overflow-hidden rounded-md border">
              {tab === "write" ? (
                <CodeEditor
                  value={content}
                  onChange={setContent}
                  onSave={() => void save()}
                  path="SKILL.md"
                  ariaLabel="Skill instructions (markdown)"
                  autoFocus={!!initial}
                  className="h-full"
                />
              ) : content.trim() ? (
                <div className="h-full overflow-y-auto px-4 py-3">
                  <Markdown className="prose-agent">{content}</Markdown>
                </div>
              ) : (
                <p className="text-muted-foreground px-4 py-3 text-meta">Nothing to preview yet.</p>
              )}
            </div>
          </div>

          {err && (
            <p role="alert" className="text-destructive shrink-0 text-meta">
              {err}
            </p>
          )}
        </div>

        <footer className="flex shrink-0 items-center gap-2 border-t px-5 py-3">
          {initial && (
            <>
              <Button size="sm" variant={armed ? "destructive" : "ghost"} onClick={remove} disabled={busy} className={cn(!armed && "text-muted-foreground")}>
                <Trash2 />
                {armed ? "Confirm delete" : "Delete"}
              </Button>
              {armed && (
                <Button size="icon-sm" variant="ghost" onClick={() => setArmed(false)} aria-label="Cancel delete">
                  <X />
                </Button>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Download as SKILL.md"
                    className="text-muted-foreground"
                    onClick={() => {
                      const md = toSkillMd({ name: name.trim() || initial.name, description: description.trim(), content });
                      const a = document.createElement("a");
                      a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
                      a.download = `${name.trim() || initial.name}.SKILL.md`;
                      a.click();
                      URL.revokeObjectURL(a.href);
                    }}
                  >
                    <Upload />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Download as SKILL.md</TooltipContent>
              </Tooltip>
            </>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={!valid || busy}>
              {busy ? "Saving…" : initial ? "Save changes" : "Create skill"}
            </Button>
          </div>
        </footer>
      </motion.div>
    </div>
  );
}

/* ───────────────────────────── GitHub import ───────────────────────────── */

/** Public repos that actually carry skills in the SKILL.md format — a starting point, not a store. */
const FEATURED_REPOS = [
  { repo: "anthropics/skills", blurb: "Anthropic's own skill collection" },
  { repo: "anthropics/claude-code", blurb: "Skills shipped with Claude Code" },
];

/**
 * Browse a public GitHub repository for skills and pull them in. All of it happens in the browser
 * against api.github.com / raw.githubusercontent.com — no token, public repos only, nothing about
 * your account leaves the page. Found files list with checkboxes: pick one to review it in the
 * editor first, or several to import in one go.
 */
function RepoBrowser({
  open,
  existing,
  onClose,
  onImported,
  onEditOne,
}: {
  open: boolean;
  existing: Set<string>;
  onClose: () => void;
  onImported: (count: number) => void | Promise<void>;
  onEditOne: (d: Draft) => void;
}) {
  const [input, setInput] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [found, setFound] = React.useState<{ ref: RepoRef; branch: string; files: RepoSkillFile[] } | null>(null);
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [importing, setImporting] = React.useState(false);

  React.useEffect(() => {
    if (open) return;
    setInput("");
    setErr(null);
    setFound(null);
    setPicked(new Set());
  }, [open]);

  const browse = async (raw: string) => {
    setErr(null);
    setFound(null);
    setPicked(new Set());
    setLoading(true);
    try {
      const ref = parseRepoInput(raw);
      const r = await listRepoSkills(ref);
      if (!r.files.length) setErr("No skills here — the repo has no SKILL.md files or skills/ markdown.");
      else setFound({ ref, ...r });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const doImport = async () => {
    if (!found || !picked.size) return;
    setImporting(true);
    try {
      const files = found.files.filter((f) => picked.has(f.path));
      const drafts = await Promise.all(files.map(async (f) => parseSkillMd(await fetchRepoFile(found.ref, found.branch, f.path), f.name)));
      if (drafts.length === 1) return onEditOne(drafts[0]);
      let saved = 0;
      for (const d of drafts) {
        try {
          await api.skillMutate({ action: "upsert", skill: { ...d, enabled: true } });
          saved++;
        } catch (e) {
          toast.error(`Could not import /${d.name}`, { description: e instanceof Error ? e.message : String(e) });
        }
      }
      if (saved) await onImported(saved);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent title="Import from GitHub" description="Browse a public repository — SKILL.md folders and skills/ markdown come in as they are." className="w-[min(40rem,calc(100vw-2rem))]">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void browse(input);
          }}
        >
          <label className="focus-within:ring-ring bg-background flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border px-2.5 transition-shadow focus-within:ring-2">
            <Search className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="owner/repo or a github.com URL"
              aria-label="Repository"
              spellCheck={false}
              className="text-foreground placeholder:text-muted-foreground h-full w-full bg-transparent text-meta outline-none"
            />
          </label>
          <Button type="submit" size="sm" disabled={!input.trim() || loading}>
            {loading ? <Loader2 className="animate-spin" /> : <Search />}
            Browse
          </Button>
        </form>

        {!found && !loading && !err && (
          <div className="mt-4 overflow-hidden rounded-lg border">
            <p className="label text-muted-foreground bg-muted/60 border-b px-3 py-2">Try one of these</p>
            <ul className="divide-y">
              {FEATURED_REPOS.map((f) => (
                <li key={f.repo}>
                  <button
                    type="button"
                    onClick={() => {
                      setInput(f.repo);
                      void browse(f.repo);
                    }}
                    className="group hover:bg-muted/50 flex w-full cursor-pointer items-center gap-2.5 px-3 py-2.5 text-left transition-colors"
                  >
                    <Github className="text-muted-foreground size-4 shrink-0" aria-hidden />
                    <span className="stamp text-foreground shrink-0 text-meta font-medium">{f.repo}</span>
                    <span className="text-muted-foreground min-w-0 flex-1 truncate text-meta">{f.blurb}</span>
                    <span className="text-live shrink-0 text-meta font-medium opacity-0 transition-opacity group-hover:opacity-100">Browse →</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {err && (
          <p role="alert" className="text-destructive mt-3 text-meta">
            {err}
          </p>
        )}

        {found && (
          <>
            <div className="mt-4 mb-2 flex items-baseline justify-between gap-3">
              <p className="text-muted-foreground min-w-0 truncate text-meta">
                <span className="stamp text-foreground">
                  {found.ref.owner}/{found.ref.repo}
                </span>{" "}
                @ {found.branch} · {found.files.length} found
              </p>
              <button
                type="button"
                onClick={() => setPicked(picked.size === found.files.length ? new Set() : new Set(found.files.map((f) => f.path)))}
                className="text-live shrink-0 cursor-pointer text-meta font-medium hover:underline"
              >
                {picked.size === found.files.length ? "Clear" : "Select all"}
              </button>
            </div>
            <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border">
              {found.files.map((f) => {
                const on = picked.has(f.path);
                return (
                  <li key={f.path}>
                    <button
                      type="button"
                      onClick={() =>
                        setPicked((p) => {
                          const n = new Set(p);
                          if (n.has(f.path)) n.delete(f.path);
                          else n.add(f.path);
                          return n;
                        })
                      }
                      className={cn("hover:bg-muted/50 flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left transition-colors", on && "bg-live/5")}
                    >
                      <span className={cn("grid size-4 shrink-0 place-items-center rounded-[3px] border transition-colors", on ? "bg-live border-live text-white" : "bg-background")}>
                        {on && <Check className="size-3" aria-hidden />}
                      </span>
                      <SkillMark name={f.name} size={16} className="text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="stamp text-foreground block truncate text-meta font-medium">/{f.name}</span>
                        <span className="text-faint block truncate text-micro">{f.path}</span>
                      </span>
                      {existing.has(f.name) && <span className="text-attention-text shrink-0 text-micro">replaces yours</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => void doImport()} disabled={!picked.size || importing}>
                {importing ? <Loader2 className="animate-spin" /> : <Download />}
                {picked.size === 1 ? "Review & import" : picked.size ? `Import ${picked.size}` : "Import"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TabChip({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "flex h-6 cursor-pointer items-center gap-1 rounded px-2 text-micro font-medium transition-colors",
        active ? "bg-card text-foreground shadow-e1" : "text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
