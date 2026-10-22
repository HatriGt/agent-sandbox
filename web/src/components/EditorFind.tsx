import * as React from "react";
import { ArrowDown, ArrowUp, CaseSensitive, ChevronRight, Regex, Replace, ReplaceAll, WholeWord, X } from "lucide-react";
import { motion } from "motion/react";
import { EditorSelection, type EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { SearchQuery, findNext, findPrevious, getSearchQuery, replaceAll, replaceNext, setSearchQuery } from "@codemirror/search";
import { Collapse } from "@/components/ui/collapse";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useReducedMotion } from "@/lib/motion-pref";
import { cn } from "@/lib/utils";

/**
 * The find widget, floating top-right of the editor like VS Code's. The query lives here as React
 * state and is pushed into @codemirror/search's state on every change (`setSearchQuery`), so the
 * package's own highlighter, `findNext`/`findPrevious` and `replaceNext`/`replaceAll` do the work.
 * The package only paints matches while its panel is open, so the host keeps a hidden panel open for
 * as long as this widget is mounted. Matches are counted by walking the query's cursor over the
 * document, capped so a huge file never stalls a keystroke.
 */
export type FindQuery = { search: string; replace: string; caseSensitive: boolean; wholeWord: boolean; regexp: boolean };
type Matches = { total: number; current: number; capped: boolean };

const CAP = 1000;
const EASE = [0.22, 1, 0.36, 1] as const;

// The last query follows the user from file to file, as VS Code's does.
let remembered: FindQuery = { search: "", replace: "", caseSensitive: false, wholeWord: false, regexp: false };

const toQuery = (q: FindQuery) => new SearchQuery(q);

export function countMatches(state: EditorState, q: SearchQuery): Matches {
  if (!q.valid) return { total: 0, current: 0, capped: false };
  const { from, to } = state.selection.main;
  const cursor = q.getCursor(state);
  let total = 0;
  let current = 0;
  for (let r = cursor.next(); !r.done; r = cursor.next()) {
    total++;
    if (r.value.from === from && r.value.to === to) current = total;
    if (total >= CAP) return { total, current, capped: true };
  }
  return { total, current, capped: false };
}

/** The text ⌘F should start from: a short single-line selection, else nothing. */
function seedFrom(state: EditorState): string | null {
  const sel = state.selection.main;
  if (sel.empty || sel.to - sel.from > 100) return null;
  const text = state.sliceDoc(sel.from, sel.to);
  return text.includes("\n") ? null : text;
}

