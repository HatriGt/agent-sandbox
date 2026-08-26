import * as React from "react";
import { FileCode2, FileText, Folder, GitBranch } from "lucide-react";
import { Bar } from "./Skeletons";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * `@` file mentions, the Cursor way: typing `@` in the composer opens a list of workspace files that
 * narrows as you type; ↑/↓ moves, Enter/Tab inserts `@path`, Esc dismisses. Results come from the
 * controller's per-box file index (one `find`, cached), so each keystroke is cheap.
 */
export interface MentionState {
  /** Index of the `@` that opened the menu, in the textarea value. */
  start: number;
  query: string;
}

/** Find an active `@query` token ending at the caret, or null. */
export function mentionAt(value: string, caret: number): MentionState | null {
  const before = value.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/[\s(\[]/.test(before[at - 1])) return null; // an email or mid-word @
  const query = before.slice(at + 1);
  if (/\s/.test(query)) return null;
  return { start: at, query };
}

export function MentionMenu({
  session,
  repos = [],
  state,
  onPick,
  onClose,
}: {
  session: string;
  repos?: { name: string; branch?: string }[];
  state: MentionState;
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const [files, setFiles] = React.useState<string[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [cursor, setCursor] = React.useState(0);

  React.useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    const t = window.setTimeout(() => {
      api
        .files(session, state.query, ctrl.signal)
        .then((r) => {
          setFiles(r.files);
          setTotal(r.total);
          setCursor(0);
        })
        .catch(() => setFiles([]))
        .finally(() => setLoading(false));
    }, 80);
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
  }, [session, state.query]);

  // Keyboard is owned by the textarea; it forwards navigation here via a custom event.
  React.useEffect(() => {
    const onNav = (e: Event) => {
      const key = (e as CustomEvent<string>).detail;
      if (key === "ArrowDown") setCursor((c) => Math.min(files.length - 1, c + 1));
      else if (key === "ArrowUp") setCursor((c) => Math.max(0, c - 1));
      else if (key === "Enter" || key === "Tab") {
        if (files[cursor]) onPick(files[cursor]);
      } else if (key === "Escape") onClose();
    };
    document.addEventListener("asb:mention-nav", onNav);
    return () => document.removeEventListener("asb:mention-nav", onNav);
  }, [files, cursor, onPick, onClose]);

  return (
    <div
      role="listbox"
      aria-label="Files in the workspace"
      className="bg-popover text-popover-foreground absolute inset-x-2 bottom-full z-20 mb-2 max-h-72 overflow-y-auto rounded-xl border p-1 shadow-[0_1px_2px_oklch(0_0_0/0.06),0_16px_40px_-16px_oklch(0_0_0/0.35)]"
    >
      <div className="text-muted-foreground flex items-center justify-between gap-3 px-2.5 py-1.5 text-micro">
        <span className="flex min-w-0 items-center gap-2">
          {repos.length > 0 ? (
            <>
              <GitBranch className="size-3 shrink-0" aria-hidden />
              <span className="truncate">
                Searching {repos.map((r) => r.name).join(", ")}
                {state.query ? ` for “${state.query}”` : ""}
              </span>
            </>
          ) : (
            <span>{state.query ? `Files matching “${state.query}”` : "Workspace files"}</span>
          )}
        </span>
        {!loading && total > 0 && <span className="tabular shrink-0">{total} indexed</span>}
      </div>
      {loading && files.length === 0 && (
        <div className="flex flex-col gap-1 px-1 pb-1" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-2.5 px-2.5 py-1.5">
              <Bar className="size-3.5 rounded" />
              <Bar className="h-3 w-32" />
              <Bar className="ml-auto h-2.5 w-20" />
            </div>
          ))}
        </div>
      )}
      {!loading && files.length === 0 && (
        <div className="text-muted-foreground px-3 py-4 text-meta">
          {total === 0 ? (
            repos.length ? (
              <>The index is empty — the checkout may still be in progress. Try again in a moment.</>
            ) : (
              <>
                <span className="text-foreground font-medium">No files to mention.</span> This sandbox has no repository
                attached — the run is task-only, so /workspace holds only what the agent writes.
              </>
            )
          ) : (
            <>Nothing matches “{state.query}”. Try part of the file name.</>
          )}
        </div>
      )}
      {files.map((f, i) => {
        const base = f.slice(f.lastIndexOf("/") + 1);
        const dir = f.slice(0, Math.max(0, f.lastIndexOf("/")));
        const Icon = /\.(ts|tsx|js|jsx|py|go|rs|java|rb|sh|c|cpp|h|css|json|ya?ml|toml)$/i.test(base) ? FileCode2 : FileText;
        return (
          <button
            key={f}
            type="button"
            role="option"
            aria-selected={i === cursor}
            onMouseEnter={() => setCursor(i)}
            onMouseDown={(e) => {
              e.preventDefault(); // keep the textarea focused
              onPick(f);
            }}
            className={cn(
              "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-meta",
              i === cursor ? "bg-accent text-foreground" : "text-foreground"
            )}
          >
            <Icon className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
            <span className="truncate font-medium">{base}</span>
            {dir && (
              <span className="text-muted-foreground stamp ml-auto flex min-w-0 items-center gap-1 truncate">
                <Folder className="size-3 shrink-0" aria-hidden />
                <span className="truncate">{dir}</span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Expand `@path` mentions into an explicit footnote so the agent reads the right files. */
export function expandMentions(text: string): string {
  const paths = [...new Set([...text.matchAll(/(?:^|[\s(\[])@([^\s)\]]+)/g)].map((m) => m[1]))];
  if (!paths.length) return text;
  return `${text}\n\nReferenced files (under /workspace): ${paths.map((p) => `/workspace/${p}`).join(", ")}`;
}
