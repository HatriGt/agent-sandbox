import * as React from "react";
import { motion } from "motion/react";
import { useReducedMotion } from "@/lib/motion-pref";
import { ArrowLeft, ListChecks, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TabPanel } from "@/components/ui/animated-tabs";
import { NumberTicker } from "@/components/ui/number-ticker";
import { useNow } from "@/hooks/useNow";
import { fmtCountdown, upcoming } from "@/components/autopilot/UpNext";
import { automationLabel } from "@/components/Automations";
import { cn } from "@/lib/utils";
import { api, type Automation, type BoxView } from "@/lib/api";
import { useCached } from "@/lib/cache";
import { Automations, seedAutomation } from "@/components/Automations";
import { PlaybooksPage } from "@/components/PlaybooksPage";

export type AutopilotTab = "automations" | "playbooks";
const ORDER: readonly AutopilotTab[] = ["automations", "playbooks"];

/**
 * One home for work that runs without you. Automations are standing rules (a schedule, a webhook, a
 * GitHub event, another automation finishing) and what a chat asked for later ("From chat" filter);
 * playbooks say HOW it gets done. An automation can run a playbook; a playbook can be automated.
 */
export function AutopilotPage({
  tab,
  onTab,
  onBack,
  onOpenBox,
  onOpenRuns,
  boxes,
}: {
  tab: AutopilotTab;
  onTab: (t: AutopilotTab) => void;
  onBack: () => void;
  onOpenBox: (box: string) => void;
  onOpenRuns: (id: string) => void;
  /** The live fleet — Playbooks reads each box's workflow for its "Last run" column. */
  boxes: BoxView[];
}) {
  const reduce = useReducedMotion();
  // Counts on the tabs: what is live, what is coming up, and (ink-ringed) what is waiting on you.
  const triggers = useCached("triggers", (signal) => api.triggers(signal)).data?.triggers;
  const workflows = useCached("workflows", (signal) => api.workflows(signal)).data?.workflows;
  const tabs: { id: AutopilotTab; label: string; hint: string; icon: React.ReactNode; count?: number; attention?: boolean }[] = [
    { id: "automations", label: "Automations", hint: "When it starts", icon: <Workflow className="size-4" />, count: triggers?.filter((t) => t.enabled).length, attention: triggers?.some((t) => t.status === "needs-ok") },
    { id: "playbooks", label: "Playbooks", hint: "How it gets done", icon: <ListChecks className="size-4" />, count: workflows?.length },
  ];
  return (
    <div className="@container h-full min-w-0 overflow-y-auto">
      <div className="page-frame py-6 md:py-8">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 mb-3 md:hidden">
          <ArrowLeft className="size-4" />
          Back
        </Button>
        <header className="mb-6">
          <h1 className="text-foreground font-serif text-h1 font-normal tracking-[-0.01em]">Autopilot</h1>
          <p className="text-muted-foreground mt-1 text-meta">Work that runs without you: when it starts, and how it gets done.</p>
          <LiveLine triggers={triggers} onOpen={() => onTab("automations")} />
        </header>
        <div
          role="tablist"
          aria-label="Autopilot"
          className="bg-muted/60 mb-6 grid grid-cols-2 gap-1 rounded-xl p-1 @2xl:inline-grid @2xl:min-w-[34rem]"
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            const next = ORDER[(ORDER.indexOf(tab) + (e.key === "ArrowRight" ? 1 : ORDER.length - 1)) % ORDER.length];
            onTab(next);
            requestAnimationFrame(() => document.getElementById(`autopilot-tab-${next}`)?.focus());
          }}
        >
          {tabs.map((t) => {
            const on = t.id === tab;
            return (
              <button
                key={t.id}
                id={`autopilot-tab-${t.id}`}
                role="tab"
                type="button"
                aria-selected={on}
                tabIndex={on ? 0 : -1}
                onClick={() => onTab(t.id)}
                className={cn(
                  "relative flex min-w-0 cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  on ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {on && (
                  <motion.span
                    layoutId="autopilot-tab"
                    className="bg-card absolute inset-0 rounded-lg border shadow-xs"
                    transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 40 }}
                  />
                )}
                <span className={cn("relative grid size-8 shrink-0 place-items-center rounded-lg transition-colors", on ? "bg-foreground text-background" : "bg-background/70 border")} aria-hidden>
                  {t.icon}
                </span>
                <span className="relative min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="text-meta font-medium">{t.label}</span>
                    {t.count ? (
                      <span className={cn("pop-in rounded-full px-1.5 text-micro tabular-nums", t.attention ? "text-attention-text ring-1 ring-inset ring-attention/40" : "bg-muted text-muted-foreground")} title={t.attention ? "Something is awaiting your approval" : undefined}>
                        <NumberTicker value={t.count} from={t.count} />
                      </span>
                    ) : null}
                  </span>
                  <span className="text-faint block truncate text-micro">{t.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
        <TabPanel value={tab} order={ORDER}>
          {tab === "automations" ? (
            <Automations onOpenBox={onOpenBox} onOpenPlaybooks={() => onTab("playbooks")} onOpenRuns={onOpenRuns} />
          ) : (
            <PlaybooksPage
              boxes={boxes}
              onAutomate={(w) => {
                seedAutomation({ name: w.name, workflowId: w.id, taskTemplate: w.description || `Run the ${w.name} playbook` });
                onTab("automations");
              }}
            />
          )}
        </TabPanel>
      </div>
    </div>
  );
}

/**
 * One live sentence under the title: what is on, what is waiting on you, and the next run with a
 * ticking countdown. Present facts from the automation list itself — never a total over the past.
 */
function LiveLine({ triggers, onOpen }: { triggers: Automation[] | undefined; onOpen: () => void }) {
  const now = useNow(!!triggers?.length, 30_000);
  if (!triggers?.length) return null;
  const on = triggers.filter((t) => t.enabled).length;
  const running = triggers.reduce((n, t) => n + (t.active > 0 ? 1 : 0), 0);
  const waiting = triggers.filter((t) => t.status === "needs-ok" || (t.proposed && !t.enabled)).length;
  const next = upcoming(triggers, now)[0];
  return (
    <p className="enter text-muted-foreground mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-micro" aria-live="polite">
      <span className="inline-flex items-center gap-1.5">
        <span className={cn("size-1.5 rounded-full", on ? "bg-ok" : "bg-muted-foreground/50")} aria-hidden />
        <span className="text-foreground tabular font-medium">{on}</span> on
        {triggers.length > on ? <span className="text-faint">· {triggers.length - on} paused</span> : null}
      </span>
      {running > 0 && (
        <span className="inline-flex items-center gap-1.5">
          <span className="bg-live animate-pulse size-1.5 rounded-full" aria-hidden />
          <span className="text-foreground tabular font-medium">{running}</span> running now
        </span>
      )}
      {waiting > 0 && (
        <button type="button" onClick={onOpen} className="text-attention-text ring-attention/40 inline-flex cursor-pointer items-center gap-1.5 rounded-full px-2 py-0.5 font-medium ring-1 ring-inset">
          {waiting} waiting on you
        </button>
      )}
      {next && (
        <span className="inline-flex min-w-0 items-center gap-1.5">
          Next: <span className="text-foreground max-w-[16rem] truncate">{automationLabel(next.name)}</span>
          <span className="tabular font-mono">{fmtCountdown(next.nextFire!, now)}</span>
        </span>
      )}
    </p>
  );
}
