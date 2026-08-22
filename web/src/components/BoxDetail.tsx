import * as React from "react";
import { ArrowLeft, Trash2 } from "lucide-react";
import { api, type BoxView, type WatchSnapshot } from "@/lib/api";
import { POLL_MS, roleLabel, shortName, stateLabel, stateVariant } from "@/lib/format";
import { usePoll } from "@/hooks/usePoll";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LogTerminal } from "@/components/LogTerminal";
import { WaitingBanner } from "@/components/WaitingBanner";
import { AskPanel, type AskMessage } from "@/components/AskPanel";

/**
 * One box, in full: what it needs from you (if anything), what it is doing, and a co-pilot to ask
 * about it. Polls /watch.json for this box on its own cadence so the log stays live independently of
 * the fleet list.
 */
export function BoxDetail({
  box,
  askMessages,
  setAskMessages,
  onBack,
  onTornDown,
  onRefresh,
}: {
  box: BoxView;
  askMessages: AskMessage[];
  setAskMessages: (next: AskMessage[]) => void;
  onBack: () => void;
  onTornDown: (name: string) => void;
  onRefresh: () => void;
}) {
  const { data: snap } = usePoll<WatchSnapshot>((signal) => api.watch(box.name, signal), POLL_MS, [box.name]);

  // Destructive, so it takes two clicks — and it disarms itself rather than leaving a primed
  // delete button sitting there. A modal would be heavier than the action deserves.
  const [armed, setArmed] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  React.useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);
  React.useEffect(() => {
    setArmed(false);
  }, [box.name]);

  const teardown = async () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setRemoving(true);
    try {
      await api.teardown(box.name);
      onTornDown(box.name);
    } finally {
      setRemoving(false);
      setArmed(false);
    }
  };

  const question = snap?.question ?? box.question;
  const runState = snap?.runState ?? box.runState;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-start gap-3 border-b px-4 py-3.5 md:px-5">
        <Button
          size="icon"
          variant="ghost"
          onClick={onBack}
          aria-label="Back to the fleet"
          className="md:hidden shrink-0"
        >
          <ArrowLeft />
        </Button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate font-mono text-sm font-semibold">
              <span className="sm:hidden">{shortName(box.name)}</span>
              <span className="hidden sm:inline">{box.name}</span>
            </h1>
            <Badge variant={stateVariant(runState)}>{stateLabel({ runState, exitCode: snap?.exitCode ?? box.exitCode })}</Badge>
          </div>
          {box.task && <p className="text-muted-foreground mt-1.5 max-w-[75ch] text-xs leading-relaxed">{box.task}</p>}
          <p className="text-muted-foreground/80 tabular mt-1.5 flex flex-wrap gap-x-3 text-[11px]">
            {box.uptime && <span>up {box.uptime}</span>}
            {box.cpu && <span>cpu {box.cpu}</span>}
            {box.mem && <span>mem {box.mem}</span>}
            <span>{roleLabel(box.role)}</span>
          </p>
        </div>

        <Button
          size="sm"
          variant="destructive"
          onClick={teardown}
          disabled={removing}
          className="shrink-0"
          aria-label={armed ? "Confirm teardown — this destroys the box" : `Tear down ${box.name}`}
        >
          <Trash2 />
          {removing ? "Removing…" : armed ? "Confirm?" : "Teardown"}
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:px-5">
        {runState === "waiting" && question && (
          <WaitingBanner session={box.name} question={question} onAnswered={onRefresh} />
        )}

        <section aria-labelledby="log-heading">
          <h2 id="log-heading" className="text-muted-foreground mb-2 text-[11px] font-medium uppercase tracking-wider">
            Live log
          </h2>
          <LogTerminal name={box.name} log={snap?.log ?? ""} />
        </section>

        <AskPanel session={box.name} messages={askMessages} setMessages={setAskMessages} />
      </div>
    </div>
  );
}
