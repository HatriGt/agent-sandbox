import * as React from "react";
import { Link } from "react-router";
import { ChevronDown, Layers, MoreHorizontal, Plus, RotateCcw, SquareSlash, Zap } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { api, type AgentId } from "@/lib/api";
import { useCached } from "@/lib/cache";
import { SkillMark } from "@/lib/skillGlyph";
import { Segmented } from "@/components/ui/segmented";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { HarnessList, ModelList, Row, TIER_TINT, VerifyRow, useMediaQuery, useRoving, type Attempts, type RunSettingsProps } from "@/components/thread/RunSettings";
import type { ModelChoice } from "@/components/thread/ModelPicker";
import { BASE } from "@/lib/route";
import { cn } from "@/lib/utils";

/**
 * The composer's bottom toolbar, shared by the Hub (new task) and the thread's SendBar so the two
 * read as one product. Shape borrowed from Claude.ai / ChatGPT / Cursor / v0 / T3 Chat: one big
 * rounded surface, text first, context chips inside the box, and a quiet row of controls:
 *
 *   [+] [/ Skills] [@] [Harness ▾] [Model ▾] [⋯]  ……  [voice] [send]
 *
 * Every option is one click to its menu and one click to pick (two or fewer), and shows as a chip
 * once set. Icon + label on a desk, icon only below `sm` (390px), and the row never wraps.
 * Menus are popovers on a desk and bottom sheets on a phone; focus lands inside, Esc closes and
 * returns focus to the trigger, reduced motion keeps only the fade.
 */

export type MenuName = "plus" | "skills" | "harness" | "model" | "more";

/** One open menu per composer, plus ⌘. / Ctrl+. → the Model menu (pass `hotkey` on one composer per page). */
export function useComposerMenus(hotkey?: MenuName | false) {
  const [open, setOpen] = React.useState<MenuName | null>(null);
  React.useEffect(() => {
    if (!hotkey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "." && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setOpen((o) => (o === hotkey ? null : hotkey));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkey]);
  return {
    open,
    set: setOpen,
    props: (name: MenuName) => ({ open: open === name, onOpenChange: (v: boolean) => setOpen(v ? name : null) }),
  };
}

/** "Claude Sonnet 4.5" → "Sonnet 4.5": the toolbar label is a name, not a product line. */
export function shortModelLabel(m: ModelChoice | null): string {
  if (!m) return "Model";
  return m.label.replace(/^claude[\s-]+/i, "").replace(/\s*\(.*\)\s*$/, "") || m.id;
}

/* ───────────────────────────── buttons ───────────────────────────── */

type ToolButtonProps = React.ComponentProps<"button"> & {
  icon: React.ReactNode;
  /** Visible on a desk, hidden below `sm`; always the accessible name. */
  label?: string;
  /** Show the label at every width (e.g. a harness that has been picked). */
  keepLabel?: boolean;
  active?: boolean;
  /** Something is set inside — a small live dot (never amber: amber is for needs-you). */
  dot?: boolean;
  caret?: boolean;
  menu?: MenuName;
};

export const ToolButton = React.forwardRef<HTMLButtonElement, ToolButtonProps>(function ToolButton(
  { icon, label, keepLabel, active, dot, caret, menu, className, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      data-composer-menu={menu}
      aria-label={rest["aria-label"] ?? label}
      className={cn(
        "relative flex h-8 min-w-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-full px-2 text-meta font-medium whitespace-nowrap",
        "transition-[background-color,color,scale] duration-150 ease-out active:scale-[0.97] motion-reduce:active:scale-100",
        "focus-visible:ring-live/50 outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0",
        active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
        className
      )}
      {...rest}
    >
      {icon}
      {label && <span className={cn("max-w-32 truncate", !keepLabel && "hidden sm:inline")}>{label}</span>}
      {caret && <ChevronDown className="text-faint hidden !size-3 sm:block" aria-hidden />}
      {dot && <span className="bg-live absolute top-1 right-1 size-1.5 rounded-full" aria-hidden />}
    </button>
  );
});

/* ───────────────────────────── the menu shell ───────────────────────────── */

function popMotion(still: boolean | null, side: "top" | "bottom", align: "start" | "end") {
  const dy = side === "top" ? 4 : -4;
  return {
    initial: still ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: dy },
    animate: { opacity: 1, scale: 1, y: 0 },
    exit: still ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: dy },
    transition: { duration: 0.16, ease: [0.22, 1, 0.36, 1] as const },
    style: { transformOrigin: `${align === "start" ? "0%" : "100%"} ${side === "top" ? "100%" : "0%"}` },
  };
}

export interface ToolMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Title of the panel (sheet header on a phone, aria-label on a desk). */
  title: string;
  trigger: Omit<ToolButtonProps, "onClick" | "active">;
  /** Where the popover grows: "top" above (thread composer), "bottom" below (Hub). */
  side?: "top" | "bottom";
  align?: "start" | "end";
  width?: string;
  children: React.ReactNode;
}

