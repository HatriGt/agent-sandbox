import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { FileMark } from "@/lib/fileIcon";
import type { TreeNode } from "@/lib/viz";
import { VizFrame } from "./VizFrame";

/**
 * ```tree fence (or an auto-detected ASCII tree) → a real collapsible tree with the same file
 * marks as the workspace pane. Directories toggle; deep trees start collapsed below depth 2 so a
 * 200-line dump reads as a shape first and details on demand.
 */
export function TreeBlock({ roots, source }: { roots: TreeNode[]; source: string }) {
  const count = React.useMemo(() => {
    let n = 0;
    const walk = (nodes: TreeNode[]) => nodes.forEach((x) => (n++, walk(x.children)));
    walk(roots);
    return n;
  }, [roots]);
  return (
    <VizFrame title={`${count} ${count === 1 ? "entry" : "entries"}`} source={source}>
      <div className="max-h-96 overflow-auto px-2 py-1.5 font-mono text-micro" role="tree">
        {roots.map((n, i) => (
          <Node key={i} node={n} depth={0} />
        ))}
      </div>
    </VizFrame>
  );
}

function Node({ node, depth }: { node: TreeNode; depth: number }) {
  const isDir = node.children.length > 0 || node.name.endsWith("/");
  const [open, setOpen] = React.useState(depth < 2);
  const name = node.name.replace(/\/$/, "");
  return (
    <div role={isDir ? "treeitem" : undefined} aria-expanded={isDir ? open : undefined}>
      <button
        type="button"
        disabled={!isDir}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left",
          isDir ? "hover:bg-muted/60 cursor-pointer" : "cursor-default"
        )}
        style={{ paddingLeft: `${depth * 16 + 6}px` }}
      >
        {isDir ? (
          <ChevronRight className={cn("text-muted-foreground size-3 shrink-0 transition-transform duration-150", open && "rotate-90")} aria-hidden />
        ) : (
          <span className="w-3 shrink-0" aria-hidden />
        )}
        <FileMark path={isDir ? name + "/" : name} />
        <span className="text-foreground truncate">{name}</span>
        {node.note && <span className="text-faint ml-2 truncate">{node.note}</span>}
        {isDir && !open && <span className="text-faint ml-1">({node.children.length})</span>}
      </button>
      {isDir && open && node.children.map((c, i) => <Node key={i} node={c} depth={depth + 1} />)}
    </div>
  );
}
