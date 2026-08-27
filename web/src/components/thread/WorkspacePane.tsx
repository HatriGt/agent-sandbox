import * as React from "react";
import { ChevronDown, ChevronRight, Download, FileCode2, FileDiff, FolderClosed, FolderOpen, GitBranch, Loader2, PanelLeftClose, PanelLeftOpen, Pencil, RefreshCw, Save, Search, X } from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { api, ApiError, type ChangedFile } from "@/lib/api";
import { parseUnifiedDiff, diffForNewFile, type ParsedDiff } from "@/lib/diff";
import { FileMark, languageOf } from "@/lib/fileIcon";
import { CodeBlock, CodeBlockCode } from "@/components/ui/code-block";
import { Markdown } from "@/components/ui/markdown";
import { CodeEditor } from "@/components/CodeEditor";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DiffView } from "./FilePane";
import { cn } from "@/lib/utils";

/**
 * The workspace, the way an editor shows it: a collapsible file tree on the left (repos as roots,
 * folders, files with their marks; changed files carry a coloured status dot and +/−), and on the
 * right a tab strip of open files, each viewable as Diff, File or Edit. Edits save back into the
 * sandbox (⌘S) and refresh the change list, so what you fix by hand and what the agent does land in
 * the same working tree. Everything is fetched lazily and cached per (session, path).
 */
type Node = { name: string; path: string; children?: Map<string, Node> };

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

type Tab = { path: string; mode: "diff" | "file" | "edit"; draft?: string; dirty?: boolean };

