import { ArrowRight, Cpu, PauseCircle } from "lucide-react";
import type { BoxView } from "@/lib/api";
import { roleLabel, shortName, threadSort, threadTitle } from "@/lib/format";
import { StateStamp } from "@/components/ui/stamp";
import { cn } from "@/lib/utils";

/**
 * The fleet at a glance — the "is anything wrong?" view, not a metrics dashboard.
 *
 * Deliberately absent: trends, sparklines, totals over time. Nothing about a run survives its
 * machine, so any chart here would be invented. What exists is the current state of each machine,
 * and the queue of ones that have halted waiting for a human.
 */
export function Overview({ boxes, onOpen }: { boxes: BoxView[]; onOpen: (name: string) => void }) {
  const waiting = boxes.filter((b) => b.runState === "waiting");
  const running = boxes.filter((b) => b.runState === "running");
  const pool = boxes.filter((b) => b.role === "pool-free");
  const sorted = [...boxes].sort(threadSort);

  return (
    <div className="h-full min-w-0 overflow-y-auto px-4 py-6 md:px-6">
      <div className="mx-auto max-w-4xl">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-[var(--line)] sm:grid-cols-4">
          <Tile label="machines up" value={boxes.length} />
          <Tile label="working" value={running.length} tone={running.length ? "live" : undefined} />
          <Tile label="need you" value={waiting.length} tone={waiting.length ? "signal" : undefined} />
          <Tile label="warm pool" value={pool.length} />
        </div>

        {/* The approval queue: a halted machine is blocking on a person, so it is a queue, not a row
            in a table. Answering is one click away from here. */}
        {waiting.length > 0 && (
          <section className="mt-8" aria-labelledby="queue">
            <h2 id="queue" className="stamp text-signal pb-3">
              waiting on you
            </h2>
            <ul className="flex flex-col gap-2">
              {waiting.map((b) => (
                <li key={b.name}>
                  <button
                    type="button"
                    onClick={() => onOpen(b.name)}
                    className="border-signal/40 hover:bg-[color-mix(in_oklch,var(--signal)_10%,transparent)] flex w-full cursor-pointer items-start gap-3 rounded-lg border bg-[color-mix(in_oklch,var(--signal)_6%,transparent)] p-4 text-left transition-colors"
                  >
                    <PauseCircle className="text-signal mt-0.5 size-4 shrink-0" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="text-ink-faint block font-mono text-[11px]">{shortName(b.name)}</span>
                      <span className="text-ink mt-1 block text-[14px] leading-snug">
                        {b.question ?? threadTitle(b)}
                      </span>
                    </span>
                    <span className="text-signal shrink-0 text-[12.5px] font-medium">Answer →</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-8" aria-labelledby="all">
          <h2 id="all" className="stamp text-ink-faint pb-3">
            all machines
          </h2>
          {!sorted.length ? (
            <p className="text-ink-faint py-8 text-center text-[13px]">
              Nothing is up. Start a task and a machine boots in seconds.
            </p>
          ) : (
            <ul className="overflow-hidden rounded-lg border">
              {sorted.map((b) => (
                <li key={b.name} className="border-b last:border-b-0">
                  <button
                    type="button"
                    onClick={() => onOpen(b.name)}
                    className="group flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--surface)]"
                  >
                    <StateStamp state={b.runState} exitCode={b.exitCode} className="w-28 shrink-0" />
                    <span className="text-ink-dim min-w-0 flex-1 truncate text-[13.5px]">{threadTitle(b)}</span>
                    <span className="text-ink-faint tabular hidden shrink-0 font-mono text-[11px] sm:block">
                      {b.cpu && <span className="mr-3">cpu {b.cpu}</span>}
                      {b.mem && <span className="mr-3">{b.mem.split(" / ")[0]}</span>}
                      {b.uptime}
                    </span>
                    <span className="stamp text-ink-faint hidden w-24 shrink-0 text-right opacity-70 md:block">
                      {roleLabel(b.role)}
                    </span>
                    <ArrowRight className="text-ink-faint size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: "live" | "signal" }) {
  return (
    <div className="bg-[var(--bg)] p-4">
      <div className="flex items-center gap-1.5">
        <Cpu className="text-ink-faint size-3" aria-hidden />
        <span className="stamp text-ink-faint">{label}</span>
      </div>
      <p
        className={cn(
          "tabular mt-2 text-[26px] leading-none font-semibold tracking-tight",
          tone === "live" && "text-live",
          tone === "signal" && "text-signal"
        )}
      >
        {value}
      </p>
    </div>
  );
}
