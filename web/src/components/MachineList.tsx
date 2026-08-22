import type { BoxView } from "@/lib/api";
import { roleLabel, shortName, threadSort, threadTitle } from "@/lib/format";
import { StateStamp } from "@/components/ui/stamp";
import { cn } from "@/lib/utils";

/**
 * The machines, ordered for triage: anything halted on a question first, then working, then the
 * rest. Flat rows on hairlines — a card per machine would be four borders around two lines of text.
 */
export function MachineList({
  boxes,
  pending,
  selected,
  loading,
  onSelect,
}: {
  boxes: BoxView[];
  pending: { id: string; task: string }[];
  selected: string | null;
  loading: boolean;
  onSelect: (name: string) => void;
}) {
  const sorted = [...boxes].sort(threadSort);

  return (
    <nav aria-label="Machines" className="min-h-0 flex-1 overflow-y-auto">
      {loading && (
        <div className="space-y-4 px-4 py-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2">
              <div className="h-2.5 w-16 rounded bg-[var(--surface)]" />
              <div className="h-3 w-full rounded bg-[var(--surface)]" />
            </div>
          ))}
        </div>
      )}

      {!loading && !sorted.length && !pending.length && (
        <p className="text-ink-faint px-4 py-6 text-[13px] leading-relaxed">
          No machines up. A boot takes a few seconds, and idle machines stop themselves.
        </p>
      )}

      <ul>
        {pending.map((p) => (
          <li key={p.id} className="border-b px-4 py-3">
            <p className="stamp text-ink-faint">
              <span className="breathe">○</span> booting
            </p>
            <p className="text-ink-dim mt-1 line-clamp-2 text-[13px] leading-snug">{p.task}</p>
          </li>
        ))}

        {sorted.map((v) => {
          const active = selected === v.name;
          return (
            <li key={v.name}>
              <button
                type="button"
                onClick={() => onSelect(v.name)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "relative w-full cursor-pointer border-b px-4 py-3 text-left transition-colors duration-150",
                  "hover:bg-[var(--surface)]",
                  active && "bg-[var(--surface)]"
                )}
              >
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
  );
}