export function WorkspacePane({ session, changes, open, onClose, onSaved, repos }: { session: string; changes: ChangedFile[]; open: ChangedFile | null; onClose: () => void; onSaved: () => void; repos: string[] }) {
  const [paths, setPaths] = React.useState<string[] | null>(null);
  const [treeErr, setTreeErr] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set(repos));
  const [filter, setFilter] = React.useState("");
  const [treeOpen, setTreeOpen] = React.useState(true);
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

  // A file handed in from the changes dock opens (or focuses) a tab in diff mode.
  React.useEffect(() => {
    if (!open) return;
    openPath(open.path, changeByPath.has(open.path) ? "diff" : "file");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open?.path]);

  const openPath = (path: string, mode?: Tab["mode"]) => {
    setTabs((t) => (t.some((x) => x.path === path) ? t : [...t, { path, mode: mode ?? (changeByPath.has(path) ? "diff" : "file") }]));
    setActive(path);
    // Reveal in the tree.
    setExpanded((e) => {
      const n = new Set(e);
      const parts = path.split("/");
      for (let i = 1; i < parts.length; i++) n.add(parts.slice(0, i).join("/"));
      return n;
    });
  };
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
  const q = filter.trim().toLowerCase();
  const matches = React.useMemo(() => (q && paths ? paths.filter((p) => p.toLowerCase().includes(q)).slice(0, 200) : null), [q, paths]);
  const activeTab = tabs.find((t) => t.path === active) ?? null;

  return (
    <motion.aside
      initial={{ x: 24, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 24, opacity: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="bg-card absolute inset-0 z-20 flex min-w-0 flex-col md:relative md:inset-auto md:h-full md:w-[54%] md:min-w-[30rem] md:border-l"
      aria-label="Workspace"
    >
      {/* Tab strip */}
      <header className="flex h-10 shrink-0 items-stretch border-b">
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" onClick={() => setTreeOpen((v) => !v)} aria-label={treeOpen ? "Hide files" : "Show files"} className="text-muted-foreground hover:text-foreground hover:bg-muted grid w-10 shrink-0 cursor-pointer place-items-center border-r">
              {treeOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{treeOpen ? "Hide the file tree" : "Show the file tree"}</TooltipContent>
        </Tooltip>
        <div role="tablist" className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
          {tabs.length === 0 && <span className="text-muted-foreground self-center px-3 text-meta">Workspace</span>}
          {tabs.map((t) => {
            const on = t.path === active;
            const base = t.path.slice(t.path.lastIndexOf("/") + 1);
            return (
              <div key={t.path} role="tab" aria-selected={on} className={cn("group relative flex shrink-0 items-center gap-1.5 border-r pr-1 pl-3 text-meta", on ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/60")}>
                {on && <span className="bg-live absolute inset-x-0 top-0 h-[2px]" aria-hidden />}
                <button type="button" onClick={() => setActive(t.path)} className="flex cursor-pointer items-center gap-1.5 py-2 font-mono">
                  <FileMark path={t.path} className="scale-90" />
                  <span className={cn(t.dirty && "italic")}>{base}</span>
                  {t.dirty && <span className="bg-attention size-1.5 rounded-full" aria-label="unsaved" />}
                </button>
                <button type="button" onClick={() => closeTab(t.path)} aria-label={`Close ${base}`} className="text-muted-foreground hover:text-foreground hover:bg-muted grid size-5 cursor-pointer place-items-center rounded opacity-0 group-hover:opacity-100 focus-visible:opacity-100 aria-selected:opacity-100">
                  <X className="size-3" />
                </button>
              </div>
            );
          })}
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close workspace" className="m-1 self-center">
          <X />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        {treeOpen && (
          <nav aria-label="Files" className="bg-muted/30 flex w-56 shrink-0 flex-col border-r">
            <label className="flex h-9 items-center gap-1.5 border-b px-2.5">
              <Search className="text-muted-foreground size-3.5" aria-hidden />
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Go to file" aria-label="Filter files" className="text-foreground placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-meta outline-none" />
              <button type="button" onClick={() => void loadTree()} aria-label="Refresh files" className="text-muted-foreground hover:text-foreground grid size-5 cursor-pointer place-items-center rounded">
                <RefreshCw className="size-3" />
              </button>
            </label>
            <div className="min-h-0 flex-1 overflow-auto py-1">
              {treeErr ? (
                <p className="text-destructive px-3 py-2 text-micro">{treeErr}</p>
              ) : !tree ? (
                <div className="flex flex-col gap-2 px-3 py-2">
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <span key={i} className="bg-muted h-3 animate-pulse rounded" style={{ width: `${55 + ((i * 17) % 40)}%`, marginLeft: `${(i % 3) * 12}px` }} />
                  ))}
                </div>
              ) : matches ? (
                <ul>
                  {matches.map((p) => (
                    <li key={p}>
                      <FileRow path={p} depth={0} active={active === p} change={changeByPath.get(p)} onOpen={() => openPath(p)} showDir />
                    </li>
                  ))}
                  {matches.length === 0 && <li className="text-muted-foreground px-3 py-2 text-micro">No file matches “{filter.trim()}”.</li>}
                </ul>
              ) : (
                <TreeLevel node={tree} depth={0} expanded={expanded} setExpanded={setExpanded} active={active} changeByPath={changeByPath} onOpen={openPath} repos={repos} />
              )}
            </div>
            {paths && (
              <p className="stamp text-muted-foreground border-t px-3 py-1.5">
                {paths.length} files · {changes.length} changed
              </p>
            )}
          </nav>
        )}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {activeTab ? (
            <FileView key={activeTab.path} session={session} tab={activeTab} change={changeByPath.get(activeTab.path)} onMode={(m) => patchTab(activeTab.path, { mode: m })} onDraft={(d, dirty) => patchTab(activeTab.path, { draft: d, dirty })} onSaved={onSaved} />
          ) : (
            <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-meta">
              <FolderOpen className="size-6 opacity-60" aria-hidden />
              <p>Pick a file to view its diff, contents, or edit it in place.</p>
              <p className="text-micro opacity-70">Changed files are marked in the tree · ⌘S saves an edit into the sandbox</p>
            </div>
          )}
        </div>
      </div>
    </motion.aside>
  );
}

function TreeLevel({ node, depth, expanded, setExpanded, active, changeByPath, onOpen, repos }: { node: Node; depth: number; expanded: Set<string>; setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>; active: string | null; changeByPath: Map<string, ChangedFile>; onOpen: (p: string) => void; repos: string[] }) {
  return (
    <ul>
      {sorted(node.children!).map((child) => {
        if (child.children) {
          const isOpen = expanded.has(child.path);
          const isRepo = depth === 0 && repos.includes(child.name);
          // Count changes under this folder for a quiet badge.
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
                className="hover:bg-muted text-foreground flex h-7 w-full cursor-pointer items-center gap-1 pr-2 text-left text-meta"
                style={{ paddingLeft: `${8 + depth * 12}px` }}
              >
                {isOpen ? <ChevronDown className="text-muted-foreground size-3.5 shrink-0" /> : <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />}
                {isRepo ? <GitBranch className="text-live size-3.5 shrink-0" /> : isOpen ? <FolderOpen className="text-muted-foreground size-3.5 shrink-0" /> : <FolderClosed className="text-muted-foreground size-3.5 shrink-0" />}
                <span className={cn("truncate", isRepo && "font-medium")}>{child.name}</span>
                {n > 0 && <span className="stamp text-attention-text ml-auto">{n}</span>}
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
  const tone = change ? (change.status === "deleted" ? "text-destructive" : change.status === "untracked" || change.status === "added" ? "text-ok" : "text-attention-text") : "";
  return (
    <button type="button" onClick={onOpen} className={cn("flex h-7 w-full cursor-pointer items-center gap-1.5 pr-2 text-left text-meta", active ? "bg-accent text-foreground" : "hover:bg-muted text-foreground/90")} style={{ paddingLeft: `${8 + depth * 12 + 16}px` }} title={path}>
      <FileMark path={path} className="scale-90" />
      <span className={cn("truncate font-mono text-micro", change?.status === "deleted" && "line-through", tone)}>{base}</span>
      {showDir && dir && <span className="stamp text-muted-foreground truncate">{dir}</span>}
      {change && (
        <span className="stamp ml-auto flex shrink-0 items-center gap-1">
          {change.additions > 0 && <span className="text-ok">+{change.additions}</span>}
          {change.deletions > 0 && <span className="text-destructive">−{change.deletions}</span>}
        </span>
      )}
    </button>
  );
}

/** One open file: header with path, +/−, mode tabs, download; body per mode. */
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

  const base = tab.path.slice(tab.path.lastIndexOf("/") + 1);
  const dir = tab.path.slice(0, Math.max(0, tab.path.lastIndexOf("/")));
  const isMd = /\.(md|markdown)$/i.test(base);
  const deleted = change?.status === "deleted";

  return (
    <>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <p className="stamp text-muted-foreground min-w-0 flex-1 truncate">
          {dir && <span>{dir}/</span>}
          <span className="text-foreground">{base}</span>
        </p>
        {change && (
          <span className="stamp flex shrink-0 items-center gap-1.5">
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
