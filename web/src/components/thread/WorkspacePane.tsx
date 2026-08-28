import * as React from "react";
import { ArrowDown, ArrowUp, Check, ChevronRight, Download, Files, FileCode2, FileDiff, GitBranch, GitCommitHorizontal, Loader2, Maximize2, Minimize2, PanelRight, RefreshCw, Search, Upload, X } from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { api, ApiError, type ChangedFile, type GitStatus } from "@/lib/api";
import { parseUnifiedDiff, diffForNewFile, type ParsedDiff } from "@/lib/diff";
import { languageOf } from "@/lib/fileIcon";
import { FileIcon, FolderIcon } from "@/lib/vscodeIcons";
import { CodeEditor, UnifiedDiff } from "@/components/CodeEditor";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DiffView } from "./FilePane";
import { cn } from "@/lib/utils";

/**
 * The workspace as an editor: an activity bar (Explorer · Search · Source Control), a sidebar view,
 * an editor group with tabs, breadcrumbs and Diff / File / Edit modes, and a status bar. The tree
 * uses a coloured icon theme and indent guides; Source Control shows the branch with ahead/behind,
 * a commit box, and the changes with VS Code's status letters — commit and push run inside the
 * sandbox as the run's git identity. Files open from the tree, from Source Control, or from the
 * changes dock; edits save back with ⌘S and refresh the change list.
 */
type Node = { name: string; path: string; children?: Map<string, Node> };
type Tab = { path: string; mode: "diff" | "edit"; draft?: string; dirty?: boolean; saving?: "saving" | "saved" };
type View = "explorer" | "search" | "scm";
type Repo = { name: string; branch?: string };

function buildTree(paths: string[]): Node {
  const root: Node = { name: "", path: "", children: new Map() };
  for (const p of paths) {
    const parts = p.split("/");
    let cur = root;
    parts.forEach((part, i) => {
      const isFile = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join("/");
      let next = cur.children!.get(part);
      if (!next) {
        next = isFile ? { name: part, path } : { name: part, path, children: new Map() };
        cur.children!.set(part, next);
      }
      cur = next;
    });
  }
  return root;
}
const sorted = (m: Map<string, Node>) => [...m.values()].sort((a, b) => (a.children ? 0 : 1) - (b.children ? 0 : 1) || a.name.localeCompare(b.name));
const STATUS_LETTER: Record<ChangedFile["status"], { l: string; tone: string }> = {
  modified: { l: "M", tone: "text-attention-text" },
  added: { l: "A", tone: "text-ok" },
  untracked: { l: "U", tone: "text-ok" },
  deleted: { l: "D", tone: "text-destructive" },
  renamed: { l: "R", tone: "text-live" },
};

