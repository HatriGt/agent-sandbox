import * as React from "react";
import { Check, FolderGit2, GitBranch, Lock, RefreshCw, Search, SearchX } from "lucide-react";
import { motion } from "motion/react";
import { useReducedMotion } from "@/lib/motion-pref";
import { api, type RepoInfo } from "@/lib/api";
import { Bar } from "@/components/thread/Skeletons";
import { Kbd } from "@/components/ui/kbd";
import { StaggerItem, Swap } from "@/components/ui/swap";
import { cn } from "@/lib/utils";

/**
 * Pick repositories from the connected GitHub accounts. A searchable list (name prefix ranks first),
 * private lock, default branch, the account that sees it; multi- or single-select. Used by the Hub
 * composer (attach before starting) and by the thread header (attach to a running sandbox).
 */
export interface PickedRepo {
  repo: string;
  ref?: string;
  defaultBranch?: string;
  private?: boolean;
}

export function RepoPicker({
  selected,
  onToggle,
  multi = true,
  onClose,
  className,
}: {
  selected: PickedRepo[];
  onToggle: (repo: RepoInfo) => void;
  multi?: boolean;
  onClose: () => void;
  className?: string;
}) {
  const [q, setQ] = React.useState("");
  const [repos, setRepos] = React.useState<RepoInfo[] | null>(null);
  const [total, setTotal] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const [cursor, setCursor] = React.useState(0);
  const input = React.useRef<HTMLInputElement>(null);

  const load = React.useCallback(
    (query: string, refresh = false, signal?: AbortSignal) =>
      api
        .repos(query, refresh, signal)
        .then((r) => {
          setRepos(r.repos);
          setTotal(r.total);
          setCursor(0);
          setError(null);
        })
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setError(e instanceof Error ? e.message : String(e));
          setRepos([]);
        }),
    []
  );
  React.useEffect(() => {
    const ctrl = new AbortController();
    const t = window.setTimeout(() => void load(q, false, ctrl.signal), q ? 120 : 0);
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
  }, [q, load]);
  React.useEffect(() => {
    requestAnimationFrame(() => input.current?.focus());
  }, []);

  const isOn = (r: RepoInfo) => selected.some((s) => s.repo.toLowerCase() === r.fullName.toLowerCase());
  const still = useReducedMotion();
  // Which body is showing; the Swap crossfades between them instead of the list popping in over the skeleton.
  const phase = repos === null ? "loading" : error ? "error" : repos.length === 0 ? (total === 0 ? "none" : "nomatch") : "list";

  return (
    <div
      role="dialog"
      aria-label="Choose repositories"
      className={cn(
        "bg-popover text-popover-foreground w-[min(28rem,calc(100vw-2rem))] overflow-hidden rounded-xl border shadow-e3",
        className
      )}
      onKeyDown={(e) => {
        if (e.key === "Escape") return onClose();
        if (!repos?.length) return;
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setCursor((c) => Math.min(repos.length - 1, c + 1));
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setCursor((c) => Math.max(0, c - 1));
        } else if (e.key === "Enter") {
          e.preventDefault();
          const r = repos[cursor];
          if (r) {
            onToggle(r);
            if (!multi) onClose();
          }
        }
      }}
    >
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Search className="text-muted-foreground size-4 shrink-0" aria-hidden />
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search repositories…"
          aria-label="Search repositories"
          className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent py-1 text-meta outline-none"
        />
        <button
          type="button"
          onClick={() => {
            setRepos(null);
            void load(q, true);
          }}
          aria-label="Refresh the list from GitHub"
          className="text-muted-foreground hover:text-foreground hover:bg-muted grid size-7 cursor-pointer place-items-center rounded-md"
        >
          <RefreshCw className="size-3.5" />
        </button>
      </div>

      <div className="max-h-72 overflow-y-auto p-1">
        <Swap state={phase}>
          {phase === "loading" ? (
            <ul aria-busy="true" aria-label="Loading repositories">
              {[0, 1, 2, 3, 4].map((i) => (
                <li key={i} className="flex items-center gap-3 px-2.5 py-2">
                  <Bar className="size-4 rounded" />
                  <Bar className="h-3 w-44" />
                  <Bar className="ml-auto h-2.5 w-14" />
                </li>
              ))}
            </ul>
          ) : phase === "error" ? (
            <div role="alert" className="px-3 py-4">
              <p className="text-foreground text-meta font-medium">Couldn't load your repositories.</p>
              <p className="text-muted-foreground mt-1 text-micro leading-relaxed">Check the connected GitHub accounts, then refresh the list.</p>
              <pre className="stamp text-muted-foreground bg-muted/70 mt-2 max-h-16 overflow-auto rounded-md px-2 py-1.5 whitespace-pre-wrap [overflow-wrap:anywhere]">{error}</pre>
            </div>
          ) : phase === "none" || phase === "nomatch" ? (
            <EmptyState
              icon={phase === "none" ? <FolderGit2 /> : <SearchX />}
              title={phase === "none" ? "No repositories yet." : `Nothing matches “${q}”.`}
              body={phase === "none" ? "Connect a GitHub account under GitHub accounts and its repositories appear here." : "Try a shorter name, or refresh the list from GitHub."}
            />
          ) : (
            <ul role="listbox" aria-multiselectable={multi}>
              {repos!.map((r, i) => {
                const on = isOn(r);
                const [owner, name] = r.fullName.split("/");
                return (
                  <li key={r.fullName}>
                    <StaggerItem index={i}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={on}
                        onMouseEnter={() => setCursor(i)}
                        onClick={() => {
                          onToggle(r);
                          if (!multi) onClose();
                        }}
                        className={cn(
                          "relative flex w-full cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors duration-150",
                          i === cursor ? "bg-accent" : "hover:bg-muted"
                        )}
                      >
                        {/* single-select: one highlight that glides to whichever row is picked */}
                        {!multi && on && (
                          <motion.span
                            layoutId="repo-picker-selected"
                            aria-hidden
                            className="bg-primary/8 ring-primary/20 pointer-events-none absolute inset-0 rounded-md ring-1 ring-inset"
                            transition={{ duration: still ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
                          />
                        )}
                        <span
                          className={cn(
                            "relative grid size-4 shrink-0 place-items-center rounded border transition-colors",
                            on ? "border-primary bg-primary text-primary-foreground" : "border-line-strong"
                          )}
                          aria-hidden
                        >
                          {on && <Check className="pop-in size-3" strokeWidth={3} />}
                        </span>
                        <span className="relative min-w-0 flex-1">
                          <span className="flex items-center gap-1.5 text-meta">
                            <span className="text-muted-foreground">{owner}/</span>
                            <span className="text-foreground truncate font-medium">{name}</span>
                            {r.private && <Lock className="text-muted-foreground size-3 shrink-0" aria-label="private" />}
                          </span>
                          {r.description && <span className="text-muted-foreground block truncate text-micro">{r.description}</span>}
                        </span>
                        <span className="stamp text-muted-foreground relative flex shrink-0 items-center gap-1">
                          <GitBranch className="size-3" aria-hidden />
                          {r.defaultBranch}
                        </span>
                      </button>
                    </StaggerItem>
                  </li>
                );
              })}
            </ul>
          )}
        </Swap>
      </div>
      {phase === "list" && (
        <div className="text-muted-foreground flex items-center justify-between border-t px-3 py-1.5 text-micro">
          <span>
            {total} {total === 1 ? "repository" : "repositories"} across your accounts
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd keys={["↑", "↓"]} /> <Kbd>↵</Kbd> {multi ? "toggles" : "picks"} <Kbd>esc</Kbd> closes
          </span>
        </div>
      )}
    </div>
  );
}

/** Nothing to list: an icon, a one-line reason, a nudge. Same body for "no accounts" and "no match". */
function EmptyState({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
      <span className="bg-muted text-muted-foreground grid size-9 place-items-center rounded-full [&_svg]:size-4" aria-hidden>
        {icon}
      </span>
      <p className="text-foreground text-meta font-medium">{title}</p>
      <p className="text-muted-foreground max-w-[26ch] text-micro leading-relaxed">{body}</p>
    </div>
  );
}
