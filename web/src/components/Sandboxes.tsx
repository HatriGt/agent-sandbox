import * as React from "react";
import { MessageSquare, PauseCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { roleLabel, shortName, threadSort } from "@/lib/format";
import type { StableBox } from "@/hooks/useStableBoxes";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StateStamp } from "@/components/ui/stamp";
import { cn } from "@/lib/utils";

/**
 * The Sandboxes section: every machine, and what it is doing, with its actions in reach.
 *
 * Its own section rather than a sidebar list, because the two questions are different jobs: the chat
 * answers "what am I building", this answers "what is running on my VPS right now, and does any of
 * it need me". So it leads with the queue of halted machines, then the inventory.
 *
 * Built on shadcn Card / Badge / Separator / Tooltip so spacing, radii and type come from the same
 * system as everything else rather than from per-component guesses.
 *
 * Deliberately no charts: nothing about a run survives its machine, so a trend line would be
 * invented data (PRODUCT.md).
 */
export function Sandboxes({
  boxes,
  onOpen,
  onDestroyed,
}: {
  boxes: StableBox[];
  onOpen: (name: string) => void;
  onDestroyed: (name: string) => void;
}) {
  const waiting = boxes.filter((b) => b.runState === "waiting" && !b.leaving);
  const working = boxes.filter((b) => b.runState === "running" && !b.leaving);
  const pool = boxes.filter((b) => b.role === "pool-free" && !b.leaving);
  const sorted = [...boxes].sort(threadSort);

  return (
    <div className="h-full min-w-0 overflow-y-auto">
      <div className="mx-auto max-w-[1100px] px-5 py-8 md:px-8 md:py-10">
        <header className="mb-8">
          <h1 className="text-ink text-h1 font-bold tracking-[-0.03em] sm:text-display">Sandboxes</h1>
          <p className="text-ash mt-2 max-w-[60ch] text-body">
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
                      <span className="text-ink mt-1.5 block text-lead">
                        {b.question ?? b.task ?? "Waiting for an answer"}
                      </span>
                    </span>
                    <span className="text-azure-text shrink-0 text-meta font-medium">Answer →</span>
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
            <Card className="border-dashed">
              <CardContent className="py-14 text-center">
                <p className="text-ink text-lead font-medium">Nothing is up</p>
                <p className="text-ash mt-1 text-meta">
                  A machine boots in a few seconds when you start a task.
                </p>
              </CardContent>
            </Card>
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
  box: StableBox;
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
      toast.success(`${shortName(box.name)} destroyed`);
      onDestroyed(box.name);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not destroy the machine");
    } finally {
      setRemoving(false);
    }
  };

  return (
    <li>
      <Card className={cn("h-full gap-0 py-0 transition-opacity", box.leaving && "opacity-50")}>
        <CardHeader className="flex-row items-center gap-3 px-5 pt-5 pb-0">
          <StateStamp state={box.runState} exitCode={box.exitCode} />
          {/* A machine mid-shutdown says so, instead of blinking out of the list. */}
          {box.leaving ? (
            <Badge variant="outline" className="stamp ml-auto">
              shutting down
            </Badge>
          ) : (
            <span className="stamp text-ash ml-auto opacity-70">{roleLabel(box.role)}</span>
          )}
        </CardHeader>

        <CardContent className="px-5 pt-3 pb-0">
          <p className="text-ink line-clamp-3 text-body">
            {box.task ?? <span className="text-ash italic">Idle machine, no task</span>}
          </p>

          {box.question && (
            <p className="text-azure-text mt-2 line-clamp-2 text-meta">Asking: {box.question}</p>
          )}

          <p className="text-ash tabular mt-4 flex flex-wrap gap-x-4 font-mono text-micro">
            <span>{shortName(box.name)}</span>
            {box.uptime && <span>up {box.uptime}</span>}
            {box.cpu && <span>cpu {box.cpu}</span>}
            {box.mem && <span>{box.mem.split(" / ")[0]}</span>}
          </p>
        </CardContent>

        <CardFooter className="mt-4 flex-col items-stretch gap-0 px-0 pb-0">
          <Separator />
          <div className="flex items-center gap-2 px-5 py-4">
            <Button
              size="sm"
              variant={box.runState === "waiting" ? "primary" : "outline"}
              onClick={() => onOpen(box.name)}
              disabled={box.leaving}
            >
              {box.runState === "waiting" ? <PauseCircle /> : <MessageSquare />}
              {box.runState === "waiting" ? "Answer" : "Open"}
            </Button>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={destroy}
                  disabled={removing || box.leaving}
                  className="ml-auto"
                  aria-label={armed ? `Confirm destroying ${box.name}` : `Destroy ${box.name}`}
                >
                  <Trash2 />
                  {removing ? "destroying" : armed ? "confirm?" : "Destroy"}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Stops the microVM and discards its workspace</TooltipContent>
            </Tooltip>
          </div>
        </CardFooter>
      </Card>
    </li>
  );
}

function Tile({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <Card
      className={cn("gap-0 py-0", accent && "border-[var(--accent-edge)] bg-[var(--accent-wash)]")}
    >
      <CardContent className="px-5 py-4">
        <p className={cn("tabular text-h2 font-bold tracking-[-0.02em]", accent && "text-azure-text")}>
          {value}
        </p>
        <p className="stamp text-ash mt-2">{label}</p>
      </CardContent>
    </Card>
  );
}
