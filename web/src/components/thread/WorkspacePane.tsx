import * as React from "react";
import { ArrowDown, ArrowUp, CaseSensitive, Check, ChevronRight, Columns2, Copy, CopyPlus, FilePlus, Files, FileDiff, FoldVertical, FolderPlus, GitBranch, GitCommitHorizontal, ListFilter, Loader2, Locate, Maximize2, Minimize2, PanelRight, Pencil, RefreshCw, Regex, Search, SearchCode, Table2, Trash2, Upload, WrapText, X, Box as BoxIcon, Hash as HashIcon, Heading, Key as KeyIcon, SquareFunction, Type as TypeIcon, Variable, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { ContextMenu as CM } from "radix-ui";
import { useReducedMotion } from "@/lib/motion-pref";
import { toast } from "sonner";
import { api, type ChangedFile, type FsOp, type GitStatus, type SearchMatch } from "@/lib/api";
import { languageOf } from "@/lib/fileIcon";
import { FileIcon, FolderIcon } from "@/lib/vscodeIcons";
import { AnimatedTabs } from "@/components/ui/animated-tabs";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import type { CodeEditorHandle, EditorStatus } from "@/components/CodeEditor";
import { matchSymbols, type CodeSymbol, type SymbolKind } from "@/lib/symbols";
import { invalidateResolver } from "@/components/ui/code-ref";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EmptyEditor, TabStrip } from "./EditorTabs";
import { FileView } from "./FileView";
import { EASE, MENU_CONTENT, MENU_ITEM, MENU_ITEM_DESTRUCTIVE, MENU_SEP, MenuHint, copyText, shortcutLabel, type Open } from "./workspace-chrome";
import { RecordsTable } from "./RecordsTable";
import { ReviewView, type ReviewFocus } from "./review/ReviewView";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import {
  EMPTY_TABS,
  OVERLAY_OPEN,
  SHORTCUTS,
  SIDEBAR_DEFAULT,
  baseOf,
  buildTree,
  childrenOf,
  clampTo,
  defaultPaneWidth,
  hasDrag,
  invalidName,
  matchPaths,
  matchShortcut,
  nodeAt,
  parentOf,
  paneRange,
  parseLineQuery,
  readDrag,
  setDrag,
  sidebarRange,
  tabsReducer,
  treeKeyTarget,
  typeAheadTarget,
  visibleRows,
  type Doc,
  type Node,
  type OpenOpts,
  type PaneCommands,
  type Range,
  type Row,
  type RowEdit,
} from "@/lib/workspace-model";

/**
 * The workspace as an editor: a sidebar (Files · Search · Changes · Review · All), one or two editor
 * groups with tabs, breadcrumbs and Diff / File / Edit modes, and a status bar. The explorer is one
 * keyboard-driven list of rows with a context menu, inline new/rename and drag-to-move; tabs preview
 * on single click and pin on double click; ⌘P quick-opens, ⌘⇧F searches file contents. Edits autosave
 * back into the sandbox and refresh the change list.
 */
/** A request to show a file, optionally at a line range. A new object each time, so repeats navigate. */
export type OpenRequest = { path: string; line?: number; endLine?: number };
type View = "explorer" | "search" | "scm" | "review" | "records";
type Repo = { name: string; branch?: string };

const STATUS_LETTER: Record<ChangedFile["status"], { l: string; tone: string }> = {
  modified: { l: "M", tone: "text-attention-text" },
  added: { l: "A", tone: "text-ok" },
  untracked: { l: "U", tone: "text-ok" },
  deleted: { l: "D", tone: "text-destructive" },
  renamed: { l: "R", tone: "text-live" },
};

const readStore = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
};
const writeStore = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {}
};
const removeStore = (key: string) => {
  try {
    localStorage.removeItem(key);
  } catch {}
};

