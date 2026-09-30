import * as React from "react";
import { ArrowLeft, Copy, Download, Eye, FileText, Info, MoreHorizontal, PanelRightClose, PanelRightOpen, PenLine, Power, Trash2 } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import type { SkillView } from "@/lib/api";
import { SkillMark } from "@/lib/skillGlyph";
import { type SkillFile, toSkillMd } from "@/lib/skillImport";
import { cn } from "@/lib/utils";
import { AnimatedTabs } from "@/components/ui/animated-tabs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, MenuHint } from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Markdown } from "@/components/ui/markdown";
import { Segmented } from "@/components/ui/segmented";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CodeEditor } from "@/components/CodeEditor";
import { byteLength, type Draft, fmtKb, MAX_CONTENT, type Mutate, NAME_RE, slugify, sourceOf } from "./model";
import { SkillInspector } from "./SkillInspector";
import { SourceBadge } from "./SkillLibrary";
import { SkillFileTree, type TreeActions } from "./SkillFileTree";

/**
 * The authoring surface. Takes the whole page: a thin header (back · /name · save state · mode ·
 * menu · Save), then three columns — the files the skill ships (left), the document (centre) and
 * how the agent will see it (right). SKILL.md's frontmatter is two proper fields above the body,
 * never raw YAML unless Preview → Raw is asked for. Saving keeps you here; the header says what is
 * unsaved and ⌘S saves from anywhere. Leaving with edits asks once. On a phone the columns become
 * sheets behind a small toolbar.
 */
