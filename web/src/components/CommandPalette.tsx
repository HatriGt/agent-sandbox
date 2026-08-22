import * as React from "react";
import { CornerDownLeft, Plus, Search } from "lucide-react";
import type { BoxView } from "@/lib/api";
import { shortName, stateNoun, threadTitle } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * ⌘K. With a handful of machines a list is enough; the palette earns its place because the machine
 * names are generated hex — you recognise a run by its TASK, so searching task text is the fastest
 * way back into one. It also keeps "new task" reachable from inside a thread on any screen size.
 *
 * Deliberately a native <dialog>: it escapes any overflow-hidden ancestor, brings the top layer,
 * focus trapping and Escape for free, and needs no portal.
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
  const [query, setQuery] = React.useState("");
  const [cursor, setCursor] = React.useState(0);

  const close = React.useCallback(() => {
    dialog.current?.close();
    setQuery("");
    setCursor(0);
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const el = dialog.current;
        if (!el) return;
        if (el.open) close();
        else el.showModal();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  const q = query.trim().toLowerCase();
  const matches = q
    ? boxes.filter((b) => `${b.name} ${b.task ?? ""}`.toLowerCase().includes(q))
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
        "text-ink m-0 w-full max-w-xl rounded-lg border bg-[var(--raised)] p-0",
        "fixed top-[12vh] left-1/2 -translate-x-1/2",
        "backdrop:bg-black/50 open:flex open:flex-col"
      )}
    >
      <div className="flex items-center gap-2 border-b px-3.5 py-3">
        <Search className="text-ash size-4 shrink-0" aria-hidden />
        <input
          autoFocus
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
          placeholder="Search machines by task, or start a new one…"
          aria-label="Search machines"
          className="placeholder:text-ash min-w-0 flex-1 bg-transparent text-meta outline-none"
        />
        <kbd className="stamp text-ash rounded border px-1.5 py-0.5">esc</kbd>
      </div>

      <ul className="max-h-[52vh] overflow-y-auto p-1.5">
        {rows.map((row, i) => (
          <li key={row.kind === "new" ? "new" : row.box.name}>
            <button
              type="button"
              onMouseEnter={() => setCursor(i)}
              onClick={() => run(i)}
              className={cn(
                "flex w-full cursor-pointer items-center gap-3 rounded px-2.5 py-2 text-left",
                i === clamped && "bg-[var(--surface)]"
              )}
            >
              {row.kind === "new" ? (
                <>
                  <Plus className="text-azure-text size-3.5 shrink-0" aria-hidden />
                  <span className="text-ink flex-1 text-meta">Start a new task</span>
                </>
              ) : (
                <>
                  <span className="stamp text-ash w-20 shrink-0">{stateNoun(row.box.runState)}</span>
                  <span className="text-ash min-w-0 flex-1 truncate text-meta">
                    {threadTitle(row.box)}
                  </span>
                  <span className="text-ash shrink-0 font-mono text-micro">
                    {shortName(row.box.name)}
                  </span>
                </>
              )}
              {i === clamped && <CornerDownLeft className="text-ash size-3 shrink-0" aria-hidden />}
            </button>
          </li>
        ))}
        {!rows.length && <li className="text-ash px-2.5 py-6 text-center text-meta">No machines match.</li>}
      </ul>
    </dialog>
  );
}
