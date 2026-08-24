import * as React from "react";
import { ArrowLeft, MessageSquare, PauseCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { roleLabel, shortName, threadSort, threadTitle } from "@/lib/format";
import type { StableBox } from "@/hooks/useStableBoxes";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StateStamp } from "@/components/ui/stamp";
import { cn } from "@/lib/utils";

/**
 * The Sandboxes section: the fleet management surface.
 *
 * The chat answers "what am I building"; this answers "what is running on my VPS right now, and does
 * any of it need me". It leads with the queue of halted machines (the only thing with a deadline),
 * then a scannable TABLE of every machine — state, task, vitals, actions in aligned columns, so
 * machines are comparable at a glance. On mobile the table collapses to stacked rows.
 *
 * Deliberately no KPI tiles and no charts: the fleet is a handful of machines, so big-number cards
 * are decoration, and nothing about a run survives its machine, so a trend line would be invented
 * data (PRODUCT.md).
 */
export function Sandboxes({
  boxes,
  onOpen,
  onDestroyed,
  onBack,
}: {
  boxes: StableBox[];
  onOpen: (name: string) => void;
  onDestroyed: (name: string) => void;
  /** Mobile-only: return to the machines rail. */
  onBack: () => void;
}) {
  const waiting = boxes.filter((b) => b.runState === "waiting" && !b.leaving);
  const working = boxes.filter((b) => b.runState === "running" && !b.leaving).length;
  const pool = boxes.filter((b) => b.role === "pool-free" && !b.leaving).length;
  const sorted = [...boxes].sort(threadSort);

  return (
    <div className="h-full min-w-0 overflow-y-auto">
      <div className="mx-auto max-w-[1100px] px-5 py-8 md:px-8 md:py-10">
        <header className="mb-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="text-ash -ml-2 mb-2 md:hidden"
            aria-label="Back to machines"
          >
            <ArrowLeft className="size-4" />
            Machines
          </Button>
          <h1 className="text-ink text-h1 font-bold tracking-[-0.03em]">Sandboxes</h1>
          <p className="text-ash mt-2 max-w-[62ch] text-body">
            Every microVM currently up, and what its agent is doing. Machines stop themselves when
            idle and take their history with them.
          </p>
          {/* One honest summary line, not a wall of KPI cards. */}
          <p className="stamp text-ash mt-4 flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>
              <span className="text-ink tabular">{boxes.length}</span> up
            </span>
            <span>
              <span className="text-ink tabular">{working}</span> working
            </span>
            <span className={cn(waiting.length > 0 && "text-[var(--attention-text)]")}>
              <span className="tabular">{waiting.length}</span> need you
            </span>
            <span>
              <span className="text-ink tabular">{pool}</span> warm pool
            </span>
          </p>
        </header>

        {waiting.length > 0 && (
          <section className="mb-8" aria-labelledby="queue">
            <h2 id="queue" className="stamp mb-2.5 text-[var(--attention-text)]">
              waiting on you
            </h2>
            <ul className="flex flex-col gap-2.5">
              {waiting.map((b) => (
                <li key={b.name}>
                  <button
                    type="button"
                    onClick={() => onOpen(b.name)}
                    className="flex w-full cursor-pointer items-start gap-3 rounded-lg border border-[color-mix(in_srgb,var(--attention)_45%,transparent)] bg-[color-mix(in_srgb,var(--attention)_10%,transparent)] p-4 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--attention)_16%,transparent)]"
                  >
                    <PauseCircle className="mt-0.5 size-4.5 shrink-0 text-[var(--attention-text)]" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="stamp text-ash block">{shortName(b.name)}</span>
                      <span className="text-ink mt-1 block text-lead leading-snug">
                        {b.question ?? b.task ?? "Waiting for an answer"}
                      </span>
                    </span>
                    <span className="shrink-0 text-meta font-medium text-[var(--attention-text)]">Answer →</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="all">
          <h2 id="all" className="stamp text-ash mb-2.5">
            all machines
          </h2>

          {!sorted.length ? (
            <Card className="border-dashed">
              <CardContent className="py-14 text-center">
                <p className="text-ink text-lead font-medium">Nothing is up</p>
                <p className="text-ash mt-1 text-meta">
                  A machine boots in a few seconds when you start a task.
                </p>
              </CardContent>
            </Card>
          ) : (
            <MachineTable boxes={sorted} onOpen={onOpen} onDestroyed={onDestroyed} />
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * The fleet as a table on desktop, stacked rows on mobile. Columns are aligned so state, task and
 * vitals are comparable down the list — the whole point of a management surface.
 */
function MachineTable({
  boxes,
  onOpen,
  onDestroyed,
}: {
  boxes: StableBox[];
  onOpen: (name: string) => void;
  onDestroyed: (name: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border">
      {/* header row — desktop only; on mobile each card carries its own labels */}
      <div className="stamp text-ash hidden grid-cols-[9rem_minmax(0,1fr)_10rem_11rem] items-center gap-3 border-b bg-[var(--surface)] px-4 py-2.5 md:grid">
        <span>state</span>
        <span>task</span>
        <span>vitals</span>
        <span className="text-right">actions</span>
      </div>
      <ul className="divide-y">
        {boxes.map((b) => (
          <MachineRow key={b.name} box={b} onOpen={onOpen} onDestroyed={onDestroyed} />
        ))}
      </ul>
    </div>
  );
}

function MachineRow({
  box,
  onOpen,
  onDestroyed,
}: {
  box: StableBox;
  onOpen: (name: string) => void;
  onDestroyed: (name: string) => void;
}) {
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
      toast.success(`${shortName(box.name)} destroyed`);
      onDestroyed(box.name);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not destroy the machine");
    } finally {
      setRemoving(false);
    }
  };

  const waiting = box.runState === "waiting";

  return (
    <li
      className={cn(
        "grid grid-cols-1 gap-2 px-4 py-3 transition-colors hover:bg-[var(--surface)]",
        "md:grid-cols-[9rem_minmax(0,1fr)_10rem_11rem] md:items-center md:gap-3",
        box.leaving && "opacity-50"
      )}
    >
      {/* state */}
      <div className="flex items-center gap-2">
        <StateStamp state={box.runState} exitCode={box.exitCode} />
        {box.leaving ? (
          <Badge variant="outline" className="stamp md:hidden">
            shutting down
          </Badge>
        ) : (
          <span className="stamp text-ash opacity-70 md:hidden">{roleLabel(box.role)}</span>
        )}
      </div>

      {/* task */}
      <div className="min-w-0">
        <p className="text-ink truncate text-meta">
          {box.task ? threadTitle(box) : <span className="text-ash italic">Idle machine, no task</span>}
        </p>
        {box.question && (
          <p className="truncate text-micro text-[var(--attention-text)]">Asking: {box.question}</p>
        )}
        <p className="text-ash tabular mt-0.5 font-mono text-micro md:hidden">
          {shortName(box.name)}
          {box.uptime && <span className="ml-2 opacity-70">up {box.uptime}</span>}
        </p>
      </div>

      {/* vitals — desktop column */}
      <div className="text-ash tabular hidden flex-col gap-0.5 font-mono text-micro md:flex">
        <span className="text-ink">{shortName(box.name)}</span>
        <span className="flex gap-2 opacity-80">
          {box.uptime && <span>up {box.uptime}</span>}
          {box.cpu && <span>cpu {box.cpu}</span>}
        </span>
        {box.mem && <span className="opacity-80">mem {box.mem.split(" / ")[0]}</span>}
      </div>

      {/* actions */}
      <div className="flex items-center gap-2 md:justify-end">
        <Button
          size="sm"
          variant={waiting ? "primary" : "outline"}
          onClick={() => onOpen(box.name)}
          disabled={box.leaving}
        >
          {waiting ? <PauseCircle /> : <MessageSquare />}
          {waiting ? "Answer" : "Open"}
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="danger"
              onClick={destroy}
              disabled={removing || box.leaving}
              aria-label={armed ? `Confirm destroying ${box.name}` : `Destroy ${box.name}`}
            >
              <Trash2 />
              <span className="hidden sm:inline">
                {removing ? "destroying" : armed ? "confirm?" : "Destroy"}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Stops the microVM and discards its workspace</TooltipContent>
        </Tooltip>
      </div>
    </li>
  );
}