export function WorkspacePane({ session, changes, open, review, onClose, onSaved, repos, full = false, onToggleFull }: { session: string; changes: ChangedFile[]; open: OpenRequest | null; /** Bumped to switch the pane to the Review view (the whole run's diff). */ review?: number; onClose: () => void; onSaved: () => void; repos: Repo[]; full?: boolean; onToggleFull?: () => void }) {
  const [paths, setPaths] = React.useState<string[] | null>(null);
  const [treeErr, setTreeErr] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set(repos.map((r) => r.name)));
  const [view, setView] = React.useState<View>("explorer");
  // Below md the pane is the whole screen and the files panel is a layer over the editor: pick a
  // file and the panel closes; the header's files button brings it back.
  const phone = !useMediaQuery("(min-width: 48rem)");
  const [sidebar, setSidebar] = React.useState(true);
  const [query, setQuery] = React.useState("");
  const [tabs, dispatch] = React.useReducer(tabsReducer, EMPTY_TABS);
  const [docs, setDocs] = React.useState<Map<string, Doc>>(() => new Map());
  const [wrap, setWrap] = React.useState(() => readStore("asb-ws-wrap", false));
  const [recent, setRecent] = React.useState<string[]>(() => readStore(`asb-ws-recent:${session}`, []));
  const [quickOpen, setQuickOpen] = React.useState<string | null>(null);
  const [focusedRow, setFocusedRow] = React.useState<string | null>(null);
  const [edit, setEdit] = React.useState<RowEdit | null>(null);
  // The explorer's filter is a header-row swap, so the field exists only while asked for or used.
  const [filtering, setFiltering] = React.useState(false);
  // Caret per open editor, by "group:path"; the status bar shows the focused tab's.
  const [carets, setCarets] = React.useState<Map<string, EditorStatus>>(() => new Map());
  const setCaret = (key: string, s: EditorStatus | null) =>
    setCarets((m) => {
      const n = new Map(m);
      if (s) n.set(key, s);
      else n.delete(key);
      return n;
    });
  const savers = React.useRef(new Map<string, () => Promise<string | null>>());
  // Live editors by "group:path", so a window-level ⌘F reaches the focused file's find widget.
  const editors = React.useRef(new Map<string, CodeEditorHandle>());
  // ⌘F on a diff tab switches it to the file and opens find once that editor mounts.
  const pendingFind = React.useRef<string | null>(null);
  const paneRef = React.useRef<HTMLElement>(null);

  const loadTree = React.useCallback(
    (signal?: AbortSignal) =>
      api
        .tree(session, signal)
        .then((r) => {
          setPaths(r.files);
          setTreeErr(null);
        })
        .catch((e: unknown) => setTreeErr(e instanceof Error ? e.message : String(e))),
    [session]
  );
  React.useEffect(() => {
    const ctrl = new AbortController();
    void loadTree(ctrl.signal);
    return () => ctrl.abort();
  }, [loadTree]);

  const changeByPath = React.useMemo(() => new Map(changes.map((c) => [c.path, c])), [changes]);
  const tree = React.useMemo(() => (paths ? buildTree(paths) : null), [paths]);
  const focusedGroup = tabs.groups[tabs.focus] ?? tabs.groups[0];
  const active = focusedGroup.active;
  const activeTab = focusedGroup.tabs.find((t) => t.path === active) ?? null;
  const activeDoc = activeTab ? docs.get(activeTab.path) : undefined;
  const caret = activeTab ? carets.get(`${tabs.focus}:${activeTab.path}`) : undefined;

  const expandTo = React.useCallback((path: string) => {
    setExpanded((e) => {
      const n = new Set(e);
      const parts = path.split("/");
      for (let i = 1; i < parts.length; i++) n.add(parts.slice(0, i).join("/"));
      return n;
    });
  }, []);
  const pushRecent = React.useCallback(
    (path: string) =>
      setRecent((r) => {
        const next = [path, ...r.filter((p) => p !== path)].slice(0, 30);
        writeStore(`asb-ws-recent:${session}`, next);
        return next;
      }),
    [session]
  );
  const openPath = React.useCallback<Open>(
    (path, opts = {}) => {
      dispatch({ type: "open", path, opts });
      expandTo(path);
      setFocusedRow(path);
      if (!opts.preview) pushRecent(path);
      if (phone) setSidebar(false);
    },
    [expandTo, pushRecent, phone]
  );
  React.useEffect(() => {
    if (!open) return;
    const reveal = open.line ? { from: open.line, to: open.endLine ?? open.line, nonce: Date.now() } : undefined;
    openPath(open.path, { mode: changeByPath.has(open.path) ? "diff" : "edit", reveal });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // "Review all" (the ChangesDock shortcut, the palette) lands on the whole-run diff.
  const [reviewFocus, setReviewFocus] = React.useState<ReviewFocus | null>(null);
  React.useEffect(() => {
    if (!review) return;
    setView("review");
    setSidebar(true);
  }, [review]);

  // An empty editor is a dead end: when the tree arrives and nothing is open, open the most useful file —
  // the first change, else a README, else the first file at the repo root.
  React.useEffect(() => {
    if (!paths || tabs.groups[0].tabs.length > 0 || open) return;
    const first = changes[0]?.path ?? paths.find((p) => /(^|\/)readme\.md$/i.test(p)) ?? [...paths].sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))[0];
    if (first) openPath(first, { mode: changes[0] ? "diff" : "edit" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paths]);

  const setDoc = React.useCallback((path: string, p: Partial<Doc>) => {
    setDocs((m) => {
      const n = new Map(m);
      n.set(path, { ...(m.get(path) ?? { dirty: false }), ...p });
      return n;
    });
  }, []);
  const dirtySet = React.useMemo(() => new Set([...docs].filter(([, d]) => d.dirty).map(([p]) => p)), [docs]);
  const holders = (path: string) => tabs.groups.reduce((n, g) => n + g.tabs.filter((t) => t.path === path).length, 0);

  const closeTab = async (group: 0 | 1, path: string) => {
    const saver = savers.current.get(path);
    if (docs.get(path)?.dirty && saver && holders(path) === 1) {
      const err = await saver();
      if (err) {
        toast.error("Could not save", {
          description: err,
          action: {
            label: "Discard",
            onClick: () => {
              setDoc(path, { draft: undefined, dirty: false, saving: undefined });
              dispatch({ type: "close", group, path });
            },
          },
        });
        return;
      }
    }
    dispatch({ type: "close", group, path });
  };
  const closePathEverywhere = (path: string) => {
    tabs.groups.forEach((g, gi) => g.tabs.forEach((t) => (t.path === path || t.path.startsWith(path + "/")) && dispatch({ type: "close", group: gi as 0 | 1, path: t.path })));
  };
  const onFs = async (op: FsOp): Promise<boolean> => {
    try {
      const r = await api.fs(session, op);
      setPaths(r.files);
      invalidateResolver(session);
      if (op.op === "move") {
        dispatch({ type: "rename", from: op.path, to: op.to });
        setDocs((m) => new Map([...m].map(([p, d]) => [p === op.path ? op.to : p.startsWith(op.path + "/") ? op.to + p.slice(op.path.length) : p, d])));
        setFocusedRow(op.to);
      } else if (op.op === "delete") {
        closePathEverywhere(op.path);
        setFocusedRow(parentOf(op.path) || null);
      } else {
        setFocusedRow(op.path);
        if (op.op !== "copy") expandTo(op.path);
        if (op.op === "create") openPath(op.path, { preview: false });
      }
      onSaved();
      return true;
    } catch (e) {
      toast.error(`Could not ${op.op === "mkdir" ? "create folder" : op.op}`, { description: e instanceof Error ? e.message : String(e) });
      return false;
    }
  };
  const revealActive = () => {
    if (!active) return;
    setView("explorer");
    setSidebar(true);
    setQuery("");
    expandTo(active);
    setFocusedRow(active);
    requestAnimationFrame(() => paneRef.current?.querySelector<HTMLElement>(`[role=tree] [data-path="${CSS.escape(active)}"]`)?.focus());
  };

  const toggleWrap = () => setWrap((w) => (writeStore("asb-ws-wrap", !w), !w));
  // The explorer header's New file / New folder: into the focused folder, else beside the focused
  // or active file, else at the repo root, as VS Code's do.
  const startEdit = (what: "newFile" | "newDir") => {
    const at = focusedRow ?? active;
    const dir = at ? (tree && nodeAt(tree, at)?.children ? at : parentOf(at)) : (repos[0]?.name ?? "");
    setQuery("");
    if (dir) {
      expandTo(dir);
      setExpanded((e) => new Set(e).add(dir));
    }
    setEdit({ what, parent: dir });
  };
  const saveActive = () => {
    const saver = active && savers.current.get(active);
    if (saver) void saver().then((err) => err && toast.error("Could not save", { description: err }));
  };
  const commands: PaneCommands = {
    closeActive: () => void (active && closeTab(tabs.focus, active)),
    quickOpen: (prefill = "") => {
      // "@" reads the file's syntax tree, which only the editor holds, so a diff tab switches to the file.
      if (prefill.startsWith("@") && activeTab?.mode === "diff") dispatch({ type: "setMode", path: activeTab.path, mode: "edit" });
      setQuickOpen(prefill);
    },
    toggleSidebar: () => setSidebar((v) => !v),
    searchInFiles: () => (setSidebar(true), setView("search")),
    find: () => {
      if (!activeTab || view === "review" || view === "records") return commands.searchInFiles();
      const key = `${tabs.focus}:${activeTab.path}`;
      const editor = editors.current.get(key);
      if (editor) return editor.openFind();
      pendingFind.current = key;
      if (activeTab.mode === "diff") dispatch({ type: "setMode", path: activeTab.path, mode: "edit" });
    },
    save: saveActive,
    split: () => dispatch({ type: "split" }),
    toggleWrap,
    focusGroup: (g) => dispatch({ type: "focus", group: g }),
  };
  const registerEditor = (key: string, h: CodeEditorHandle | null) => {
    if (!h) return void editors.current.delete(key);
    editors.current.set(key, h);
    if (pendingFind.current === key) {
      pendingFind.current = null;
      h.openFind();
    }
  };
  // The chords work from anywhere while the pane is mounted, as in VS Code: the composer, the
  // side chat, the tree. Captured at the window so the editor's own keymap never fires twice;
  // quiet while a dialog or menu owns the keyboard and when something upstream already handled it.
  const commandsRef = React.useRef(commands);
  commandsRef.current = commands;
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const s = matchShortcut(e, SHORTCUTS);
      if (!s || document.querySelector(OVERLAY_OPEN)) return;
      e.preventDefault();
      e.stopPropagation();
      s.run(commandsRef.current);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const activeRepo = React.useMemo(() => {
    const top = (active ?? changes[0]?.path ?? "").split("/")[0];
    return repos.find((r) => r.name === top) ?? repos[0];
  }, [active, changes, repos]);
  // Git's own view of the repo (branch, ahead/behind, last commit) — shared by Source Control and the status bar.
  const [git, setGit] = React.useState<GitStatus | null>(null);
  const [gitErr, setGitErr] = React.useState<string | null>(null);
  const activeRepoName = activeRepo?.name;
  const loadGit = React.useCallback(() => {
    if (!activeRepoName) return;
    api
      .gitStatus(session, activeRepoName)
      .then((g) => {
        setGit(g);
        setGitErr(null);
      })
      .catch((e: unknown) => setGitErr(e instanceof Error ? e.message : String(e)));
  }, [session, activeRepoName]);
  React.useEffect(loadGit, [loadGit, changes.length]);

  // Widths: the pane inside its container, the files panel inside the pane. A stored width is
  // clamped against the container it is restored into, so a 1920px layout cannot swallow a 1280px one.
  const [container, setContainer] = React.useState(0);
  React.useLayoutEffect(() => {
    const parent = paneRef.current?.parentElement;
    if (!parent) return;
    const measure = () => setContainer(parent.getBoundingClientRect().width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);
  const [panePref, setPanePref] = React.useState(() => readStore<number | null>("asb-workspace-w", null));
  const [sidebarPref, setSidebarPref] = React.useState(() => readStore<number | null>("asb-ws-sidebar-w", null));
  const [resizing, setResizing] = React.useState(false);
  const range = paneRange(container);
  const width = container ? clampTo(panePref ?? defaultPaneWidth(container), range) : 0;
  const sbRange = sidebarRange(full ? container : width);
  const sidebarWidth = clampTo(sidebarPref ?? SIDEBAR_DEFAULT, sbRange);
  const persist = (key: string, w: number | null) => (w === null ? removeStore(key) : writeStore(key, w));
  const setPaneWidth = (w: number | null) => (persist("asb-workspace-w", w), setPanePref(w));
  const setSidebarWidth = (w: number | null) => (persist("asb-ws-sidebar-w", w), setSidebarPref(w));

  const filesTitle = view === "scm" || view === "review" ? "Changes" : view === "search" ? "Search" : "Files";
  const controls = (
    <div className="flex shrink-0 items-center gap-0.5 border-l px-1.5 [&_.lucide]:[stroke-width:1.5]">
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" onClick={onToggleFull} aria-pressed={full} aria-label={full ? "Show the conversation" : "Full view"} className="text-muted-foreground hover:text-foreground hover:bg-muted grid size-7 cursor-pointer place-items-center rounded-md">
            {full ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{full ? "Show the conversation" : "Full view — collapse the conversation"}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" onClick={() => setSidebar((v) => !v)} aria-pressed={sidebar} aria-label={sidebar ? "Hide files" : "Show files"} className={cn("hover:bg-muted grid size-7 cursor-pointer place-items-center rounded-md", sidebar ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
            <PanelRight className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {sidebar ? "Hide the files panel" : "Show the files panel"}
          <Kbd className="ml-2">{shortcutLabel("sidebar")}</Kbd>
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" onClick={onClose} aria-label="Close workspace" className="text-muted-foreground hover:text-foreground hover:bg-muted grid size-7 cursor-pointer place-items-center rounded-md">
            <X className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Close</TooltipContent>
      </Tooltip>
    </div>
  );

  return (
    <motion.aside
      ref={paneRef}
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: full || phone ? "100%" : width || "58%", opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ width: resizing ? { duration: 0 } : { duration: 0.28, ease: EASE }, opacity: { duration: 0.18 } }}
      className="bg-card absolute inset-0 z-20 flex min-w-0 flex-col overflow-hidden md:relative md:inset-auto md:h-full md:shrink-0 md:border-l"
      aria-label="Workspace"
    >
      {!full && !phone && <Divider value={width} range={range} label="Resize workspace" onChange={setPaneWidth} onReset={() => setPaneWidth(null)} onDragging={setResizing} />}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1">
          {view === "review" ? (
            <div className="flex min-w-0 flex-1 flex-col">
              <div data-ws-top className="flex h-9 shrink-0 items-stretch border-b">
                <span className="text-muted-foreground flex flex-1 items-center px-3 text-meta">Review</span>
                {controls}
              </div>
              <ReviewView session={session} focus={reviewFocus} className="min-h-0 flex-1" />
            </div>
          ) : view === "records" ? (
            <div className="flex min-w-0 flex-1 flex-col">
              <div data-ws-top className="flex h-9 shrink-0 items-stretch border-b">
                <span className="text-muted-foreground flex flex-1 items-center px-3 text-meta">All files</span>
                {controls}
              </div>
              <RecordsTable session={session} onOpen={(p) => (setView("explorer"), openPath(p))} />
            </div>
          ) : (
            tabs.groups.map((g, i) => {
              const gi = i as 0 | 1;
              const focused = tabs.focus === gi;
              const tab = g.tabs.find((t) => t.path === g.active) ?? null;
              return (
                <div key={gi} data-group={gi} data-focused={focused} className={cn("flex min-h-0 min-w-0 flex-1 flex-col", gi === 1 && "border-l")} onPointerDownCapture={() => !focused && dispatch({ type: "focus", group: gi })}>
                  <div data-ws-top className={cn("flex h-9 shrink-0 items-stretch border-b transition-colors [&_.lucide]:[stroke-width:1.5]", focused ? "bg-muted/40" : "bg-muted/70")}>
                    <TabStrip group={gi} state={g} focused={focused} dirty={dirtySet} dispatch={dispatch} onClose={(p) => void closeTab(gi, p)} />
                    {i === tabs.groups.length - 1 && controls}
                  </div>
                  {tab ? (
                    <FileView
                      key={`${gi}:${tab.path}`}
                      session={session}
                      tab={tab}
                      doc={docs.get(tab.path) ?? { dirty: false }}
                      tree={tree}
                      change={changeByPath.get(tab.path)}
                      wrap={wrap}
                      onMode={(m) => dispatch({ type: "setMode", path: tab.path, mode: m })}
                      onDoc={(p) => setDoc(tab.path, p)}
                      onPin={() => dispatch({ type: "pin", path: tab.path })}
                      onOpen={openPath}
                      onSaved={onSaved}
                      onSaver={(fn) => (fn ? savers.current.set(tab.path, fn) : savers.current.delete(tab.path))}
                      onEditor={(h) => registerEditor(`${gi}:${tab.path}`, h)}
                      onStatus={(s) => setCaret(`${gi}:${tab.path}`, s)}
                    />
                  ) : (
                    <EmptyEditor />
                  )}
                </div>
              );
            })
          )}
        </div>

        {sidebar && (
          <section className={cn("bg-muted/20 relative flex shrink-0 flex-col border-l", phone && "bg-card absolute inset-0 z-10 border-l-0")} style={phone ? undefined : { width: sidebarWidth }} aria-label={filesTitle}>
            {!phone && <Divider value={sidebarWidth} range={sbRange} label="Resize files panel" onChange={setSidebarWidth} onReset={() => setSidebarWidth(null)} />}
            <div data-ws-top className="flex h-9 shrink-0 items-center gap-1 border-b px-2 [&_.lucide]:[stroke-width:1.5]">
              <AnimatedTabs
                ariaLabel="Sidebar view"
                value={view}
                onChange={(v) => setView(v)}
                items={[
                  { value: "explorer", icon: <Files className="size-3.5" />, label: <span className="sr-only">Files</span>, title: "Files" },
                  { value: "search", icon: <SearchCode className="size-3.5" />, label: <span className="sr-only">Search</span>, title: `Search in files (${shortcutLabel("searchInFiles")})` },
                  {
                    value: "scm",
                    icon: <GitBranch className="size-3.5" />,
                    label: <span className="sr-only">Changes</span>,
                    title: "Changes",
                    badge: changes.length > 0 && <span className={cn("rounded-full px-1.5 text-[9px] leading-4 font-semibold", view === "scm" ? "bg-live text-white" : "bg-live/20 text-live")}>{changes.length}</span>,
                  },
                  { value: "review", icon: <FileDiff className="size-3.5" />, label: <span className="sr-only">Review</span>, title: "Review the whole run" },
                  { value: "records", icon: <Table2 className="size-3.5" />, label: <span className="sr-only">All</span>, title: "All files" },
                ]}
              />
              {view !== "explorer" ? (
                <button type="button" onClick={() => (view === "scm" || view === "review" ? loadGit() : void loadTree())} aria-label="Refresh" className="text-muted-foreground hover:text-foreground ml-auto grid size-7 cursor-pointer place-items-center rounded-md">
                  <RefreshCw className="size-3.5" />
                </button>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" onClick={() => setFiltering((f) => !f || !!query)} disabled={!tree} aria-pressed={filtering || !!query} aria-label="Filter files" className={cn("hover:bg-muted ml-auto grid size-7 cursor-pointer place-items-center rounded-md disabled:opacity-40", filtering || query ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
                      <ListFilter className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Filter files</TooltipContent>
                </Tooltip>
              )}
              {phone && (
                <button type="button" onClick={onClose} aria-label="Close workspace" className="text-muted-foreground hover:text-foreground grid size-7 cursor-pointer place-items-center rounded-md">
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            {view === "scm" || view === "review" ? (
              <SourceControl session={session} repo={activeRepo} status={git} err={gitErr} reload={loadGit} changes={changes} active={view === "review" ? (reviewFocus?.path ?? null) : active} onOpen={(p) => (view === "review" ? (setReviewFocus({ path: p, nonce: Date.now() }), phone && setSidebar(false)) : openPath(p, { mode: "diff", preview: true }))} onChanged={onSaved} />
            ) : view === "search" ? (
              <SearchView session={session} active={active} onOpen={openPath} />
            ) : (
              <>
                {/* Section header, as VS Code's: the title, the repo, and actions that show on hover.
                    The filter is the same row, swapped in on demand, so the tree starts one row down. */}
                <div className="group/hdr relative flex h-[26px] shrink-0 items-center gap-1.5 pr-1 pl-3 [&_.lucide]:[stroke-width:1.5]">
                  {filtering || query ? (
                    <label className="flex h-full min-w-0 flex-1 items-center gap-1.5">
                      <Search className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
                      <input
                        autoFocus
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => e.key === "Escape" && (setQuery(""), setFiltering(false))}
                        onBlur={() => !query && setFiltering(false)}
                        placeholder="Filter files"
                        aria-label="Filter files"
                        className="text-foreground placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-meta outline-none"
                      />
                      <button type="button" onClick={() => (setQuery(""), setFiltering(false))} aria-label="Clear" className="text-muted-foreground hover:text-foreground hover:bg-muted grid size-6 shrink-0 cursor-pointer place-items-center rounded">
                        <X className="size-3.5" />
                      </button>
                    </label>
                  ) : (
                    <>
                      <span className="label text-foreground">Explorer</span>
                      {repos.length === 1 && <span className="stamp text-muted-foreground truncate">{repos[0].name}</span>}
                      {/* Overlaid, not in flow: the stamp keeps the row's full width until the actions show. */}
                      <span className="from-background absolute inset-y-0 right-1 flex items-center bg-gradient-to-l from-75% to-transparent pl-5 opacity-0 transition-opacity group-focus-within/hdr:opacity-100 group-hover/hdr:opacity-100 [@media(pointer:coarse)]:opacity-100">
                        <HeaderAction label="New file" onClick={() => startEdit("newFile")} disabled={!tree}>
                          <FilePlus className="size-3.5" />
                        </HeaderAction>
                        <HeaderAction label="New folder" onClick={() => startEdit("newDir")} disabled={!tree}>
                          <FolderPlus className="size-3.5" />
                        </HeaderAction>
                        <HeaderAction label="Collapse all folders" onClick={() => (setExpanded(new Set()), setEdit(null))}>
                          <FoldVertical className="size-3.5" />
                        </HeaderAction>
                        <HeaderAction label="Refresh" onClick={() => void loadTree()}>
                          <RefreshCw className="size-3.5" />
                        </HeaderAction>
                      </span>
                    </>
                  )}
                </div>
                {query.trim() ? (
                  <GoToFile paths={paths} query={query} active={active} changeByPath={changeByPath} onOpen={(p) => (openPath(p), setQuery(""))} />
                ) : (
                  <Explorer
                    tree={tree}
                    err={treeErr}
                    expanded={expanded}
                    focused={focusedRow}
                    active={active}
                    changeByPath={changeByPath}
                    repos={repos}
                    edit={edit}
                    onEdit={setEdit}
                    onFocus={setFocusedRow}
                    onToggle={(dir, openIt) =>
                      setExpanded((e) => {
                        const s = new Set(e);
                        const want = openIt ?? !s.has(dir);
                        if (want) s.add(dir);
                        else s.delete(dir);
                        return s;
                      })
                    }
                    onReveal={revealActive}
                    onOpen={openPath}
                    onFs={onFs}
                  />
                )}
              </>
            )}
          </section>
        )}
      </div>

      {/* The one status bar: the repo on the left, the focused file on the right. */}
      <footer data-ws-status aria-label="Workspace status" className="bg-muted/60 text-muted-foreground tabular flex h-7 shrink-0 items-center gap-3 overflow-hidden border-t px-3 text-micro whitespace-nowrap [&_.lucide]:[stroke-width:1.5]">
        {activeRepo && (
          <button type="button" onClick={() => (setView("scm"), setSidebar(true))} className="text-foreground hover:bg-muted flex h-5 min-w-0 cursor-pointer items-center gap-1 rounded px-1" aria-label="Open source control">
            <GitBranch className="size-3" aria-hidden />
            <span className="truncate">{git?.branch ?? activeRepo.branch ?? "…"}</span>
            {git && git.ahead > 0 && <span className="text-ok">↑{git.ahead}</span>}
            {git && git.behind > 0 && <span className="text-attention-text">↓{git.behind}</span>}
          </button>
        )}
        <span className="hidden sm:inline">{changes.length} changed</span>
        {paths && <span className="hidden sm:inline">{paths.length} files</span>}
        {activeTab && (
          <span className="ml-auto flex items-center gap-3" aria-label="Editor status">
            {activeTab.mode === "edit" && caret && (
              <span>
                Ln {caret.line}, Col {caret.col}
                {caret.selected > 0 && ` (${caret.selected} selected)`}
              </span>
            )}
            {activeTab.mode === "edit" && (
              <span className={cn("transition-colors", activeDoc?.dirty && activeDoc.saving !== "saving" && "text-attention-text")} aria-live="polite">
                {activeDoc?.saving === "saving" ? "Saving…" : activeDoc?.dirty ? "Unsaved" : activeDoc?.saving === "saved" ? "Saved" : "Autosave on"}
              </span>
            )}
            <span>{languageOf(activeTab.path)}</span>
            {activeTab.mode === "edit" && (
              <button type="button" onClick={toggleWrap} aria-pressed={wrap} aria-label="Toggle word wrap" title={`Word wrap (${shortcutLabel("wrap")})`} className={cn("hover:bg-muted hover:text-foreground flex h-5 cursor-pointer items-center gap-1 rounded px-1", wrap && "text-foreground")}>
                <WrapText className="size-3" aria-hidden />
                Wrap
              </button>
            )}
            {activeTab.preview && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" onClick={() => dispatch({ type: "pin", path: activeTab.path })} className="hover:bg-muted hover:text-foreground flex h-5 cursor-pointer items-center rounded border px-1.5 italic">
                    Preview
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">A preview tab is replaced by the next file. Click to keep it open.</TooltipContent>
              </Tooltip>
            )}
          </span>
        )}
      </footer>

      {quickOpen !== null && (
        <QuickOpen
          paths={paths}
          recent={recent}
          activePath={active}
          editor={() => (active ? (editors.current.get(`${tabs.focus}:${active}`) ?? null) : null)}
          initial={quickOpen}
          onPick={(p, opts) => {
            openPath(p, opts);
            setQuickOpen(null);
          }}
          onClose={() => setQuickOpen(null)}
        />
      )}
    </motion.aside>
  );
}

/** A section header's hover action: a 24px icon button with its name in a tooltip. */
function HeaderAction({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" onClick={onClick} disabled={disabled} aria-label={label} className="text-muted-foreground hover:text-foreground hover:bg-muted grid size-6 shrink-0 cursor-pointer place-items-center rounded disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent">
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/* ───────────────────────────── Resize handle ───────────────────────────── */

function Divider({ value, range, label, onChange, onReset, onDragging }: { value: number; range: Range; label: string; onChange: (w: number) => void; onReset: () => void; onDragging?: (on: boolean) => void }) {
  const [active, setActive] = React.useState(false);
  const set = (w: number) => onChange(clampTo(w, range));
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    const x0 = e.clientX;
    const start = value;
    el.setPointerCapture(e.pointerId);
    setActive(true);
    onDragging?.(true);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    const move = (ev: PointerEvent) => set(start + (x0 - ev.clientX));
    const end = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("lostpointercapture", end);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      setActive(false);
      onDragging?.(false);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("lostpointercapture", end);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const by = e.shiftKey ? 64 : 16;
    const next = e.key === "ArrowLeft" ? value + by : e.key === "ArrowRight" ? value - by : e.key === "Home" ? range.min : e.key === "End" ? range.max : null;
    if (next === null) return;
    e.preventDefault();
    onDragging?.(true);
    set(next);
  };
  const settle = () => onDragging?.(false);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={range.min}
      aria-valuemax={range.max}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      data-active={active || undefined}
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      onKeyUp={settle}
      onBlur={settle}
      className="group absolute top-0 bottom-0 -left-1 z-30 hidden w-2 cursor-col-resize outline-none md:block"
    >
      <span aria-hidden className="group-hover:bg-live/50 group-focus-visible:bg-live group-data-[active]:bg-live absolute inset-y-0 left-1 w-px transition-colors duration-150" />
      <span aria-hidden className="bg-muted-foreground/35 group-hover:bg-live group-focus-visible:bg-live group-data-[active]:bg-live absolute top-1/2 left-[3px] h-8 w-[3px] -translate-y-1/2 rounded-full transition-colors duration-150" />
    </div>
  );
}

/* ───────────────────────────── Explorer ───────────────────────────── */

type MenuAction = "newFile" | "newDir" | "rename" | "delete" | "duplicate" | "copyPath" | "copyRelPath" | "openSide" | "reveal";

const MAX_ANIMATED_ROW_SHIFT = 40;

function Explorer({ tree, err, expanded, focused, active, changeByPath, repos, edit, onEdit, onFocus, onToggle, onReveal, onOpen, onFs }: { tree: Node | null; err: string | null; expanded: Set<string>; focused: string | null; active: string | null; changeByPath: Map<string, ChangedFile>; repos: Repo[]; edit: RowEdit | null; onEdit: (e: RowEdit | null) => void; onFocus: (path: string | null) => void; onToggle: (dir: string, open?: boolean) => void; onReveal: () => void; onOpen: Open; onFs: (op: FsOp) => Promise<boolean> }) {
  const rows = React.useMemo(() => (tree ? visibleRows(tree, expanded, edit) : null), [tree, expanded, edit]);
  const listRef = React.useRef<HTMLUListElement>(null);
  const [menuTarget, setMenuTarget] = React.useState<Row | null>(null);
  const [dropDir, setDropDir] = React.useState<string | null>(null);
  const dragSrc = React.useRef<string | null>(null);
  const typed = React.useRef({ text: "", at: 0 });
  const still = useReducedMotion();
  const prevLen = React.useRef(rows?.length ?? 0);
  const delta = (rows?.length ?? 0) - prevLen.current;
  prevLen.current = rows?.length ?? 0;
  const animateRows = !still && delta !== 0 && Math.abs(delta) <= MAX_ANIMATED_ROW_SHIFT;

  const changeCounts = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const p of changeByPath.keys()) {
      const parts = p.split("/");
      for (let i = 1; i < parts.length; i++) {
        const d = parts.slice(0, i).join("/");
        m.set(d, (m.get(d) ?? 0) + 1);
      }
    }
    return m;
  }, [changeByPath]);

  const focusIndex = rows && focused ? rows.findIndex((r) => r.path === focused && r.kind !== "edit") : -1;
  React.useEffect(() => {
    const list = listRef.current;
    const typingInEditRow = document.activeElement instanceof HTMLInputElement;
    if (!list || !focused || !list.contains(document.activeElement) || typingInEditRow) return;
    const el = list.querySelector<HTMLElement>(`[data-path="${CSS.escape(focused)}"]`);
    if (el && el !== document.activeElement) {
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: "nearest" });
    }
  }, [focused, rows]);

  const moveTo = (i: number | null) => {
    if (i === null || !rows || !rows[i]) return;
    onFocus(rows[i].path);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!rows || rows.length === 0 || (e.target as HTMLElement).tagName === "INPUT") return;
    const row = rows[focusIndex];
    const k = e.key;
    if (k === "ArrowUp" || k === "ArrowDown" || k === "Home" || k === "End" || k === "ArrowLeft" || k === "ArrowRight") {
      e.preventDefault();
      const target = treeKeyTarget(rows, focusIndex, k);
      if (target !== null) return moveTo(target);
      if (row?.kind === "dir") onToggle(row.path, k === "ArrowRight");
      return;
    }
    if (!row || row.kind === "edit") return;
    if (k === "Enter" || k === " ") {
      e.preventDefault();
      if (row.kind === "dir") onToggle(row.path);
      else onOpen(row.path, { preview: k === " " });
    } else if (k === "F2") {
      e.preventDefault();
      if (row.depth > 0) onEdit({ what: "rename", target: row.path });
    } else if (k === "Delete" || k === "Backspace") {
      e.preventDefault();
      void act("delete", row);
    } else if ((e.metaKey || e.ctrlKey) && k.toLowerCase() === "c") {
      e.preventDefault();
      void act(e.shiftKey ? "copyRelPath" : "copyPath", row);
    } else if (k.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 600 ? typed.current.text : "") + k, at: now };
      moveTo(typeAheadTarget(rows, focusIndex, typed.current.text));
    }
  };

  const siblingsOf = (parent: string, except?: string) => new Set(childrenOf(tree!, parent).map((n) => n.name).filter((n) => n !== except));
  const act = async (a: MenuAction, target: Row | null) => {
    const t = target && target.kind !== "edit" ? target : null;
    switch (a) {
      case "newFile":
      case "newDir": {
        const parent = t ? (t.kind === "dir" ? t.path : parentOf(t.path)) : "";
        if (parent) onToggle(parent, true);
        onEdit({ what: a, parent });
        return;
      }
      case "rename":
        if (t && t.depth > 0) onEdit({ what: "rename", target: t.path });
        return;
      case "delete":
        if (!t || t.depth === 0) return;
        if (!window.confirm(`Delete ${t.kind === "dir" ? "folder" : "file"} "${t.name}"? This cannot be undone.`)) return;
        await onFs({ op: "delete", path: t.path });
        return;
      case "duplicate": {
        if (!t || t.depth === 0) return;
        const taken = siblingsOf(parentOf(t.path));
        const dot = t.kind === "file" ? t.name.lastIndexOf(".") : -1;
        const stem = dot > 0 ? t.name.slice(0, dot) : t.name;
        const ext = dot > 0 ? t.name.slice(dot) : "";
        let name = `${stem} copy${ext}`;
        for (let n = 2; taken.has(name); n++) name = `${stem} copy ${n}${ext}`;
        await onFs({ op: "copy", path: t.path, to: `${parentOf(t.path)}/${name}` });
        return;
      }
      case "copyPath":
        if (t) void copyText(`/workspace/${t.path}`);
        return;
      case "copyRelPath":
        if (t) void copyText(t.path.slice(t.path.indexOf("/") + 1));
        return;
      case "openSide":
        if (t?.kind === "file") onOpen(t.path, { side: true });
        return;
      case "reveal":
        onReveal();
        return;
    }
  };
  const commitEdit = async (row: Row & { kind: "edit" }, name: string | null) => {
    onEdit(null);
    if (name === null) return;
    const e = row.edit;
    if (e.what === "rename") {
      const to = `${parentOf(e.target)}/${name}`;
      if (to !== e.target) await onFs({ op: "move", path: e.target, to });
    } else {
      await onFs({ op: e.what === "newDir" ? "mkdir" : "create", path: e.parent ? `${e.parent}/${name}` : name });
    }
  };

  const dropDirFor = (el: Element | null) => {
    const r = rows?.find((x) => x.path === (el?.closest("[data-path]") as HTMLElement | null)?.dataset.path);
    if (!r || r.kind === "edit") return null;
    const dir = r.kind === "dir" ? r.path : parentOf(r.path);
    const src = dragSrc.current;
    if (!dir || !src || dir === src || dir === parentOf(src) || dir.startsWith(src + "/")) return null;
    return dir;
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!hasDrag(e, "asb/path")) return;
    const dir = dropDirFor(e.target as Element);
    setDropDir(dir);
    if (dir) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    }
  };
  const onDrop = (e: React.DragEvent) => {
    const src = readDrag(e, "asb/path")?.path ?? dragSrc.current;
    const dir = dropDirFor(e.target as Element);
    setDropDir(null);
    dragSrc.current = null;
    if (!src || !dir) return;
    e.preventDefault();
    void onFs({ op: "move", path: src, to: `${dir}/${baseOf(src)}` });
  };

  return (
    <CM.Root onOpenChange={(o) => !o && setMenuTarget(null)}>
      <CM.Trigger asChild>
        <div
          className="min-h-0 flex-1 overflow-auto pb-2"
          onContextMenuCapture={(e) => {
            const path = (e.target as HTMLElement).closest<HTMLElement>("[data-path]")?.dataset.path;
            const row = rows?.find((r) => r.path === path && r.kind !== "edit") ?? null;
            setMenuTarget(row);
            if (row) onFocus(row.path);
          }}
        >
          {err ? (
            <p className="text-destructive px-3 py-2 text-micro">{err}</p>
          ) : !rows ? (
            <div className="flex flex-col gap-2.5 px-3 py-2">
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <span key={i} className="bg-muted h-3 animate-pulse rounded" style={{ width: `${50 + ((i * 23) % 40)}%`, marginLeft: `${(i % 3) * 12}px` }} />
              ))}
            </div>
          ) : (
            <ul ref={listRef} role="tree" aria-label="Files" className="relative outline-none" onKeyDown={onKeyDown} onDragOver={onDragOver} onDrop={onDrop} onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as globalThis.Node | null) && setDropDir(null)}>
              <AnimatePresence initial={false} custom={animateRows}>
                {rows.map((row, i) => {
                  if (row.kind === "edit") {
                    return (
                      <li key={`edit:${row.edit.what}:${row.path}`} role="treeitem" aria-level={row.depth + 1} className="relative flex h-[22px] items-center" style={{ paddingLeft: `${8 + row.depth * 12 + (row.edit.what === "newDir" ? 0 : 18)}px` }}>
                        <Guides depth={row.depth} />
                        <EditRow edit={row.edit} siblings={siblingsOf(row.edit.what === "rename" ? parentOf(row.edit.target) : row.edit.parent, row.edit.what === "rename" ? baseOf(row.edit.target) : undefined)} onDone={(name) => void commitEdit(row, name)} />
                      </li>
                    );
                  }
                  const isFocused = focused === row.path;
                  const repo = row.kind === "dir" && row.depth === 0 ? repos.find((r) => r.name === row.name) : undefined;
                  return (
                    <motion.li
                      key={row.path}
                      custom={animateRows}
                      variants={{ hidden: (anim: boolean) => (anim ? { opacity: 0, y: -3, transition: { duration: 0.12, ease: EASE } } : { opacity: 0, transition: { duration: 0 } }), shown: { opacity: 1, y: 0, transition: { duration: 0.16, ease: EASE } } }}
                      initial="hidden"
                      animate="shown"
                      exit="hidden"
                      role="treeitem"
                      aria-level={row.depth + 1}
                      aria-expanded={row.kind === "dir" ? row.expanded : undefined}
                      aria-selected={isFocused}
                      aria-current={active === row.path ? "true" : undefined}
                      tabIndex={isFocused || (focusIndex < 0 && i === 0) ? 0 : -1}
                      data-path={row.path}
                      data-kind={row.kind}
                      title={row.path}
                      draggable={row.depth > 0}
                      onDragStartCapture={(e) => {
                        dragSrc.current = row.path;
                        setDrag(e, "asb/path", { path: row.path });
                      }}
                      onDragEndCapture={() => {
                        dragSrc.current = null;
                        setDropDir(null);
                      }}
                      onFocus={() => !isFocused && onFocus(row.path)}
                      onClick={() => {
                        onFocus(row.path);
                        if (row.kind === "dir") onToggle(row.path);
                        else onOpen(row.path, { preview: true });
                      }}
                      onDoubleClick={() => row.kind === "file" && onOpen(row.path, { preview: false })}
                      className={cn(
                        "text-foreground relative isolate flex h-[22px] cursor-pointer items-center gap-1 pr-2 text-left text-meta outline-none transition-colors select-none",
                        active !== row.path && "hover:bg-muted",
                        isFocused && "focus-visible:ring-ring ring-inset focus-visible:ring-1",
                        dropDir === row.path && "bg-live/15 ring-live ring-1 ring-inset"
                      )}
                      style={{ paddingLeft: `${8 + row.depth * 12 + (row.kind === "file" ? 18 : 0)}px` }}
                    >
                      <Guides depth={row.depth} />
                      {active === row.path && <ActiveRow />}
                      <RowView row={row} repo={repo} change={row.kind === "file" ? changeByPath.get(row.path) : undefined} changeCount={row.kind === "dir" ? (changeCounts.get(row.path) ?? 0) : 0} />
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          )}
        </div>
      </CM.Trigger>
      <ExplorerMenu target={menuTarget} onAction={(a) => void act(a, menuTarget)} />
    </CM.Root>
  );
}

