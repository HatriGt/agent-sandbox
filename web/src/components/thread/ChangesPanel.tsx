import * as React from "react";
import { ChevronDown, FileDiff, RefreshCw } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ChangedFile } from "@/lib/api";
import { FileMark } from "@/lib/fileIcon";
import { cn } from "@/lib/utils";

/**
 * What the agent changed, as a folded list: "5 files" with total +/- in the header, each file with
 * its type mark, path, and its own +/- counts. Click a file to open it in the pane (diff or content).
 * Deleted files are struck through; new ones marked. Collapsed by default once the run is done, so a
 * finished thread ends on the summary, not a wall of paths.
 */
export function ChangesPanel({
  files,
  loading,
  onOpen,
  onRefresh,
  activePath,
}: {
  files: ChangedFile[];
  loading?: boolean;
  onOpen: (f: ChangedFile) => void;
  onRefresh?: () => void;
  activePath?: string | null;
}) {
  const [open, setOpen] = React.useState(true);
  if (!files.length && !loading) return null;
  const adds = files.reduce((a, f) => a + f.additions, 0);
  const dels = files.reduce((a, f) => a + f.deletions, 0);
  return (
    <div className="bg-card enter overflow-hidden rounded-xl border shadow-e1">
      <div className="flex items-center gap-2 px-3 py-2">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left">
          <ChevronDown className={cn("text-muted-foreground size-3.5 shrink-0 transition-transform", !open && "-rotate-90")} aria-hidden />
          <FileDiff className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
          <span className="text-foreground text-meta font-medium">
            {files.length} {files.length === 1 ? "file" : "files"} changed
          </span>
          <span className="stamp ml-1 flex items-center gap-1.5">
            {adds > 0 && <span className="text-ok">+{adds}</span>}
            {dels > 0 && <span className="text-destructive">−{dels}</span>}
          </span>
        </button>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            aria-label="Refresh changes"
            className="text-muted-foreground hover:text-foreground hover:bg-muted grid size-6 cursor-pointer place-items-center rounded-md"
          >
            <RefreshCw className={cn("size-3", loading && "animate-spin")} aria-hidden />
          </button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden border-t"
          >
            {files.map((f) => {
              const base = f.path.slice(f.path.lastIndexOf("/") + 1);
              const dir = f.path.slice(0, Math.max(0, f.path.lastIndexOf("/")));
              const active = activePath === f.path;
              return (
                <li key={f.path}>
                  <button
                    type="button"
                    onClick={() => onOpen(f)}
                    className={cn(
                      "hover:bg-muted flex w-full cursor-pointer items-center gap-2.5 px-3 py-1.5 text-left text-meta transition-colors",
                      active && "bg-accent"
                    )}
                  >
                    <FileMark path={f.path} />
                    <span className={cn("min-w-0 truncate font-mono", f.status === "deleted" ? "text-muted-foreground line-through" : "text-foreground")}>
                      {base}
                    </span>
                    {dir && <span className="stamp text-muted-foreground hidden min-w-0 truncate sm:inline">{dir}</span>}
                    <span className="stamp ml-auto flex shrink-0 items-center gap-1.5">
                      {f.status === "untracked" || f.status === "added" ? <span className="text-ok">new</span> : null}
                      {f.status === "renamed" && <span className="text-muted-foreground">renamed</span>}
                      {f.additions > 0 && <span className="text-ok">+{f.additions}</span>}
                      {f.deletions > 0 && <span className="text-destructive">−{f.deletions}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
