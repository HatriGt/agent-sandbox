import * as React from "react";
import { Loader2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { api } from "@/lib/api";
import { splitUnifiedDiff, type DiffSection } from "@/lib/diff";
import { useReducedMotion } from "@/lib/motion-pref";
import { FileMark } from "@/lib/fileIcon";
import { cn } from "@/lib/utils";
import { DiffView, FileReviewBar, useHunkReview } from "../FilePane";

/**
 * The whole run's diff in one scroll — the review moment between "run finished" and "do I trust
 * this". Lives in the workspace pane's editor group as the Review view (beside Source control, which
 * doubles as its file list); History renders it directly, read-only, for a finished run's stored
 * diff. Fed either live (/rundiff.json, box still up) or from the archive (history rows carry
 * diffText after teardown). One concatenated multi-file unified diff in, per-file DiffViews out
 * (splitUnifiedDiff lives in lib/diff so the node suite covers it). Live, each file carries the
 * accept / reject controls (per hunk, and whole file).
 */

const EASE = [0.22, 1, 0.36, 1] as const;

export function useRunDiff(session: string | undefined, archivedDiff: string | undefined, nonce = 0) {
  const [files, setFiles] = React.useState<DiffSection[] | null>(archivedDiff !== undefined ? splitUnifiedDiff(archivedDiff) : null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (archivedDiff !== undefined) {
      setFiles(splitUnifiedDiff(archivedDiff));
      return;
    }
    if (!session) return;
    const ctl = new AbortController();
    setError(null);
    api
      .runDiff(session, ctl.signal)
      .then((r) => setFiles(splitUnifiedDiff(r.diff)))
      .catch((e) => {
        if (!ctl.signal.aborted) setError(e instanceof Error ? e.message : "could not load the diff");
      });
    return () => ctl.abort();
  }, [session, archivedDiff, nonce]);
  const dropFile = React.useCallback((path: string) => setFiles((prev) => prev?.filter((f) => f.path !== path) ?? prev), []);
  return { files, error, dropFile };
}

/** Which file section to scroll to — a new object each time so a repeat click still navigates. */
export type ReviewFocus = { path: string; nonce: number };

export function ReviewView({
  session,
  archivedDiff,
  focus,
  onFiles,
  className,
}: {
  /** Live box to fetch from; ignored when archivedDiff is given. */
  session?: string;
  /** A finished run's stored diff (history detail). */
  archivedDiff?: string;
  /** Scroll the named file's section into view. */
  focus?: ReviewFocus | null;
  /** The paths in the loaded diff, for a caller that wants to mark them (the Source control tree). */
  onFiles?: (paths: string[] | null) => void;
  className?: string;
}) {
  const { files, error, dropFile } = useRunDiff(archivedDiff === undefined ? session : undefined, archivedDiff);
  const live = archivedDiff === undefined ? session : undefined;
  const still = useReducedMotion();
  const ref = React.useRef<HTMLDivElement>(null);
  const onFilesRef = React.useRef(onFiles);
  onFilesRef.current = onFiles;
  React.useEffect(() => {
    onFilesRef.current?.(files ? files.map((f) => f.path) : null);
  }, [files]);
  React.useEffect(() => {
    if (!focus || !ref.current) return;
    const el = ref.current.querySelector<HTMLElement>(`[data-review-file="${CSS.escape(focus.path)}"]`);
    el?.scrollIntoView({ block: "start", behavior: still ? "instant" : "smooth" });
  }, [focus, still]);

  const adds = files?.reduce((a, f) => a + f.diff.additions, 0) ?? 0;
  const dels = files?.reduce((a, f) => a + f.diff.deletions, 0) ?? 0;

  return (
    <div ref={ref} className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3">
        <span className="text-foreground text-meta font-medium">Review changes</span>
        {files && (
          <span className="stamp text-muted-foreground flex items-center gap-1.5 tabular-nums">
            {files.length} {files.length === 1 ? "file" : "files"}
            {adds > 0 && <span className="text-ok">+{adds}</span>}
            {dels > 0 && <span className="text-destructive">−{dels}</span>}
          </span>
        )}
        {live && files && files.length > 0 && <span className="text-faint ml-auto hidden text-micro lg:inline">j / k between hunks · ⌘↵ accept · ⌘⌫ reject</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {error && <p className="text-destructive px-4 py-6 text-meta">{error}</p>}
        {!error && files === null && (
          <p className="text-muted-foreground flex items-center gap-2 px-4 py-6 text-meta">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Loading the diff…
          </p>
        )}
        {files?.length === 0 && <p className="text-muted-foreground px-4 py-6 text-meta">No changes against HEAD.</p>}
        <AnimatePresence initial={false}>
          {files?.map((f) => (
            <motion.div key={f.path} className="overflow-hidden" exit={still ? { opacity: 0 } : { height: 0, opacity: 0 }} transition={{ duration: still ? 0.12 : 0.26, ease: EASE }}>
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
  const base = file.path.slice(file.path.lastIndexOf("/") + 1);
  const dir = file.path.slice(0, Math.max(0, file.path.lastIndexOf("/")));
  return (
    <section aria-label={file.path} data-review-file={file.path} className="scroll-mt-0">
      <div className="bg-card/90 sticky top-0 z-30 flex h-9 items-center gap-2 border-b px-3 backdrop-blur">
        <FileMark path={file.path} />
        <span className="flex min-w-0 items-baseline gap-1.5 truncate font-mono text-meta">
          <span className="text-foreground">{base}</span>
          {dir && <span className="stamp text-muted-foreground truncate">{dir}</span>}
        </span>
        <span className="stamp flex shrink-0 items-center gap-1.5 tabular-nums">
          {file.diff.additions > 0 && <span className="text-ok">+{file.diff.additions}</span>}
          {file.diff.deletions > 0 && <span className="text-destructive">−{file.diff.deletions}</span>}
        </span>
        {review && <FileReviewBar review={review} className="ml-auto" />}
      </div>
      <DiffView diff={file.diff} path={file.path} review={review} />
    </section>
  );
}
