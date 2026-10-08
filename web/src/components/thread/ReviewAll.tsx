import { X } from "lucide-react";
import { ReviewView } from "./review/ReviewView";

/**
 * ReviewView in a closable card: every changed file's diff in one scroll. Thread shows it as a
 * drawer over a live run (`session`); History shows a finished run's stored diff (`archivedDiff`),
 * where there is no box to fetch from.
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
  return (
    <div className="bg-card raised relative flex max-h-[70vh] flex-col overflow-hidden rounded-xl">
      <ReviewView session={session} archivedDiff={archivedDiff} />
      <button
        type="button"
        onClick={onClose}
        aria-label="Close review"
        className="text-muted-foreground hover:text-foreground hover:bg-muted absolute top-1.5 right-2 z-40 grid size-6 cursor-pointer place-items-center rounded-md"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