function Guides({ depth }: { depth: number }) {
  if (depth === 0) return null;
  return (
    <>
      {Array.from({ length: depth }, (_, k) => (
        <span key={k} className="bg-border absolute top-0 bottom-0 w-px" style={{ left: `${8 + k * 12 + 7}px` }} aria-hidden />
      ))}
    </>
  );
}

function RowView({ row, repo, change, changeCount }: { row: Row & { kind: "dir" | "file" }; repo?: Repo; change?: ChangedFile; changeCount: number }) {
  if (row.kind === "dir") {
    return (
      <>
        <ChevronRight className={cn("text-muted-foreground size-3.5 shrink-0 transition-transform duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none", row.expanded && "rotate-90")} aria-hidden />
        <FolderIcon name={row.name} open={row.expanded} />
        <span className={cn("truncate", repo && "font-semibold")}>{row.name}</span>
        {repo && (
          <span className="stamp text-muted-foreground ml-1 flex min-w-0 items-center gap-0.5">
            <GitBranch className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{repo.branch ?? "main"}</span>
          </span>
        )}
        {changeCount > 0 && <span className="stamp text-attention-text ml-auto tabular-nums">{changeCount}</span>}
      </>
    );
  }
  const st = change ? STATUS_LETTER[change.status] : null;
  return (
    <>
      <FileIcon path={row.path} size={15} />
      <span className={cn("truncate", change?.status === "deleted" && "line-through", st?.tone)}>{row.name}</span>
      {st && <span className={cn("stamp ml-auto shrink-0 font-semibold", st.tone)}>{st.l}</span>}
    </>
  );
}

