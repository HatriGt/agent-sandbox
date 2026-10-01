import * as React from "react";
import { Check, ChevronRight, Layers, RotateCcw, Search, ShieldCheck, SlidersHorizontal, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { AgentChoice, AgentId, HarnessView } from "@/lib/api";
import type { ModelChoice } from "./ModelPicker";
import { menuMotion } from "./MentionMenu";
import { Segmented } from "@/components/ui/segmented";
import { Collapse } from "@/components/ui/collapse";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/**
 * The composer's ONE settings affordance.
 *
 * Every run option that used to be its own chip in the action row — harness, model, coding agent,
 * attempts, verification — lives behind a single "Settings" control. The panel is a popover above the
 * composer on a desk and a bottom sheet on a phone; inside, options are rows and sections (no cards),
 * the harness first because it is the one pick that sets everything else, and the rarely-touched
 * options folded under "More". Defaults stay invisible: the composer shows only what you changed, as
 * removable chips (`RunOptionChips`), so a quiet composer means "defaults" and a chip means "not".
 */

export type Attempts = 1 | 2 | 3;
export interface VerifySpec {
  mode: "command" | "criterion";
  text: string;
}

export interface RunSettingsModel {
  current: ModelChoice | null;
  models: ModelChoice[];
  defaultId: string;
  onPick: (m: ModelChoice) => void;
  /** True when the active model is not the deployment default (or comes from your own provider). */
  offDefault: boolean;
  onReset: () => void;
}

export interface RunSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  harness?: { list: HarnessView[]; value: string | null; onChange: (id: string | null) => void };
  model?: RunSettingsModel;
  agent?: { choices: AgentChoice[]; current: AgentChoice | null; defaultId: AgentId; onPick: (id: AgentId | null) => void };
  attempts?: { value: Attempts; onChange: (n: Attempts) => void };
  verify?: { value: VerifySpec | null; onChange: (v: VerifySpec | null) => void };
  disabled?: boolean;
  /** Register ⌘. / Ctrl+. to open the panel — pass on one instance per page. */
  hotkey?: boolean;
  /** Where the desktop popover grows: "top" above the trigger (a composer at the foot of a thread),
   *  "bottom" below it (the Hub composer, which sits near the top of the page). */
  side?: "top" | "bottom";
  className?: string;
}

// Amber is reserved for "needs you" everywhere on the console — Haiku's dot is grey, not amber.
const TIER_TINT: Record<ModelChoice["tier"], string> = {
  opus: "bg-live",
  sonnet: "bg-ok",
  haiku: "bg-muted-foreground",
  other: "bg-line-strong",
};

function useMediaQuery(q: string): boolean {
  const get = () => (typeof window !== "undefined" && "matchMedia" in window ? window.matchMedia(q).matches : false);
  const [m, setM] = React.useState(get);
  React.useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return m;
}

/** Which options are off their default — the chips the composer shows. */
export function nonDefaults(p: Pick<RunSettingsProps, "harness" | "model" | "agent" | "attempts" | "verify">): number {
  let n = 0;
  if (p.harness?.value) n++;
  if (p.model?.offDefault) n++;
  if (p.agent?.current && p.agent.current.id !== p.agent.defaultId) n++;
  if (p.attempts && p.attempts.value > 1) n++;
  if (p.verify?.value && p.verify.value.text.trim()) n++;
  return n;
}

