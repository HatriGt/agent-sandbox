import * as React from "react";
import { ArrowRight, Check, Github, PlugZap, Sparkles, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { api } from "@/lib/api";
import { useGo } from "@/lib/route";
import { cn } from "@/lib/utils";
import { Collapse } from "@/components/ui/collapse";
import { StaggerItem } from "@/components/ui/swap";

const KEY = "asb-gs-dismissed";

/**
 * A fresh account's first screen: three things worth doing, each one click away, gone as soon as
 * they are done or dismissed. Not a tour — a checklist that reflects real state.
 *
 * Motion: the panel rises in, its steps a beat apart; a step that completes pops its check and
 * draws a strike through its title; dismissing folds the whole panel closed instead of yanking
 * the dashboard up by a card's height.
 */
/** Whether the checklist was dismissed in this browser — so a sibling can decide what to show instead. */
export function gettingStartedDismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function GettingStarted({ onDismiss }: { onDismiss?: () => void } = {}) {
  const go = useGo();
  const reduced = useReducedMotion();
  const [hidden, setHidden] = React.useState(gettingStartedDismissed);
  const [accounts, setAccounts] = React.useState<number | null>(null);
  const [keys, setKeys] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (hidden) return;
    api.accounts().then((r) => setAccounts(r.accounts.length)).catch(() => setAccounts(0));
    api.apiKeys().then((r) => setKeys(r.keys.filter((k) => !k.revoked_at).length)).catch(() => setKeys(0));
  }, [hidden]);
  const dismiss = () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* fine */
    }
    setHidden(true);
    onDismiss?.();
  };
  const steps = [
    { done: (accounts ?? 0) > 0, icon: <Github />, title: "Connect a GitHub account", body: "So machines can clone your private repositories and open pull requests.", cta: "Integrations", run: () => go({ view: "integrations" }) },
    { done: false, icon: <Sparkles />, title: "Start your first task", body: "Describe it above — a machine boots in seconds and you watch it work.", cta: "Focus the composer", run: () => document.getElementById("new-task")?.focus() },
    { done: (keys ?? 0) > 0, icon: <PlugZap />, title: "Connect your IDE", body: "Delegate from Cursor or Claude Code with a personal API key.", cta: "Connect", run: () => go({ view: "connect" }) },
  ];
  return (
    <Collapse open={!hidden}>
      <motion.section
        aria-labelledby="gs-h"
        initial={reduced ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="bg-card raised relative rounded-xl p-4 sm:p-5"
      >
        <button type="button" onClick={dismiss} aria-label="Dismiss" className="text-faint hover:text-foreground hover:bg-muted absolute top-3 right-3 grid size-7 cursor-pointer place-items-center rounded-md transition-colors">
          <X className="size-4" />
        </button>
        <h2 id="gs-h" className="text-foreground text-h3 font-semibold tracking-[-0.01em]">
          Get set up
        </h2>
        <p className="text-muted-foreground mt-0.5 text-meta">Three things, each optional, each a click away.</p>
        <ol className="mt-4 grid gap-2 sm:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.title} className="min-w-0">
              {/* A done step goes quiet — muted card, a small green check, "Done" where the action was —
                  rather than a green slab with a struck-out title (which reads as "cancelled"). The
                  card that still needs you is the one with ink. */}
              <StaggerItem index={i} step={0.05} className={cn("flex h-full flex-col gap-2 rounded-lg border p-3 transition-colors duration-300", s.done ? "bg-transparent" : "bg-muted/60 border-transparent")}>
                {/* re-keyed on completion so the check pops in fresh (one-shot .pop-in) */}
                <span key={s.done ? "done" : "todo"} className={cn("grid size-7 place-items-center rounded-full [&_svg]:size-3.5", s.done ? "bg-ok/12 text-ok pop-in" : "bg-background text-muted-foreground shadow-e1")}>
                  {s.done ? <Check strokeWidth={2.5} /> : s.icon}
                </span>
                <span className={cn("self-start text-meta font-medium transition-colors duration-300", s.done ? "text-muted-foreground" : "text-foreground")}>{s.title}</span>
                <span className={cn("flex-1 text-micro leading-relaxed", s.done ? "text-faint" : "text-muted-foreground")}>{s.body}</span>
                {s.done ? (
                  <motion.span
                    initial={reduced ? false : { opacity: 0, y: 2 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, delay: reduced ? 0 : 0.12, ease: [0.22, 1, 0.36, 1] }}
                    className="text-ok inline-flex items-center gap-1 text-micro font-medium"
                  >
                    <Check className="size-3" strokeWidth={2.5} aria-hidden />
                    Done
                  </motion.span>
                ) : (
                  <button type="button" onClick={s.run} className="text-live group inline-flex cursor-pointer items-center gap-1 text-micro font-medium">
                    {s.cta}
                    <ArrowRight className="size-3 transition-transform duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:translate-x-0.5" />
                  </button>
                )}
              </StaggerItem>
            </li>
          ))}
        </ol>
      </motion.section>
    </Collapse>
  );
}
