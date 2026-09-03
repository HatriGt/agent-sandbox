import * as React from "react";
import { Check, ChevronDown, Cpu } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The model switch — Cursor's picker, in this console's voice. A compact chip in the composer's
 * action row showing the CURRENT model; click opens a tier-grouped popover of the ccproxy catalog.
 * A pick sticks for the box (the server holds it; localStorage repaints instantly) and rides the
 * next send. When the active model is not the deployment default the chip is tinted — "you are off
 * the default" must be glanceable, because a forgotten Haiku pick quietly degrades every following
 * turn.
 */

export interface ModelChoice {
  id: string;
  label: string;
  tier: "opus" | "sonnet" | "haiku" | "other";
}

const TIER_TINT: Record<ModelChoice["tier"], string> = {
  opus: "bg-live",
  sonnet: "bg-ok",
  haiku: "bg-attention",
  other: "bg-muted-foreground",
};

const LS_KEY = (box: string) => `asb-model-${box}`;

export function useModelChoice(box: string | null): {
  current: ModelChoice | null;
  models: ModelChoice[];
  defaultId: string;
  pick: (m: ModelChoice) => void;
  picked: string | null;
} {
  const [models, setModels] = React.useState<ModelChoice[]>([]);
  const [defaultId, setDefaultId] = React.useState("");
  const [serverCurrent, setServerCurrent] = React.useState<string | null>(null);
  // The pick the user made THIS session (sent with the next message); localStorage bridges reloads.
  const [picked, setPicked] = React.useState<string | null>(() => {
    try {
      return box ? localStorage.getItem(LS_KEY(box)) : null;
    } catch {
      return null;
    }
  });
  React.useEffect(() => {
    try {
      setPicked(box ? localStorage.getItem(LS_KEY(box)) : null);
    } catch {
      setPicked(null);
    }
  }, [box]);
  React.useEffect(() => {
    const ctrl = new AbortController();
    api
      .models(box ?? undefined, ctrl.signal)
      .then((r) => {
        setModels(r.models);
        setDefaultId(r.default);
        setServerCurrent(r.current);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [box]);
  const activeId = picked ?? serverCurrent ?? defaultId;
  const current = models.find((m) => m.id === activeId) ?? (activeId ? { id: activeId, label: activeId.replace(/^ak-claude-/, ""), tier: "other" as const } : null);
  const pick = React.useCallback(
    (m: ModelChoice) => {
      setPicked(m.id);
      try {
        if (box) localStorage.setItem(LS_KEY(box), m.id);
      } catch {
        /* storage blocked: session-only */
      }
    },
    [box]
  );
  return { current, models, defaultId, pick, picked };
}

export function ModelChip({
  current,
  models,
  defaultId,
  onPick,
  disabled,
}: {
  current: ModelChoice | null;
  models: ModelChoice[];
  defaultId: string;
  onPick: (m: ModelChoice) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
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
  if (!current || models.length === 0) return null;
  const offDefault = current.id !== defaultId;
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        aria-label={`Model: ${current.label}`}
        className={cn(
          "flex h-7 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-micro font-medium transition-colors disabled:opacity-50",
          offDefault
            ? "border-live/40 bg-live/8 text-live"
            : "text-muted-foreground hover:text-foreground hover:bg-muted border-transparent"
        )}
      >
        <span className={cn("size-1.5 shrink-0 rounded-full", TIER_TINT[current.tier])} aria-hidden />
        {current.label}
        <ChevronDown className={cn("size-3 transition-transform duration-150", open && "rotate-180")} aria-hidden />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            role="listbox"
            aria-label="Model"
            className="bg-popover text-popover-foreground absolute bottom-full left-0 z-30 mb-1.5 w-64 rounded-xl border p-1 shadow-e3"
          >
            <p className="text-muted-foreground flex items-center gap-1.5 px-2.5 pt-1.5 pb-1 text-micro">
              <Cpu className="size-3" aria-hidden />
              Model for the next message — sticks until changed
            </p>
            {models.map((m) => {
              const on = m.id === current.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  role="option"
                  aria-selected={on}
                  onMouseDown={(e) => {
                    e.preventDefault(); // keep the composer focused
                    onPick(m);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors",
                    on ? "bg-accent" : "hover:bg-muted"
                  )}
                >
                  <span className={cn("size-2 shrink-0 rounded-full", TIER_TINT[m.tier])} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="text-foreground block text-meta font-medium">
                      {m.label}
                      {m.id === defaultId && <span className="text-faint ml-1.5 text-micro font-normal">default</span>}
                    </span>
                    <span className="text-faint block truncate font-mono text-micro">{m.id}</span>
                  </span>
                  {on && <Check className="text-foreground size-3.5 shrink-0" strokeWidth={2.5} aria-hidden />}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