export function SkillEditor({
  initial,
  draft,
  onMutate,
  onSaved,
  onClose,
}: {
  initial?: SkillView;
  draft?: Draft;
  onMutate: Mutate;
  /** After a successful save: the parent swaps in the saved skill so the editor's baseline moves. */
  onSaved: (s: SkillView) => void;
  onClose: () => void;
}) {
  const still = useReducedMotion();
  const base = React.useMemo<Draft>(
    () => ({
      name: initial?.name ?? draft?.name ?? "",
      description: initial?.description ?? draft?.description ?? "",
      content: initial?.content ?? draft?.content ?? "",
      files: initial?.files ?? draft?.files ?? [],
    }),
    [initial, draft]
  );
  const [name, setName] = React.useState(base.name);
  const [description, setDescription] = React.useState(base.description);
  const [content, setContent] = React.useState(base.content);
  const [files, setFiles] = React.useState<SkillFile[]>(base.files ?? []);
  const [active, setActive] = React.useState("SKILL.md");
  const activeFile = active === "SKILL.md" ? null : (files.find((f) => f.path === active) ?? null);
  const [mode, setMode] = React.useState<"write" | "preview">("write");
  const [previewRaw, setPreviewRaw] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [toggling, setToggling] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [confirmClose, setConfirmClose] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [filesSheet, setFilesSheet] = React.useState(false);
  const [infoSheet, setInfoSheet] = React.useState(false);
  const [savedFlash, setSavedFlash] = React.useState(false);
  const nameRef = React.useRef<HTMLInputElement>(null);
  const saving = React.useRef(false);

  // The inspector is on by default where there is room (≥1280px), and remembered once touched.
  const [showInfo, setShowInfo] = React.useState(() => {
    const v = localStorage.getItem("skillInspector");
    return v ? v === "1" : typeof window !== "undefined" && window.matchMedia("(min-width: 1280px)").matches;
  });
  const toggleInfo = () => {
    setShowInfo((v) => {
      localStorage.setItem("skillInspector", v ? "0" : "1");
      return !v;
    });
  };

  // When the parent swaps in the freshly saved skill, the baseline moves under us — nothing else changes.
  React.useEffect(() => {
    if (initial && initial.name !== name && !saving.current) setName(initial.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.name]);

  const trimmedName = name.trim();
  const nameError = trimmedName && !NAME_RE.test(trimmedName) ? "Lowercase letters, digits and dashes; up to 50 characters." : null;
  const valid = !!trimmedName && !nameError && !!description.trim() && !!content.trim() && content.length <= MAX_CONTENT;

  const dirtyFiles = React.useMemo(() => {
    const d: Record<string, true> = {};
    if (content !== base.content) d["SKILL.md"] = true;
    const savedFiles = base.files ?? [];
    for (const f of files) {
      const prev = savedFiles.find((p) => p.path === f.path);
      if (!prev || prev.content !== f.content) d[f.path] = true;
    }
    return d;
  }, [content, files, base]);
  const filesRemoved = (base.files ?? []).some((p) => !files.some((f) => f.path === p.path));
  const dirty = !initial || name !== base.name || description !== base.description || filesRemoved || Object.keys(dirtyFiles).length > 0;
  const hasAnything = !!(content.trim() || description.trim() || name.trim() || files.length);

  const requestClose = React.useCallback(() => {
    if (dirty && (initial || hasAnything)) setConfirmClose(true);
    else onClose();
  }, [dirty, initial, hasAnything, onClose]);

  React.useEffect(() => {
    if (!initial && !draft?.name) nameRef.current?.focus();
  }, [initial, draft]);

  // A hard refresh with edits pending asks, like any editor.
  React.useEffect(() => {
    if (!dirty || !(initial || hasAnything)) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty, initial, hasAnything]);

  const save = React.useCallback(async () => {
    if (!valid || saving.current || (initial && !dirty)) return;
    saving.current = true;
    setBusy(true);
    setErr(null);
    try {
      const r = await onMutate(
        {
          action: "upsert",
          previousName: initial?.name,
          skill: { name: trimmedName, description: description.trim(), content, files: files.length ? files : undefined, enabled: initial?.enabled ?? true },
        },
        initial ? undefined : `/${trimmedName} is live — every sandbox gets it on its next turn`
      );
      const saved = r.skills.find((s) => s.name === trimmedName);
      if (saved) onSaved(saved);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1600);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }, [valid, dirty, onMutate, initial, trimmedName, description, content, files, onSaved]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
        return;
      }
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (confirmClose || confirmDelete || filesSheet || infoSheet) return;
      const t = e.target as HTMLElement | null;
      // Escape inside a field (or CodeMirror) leaves the field; it never throws away a draft.
      if (t && (t.closest("input, textarea, select, [contenteditable], .cm-editor, [role=menu], [role=dialog]") || t.isContentEditable)) {
        t.blur?.();
        return;
      }
      requestClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [save, requestClose, confirmClose, confirmDelete, filesSheet, infoSheet]);

  const remove = async () => {
    if (!initial) return;
    setBusy(true);
    try {
      await onMutate({ action: "remove", name: initial.name }, `/${initial.name} removed`);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  const toggle = async (next: boolean) => {
    if (!initial) return;
    setToggling(true);
    try {
      const r = await onMutate({ action: "toggle", name: initial.name, enabled: next });
      const s = r.skills.find((x) => x.name === initial.name);
      if (s) onSaved(s);
    } catch (e) {
      toast.error("Could not update", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setToggling(false);
    }
  };

  const download = () => {
    const md = toSkillMd({ name: trimmedName || "skill", description: description.trim(), content });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
    a.download = `${trimmedName || "skill"}.SKILL.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const treeActions: TreeActions = {
    onAdd: (path) => setFiles((fs) => [...fs, { path, content: "" }]),
    onRename: (from, to) => {
      setFiles((fs) => fs.map((f) => (f.path === from ? { ...f, path: to } : f)));
      if (active === from) setActive(to);
    },
    onRemove: (path) => {
      setFiles((fs) => fs.filter((f) => f.path !== path));
      if (active === path) setActive("SKILL.md");
    },
  };

  const title = trimmedName ? `/${trimmedName}` : "New skill";
  const rawMd = toSkillMd({ name: trimmedName || "your-skill", description: description.trim(), content });
  const saveLabel = initial ? "Save" : "Create skill";
  const saveDisabled = !valid || busy || (!!initial && !dirty);

  const tree = (compact: boolean) => (
    <SkillFileTree
      files={files}
      active={active}
      dirty={dirtyFiles}
      onSelect={(p) => {
        setActive(p);
        setFilesSheet(false);
      }}
      actions={treeActions}
      compact={compact}
      className="h-full"
    />
  );
  const inspector = (
    <SkillInspector name={trimmedName} description={description} content={content} files={files} saved={initial} enabled={initial?.enabled ?? true} onToggle={initial ? toggle : undefined} toggling={toggling} />
  );

  return (
    <div className="bg-background flex h-full min-h-0 flex-col" role="region" aria-label={initial ? `Edit skill ${initial.name}` : "New skill"}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="bg-card/80 flex h-12 shrink-0 items-center gap-2 border-b px-2 backdrop-blur-sm sm:px-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={requestClose} aria-label="Back to skills" className="text-muted-foreground">
              <ArrowLeft />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Skills <Kbd className="ml-1.5">Esc</Kbd>
          </TooltipContent>
        </Tooltip>

        <button
          type="button"
          onClick={() => {
            setActive("SKILL.md");
            setMode("write");
            requestAnimationFrame(() => nameRef.current?.focus());
          }}
          className="hover:bg-muted flex h-8 min-w-0 cursor-pointer items-center gap-2 rounded-md px-1.5 text-left transition-colors"
          title="Rename"
        >
          <span className={cn("grid size-6 shrink-0 place-items-center rounded-md transition-colors", trimmedName ? "bg-live/10 text-live" : "bg-muted text-muted-foreground")} aria-hidden>
            <SkillMark name={trimmedName || "skill"} size={13} />
          </span>
          <span className={cn("truncate text-body font-medium", trimmedName ? "stamp text-foreground text-[13px]" : "text-muted-foreground")}>{title}</span>
          {initial && <SourceBadge source={sourceOf(initial.name)} className="hidden sm:inline-flex" />}
        </button>

        <SaveState dirty={dirty && !!initial} savedFlash={savedFlash} isNew={!initial} />

        <div className="ml-auto flex items-center gap-1.5">
          {!activeFile && (
            <AnimatedTabs
              ariaLabel="Editor mode"
              value={mode}
              onChange={setMode}
              className="hidden md:inline-flex"
              items={[
                { value: "write", icon: <PenLine className="size-3" />, label: "Write" },
                { value: "preview", icon: <Eye className="size-3" />, label: "Preview" },
              ]}
            />
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={toggleInfo} aria-pressed={showInfo} aria-label={showInfo ? "Hide details" : "Show details"} className={cn("hidden md:inline-flex", showInfo ? "text-foreground" : "text-muted-foreground")}>
                {showInfo ? <PanelRightClose /> : <PanelRightOpen />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{showInfo ? "Hide details" : "How the agent sees it"}</TooltipContent>
          </Tooltip>

          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="More actions" className="text-muted-foreground">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => {
                  setActive("SKILL.md");
                  setMode("write");
                  requestAnimationFrame(() => {
                    nameRef.current?.focus();
                    nameRef.current?.select();
                  });
                }}
              >
                <PenLine />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={download}>
                <Download />
                Download SKILL.md
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  void navigator.clipboard?.writeText(rawMd);
                  toast.success("SKILL.md copied");
                }}
              >
                <Copy />
                Copy as markdown
              </DropdownMenuItem>
              {initial && (
                <>
                  <DropdownMenuItem onSelect={() => void toggle(!initial.enabled)} disabled={toggling}>
                    <Power />
                    {initial.enabled ? "Turn off" : "Turn on"}
                    <MenuHint>{initial.enabled ? "on" : "off"}</MenuHint>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive onSelect={() => setConfirmDelete(true)}>
                    <Trash2 />
                    Delete skill…
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button size="sm" onClick={() => void save()} disabled={saveDisabled} loading={busy} className="min-w-[4.5rem]">
            <span hidden aria-hidden />
            {saveLabel}
            <Kbd className="text-primary-foreground/70 border-primary-foreground/20 hidden bg-transparent sm:inline-flex">⌘S</Kbd>
          </Button>
        </div>
      </header>

      {/* ── Phone toolbar: files · mode · details ───────────────────────── */}
      <div className="bg-card flex h-10 shrink-0 items-center gap-2 border-b px-2 md:hidden">
        <Button variant="outline" size="xs" onClick={() => setFilesSheet(true)} className="min-w-0 max-w-[45%] justify-start gap-1.5 font-normal">
          <FileText className="size-3.5" />
          <span className="stamp truncate text-[12px]">{active}</span>
          <span className="text-faint tabular ml-0.5">{files.length + 1}</span>
        </Button>
        {!activeFile && (
          <Segmented
            size="xs"
            ariaLabel="Editor mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: "write", label: "Write" },
              { value: "preview", label: "Preview" },
            ]}
          />
        )}
        <Button variant="ghost" size="icon-xs" onClick={() => setInfoSheet(true)} aria-label="Details" className="text-muted-foreground ml-auto">
          <Info />
        </Button>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        <aside className="bg-card hidden w-56 shrink-0 border-r md:flex md:flex-col lg:w-60">{tree(false)}</aside>

        <main className="flex min-w-0 flex-1 flex-col" aria-label="Document">
          {activeFile ? (
            <div className="flex h-10 shrink-0 items-center gap-3 border-b px-4">
              <span className="stamp text-foreground min-w-0 truncate text-[12px]">{activeFile.path}</span>
              {dirtyFiles[active] && <span className="bg-attention size-1.5 shrink-0 rounded-full" aria-hidden />}
              <span className="text-faint tabular ml-auto text-micro">{fmtKb(byteLength(activeFile.content))}</span>
            </div>
          ) : (
            <Frontmatter
              name={name}
              onName={(v) => setName(slugify(v.replace(/\s+/g, "-")))}
              nameRef={nameRef}
              nameError={nameError}
              description={description}
              onDescription={setDescription}
              readOnly={mode === "preview"}
            />
          )}

          <div className="relative min-h-0 flex-1">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={activeFile ? activeFile.path : mode + (mode === "preview" ? String(previewRaw) : "")}
                initial={still ? { opacity: 0 } : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.1 } }}
                transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                className="absolute inset-0 flex flex-col"
              >
                {activeFile ? (
                  <CodeEditor
                    key={activeFile.path}
                    value={activeFile.content}
                    onChange={(v) => setFiles((fs) => fs.map((f) => (f.path === activeFile.path ? { ...f, content: v } : f)))}
                    onSave={() => void save()}
                    path={activeFile.path}
                    ariaLabel={`Edit ${activeFile.path}`}
                    autoFocus
                    className="h-full"
                  />
                ) : mode === "write" ? (
                  <CodeEditor
                    value={content}
                    onChange={setContent}
                    onSave={() => void save()}
                    path="SKILL.md"
                    prose
                    ariaLabel="Skill instructions (markdown)"
                    autoFocus={!!initial || !!draft?.name}
                    placeholder={"Write the steps the agent should follow.\n\n1. Reproduce first — run the exact failing command.\n2. Read the first error, not the last.\n3. Fix the cause, then re-run the whole suite."}
                    className="h-full"
                  />
                ) : (
                  <Preview raw={previewRaw} onRaw={setPreviewRaw} rawMd={rawMd} content={content} name={trimmedName} description={description} />
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          <footer className="text-faint flex h-8 shrink-0 items-center gap-3 border-t px-4 text-micro">
            {activeFile ? (
              <span className="truncate">Ships beside SKILL.md — reference it from the instructions as “see {activeFile.path}”.</span>
            ) : (
              <>
                <span className="hidden sm:inline">Markdown · headings, lists and fenced code render for the agent.</span>
                <span className={cn("tabular ml-auto", content.length > MAX_CONTENT * 0.9 ? "text-destructive" : "")}>
                  {content.length.toLocaleString()} / {MAX_CONTENT.toLocaleString()}
                </span>
              </>
            )}
            {err && (
              <span role="alert" className="text-destructive ml-auto truncate">
                {err}
              </span>
            )}
          </footer>
        </main>

        <AnimatePresence initial={false}>
          {showInfo && (
            <motion.aside
              key="inspector"
              initial={still ? { opacity: 0 } : { width: 0, opacity: 0 }}
              animate={still ? { opacity: 1 } : { width: "18rem", opacity: 1 }}
              exit={still ? { opacity: 0 } : { width: 0, opacity: 0, transition: { duration: 0.16 } }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="bg-card hidden shrink-0 overflow-hidden border-l md:block"
            >
              <div className="h-full w-72 overflow-y-auto px-4 py-4">{inspector}</div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>

      {/* ── Phone sheets ─────────────────────────────────────────────────── */}
      <Sheet open={filesSheet} onOpenChange={setFilesSheet}>
        <SheetContent side="left" title="Files" description="Everything this skill ships." className="w-[min(20rem,calc(100vw-3rem))] p-4">
          <div className="-mx-2">{tree(true)}</div>
        </SheetContent>
      </Sheet>
      <Sheet open={infoSheet} onOpenChange={setInfoSheet}>
        <SheetContent side="right" title="How the agent sees it" className="w-[min(22rem,calc(100vw-3rem))] p-5">
          {inspector}
        </SheetContent>
      </Sheet>

      {/* ── Confirmations ────────────────────────────────────────────────── */}
      <Dialog open={confirmClose} onOpenChange={(v) => !v && setConfirmClose(false)}>
        <DialogContent title="Unsaved changes" description={initial ? `/${initial.name} has edits that are not saved.` : "This skill has not been created yet."} className="w-[min(26rem,calc(100vw-2rem))]">
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirmClose(false)} autoFocus>
              Keep editing
            </Button>
            <Button variant="outline" size="sm" onClick={onClose}>
              Discard
            </Button>
            {valid && (
              <Button
                size="sm"
                loading={busy}
                onClick={async () => {
                  await save();
                  onClose();
                }}
              >
                {initial ? "Save & leave" : "Create & leave"}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(false)}>
        <DialogContent title={`Delete /${initial?.name ?? ""}?`} description="Every sandbox loses it on its next turn. This cannot be undone." className="w-[min(26rem,calc(100vw-2rem))]">
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)} autoFocus>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" loading={busy} onClick={() => void remove()}>
              <Trash2 />
              Delete skill
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ───────────────────────────── pieces ───────────────────────────── */

/** "Unsaved" while dirty; a brief "Saved" after ⌘S; nothing when clean. New skills say "Draft". */
function SaveState({ dirty, savedFlash, isNew }: { dirty: boolean; savedFlash: boolean; isNew: boolean }) {
  const state = savedFlash ? "saved" : dirty ? "dirty" : isNew ? "draft" : "clean";
  return (
    <AnimatePresence mode="wait" initial={false}>
      {state !== "clean" && (
        <motion.span
          key={state}
          aria-live="polite"
          initial={{ opacity: 0, y: 2 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: 0.1 } }}
          transition={{ duration: 0.16 }}
          className={cn("hidden shrink-0 items-center gap-1.5 text-micro font-medium sm:flex", state === "dirty" ? "text-attention-text" : state === "saved" ? "text-ok" : "text-muted-foreground")}
        >
          <span className={cn("size-1.5 rounded-full", state === "dirty" ? "bg-attention" : state === "saved" ? "bg-ok" : "bg-muted-foreground/50")} aria-hidden />
          {state === "dirty" ? "Unsaved" : state === "saved" ? "Saved" : "Draft"}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

/**
 * The frontmatter as fields: the name reads like a title (with its `/`), the description as one
 * calm line beneath — the two things the agent matches on, given room instead of a form.
 */
function Frontmatter({
  name,
  onName,
  nameRef,
  nameError,
  description,
  onDescription,
  readOnly,
}: {
  name: string;
  onName: (v: string) => void;
  nameRef: React.RefObject<HTMLInputElement | null>;
  nameError: string | null;
  description: string;
  onDescription: (v: string) => void;
  readOnly: boolean;
}) {
  const descRef = React.useRef<HTMLTextAreaElement>(null);
  // Auto-grow the description (1–4 lines), so the body never sits under a fixed box.
  React.useLayoutEffect(() => {
    const el = descRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 112)}px`;
  }, [description]);
  const over = description.length > 1024;
  return (
    <div className="shrink-0 border-b px-5 pt-4 pb-3 sm:px-7 sm:pt-5">
      <div className="flex items-baseline gap-0.5">
        <span className={cn("stamp select-none text-[20px] leading-none", name ? "text-muted-foreground" : "text-faint")} aria-hidden>
          /
        </span>
        <input
          ref={nameRef}
          value={name}
          onChange={(e) => onName(e.target.value)}
          readOnly={readOnly}
          placeholder="skill-name"
          aria-label="Skill name — the /command in chat"
          aria-invalid={nameError ? true : undefined}
          spellCheck={false}
          autoComplete="off"
          className="stamp text-foreground placeholder:text-faint w-full min-w-0 bg-transparent text-[20px] leading-none font-medium tracking-[-0.01em] outline-none"
        />
      </div>
      <textarea
        ref={descRef}
        value={description}
        onChange={(e) => onDescription(e.target.value)}
        readOnly={readOnly}
        rows={1}
        placeholder="When should the agent use this? One or two sentences — this is what makes it pick the skill up unprompted."
        aria-label="When the agent should use this skill"
        aria-invalid={over ? true : undefined}
        className="text-foreground/90 placeholder:text-muted-foreground/70 mt-2 w-full resize-none bg-transparent text-body leading-relaxed outline-none"
      />
      <div className="mt-1 flex min-h-[1rem] items-center gap-3">
        <AnimatePresence initial={false}>
          {(nameError || over) && (
            <motion.p key="e" role="alert" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} className="text-destructive text-micro">
              {nameError ?? "The description is limited to 1,024 characters."}
            </motion.p>
          )}
        </AnimatePresence>
        <span className="text-faint ml-auto text-micro">frontmatter · name, description</span>
      </div>
    </div>
  );
}

/** Rendered, as the agent will read it — or the raw SKILL.md the controller writes, on request. */
function Preview({ raw, onRaw, rawMd, content, name, description }: { raw: boolean; onRaw: (v: boolean) => void; rawMd: string; content: string; name: string; description: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-4">
        <span className="text-muted-foreground text-micro">{raw ? "The file the controller writes into the sandbox." : "As the agent reads it."}</span>
        <Segmented
          size="xs"
          ariaLabel="Preview form"
          value={raw ? "raw" : "rendered"}
          onChange={(v) => onRaw(v === "raw")}
          className="ml-auto"
          options={[
            { value: "rendered", label: "Rendered" },
            { value: "raw", label: "Raw" },
          ]}
        />
      </div>
      {raw ? (
        <CodeEditor key="raw" value={rawMd} readOnly path="SKILL.md" prose ariaLabel="Raw SKILL.md" className="h-full" />
      ) : content.trim() ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">
          <div className="bg-muted/40 mb-5 rounded-lg border px-3.5 py-2.5">
            <div className="stamp text-foreground text-[12px] font-medium">/{name || "your-skill"}</div>
            <div className="text-muted-foreground mt-0.5 text-meta leading-snug">{description.trim() || "No description yet."}</div>
          </div>
          <Markdown className="prose-agent">{content}</Markdown>
        </div>
      ) : (
        <p className="text-muted-foreground px-7 py-5 text-meta">Nothing to preview yet — switch to Write and describe the steps.</p>
      )}
    </div>
  );
}
