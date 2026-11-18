import * as React from "react";
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, FileDiff, Folder, FolderOpen } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotion } from "@/lib/motion-pref";
import { FileIcon } from "@/lib/iconTheme";
import { cn } from "@/lib/utils";

/**
 * Changed files as a folder tree (after T3 Code's changed-files card): folders with their summed
 * +/−, single-child folder chains folded into one row (`web/src/components`), files under them with
 * their own counts. `ChangedFilesTree` is the rows alone (the composer's dock owns its header);
 * `ChangedFilesCard` is the standalone card with a header: count, totals, expand/collapse all and
 * Open diff.
 */
export type ChangedEntry = {
  path: string;
  additions: number;
  deletions: number;
  status?: string;
  /** false: a file the agent wrote that git does not count (outside a repo) — no +/− on its row. */
  counted?: boolean;
};

type Stat = { additions: number; deletions: number };
type DirNode = { kind: "dir"; name: string; path: string; children: TreeNode[]; stat: Stat };
type FileNode = { kind: "file"; name: string; path: string; file: ChangedEntry; stat: Stat };
type TreeNode = DirNode | FileNode;

function buildTree(files: ChangedEntry[]): TreeNode[] {
  const root: DirNode = { kind: "dir", name: "", path: "", children: [], stat: { additions: 0, deletions: 0 } };
  for (const f of files) {
    const parts = f.path.split("/").filter(Boolean);
    let dir = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const path = parts.slice(0, i + 1).join("/");
      let next = dir.children.find((c): c is DirNode => c.kind === "dir" && c.path === path);
      if (!next) {
        next = { kind: "dir", name: parts[i], path, children: [], stat: { additions: 0, deletions: 0 } };
        dir.children.push(next);
      }
      dir = next;
    }
    dir.children.push({ kind: "file", name: parts[parts.length - 1] ?? f.path, path: f.path, file: f, stat: { additions: f.additions, deletions: f.deletions } });
  }
  const finish = (d: DirNode): DirNode => {
    d.children = d.children.map((c) => (c.kind === "dir" ? finish(c) : c));
    // A folder whose only child is a folder reads as one path: web → src → components.
    while (d.path && d.children.length === 1 && d.children[0].kind === "dir") {
      const only = d.children[0];
      d = { ...only, name: `${d.name}/${only.name}` };
    }
    d.stat = d.children.reduce((s, c) => ({ additions: s.additions + c.stat.additions, deletions: s.deletions + c.stat.deletions }), { additions: 0, deletions: 0 });
    d.children.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
    return d;
  };
  return finish(root).children;
}

export function totalsOf(files: ChangedEntry[]): Stat {
  return files.reduce((s, f) => ({ additions: s.additions + f.additions, deletions: s.deletions + f.deletions }), { additions: 0, deletions: 0 });
}

export function DiffStat({ additions, deletions, className }: Stat & { className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-2 font-mono tabular-nums", className)}>
      <span className="text-ok">+{additions.toLocaleString()}</span>
      <span className="text-destructive">−{deletions.toLocaleString()}</span>
    </span>
  );
}

const ROW =
  "group flex h-7 w-full cursor-pointer items-center gap-2 rounded-md py-1.5 pr-2 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default disabled:hover:bg-transparent";

export function ChangedFilesTree({
  files,
  allExpanded = true,
  onOpen,
  activePath,
  className,
}: {
  files: ChangedEntry[];
  /** Default state of every folder; flipping it resets the per-folder toggles. */
  allExpanded?: boolean;
  onOpen?: (f: ChangedEntry) => void;
  activePath?: string | null;
  className?: string;
}) {
  const tree = React.useMemo(() => buildTree(files), [files]);
  const [overrides, setOverrides] = React.useState<Record<string, boolean>>({});
  React.useEffect(() => setOverrides({}), [allExpanded]);
  const hasDirs = tree.some((n) => n.kind === "dir");

  const rows: React.ReactNode[] = [];
  const walk = (nodes: TreeNode[], depth: number) => {
    for (const n of nodes) {
      const pad = { paddingLeft: `${8 + depth * 14}px` };
      if (n.kind === "dir") {
        const open = overrides[n.path] ?? allExpanded;
        rows.push(
          <li key={`d:${n.path}`}>
            <button type="button" aria-expanded={open} className={ROW} style={pad} onClick={() => setOverrides((o) => ({ ...o, [n.path]: !open }))}>
              <ChevronRight className={cn("text-muted-foreground/70 group-hover:text-foreground/80 size-3.5 shrink-0 transition-transform", open && "rotate-90")} aria-hidden />
              {open ? <FolderOpen className="text-muted-foreground/75 size-3.5 shrink-0" aria-hidden /> : <Folder className="text-muted-foreground/75 size-3.5 shrink-0" aria-hidden />}
              <span className="text-muted-foreground/90 group-hover:text-foreground/90 min-w-0 truncate font-mono text-[11px]">{n.name}</span>
              <DiffStat {...n.stat} className="ml-auto text-[10px]" />
            </button>
          </li>
        );
        if (open) walk(n.children, depth + 1);
      } else {
        const gone = n.file.status === "deleted";
        rows.push(
          <li key={`f:${n.path}`}>
            <button type="button" title={n.path} className={cn(ROW, activePath === n.path && "bg-accent")} style={pad} onClick={onOpen ? () => onOpen(n.file) : undefined} disabled={!onOpen}>
              {(hasDirs || depth > 0) && <span className="size-3.5 shrink-0" aria-hidden />}
              <FileIcon path={n.path} size={14} className="text-muted-foreground/70 shrink-0" />
              <span className={cn("min-w-0 truncate font-mono text-xs", gone ? "text-muted-foreground line-through" : "text-foreground/85 group-hover:text-foreground")}>{n.name}</span>
              {(n.file.status === "untracked" || n.file.status === "added") && <span className="text-ok shrink-0 font-mono text-[10px]">new</span>}
              {n.file.counted === false ? <span className="ml-auto" /> : <DiffStat {...n.stat} className="ml-auto text-[10px]" />}
            </button>
          </li>
        );
      }
    }
  };
  walk(tree, 0);
  return (
    <ul aria-label="Changed files" className={cn("flex flex-col px-1 pb-1", className)}>
      {rows}
    </ul>
  );
}