export function RunSettings(props: RunSettingsProps) {
  const { open, onOpenChange, disabled, hotkey, side = "top", className } = props;
  const phone = useMediaQuery("(max-width: 639px)");
  const still = useReducedMotion();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const changed = nonDefaults(props);

  // Desktop popover: outside click + Esc close; focus lands on the first control and returns to the
  // trigger on close so a keyboard user never loses their place.
  React.useEffect(() => {
    if (!open || phone) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onOpenChange(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    const t = window.setTimeout(() => {
      const first = panelRef.current?.querySelector<HTMLElement>("input, [role=radio][tabindex='0'], button");
      first?.focus();
    }, 40);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
      window.clearTimeout(t);
    };
  }, [open, phone, onOpenChange]);

  React.useEffect(() => {
    if (!hotkey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "." && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        onOpenChange(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkey, onOpenChange]);

  const body = <SettingsBody {...props} />;

  return (
    <div ref={rootRef} className={cn("relative", className)} onClick={(e) => e.stopPropagation()}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Run settings${changed ? `, ${changed} changed` : ""}`}
        title="Run settings (⌘.)"
        className={cn(
          "text-muted-foreground hover:text-foreground hover:bg-muted flex h-7 max-w-[11rem] cursor-pointer items-center gap-1.5 rounded-md px-2 text-micro font-medium whitespace-nowrap transition-colors disabled:opacity-50",
          open && "bg-muted text-foreground"
        )}
      >
        <SlidersHorizontal className="size-3.5 shrink-0" aria-hidden />
        <span>Settings</span>
      </button>

      {phone ? (
        <Sheet open={open} onOpenChange={onOpenChange}>
          <SheetContent side="bottom" title="Run settings">
            {/* Rows carry their own 12px inset; pull them out so their text aligns with the title. */}
            <div className="-mx-3">{body}</div>
          </SheetContent>
        </Sheet>
      ) : (
        <AnimatePresence>
          {open && (
            <motion.div
              ref={panelRef}
              {...panelMotion(still, side)}
              role="dialog"
              aria-label="Run settings"
              className={cn(
                "bg-popover text-popover-foreground absolute left-0 z-30 w-[22rem] overflow-hidden rounded-xl border shadow-e3",
                side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5"
              )}
            >
              <div className="flex h-9 items-center justify-between border-b pr-1.5 pl-3">
                <span className="text-foreground text-meta font-medium">Run settings</span>
                <button
                  type="button"
                  onClick={() => {
                    onOpenChange(false);
                    triggerRef.current?.focus();
                  }}
                  aria-label="Close"
                  className="text-muted-foreground hover:text-foreground hover:bg-muted grid size-6 cursor-pointer place-items-center rounded-md transition-colors"
                >
                  <X className="size-3.5" />
                </button>
              </div>
              <div className="max-h-[min(28rem,60vh)] overflow-y-auto">{body}</div>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}

/** The @-menu's entrance, mirrored for a panel that grows downward from its trigger. */
function panelMotion(still: boolean | null, side: "top" | "bottom") {
  if (side === "top") return menuMotion(still);
  return {
    initial: still ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -4 },
    animate: { opacity: 1, scale: 1, y: 0 },
    exit: still ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -4 },
    transition: { duration: 0.16, ease: [0.22, 1, 0.36, 1] as const },
    style: { transformOrigin: "0% 0%" },
  };
}

/* ───────────────────────────── the panel ───────────────────────────── */

function SettingsBody(p: RunSettingsProps) {
  const { harness, model, agent, attempts, verify } = p;
  const changed = nonDefaults(p);
  // "More" opens itself when something inside it is already off-default — never hide a live choice.
  const moreLive = (attempts && attempts.value > 1) || (verify?.value && verify.value.text.trim()) || (agent?.current && agent.current.id !== agent.defaultId);
  const [more, setMore] = React.useState(!!moreLive);
  const [modelOpen, setModelOpen] = React.useState(false);
  const hasMore = !!(agent && agent.choices.length > 1) || !!attempts || !!verify;

  const reset = () => {
    harness?.onChange(null);
    model?.onReset();
    agent?.onPick(null);
    attempts?.onChange(1);
    verify?.onChange(null);
  };

  return (
    <div className="divide-y">
      {harness && harness.list.length > 0 && (
        <Section label="Harness" hint="A saved setup — agent, model, skills and rules. Anything you pick below still wins.">
          <HarnessList list={harness.list} value={harness.value} onChange={harness.onChange} />
        </Section>
      )}

      {model && model.current && model.models.length > 0 && (
        <div className="py-1">
          <button
            type="button"
            onClick={() => setModelOpen((v) => !v)}
            aria-expanded={modelOpen}
            className="hover:bg-muted/60 flex h-9 w-full cursor-pointer items-center gap-2 px-3 text-left transition-colors"
          >
            <span className="text-muted-foreground w-16 shrink-0 text-meta">Model</span>
            <span className={cn("size-1.5 shrink-0 rounded-full", TIER_TINT[model.current.tier])} aria-hidden />
            <span className="text-foreground min-w-0 flex-1 truncate text-meta">
              {model.current.label}
              {!model.offDefault && <span className="text-faint ml-1.5 text-micro">default</span>}
            </span>
            <ChevronRight className={cn("text-muted-foreground size-3.5 shrink-0 transition-transform duration-150", modelOpen && "rotate-90")} aria-hidden />
          </button>
          <Collapse open={modelOpen}>
            <ModelList
              {...model}
              onPick={(m) => {
                model.onPick(m);
                setModelOpen(false);
              }}
            />
          </Collapse>
        </div>
      )}

      {hasMore && (
        <div className="py-1">
          <button
            type="button"
            onClick={() => setMore((v) => !v)}
            aria-expanded={more}
            className="hover:bg-muted/60 flex h-9 w-full cursor-pointer items-center gap-2 px-3 text-left transition-colors"
          >
            <span className="text-foreground flex-1 text-meta">More</span>
            {!more && moreLive && <span className="bg-live size-1.5 rounded-full" aria-hidden />}
            <ChevronRight className={cn("text-muted-foreground size-3.5 shrink-0 transition-transform duration-150", more && "rotate-90")} aria-hidden />
          </button>
          <Collapse open={more}>
            <div className="flex flex-col gap-1 px-3 pt-1 pb-2">
              {agent && agent.choices.length > 1 && agent.current && (
                <Row label="Agent" hint={agent.current.supervised === false ? "Supervised: partial — a pending question cannot stop this agent." : undefined} hintTone={agent.current.supervised === false ? "attention" : undefined}>
                  <Segmented
                    ariaLabel="Coding agent"
                    value={agent.current.id}
                    onChange={(id) => agent.onPick(id === agent.defaultId ? null : (id as AgentId))}
                    options={agent.choices.map((c) => ({ value: c.id, label: c.label }))}
                  />
                </Row>
              )}
              {attempts && (
                <Row label="Attempts" hint={attempts.value > 1 ? `Runs the task ${attempts.value} ways in parallel; the best attempt gets the PR.` : undefined}>
                  <Segmented
                    ariaLabel="Attempts"
                    value={String(attempts.value)}
                    onChange={(v) => attempts.onChange(Number(v) as Attempts)}
                    options={[
                      { value: "1", label: "1" },
                      { value: "2", label: "2" },
                      { value: "3", label: "3" },
                    ]}
                  />
                </Row>
              )}
              {verify && <VerifyRow value={verify.value} onChange={verify.onChange} />}
            </div>
          </Collapse>
        </div>
      )}

      {changed > 0 && (
        <div className="flex h-10 items-center px-3">
          <button
            type="button"
            onClick={reset}
            className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1.5 text-micro font-medium transition-colors"
          >
            <RotateCcw className="size-3" aria-hidden />
            Reset to defaults
          </button>
        </div>
      )}
    </div>
  );
}

function Section({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="py-2">
      <div className="px-3 pb-1">
        <span className="label text-muted-foreground block">{label}</span>
        {hint && <p className="text-faint mt-0.5 text-micro leading-snug">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Row({ label, hint, hintTone, children }: { label: string; hint?: string; hintTone?: "attention"; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex min-h-9 items-center gap-2">
        <span className="text-muted-foreground w-16 shrink-0 text-meta">{label}</span>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
      {hint && <p className={cn("pb-1 pl-[4.5rem] text-micro leading-snug", hintTone === "attention" ? "text-attention-text" : "text-faint")}>{hint}</p>}
    </div>
  );
}

/** Roving-tabindex radio list: ↑/↓ move, Enter/Space pick. One row per option, no boxes. */
function useRoving(count: number, active: number) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (i: number, pick: (j: number) => void) => (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      let j = i;
      for (let k = 0; k < count; k++) {
        j = (j + (e.key === "ArrowDown" ? 1 : -1) + count) % count;
        const el = refs.current[j];
        if (el && !el.disabled) {
          el.focus();
          break;
        }
      }
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      refs.current[e.key === "Home" ? 0 : count - 1]?.focus();
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      pick(i);
    }
  };
  const tabIndex = (i: number) => (i === Math.max(0, active) ? 0 : -1);
  return { refs, onKeyDown, tabIndex };
}

function HarnessList({ list, value, onChange }: { list: HarnessView[]; value: string | null; onChange: (id: string | null) => void }) {
  // Built-ins first (they are the curated defaults), then yours; "None" always on top.
  const ordered = React.useMemo(() => [...list.filter((h) => h.builtin), ...list.filter((h) => !h.builtin)], [list]);
  const rows: (HarnessView | null)[] = [null, ...ordered];
  const active = rows.findIndex((h) => (h?.id ?? null) === value);
  const rov = useRoving(rows.length, active);
  const firstCustom = ordered.findIndex((h) => !h.builtin);
  return (
    <div role="radiogroup" aria-label="Harness">
      {rows.map((h, i) => {
        const on = (h?.id ?? null) === value;
        const disabled = !!h?.needsReview;
        const header = h && !h.builtin && i - 1 === firstCustom && firstCustom > 0 ? "Yours" : h && h.builtin && i === 1 ? "Built-in" : null;
        return (
          <React.Fragment key={h?.id ?? "none"}>
            {header && <div className="text-faint px-3 pt-1.5 pb-0.5 text-micro">{header}</div>}
            <button
              ref={(el) => {
                rov.refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={rov.tabIndex(i)}
              disabled={disabled}
              title={h?.needsReview ? "Imported — review it on the Harnesses page before use" : h?.description}
              onKeyDown={rov.onKeyDown(i, (j) => !rows[j]?.needsReview && onChange(rows[j]?.id ?? null))}
              onClick={() => onChange(h?.id ?? null)}
              className={cn(
                "hover:bg-muted/60 flex min-h-9 w-full cursor-pointer items-start gap-2.5 px-3 py-1.5 text-left transition-colors outline-none focus-visible:bg-muted/60",
                "disabled:cursor-not-allowed disabled:opacity-50",
                on && "bg-muted/40"
              )}
            >
              <span className="mt-0.5 grid size-4 shrink-0 place-items-center">
                {on ? <Check className="text-foreground size-3.5" strokeWidth={2.5} aria-hidden /> : <span className="border-line-strong size-3 rounded-full border" aria-hidden />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-foreground block truncate text-meta">
                  {h ? h.name : "None"}
                  {h?.needsReview && <span className="text-faint ml-1.5 text-micro">needs review</span>}
                </span>
                {(h ? h.description : true) && (
                  <span className="text-muted-foreground block truncate text-micro">{h ? h.description : "Deployment defaults — agent, model and rules"}</span>
                )}
              </span>
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}

function ModelList({ current, models, defaultId, onPick }: RunSettingsModel) {
  const [q, setQ] = React.useState("");
  const shown = React.useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? models.filter((m) => m.label.toLowerCase().includes(s) || m.id.toLowerCase().includes(s)) : models;
  }, [models, q]);
  const active = shown.findIndex((m) => current && m.id === current.id && m.provider === current.provider);
  const rov = useRoving(shown.length, active);
  return (
    <div className="pb-1">
      {models.length > 6 && (
        <label className="mx-3 mb-1 flex h-8 items-center gap-2 border-b">
          <Search className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search models…"
            aria-label="Search models"
            className="text-foreground placeholder:text-faint min-w-0 flex-1 bg-transparent text-meta outline-none"
          />
        </label>
      )}
      <div role="radiogroup" aria-label="Model" className="max-h-52 overflow-y-auto">
        {shown.length === 0 && <p className="text-muted-foreground px-3 py-2 text-micro">Nothing matches “{q}”.</p>}
        {shown.map((m, i) => {
          const on = !!current && m.id === current.id && m.provider === current.provider;
          const header = m.group && m.group !== shown[i - 1]?.group ? m.group : null;
          return (
            <React.Fragment key={`${m.provider ?? ""}:${m.id}`}>
              {header && <div className="text-faint px-3 pt-1.5 pb-0.5 text-micro">{header}</div>}
              <button
                ref={(el) => {
                  rov.refs.current[i] = el;
                }}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={rov.tabIndex(i)}
                onKeyDown={rov.onKeyDown(i, (j) => onPick(shown[j]))}
                onClick={() => onPick(m)}
                className={cn("hover:bg-muted/60 flex h-9 w-full cursor-pointer items-center gap-2.5 px-3 text-left transition-colors outline-none focus-visible:bg-muted/60", on && "bg-muted/40")}
              >
                <span className={cn("size-2 shrink-0 rounded-full", TIER_TINT[m.tier])} aria-hidden />
                <span className="text-foreground min-w-0 flex-1 truncate text-meta">
                  {m.label}
                  {m.id === defaultId && !m.provider && <span className="text-faint ml-1.5 text-micro">default</span>}
                </span>
                <span className="text-faint hidden truncate font-mono text-micro sm:inline">{m.id}</span>
                {on && <Check className="text-foreground size-3.5 shrink-0" strokeWidth={2.5} aria-hidden />}
              </button>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

function VerifyRow({ value, onChange }: { value: VerifySpec | null; onChange: (v: VerifySpec | null) => void }) {
  const mode = value?.mode ?? "command";
  const text = value?.text ?? "";
  return (
    <div>
      <div className="flex min-h-9 items-center gap-2">
        <span className="text-muted-foreground w-16 shrink-0 text-meta">Verify</span>
        <Segmented
          ariaLabel="Verification mode"
          value={mode}
          onChange={(m) => onChange({ mode: m, text })}
          options={[
            { value: "command", label: "Command" },
            { value: "criterion", label: "Criterion" },
          ]}
        />
      </div>
      <div className="pb-1 pl-[4.5rem]">
        <input
          value={text}
          onChange={(e) => onChange(e.target.value ? { mode, text: e.target.value } : null)}
          placeholder={mode === "command" ? "npm test" : "what must be true when it's done"}
          aria-label={mode === "command" ? "Verification command" : "Verification criterion"}
          className={cn(
            "placeholder:text-faint text-foreground bg-muted/60 focus:bg-muted h-8 w-full rounded-md px-2 outline-none transition-colors",
            mode === "command" ? "stamp" : "text-meta"
          )}
        />
        <p className="text-faint mt-1 text-micro leading-snug">
          {mode === "command" ? "Runs in the sandbox after the agent finishes — exit 0 means verified." : "A read-only checker judges this against the workspace; it cannot edit anything."}
        </p>
      </div>
    </div>
  );
}

/* ───────────────────────────── chips ───────────────────────────── */

/**
 * What is off its default, as removable chips. Click the body to open the settings; × resets that
 * one option. Nothing renders when everything is default — the quiet state IS the default state.
 */
export function RunOptionChips({ onOpen, harness, model, agent, attempts, verify, className }: Pick<RunSettingsProps, "harness" | "model" | "agent" | "attempts" | "verify"> & { onOpen: () => void; className?: string }) {
  const still = useReducedMotion();
  const chips: { key: string; icon?: React.ReactNode; label: string; title?: string; remove: () => void }[] = [];
  const cur = harness?.list.find((h) => h.id === harness.value);
  if (harness && cur) chips.push({ key: "harness", icon: <Layers className="size-3" aria-hidden />, label: cur.name, title: `Harness: ${cur.name}`, remove: () => harness.onChange(null) });
  if (model?.offDefault && model.current)
    chips.push({ key: "model", icon: <span className={cn("size-1.5 rounded-full", TIER_TINT[model.current.tier])} aria-hidden />, label: model.current.label, title: `Model: ${model.current.id}`, remove: model.onReset });
  if (agent?.current && agent.current.id !== agent.defaultId) chips.push({ key: "agent", label: agent.current.label, title: "Coding agent", remove: () => agent.onPick(null) });
  if (attempts && attempts.value > 1) chips.push({ key: "attempts", label: `${attempts.value} attempts`, title: "Run the task in parallel; the best attempt gets the PR", remove: () => attempts.onChange(1) });
  if (verify?.value && verify.value.text.trim())
    chips.push({ key: "verify", icon: <ShieldCheck className="size-3" aria-hidden />, label: `Verify · ${verify.value.text.trim()}`, title: verify.value.mode === "command" ? "Verification command" : "Verification criterion", remove: () => verify.onChange(null) });
  if (!chips.length) return null;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)} onClick={(e) => e.stopPropagation()}>
      <AnimatePresence initial={false} mode="popLayout">
        {chips.map((c) => (
          <motion.span
            key={c.key}
            layout={!still}
            initial={still ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={still ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className="bg-muted/80 text-foreground inline-flex h-7 max-w-full items-center rounded-md text-micro"
            title={c.title}
          >
            <button type="button" onClick={onOpen} className="flex min-w-0 cursor-pointer items-center gap-1.5 pl-2 pr-1 font-medium [&_svg]:text-muted-foreground">
              {c.icon}
              <span className="max-w-48 truncate">{c.label}</span>
            </button>
            <button type="button" onClick={c.remove} aria-label={`Remove ${c.label}`} className="text-muted-foreground hover:text-foreground mr-0.5 grid size-5 shrink-0 cursor-pointer place-items-center rounded transition-colors">
              <X className="size-3" />
            </button>
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}
