import * as React from "react";
import { ChevronLeft, ChevronRight, CornerDownLeft, History, Plus, Search, SearchX } from "lucide-react";
import { motion } from "motion/react";
import { useReducedMotion } from "@/lib/motion-pref";
import type { BoxView } from "@/lib/api";
import { fmtAgo, friendlyName, shortName, threadTitle } from "@/lib/format";
import { StateStamp } from "@/components/ui/stamp";
import { Kbd } from "@/components/ui/kbd";
import { displayState } from "@/lib/lifecycle";
import { cn } from "@/lib/utils";

/** The last few machines opened from the palette, newest first — sessionStorage, this tab only. */
const RECENT_KEY = "asb-palette-recent";
const RECENT_MAX = 4;
function readRecent(): string[] {
  try {
    const raw = sessionStorage.getItem(RECENT_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function pushRecent(name: string): string[] {
  const next = [name, ...readRecent().filter((n) => n !== name)].slice(0, RECENT_MAX);
  try {
    sessionStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
  return next;
}

/** Anything in the app can open the palette by dispatching this on `document`; `detail` names an
 *  action id whose sub-list should open directly (the status bar's model section). */
export const OPEN_PALETTE_EVENT = "asb:open-palette";
export function openPalette(enter?: string) {
  document.dispatchEvent(new CustomEvent(OPEN_PALETTE_EVENT, { detail: enter }));
}

/**
 * ⌘K. With a handful of machines a list is enough; the palette earns its place because you recognise
 * a run by its TASK, so searching task text is the fastest way back into one. It also keeps
 * "new task" reachable from inside a thread on any screen size.
 *
 * A native <dialog>: top layer, focus trap and Escape for free, no portal.
 */
export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  /** Section header the action lists under ("Go to"); actions without one land in "Actions". */
  group?: string;
  /** Extra words the search should match ("theme dark light") that aren't in the label. */
  keywords?: string;
  /** Dimmer trailing text ("current", a model id). */
  detail?: string;
  /** A sub-list ("Run playbook ›"): choosing this row shows these instead of running anything. */
  sub?: PaletteAction[];
  run?: () => void;
}

export function CommandPalette({
  boxes,
  actions = [],
  onOpen,
  onNew,
}: {
  boxes: BoxView[];
  actions?: PaletteAction[];
  onOpen: (name: string) => void;
  onNew: () => void;
}) {
  const dialog = React.useRef<HTMLDialogElement>(null);
  const input = React.useRef<HTMLInputElement>(null);
  const [query, setQuery] = React.useState("");
  const [cursor, setCursor] = React.useState(0);
  const [recent, setRecent] = React.useState<string[]>(readRecent);
  // The sub-list the user stepped into (Run playbook ›); null is the top level.
  const [parent, setParent] = React.useState<PaletteAction | null>(null);
  const reduce = useReducedMotion();

  const close = React.useCallback(() => {
    dialog.current?.close();
    setQuery("");
    setCursor(0);
    setParent(null);
  }, []);
  const open = React.useCallback(() => {
    const el = dialog.current;
    if (!el || el.open) return;
    el.showModal();
    // `autoFocus` only fires on mount; a dialog opened later needs an explicit focus.
    requestAnimationFrame(() => input.current?.focus());
  }, []);

  const actionsRef = React.useRef(actions);
  actionsRef.current = actions;
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (dialog.current?.open) close();
        else open();
      }
    };
    const onOpen = (e: Event) => {
      const want = e instanceof CustomEvent && typeof e.detail === "string" ? actionsRef.current.find((a) => a.id === e.detail && a.sub) : undefined;
      setParent(want ?? null);
      setQuery("");
      setCursor(0);
      open();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
    };
  }, [close, open]);

  const q = query.trim().toLowerCase();
  const matchAct = (a: PaletteAction) => `${a.label} ${a.hint ?? ""} ${a.keywords ?? ""} ${a.detail ?? ""} ${a.group ?? ""}`.toLowerCase().includes(q);
  const matches = parent ? [] : q ? boxes.filter((b) => `${friendlyName(b.name)} ${b.name} ${b.task ?? ""}`.toLowerCase().includes(q)) : boxes;
  const pool = parent ? parent.sub ?? [] : actions;
  const acts = q ? pool.filter(matchAct) : pool;
  // Recents only earn a group when there is no query and something to recall that is still alive.
  const recentBoxes = q || parent ? [] : recent.map((n) => boxes.find((b) => b.name === n)).filter((b): b is BoxView => !!b);
  const recentSet = new Set(recentBoxes.map((b) => b.name));
  type Row = { kind: "new" } | { kind: "box"; box: BoxView; group: "Recent" | "Machines" } | { kind: "action"; action: PaletteAction };
  // Actions keep their declared order but are bucketed by group, so "Go to" pages sit together and
  // one-off commands (theme, shortcuts) follow — the same order every open, which is what makes a
  // palette learnable.
  const grouped = new Map<string, PaletteAction[]>();
  for (const a of acts) {
    const g = a.group ?? (parent ? parent.label : "Actions");
    grouped.set(g, [...(grouped.get(g) ?? []), a]);
  }
  const rows: Row[] = [
    ...(!parent && (!q || "start a new task".includes(q)) ? [{ kind: "new" as const }] : []),
    ...recentBoxes.map((b) => ({ kind: "box" as const, box: b, group: "Recent" as const })),
    ...matches.filter((b) => !recentSet.has(b.name)).map((b) => ({ kind: "box" as const, box: b, group: "Machines" as const })),
    ...[...grouped.values()].flat().map((a) => ({ kind: "action" as const, action: a })),
  ];
  const groupOf = (r: Row) => (r.kind === "new" ? null : r.kind === "action" ? (r.action.group ?? (parent ? parent.label : "Actions")) : r.group);
  const clamped = Math.min(cursor, rows.length - 1);
  // Arrowing past the fold keeps the cursor row in view — the list scrolls, the cursor never hides.
  const list = React.useRef<HTMLUListElement>(null);
  React.useEffect(() => {
    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [clamped]);

  const enter = (a: PaletteAction) => {
    setParent(a);
    setQuery("");
    setCursor(0);
    input.current?.focus();
  };
  const back = () => {
    setParent(null);
    setQuery("");
    setCursor(0);
    input.current?.focus();
  };
  const run = (i: number) => {
    const row = rows[i];
    if (!row) return;
    if (row.kind === "action" && row.action.sub) return enter(row.action);
    if (row.kind === "new") onNew();
    else if (row.kind === "action") row.action.run?.();
    else {
      setRecent(pushRecent(row.box.name));
      onOpen(row.box.name);
    }
    close();
  };

  return (
    <dialog
      ref={dialog}
      onClose={close}
      onClick={(e) => {
        if (e.target === dialog.current) close();
      }}
      aria-label="Command palette"
      className={cn(
        "text-foreground bg-popover m-0 w-[calc(100%-2rem)] max-w-xl rounded-xl border p-0",
        "shadow-e4",
        "fixed top-[12vh] left-1/2 -translate-x-1/2",
        "backdrop:bg-black/40 backdrop:backdrop-blur-[2px] open:flex open:flex-col",
        // Scale + fade in and out. `starting:` gives the entry frame; allow-discrete keeps the
        // dialog painted (display/overlay) until the exit transition finishes.
        "origin-top scale-[0.97] opacity-0 transition-[opacity,scale,display,overlay] transition-discrete duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
        "open:scale-100 open:opacity-100 starting:open:scale-[0.97] starting:open:opacity-0 motion-reduce:scale-100 motion-reduce:duration-100"
      )}
    >
      <div className="flex items-center gap-2.5 border-b px-3.5 py-3">
        {parent ? (
          <button type="button" onClick={back} aria-label="Back to all commands" className="text-muted-foreground hover:text-foreground flex shrink-0 cursor-pointer items-center gap-1 text-micro">
            <ChevronLeft className="size-4" aria-hidden />
            {parent.label}
          </button>
        ) : (
          <Search className="text-muted-foreground size-4 shrink-0" aria-hidden />
        )}
        <input
          ref={input}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setCursor((c) => Math.min(c + 1, rows.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(clamped);
            } else if (parent && ((e.key === "Backspace" && !query) || e.key === "ArrowLeft")) {
              e.preventDefault();
              back();
            } else if (e.key === "ArrowRight") {
              const row = rows[clamped];
              if (row?.kind === "action" && row.action.sub) {
                e.preventDefault();
                run(clamped);
              }
            }
          }}
          placeholder={parent ? `Search ${parent.label.toLowerCase()}…` : "Search machines, or type an action…"}
          aria-label={parent ? `Search ${parent.label}` : "Search machines"}
          className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-body outline-none"
        />
        <Kbd>esc</Kbd>
      </div>

      <ul ref={list} className="max-h-[52vh] overflow-y-auto p-1.5" role="listbox" aria-label="Results">
        {rows.map((row, i) => {
          const group = groupOf(row);
          const heads = group && (i === 0 || groupOf(rows[i - 1]) !== group);
          return (
            <li key={row.kind === "new" ? "new" : row.kind === "action" ? `act-${row.action.id}` : row.box.name} role="none">
              {heads && (
                <p className={cn("label text-faint flex items-center gap-1.5 px-2.5 pb-1", i === 0 ? "pt-1" : "pt-2.5")} aria-hidden>
                  {group === "Recent" && <History className="size-3" />}
                  {group}
                </p>
              )}
              <button
                type="button"
                role="option"
                aria-selected={i === clamped}
                onMouseEnter={() => setCursor(i)}
                onClick={() => run(i)}
                className="group relative isolate flex h-10 w-full cursor-pointer items-center gap-3 rounded-md px-2.5 text-left"
              >
                {i === clamped && (
                  <motion.span
                    layoutId="palette-cursor"
                    className="bg-accent absolute inset-0 -z-10 rounded-md"
                    transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 700, damping: 48, mass: 0.6 }}
                    aria-hidden
                  />
                )}
                {row.kind === "new" ? (
                  <>
                    <span className="bg-primary text-primary-foreground grid size-6 shrink-0 place-items-center rounded-md">
                      <Plus className="size-3.5" aria-hidden />
                    </span>
                    <span className="text-foreground flex-1 text-meta font-medium">Start a new task</span>
                    <Kbd>n</Kbd>
                  </>
                ) : row.kind === "action" ? (
                  <>
                    <span className="bg-muted text-muted-foreground grid size-6 shrink-0 place-items-center rounded-md [&_svg]:size-3.5">{row.action.icon}</span>
                    <span className="text-foreground min-w-0 flex-1 truncate text-meta">{row.action.label}</span>
                    {row.action.detail && <span className="text-faint hidden shrink-0 truncate text-micro sm:inline">{row.action.detail}</span>}
                    {row.action.hint && <Kbd keys={row.action.hint.split(" ")} />}
                    {row.action.sub && <ChevronRight className="text-muted-foreground size-3.5 shrink-0" aria-hidden />}
                  </>
                ) : (
                  <>
                    <StateStamp state={displayState(row.box)} exitCode={row.box.exitCode} className="w-24 shrink-0" />
                    <span className="text-foreground min-w-0 flex-1 truncate text-meta">{threadTitle(row.box)}</span>
                    {row.box.lastOutputAt && <span className="text-faint tabular hidden shrink-0 text-micro sm:inline">{fmtAgo(row.box.lastOutputAt)}</span>}
                    <span className="stamp text-muted-foreground shrink-0" title={shortName(row.box.name)}>
                      {friendlyName(row.box.name)}
                    </span>
                  </>
                )}
                {!(row.kind === "action" && row.action.sub) && (
                  <CornerDownLeft className={cn("text-muted-foreground size-3 shrink-0 transition-opacity duration-100", i === clamped ? "opacity-100" : "opacity-0")} aria-hidden />
                )}
              </button>
            </li>
          );
        })}
        {q && !rows.length && (
          // Empty state with a hint: say what IS searched, so a miss is a nudge rather than a dead end.
          <li className="flex flex-col items-center gap-2 px-2.5 py-6 text-center">
            <span className="bg-muted text-muted-foreground grid size-9 place-items-center rounded-full">
              <SearchX className="size-4" aria-hidden />
            </span>
            <p className="text-foreground text-meta">{parent ? `Nothing in ${parent.label} matches “${query.trim()}”.` : `No machine matches “${query.trim()}”.`}</p>
            {!parent && <p className="text-muted-foreground text-micro">Search by task text or machine name, or clear the search to see everything.</p>}
          </li>
        )}
        {!q && !parent && !boxes.length && (
          <li className="text-muted-foreground px-2.5 pt-1 pb-2 text-micro" aria-hidden>
            No machines yet — start a task and it shows up here.
          </li>
        )}
        {!q && parent && !rows.length && (
          <li className="text-muted-foreground px-2.5 pt-1 pb-2 text-micro" aria-hidden>
            Nothing here yet.
          </li>
        )}
      </ul>
      <div className="text-faint flex items-center gap-3 border-t px-3.5 py-2 text-micro">
        <span className="flex items-center gap-1.5">
          <Kbd keys={["↑", "↓"]} /> move
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>↵</Kbd> open
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>esc</Kbd> close
        </span>
        <span className="tabular ml-auto" aria-live="polite">
          {rows.length} {rows.length === 1 ? "result" : "results"}
        </span>
      </div>
    </dialog>
  );
}
