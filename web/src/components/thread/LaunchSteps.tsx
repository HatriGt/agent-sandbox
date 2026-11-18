import * as React from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { cn } from "@/lib/utils";
import { friendlyName } from "@/lib/format";
import { launchKind, launchRows, stuckAfterMs, type LaunchRow } from "@/lib/launch";
import { useLaunch } from "@/hooks/useLaunch";
import { useNow } from "@/hooks/useNow";
import { useReducedMotion } from "@/lib/motion-pref";
import { Swap } from "@/components/ui/swap";
import { Collapse } from "@/components/ui/collapse";
import { NumberTicker } from "@/components/ui/number-ticker";

/**
 * The agent's side of the conversation before it has said anything: a tonal card that narrates
 * the launch as it happens — the request leaving, access resolved, the host picked, a repo cloned,
 * a warm sandbox claimed or a fresh one booted, the agent started, the wait for its first words.
 * Each row is a real stage the controller reported the moment it began (src/launch-progress.ts);
 * nothing here is a timer pretending to be progress.
 *
 * Motion, all time-driven and all from the shared vocabulary (web/DESIGN.md, Motion): the bubble
 * springs in once; a row rises in as it arrives and the rest keep their place (`layout="position"`);
 * a live wash glides to the current row (`layoutId`); the current row's mark is the power ring —
 * a comet arc orbiting a breathing halo — which, when the stage ends, closes into a full ring and a
 * check draws inside it; one ink rail springs down the list to the ring that is still open; the
 * current label shimmers; the stage's subject (repo, host, box) is a mono chip; the seconds lift in
 * one by one; an overrun note and the failure reason unfold. Done rows settle into muted ink at the
 * same weight, so no word ever reflows. Under reduced motion only the fades remain.
 */
const EASE = [0.22, 1, 0.36, 1] as const;
const RAIL_SPRING = { type: "spring", stiffness: 220, damping: 30 } as const;
/** Half the mark's box, px: the rail runs between rings, never through them. */
const RING = 8;
/** Launch ids whose bubble has already sprung in — the BootingThread → Thread remount must not replay it. */
const entered = new Set<string>();

