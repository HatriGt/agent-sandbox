import * as React from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The model switch — Cursor's picker, in this console's voice. A compact chip in the composer's
 * action row showing the CURRENT model; click (or ⌘.) opens a command-palette-style popover:
 * search on top with the caret ALREADY in it (open-and-type, no second click), a capped scrolling
 * list under it, ArrowUp/Down + Enter to pick, Escape to close. A pick sticks for the box (the
 * server holds it; localStorage repaints instantly). When the active model is not the deployment
 * default the chip is tinted — a forgotten Haiku pick must be glanceable, because it quietly
 * degrades every following turn.
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

/** Same subsequence-friendly filter feel as the file mention menu: substring on label OR id. */
export function filterModels(models: ModelChoice[], query: string): ModelChoice[] {
  const q = query.trim().toLowerCase();
  if (!q) return models;
  return models.filter((m) => m.label.toLowerCase().includes(q) || m.id.toLowerCase().includes(q));
}

export function ModelChip({
  current,
  models,
  defaultId,
  onPick,
  disabled,
  /** Register a global open shortcut (⌘/Ctrl+.) — pass true on the composer's instance only. */
  hotkey,
}: {
  current: ModelChoice | null;
  models: ModelChoice[];
  defaultId: string;
  onPick: (m: ModelChoice) => void;
  disabled?: boolean;
  hotkey?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [cursor, setCursor] = React.useState(0);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const shown = React.useMemo(() => filterModels(models, query), [models, query]);

  // Opening resets the search; the caret lands in it via autoFocus + the effect below (the popover
  // mounts inside a motion element, so a focus fired before mount hits a node that gets replaced).
  const openMenu = React.useCallback(() => {
    setQuery("");
    setCursor(0);
    setOpen(true);
  }, []);
  React.useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  // ⌘. / Ctrl+. — the composer's model switch, reachable without leaving the keyboard.
  React.useEffect(() => {
    if (!hotkey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "." && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        openMenu();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkey, openMenu]);

  const choose = (m: ModelChoice | undefined) => {
    if (!m) return;
    onPick(m);
    setOpen(false);
  };

  if (!current || models.length === 0) return null;
  const offDefault = current.id !== defaultId;
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          open ? setOpen(false) : openMenu();
        }}
        aria-expanded={open}
        aria-label={`Model: ${current.label}`}
        title="Switch model (⌘.)"
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
            className="bg-popover text-popover-foreground absolute bottom-full left-0 z-30 mb-1.5 w-64 overflow-hidden rounded-xl border shadow-e3"
          >
            <label className="flex h-9 items-center gap-2 border-b px-2.5">
              <Search className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
              <input
                ref={inputRef}
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setCursor(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setCursor((c) => Math.min(shown.length - 1, c + 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setCursor((c) => Math.max(0, c - 1));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    choose(shown[cursor]);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setOpen(false);
                  }
                }}
                placeholder="Search models…"
                aria-label="Search models"
                className="text-foreground placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-meta outline-none"
              />
              <kbd className="text-faint hidden rounded border px-1 font-mono text-[9px] leading-4 sm:block">⌘.</kbd>
            </label>
            <div role="listbox" aria-label="Model" className="max-h-56 overflow-y-auto p-1">
              {shown.length === 0 && <p className="text-muted-foreground px-2.5 py-3 text-micro">Nothing matches “{query}”.</p>}
              {shown.map((m, i) => {
                const on = m.id === current.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="option"
                    aria-selected={on}
                    onMouseEnter={() => setCursor(i)}
                    onMouseDown={(e) => {
                      e.preventDefault(); // keep focus where it was
                      choose(m);
                    }}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors",
                      i === cursor ? "bg-accent" : on ? "bg-muted/60" : ""
                    )}
                  >
                    <span className={cn("size-2 shrink-0 rounded-full", TIER_TINT[m.tier])} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="text-foreground block truncate text-meta font-medium">
                        {m.label}
                        {m.id === defaultId && <span className="text-faint ml-1.5 text-micro font-normal">default</span>}
                      </span>
                      <span className="text-faint block truncate font-mono text-micro">{m.id}</span>
                    </span>
                    {on && <Check className="text-foreground size-3.5 shrink-0" strokeWidth={2.5} aria-hidden />}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
