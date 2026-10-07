import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, RefreshCw, X } from "lucide-react";
import { fmtAgo } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { hintFor, type Health, type Status } from "./model";

export type Mutate = (b: Record<string, unknown>, ok?: string) => Promise<unknown>;

/* ───────────────────────────── status pill ───────────────────────────── */

const PILL: Record<Status["kind"], { pill: string; dot: string }> = {
  off: { pill: "bg-muted text-muted-foreground ring-border", dot: "bg-muted-foreground/50" },
  on: { pill: "bg-live/10 text-live ring-live/20", dot: "bg-live" },
  checking: { pill: "bg-live/10 text-live ring-live/20", dot: "bg-live" },
  connected: { pill: "bg-ok/10 text-ok ring-ok/20", dot: "bg-ok" },
  failed: { pill: "bg-destructive/10 text-destructive ring-destructive/20", dot: "bg-destructive" },
  expired: { pill: "bg-destructive/10 text-destructive ring-destructive/20", dot: "bg-destructive" },
};

export function StatusPill({ status, className }: { status: Status; className?: string }) {
  const still = useReducedMotion();
  const t = PILL[status.kind];
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={status.word}
        initial={still ? { opacity: 0 } : { opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={still ? { opacity: 0 } : { opacity: 0, scale: 0.94 }}
        transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
        className={cn("inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full px-2 text-micro font-medium whitespace-nowrap ring-1 ring-inset", t.pill, className)}
      >
        <span className={cn("size-1.5 shrink-0 rounded-full motion-reduce:animate-none", t.dot, status.kind === "on" && "animate-[breathe_2.4s_ease-in-out_infinite]", status.kind === "checking" && "animate-[breathe_0.9s_ease-in-out_infinite]")} aria-hidden />
        {status.word}
      </motion.span>
    </AnimatePresence>
  );
}

/** Re-renders every `ms` so "checked 2m ago" stays honest. */
export function useTick(ms: number) {
  const [, force] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    const t = window.setInterval(force, ms);
    return () => window.clearInterval(t);
  }, [ms]);
}

/* ───────────────────────────── verdict ───────────────────────────── */

/** The result of a test: a tinted strip with the verdict, the tools as chips, or the failure in plain words plus a fix. */
export function Verdict({ health, title: label, onDismiss, onRetry, retrying }: { health: Health; title?: React.ReactNode; onDismiss?: () => void; onRetry?: () => void; retrying?: boolean }) {
  useTick(30_000);
  const [all, setAll] = React.useState(false);
  const tools = health.tools ?? [];
  const shown = all ? tools : tools.slice(0, 8);
  const hint = health.ok ? null : hintFor(health.detail);
  const title = health.ok ? (health.tools ? `${tools.length} ${tools.length === 1 ? "tool" : "tools"} available` : "Connected") : "Could not connect";
  // The controller's detail line repeats the verdict on success — keep it only when it adds something.
  const detail = health.ok && /^connected\b/i.test(health.detail) && health.tools ? null : health.detail;
  return (
    <div role="status" className={cn("rounded-lg border px-3 py-2.5 text-meta", health.ok ? "border-ok/20 bg-ok/5" : "border-destructive/20 bg-destructive/5")}>
      <div className="flex items-start gap-2">
        <span className={cn("mt-0.5 grid size-4 shrink-0 place-items-center rounded-full", health.ok ? "bg-ok text-white" : "bg-destructive text-white")} aria-hidden>
          {health.ok ? <Check className="size-2.5" strokeWidth={3} /> : <X className="size-2.5" strokeWidth={3} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn("leading-snug", health.ok ? "text-foreground" : "text-destructive")}>
            {label && <span className="text-foreground font-medium">{label} · </span>}
            <span className="font-medium">{title}</span>
            <span className="text-muted-foreground"> · {fmtAgo(Math.floor(health.at / 1000))}</span>
          </p>
          {detail && <p className={cn("mt-0.5 text-micro leading-snug break-words", health.ok ? "text-muted-foreground" : "text-destructive/90")}>{detail}</p>}
          {hint && <p className="text-muted-foreground mt-1.5 text-micro leading-snug">{hint}</p>}
          {tools.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1" aria-label="Tools advertised">
              {shown.map((t) => (
                <li key={t} className="stamp bg-card text-foreground rounded-md border px-1.5 py-0.5">
                  {t}
                </li>
              ))}
              {tools.length > 8 && (
                <li>
                  <button type="button" onClick={() => setAll((a) => !a)} className="stamp text-muted-foreground hover:text-foreground cursor-pointer rounded-md px-1.5 py-0.5 transition-colors">
                    {all ? "show fewer" : `+${tools.length - 8} more`}
                  </button>
                </li>
              )}
            </ul>
          )}
          {health.ok && health.tools && health.tools.length === 0 && <p className="text-muted-foreground mt-1 text-micro">The server answered but advertised no tools.</p>}
        </div>
        <div className="-mr-1 -mt-1 flex shrink-0 items-center">
          {onRetry && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon-xs" variant="ghost" onClick={onRetry} loading={retrying} aria-label="Test again">
                  <RefreshCw />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Test again</TooltipContent>
            </Tooltip>
          )}
          {onDismiss && (
            <Button size="icon-xs" variant="ghost" onClick={onDismiss} aria-label="Dismiss result">
              <X />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