export function LaunchBubble({ launchId, machine, className }: { launchId?: string; machine?: string; className?: string }) {
  const feed = useLaunch(launchId);
  // A pane that opened without a feed (a refresh mid-boot) still narrates from what it knows.
  const [mountedAt] = React.useState(() => Date.now());
  const now = useNow(true, 1000);
  const rows = launchRows(feed?.steps ?? [], { sentAt: feed?.sentAt ?? mountedAt, machine: machine ? friendlyName(machine) : undefined, now });
  const active = rows.find((r) => r.state === "active");
  const failed = rows.find((r) => r.state === "failed");
  const current = active ?? failed;
  const stuck = !!active && now - active.at >= stuckAfterMs(active);
  const still = useReducedMotion();
  const name = machine ? friendlyName(machine) : "Agent Sandbox";
  const [spring] = React.useState(() => {
    const id = launchId ?? "launch";
    if (entered.has(id)) return false;
    entered.add(id);
    return true;
  });

  // The rail: measured from the rows' real positions after each commit, animated to the open ring.
  const listRef = React.useRef<HTMLOListElement>(null);
  const [rail, setRail] = React.useState<{ top: number; height: number; ink: number } | null>(null);
  const currentKey = current?.key;
  const count = rows.length;
  React.useLayoutEffect(() => {
    const ol = listRef.current;
    if (!ol) return;
    const lis = Array.from(ol.querySelectorAll<HTMLLIElement>(":scope > li"));
    if (lis.length < 2) {
      setRail(null);
      return;
    }
    const mid = (li: HTMLLIElement) => li.offsetTop + li.offsetHeight / 2;
    const first = mid(lis[0]);
    const last = mid(lis[lis.length - 1]);
    const idx = lis.findIndex((li) => li.dataset.key === currentKey);
    const to = idx === -1 ? last : mid(lis[idx]);
    setRail({ top: first + RING, height: Math.max(0, last - first - 2 * RING), ink: Math.max(0, to - first - 2 * RING) });
  }, [count, currentKey]);

  return (
    <div className={cn("flex flex-col gap-1.5", spring && !still && "card-spring", className)} role="status" aria-live="polite" aria-label="Starting the run" data-launch-steps>
      <span className="label text-muted-foreground flex items-center gap-1.5 pl-1">
        <span className={cn("size-1.5 rounded-full transition-colors duration-500", failed ? "bg-destructive" : "bg-live breathe")} aria-hidden />
        <Swap state={name} mode="popLayout" y={3}>
          {name}
        </Swap>
      </span>
      <div className="viz-card w-full max-w-[min(100%,34rem)] rounded-2xl rounded-tl-md px-4 py-3">
        <LayoutGroup id={launchId ?? "launch"}>
          <ol ref={listRef} className="relative flex flex-col">
            {rail && (
              <>
                <motion.span className="bg-foreground/10 absolute left-[7.5px] w-px" initial={false} animate={{ top: rail.top, height: rail.height }} transition={still ? { duration: 0 } : RAIL_SPRING} aria-hidden />
                <motion.span className="bg-foreground/35 absolute left-[7.5px] w-px" initial={false} animate={{ top: rail.top, height: rail.ink }} transition={still ? { duration: 0 } : RAIL_SPRING} aria-hidden />
              </>
            )}
            <AnimatePresence initial={false}>
              {rows.map((r) => {
                const { text, chip } = wording(r);
                return (
                  <motion.li
                    key={r.key}
                    data-key={r.key}
                    layout="position"
                    initial={still ? { opacity: 0 } : { opacity: 0, y: 8, filter: "blur(2px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    transition={{ duration: still ? 0.12 : 0.28, ease: EASE, layout: { type: "spring", stiffness: 420, damping: 38 } }}
                    className="relative flex min-w-0 items-center gap-3 py-1 text-meta"
                  >
                    {/* The live wash: one element that glides to whichever row is current. */}
                    {r.state === "active" && !still && (
                      <motion.span layoutId="launch-active" transition={{ type: "spring", stiffness: 380, damping: 36 }} className="bg-live/8 absolute -inset-x-2 inset-y-0 rounded-lg" aria-hidden />
                    )}
                    <RowMark row={r} still={still} draw={!still && r.state === "done" && r.at + (r.took ?? 0) > mountedAt} />
                    <span className="relative flex min-w-0 flex-1 items-center gap-1.5">
                      <Swap state={r.state} mode="popLayout" y={3} className="truncate">
                        <span
                          className={cn(
                            r.state === "active"
                              ? still
                                ? "text-foreground"
                                : "shimmer-text [--shim-dim:color-mix(in_oklch,var(--foreground)_72%,transparent)] [--shim-hi:var(--foreground)]"
                              : r.state === "failed"
                                ? "text-destructive"
                                : "text-muted-foreground"
                          )}
                        >
                          {text}
                        </span>
                      </Swap>
                      {chip && (
                        <motion.code
                          initial={still ? { opacity: 0 } : { opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.24, ease: EASE, delay: 0.08 }}
                          className="bg-foreground/6 text-muted-foreground min-w-0 shrink truncate rounded px-1.5 py-px font-mono text-micro"
                        >
                          {chip}
                        </motion.code>
                      )}
                    </span>
                    <span className="stamp text-faint relative flex h-4 shrink-0 items-center overflow-hidden" aria-hidden>
                      {r.state === "active" ? (
                        // Counted from the second second: a stage that is over in a blink never shows a number.
                        <Swap state={Math.max(0, Math.floor((now - r.at) / 1000))} mode="popLayout" y={6}>
                          {now - r.at >= 1000 ? `${Math.floor((now - r.at) / 1000)}s` : ""}
                        </Swap>
                      ) : r.state === "done" && r.took !== undefined && r.took >= 1000 ? (
                        <motion.span initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE, delay: 0.3 }}>
                          {Math.round(r.took / 1000)}s
                        </motion.span>
                      ) : null}
                    </span>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ol>
        </LayoutGroup>
        <Collapse open={!!failed && !!failed.detail}>
          <p className="text-muted-foreground pt-2 pl-7 text-micro">{failed?.detail}</p>
        </Collapse>
        <Collapse open={stuck}>
          <p className="text-attention-text pt-2 pl-7 text-micro">Taking longer than usual. The run carries on; this page follows it.</p>
        </Collapse>
      </div>
    </div>
  );
}

/** The row's words: the stage, and its subject as a chip when the stage has one (a repo, a host, the box). */
function wording(r: LaunchRow): { text: string; chip?: string } {
  if (!r.detail || r.state === "failed") return { text: r.label };
  if (r.phase === "clone") return { text: "Cloning", chip: r.detail };
  if (r.phase === "host") return { text: "Waking the host", chip: r.detail };
  if (r.phase === "started") return { text: "Agent started", chip: friendlyName(r.detail) };
  return { text: r.label };
}

/**
 * The mark at the head of a row: the power ring. While the stage runs a comet arc orbits a
 * breathing halo in the live colour; when it ends the ring closes in ink and a check draws inside;
 * on failure the ring turns to the alarm colour around a cross. `draw` is false for a row that was
 * already done when this bubble mounted (a remount must not redraw every check).
 */
function RowMark({ row, still, draw }: { row: LaunchRow; still: boolean; draw: boolean }) {
  const state = row.state;
  return (
    <span className="relative size-4 shrink-0" aria-hidden>
      <svg viewBox="0 0 24 24" className="absolute inset-0 size-4 overflow-visible">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" className={cn("transition-colors duration-500", state === "failed" ? "text-destructive/30" : "text-foreground/12")} />
        <AnimatePresence initial={false}>
          {state === "active" && (
            <motion.g key="orbit" className="text-live" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: EASE }}>
              {/* The halo breathes between 50% and 100% of its own opacity, so the group holds it at 15%. */}
              <g className="opacity-15">
                <circle cx="12" cy="12" r="11" className={cn("origin-center fill-current [transform-box:fill-box]", !still && "wake-halo")} />
              </g>
              <g className={cn("origin-center [transform-box:fill-box]", !still && "wake-orbit")}>
                <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="18 38.5" />
              </g>
            </motion.g>
          )}
          {state === "done" && (
            <motion.g key="done" className="text-foreground" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              {/* The ring closes from twelve o'clock, then the check lands. */}
              <motion.path
                d="M12 3 a9 9 0 1 1 -0.01 0"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                className="opacity-35"
                initial={draw ? { pathLength: 0 } : { pathLength: 1 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.45, ease: EASE }}
              />
              <motion.path
                d="M8 12.5 L11 15.5 L16.5 9"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="opacity-80"
                initial={draw ? { pathLength: 0 } : { pathLength: 1 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.3, ease: EASE, delay: 0.3 }}
              />
            </motion.g>
          )}
          {state === "failed" && (
            <motion.g key="failed" className="text-destructive" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: EASE }} style={{ transformOrigin: "center" }}>
              <path d="M9 9 L15 15 M15 9 L9 15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </motion.g>
          )}
        </AnimatePresence>
      </svg>
    </span>
  );
}