export function EditorFind({ view, nonce, editable, rev, onClose }: { view: EditorView; /** Bumped on every ⌘F so a reopen re-seeds from the selection and refocuses. */ nonce: number; editable: boolean; /** Bumped by the host on document and selection changes so the count stays live. */ rev: number; onClose: () => void }) {
  const still = useReducedMotion();
  const [q, setQ] = React.useState<FindQuery>(() => {
    const cur = getSearchQuery(view.state);
    return cur.search ? { ...remembered, search: cur.search } : remembered;
  });
  const [replaceOpen, setReplaceOpen] = React.useState(false);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const replaceRef = React.useRef<HTMLInputElement>(null);
  const query = React.useMemo(() => toQuery(q), [q]);
  // `rev` is the host's signal that the document or selection moved; the count depends on both.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const matches = React.useMemo(() => countMatches(view.state, query), [view, query, rev]);

  React.useEffect(() => {
    const seed = seedFrom(view.state);
    if (seed !== null) setQ((p) => (p.search === seed ? p : { ...p, search: seed }));
    const el = searchRef.current;
    el?.focus();
    el?.select();
  }, [view, nonce]);
  React.useEffect(() => {
    remembered = q;
    if (!query.eq(getSearchQuery(view.state))) view.dispatch({ effects: setSearchQuery.of(query) });
    // Typing lands on the nearest match at or after the caret (wrapping), as VS Code does, so the
    // count reads "1 of N" and the editor scrolls to it. A selection already on a match stays put.
    if (!query.valid || !q.search) return;
    const { from, to } = view.state.selection.main;
    const first = (start: number) => {
      const r = query.getCursor(view.state, start).next();
      return r.done ? null : r.value;
    };
    const m = first(from) ?? first(0);
    if (m && !(m.from === from && m.to === to)) view.dispatch({ selection: EditorSelection.single(m.from, m.to), scrollIntoView: true, userEvent: "select.search" });
  }, [view, q, query]);

  const set = (patch: Partial<FindQuery>) => setQ((p) => ({ ...p, ...patch }));
  const step = (back: boolean) => (back ? findPrevious : findNext)(view);
  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      step(e.shiftKey);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };
  const onReplaceKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.metaKey || e.ctrlKey) replaceAll(view);
      else replaceNext(view);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };
  const toggleReplace = () => {
    setReplaceOpen((v) => !v);
    if (!replaceOpen) requestAnimationFrame(() => replaceRef.current?.focus());
  };

  const none = q.search.length > 0 && matches.total === 0;
  const count = !q.search ? "" : none ? (query.valid ? "No results" : "Invalid") : `${matches.current || "?"} of ${matches.capped ? "999+" : matches.total}`;

  return (
    <motion.section
      role="search"
      aria-label="Find in file"
      initial={still ? false : { opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={still ? { opacity: 0 } : { opacity: 0, y: -6 }}
      transition={{ duration: 0.12, ease: EASE }}
      className={cn("bg-popover text-popover-foreground shadow-e2 absolute top-2 right-3 z-10 flex items-stretch rounded-md border text-meta", editable && replaceOpen ? "w-[24rem]" : "w-80")}
    >
      {editable && (
        <button type="button" onClick={toggleReplace} aria-expanded={replaceOpen} aria-label={replaceOpen ? "Hide replace" : "Show replace"} className="text-muted-foreground hover:text-foreground hover:bg-muted grid w-5 shrink-0 cursor-pointer place-items-center rounded-l-md border-r">
          <ChevronRight className={cn("size-3 transition-transform duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none", replaceOpen && "rotate-90")} aria-hidden />
        </button>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1 p-1.5">
        <div className="flex items-center gap-1">
          <label className="bg-background focus-within:ring-ring flex h-7 min-w-0 flex-1 items-center gap-0.5 rounded border pl-1.5 focus-within:ring-1">
            <input
              ref={searchRef}
              value={q.search}
              onChange={(e) => set({ search: e.target.value })}
              onKeyDown={onSearchKey}
              placeholder="Find"
              aria-label="Find"
              spellCheck={false}
              autoComplete="off"
              className="text-foreground placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-meta outline-none"
            />
            <FindToggle on={q.caseSensitive} onClick={() => set({ caseSensitive: !q.caseSensitive })} label="Match case">
              <CaseSensitive className="size-3.5" />
            </FindToggle>
            <FindToggle on={q.wholeWord} onClick={() => set({ wholeWord: !q.wholeWord })} label="Match whole word">
              <WholeWord className="size-3.5" />
            </FindToggle>
            <FindToggle on={q.regexp} onClick={() => set({ regexp: !q.regexp })} label="Use regular expression">
              <Regex className="size-3.5" />
            </FindToggle>
          </label>
          <span className={cn("tabular w-[4.25rem] shrink-0 truncate text-right text-micro", none ? "text-destructive" : "text-muted-foreground")} aria-live="polite">
            {count}
          </span>
          <FindButton onClick={() => step(true)} disabled={matches.total === 0} label="Previous match (⇧↵)">
            <ArrowUp className="size-3.5" />
          </FindButton>
          <FindButton onClick={() => step(false)} disabled={matches.total === 0} label="Next match (↵)">
            <ArrowDown className="size-3.5" />
          </FindButton>
          <FindButton onClick={onClose} label="Close (Esc)">
            <X className="size-3.5" />
          </FindButton>
        </div>
        {editable && (
          <Collapse open={replaceOpen} duration={0.14}>
            <div className="flex items-center gap-1">
              <label className="bg-background focus-within:ring-ring flex h-7 min-w-0 flex-1 items-center rounded border px-1.5 focus-within:ring-1">
                <input ref={replaceRef} value={q.replace} onChange={(e) => set({ replace: e.target.value })} onKeyDown={onReplaceKey} placeholder="Replace" aria-label="Replace" spellCheck={false} autoComplete="off" className="text-foreground placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-meta outline-none" />
              </label>
              <FindButton onClick={() => replaceNext(view)} disabled={matches.total === 0} label="Replace (↵)">
                <Replace className="size-3.5" />
              </FindButton>
              <FindButton onClick={() => replaceAll(view)} disabled={matches.total === 0} label="Replace all (⌘↵)">
                <ReplaceAll className="size-3.5" />
              </FindButton>
            </div>
          </Collapse>
        )}
      </div>
    </motion.section>
  );
}

function FindToggle({ on, onClick, label, children }: { on: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" onClick={onClick} aria-pressed={on} aria-label={label} tabIndex={-1} className={cn("grid size-5 shrink-0 cursor-pointer place-items-center rounded", on ? "bg-live/15 text-live" : "text-muted-foreground hover:text-foreground hover:bg-muted")}>
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function FindButton({ onClick, disabled, label, children }: { onClick: () => void; disabled?: boolean; label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" onClick={onClick} disabled={disabled} aria-label={label} className="text-muted-foreground hover:text-foreground hover:bg-muted grid size-6 shrink-0 cursor-pointer place-items-center rounded disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent">
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
