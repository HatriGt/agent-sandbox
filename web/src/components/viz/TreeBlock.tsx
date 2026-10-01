import * as React from "react";
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { FileMark } from "@/lib/fileIcon";
import type { TreeNode } from "@/lib/viz";
import { VizFrame } from "./VizFrame";

type Fold = { base: "auto" | "all" | "none"; over: Record<string, boolean> };

/**
 * ```tree fence (or an auto-detected ASCII tree) → a real collapsible tree with the same file
 * marks as the workspace pane. Directories toggle (click, or ←/→ on the focused row); deep trees
 * start collapsed below depth 2 so a 200-line dump reads as a shape first and details on demand.
 * Fold state is keyed by path, so it survives the tree growing while the block streams. The header
 * offers expand-all / collapse-all, and a path filter keeps matches plus their ancestors.
 */
export function TreeBlock({ roots, source }: { roots: TreeNode[]; source: string }) {
  const [fold, setFold] = React.useState<Fold>({ base: "auto", over: {} });
  const [query, setQuery] = React.useState("");
  const count = React.useMemo(() => {
    let n = 0;
    const walk = (nodes: TreeNode[]) => nodes.forEach((x) => (n++, walk(x.children)));
    walk(roots);
    return n;
  }, [roots]);
  const q = query.trim().toLowerCase();
  // Paths that match the filter, or lead to a match — everything else hides while filtering.
  const keep = React.useMemo(() => {
    if (!q) return null;
    const set = new Set<string>();
    const walk = (nodes: TreeNode[], parent: string): boolean => {
      let any = false;
      for (const n of nodes) {
        const p = join(parent, n.name);
        const hit = p.toLowerCase().includes(q) || (n.note ?? "").toLowerCase().includes(q);
        const below = walk(n.children, p);
        if (hit || below) {
          set.add(p);
          any = true;
        }
      }
      return any;
    };
    walk(roots, "");
    return set;
  }, [roots, q]);
  const anyDir = roots.some((r) => r.children.length > 0);
  const allOpen = fold.base === "all" && Object.values(fold.over).every(Boolean);
  const ctx = React.useMemo(() => ({ fold, setFold, keep }), [fold, keep]);
  return (
    <VizFrame
      title={`${count} ${count === 1 ? "entry" : "entries"}`}
      source={source}
      actions={
        anyDir && (
          <button
            type="button"
            onClick={() => setFold({ base: allOpen ? "none" : "all", over: {} })}
            aria-label={allOpen ? "Collapse all" : "Expand all"}
            title={allOpen ? "Collapse all" : "Expand all"}
            className="text-muted-foreground hover:text-foreground grid size-6 cursor-pointer place-items-center rounded-md opacity-60 group-hover/viz:opacity-100 focus-visible:opacity-100"
          >
            {allOpen ? <ChevronsDownUp className="size-3.5" /> : <ChevronsUpDown className="size-3.5" />}
          </button>
        )
      }
    >
      {count > 8 && (
        <label className="flex items-center gap-2 border-b px-3 py-1.5">
          <Search className="text-faint size-3.5 shrink-0" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            placeholder="Filter by path"
            aria-label="Filter by path"
            className="text-foreground placeholder:text-faint min-w-0 flex-1 bg-transparent text-meta outline-none"
          />
          {keep && (
            <span className="text-faint shrink-0 text-micro tabular-nums" aria-live="polite">
              {keep.size} shown
            </span>
          )}
        </label>
      )}
      <TreeCtx.Provider value={ctx}>
        <div className="max-h-96 overflow-auto px-2 py-1.5 font-mono text-micro" role="tree">
          {roots.map((n, i) => (
            <Node key={`${i}:${n.name}`} node={n} depth={0} parent="" />
          ))}
          {keep && keep.size === 0 && <div className="text-faint px-1.5 py-1 font-sans">Nothing matches “{query}”</div>}
        </div>
      </TreeCtx.Provider>
    </VizFrame>
  );
}

const join = (parent: string, name: string) => (parent ? `${parent}/${name.replace(/\/$/, "")}` : name.replace(/\/$/, ""));

const TreeCtx = React.createContext<{ fold: Fold; setFold: React.Dispatch<React.SetStateAction<Fold>>; keep: Set<string> | null }>({
  fold: { base: "auto", over: {} },
  setFold: () => {},
  keep: null,
});

function Node({ node, depth, parent }: { node: TreeNode; depth: number; parent: string }) {
  const { fold, setFold, keep } = React.useContext(TreeCtx);
  const path = join(parent, node.name);
  if (keep && !keep.has(path)) return null;
  const isDir = node.children.length > 0 || node.name.endsWith("/");
  const stored = fold.over[path] ?? (fold.base === "all" ? true : fold.base === "none" ? false : depth < 2);
  // While filtering, ancestors of matches open so the match is visible.
  const open = keep ? true : stored;
  const setOpen = (v: boolean) => setFold((f) => ({ ...f, over: { ...f.over, [path]: v } }));
  const name = node.name.replace(/\/$/, "");
  return (
    <div role="treeitem" aria-expanded={isDir ? open : undefined} aria-selected={false}>
      <button
        type="button"
        aria-disabled={!isDir}
        onClick={() => isDir && setOpen(!open)}
        onKeyDown={(e) => {
          if (!isDir) return;
          if (e.key === "ArrowRight" && !open) (e.preventDefault(), setOpen(true));
          else if (e.key === "ArrowLeft" && open) (e.preventDefault(), setOpen(false));
        }}
        data-tree-path={path}
        className={cn(
          "flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
          isDir ? "hover:bg-muted/60 cursor-pointer" : "cursor-default"
        )}
        style={{ paddingLeft: `${depth * 16 + 6}px` }}
      >
        {isDir ? (
          <ChevronRight className={cn("text-muted-foreground size-3 shrink-0 transition-transform duration-150 motion-reduce:transition-none", open && "rotate-90")} aria-hidden />
        ) : (
          <span className="w-3 shrink-0" aria-hidden />
        )}
        <FileMark path={isDir ? name + "/" : name} />
        <span className="text-foreground truncate">{name}</span>
        {node.note && <span className="text-faint ml-2 truncate">{node.note}</span>}
        {isDir && !open && <span className="text-faint ml-1">({node.children.length})</span>}
      </button>
      {isDir && open && (
        <div role="group">
          {node.children.map((c, i) => (
            <Node key={`${i}:${c.name}`} node={c} depth={depth + 1} parent={path} />
          ))}
        </div>
      )}
    </div>
  );
}