function EditRow({ edit, siblings, onDone }: { edit: RowEdit; siblings: ReadonlySet<string>; onDone: (name: string | null) => void }) {
  const initial = edit.what === "rename" ? baseOf(edit.target) : "";
  const [value, setValue] = React.useState(initial);
  const [touched, setTouched] = React.useState(false);
  const done = React.useRef(false);
  const ref = React.useRef<HTMLInputElement>(null);
  const error = touched || value ? invalidName(value, siblings) : null;
  const unchanged = edit.what === "rename" && value === initial;
  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const dot = edit.what === "rename" ? initial.lastIndexOf(".") : -1;
    el.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [edit.what, initial]);
  return (
    <div className="relative flex min-w-0 flex-1 items-center gap-1.5 pr-2">
      {edit.what === "newDir" ? <FolderIcon name={value || "folder"} open={false} /> : <FileIcon path={value || "file"} size={15} />}
      <input
        ref={ref}
        value={value}
        onChange={(e) => (setValue(e.target.value), setTouched(true))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            setTouched(true);
            if (!error && !unchanged) finish(value);
            else if (unchanged) finish(null);
          } else if (e.key === "Escape") {
            e.preventDefault();
            finish(null);
          }
          e.stopPropagation();
        }}
        onBlur={() => finish(null)}
        aria-label={edit.what === "rename" ? "New name" : edit.what === "newDir" ? "Folder name" : "File name"}
        aria-invalid={!!error}
        spellCheck={false}
        className={cn("bg-card min-w-0 flex-1 rounded border px-1 text-meta outline-none focus:ring-1", error ? "border-destructive focus:ring-destructive" : "focus:ring-ring")}
      />
      {error && (
        <span role="alert" className="bg-popover text-destructive shadow-e2 absolute top-full left-0 z-10 mt-0.5 max-w-full truncate rounded border px-1.5 py-0.5 text-micro">
          {error}
        </span>
      )}
    </div>
  );
}

