import * as React from "react";
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, Download, Files, FileCode2, FileDiff, GitBranch, GitCommitHorizontal, Loader2, Pencil, RefreshCw, Save, Search, Upload, X } from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { api, ApiError, type ChangedFile, type GitStatus } from "@/lib/api";
import { parseUnifiedDiff, diffForNewFile, type ParsedDiff } from "@/lib/diff";
import { languageOf } from "@/lib/fileIcon";
import { FileIcon, FolderIcon } from "@/lib/vscodeIcons";
import { CodeBlock, CodeBlockCode } from "@/components/ui/code-block";
import { Markdown } from "@/components/ui/markdown";
import { CodeEditor } from "@/components/CodeEditor";
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
type Tab = { path: string; mode: "diff" | "file" | "edit"; draft?: string; dirty?: boolean };
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

export function WorkspacePane({ session, changes, open, onClose, onSaved, repos }: { session: string; changes: ChangedFile[]; open: ChangedFile | null; onClose: () => void; onSaved: () => void; repos: Repo[] }) {
  const [paths, setPaths] = React.useState<string[] | null>(null);
  const [treeErr, setTreeErr] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set(repos.map((r) => r.name)));
  const [view, setView] = React.useState<View>("explorer");
  const [sidebar, setSidebar] = React.useState(true);
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
      setTabs((t) => (t.some((x) => x.path === path) ? t : [...t, { path, mode: mode ?? (changeByPath.has(path) ? "diff" : "file") }]));
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
    if (open) openPath(open.path, changeByPath.has(open.path) ? "diff" : "file");
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

  return (
    <motion.aside
      initial={{ x: 24, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 24, opacity: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="bg-card absolute inset-0 z-20 flex min-w-0 flex-col md:relative md:inset-auto md:h-full md:w-[58%] md:min-w-[34rem] md:border-l"
      aria-label="Workspace"
    >
      <div className="flex min-h-0 flex-1">
        {/* Activity bar */}
        <nav aria-label="Views" className="bg-muted/50 flex w-11 shrink-0 flex-col items-center gap-1 border-r py-2">
          <Activity icon={<Files className="size-[18px]" />} label="Explorer" active={view === "explorer" && sidebar} onClick={() => (view === "explorer" && sidebar ? setSidebar(false) : (setView("explorer"), setSidebar(true)))} />
          <Activity icon={<Search className="size-[18px]" />} label="Go to file" active={view === "search" && sidebar} onClick={() => (view === "search" && sidebar ? setSidebar(false) : (setView("search"), setSidebar(true)))} />
          <Activity icon={<GitBranch className="size-[18px]" />} label="Source control" active={view === "scm" && sidebar} badge={changes.length || undefined} onClick={() => (view === "scm" && sidebar ? setSidebar(false) : (setView("scm"), setSidebar(true)))} />
          <div className="mt-auto">
            <Activity icon={<X className="size-[18px]" />} label="Close workspace" onClick={onClose} />
          </div>
        </nav>

        {/* Sidebar */}
        {sidebar && (
          <section className="bg-muted/25 flex w-64 shrink-0 flex-col border-r" aria-label={view}>
            {view === "explorer" && <Explorer tree={tree} err={treeErr} paths={paths} expanded={expanded} setExpanded={setExpanded} active={active} changeByPath={changeByPath} onOpen={openPath} repos={repos} onRefresh={() => void loadTree()} />}
            {view === "search" && <GoToFile paths={paths} active={active} changeByPath={changeByPath} onOpen={openPath} />}
            {view === "scm" && <SourceControl session={session} repo={activeRepo} status={git} err={gitErr} reload={loadGit} changes={changes} active={active} onOpen={(p) => openPath(p, "diff")} onChanged={onSaved} />}
          </section>
        )}

        {/* Editor group */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div role="tablist" className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b">
            {tabs.map((t) => {
              const on = t.path === active;
              const base = t.path.slice(t.path.lastIndexOf("/") + 1);
              return (
                <div key={t.path} role="tab" aria-selected={on} className={cn("group relative flex shrink-0 items-center gap-1.5 border-r pr-1 pl-3 text-meta", on ? "bg-card text-foreground" : "bg-muted/30 text-muted-foreground hover:text-foreground")}>
                  {on && <span className="bg-live absolute inset-x-0 top-0 h-[2px]" aria-hidden />}
                  <button type="button" onClick={() => setActive(t.path)} className="flex cursor-pointer items-center gap-1.5 py-2">
                    <FileIcon path={t.path} size={14} />
                    <span className={cn("font-mono text-micro", t.dirty && "italic")}>{base}</span>
                  </button>
                  <button type="button" onClick={() => closeTab(t.path)} aria-label={`Close ${base}`} className={cn("text-muted-foreground hover:text-foreground hover:bg-muted grid size-5 cursor-pointer place-items-center rounded", !t.dirty && !on && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}>
                    {t.dirty ? <span className="bg-foreground block size-2 rounded-full" aria-label="unsaved" /> : <X className="size-3" />}
                  </button>
                </div>
              );
            })}
            {tabs.length === 0 && <span className="text-muted-foreground self-center px-3 text-micro">No file open</span>}
          </div>
          {activeTab ? (
            <FileView key={activeTab.path} session={session} tab={activeTab} change={changeByPath.get(activeTab.path)} onMode={(m) => patchTab(activeTab.path, { mode: m })} onDraft={(d, dirty) => patchTab(activeTab.path, { draft: d, dirty })} onSaved={onSaved} />
          ) : (
            <EmptyEditor />
          )}
        </div>
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
        {activeTab && <span>{activeTab.mode === "edit" ? (activeTab.dirty ? "unsaved · ⌘S" : "editing") : activeTab.mode}</span>}
      </footer>
    </motion.aside>
  );
}

function Activity({ icon, label, active, badge, onClick }: { icon: React.ReactNode; label: string; active?: boolean; badge?: number; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" onClick={onClick} aria-label={label} aria-pressed={active} className={cn("relative grid size-9 cursor-pointer place-items-center rounded-md transition-colors", active ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
          {active && <span className="bg-foreground absolute top-1.5 bottom-1.5 -left-1 w-0.5 rounded-full" aria-hidden />}
          {icon}
          {badge != null && badge > 0 && <span className="bg-live absolute top-0.5 right-0.5 grid min-w-4 place-items-center rounded-full px-1 text-[9px] font-semibold text-white">{badge}</span>}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function SideHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 px-3">
      <span className="label text-muted-foreground flex-1 truncate">{title}</span>
      {children}
    </div>
  );
}

/* ───────────────────────────── Explorer ───────────────────────────── */

function Explorer({ tree, err, paths, expanded, setExpanded, active, changeByPath, onOpen, repos, onRefresh }: { tree: Node | null; err: string | null; paths: string[] | null; expanded: Set<string>; setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>; active: string | null; changeByPath: Map<string, ChangedFile>; onOpen: (p: string) => void; repos: Repo[]; onRefresh: () => void }) {
  return (
    <>
      <SideHeader title="Explorer">
        <button type="button" onClick={onRefresh} aria-label="Refresh" className="text-muted-foreground hover:text-foreground grid size-6 cursor-pointer place-items-center rounded">
          <RefreshCw className="size-3.5" />
        </button>
        <button type="button" onClick={() => setExpanded(new Set(repos.map((r) => r.name)))} aria-label="Collapse folders" className="text-muted-foreground hover:text-foreground grid size-6 cursor-pointer place-items-center rounded">
          <ChevronDown className="size-3.5 rotate-180" />
        </button>
      </SideHeader>
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
      {paths && (
        <p className="stamp text-muted-foreground border-t px-3 py-1.5">
          {paths.length} files · {changeByPath.size} changed
        </p>
      )}
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

function GoToFile({ paths, active, changeByPath, onOpen }: { paths: string[] | null; active: string | null; changeByPath: Map<string, ChangedFile>; onOpen: (p: string) => void }) {
  const [q, setQ] = React.useState("");
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
      <SideHeader title="Go to file" />
      <label className="mx-2 mb-1 flex h-8 items-center gap-1.5 rounded-md border px-2 focus-within:ring-2 focus-within:ring-ring">
        <Search className="text-muted-foreground size-3.5" aria-hidden />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") (e.preventDefault(), setCursor((c) => Math.min(matches.length - 1, c + 1)));
            else if (e.key === "ArrowUp") (e.preventDefault(), setCursor((c) => Math.max(0, c - 1)));
            else if (e.key === "Enter" && matches[cursor]) onOpen(matches[cursor]);
          }}
          placeholder="Type a file name"
          aria-label="Filter files"
          className="text-foreground placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-meta outline-none"
        />
      </label>
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
        <SideHeader title="Source control" />
        <p className="text-muted-foreground px-3 py-2 text-micro">No repository is attached to this sandbox.</p>
      </>
    );
  }
  return (
    <>
      <SideHeader title="Source control">
        <button type="button" onClick={load} aria-label="Refresh" className="text-muted-foreground hover:text-foreground grid size-6 cursor-pointer place-items-center rounded">
          <RefreshCw className="size-3.5" />
        </button>
      </SideHeader>
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

function FileView({ session, tab, change, onMode, onDraft, onSaved }: { session: string; tab: Tab; change?: ChangedFile; onMode: (m: Tab["mode"]) => void; onDraft: (d: string, dirty: boolean) => void; onSaved: () => void }) {
  const [diff, setDiff] = React.useState<ParsedDiff | null>(null);
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
          } else setDiff(parseUnifiedDiff(d.diff));
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
  const save = async () => {
    if (!tab.dirty || saving) return;
    setSaving(true);
    try {
      await api.writeFile(session, tab.path, draft);
      setContent(draft);
      setDiff(null);
      onDraft(draft, false);
      onSaved();
      toast.success(`Saved ${tab.path.slice(tab.path.lastIndexOf("/") + 1)}`);
    } catch (e) {
      toast.error("Could not save", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };
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
  const isMd = /\.(md|markdown)$/i.test(base);
  const deleted = change?.status === "deleted";

  return (
    <>
      {/* Breadcrumbs + mode + actions */}
      <div className="flex h-9 shrink-0 items-center gap-1 border-b px-3">
        <nav aria-label="Breadcrumb" className="stamp text-muted-foreground flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
          {segs.map((s, i) => (
            <React.Fragment key={i}>
              {i > 0 && <ChevronRight className="size-3 shrink-0 opacity-60" aria-hidden />}
              {i === segs.length - 1 ? (
                <span className="text-foreground flex min-w-0 items-center gap-1 truncate">
                  <FileIcon path={tab.path} size={13} />
                  {s}
                </span>
              ) : (
                <span className="truncate">{s}</span>
              )}
            </React.Fragment>
          ))}
        </nav>
        {change && (
          <span className="stamp flex shrink-0 items-center gap-1.5 pr-1">
            {change.additions > 0 && <span className="text-ok">+{change.additions}</span>}
            {change.deletions > 0 && <span className="text-destructive">−{change.deletions}</span>}
          </span>
        )}
        <div role="tablist" className="bg-muted inline-flex h-7 items-center gap-0.5 rounded-md p-0.5">
          <ModeTab active={mode === "diff"} onClick={() => onMode("diff")} icon={<FileDiff className="size-3.5" />} label="Diff" disabled={!change} />
          <ModeTab active={mode === "file"} onClick={() => onMode("file")} icon={<FileCode2 className="size-3.5" />} label="File" disabled={deleted} />
          <ModeTab active={mode === "edit"} onClick={() => onMode("edit")} icon={<Pencil className="size-3.5" />} label="Edit" disabled={deleted} />
        </div>
        {mode === "edit" && (
          <Button size="sm" onClick={() => void save()} disabled={!tab.dirty || saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            Save
          </Button>
        )}
        <Button variant="ghost" size="icon-sm" onClick={download} aria-label="Download" disabled={deleted}>
          <Download />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <p className="text-muted-foreground px-4 py-6 text-meta">{error}</p>
        ) : loading && ((mode === "diff" && !diff) || (mode !== "diff" && content === null)) ? (
          <p className="text-muted-foreground flex items-center gap-2 px-4 py-6 text-meta">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Loading {mode === "diff" ? "diff" : "file"}…
          </p>
        ) : mode === "diff" && diff ? (
          <DiffView diff={diff} path={tab.path} />
        ) : mode === "edit" && content !== null ? (
          <CodeEditor value={draft} onChange={(v) => onDraft(v, v !== content)} onSave={() => void save()} language={languageOf(tab.path)} minRows={30} className="min-h-full" ariaLabel={`Edit ${base}`} />
        ) : mode === "file" && content !== null ? (
          isMd ? (
            <div className="prose-agent text-foreground px-5 py-4">
              <Markdown>{content}</Markdown>
            </div>
          ) : (
            <CodeBlock className="my-0 rounded-none border-0 shadow-none">
              <CodeBlockCode code={content} language={languageOf(tab.path)} />
            </CodeBlock>
          )
        ) : null}
      </div>
    </>
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
