import { AnimatePresence, motion } from "motion/react";
import { Check, Moon, RotateCw, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNow } from "@/hooks/useNow";

/**
 * Shown the moment you open a sleeping sandbox: the console has already asked the controller to
 * start the microVM, so this line narrates what is happening instead of asking you to type first.
 *
 * Same silhouette as the WorkingIndicator pill ("● ● ● Starting up  `detail`  7s"): three breathing
 * dots in the live blue, a bold label, the current boot stage as a quiet mono chip that crossfades
 * as it advances, and the elapsed seconds. Done swaps the dots for a check; stuck (45s) offers a
 * retry inside the pill; error dims to the alarm colour.
 *
 * A box on a host whose VM is paused (`slowHost`) is a different wait: the VM resumes first (20 s
 * to a minute, through the provider), then the sandbox inside it. The stages and the "taking
 * longer" threshold stretch to match, so the card never cries stuck at 45 s of a normal minute.
 */
const STAGES = [
  { at: 0, text: "starting the sandbox" },
  { at: 4, text: "restoring workspace + session" },
  { at: 9, text: "reconnecting the transcript" },
];
const HOST_STAGES = [
  { at: 0, text: "starting the host's VM" },
  { at: 15, text: "the VM is coming up" },
  { at: 45, text: "starting the sandbox" },
  { at: 60, text: "restoring workspace + session" },
  { at: 75, text: "reconnecting the transcript" },
];
/** An away thread (its box gone, a copy kept): a fresh machine is started and the copy put back. */
const COPY_STAGES = [
  { at: 0, text: "finding a host" },
  { at: 6, text: "starting a machine" },
  { at: 14, text: "putting the copy back" },
  { at: 30, text: "reconnecting the transcript" },
];
const STUCK_AT = 45;
const HOST_STUCK_AT = 150;
const COPY_STUCK_AT = 150;

export function WakingCard({
  awake,
  startedAt,
  error,
  onRetry,
  slowHost = false,
  fromCopy = false,
}: {
  awake: boolean;
  startedAt: number;
  error?: string | null;
  onRetry?: () => void;
  slowHost?: boolean;
  /** The machine is gone: it is being brought back from the kept copy (different stages and patience). */
  fromCopy?: boolean;
}) {
  const now = useNow(!awake && !error, 500);
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
  const stages = fromCopy ? COPY_STAGES : slowHost ? HOST_STAGES : STAGES;
  const stage = awake ? stages.length - 1 : Math.min(stages.length - 1, stages.filter((s) => elapsed >= s.at).length - 1);
  const stuck = !awake && !error && elapsed >= (fromCopy ? COPY_STUCK_AT : slowHost ? HOST_STUCK_AT : STUCK_AT);
  const label = error
    ? fromCopy
      ? "Could not bring the machine back"
      : "Could not wake the sandbox"
    : awake
      ? fromCopy
        ? "Back"
        : "Awake"
      : stuck
        ? "Taking longer than usual"
        : fromCopy
          ? "Bringing the machine back"
          : slowHost
            ? "Waking the host"
            : "Waking the sandbox";
  const detail = error ? null : awake ? (fromCopy ? "from the kept copy — the transcript follows" : "back — the transcript follows") : stuck ? null : stages[stage].text;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="flex items-center gap-2.5"
      role="status"
      aria-live="polite"
    >
      <div className="bg-card inline-flex max-w-full items-center gap-2.5 rounded-full border py-1.5 pr-3.5 pl-3 text-meta shadow-e1">
        <span className={cn("flex shrink-0 items-center gap-1", error ? "text-destructive" : stuck ? "text-attention-text" : "text-live")} aria-hidden>
          {awake && !error ? (
            <motion.span initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 420, damping: 22 }}>
              <Check className="size-3.5" strokeWidth={3} />
            </motion.span>
          ) : (
            <>
              <span className={cn("bg-current size-1.5 rounded-full", !error && !stuck && "dot dot-1")} />
              <span className={cn("bg-current size-1.5 rounded-full", !error && !stuck && "dot dot-2")} />
              <span className={cn("bg-current size-1.5 rounded-full", !error && !stuck && "dot dot-3")} />
            </>
          )}
        </span>
        <span className={cn("shrink-0 font-medium", error ? "text-destructive" : stuck ? "text-attention-text" : "text-foreground")}>{label}</span>
        <AnimatePresence mode="popLayout" initial={false}>
          {detail && (
            <motion.code
              key={detail}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="text-muted-foreground bg-muted min-w-0 truncate rounded px-1.5 py-0.5 font-mono text-micro"
            >
              {detail}
            </motion.code>
          )}
        </AnimatePresence>
        {error && <span className="text-muted-foreground min-w-0 truncate text-micro">{error} Sending a message retries.</span>}
        {!awake && !error && (
          <span className="text-faint shrink-0 text-micro tabular-nums" aria-hidden>
            {elapsed}s
          </span>
        )}
        {stuck && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="bg-live/10 text-live hover:bg-live/20 -mr-1 flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-full px-2 text-micro font-semibold transition-colors"
          >
            <RotateCw className="size-3" aria-hidden />
            Retry
          </button>
        )}
      </div>
    </motion.div>
  );
}

/**
 * The counterpart for a box the operator put to sleep on purpose: the same pill, resting. No dots,
 * no timer — a moon, one line, and a Wake action. Rendering the "Waking…" pill here would either
 * lie (nothing is waking) or force the auto-wake to bounce the box straight back up.
 */
export function SleepingCard({ onWake, absent = false }: { onWake: () => void; absent?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="flex items-center gap-2.5"
      role="status"
    >
      <div className="bg-card inline-flex max-w-full items-center gap-2.5 rounded-full border py-1.5 pr-2 pl-3 text-meta shadow-e1">
        <Moon className="text-sleep size-3.5 shrink-0" aria-hidden />
        <span className="text-foreground shrink-0 font-medium">{absent ? "Away" : "Asleep"}</span>
        <span className="text-muted-foreground min-w-0 truncate text-micro">workspace and session kept</span>
        <button
          type="button"
          onClick={onWake}
          className="bg-live/10 text-live hover:bg-live/20 flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-full px-2 text-micro font-semibold transition-colors"
        >
          <Sun className="size-3" aria-hidden />
          Wake
        </button>
      </div>
    </motion.div>
  );
}