export function WorkspacePane({ session, changes, open, onClose, onSaved, repos, full = false, onToggleFull }: { session: string; changes: ChangedFile[]; open: ChangedFile | null; onClose: () => void; onSaved: () => void; repos: Repo[]; full?: boolean; onToggleFull?: () => void }) {
  const [paths, setPaths] = React.useState<string[] | null>(null);
  const [treeErr, setTreeErr] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set(repos.map((r) => r.name)));
  const [view, setView] = React.useState<View>("explorer");
  const [sidebar, setSidebar] = React.useState(true);
  const [query, setQuery] = React.useState("");
  const [tabs, setTabs] = React.useState<Tab[]>([]);
  const [active, setActive] = React.useState<string | null>(null);

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

  const openPath = React.useCallback(
    (path: string, mode?: Tab["mode"]) => {
      setTabs((t) => (t.some((x) => x.path === path) ? t : [...t, { path, mode: mode ?? "edit" }]));
      setActive(path);
      setExpanded((e) => {
        const n = new Set(e);
        const parts = path.split("/");
        for (let i = 1; i < parts.length; i++) n.add(parts.slice(0, i).join("/"));
        return n;
      });
    },
    [changeByPath]
  );
  React.useEffect(() => {
    if (open) openPath(open.path, changeByPath.has(open.path) ? "diff" : "edit");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open?.path]);

  const closeTab = (path: string) => {
    setTabs((t) => {
      const i = t.findIndex((x) => x.path === path);
      const next = t.filter((x) => x.path !== path);
      if (active === path) setActive(next[Math.max(0, i - 1)]?.path ?? null);
      return next;
    });
  };
  const patchTab = (path: string, p: Partial<Tab>) => setTabs((t) => t.map((x) => (x.path === path ? { ...x, ...p } : x)));

  // An empty editor is a dead end: when the tree arrives and nothing is open, open the most useful file —
  // the first change, else a README, else the first file at the repo root.
  React.useEffect(() => {
    if (!paths || tabs.length > 0 || open) return;
    const first = changes[0]?.path ?? paths.find((p) => /(^|\/)readme\.md$/i.test(p)) ?? [...paths].sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))[0];
    if (first) openPath(first, changes[0] ? "diff" : "edit");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paths]);

  const tree = React.useMemo(() => (paths ? buildTree(paths) : null), [paths]);
  const activeTab = tabs.find((t) => t.path === active) ?? null;
  const activeRepo = React.useMemo(() => {
    const top = (active ?? changes[0]?.path ?? "").split("/")[0];
    return repos.find((r) => r.name === top) ?? repos[0];
  }, [active, changes, repos]);
  // Git's own view of the repo (branch, ahead/behind, last commit) — shared by Source Control and the status bar.
  const [git, setGit] = React.useState<GitStatus | null>(null);
  const [gitErr, setGitErr] = React.useState<string | null>(null);
  const loadGit = React.useCallback(() => {
    if (!activeRepo) return;
    api
      .gitStatus(session, activeRepo.name)
      .then((g) => {
        setGit(g);
        setGitErr(null);
      })
      .catch((e: unknown) => setGitErr(e instanceof Error ? e.message : String(e)));
  }, [session, activeRepo]);
  React.useEffect(loadGit, [loadGit, changes.length]);

  // Drag the left edge to resize; the width persists across sessions.
  const [width, setWidth] = React.useState<number>(() => Number(localStorage.getItem("asb-workspace-w")) || 0);
  const dragging = React.useRef(false);
  const onDrag = (e: React.PointerEvent) => {
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      if (!dragging.current) return;
      const w = Math.min(window.innerWidth - 480, Math.max(520, window.innerWidth - ev.clientX));
      setWidth(w);
    };
    const up = () => {
      dragging.current = false;
      setWidth((w) => (localStorage.setItem("asb-workspace-w", String(w)), w));
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const filesTitle = view === "scm" ? "Changes" : "Files";
  return (
    <motion.aside
      style={!full && width ? { width, minWidth: width } : undefined}
      initial={{ x: 24, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 24, opacity: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className={cn("bg-card absolute inset-0 z-20 flex min-w-0 flex-col md:relative md:inset-auto md:h-full md:border-l", full ? "md:flex-1" : "md:w-[58%] md:min-w-[34rem]")}
      aria-label="Workspace"
    >
      {!full && <div role="separator" aria-orientation="vertical" onPointerDown={onDrag} className="hover:bg-live/60 active:bg-live absolute top-0 bottom-0 -left-1 z-30 hidden w-2 cursor-col-resize transition-colors md:block" title="Drag to resize" />}

      {/* Tab strip + window controls, the way an editor puts them: files across, actions at the right. */}
      <div className="flex h-10 shrink-0 items-stretch border-b">
        <div role="tablist" className="scrollbar-none flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto px-2">
          {tabs.map((t) => {
            const on = t.path === active;
            const base = t.path.slice(t.path.lastIndexOf("/") + 1);
            return (
              <div key={t.path} role="tab" aria-selected={on} className={cn("group relative flex h-7 shrink-0 items-center gap-1.5 rounded-md pr-1 pl-2 text-meta transition-colors", on ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/60")}>
                <button type="button" onClick={() => setActive(t.path)} className="flex cursor-pointer items-center gap-1.5">
                  <FileIcon path={t.path} size={14} />
                  <span className={cn("text-micro", t.dirty && "italic")}>{base}</span>
                </button>
                <button type="button" onClick={() => closeTab(t.path)} aria-label={`Close ${base}`} className={cn("text-muted-foreground hover:text-foreground hover:bg-background grid size-5 cursor-pointer place-items-center rounded", !t.dirty && !on && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}>
                  {t.dirty ? <span className="bg-foreground block size-2 rounded-full" aria-label="unsaved" /> : <X className="size-3" />}
                </button>
              </div>
            );
          })}
          {tabs.length === 0 && <span className="text-muted-foreground px-1 text-micro">No file open</span>}
        </div>
        <div className="flex shrink-0 items-center gap-0.5 border-l px-1.5">
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
            <TooltipContent side="bottom">{sidebar ? "Hide the files panel" : "Show the files panel"}</TooltipContent>
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
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Editor group */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {activeTab ? (
            <FileView key={activeTab.path} session={session} tab={activeTab} change={changeByPath.get(activeTab.path)} onMode={(m) => patchTab(activeTab.path, { mode: m })} onDraft={(d, dirty) => patchTab(activeTab.path, { draft: d, dirty })} onSaving={(s) => patchTab(activeTab.path, { saving: s })} onSaved={onSaved} />
          ) : (
            <EmptyEditor />
          )}
        </div>

        {/* Files panel on the right: search on top, tree (or results) below; Changes is the same panel's other face. */}
        {sidebar && (
          <section className="bg-muted/25 flex w-64 shrink-0 flex-col border-l" aria-label={filesTitle}>
            <div className="flex h-10 shrink-0 items-center gap-1 px-2">
              <div role="radiogroup" className="bg-muted inline-flex h-7 items-center gap-0.5 rounded-md p-0.5">
                <button type="button" role="radio" aria-checked={view !== "scm"} onClick={() => setView("explorer")} className={cn("flex h-6 cursor-pointer items-center gap-1 rounded px-2 text-micro font-medium", view !== "scm" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}>
                  <Files className="size-3.5" /> Files
                </button>
                <button type="button" role="radio" aria-checked={view === "scm"} onClick={() => setView("scm")} className={cn("flex h-6 cursor-pointer items-center gap-1 rounded px-2 text-micro font-medium", view === "scm" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}>
                  <GitBranch className="size-3.5" /> Changes
                  {changes.length > 0 && <span className={cn("ml-0.5 rounded-full px-1.5 text-[9px] leading-4 font-semibold", view === "scm" ? "bg-live text-white" : "bg-live/15 text-live")}>{changes.length}</span>}
                </button>
              </div>
              <button type="button" onClick={() => (view === "scm" ? loadGit() : void loadTree())} aria-label="Refresh" className="text-muted-foreground hover:text-foreground ml-auto grid size-7 cursor-pointer place-items-center rounded-md">
                <RefreshCw className="size-3.5" />
              </button>
            </div>
            {view === "scm" ? (
              <SourceControl session={session} repo={activeRepo} status={git} err={gitErr} reload={loadGit} changes={changes} active={active} onOpen={(p) => openPath(p, "diff")} onChanged={onSaved} />
            ) : (
              <>
                <label className="mx-2 mb-1 flex h-8 items-center gap-1.5 rounded-md border bg-card px-2 focus-within:ring-2 focus-within:ring-ring">
                  <Search className="text-muted-foreground size-3.5" aria-hidden />
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search files" aria-label="Search files" className="text-foreground placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-meta outline-none" />
                  {query && (
                    <button type="button" onClick={() => setQuery("")} aria-label="Clear" className="text-muted-foreground hover:text-foreground cursor-pointer">
                      <X className="size-3.5" />
                    </button>
                  )}
                </label>
                {query.trim() ? (
                  <GoToFile paths={paths} query={query} active={active} changeByPath={changeByPath} onOpen={(p) => (openPath(p), setQuery(""))} />
                ) : (
                  <Explorer tree={tree} err={treeErr} expanded={expanded} setExpanded={setExpanded} active={active} changeByPath={changeByPath} onOpen={openPath} repos={repos} />
                )}
              </>
            )}
          </section>
        )}
      </div>

      {/* Status bar */}
      <footer className="bg-muted/60 text-muted-foreground flex h-6 shrink-0 items-center gap-3 border-t px-3 text-micro">
        {activeRepo && (
          <button type="button" onClick={() => (setView("scm"), setSidebar(true))} className="text-foreground hover:bg-muted flex cursor-pointer items-center gap-1 rounded px-1" aria-label="Open source control">
            <GitBranch className="size-3" aria-hidden />
            {git?.branch ?? activeRepo.branch ?? "…"}
            {git && git.ahead > 0 && <span className="text-ok">↑{git.ahead}</span>}
            {git && git.behind > 0 && <span className="text-attention-text">↓{git.behind}</span>}
          </button>
        )}
        <span>{changes.length} changed</span>
        {paths && <span>{paths.length} files</span>}
        <span className="ml-auto">{activeTab ? languageOf(activeTab.path) : ""}</span>
        {activeTab && <span className="tabular-nums">{activeTab.mode === "diff" ? "diff" : activeTab.saving === "saving" ? "Saving…" : activeTab.dirty ? "Unsaved" : activeTab.saving === "saved" ? "Saved" : "Autosave on"}</span>}
      </footer>
    </motion.aside>
  );
}

/* ───────────────────────────── Explorer ───────────────────────────── */

function Explorer({ tree, err, expanded, setExpanded, active, changeByPath, onOpen, repos }: { tree: Node | null; err: string | null; expanded: Set<string>; setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>; active: string | null; changeByPath: Map<string, ChangedFile>; onOpen: (p: string) => void; repos: Repo[] }) {
  return (
    <>
      <div className="min-h-0 flex-1 overflow-auto pb-2">
        {err ? (
          <p className="text-destructive px-3 py-2 text-micro">{err}</p>
        ) : !tree ? (
          <div className="flex flex-col gap-2.5 px-3 py-2">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <span key={i} className="bg-muted h-3 animate-pulse rounded" style={{ width: `${50 + ((i * 23) % 40)}%`, marginLeft: `${(i % 3) * 12}px` }} />
            ))}
          </div>
        ) : (
          <TreeLevel node={tree} depth={0} expanded={expanded} setExpanded={setExpanded} active={active} changeByPath={changeByPath} onOpen={onOpen} repos={repos} />
        )}
      </div>
    </>
  );
}

function TreeLevel({ node, depth, expanded, setExpanded, active, changeByPath, onOpen, repos }: { node: Node; depth: number; expanded: Set<string>; setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>; active: string | null; changeByPath: Map<string, ChangedFile>; onOpen: (p: string) => void; repos: Repo[] }) {
  return (
    <ul className="relative">
      {/* Indent guide for this level */}
      {depth > 0 && <span className="bg-border absolute top-0 bottom-0 w-px" style={{ left: `${8 + (depth - 1) * 12 + 7}px` }} aria-hidden />}
      {sorted(node.children!).map((child) => {
        if (child.children) {
          const isOpen = expanded.has(child.path);
          const repo = depth === 0 ? repos.find((r) => r.name === child.name) : undefined;
          let n = 0;
          for (const p of changeByPath.keys()) if (p.startsWith(child.path + "/")) n++;
          return (
            <li key={child.path}>
              <button
                type="button"
                onClick={() =>
                  setExpanded((e) => {
                    const s = new Set(e);
                    if (s.has(child.path)) s.delete(child.path);
                    else s.add(child.path);
                    return s;
                  })
                }
                aria-expanded={isOpen}
                className="hover:bg-muted text-foreground flex h-[26px] w-full cursor-pointer items-center gap-1 pr-2 text-left text-meta"
                style={{ paddingLeft: `${8 + depth * 12}px` }}
              >
                <ChevronRight className={cn("text-muted-foreground size-3.5 shrink-0 transition-transform duration-150", isOpen && "rotate-90")} />
                <FolderIcon name={child.name} open={isOpen} />
                <span className={cn("truncate", repo && "font-semibold")}>{child.name}</span>
                {repo && (
                  <span className="stamp text-muted-foreground ml-1 flex items-center gap-0.5 truncate">
                    <GitBranch className="size-3" aria-hidden />
                    {repo.branch ?? "main"}
                  </span>
                )}
                {n > 0 && <span className="stamp text-attention-text ml-auto tabular-nums">{n}</span>}
              </button>
              {isOpen && <TreeLevel node={child} depth={depth + 1} expanded={expanded} setExpanded={setExpanded} active={active} changeByPath={changeByPath} onOpen={onOpen} repos={repos} />}
            </li>
          );
        }
        return (
          <li key={child.path}>
            <FileRow path={child.path} depth={depth} active={active === child.path} change={changeByPath.get(child.path)} onOpen={() => onOpen(child.path)} />
          </li>
        );
      })}
    </ul>
  );
}

function FileRow({ path, depth, active, change, onOpen, showDir }: { path: string; depth: number; active: boolean; change?: ChangedFile; onOpen: () => void; showDir?: boolean }) {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dir = path.slice(0, Math.max(0, path.lastIndexOf("/")));
  const st = change ? STATUS_LETTER[change.status] : null;
  return (
    <button type="button" onClick={onOpen} className={cn("flex h-[26px] w-full cursor-pointer items-center gap-1.5 pr-2 text-left text-meta", active ? "bg-accent text-foreground" : "hover:bg-muted text-foreground/90")} style={{ paddingLeft: `${8 + depth * 12 + 18}px` }} title={path}>
      <FileIcon path={path} size={15} />
      <span className={cn("truncate", change?.status === "deleted" && "line-through", st?.tone)}>{base}</span>
      {showDir && dir && <span className="stamp text-muted-foreground truncate">{dir}</span>}
      {st && <span className={cn("stamp ml-auto shrink-0 font-semibold", st.tone)}>{st.l}</span>}
    </button>
  );
}

/* ───────────────────────────── Go to file ───────────────────────────── */

function GoToFile({ paths, query: q, active, changeByPath, onOpen }: { paths: string[] | null; query: string; active: string | null; changeByPath: Map<string, ChangedFile>; onOpen: (p: string) => void }) {
  const [cursor, setCursor] = React.useState(0);
  const needle = q.trim().toLowerCase();
  const matches = React.useMemo(() => {
    if (!paths) return [];
    if (!needle) return paths.slice(0, 60);
    const score = (p: string) => {
      const base = p.slice(p.lastIndexOf("/") + 1).toLowerCase();
      if (base.startsWith(needle)) return 0;
      if (base.includes(needle)) return 1;
      if (p.toLowerCase().includes(needle)) return 2;
      return 9;
    };
    return paths
      .map((p) => [score(p), p] as const)
      .filter(([s]) => s < 9)
      .sort((a, b) => a[0] - b[0] || a[1].length - b[1].length)
      .slice(0, 80)
      .map(([, p]) => p);
  }, [paths, needle]);
  React.useEffect(() => setCursor(0), [needle]);
  return (
    <>
      <ul className="min-h-0 flex-1 overflow-auto pb-2">
        {matches.map((p, i) => (
          <li key={p}>
            <FileRow path={p} depth={-1} active={active === p || i === cursor} change={changeByPath.get(p)} onOpen={() => onOpen(p)} showDir />
          </li>
        ))}
        {paths && matches.length === 0 && <li className="text-muted-foreground px-3 py-2 text-micro">No file matches “{q.trim()}”.</li>}
      </ul>
    </>
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
    return (
      <>
        <p className="text-muted-foreground px-3 py-2 text-micro">No repository is attached to this sandbox.</p>
      </>
    );
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
          const base = rel.slice(rel.lastIndexOf("/") + 1);
          const dir = rel.slice(0, Math.max(0, rel.lastIndexOf("/")));
          const st = STATUS_LETTER[c.status];
          return (
            <li key={c.path}>
              <button type="button" onClick={() => onOpen(c.path)} className={cn("flex h-[26px] w-full cursor-pointer items-center gap-1.5 px-3 text-left text-meta", active === c.path ? "bg-accent" : "hover:bg-muted")} title={c.path}>
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

/* ───────────────────────────── Editor ───────────────────────────── */

function EmptyEditor() {
  return (
    <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-meta">
      <div className="grid grid-cols-3 gap-1.5 opacity-60" aria-hidden>
        {["src/index.ts", "README.md", "package.json", "app.tsx", "styles.css", "Dockerfile"].map((p) => (
          <span key={p} className="bg-muted grid size-8 place-items-center rounded-md">
            <FileIcon path={p} size={16} />
          </span>
        ))}
      </div>
      <p>Open a file from the Explorer, jump with Go to file, or pick a change in Source Control.</p>
      <p className="text-micro opacity-70">Diff · File · Edit — ⌘S saves into the sandbox</p>
    </div>
  );
}

function FileView({ session, tab, change, onMode, onDraft, onSaving, onSaved }: { session: string; tab: Tab; change?: ChangedFile; onMode: (m: Tab["mode"]) => void; onDraft: (d: string, dirty: boolean) => void; onSaving: (s: Tab["saving"]) => void; onSaved: () => void }) {
  const [diff, setDiff] = React.useState<ParsedDiff | null>(null);
  const [original, setOriginal] = React.useState<string | null>(null);
  const [content, setContent] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const mode = tab.mode;

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        if (mode === "diff") {
          if (diff) return;
          const d = await api.diff(session, tab.path);
          if (cancelled) return;
          if (d.untracked) {
            const text = content ?? (await api.artifactText(session, tab.path));
            if (cancelled) return;
            setContent(text);
            setDiff(diffForNewFile(text));
          } else {
            setDiff(parseUnifiedDiff(d.diff));
            if (typeof d.original === "string") {
              setOriginal(d.original);
              // The merge view needs the working copy too.
              if (content === null) {
                const text = await api.artifactText(session, tab.path);
                if (!cancelled) setContent(text);
              }
            }
          }
        } else if (content === null) {
          const text = await api.artifactText(session, tab.path);
          if (!cancelled) setContent(text);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError && e.status === 404 ? "This file is not in the sandbox (anymore)." : e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, tab.path, mode]);

  const draft = tab.draft ?? content ?? "";
  // Autosave, the way an editor does it: a short pause after the last keystroke writes the file back
  // into the sandbox. No Save button; ⌘S just saves immediately. The status bar shows Saving/Saved.
  const latest = React.useRef({ draft, dirty: !!tab.dirty, saving: false });
  latest.current = { draft, dirty: !!tab.dirty, saving };
  const save = React.useCallback(async () => {
    const cur = latest.current;
    if (!cur.dirty || cur.saving) return;
    setSaving(true);
    onSaving("saving");
    try {
      await api.writeFile(session, tab.path, cur.draft);
      setContent(cur.draft);
      setDiff(null);
      onDraft(cur.draft, false);
      onSaving("saved");
      onSaved();
    } catch (e) {
      onSaving(undefined);
      toast.error("Could not save", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, tab.path]);
  React.useEffect(() => {
    if (!tab.dirty) return;
    const t = window.setTimeout(() => void save(), 900);
    return () => window.clearTimeout(t);
  }, [draft, tab.dirty, save]);
  // Leaving the tab (or the pane) with unsaved text flushes it.
  React.useEffect(() => () => void save(), [save]);
  const download = async () => {
    try {
      const blob = await api.artifactBlob(session, tab.path);
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = tab.path.slice(tab.path.lastIndexOf("/") + 1);
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const segs = tab.path.split("/");
  const base = segs[segs.length - 1];
  const deleted = change?.status === "deleted";

  return (
    <>
      {/* Breadcrumbs + mode + actions */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3">
        <Breadcrumb path={tab.path} />
        {change && (
          <span className="stamp flex shrink-0 items-center gap-1.5 pr-1">
            {change.additions > 0 && <span className="text-ok">+{change.additions}</span>}
            {change.deletions > 0 && <span className="text-destructive">−{change.deletions}</span>}
          </span>
        )}
        {change && (
          <div role="tablist" className="bg-muted inline-flex h-7 items-center gap-0.5 rounded-md p-0.5">
            <ModeTab active={mode === "diff"} onClick={() => onMode("diff")} icon={<FileDiff className="size-3.5" />} label="Diff" />
            <ModeTab active={mode === "edit"} onClick={() => onMode("edit")} icon={<FileCode2 className="size-3.5" />} label="File" disabled={deleted} />
          </div>
        )}
        <span className={cn("stamp w-14 text-right transition-colors", saving ? "text-muted-foreground" : tab.dirty ? "text-attention-text" : "text-muted-foreground/60")} aria-live="polite">
          {saving ? "saving…" : tab.dirty ? "unsaved" : tab.saving === "saved" ? "saved" : ""}
        </span>
        <Button variant="ghost" size="icon-sm" onClick={download} aria-label="Download" disabled={deleted}>
          <Download />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {error ? (
          <p className="text-muted-foreground px-4 py-6 text-meta">{error}</p>
        ) : loading && ((mode === "diff" && !diff) || (mode !== "diff" && content === null)) ? (
          <p className="text-muted-foreground flex items-center gap-2 px-4 py-6 text-meta">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Loading {mode === "diff" ? "diff" : "file"}…
          </p>
        ) : mode === "diff" && diff ? (
          original !== null && content !== null ? (
            <UnifiedDiff original={original} modified={draft} path={tab.path} />
          ) : (
            <div className="h-full overflow-auto">
              <DiffView diff={diff} path={tab.path} />
            </div>
          )
        ) : mode === "edit" && content !== null ? (
          deleted ? (
            <p className="text-muted-foreground px-4 py-6 text-meta">This file was deleted in the working tree; see the diff.</p>
          ) : (
            <CodeEditor value={draft} onChange={(v) => onDraft(v, v !== content)} onSave={() => void save()} path={tab.path} ariaLabel={`Edit ${base}`} autoFocus />
          )
        ) : null}
      </div>
    </>
  );
}

/** A path as a quiet trail: folders in the muted colour, the file with its icon in the foreground. The middle collapses first. */
function Breadcrumb({ path }: { path: string }) {
  const segs = path.split("/");
  const file = segs[segs.length - 1];
  const dirs = segs.slice(0, -1);
  const shown = dirs.length > 4 ? [dirs[0], "…", ...dirs.slice(-2)] : dirs;
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-meta" title={path}>
      {/* Folders give way first (they truncate); the file name is the one part that always survives. */}
      {shown.map((d, i) => (
        <React.Fragment key={i}>
          <span className={cn("text-muted-foreground min-w-0 max-w-[9rem] truncate", d === "…" && "shrink-0 tracking-widest")}>{d}</span>
          <ChevronRight className="text-muted-foreground/50 size-3 shrink-0" aria-hidden />
        </React.Fragment>
      ))}
      <span className="text-foreground flex shrink-0 items-center gap-1.5 font-medium">
        <FileIcon path={path} size={14} />
        <span className="max-w-[16rem] truncate">{file}</span>
      </span>
    </nav>
  );
}

function ModeTab({ active, onClick, icon, label, disabled }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="tab" aria-selected={active} disabled={disabled} onClick={onClick} className={cn("flex h-6 cursor-pointer items-center gap-1 rounded px-2 text-micro font-medium disabled:cursor-not-allowed disabled:opacity-40", active ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}>
      {icon}
      {label}
    </button>
  );
}
