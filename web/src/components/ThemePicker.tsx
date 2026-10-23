import * as React from "react";
import { Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { THEMES, applyTheme, readTheme, setTheme, useTheme, type Scheme, type Theme, type ThemeId } from "@/lib/theme";
import { cn } from "@/lib/utils";

/**
 * The theme panel: a popover of theme cards in two columns, grouped by scheme. Each card is a
 * miniature of the console drawn in the theme's own tones (registry `preview`), so a card shows
 * what the console will look like before it is chosen. Resting the pointer on a card for 150ms
 * previews the theme on the whole app without storing it; leaving the panel puts the chosen theme
 * back; a click (or Enter) commits. Arrow keys walk the grid and preview as they go. Switching has
 * no transition: a theme changes a hundred times a day for some people and is not a moment.
 *
 * `children` is the trigger (a footer button, a rail icon, the Account row).
 */
export function ThemePicker({ children, side = "top", align = "end" }: { children: React.ReactElement; side?: "top" | "right" | "bottom" | "left"; align?: "start" | "center" | "end" }) {
  const current = useTheme();
  const [open, setOpen] = React.useState(false);
  const [cursor, setCursor] = React.useState<ThemeId>(current.id);
  const timer = React.useRef(0);
  const previewed = React.useRef<ThemeId | null>(null);
  const cards = React.useRef(new Map<ThemeId, HTMLButtonElement>());

  const cancelPending = () => window.clearTimeout(timer.current);
  const preview = (id: ThemeId) => {
    previewed.current = id;
    applyTheme(id);
  };
  const revert = React.useCallback(() => {
    cancelPending();
    if (previewed.current === null) return;
    previewed.current = null;
    applyTheme(readTheme());
  }, []);
  React.useEffect(() => revert, [revert]);

  const commit = (id: ThemeId) => {
    cancelPending();
    previewed.current = null;
    setTheme(id);
    setOpen(false);
  };
  const onOpenChange = (next: boolean) => {
    if (!next) revert();
    else setCursor(current.id);
    setOpen(next);
  };
  const move = (from: ThemeId, delta: number) => {
    const i = ORDER.findIndex((t) => t.id === from);
    const next = ORDER[Math.min(ORDER.length - 1, Math.max(0, i + delta))];
    if (next.id === from) return;
    setCursor(next.id);
    cards.current.get(next.id)?.focus();
    cancelPending();
    preview(next.id);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLUMNS, ArrowUp: -COLUMNS, Home: -ORDER.length, End: ORDER.length }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    move(cursor, step);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        className="scrollbar-thin max-h-(--radix-popover-content-available-height) w-[21rem] overflow-y-auto p-2"
        data-theme-panel
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          cards.current.get(current.id)?.focus();
        }}
        onPointerLeave={revert}
      >
        <div role="radiogroup" aria-label="Theme" onKeyDown={onKeyDown}>
          {SCHEMES.map(({ scheme, label }) => (
            <React.Fragment key={scheme}>
              <div className="label text-faint px-1.5 pt-1.5 pb-1.5 not-first:pt-2.5">{label}</div>
              <div className="grid grid-cols-2 gap-1.5">
                {THEMES.filter((t) => t.scheme === scheme).map((t) => (
                  <ThemeCard
                    key={t.id}
                    ref={(el) => {
                      if (el) cards.current.set(t.id, el);
                      else cards.current.delete(t.id);
                    }}
                    theme={t}
                    active={t.id === current.id}
                    tabbable={t.id === cursor}
                    onPointerEnter={() => {
                      cancelPending();
                      timer.current = window.setTimeout(() => preview(t.id), HOVER_PREVIEW_MS);
                    }}
                    onPointerLeave={cancelPending}
                    onFocus={() => setCursor(t.id)}
                    onClick={() => commit(t.id)}
                  />
                ))}
              </div>
            </React.Fragment>
          ))}
        </div>
        <p className="text-faint px-1.5 pt-2 pb-0.5 text-micro">Rest on a card to try it. Click to keep it.</p>
      </PopoverContent>
    </Popover>
  );
}

