import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, KeyRound, Pencil, RefreshCw, Trash2, X, Zap } from "lucide-react";
import { toast } from "sonner";
import type { McpServerView } from "@/lib/api";
import { BrandGlyph } from "@/lib/brandIcon";
import { fmtAgo } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { ArmButton } from "@/components/ui/arm-button";
import { Switch } from "@/components/ui/switch";
import { Collapse } from "@/components/ui/collapse";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { describe, errMsg, hintFor, statusOf, type Health, type Status } from "./model";

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

/** Re-renders every 30s so "checked 2m ago" stays honest. */
function useTick(ms: number) {
  const [, force] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    const t = window.setInterval(force, ms);
    return () => window.clearInterval(t);
  }, [ms]);
}

/* ───────────────────────────── verdict ───────────────────────────── */

/** The inline result of a test: a tinted strip with the verdict, the tools as chips, or the failure in plain words plus a fix. */
export function Verdict({ health, onDismiss, onRetry, retrying }: { health: Health; onDismiss?: () => void; onRetry?: () => void; retrying?: boolean }) {
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

/* ───────────────────────────── row ───────────────────────────── */

export function ServerRow({
  server: s,
  health,
  testing,
  onTest,
  onEdit,
  onDismiss,
  onMutate,
}: {
  server: McpServerView;
  health?: Health;
  testing: boolean;
  onTest: () => void;
  onEdit: () => void;
  onDismiss: () => void;
  onMutate: Mutate;
}) {
  const [busy, setBusy] = React.useState(false);
  const secrets = Object.keys(s.env ?? {}).length + Object.keys(s.headers ?? {}).length;
  const status = statusOf(s, health, testing);
  const remote = s.type !== "stdio";
  const toggle = () => {
    setBusy(true);
    onMutate({ action: "toggle", name: s.name, enabled: !s.enabled }, s.enabled ? `${s.name} is off` : `${s.name} is on — every sandbox gets it on its next run`)
      .catch((e: unknown) => toast.error("Could not update", { description: errMsg(e) }))
      .finally(() => setBusy(false));
  };
  const remove = async () => {
    await onMutate({ action: "remove", name: s.name }, `Removed ${s.name}`).catch((e: unknown) => toast.error("Could not remove", { description: errMsg(e) }));
  };

  return (
    <div className={cn("group relative transition-colors duration-150", "hover:bg-muted/40 focus-within:bg-muted/40")}>
      <div className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:gap-3 sm:px-4">
        {/* Identity — the whole left side opens the editor. */}
        <button type="button" onClick={onEdit} className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40" aria-label={`Open ${s.name}`}>
          <span
            className={cn(
              "bg-card relative grid size-10 shrink-0 place-items-center rounded-[10px] border shadow-e1 transition-[border-color,transform] duration-150 group-hover:border-line-strong",
              !s.enabled && "opacity-55 grayscale"
            )}
            aria-hidden
          >
            <BrandGlyph hint={`${s.name} ${s.command ?? ""} ${(s.args ?? []).join(" ")} ${s.url ?? ""}`} transport={s.type} className="size-5" />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex min-w-0 items-center gap-2">
              <span className={cn("truncate text-body font-medium tracking-[-0.005em]", s.enabled ? "text-foreground" : "text-muted-foreground")}>{s.name}</span>
              <StatusPill status={status} />
            </span>
            <span className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-meta">
              <span className="truncate">{describe(s)}</span>
              {secrets > 0 && (
                <>
                  <span className="text-faint" aria-hidden>
                    ·
                  </span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-faint inline-flex shrink-0 items-center gap-1 text-micro">
                        <KeyRound className="size-3" aria-hidden />
                        {secrets} {secrets === 1 ? "secret" : "secrets"}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>Stored on the server, shown masked</TooltipContent>
                  </Tooltip>
                </>
              )}
            </span>
          </span>
        </button>

        {/* Actions — always present, quiet; the switch is the loudest thing on the right. */}
        <div className="flex items-center gap-1 pl-[3.25rem] sm:pl-0">
          {remote ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="xs" variant="ghost" onClick={onTest} loading={testing} disabled={!s.enabled && !health} className="text-muted-foreground h-9 px-3 sm:h-7 sm:px-2.5">
                  <Zap className="size-3.5" />
                  Test
                </Button>
              </TooltipTrigger>
              <TooltipContent>Run the MCP handshake and list its tools</TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-faint stamp hidden px-2 sm:inline">stdio</span>
              </TooltipTrigger>
              <TooltipContent>Starts inside each sandbox; tools are counted at run time</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon-xs" variant="ghost" onClick={onEdit} aria-label={`Edit ${s.name}`} className="size-9 sm:size-7">
                <Pencil />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Edit</TooltipContent>
          </Tooltip>
          <ArmButton size="icon-xs" variant="ghost" icon={<Trash2 />} label={`Remove ${s.name}`} armedLabel="Remove?" onConfirm={remove} className="h-9 min-w-9 hover:text-destructive sm:h-7 sm:min-w-7" />
          <Tooltip>
            {/* A span, not the Switch itself: TooltipTrigger asChild injects an onClick that Switch's prop spread would let override its own toggle. */}
            <TooltipTrigger asChild>
              <span className="ml-auto inline-flex sm:ml-2">
                <Switch checked={s.enabled} onCheckedChange={toggle} disabled={busy} aria-label={s.enabled ? `Disable ${s.name}` : `Enable ${s.name}`} />
              </span>
            </TooltipTrigger>
            <TooltipContent>{s.enabled ? "On — given to every new run and turn" : "Off — kept, not given to the agent"}</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <Collapse open={!!health && remote}>
        {health && (
          <div className="px-3 pb-3 sm:pr-4 sm:pl-[4.25rem]">
            <Verdict health={health} onDismiss={onDismiss} onRetry={onTest} retrying={testing} />
          </div>
        )}
      </Collapse>
    </div>
  );
}
