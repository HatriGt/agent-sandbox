import * as React from "react";
import { Cpu, GitBranch, ListChecks, Sigma } from "lucide-react";
import type { BoxView } from "@/lib/api";
import { parseTrace } from "@/lib/trace";
import { lastUsage } from "@/lib/context-health";
import { peekWatchCache } from "@/hooks/useWatchStream";
import { useModelChoice } from "@/components/thread/ModelPicker";
import { fmtTokens } from "@/components/thread/OutcomeCard";
import { NumberTicker } from "@/components/ui/number-ticker";
import { cn } from "@/lib/utils";

/**
 * The 24px strip under the pane: what the fleet is doing, how fresh that is, and — when a thread is
 * open — the facts the header tooltips bury: branch, model, live tokens and the playbook step. Every
 * value is a real one: tokens come from the trace's ⟦usage⟧ events (none yet → no tokens shown).
 * Each section is a button that opens the thing it names.
 */
export function StatusBar({
  runs,
  working,
  waiting,
  updatedAt,
  connected,
  box,
  onFleet,
  onWaiting,
  onBranch,
  onModel,
  onPlaybook,
}: {
  runs: number;
  working: number;
  waiting: number;
  updatedAt: number | null;
  connected: boolean;
  box: BoxView | null;
  onFleet: () => void;
  onWaiting: () => void;
  onBranch: () => void;
  onModel: () => void;
  onPlaybook: () => void;
}) {
  // One clock for the freshness label and for re-reading the open thread's cached snapshot (the
  // stream writes it; the bar only needs to notice once a second).
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  const secs = updatedAt ? Math.max(0, Math.round((Date.now() - updatedAt) / 1000)) : null;
  const fresh = !connected ? "offline · retrying" : secs == null ? "connecting…" : secs < 2 ? "updated just now" : `updated ${secs}s ago`;

  const model = useModelChoice(box?.name ?? null);
  const log = box ? peekWatchCache(box.name)?.log ?? null : null;
  const usage = React.useMemo(() => (log ? lastUsage(parseTrace(log)) : null), [log]);
  const branch = box?.repos?.find((r) => r.branch)?.branch ?? null;
  const wf = box?.workflow;

  return (
    <div
      role="contentinfo"
      aria-label="Status"
      className="bg-card text-muted-foreground flex h-6 shrink-0 items-center gap-0.5 overflow-hidden border-t px-1.5 text-micro"
    >
      <Section onClick={onFleet} title="Fleet view">
        <span className="tabular">
          <NumberTicker value={runs} from={runs} /> {runs === 1 ? "run" : "runs"}
          {working > 0 && <> · <NumberTicker value={working} from={working} /> working</>}
        </span>
      </Section>
      {waiting > 0 && (
        <Section onClick={onWaiting} title="Open the first waiting machine" className="text-attention-text">
          <span className="tabular">
            <NumberTicker value={waiting} from={waiting} /> waiting
          </span>
        </Section>
      )}
      <span className="text-faint tabular px-1.5" aria-live="off">
        {fresh}
      </span>
      {box && (
        <div className="ml-auto flex min-w-0 items-center gap-0.5">
          {branch && (
            <Section onClick={onBranch} title="Open the workspace">
              <GitBranch className="size-3" aria-hidden />
              <span className="truncate">{branch}</span>
            </Section>
          )}
          {model.current && (
            <Section onClick={onModel} title="Switch model">
              <Cpu className="size-3" aria-hidden />
              <span className="truncate">{model.current.label}</span>
            </Section>
          )}
          {usage && (
            <span className="flex items-center gap-1 px-1.5 tabular" title={`${usage.inputTokens.toLocaleString()} in · ${usage.outputTokens.toLocaleString()} out · ${usage.contextTokens.toLocaleString()} in context`}>
              <Sigma className="size-3" aria-hidden />
              {fmtTokens(usage.inputTokens + usage.outputTokens)} tok
            </span>
          )}
          {wf && (
            <Section onClick={onPlaybook} title={wf.name} className={cn(wf.state === "failed" && "text-destructive")}>
              <ListChecks className="size-3" aria-hidden />
              <span className="truncate">
                {wf.name} · step {wf.step}/{wf.total}
              </span>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ children, onClick, title, className }: { children: React.ReactNode; onClick: () => void; title: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "hover:bg-muted hover:text-foreground focus-visible:ring-ring flex h-5 min-w-0 cursor-pointer items-center gap-1 rounded-sm px-1.5 transition-colors focus-visible:ring-2 focus-visible:outline-none motion-reduce:transition-none",
        className
      )}
    >
      {children}
    </button>
  );
}
