import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { api, type AgentChoice, type AgentId } from "@/lib/api";
import { menuMotion } from "@/components/thread/MentionMenu";
import { cn } from "@/lib/utils";

const SOURCE_LABEL: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  "openai-compatible": "OpenAI-compatible",
  local: "Local",
};

function Badge({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "ok" | "attention" }) {
  return (
    <span
      className={cn(
        "rounded-full border px-1.5 py-px text-micro font-normal whitespace-nowrap",
        tone === "ok" && "border-ok/40 text-ok",
        tone === "attention" && "border-attention/50 text-attention",
        tone === "muted" && "border-line-strong text-muted-foreground"
      )}
    >
      {children}
    </span>
  );
}

/**
 * What a driver can actually do, as badges. The words come straight from the server's capability
 * record — "supervised: partial" whenever a pending question cannot stop the agent, never softened.
 */
export function DriverBadges({ choice }: { choice: AgentChoice }) {
  const c = choice.capabilities;
  if (!c) return null;
  const supervised = choice.supervised !== false;
  return (
    <span className="flex flex-wrap items-center gap-1">
      <Badge tone={supervised ? "ok" : "attention"}>{supervised ? "supervised" : "supervised: partial"}</Badge>
      <Badge>{c.gate === "hook" ? "pre-action gate" : c.gate === "wrapper" ? "stop-and-resume gate" : "no gate"}</Badge>
      {c.planEvents && <Badge>plan card</Badge>}
      {c.sideQuestion && <Badge>side questions</Badge>}
      <Badge>{c.modelSources.map((s) => SOURCE_LABEL[s] ?? s).join(" · ")}</Badge>
    </span>
  );
}

/** The composer's agent pick for the NEXT thread; null = the stored default. */
export function useAgentChoice() {
  const [choices, setChoices] = React.useState<AgentChoice[]>([]);
  const [defaultId, setDefaultId] = React.useState<AgentId>("claude");
  const [picked, setPicked] = React.useState<AgentId | null>(null);
  React.useEffect(() => {
    const ctrl = new AbortController();
    api
      .agentPrefs(ctrl.signal)
      .then((p) => {
        setChoices(p.agents);
        setDefaultId(p.defaultAgent);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, []);
  const currentId = picked ?? defaultId;
  const current = choices.find((c) => c.id === currentId) ?? null;
  return { choices, defaultId, current, picked, pick: setPicked };
}

export function AgentChip({
  choices,
  current,
  defaultId,
  onPick,
  disabled,
}: {
  choices: AgentChoice[];
  current: AgentChoice | null;
  defaultId: AgentId;
  onPick: (id: AgentId) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const still = useReducedMotion();
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
  if (!current || choices.length < 2) return null;
  const partial = current.supervised === false;
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-expanded={open}
        aria-label={`Agent: ${current.label}${partial ? " (supervised: partial)" : ""}`}
        title="Coding agent for this task"
        className={cn(
          "flex h-7 max-w-[10rem] cursor-pointer items-center gap-1.5 rounded-md border px-2 text-micro font-medium whitespace-nowrap transition-colors disabled:opacity-50",
          current.id !== defaultId ? "border-live/40 bg-live/8 text-live" : "text-muted-foreground hover:text-foreground hover:bg-muted border-transparent"
        )}
      >
        <span className="min-w-0 truncate">{current.label}</span>
        {partial && <span className="text-attention">partial</span>}
        <ChevronDown className={cn("size-3 shrink-0 transition-transform duration-150", open && "rotate-180")} aria-hidden />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            {...menuMotion(still)}
            className="bg-popover text-popover-foreground absolute bottom-full left-0 z-30 mb-1.5 w-80 overflow-hidden rounded-xl border p-1 shadow-e3"
            role="listbox"
            aria-label="Coding agent"
          >
            {choices.map((c) => {
              const on = c.id === current.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="option"
                  aria-selected={on}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onPick(c.id);
                    setOpen(false);
                  }}
                  className={cn("flex w-full cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-accent", on && "bg-muted/60")}
                >
                  <span className="min-w-0 flex-1">
                    <span className="text-foreground block text-meta font-medium">
                      {c.label}
                      {c.id === defaultId && <span className="text-faint ml-1.5 text-micro font-normal">default</span>}
                    </span>
                    <span className="mt-1 block">
                      <DriverBadges choice={c} />
                    </span>
                  </span>
                  {on && <Check className="text-foreground mt-0.5 size-3.5 shrink-0" strokeWidth={2.5} aria-hidden />}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