function ExplorerMenu({ target, onAction }: { target: Row | null; onAction: (a: MenuAction) => void }) {
  const t = target && target.kind !== "edit" ? target : null;
  const isFile = t?.kind === "file";
  const mutable = !!t && t.depth > 0;
  const item = (a: MenuAction, label: string, icon: React.ReactNode, opts: { disabled?: boolean; destructive?: boolean; hint?: string } = {}) => (
    <CM.Item disabled={opts.disabled} onSelect={() => onAction(a)} className={cn(MENU_ITEM, opts.destructive && MENU_ITEM_DESTRUCTIVE)}>
      {icon}
      {label}
      {opts.hint && <MenuHint>{opts.hint}</MenuHint>}
    </CM.Item>
  );
  return (
    <CM.Portal>
      <CM.Content collisionPadding={8} className={MENU_CONTENT} aria-label={t ? `${t.name} actions` : "Explorer actions"}>
        {item("newFile", "New file", <FilePlus />)}
        {item("newDir", "New folder", <FolderPlus />)}
        <CM.Separator className={MENU_SEP} />
        {item("openSide", "Open to the side", <Columns2 />, { disabled: !isFile, hint: shortcutLabel("split") })}
        {item("reveal", "Reveal active file", <Locate />)}
        <CM.Separator className={MENU_SEP} />
        {item("copyPath", "Copy path", <Copy />, { disabled: !t, hint: "⌘C" })}
        {item("copyRelPath", "Copy relative path", <Copy />, { disabled: !t, hint: "⌘⇧C" })}
        <CM.Separator className={MENU_SEP} />
        {item("rename", "Rename", <Pencil />, { disabled: !mutable, hint: "F2" })}
        {item("duplicate", "Duplicate", <CopyPlus />, { disabled: !mutable })}
        {item("delete", "Delete", <Trash2 />, { disabled: !mutable, destructive: true, hint: "⌦" })}
      </CM.Content>
    </CM.Portal>
  );
}