export function ToolMenu({ open, onOpenChange, title, trigger, side = "top", align = "start", width = "w-80", children }: ToolMenuProps) {
  const phone = useMediaQuery("(max-width: 639px)");
  const still = useReducedMotion();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

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
      const first = panelRef.current?.querySelector<HTMLElement>("input, [role=radio][tabindex='0'], [role=menuitem][tabindex='0'], button, a");
      first?.focus();
    }, 40);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
      window.clearTimeout(t);
    };
  }, [open, phone, onOpenChange]);

  return (
    <div ref={rootRef} className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
      <ToolButton ref={triggerRef} {...trigger} active={open} aria-expanded={open} aria-haspopup="dialog" onClick={() => onOpenChange(!open)} />
      {phone ? (
        <Sheet open={open} onOpenChange={onOpenChange}>
          <SheetContent side="bottom" title={title}>
            <div className="-mx-3">{children}</div>
          </SheetContent>
        </Sheet>
      ) : (
        <AnimatePresence>
          {open && (
            <motion.div
              ref={panelRef}
              {...popMotion(still, side, align)}
              role="dialog"
              aria-label={title}
              className={cn(
                "bg-popover text-popover-foreground absolute z-30 max-h-[min(26rem,60vh)] overflow-y-auto rounded-xl border py-1 shadow-e3",
                width,
                side === "top" ? "bottom-full mb-2" : "top-full mt-2",
                align === "start" ? "left-0" : "right-0"
              )}
            >
              {children}
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}

/** A plain menu row (used by `+`). Roving focus comes from `useRoving`. */
function MenuRow({ icon, label, hint, ...rest }: React.ComponentProps<"button"> & { icon: React.ReactNode; label: string; hint?: string }) {
  return (
    <button
      type="button"
      role="menuitem"
      className="hover:bg-muted/60 focus-visible:bg-muted/60 flex min-h-9 w-full cursor-pointer items-center gap-2.5 px-3 py-1.5 text-left outline-none transition-colors [&_svg]:text-muted-foreground [&_svg]:size-4"
      {...rest}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="text-foreground block text-meta">{label}</span>
        {hint && <span className="text-muted-foreground block truncate text-micro">{hint}</span>}
      </span>
    </button>
  );
}

/* ───────────────────────────── the menus ───────────────────────────── */

type Shell = { open: boolean; onOpenChange: (open: boolean) => void; side?: "top" | "bottom" };

/** `+`: attach things. One item → the button acts directly, no menu. */
export function PlusMenu({ items, ...shell }: Shell & { items: { key: string; icon: React.ReactNode; label: string; hint?: string; run: () => void }[] }) {
  const rov = useRoving(items.length, 0);
  if (items.length === 1)
    return <ToolButton icon={<Plus />} aria-label={items[0].label} title={items[0].label} onClick={(e) => (e.stopPropagation(), items[0].run())} />;
  return (
    <ToolMenu {...shell} title="Add to the task" width="w-64" trigger={{ icon: <Plus />, "aria-label": "Add a repository or image", title: "Add a repository or image", menu: "plus" }}>
      <div role="menu" aria-label="Add">
        {items.map((it, i) => (
          <MenuRow
            key={it.key}
            ref={(el: HTMLButtonElement | null) => {
              rov.refs.current[i] = el;
            }}
            tabIndex={rov.tabIndex(i)}
            onKeyDown={rov.onKeyDown(i, (j) => (shell.onOpenChange(false), items[j].run()))}
            icon={it.icon}
            label={it.label}
            hint={it.hint}
            onClick={() => (shell.onOpenChange(false), it.run())}
          />
        ))}
      </div>
    </ToolMenu>
  );
}

/** The empty state both the Skills button and the `/` menu show when you have no enabled skills. */
export function SkillsEmpty({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex flex-col items-start gap-1 px-3 py-2.5">
      <span className="text-foreground text-meta font-medium">No skills yet</span>
      <span className="text-muted-foreground text-micro leading-snug">A skill is a saved playbook the agent runs with your message — add or enable one first.</span>
      <Link to={`${BASE}/skills`} onClick={onNavigate} className="text-live mt-1 inline-flex items-center gap-1 text-micro font-medium hover:underline">
        <Zap className="size-3" aria-hidden />
        Open Skills
      </Link>
    </div>
  );
}

/** `/ Skills`: the enabled skills as a list; a pick becomes the composer's skill chip. */
export function SkillsMenu({ current, onPick, ...shell }: Shell & { current: string | null; onPick: (name: string) => void }) {
  const cached = useCached("skills", (signal) => api.skills(signal));
  const skills = React.useMemo(() => (cached.data?.skills ?? []).filter((s) => s.enabled), [cached.data]);
  const rov = useRoving(skills.length, Math.max(0, skills.findIndex((s) => s.name === current)));
  return (
    <ToolMenu
      {...shell}
      title="Skills"
      trigger={{ icon: <SquareSlash />, label: "Skills", title: "Run a skill with this message ( / )", menu: "skills", dot: !!current }}
    >
      {!cached.data && !cached.error ? (
        <p className="text-muted-foreground px-3 py-2 text-micro">Loading skills…</p>
      ) : skills.length === 0 ? (
        <SkillsEmpty onNavigate={() => shell.onOpenChange(false)} />
      ) : (
        <div role="menu" aria-label="Skills">
          <p className="text-faint px-3 pt-1 pb-1 text-micro">Runs with the rest of your message · type / to filter</p>
          {skills.map((s, i) => (
            <button
              key={s.name}
              ref={(el) => {
                rov.refs.current[i] = el;
              }}
              type="button"
              role="menuitemradio"
              aria-checked={s.name === current}
              tabIndex={rov.tabIndex(i)}
              onKeyDown={rov.onKeyDown(i, (j) => (onPick(skills[j].name), shell.onOpenChange(false)))}
              onClick={() => (onPick(s.name), shell.onOpenChange(false))}
              className={cn(
                "hover:bg-muted/60 focus-visible:bg-muted/60 flex min-h-9 w-full cursor-pointer items-center gap-2.5 px-3 py-1.5 text-left outline-none transition-colors",
                s.name === current && "bg-muted/40"
              )}
            >
              <SkillMark name={s.name} size={15} className="text-muted-foreground shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="stamp text-foreground block font-medium">/{s.name}</span>
                <span className="text-muted-foreground block truncate text-micro">{s.description}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </ToolMenu>
  );
}

/** Harness ▾ — reads "Harness" until one is picked, then its name. */
export function HarnessMenu({ harness, ...shell }: Shell & { harness: NonNullable<RunSettingsProps["harness"]> }) {
  const cur = harness.list.find((h) => h.id === harness.value);
  if (!harness.list.length) return null;
  return (
    <ToolMenu
      {...shell}
      title="Harness"
      trigger={{ icon: <Layers />, label: cur ? cur.name : "Harness", keepLabel: false, caret: true, title: "Harness — a saved setup: agent, model, skills and rules", menu: "harness", dot: !!cur }}
    >
      <p className="text-faint px-3 pt-1 pb-1 text-micro leading-snug">A saved setup — agent, model, skills and rules. Anything you pick in the toolbar still wins.</p>
      <HarnessList
        list={harness.list}
        value={harness.value}
        onChange={(id) => {
          harness.onChange(id);
          shell.onOpenChange(false);
        }}
      />
    </ToolMenu>
  );
}

/** Model ▾ — always shows the short name of what will run ("Sonnet 4.5"); ⌘. opens it. */
export function ModelMenu({ model, disabled, ...shell }: Shell & { model: NonNullable<RunSettingsProps["model"]>; disabled?: boolean }) {
  if (!model.current || !model.models.length) return null;
  return (
    <ToolMenu
      {...shell}
      title="Model"
      width="w-[24rem]"
      trigger={{
        icon: (
          <span className="border-line-strong grid !size-4 place-items-center rounded-full border" aria-hidden>
            <span className={cn("size-1.5 rounded-full", TIER_TINT[model.current.tier])} />
          </span>
        ),
        label: shortModelLabel(model.current),
        "aria-label": `Model: ${model.current.label}`,
        title: "Model (⌘.)",
        caret: true,
        disabled,
        menu: "model",
      }}
    >
      <ModelList
        {...model}
        onPick={(m) => {
          model.onPick(m);
          shell.onOpenChange(false);
        }}
      />
      {model.offDefault && (
        <button
          type="button"
          onClick={() => (model.onReset(), shell.onOpenChange(false))}
          className="text-muted-foreground hover:text-foreground flex h-9 w-full cursor-pointer items-center gap-1.5 border-t px-3 text-micro font-medium transition-colors"
        >
          <RotateCcw className="size-3" aria-hidden />
          Back to the default model
        </button>
      )}
    </ToolMenu>
  );
}

/** ⋯ — the rarely touched options: coding agent, attempts, verification. */
export function MoreMenu({ agent, attempts, verify, ...shell }: Shell & Pick<RunSettingsProps, "agent" | "attempts" | "verify">) {
  const showAgent = !!(agent && agent.choices.length > 1 && agent.current);
  if (!showAgent && !attempts && !verify) return null;
  const set = (agent?.current && agent.current.id !== agent.defaultId) || (attempts && attempts.value > 1) || !!verify?.value?.text.trim();
  return (
    <ToolMenu
      {...shell}
      title="More options"
      width="w-[22rem]"
      trigger={{ icon: <MoreHorizontal />, "aria-label": "More options: agent, attempts, verify", title: "Agent, attempts, verify", menu: "more", dot: !!set }}
    >
      <div className="flex flex-col gap-1 px-3 py-1.5">
        {showAgent && agent?.current && (
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
    </ToolMenu>
  );
}

/** The toolbar row itself: left cluster shrinks, the right cluster (voice, send) never moves. */
export function ComposerToolbar({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  return (
    <div className="flex flex-nowrap items-center gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
      <div className="flex min-w-0 items-center gap-0.5">{left}</div>
      <span className="min-w-0 flex-1" />
      <div className="flex shrink-0 items-center gap-1">{right}</div>
    </div>
  );
}

