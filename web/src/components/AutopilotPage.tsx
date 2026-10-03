import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowLeft, CalendarClock, ListChecks, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Automations, seedAutomation } from "@/components/Automations";
import { WorkflowsPage } from "@/components/WorkflowsPage";
import { ScheduledPage } from "@/components/ScheduledPage";

export type AutopilotTab = "automations" | "scheduled" | "playbooks";

/**
 * One home for work that runs without you. Automations are standing rules (a schedule, a webhook, a
 * GitHub event, another automation finishing); Scheduled is what a chat asked for later, usually once;
 * playbooks say HOW it gets done. An automation can run a playbook; a playbook can be automated.
 */
export function AutopilotPage({
  tab,
  onTab,
  onBack,
  onOpenBox,
}: {
  tab: AutopilotTab;
  onTab: (t: AutopilotTab) => void;
  onBack: () => void;
  onOpenBox: (box: string) => void;
}) {
  const reduce = useReducedMotion();
  const tabs: { id: AutopilotTab; label: string; hint: string; icon: React.ReactNode }[] = [
    { id: "automations", label: "Automations", hint: "Standing rules", icon: <Workflow className="size-4" /> },
    { id: "scheduled", label: "Scheduled", hint: "Asked for in a chat", icon: <CalendarClock className="size-4" /> },
    { id: "playbooks", label: "Playbooks", hint: "How it gets done", icon: <ListChecks className="size-4" /> },
  ];
  return (
    <div className="h-full min-w-0 overflow-y-auto">
      <div className="mx-auto max-w-[1000px] px-5 py-6 md:px-8 md:py-8">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 mb-3 md:hidden">
          <ArrowLeft className="size-4" />
          Back
        </Button>
        <header className="mb-5">
          <h1 className="text-foreground font-serif text-h1 font-normal tracking-[-0.01em]">Autopilot</h1>
          <p className="text-muted-foreground mt-1 text-meta">Work that runs without you: when it starts, and how it gets done.</p>
        </header>
        <div role="tablist" aria-label="Autopilot" className="mb-5 flex gap-1 border-b">
          {tabs.map((t) => {
            const on = t.id === tab;
            return (
              <button
                key={t.id}
                role="tab"
                type="button"
                aria-selected={on}
                onClick={() => onTab(t.id)}
                className={cn(
                  "relative -mb-px flex cursor-pointer items-center gap-2 px-3 pt-1 pb-2.5 text-meta transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-t-md",
                  on ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t.icon}
                <span className="font-medium">{t.label}</span>
                <span className="text-faint hidden text-micro sm:inline">{t.hint}</span>
                {on && (
                  <motion.span
                    layoutId="autopilot-tab"
                    className="bg-foreground absolute inset-x-2 bottom-0 h-0.5 rounded-full"
                    transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 40 }}
                  />
                )}
              </button>
            );
          })}
        </div>
        <div role="tabpanel">
          {tab === "automations" ? (
            <Automations onOpenBox={onOpenBox} onOpenPlaybooks={() => onTab("playbooks")} />
          ) : tab === "scheduled" ? (
            <ScheduledPage onOpenBox={onOpenBox} onAutomations={() => onTab("automations")} />
          ) : (
            <WorkflowsPage
              onAutomate={(w) => {
                seedAutomation({ name: w.name, workflowId: w.id, taskTemplate: w.description || `Run the ${w.name} playbook` });
                onTab("automations");
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
