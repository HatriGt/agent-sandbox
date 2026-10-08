import * as React from "react";
import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { api } from "@/lib/api";
import { splitUnifiedDiff, type DiffSection } from "@/lib/diff";
import { useReducedMotion } from "@/lib/motion-pref";
import { FileMark } from "@/lib/fileIcon";
import { DiffView, FileReviewBar, useHunkReview } from "./FilePane";

/**
 * The whole run's diff in one scroll — the review moment between "run finished" and "do I trust
 * this". Fed either live (/rundiff.json, box still up) or from the archive (history rows carry
 * diffText after teardown). One concatenated multi-file unified diff in, per-file DiffViews out
 * (splitUnifiedDiff lives in lib/diff so the node suite covers it). Live, each file section carries
 * the accept / reject controls (per hunk, and for the whole file); archived, it is read-only.
 */

export function ReviewAllPane({
  session,
  archivedDiff,
  onClose,
}: {
  /** Live box to fetch from; ignored when archivedDiff is given. */
  session?: string;
  /** A finished run's stored diff (history detail). */
  archivedDiff?: string;
  onClose: () => void;
}) {
  const [files, setFiles] = React.useState<DiffSection[] | null>(archivedDiff !== undefined ? splitUnifiedDiff(archivedDiff) : null);
  const [error, setError] = React.useState<string | null>(null);
  const still = useReducedMotion();
  React.useEffect(() => {
    if (archivedDiff !== undefined || !session) return;
    const ctl = new AbortController();
    api
      .runDiff(session, ctl.signal)
      .then((r) => setFiles(splitUnifiedDiff(r.diff)))
      .catch((e) => {
        if (!ctl.signal.aborted) setError(e instanceof Error ? e.message : "could not load the diff");
      });
    return () => ctl.abort();
  }, [session, archivedDiff]);
  const live = archivedDiff === undefined ? session : undefined;
  const dropFile = React.useCallback((path: string) => setFiles((prev) => prev?.filter((f) => f.path !== path) ?? prev), []);

  return (
    <div className="bg-card raised flex max-h-[70vh] flex-col overflow-hidden rounded-xl">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className="text-foreground text-meta font-medium">Review changes</span>
        {files && (
          <span className="stamp text-muted-foreground">
            {files.length} {files.length === 1 ? "file" : "files"}
          </span>
        )}
        <button type="button" onClick={onClose} aria-label="Close review" className="text-muted-foreground hover:text-foreground ml-auto grid size-6 cursor-pointer place-items-center rounded-md">
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      <div className="min-h-0 overflow-y-auto">
        {error && <p className="text-destructive px-4 py-6 text-meta">{error}</p>}
        {!error && files === null && <p className="text-muted-foreground px-4 py-6 text-meta">Loading the diff…</p>}
        {files?.length === 0 && <p className="text-muted-foreground px-4 py-6 text-meta">No changes against HEAD.</p>}
        <AnimatePresence initial={false}>
          {files?.map((f) => (
            <motion.div
              key={f.path}
              className="overflow-hidden"
              exit={still ? { opacity: 0 } : { height: 0, opacity: 0 }}
              transition={{ duration: still ? 0.12 : 0.26, ease: [0.22, 1, 0.36, 1] }}
            >
              <ReviewFileSection file={f} session={live} onFileReverted={dropFile} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** One file of the run's diff: sticky path header (with the per-file review controls when live), then its hunks. */
function ReviewFileSection({ file, session, onFileReverted }: { file: DiffSection; session?: string; onFileReverted: (path: string) => void }) {
  // The run diff comes from `git add -N` + `git diff HEAD`, so a new file shows as one all-added
  // hunk; its only reject grain is the file (the server deletes it either way).
  const whole = file.diff.hunks.length === 1 && file.diff.hunks[0].lines.every((l) => l.kind === "add");
  const review = useHunkReview(session, file.path, file.diff, {
    whole,
    onDiscarded: (_files, scope) => {
      if (scope === "file") onFileReverted(file.path);
    },
  });
  return (
    <section aria-label={file.path}>
      <div className="bg-muted/80 sticky top-0 z-30 flex items-center gap-2 border-y px-3 py-1.5 backdrop-blur">
        <FileMark path={file.path} />
        <span className="text-foreground min-w-0 truncate font-mono text-micro">{file.path}</span>
        {review && <FileReviewBar review={review} className="ml-auto" />}
      </div>
      <DiffView diff={file.diff} path={file.path} review={review} />
    </section>
  );
}
