import * as React from "react";
import { ChevronUp, RefreshCw } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ChangedFile } from "@/lib/api";
import { FileMark } from "@/lib/fileIcon";
import { cn } from "@/lib/utils";

/**
 * The changed-files summary, docked above the composer where the run's output belongs — not inside
 * the conversation. Collapsed: one bar with the first few file marks, "N files changed", totals and
 * a chevron. Expanded: the list rises out of the bar (scrollable), each row a file with its mark,
 * path and counts; click opens the file pane. The dock stays put while the conversation scrolls.
 */
/** The count rolls when it changes — a file landing mid-run is visible even in peripheral vision. */
function PopCount({ value }: { value: number }) {
  return (
    <span className="relative inline-grid overflow-hidden text-center align-bottom" style={{ minWidth: "1ch", height: "1.2em" }}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={value}
          initial={{ y: "0.9em", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "-0.9em", opacity: 0 }}
          transition={{ type: "spring", stiffness: 460, damping: 34 }}
          className="tabular-nums"
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export function ChangesDock({ files, loading, onOpen, onRefresh, activePath }: { files: ChangedFile[]; loading?: boolean; onOpen: (f: ChangedFile) => void; onRefresh?: () => void; activePath?: string | null }) {
  const [open, setOpen] = React.useState(false);
  if (!files.length) return null;
  const adds = files.reduce((a, f) => a + f.additions, 0);
  const dels = files.reduce((a, f) => a + f.deletions, 0);
  return (
    <div className="mx-auto w-full max-w-3xl px-3 md:px-6">
      <div className="bg-card raised overflow-hidden rounded-xl">
        <AnimatePresence initial={false}>
          {open && (
            <motion.ul
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="max-h-64 overflow-y-auto border-b"
            >
              {files.map((f) => {
                const base = f.path.slice(f.path.lastIndexOf("/") + 1);
                const dir = f.path.slice(0, Math.max(0, f.path.lastIndexOf("/")));
                return (
                  <li key={f.path}>
                    <button
                      type="button"
                      onClick={() => onOpen(f)}
                      className={cn("hover:bg-muted flex w-full cursor-pointer items-center gap-2.5 px-3 py-1.5 text-left text-meta transition-colors", activePath === f.path && "bg-accent")}
                    >
                      <FileMark path={f.path} />
                      <span className={cn("min-w-0 truncate font-mono", f.status === "deleted" ? "text-muted-foreground line-through" : "text-foreground")}>{base}</span>
                      {dir && <span className="stamp text-muted-foreground hidden min-w-0 truncate sm:inline">{dir}</span>}
                      <span className="stamp ml-auto flex shrink-0 items-center gap-1.5">
                        {(f.status === "untracked" || f.status === "added") && <span className="text-ok">new</span>}
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
        <div className="flex items-center gap-2 px-3 py-2">
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-left">
            <span className="flex -space-x-1">
              {files.slice(0, 4).map((f) => (
                <FileMark key={f.path} path={f.path} className="ring-card ring-2" />
              ))}
            </span>
            <span className="text-foreground text-meta font-medium">
              <PopCount value={files.length} /> {files.length === 1 ? "file" : "files"} changed
            </span>
            <span className="stamp flex items-center gap-1.5">
              {adds > 0 && <span className="text-ok">+{adds}</span>}
              {dels > 0 && <span className="text-destructive">−{dels}</span>}
              {adds + dels > 0 && (
                <span className="bg-muted flex h-1 w-10 overflow-hidden rounded-full" aria-hidden>
                  <span className="bg-ok h-full transition-[width] duration-300" style={{ width: `${(adds / (adds + dels)) * 100}%` }} />
                  <span className="bg-destructive/80 h-full flex-1 transition-[width] duration-300" />
                </span>
              )}
            </span>
            <span className="text-muted-foreground ml-auto hidden text-micro sm:inline">{open ? "Hide files" : "Show files"}</span>
            <ChevronUp className={cn("text-muted-foreground size-3.5 shrink-0 transition-transform", open && "rotate-180")} aria-hidden />
          </button>
          {onRefresh && (
            <button type="button" onClick={onRefresh} aria-label="Refresh changes" className="text-muted-foreground hover:text-foreground hover:bg-muted grid size-6 cursor-pointer place-items-center rounded-md">
              <RefreshCw className={cn("size-3", loading && "animate-spin")} aria-hidden />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
