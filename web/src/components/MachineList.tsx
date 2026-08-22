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
        <div className="space-y-3 px-3 py-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2 rounded-md p-2">
              <div className="h-2.5 w-16 rounded-full bg-[var(--surface)]" />
              <div className="h-3 w-full rounded-full bg-[var(--surface)]" />
            </div>
          ))}
        </div>
      )}

      {!loading && !sorted.length && !pending.length && (
        <p className="text-ash px-4 py-6 text-[13.5px] leading-relaxed">
          No machines up. A boot takes a few seconds, and idle machines stop themselves.
        </p>
      )}

      <ul>
        {pending.map((p) => (
          <li key={p.id} className="mx-2 rounded-md px-3 py-2.5">
            <p className="stamp text-ash">
              <span className="breathe">○</span> booting
            </p>
            <p className="text-ash mt-1 line-clamp-2 text-[13.5px] leading-snug">{p.task}</p>
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
                  "relative mx-2 w-[calc(100%-1rem)] cursor-pointer rounded-md px-3 py-2.5 text-left",
                  "transition-colors duration-150 hover:bg-[var(--surface)]",
                  active && "bg-[var(--surface)]"
                )}
              >
                {active && (
                  <span className="bg-azure absolute inset-y-2 left-0 w-[3px] rounded-full" aria-hidden />
                )}

                <div className="flex items-center gap-2">
                  <StateStamp state={v.runState} exitCode={v.exitCode} />
                  <span className="stamp text-ash ml-auto opacity-70">{roleLabel(v.role)}</span>
                </div>

                <p
                  className={cn(
                    "mt-1.5 line-clamp-2 text-[14px] leading-snug",
                    v.runState === "waiting" ? "text-ink font-medium" : "text-ink"
                  )}
                >
                  {threadTitle(v)}
                </p>

                <p className="text-ash tabular mt-1.5 font-mono text-[12px]">
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