/**
 * The one-line receipt once the transcript has taken over: how long the launch took and on what.
 * Unfolds into place under the task, the seconds counting up. Only for the tab that pressed Send
 * (the feed lives in this tab), so a reopened thread never shows a receipt it cannot vouch for.
 */
export function LaunchReceipt({ launchId }: { launchId?: string }) {
  const feed = useLaunch(launchId);
  const still = useReducedMotion();
  const started = feed?.done ? feed.steps.find((s) => s.phase === "started") : undefined;
  const secs = feed && started ? Math.max(1, Math.round((started.at - feed.sentAt) / 1000)) : 0;
  const kind = feed ? launchKind(feed.steps) : undefined;
  return (
    <Collapse open={!!started}>
      <div className="flex items-center gap-3 py-0.5" data-launch-receipt>
        <span className="label text-muted-foreground inline-flex shrink-0 items-center gap-1.5">
          <svg viewBox="0 0 14 14" className="size-3" aria-hidden>
            <motion.path d="M2.5 7.5 L5.5 10.5 L11.5 3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" initial={still ? { pathLength: 1 } : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.4, ease: EASE, delay: 0.2 }} />
          </svg>
          <span>
            Started in <NumberTicker value={secs} from={0} className="text-foreground" />s{kind ? ` on a ${kind === "warm" ? "warm" : "fresh"} sandbox` : ""}
          </span>
        </span>
        <span className={cn("bg-border h-px flex-1", !still && "rule-draw")} aria-hidden />
      </div>
    </Collapse>
  );
}
