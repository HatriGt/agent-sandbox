import { Plus } from "lucide-react";
import type { BoxView } from "@/lib/api";
import { roleLabel, shortName, threadSort, threadTitle } from "@/lib/format";
import { StateStamp } from "@/components/ui/stamp";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Threads, ordered by who needs attention. Rows are flat — no cards, no nested borders — separated
 * by a hairline and marked by a left edge when active. A card per machine would be four boxes of
 * chrome around two lines of text.
 */
export function ThreadList({
  boxes,
  pending,
  selected,
  isNew,
  loading,
  onSelect,
  onNew,
}: {
  boxes: BoxView[];
  pending: { id: string; task: string }[];
  selected: string | null;
  isNew: boolean;
  loading: boolean;
  onSelect: (name: string) => void;
  onNew: () => void;
}) {
  const sorted = [...boxes].sort(threadSort);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-3 pb-2">
        <Button
          variant={isNew ? "signal" : "outline"}
          size="md"
          onClick={onNew}
          className="w-full justify-start gap-2"
        >
          <Plus className="size-3.5" />
          New task
        </Button>
      </div>

      <nav aria-label="Sandboxes" className="min-h-0 flex-1 overflow-y-auto">
        {loading && (
          <div className="space-y-4 px-4 py-3" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-2">
                <div className="h-2.5 w-16 rounded-sm bg-[var(--surface)]" />
                <div className="h-3 w-full rounded-sm bg-[var(--surface)]" />
              </div>
            ))}
          </div>
        )}

        {!loading && !sorted.length && !pending.length && (
          <p className="text-ink-faint px-4 py-6 text-[13px] leading-relaxed">
            No machines up. Boots take a few seconds and stop themselves when idle.
          </p>
        )}

        <ul>
          {pending.map((p) => (
            <li key={p.id} className="border-b border-[var(--line)] px-4 py-3">
              <p className="stamp text-ink-faint">
                <span className="breathe">○</span> booting
              </p>
              <p className="text-ink-dim mt-1 line-clamp-2 text-[13px] leading-snug">{p.task}</p>
            </li>
          ))}

          {sorted.map((v) => {
            const active = selected === v.name && !isNew;
            return (
              <li key={v.name}>
                <button
                  type="button"
                  onClick={() => onSelect(v.name)}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "relative w-full cursor-pointer border-b border-[var(--line)] px-4 py-3 text-left",
                    "transition-colors duration-150 hover:bg-[var(--surface)]",
                    active && "bg-[var(--surface)]"
                  )}
                >
                  {/* active edge — the only chrome that marks selection */}
                  {active && <span className="bg-signal absolute inset-y-0 left-0 w-[2px]" aria-hidden />}

                  <div className="flex items-center gap-2">
                    <StateStamp state={v.runState} exitCode={v.exitCode} />
                    <span className="stamp text-ink-faint ml-auto opacity-70">{roleLabel(v.role)}</span>
                  </div>

                  <p
                    className={cn(
                      "mt-1.5 line-clamp-2 text-[13.5px] leading-snug",
                      v.runState === "waiting" ? "text-ink" : "text-ink-dim"
                    )}
                  >
                    {threadTitle(v)}
                  </p>

                  <p className="text-ink-faint tabular mt-1.5 font-mono text-[11px]">
                    {shortName(v.name)}
                    {v.uptime && <span className="ml-2 opacity-70">{v.uptime}</span>}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