/**
 * The standalone card: a header (count, totals, expand/collapse all, Open diff) over the tree.
 * Collapsed by default — the header is the summary (a run that touched 90 files must not push
 * 90 rows into the conversation); clicking it unfolds the tree, which then opens every folder.
 */
export function ChangedFilesCard({ files, more = 0, totals: given, onOpen, onOpenDiff, defaultOpen = false, className }: { files: ChangedEntry[]; /** Files beyond `files` that only the full diff shows. */ more?: number; /** Totals for every file, when `files` is only the first slice. */ totals?: Stat; onOpen?: (f: ChangedEntry) => void; onOpenDiff?: () => void; /** Start with the tree showing (the header alone otherwise). */ defaultOpen?: boolean; className?: string }) {
  const [open, setOpen] = React.useState(defaultOpen);
  const [allExpanded, setAllExpanded] = React.useState(true);
  const still = useReducedMotion();
  const totals = given ?? totalsOf(files);
  const count = files.length + more;
  const hasDirs = files.some((f) => f.path.includes("/"));
  return (
    <div className={cn("bg-secondary dark:bg-input/20 @container/changed-files rounded-lg", className)}>
      <div className="flex items-center justify-between gap-2 rounded-t-lg py-1 pr-2 pl-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? "Hide changed files" : "Show changed files"}
          className="hover:bg-accent/60 text-foreground flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md py-1 pr-2 pl-2 text-left text-xs font-medium transition-colors"
        >
          <ChevronRight className={cn("text-muted-foreground/70 size-3.5 shrink-0 transition-transform", open && "rotate-90")} aria-hidden />
          <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              {count.toLocaleString()} changed file{count === 1 ? "" : "s"}
            </span>
            <DiffStat {...totals} className="text-xs leading-4" />
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          {open && hasDirs && (
            <button
              type="button"
              onClick={() => setAllExpanded((v) => !v)}
              aria-label={allExpanded ? "Collapse all folders" : "Expand all folders"}
              title={allExpanded ? "Collapse all folders" : "Expand all folders"}
              className="text-muted-foreground hover:text-foreground hover:bg-accent/60 grid size-6 cursor-pointer place-items-center rounded-md transition-colors"
            >
              {allExpanded ? <ChevronsDownUp className="size-3" aria-hidden /> : <ChevronsUpDown className="size-3" aria-hidden />}
            </button>
          )}
          {onOpenDiff && (
            <button type="button" onClick={onOpenDiff} aria-label="Open diff" title="Open the full diff" className="text-muted-foreground hover:text-foreground hover:bg-accent/60 inline-flex h-6 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs transition-colors">
              <FileDiff className="size-3" aria-hidden />
              <span className="hidden @[24rem]/changed-files:inline">Open diff</span>
            </button>
          )}
        </div>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="tree"
            initial={still ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={still ? { opacity: 1 } : { height: "auto", opacity: 1 }}
            exit={still ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: still ? 0.12 : 0.26, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <ChangedFilesTree files={files} allExpanded={allExpanded} onOpen={onOpen} />
          </motion.div>
        )}
      </AnimatePresence>
      {more > 0 && (
        <div className="px-3 pb-2">
          {onOpenDiff ? (
            <button type="button" onClick={onOpenDiff} className="text-muted-foreground hover:text-foreground cursor-pointer text-xs">
              {more.toLocaleString()} more file{more === 1 ? "" : "s"} in the full diff
            </button>
          ) : (
            <span className="text-muted-foreground text-xs">
              {more.toLocaleString()} more file{more === 1 ? "" : "s"}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
