import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * Shown the moment you open a sleeping sandbox: the console has already asked the controller to
 * start the microVM, so this line narrates what is happening instead of asking you to type first.
 * The mark is a power ring in the product's live blue — a comet arc orbits while the machine boots,
 * the ring fills and a check draws when it is awake, and it dims to red on failure. Under the title,
 * a three-segment progress rail ticks through boot → restore → reconnect.
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
      <PowerRing state={error ? "error" : awake ? "done" : "active"} />
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
        {!error && (
          <div className="mt-1.5 flex w-40 items-center gap-1" aria-hidden>
            {STAGES.map((s, i) => (
              <span key={s.at} className="bg-live/15 h-[3px] flex-1 overflow-hidden rounded-full">
                <span
                  className={cn(
                    "bg-live block h-full rounded-full transition-transform duration-500 ease-out",
                    awake || stage > i ? "translate-x-0" : stage === i ? "wake-fill" : "-translate-x-full"
                  )}
                />
              </span>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

/**
 * The waking mark: a faint blue halo, a track ring, and a comet arc that orbits while booting.
 * Done: the ring completes in blue and a check draws in. Error: a broken ring in the alarm colour.
 */
function PowerRing({ state }: { state: "active" | "done" | "error" }) {
  const C = 2 * Math.PI * 9; // circumference of the r=9 ring
  return (
    <div className="relative mt-0.5 size-8 shrink-0" aria-hidden>
      {state === "active" && <span className="bg-live/20 absolute inset-0 rounded-full blur-[6px] wake-halo" />}
      <svg viewBox="0 0 24 24" fill="none" className="relative size-8">
        {/* track */}
        <circle cx="12" cy="12" r="9" strokeWidth="2" className={cn("stroke-current", state === "error" ? "text-destructive/25" : "text-live/20")} />
        {state === "active" && (
          <g className="wake-orbit origin-center">
            <circle cx="12" cy="12" r="9" strokeWidth="2" strokeLinecap="round" strokeDasharray={`${C * 0.28} ${C}`} className="text-live stroke-current" />
            <circle cx="12" cy="3" r="1.6" className="text-live fill-current" />
          </g>
        )}
        {state === "done" && (
          <>
            <circle cx="12" cy="12" r="9" strokeWidth="2" strokeLinecap="round" strokeDasharray={C} className="text-live wake-close stroke-current" style={{ transformOrigin: "center", transform: "rotate(-90deg)" }} />
            <path d="M8.4 12.2l2.5 2.5 4.7-5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="12" className="text-live wake-check stroke-current" />
          </>
        )}
        {state === "error" && (
          <>
            <circle cx="12" cy="12" r="9" strokeWidth="2" strokeLinecap="round" strokeDasharray={`${C * 0.82} ${C}`} className="text-destructive stroke-current" style={{ transformOrigin: "center", transform: "rotate(120deg)" }} />
            <path d="M12 8v5M12 16v.5" strokeWidth="2" strokeLinecap="round" className="text-destructive stroke-current" />
          </>
        )}
      </svg>
    </div>
  );
}
