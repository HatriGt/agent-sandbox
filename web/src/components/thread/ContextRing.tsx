import * as React from "react";
import { Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CONTEXT_PARTS, fmtK, type ContextBreakdown, type ContextHealth } from "@/lib/context-health";
import { useReducedMotion } from "@/lib/motion-pref";
import { cn } from "@/lib/utils";

/** What the composer's context ring needs from the thread (Thread.tsx builds it). */
export interface ContextStatus {
  health: ContextHealth;
  /** What fills the window (newer Claude Code logs); null when the log cannot say. */
  breakdown: ContextBreakdown | null;
  /** Compactions this thread finished, oldest first. */
  compactions: { preTokens?: number; postTokens?: number }[];
  /** This thread's agent takes `/compact` (Claude Code). */
  canCompact: boolean;
  /** A compaction is sent, queued or underway. */
  pending: boolean;
  /** A turn is running, so a compaction waits for it to end. */
  running: boolean;
  onCompact: () => void;
}

const tone = (h: ContextHealth) => (h.level === "critical" ? "text-destructive" : h.level === "high" ? "text-warn" : "text-foreground/70");
const fill = (h: ContextHealth) => (h.level === "critical" ? "bg-destructive" : h.level === "high" ? "bg-warn" : "bg-foreground/70");

/** A ring that fills with the context window; the auto-compact point is a notch in the track. */
function Ring({ health, size = 18, stroke = 2.25 }: { health: ContextHealth; size?: number; stroke?: number }) {
  const still = useReducedMotion();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const at = health.compactAt !== undefined ? health.compactAt / health.window : undefined;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={cn("-rotate-90", tone(health))} aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.16} strokeWidth={stroke} />
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        initial={false}
        animate={{ strokeDashoffset: c * (1 - Math.max(health.fraction, 0.03)) }}
        transition={still ? { duration: 0 } : { type: "spring", stiffness: 120, damping: 22 }}
      />
      {at !== undefined && at < 1 && (
        <line
          x1={size / 2 + (r - stroke) * Math.cos(at * 2 * Math.PI)}
          y1={size / 2 + (r - stroke) * Math.sin(at * 2 * Math.PI)}
          x2={size / 2 + (r + stroke) * Math.cos(at * 2 * Math.PI)}
          y2={size / 2 + (r + stroke) * Math.sin(at * 2 * Math.PI)}
          className="stroke-background"
          strokeWidth={1.25}
        />
      )}
    </svg>
  );
}

/**
 * The context window, at a glance, in the composer: a ring that fills as the agent's context grows
 * (amber when high, red when nearly full). Clicking it opens the numbers and a Compact button.
 */
