import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * Shown the moment you open a sleeping sandbox: the console has already asked the controller to
 * start the microVM, so this line narrates what is happening instead of asking you to type first.
 * It is set in the transcript's own voice — no box, no tint: a small monochrome pixel grid that
 * pulses while we wait, a title, the elapsed time, and one line of status that crossfades through
 * boot → restore → reconnect. When the box reports running it reads "Awake" and leaves.
 */
const STAGES = [
  { at: 0, text: "Starting the microVM" },
  { at: 4, text: "Restoring the workspace and the agent's session" },
  { at: 9, text: "Reconnecting the transcript" },
];

export function WakingCard({ awake, startedAt, error }: { awake: boolean; startedAt: number; error?: string | null }) {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, []);
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
  const stage = awake ? STAGES.length : Math.min(STAGES.length - 1, STAGES.filter((s) => elapsed >= s.at).length - 1);
  const status = error ? `${error} Sending a message retries.` : awake ? "Back. The transcript follows." : STAGES[stage].text;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="enter flex items-start gap-3.5 py-1"
      role="status"
      aria-live="polite"
    >
      <PixelGrid state={error ? "error" : awake ? "done" : "active"} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className={cn("text-body font-medium", error ? "text-destructive" : "text-foreground")}>{error ? "Could not wake the sandbox" : awake ? "Awake" : "Waking the sandbox"}</p>
          <span className="stamp text-muted-foreground tabular-nums">{elapsed}s</span>
        </div>
        <div className="relative mt-0.5 h-5 overflow-hidden">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.p
              key={status}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="text-muted-foreground absolute inset-x-0 top-0 truncate text-meta"
            >
              {status}
              {!awake && !error && <span className="dots" aria-hidden />}
            </motion.p>
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

/** 4×4 monochrome grid. Waiting: cells pulse in a diagonal wave. Done: all lit. Error: dim. */
function PixelGrid({ state }: { state: "active" | "done" | "error" }) {
  return (
    <div className="mt-1 grid size-6 shrink-0 grid-cols-4 gap-[2px]" aria-hidden>
      {Array.from({ length: 16 }, (_, i) => {
        const r = Math.floor(i / 4), c = i % 4;
        return (
          <span
            key={i}
            className={cn("block rounded-[1px]", state === "done" ? "bg-foreground/80" : state === "error" ? "bg-destructive/40" : "bg-foreground pixel-wave")}
            style={state === "active" ? { animationDelay: `${(r + c) * 110}ms` } : undefined}
          />
        );
      })}
    </div>
  );
}
