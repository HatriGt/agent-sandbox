import * as React from "react";
import { CornerDownLeft, History, Plus, Search, SearchX } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
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

/** Anything in the app can open the palette by dispatching this on `document`. */
export const OPEN_PALETTE_EVENT = "asb:open-palette";
export function openPalette() {
  document.dispatchEvent(new CustomEvent(OPEN_PALETTE_EVENT));
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
  run: () => void;
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
  const reduce = useReducedMotion();

  const close = React.useCallback(() => {
    dialog.current?.close();
    setQuery("");
    setCursor(0);
  }, []);
  const open = React.useCallback(() => {
    const el = dialog.current;
    if (!el || el.open) return;
    el.showModal();
    // `autoFocus` only fires on mount; a dialog opened later needs an explicit focus.
    requestAnimationFrame(() => input.current?.focus());
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (dialog.current?.open) close();
        else open();
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener(OPEN_PALETTE_EVENT, open);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener(OPEN_PALETTE_EVENT, open);
    };
  }, [close, open]);

  const q = query.trim().toLowerCase();
  const matches = q
    ? boxes.filter((b) => `${friendlyName(b.name)} ${b.name} ${b.task ?? ""}`.toLowerCase().includes(q))
    : boxes;
  const acts = q ? actions.filter((a) => `${a.label} ${a.hint ?? ""} ${a.keywords ?? ""} ${a.group ?? ""}`.toLowerCase().includes(q)) : actions;
  // Recents only earn a group when there is no query and something to recall that is still alive.
  const recentBoxes = q ? [] : recent.map((n) => boxes.find((b) => b.name === n)).filter((b): b is BoxView => !!b);
  const recentSet = new Set(recentBoxes.map((b) => b.name));
  type Row = { kind: "new" } | { kind: "box"; box: BoxView; group: "Recent" | "Machines" } | { kind: "action"; action: PaletteAction };
  // Actions keep their declared order but are bucketed by group, so "Go to" pages sit together and
  // one-off commands (theme, shortcuts) follow — the same order every open, which is what makes a
  // palette learnable.
  const grouped = new Map<string, PaletteAction[]>();
  for (const a of acts) {
    const g = a.group ?? "Actions";
    grouped.set(g, [...(grouped.get(g) ?? []), a]);
  }
  const rows: Row[] = [
    ...(!q || "start a new task".includes(q) ? [{ kind: "new" as const }] : []),
    ...recentBoxes.map((b) => ({ kind: "box" as const, box: b, group: "Recent" as const })),
    ...matches.filter((b) => !recentSet.has(b.name)).map((b) => ({ kind: "box" as const, box: b, group: "Machines" as const })),
    ...[...grouped.values()].flat().map((a) => ({ kind: "action" as const, action: a })),
  ];
  const groupOf = (r: Row) => (r.kind === "new" ? null : r.kind === "action" ? (r.action.group ?? "Actions") : r.group);
  const clamped = Math.min(cursor, rows.length - 1);
  // Arrowing past the fold keeps the cursor row in view — the list scrolls, the cursor never hides.
  const list = React.useRef<HTMLUListElement>(null);
  React.useEffect(() => {
    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [clamped]);

  const run = (i: number) => {
    const row = rows[i];
    if (!row) return;
    if (row.kind === "new") onNew();
    else if (row.kind === "action") row.action.run();
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
        <Search className="text-muted-foreground size-4 shrink-0" aria-hidden />
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
            }
          }}
          placeholder="Search machines, or type an action…"
          aria-label="Search machines"
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
                    <span className="text-foreground flex-1 text-meta">{row.action.label}</span>
                    {row.action.hint && <Kbd keys={row.action.hint.split(" ")} />}
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
                <CornerDownLeft className={cn("text-muted-foreground size-3 shrink-0 transition-opacity duration-100", i === clamped ? "opacity-100" : "opacity-0")} aria-hidden />
              </button>
            </li>
          );
        })}
        {q && !matches.length && !acts.length && (
          // Empty state with a hint: say what IS searched, so a miss is a nudge rather than a dead end.
          <li className="flex flex-col items-center gap-2 px-2.5 py-6 text-center">
            <span className="bg-muted text-muted-foreground grid size-9 place-items-center rounded-full">
              <SearchX className="size-4" aria-hidden />
            </span>
            <p className="text-foreground text-meta">No machine matches “{query.trim()}”.</p>
            <p className="text-muted-foreground text-micro">Search by task text or machine name, or clear the search to see everything.</p>
          </li>
        )}
        {!q && !boxes.length && (
          <li className="text-muted-foreground px-2.5 pt-1 pb-2 text-micro" aria-hidden>
            No machines yet — start a task and it shows up here.
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
      </div>
    </dialog>
  );
}