export function ContextRing({ status }: { status: ContextStatus }) {
  const { health, breakdown, compactions, canCompact, pending, running, onCompact } = status;
  const [open, setOpen] = React.useState(false);
  const pct = Math.round(health.fraction * 100);
  const last = compactions[compactions.length - 1];
  const left = Math.max(0, health.window - health.tokens);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`Context window: ${health.label}`}
              className={cn(
                "relative grid size-8 shrink-0 cursor-pointer place-items-center rounded-full outline-none",
                "transition-[background-color,scale] duration-150 ease-out hover:bg-muted active:scale-[0.94] focus-visible:ring-live/50 focus-visible:ring-2 motion-reduce:active:scale-100",
                open && "bg-muted"
              )}
            >
              <Ring health={health} />
              {health.level === "critical" && !pending && (
                <span aria-hidden className="bg-destructive/25 absolute inset-1.5 animate-ping rounded-full [animation-duration:2.4s] motion-reduce:hidden" />
              )}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        {!open && (
          <TooltipContent side="top">
            <span className="stamp">{pct}%</span> of context used
          </TooltipContent>
        )}
      </Tooltip>

      <PopoverContent side="top" align="end" sideOffset={10} className="w-[22rem] max-w-[calc(100vw-1rem)] p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="max-h-[min(68vh,34rem)] overflow-y-auto overscroll-contain p-3.5 pb-3">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-micro font-medium tracking-wide uppercase">Context window</span>
            <span className={cn("text-micro font-medium", health.level === "normal" ? "text-faint" : tone(health))}>
              {health.level === "critical" ? "Almost full" : health.level === "high" ? "Filling up" : "Healthy"}
            </span>
          </div>

          <div className="mt-2.5 flex items-center gap-3">
            <Ring health={health} size={40} stroke={3.5} />
            <div className="min-w-0">
              <div className="text-foreground text-xl leading-none font-semibold tracking-tight tabular-nums">{pct}%</div>
              <div className="text-muted-foreground mt-1 text-micro tabular-nums">
                {fmtK(health.tokens)} of {fmtK(health.window)} tokens
              </div>
            </div>
          </div>

          <UsageBar health={health} breakdown={breakdown} />

          {breakdown ? (
            <Breakdown breakdown={breakdown} window={health.window} />
          ) : (
            <p className="text-faint mt-2.5 text-micro leading-snug">The breakdown of what fills the window shows from the agent's next turn.</p>
          )}

          <SectionTitle>Window</SectionTitle>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-micro">
            <dt className="text-faint">Free</dt>
            <dd className="text-foreground text-right tabular-nums">{fmtK(left)} tokens</dd>
            <dt className="text-faint">Auto-compact</dt>
            <dd className="text-foreground text-right tabular-nums">{health.compactAt !== undefined ? `at ~${fmtK(health.compactAt)}` : "Off"}</dd>
            {last && (
              <>
                <dt className="text-faint">Compacted</dt>
                <dd className="text-foreground text-right tabular-nums">
                  {compactions.length === 1 ? "once" : `${compactions.length}×`}
                  {last.preTokens !== undefined && last.postTokens !== undefined && (
                    <span className="text-muted-foreground"> · {fmtK(last.preTokens)} → {fmtK(last.postTokens)}</span>
                  )}
                </dd>
              </>
            )}
          </dl>

          {health.advice && <p className="text-muted-foreground bg-muted/60 mt-3 rounded-md px-2.5 py-2 text-micro leading-snug">{health.advice}</p>}
        </div>

        <div className="border-t p-2">
          {canCompact ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                onCompact();
                setOpen(false);
              }}
              className={cn(
                "group flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none",
                "transition-[background-color,scale] duration-150 ease-out hover:bg-muted focus-visible:bg-muted active:scale-[0.98] disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent motion-reduce:active:scale-100"
              )}
            >
              <span className="bg-foreground text-background grid size-7 shrink-0 place-items-center rounded-md">
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : <CompactGlyph />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-foreground block text-meta font-medium">{pending ? "Compaction on its way" : running ? "Compact after this turn" : "Compact now"}</span>
                <span className="text-faint block text-micro leading-snug">Summarize this chat to free up context window</span>
              </span>
            </button>
          ) : (
            <p className="text-faint px-2 py-1.5 text-micro">Compacting is available on Claude Code threads.</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Two chevrons pressing a stack of lines together: "make this shorter". */
function CompactGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 2.5 8 5l3-2.5" />
      <path d="M3.5 7.25h9M3.5 9.25h9" />
      <path d="M5 13.5 8 11l3 2.5" />
    </svg>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-faint mt-3.5 mb-1.5 text-[0.6875rem] font-medium tracking-wide uppercase">{children}</div>;
}