/**
 * The selected row's highlight is one shared element (`layoutId`) that glides from the old row to
 * the new one, instead of two tints swapping. Only one list is mounted at a time (Explorer / Go to
 * file / Changes), so the id can be shared; Go to file passes `glide={false}` because its keyboard
 * cursor and the open file may both be lit at once.
 */
function ActiveRow({ glide = true }: { glide?: boolean }) {
  const still = useReducedMotion();
  if (!glide || still) return <span className="bg-accent absolute inset-0 -z-10" aria-hidden />;
  return <motion.span layoutId="ws-active-row" className="bg-accent absolute inset-0 -z-10" transition={{ type: "spring", stiffness: 520, damping: 42, mass: 0.7 }} aria-hidden />;
}

function FileRow({ path, active, change, onOpen, glide }: { path: string; active: boolean; change?: ChangedFile; onOpen: () => void; glide?: boolean }) {
  const base = baseOf(path);
  const dir = parentOf(path);
  const st = change ? STATUS_LETTER[change.status] : null;
  return (
    <button type="button" onClick={onOpen} className={cn("text-foreground relative isolate flex h-[26px] w-full cursor-pointer items-center gap-1.5 px-3 text-left text-meta transition-colors", !active && "hover:bg-muted")} title={path}>
      {active && <ActiveRow glide={glide} />}
      <FileIcon path={path} size={15} />
      <span className={cn("truncate", change?.status === "deleted" && "line-through", st?.tone)}>{base}</span>
      {dir && <span className="stamp text-muted-foreground truncate">{dir}</span>}
      {st && <span className={cn("stamp ml-auto shrink-0 font-semibold", st.tone)}>{st.l}</span>}
    </button>
  );
}

/* ───────────────────────────── Go to file ───────────────────────────── */

function GoToFile({ paths, query: q, active, changeByPath, onOpen }: { paths: string[] | null; query: string; active: string | null; changeByPath: Map<string, ChangedFile>; onOpen: (p: string) => void }) {
  const [cursor, setCursor] = React.useState(0);
  const needle = q.trim().toLowerCase();
  const matches = React.useMemo(() => (paths ? matchPaths(paths, needle) : []), [paths, needle]);
  React.useEffect(() => setCursor(0), [needle]);
  return (
    <ul className="min-h-0 flex-1 overflow-auto pb-2">
      {matches.map((p, i) => (
        <li key={p}>
          <FileRow path={p} active={active === p || i === cursor} change={changeByPath.get(p)} onOpen={() => onOpen(p)} glide={false} />
        </li>
      ))}
      {paths && matches.length === 0 && <li className="text-muted-foreground px-3 py-2 text-micro">No file matches “{q.trim()}”.</li>}
    </ul>
  );
}

