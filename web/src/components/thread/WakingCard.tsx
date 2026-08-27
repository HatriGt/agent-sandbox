import * as React from "react";
import { Check, MoonStar } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * Shown the moment you open a sleeping sandbox: the console has already asked the controller to
 * start the microVM, so this card narrates what is happening instead of asking you to type first.
 * A 5×5 pixel grid breathes while we wait (the reference "Loading State" pattern), the elapsed time
 * ticks, and three stages light up — boot, restore, reconnect — the last flips when the live
 * transcript arrives and the card leaves.
 */
const STAGES = [
  { at: 0, label: "Starting the microVM", hint: "msb start — a few seconds" },
  { at: 4, label: "Restoring workspace and session", hint: "files, git state and the Claude session are intact" },
  { at: 9, label: "Reconnecting the transcript", hint: "tailing the agent log again" },
];

export function WakingCard({ awake, startedAt, error }: { awake: boolean; startedAt: number; error?: string | null }) {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, []);
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
  const stage = awake ? STAGES.length : Math.min(STAGES.length - 1, STAGES.filter((s) => elapsed >= s.at).length - 1);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className={cn("enter flex items-start gap-4 rounded-xl border px-4 py-3.5", error ? "border-destructive/30 bg-destructive/6" : "border-sleep/30 bg-sleep/8")}
      role="status"
      aria-live="polite"
    >
      <PixelGrid active={!awake && !error} done={awake} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className="text-foreground text-body font-medium">{error ? "Could not wake the sandbox" : awake ? "Awake" : "Waking the sandbox"}</p>
          <span className="stamp text-muted-foreground tabular-nums">{elapsed}s</span>
        </div>
        {error ? (
          <p className="text-muted-foreground mt-1 text-meta">{error} Sending a message retries.</p>
        ) : (
          <ol className="mt-2 flex flex-col gap-1">
            {STAGES.map((s, i) => {
              const done = awake || i < stage;
              const current = !awake && i === stage;
              return (
                <li key={s.label} className={cn("flex items-center gap-2 text-meta transition-colors", done ? "text-muted-foreground" : current ? "text-foreground" : "text-muted-foreground/50")}>
                  <span className={cn("grid size-4 shrink-0 place-items-center rounded-full border", done ? "border-sleep/40 bg-sleep/15 text-sleep" : current ? "border-sleep text-sleep" : "border-border")}>
                    {done ? <Check className="size-2.5" strokeWidth={3} aria-hidden /> : current ? <span className="bg-sleep size-1.5 animate-pulse rounded-full" /> : null}
                  </span>
                  <span className={cn(done && "line-through decoration-sleep/40")}>{s.label}</span>
                  {current && <span className="stamp text-muted-foreground hidden sm:inline">· {s.hint}</span>}
                </li>
              );
            })}
          </ol>
        )}
      </div>
      <MoonStar className={cn("text-sleep mt-0.5 size-4 shrink-0", !awake && !error && "animate-pulse")} aria-hidden />
    </motion.div>
  );
}

/** 5×5 grid of cells lighting in a diagonal wave — the waiting texture; solid when done. */
function PixelGrid({ active, done }: { active: boolean; done: boolean }) {
  return (
    <div className="grid size-10 shrink-0 grid-cols-5 gap-[2px]" aria-hidden>
      {Array.from({ length: 25 }, (_, i) => {
        const r = Math.floor(i / 5), c = i % 5;
        return (
          <span
            key={i}
            className={cn("bg-sleep block rounded-[1.5px]", done ? "opacity-70" : active ? "pixel-wave" : "opacity-25")}
            style={active && !done ? { animationDelay: `${(r + c) * 90}ms` } : undefined}
          />
        );
      })}
    </div>
  );
}