/** The window as one bar: each part in its colour (or the level's colour without a breakdown), the rest free, a tick where auto-compact fires. */
function UsageBar({ health, breakdown }: { health: ContextHealth; breakdown: ContextBreakdown | null }) {
  const w = (n: number) => `${(n / health.window) * 100}%`;
  return (
    <div className="bg-muted relative mt-3 flex h-2 gap-px overflow-visible rounded-full" aria-hidden>
      {breakdown ? (
        breakdown.parts.map((p, i) => (
          <div
            key={p.part}
            className={cn("h-full min-w-[2px] transition-[width] duration-700 ease-out", i === 0 && "rounded-l-full")}
            style={{ width: w(p.tokens), background: CONTEXT_PARTS[p.part].color }}
          />
        ))
      ) : (
        <div className={cn("h-full rounded-full transition-[width] duration-700 ease-out", fill(health))} style={{ width: `${Math.max(health.fraction * 100, 2)}%` }} />
      )}
      {health.compactAt !== undefined && (
        <span className="bg-foreground/60 absolute -top-[3px] h-3.5 w-px rounded-full" style={{ left: w(health.compactAt) }} />
      )}
    </div>
  );
}

function Breakdown({ breakdown, window }: { breakdown: ContextBreakdown; window: number }) {
  const pctOf = (n: number) => {
    const p = (n / window) * 100;
    return p >= 10 ? `${Math.round(p)}%` : p >= 0.1 ? `${p.toFixed(1)}%` : "<0.1%";
  };
  const c = breakdown.cache;
  const cacheTotal = c ? c.read + c.write + c.fresh : 0;
  return (
    <>
      <SectionTitle>What's using it</SectionTitle>
      <ul className="space-y-1">
        {breakdown.parts.map((p) => (
          <li key={p.part} className="flex items-center gap-2 text-micro">
            <span className="size-2 shrink-0 rounded-[3px]" style={{ background: CONTEXT_PARTS[p.part].color }} aria-hidden />
            <span className="text-foreground/90 min-w-0 flex-1 truncate">
              {p.part === "setup" && breakdown.afterCompaction ? "Summary, system prompt & tools" : CONTEXT_PARTS[p.part].label}
            </span>
            <span className="text-foreground tabular-nums">{fmtK(p.tokens)}</span>
            <span className="text-faint w-10 text-right tabular-nums">{pctOf(p.tokens)}</span>
          </li>
        ))}
      </ul>

      {breakdown.heaviest.length > 0 && (
        <>
          <SectionTitle>Largest single additions</SectionTitle>
          <ul className="space-y-1">
            {breakdown.heaviest.map((h, i) => (
              <li key={i} className="flex items-center gap-2 text-micro" title={h.arg ? `${h.name} ${h.arg}` : h.name}>
                <span className="text-muted-foreground shrink-0 font-medium">{h.name.replace(/^mcp__([^_]+)__/, "$1 · ")}</span>
                <span className="text-faint min-w-0 flex-1 truncate font-mono text-[0.6875rem]">{h.arg ?? ""}</span>
                <span className="text-foreground tabular-nums">{fmtK(h.tokens)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {c && cacheTotal > 0 && (
        <>
          <SectionTitle>Prompt cache · last request</SectionTitle>
          <div className="bg-muted flex h-1.5 gap-px overflow-hidden rounded-full" aria-hidden>
            <div className="bg-ok h-full" style={{ width: `${(c.read / cacheTotal) * 100}%` }} />
            <div className="bg-live h-full" style={{ width: `${(c.write / cacheTotal) * 100}%` }} />
            <div className="bg-foreground/30 h-full" style={{ width: `${(c.fresh / cacheTotal) * 100}%` }} />
          </div>
          <dl className="mt-1.5 grid grid-cols-3 gap-2 text-micro">
            {(
              [
                ["Reused", c.read, "bg-ok", "Read back from the prompt cache: fast and cheap"],
                ["Written", c.write, "bg-live", "Added to the prompt cache for the next request"],
                ["Uncached", c.fresh, "bg-foreground/30", "Sent fresh, not cached"],
              ] as const
            ).map(([label, n, dot, hint]) => (
              <div key={label} title={hint}>
                <dt className="text-faint flex items-center gap-1.5">
                  <span className={cn("size-1.5 rounded-full", dot)} aria-hidden />
                  {label}
                </dt>
                <dd className="text-foreground mt-0.5 tabular-nums">
                  {fmtK(n)} <span className="text-faint">{Math.round((n / cacheTotal) * 100)}%</span>
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </>
  );
}
