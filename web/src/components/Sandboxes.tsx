import * as React from "react";
import { MessageSquare, PauseCircle, Trash2 } from "lucide-react";
import { api, type BoxView } from "@/lib/api";
import { roleLabel, shortName, threadSort } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { StateStamp } from "@/components/ui/stamp";
import { cn } from "@/lib/utils";

/**
 * The Sandboxes section: every machine, and what it is doing, with its actions in reach.
 *
 * This is its own section rather than a sidebar list because the two questions are different jobs:
 * the chat answers "what am I building", this answers "what is running on my VPS right now, and does
 * any of it need me". So it leads with the queue of halted machines, then the full inventory with
 * live vitals and per-machine actions.
 *
 * Deliberately no charts. Nothing about a run survives its machine, so any trend line here would be
 * invented data — see DESIGN.md and PRODUCT.md.
 */
export function Sandboxes({
  boxes,
  onOpen,
  onDestroyed,
}: {
  boxes: BoxView[];
  onOpen: (name: string) => void;
  onDestroyed: (name: string) => void;
}) {
  const waiting = boxes.filter((b) => b.runState === "waiting");
  const working = boxes.filter((b) => b.runState === "running");
  const pool = boxes.filter((b) => b.role === "pool-free");
  const sorted = [...boxes].sort(threadSort);

  return (
    <div className="h-full min-w-0 overflow-y-auto">
      <div className="mx-auto max-w-[1100px] px-5 py-8 md:px-8 md:py-10">
        <header className="mb-8">
          <h1 className="text-ink text-[32px] leading-[1.05] font-bold tracking-[-0.03em] sm:text-[40px]">
            Sandboxes
          </h1>
          <p className="text-ash mt-2 max-w-[60ch] text-[15px]">
            Every microVM currently up, and what its agent is doing. Machines stop themselves when
            idle and take their history with them.
          </p>
        </header>

        <div className="mb-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="up" value={boxes.length} />
          <Tile label="working" value={working.length} />
          <Tile label="need you" value={waiting.length} accent={waiting.length > 0} />
          <Tile label="warm pool" value={pool.length} />
        </div>

        {/* Halted machines block on a person, so they lead — and are answerable from here. */}
        {waiting.length > 0 && (
          <section className="mb-10" aria-labelledby="queue">
            <h2 id="queue" className="stamp text-azure-text mb-3">
              waiting on you
            </h2>
            <ul className="flex flex-col gap-3">
              {waiting.map((b) => (
                <li key={b.name}>
                  <button
                    type="button"
                    onClick={() => onOpen(b.name)}
                    className="flex w-full cursor-pointer items-start gap-4 rounded-lg border border-[var(--accent-edge)] bg-[var(--accent-wash)] p-5 text-left transition-colors hover:brightness-[1.03]"
                  >
                    <PauseCircle className="text-azure-text mt-0.5 size-5 shrink-0" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="stamp text-ash block">{shortName(b.name)}</span>
                      <span className="text-ink mt-1.5 block text-[16px] leading-snug">
                        {b.question ?? b.task ?? "Waiting for an answer"}
                      </span>
                    </span>
                    <span className="text-azure-text shrink-0 text-[14px] font-medium">Answer →</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="all">
          <h2 id="all" className="stamp text-ash mb-3">
            all machines
          </h2>

          {!sorted.length ? (
            <div className="rounded-lg border border-dashed py-16 text-center">
              <p className="text-ink text-[16px] font-medium">Nothing is up</p>
              <p className="text-ash mt-1 text-[14px]">A machine boots in a few seconds when you start a task.</p>
            </div>
          ) : (
            <ul className="grid gap-3 lg:grid-cols-2">
              {sorted.map((b) => (
                <SandboxCard key={b.name} box={b} onOpen={onOpen} onDestroyed={onDestroyed} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function SandboxCard({
  box,
  onOpen,
  onDestroyed,
}: {
  box: BoxView;
  onOpen: (name: string) => void;
  onDestroyed: (name: string) => void;
}) {
  // Destructive, so it takes two clicks and disarms itself rather than sitting primed.
  const [armed, setArmed] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  React.useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);

  const destroy = async () => {
    if (!armed) return setArmed(true);
    setRemoving(true);
    try {
      await api.teardown(box.name);
      onDestroyed(box.name);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <li className="flex flex-col rounded-lg border bg-[var(--surface)] p-5">
      <div className="flex items-center gap-3">
        <StateStamp state={box.runState} exitCode={box.exitCode} />
        <span className="stamp text-ash ml-auto opacity-70">{roleLabel(box.role)}</span>
      </div>

      <p className="text-ink mt-3 line-clamp-3 text-[15px] leading-snug">
        {box.task ?? <span className="text-ash italic">Idle machine, no task</span>}
      </p>

      {box.question && (
        <p className="text-azure-text mt-2 line-clamp-2 text-[13.5px]">Asking: {box.question}</p>
      )}

      <p className="text-ash tabular mt-4 flex flex-wrap gap-x-4 font-mono text-[12px]">
        <span>{shortName(box.name)}</span>
        {box.uptime && <span>up {box.uptime}</span>}
        {box.cpu && <span>cpu {box.cpu}</span>}
        {box.mem && <span>{box.mem.split(" / ")[0]}</span>}
      </p>

      <div className="mt-4 flex items-center gap-2 border-t pt-4">
        <Button
          size="sm"
          variant={box.runState === "waiting" ? "primary" : "outline"}
          onClick={() => onOpen(box.name)}
        >
          {box.runState === "waiting" ? <PauseCircle /> : <MessageSquare />}
          {box.runState === "waiting" ? "Answer" : "Open"}
        </Button>
        <Button
          size="sm"
          variant="danger"
          onClick={destroy}
          disabled={removing}
          className={cn("ml-auto", armed && "bg-[color-mix(in_srgb,var(--danger)_16%,transparent)]")}
          aria-label={armed ? `Confirm destroying ${box.name}` : `Destroy ${box.name}`}
        >
          <Trash2 />
          {removing ? "destroying" : armed ? "confirm?" : "Destroy"}
        </Button>
      </div>
    </li>
  );
}

function Tile({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-[var(--surface)] px-5 py-4",
        accent && "border-[var(--accent-edge)] bg-[var(--accent-wash)]"
      )}
    >
      <p className={cn("tabular text-[28px] leading-none font-bold tracking-[-0.02em]", accent && "text-azure-text")}>
        {value}
      </p>
      <p className="stamp text-ash mt-2">{label}</p>
    </div>
  );
}