const SYMBOL_ICON: Record<SymbolKind, LucideIcon> = { function: SquareFunction, method: SquareFunction, class: BoxIcon, interface: TypeIcon, type: TypeIcon, enum: TypeIcon, variable: Variable, property: KeyIcon, key: KeyIcon, heading: Heading, selector: HashIcon };

function QuickOpen({ paths, recent, activePath, editor, initial, onPick, onClose }: { paths: string[] | null; recent: string[]; activePath: string | null; editor: () => CodeEditorHandle | null; initial: string; onPick: (path: string, opts: OpenOpts) => void; onClose: () => void }) {
  const [q, setQ] = React.useState(initial);
  const [cursor, setCursor] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  const line = parseLineQuery(q);
  const head = q.trim();
  const mode: "recent" | "line" | "files" | "symbols" = head.startsWith("@") ? "symbols" : line || head.startsWith(":") ? "line" : head ? "files" : "recent";
  const items = React.useMemo(() => (mode === "recent" ? recent.filter((p) => !paths || paths.includes(p)) : mode === "files" && paths ? matchPaths(paths, q, 40) : []), [mode, recent, paths, q]);
  // "@": the outline is read once per session and the editor's scroll and selection are put back
  // on close, unless a symbol is picked. The editor getter lives in a ref so the effects key on mode.
  const editorRef = React.useRef(editor);
  editorRef.current = editor;
  const [symbols, setSymbols] = React.useState<CodeSymbol[]>([]);
  const restore = React.useRef<(() => void) | null>(null);
  React.useEffect(() => {
    if (mode !== "symbols") return;
    const h = editorRef.current();
    setSymbols(h?.symbols() ?? []);
    restore.current = h?.snapshot() ?? null;
    return () => {
      restore.current?.();
      restore.current = null;
    };
  }, [mode]);
  const found = React.useMemo(() => (mode === "symbols" ? matchSymbols(symbols, head.slice(1)) : []), [mode, symbols, head]);
  const count = mode === "symbols" ? found.length : items.length;
  React.useEffect(() => {
    const sym = mode === "symbols" ? found[cursor] : undefined;
    if (sym) editorRef.current()?.reveal(sym, { select: false });
  }, [mode, found, cursor]);
  React.useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [cursor]);
  // Focus returns where it came from on close, except when a symbol pick hands it to the editor.
  const handedOff = React.useRef(false);
  React.useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = inputRef.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
    return () => void (handedOff.current || prev?.focus?.());
  }, []);
  const pick = (i: number) => {
    if (mode === "symbols") {
      const sym = found[i];
      if (!sym) return;
      restore.current = null;
      handedOff.current = true;
      editorRef.current()?.reveal(sym, { select: true });
      onClose();
      return;
    }
    if (mode === "line") {
      if (line && activePath) onPick(activePath, { reveal: { ...line, nonce: Date.now() } });
      return;
    }
    const p = items[i];
    if (p) onPick(p, { preview: false });
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (count) setCursor((c) => (c + (e.key === "ArrowDown" ? 1 : count - 1)) % count);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(cursor);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };
  const still = useReducedMotion();
  return (
    <div className="absolute inset-0 z-40" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div
        role="dialog"
        aria-label="Quick open"
        initial={still ? false : { opacity: 0, y: -6, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.16, ease: EASE }}
        className="bg-popover text-popover-foreground shadow-e3 absolute top-3 left-1/2 flex w-[min(30rem,calc(100%-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-xl border"
      >
        <label className="flex h-10 items-center gap-2 border-b px-3">
          <Search className="text-muted-foreground size-4" aria-hidden />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setCursor(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Go to file, :line or @symbol"
            aria-label="Go to file" spellCheck={false} className="text-foreground placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-meta outline-none" />
          <Kbd>Esc</Kbd>
        </label>
        {mode === "line" ? (
          <p className="text-muted-foreground px-3 py-2.5 text-meta">
            {!activePath ? "Open a file first." : line ? `Go to line ${line.from}${line.to !== line.from ? `–${line.to}` : ""} in ${baseOf(activePath)}` : "Type a line number, or a range like :10-20."}
          </p>
        ) : mode === "symbols" ? (
          <ul ref={listRef} role="listbox" aria-label="Symbols" className="max-h-72 overflow-auto py-1">
            {found.map((s, i) => {
              const Icon = SYMBOL_ICON[s.kind];
              return (
                <li key={s.from} role="option" aria-selected={i === cursor} onMouseEnter={() => setCursor(i)} onClick={() => pick(i)} style={{ paddingLeft: 12 + s.depth * 14 }} className={cn("flex h-[26px] cursor-pointer items-center gap-1.5 pr-3 text-meta", i === cursor && "bg-accent")}>
                  <Icon className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{s.name}</span>
                  <span className="stamp text-muted-foreground ml-auto shrink-0">{s.kind}</span>
                </li>
              );
            })}
            {found.length === 0 && <li className="text-muted-foreground px-3 py-2 text-micro">{symbols.length === 0 ? "No symbols in this file" : `No symbol matches “${head.slice(1).trim()}”.`}</li>}
          </ul>
        ) : (
          <ul ref={listRef} role="listbox" aria-label={mode === "recent" ? "Recently opened" : "Matching files"} className="max-h-72 overflow-auto py-1">
            {mode === "recent" && items.length > 0 && <li className="label text-faint px-3 pt-1 pb-0.5">Recently opened</li>}
            {items.map((p, i) => (
              <li key={p} role="option" aria-selected={i === cursor} onMouseEnter={() => setCursor(i)} onClick={() => pick(i)} className={cn("flex h-[26px] cursor-pointer items-center gap-1.5 px-3 text-meta", i === cursor && "bg-accent")}>
                <FileIcon path={p} size={15} />
                <span className="truncate">{baseOf(p)}</span>
                <span className="stamp text-muted-foreground truncate">{parentOf(p)}</span>
              </li>
            ))}
            {items.length === 0 && <li className="text-muted-foreground px-3 py-2 text-micro">{mode === "recent" ? "No recent files. Type to search." : `No file matches “${q.trim()}”.`}</li>}
          </ul>
        )}
      </motion.div>
    </div>
  );
}

