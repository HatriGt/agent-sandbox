import * as React from "react";
import { CornerDownLeft, Plus, Search } from "lucide-react";
import type { BoxView } from "@/lib/api";
import { friendlyName, shortName, threadTitle } from "@/lib/format";
import { StateStamp } from "@/components/ui/stamp";
import { displayState } from "@/lib/lifecycle";
import { cn } from "@/lib/utils";

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
export function CommandPalette({
  boxes,
  onOpen,
  onNew,
}: {
  boxes: BoxView[];
  onOpen: (name: string) => void;
  onNew: () => void;
}) {
  const dialog = React.useRef<HTMLDialogElement>(null);
  const input = React.useRef<HTMLInputElement>(null);
  const [query, setQuery] = React.useState("");
  const [cursor, setCursor] = React.useState(0);

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
  const rows = [{ kind: "new" as const }, ...matches.map((b) => ({ kind: "box" as const, box: b }))];
  const clamped = Math.min(cursor, rows.length - 1);

  const run = (i: number) => {
    const row = rows[i];
    if (!row) return;
    if (row.kind === "new") onNew();
    else onOpen(row.box.name);
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
        "backdrop:bg-black/40 backdrop:backdrop-blur-[2px] open:flex open:flex-col"
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
          placeholder="Search machines by task or name…"
          aria-label="Search machines"
          className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-body outline-none"
        />
        <kbd className="text-muted-foreground rounded border px-1.5 py-0.5">esc</kbd>
      </div>

      <ul className="max-h-[52vh] overflow-y-auto p-1.5">
        {rows.map((row, i) => (
          <li key={row.kind === "new" ? "new" : row.box.name}>
            <button
              type="button"
              onMouseEnter={() => setCursor(i)}
              onClick={() => run(i)}
              className={cn(
                "flex w-full cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-left",
                i === clamped && "bg-accent"
              )}
            >
              {row.kind === "new" ? (
                <>
                  <span className="bg-primary text-primary-foreground grid size-6 shrink-0 place-items-center rounded-md">
                    <Plus className="size-3.5" aria-hidden />
                  </span>
                  <span className="text-foreground flex-1 text-meta font-medium">Start a new task</span>
                </>
              ) : (
                <>
                  <StateStamp state={displayState(row.box)} exitCode={row.box.exitCode} className="w-24 shrink-0" />
                  <span className="text-foreground min-w-0 flex-1 truncate text-meta">{threadTitle(row.box)}</span>
                  <span className="stamp text-muted-foreground shrink-0" title={shortName(row.box.name)}>
                    {friendlyName(row.box.name)}
                  </span>
                </>
              )}
              {i === clamped && <CornerDownLeft className="text-muted-foreground size-3 shrink-0" aria-hidden />}
            </button>
          </li>
        ))}
        {q && !matches.length && (
          <li className="text-muted-foreground px-2.5 py-4 text-center text-meta">No machine matches “{query.trim()}”.</li>
        )}
      </ul>
    </dialog>
  );
}