const HOVER_PREVIEW_MS = 150;
const COLUMNS = 2;
const SCHEMES: { scheme: Scheme; label: string }[] = [
  { scheme: "light", label: "Light" },
  { scheme: "dark", label: "Dark" },
];
/** Reading order of the grid: light cards then dark, the order the arrow keys walk. */
const ORDER = SCHEMES.flatMap(({ scheme }) => THEMES.filter((t) => t.scheme === scheme));

function ThemeCard({ theme, active, tabbable, ref, ...rest }: { theme: Theme; active: boolean; tabbable: boolean } & React.ComponentProps<"button">) {
  return (
    <button
      ref={ref}
      type="button"
      role="radio"
      aria-checked={active}
      aria-label={`${theme.label}: ${theme.description}`}
      data-theme-card={theme.id}
      tabIndex={tabbable ? 0 : -1}
      className={cn(
        "group flex cursor-pointer flex-col gap-1 rounded-xl p-1.5 text-left outline-none transition-[background-color,transform] duration-100 ease-[cubic-bezier(0.22,1,0.36,1)]",
        "hover:bg-accent active:scale-[0.985] focus-visible:bg-accent",
        active && "ring-ring ring-2"
      )}
      {...rest}
    >
      <Miniature theme={theme} />
      <span className="flex h-5 items-center gap-1 px-1">
        <span className="text-meta truncate font-medium">{theme.label}</span>
        <Check className={cn("ml-auto size-3.5 shrink-0", active ? "text-foreground" : "invisible")} aria-hidden />
      </span>
    </button>
  );
}

/**
 * The console at a glance, in the theme's own tones: a rail strip on the left, the sheet with its
 * hairline frame, a task bubble, two text lines, a live dot and the composer bar. Real DOM, so it
 * is sharp at any scale and tracks the registry rather than a screenshot.
 */
function Miniature({ theme }: { theme: Theme }) {
  const p = theme.preview;
  const line = (tone: string, width: string, opacity = 1) => <span className="block h-[3px] rounded-full" style={{ background: tone, width, opacity }} />;
  return (
    <span className="flex h-[4.25rem] overflow-hidden rounded-md" style={{ background: p.sidebar, boxShadow: `inset 0 0 0 1px ${p.border}` }} aria-hidden>
      <span className="flex w-[27%] shrink-0 flex-col gap-[5px] px-1.5 pt-2">
        {line(p.foreground, "70%", 0.75)}
        <span className="flex items-center gap-1">
          <span className="size-[4px] shrink-0 rounded-full" style={{ background: p.live }} />
          {line(p.live, "60%")}
        </span>
        <span className="flex items-center gap-1">
          <span className="size-[4px] shrink-0 rounded-full" style={{ background: p.live }} />
          {line(p.live, "45%")}
        </span>
        {line(p.muted, "65%", 0.8)}
        <span className="mt-auto mb-1.5 block h-[7px] w-[85%] rounded-[2px]" style={{ background: p.foreground, opacity: 0.85 }} />
      </span>
      <span className="mt-1.5 flex min-w-0 flex-1 flex-col gap-[5px] rounded-tl-[5px] border-t border-l px-2 pt-2 pb-1.5" style={{ background: p.background, borderColor: p.border }}>
        <span className="self-end rounded-[4px] border px-1.5 py-1" style={{ background: p.card, borderColor: p.border, width: "48%" }}>
          {line(p.foreground, "100%", 0.75)}
        </span>
        {line(p.foreground, "78%")}
        {line(p.muted, "52%")}
        <span className="flex items-center gap-1">
          <span className="size-[5px] shrink-0 rounded-full" style={{ background: p.live }} />
          {line(p.live, "26%")}
        </span>
        <span className="mt-auto flex h-[11px] items-center justify-between rounded-[4px] border px-1" style={{ background: p.card, borderColor: p.border }}>
          <span className="block h-[5px] w-px" style={{ background: p.live }} />
          <span className="size-[5px] rounded-full" style={{ background: p.foreground, opacity: 0.85 }} />
        </span>
      </span>
    </span>
  );
}