function SearchView({ session, active, onOpen }: { session: string; active: string | null; onOpen: Open }) {
  const [q, setQ] = React.useState("");
  const [regex, setRegex] = React.useState(false);
  const [caseSensitive, setCaseSensitive] = React.useState(false);
  const [result, setResult] = React.useState<{ matches: SearchMatch[]; truncated: boolean } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set());
  const inputRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => inputRef.current?.focus(), []);

  React.useEffect(() => {
    const needle = q.trim();
    if (!needle) {
      setResult(null);
      setError(null);
      setBusy(false);
      return;
    }
    const ctrl = new AbortController();
    const t = window.setTimeout(() => {
      setBusy(true);
      api
        .search(session, needle, { regex, caseSensitive }, ctrl.signal)
        .then((r) => {
          setResult(r);
          setError(null);
        })
        .catch((e: unknown) => {
          if (ctrl.signal.aborted) return;
          setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => !ctrl.signal.aborted && setBusy(false));
    }, 300);
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
  }, [session, q, regex, caseSensitive]);

  const matcher = React.useMemo(() => {
    const needle = q.trim();
    if (!needle) return null;
    try {
      return new RegExp(regex ? needle : needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), caseSensitive ? "" : "i");
    } catch {
      return null;
    }
  }, [q, regex, caseSensitive]);
  const groups = React.useMemo(() => {
    const m = new Map<string, SearchMatch[]>();
    for (const hit of result?.matches ?? []) m.set(hit.path, [...(m.get(hit.path) ?? []), hit]);
    return [...m];
  }, [result]);
  const toggle = (path: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      return n;
    });
  return (
    <>
      <label className="bg-card focus-within:ring-ring mx-2 mb-1 flex h-8 items-center gap-1 rounded-md border px-2 focus-within:ring-2">
        <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search in files" aria-label="Search in files" spellCheck={false} className="text-foreground placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-meta outline-none" />
        {busy && <Loader2 className="text-muted-foreground size-3.5 animate-spin" aria-label="Searching" />}
        <SearchToggle on={caseSensitive} onClick={() => setCaseSensitive((v) => !v)} label="Match case">
          <CaseSensitive className="size-3.5" />
        </SearchToggle>
        <SearchToggle on={regex} onClick={() => setRegex((v) => !v)} label="Use regular expression">
          <Regex className="size-3.5" />
        </SearchToggle>
      </label>
      <div className="min-h-0 flex-1 overflow-auto pb-2" aria-live="polite" aria-busy={busy}>
        {error ? (
          <p className="text-destructive px-3 py-2 text-micro">{error}</p>
        ) : !q.trim() ? (
          <p className="text-muted-foreground px-3 py-2 text-micro">Type to search every file in the sandbox.</p>
        ) : result && groups.length === 0 ? (
          <p className="text-muted-foreground px-3 py-2 text-micro">No results for “{q.trim()}”.</p>
        ) : (
          result && (
            <>
              <p className="text-muted-foreground px-3 py-1 text-micro tabular-nums">
                {result.matches.length} {result.matches.length === 1 ? "result" : "results"} in {groups.length} {groups.length === 1 ? "file" : "files"}
              </p>
              <ul>
                {groups.map(([path, hits]) => {
                  const open = !collapsed.has(path);
                  return (
                    <li key={path}>
                      <button type="button" onClick={() => toggle(path)} aria-expanded={open} className="hover:bg-muted text-foreground flex h-[26px] w-full cursor-pointer items-center gap-1 px-2 text-left text-meta" title={path}>
                        <ChevronRight className={cn("text-muted-foreground size-3.5 shrink-0 transition-transform duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none", open && "rotate-90")} aria-hidden />
                        <FileIcon path={path} size={15} />
                        <span className="truncate">{baseOf(path)}</span>
                        <span className="stamp text-muted-foreground truncate">{parentOf(path)}</span>
                        <span className="bg-muted text-muted-foreground ml-auto shrink-0 rounded-full px-1.5 text-[10px] leading-4 tabular-nums">{hits.length}</span>
                      </button>
                      {open && (
                        <ul>
                          {hits.map((h) => {
                            const m = matcher?.exec(h.text);
                            const text = h.text.trimStart();
                            const off = h.text.length - text.length;
                            const a = m ? Math.max(0, m.index - off) : -1;
                            const b = m ? a + m[0].length : -1;
                            return (
                              <li key={`${h.path}:${h.line}`}>
                                <button type="button" onClick={() => onOpen(h.path, { preview: true, reveal: { from: h.line, to: h.line, nonce: Date.now() } })} className={cn("relative isolate flex h-[26px] w-full cursor-pointer items-center gap-2 pr-2 pl-9 text-left font-mono text-micro", active === h.path ? "hover:bg-accent/60" : "hover:bg-muted")} title={`${h.path}:${h.line}`}>
                                  <span className="text-faint w-7 shrink-0 text-right tabular-nums">{h.line}</span>
                                  <span className="truncate">
                                    {m && a >= 0 && b <= text.length ? (
                                      <>
                                        {text.slice(0, a)}
                                        <mark className="bg-attention/35 text-foreground rounded-sm">{text.slice(a, b)}</mark>
                                        {text.slice(b)}
                                      </>
                                    ) : (
                                      text
                                    )}
                                  </span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
              {result.truncated && <p className="text-muted-foreground border-t px-3 py-1.5 text-micro">Showing the first {result.matches.length} results. Narrow the search to see the rest.</p>}
            </>
          )
        )}
      </div>
    </>
  );
}

function SearchToggle({ on, onClick, label, children }: { on: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" onClick={onClick} aria-pressed={on} aria-label={label} className={cn("grid size-6 shrink-0 cursor-pointer place-items-center rounded", on ? "bg-live/15 text-live" : "text-muted-foreground hover:text-foreground hover:bg-muted")}>
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/* ───────────────────────────── Source control ───────────────────────────── */

function SourceControl({ session, repo, status, err, reload: load, changes, active, onOpen, onChanged }: { session: string; repo?: Repo; status: GitStatus | null; err: string | null; reload: () => void; changes: ChangedFile[]; active: string | null; onOpen: (p: string) => void; onChanged: () => void }) {
  const [message, setMessage] = React.useState("");
  const [busy, setBusy] = React.useState<"commit" | "push" | null>(null);
  const [lastPush, setLastPush] = React.useState<string | null>(null);

  const repoChanges = changes.filter((c) => !repo || c.path.startsWith(repo.name + "/"));
  const commit = async () => {
    if (!repo || !message.trim()) return;
    setBusy("commit");
    try {
      const r = await api.gitCommit(session, repo.name, message.trim());
      toast.success(`Committed ${r.sha}`, { description: r.summary });
      setMessage("");
      onChanged();
      load();
    } catch (e) {
      toast.error("Commit failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };
  const push = async () => {
    if (!repo) return;
    setBusy("push");
    try {
      const r = await api.gitPush(session, repo.name);
      setLastPush(r.output);
      toast.success(`Pushed ${status?.branch ?? "branch"}`);
      load();
    } catch (e) {
      toast.error("Push failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  if (!repo) {
    return <p className="text-muted-foreground px-3 py-2 text-micro">No repository is attached to this sandbox.</p>;
  }
  return (
    <>
      {/* Branch strip */}
      <div className="mx-2 mb-2 flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-meta">
        <GitBranch className="text-live size-3.5 shrink-0" aria-hidden />
        <span className="text-foreground min-w-0 flex-1 truncate font-mono text-micro">{status?.branch ?? repo.branch ?? "…"}</span>
        {status && (
          <span className="stamp text-muted-foreground flex items-center gap-1 tabular-nums">
            {status.ahead > 0 && (
              <span className="flex items-center text-ok">
                <ArrowUp className="size-3" />
                {status.ahead}
              </span>
            )}
            {status.behind > 0 && (
              <span className="flex items-center text-attention-text">
                <ArrowDown className="size-3" />
                {status.behind}
              </span>
            )}
            {!status.upstream && <span>no upstream</span>}
          </span>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon-sm" variant={status && status.ahead > 0 ? "default" : "ghost"} onClick={() => void push()} disabled={busy !== null} aria-label="Push">
              {busy === "push" ? <Loader2 className="animate-spin" /> : <Upload />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{status?.upstream ? `Push to ${status.upstream}` : "Push and set upstream (origin)"}</TooltipContent>
        </Tooltip>
      </div>
      {err && <p className="text-destructive px-3 pb-2 text-micro">{err}</p>}
      {/* Commit box */}
      <div className="mx-2 mb-2 flex flex-col gap-1.5">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void commit();
          }}
          rows={2}
          placeholder={`Message (⌘Enter to commit on "${status?.branch ?? repo.branch ?? "branch"}")`}
          aria-label="Commit message"
          className="text-foreground placeholder:text-muted-foreground bg-card focus:ring-ring w-full resize-none rounded-md border px-2.5 py-1.5 text-meta outline-none focus:ring-2"
        />
        <Button size="sm" onClick={() => void commit()} disabled={busy !== null || !message.trim() || repoChanges.length === 0} className="w-full">
          {busy === "commit" ? <Loader2 className="animate-spin" /> : <Check />}
          Commit {repoChanges.length > 0 ? `${repoChanges.length} ${repoChanges.length === 1 ? "file" : "files"}` : ""}
        </Button>
      </div>
      {/* Changes */}
      <div className="flex items-center gap-2 px-3 py-1">
        <span className="label text-muted-foreground flex-1">Changes</span>
        <span className="stamp text-muted-foreground tabular-nums">{repoChanges.length}</span>
      </div>
      <ul className="min-h-0 flex-1 overflow-auto pb-2">
        {repoChanges.length === 0 && <li className="text-muted-foreground px-3 py-2 text-micro">Working tree clean.</li>}
        {repoChanges.map((c) => {
          const rel = c.path.slice(repo.name.length + 1);
          const base = baseOf(rel);
          const dir = parentOf(rel);
          const st = STATUS_LETTER[c.status];
          return (
            <li key={c.path}>
              <button type="button" onClick={() => onOpen(c.path)} className={cn("relative isolate flex h-[26px] w-full cursor-pointer items-center gap-1.5 px-3 text-left text-meta transition-colors", active !== c.path && "hover:bg-muted")} title={c.path}>
                {active === c.path && <ActiveRow />}
                <FileIcon path={c.path} size={15} />
                <span className={cn("truncate", c.status === "deleted" && "line-through")}>{base}</span>
                {dir && <span className="stamp text-muted-foreground truncate">{dir}</span>}
                <span className="stamp ml-auto flex shrink-0 items-center gap-1.5">
                  {c.additions > 0 && <span className="text-ok">+{c.additions}</span>}
                  {c.deletions > 0 && <span className="text-destructive">−{c.deletions}</span>}
                  <span className={cn("font-semibold", st.tone)}>{st.l}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {(status?.lastCommit || lastPush) && (
        <div className="stamp text-muted-foreground border-t px-3 py-1.5">
          {status?.lastCommit && (
            <p className="flex items-center gap-1 truncate">
              <GitCommitHorizontal className="size-3 shrink-0" aria-hidden />
              {status.lastCommit}
            </p>
          )}
          {lastPush && <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap">{lastPush.split("\n").slice(-2).join("\n")}</p>}
        </div>
      )}
    </>
  );
}
