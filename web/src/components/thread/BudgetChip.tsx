import * as React from "react";
import { Check, ChevronDown, Timer } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { api, type RunBudget } from "@/lib/api";
import { menuMotion } from "./MentionMenu";
import { cn } from "@/lib/utils";

/**
 * The per-run budget chip ("1 h · $2"). Caps never kill a run: when one is hit the run asks
 * continue/stop at its next tool call. A dollar cap is only offered when the chosen model has a
 * known price — an unpriced model is tokens-only, never a guessed $.
 */
const MINUTES = [15, 30, 60, 120, 240];
const DOLLARS = [1, 2, 5, 10];

let pricedCache: Promise<Set<string>> | null = null;
function usePriced(): Set<string> | null {
  const [s, setS] = React.useState<Set<string> | null>(null);
  React.useEffect(() => {
    pricedCache ??= api.pricedModels().then((r) => new Set(r.priced)).catch(() => new Set<string>());
    let live = true;
    void pricedCache.then((v) => live && setS(v));
    return () => {
      live = false;
    };
  }, []);
  return s;
}

const fmtMin = (m: number) => (m >= 60 ? `${m / 60} h` : `${m} min`);
export const budgetLabel = (b: RunBudget) => `${fmtMin(b.maxMinutes)}${b.maxUsd ? ` · $${b.maxUsd}` : ""}`;

export function BudgetChip({ value, onChange, modelId }: { value: RunBudget | null; onChange: (b: RunBudget | null) => void; modelId?: string }) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const still = useReducedMotion();
  const priced = usePriced();
  const canUsd = !!modelId && !!priced?.has(modelId);

  // A $ cap that no longer applies (model switched to an unpriced one) is dropped, not kept silently.
  React.useEffect(() => {
    if (value?.maxUsd && priced && !canUsd) onChange({ maxMinutes: value.maxMinutes });
  }, [canUsd, priced, value, onChange]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const opt = (active: boolean, label: string, onClick: () => void) => (
    <button
      key={label}
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-7 cursor-pointer items-center justify-center gap-1 rounded-md px-2 text-micro font-medium tabular-nums transition-colors",
        active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      {active && <Check className="size-3" aria-hidden />}
      {label}
    </button>
  );

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={value ? `Budget: ${budgetLabel(value)}` : "Set a budget"}
        title="Per-run budget — asks before going past it"
        className={cn(
          "h-7 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-micro font-medium whitespace-nowrap tabular-nums transition-colors",
          // Phone: like Verify, the unset chip hides so the send button stays on the row; a set one shows.
          value ? "border-live/40 bg-live/8 text-live flex" : "text-muted-foreground hover:bg-muted hover:text-foreground hidden border-transparent sm:flex"
        )}
      >
        <Timer className="size-3.5 shrink-0" aria-hidden />
        <span>{value ? budgetLabel(value) : "Budget"}</span>
        <ChevronDown className={cn("size-3 shrink-0 transition-transform duration-150", open && "rotate-180")} aria-hidden />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            {...menuMotion(still)}
            className="bg-popover text-popover-foreground absolute bottom-full left-0 z-30 mb-1.5 w-60 overflow-hidden rounded-xl border p-2 shadow-e3"
          >
            <p className="text-faint px-1 pb-1 text-micro">Time</p>
            <div className="grid grid-cols-3 gap-1">
              {opt(!value, "None", () => {
                onChange(null);
                setOpen(false);
              })}
              {MINUTES.map((m) => opt(value?.maxMinutes === m, fmtMin(m), () => onChange({ ...(value ?? {}), maxMinutes: m })))}
            </div>
            <p className="text-faint px-1 pt-2 pb-1 text-micro">Spend</p>
            {canUsd ? (
              <div className="grid grid-cols-5 gap-1">
                {opt(!value?.maxUsd, "Any", () => value && onChange({ maxMinutes: value.maxMinutes }))}
                {DOLLARS.map((d) => opt(value?.maxUsd === d, `$${d}`, () => onChange({ maxMinutes: value?.maxMinutes ?? 60, maxUsd: d })))}
              </div>
            ) : (
              <p className="text-muted-foreground px-1 text-micro">No known price for this model — tokens are tracked, $ is not.</p>
            )}
            <p className="text-faint border-t mt-2 px-1 pt-2 text-micro">Reaching a cap pauses the run with a question. It never kills it.</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
