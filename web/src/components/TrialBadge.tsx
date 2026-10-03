import { Link } from "react-router";
import { ArrowRight, Clock } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { getMe } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Where the trial stands, in one glance. Quiet while there is time; attention colour in the last two days; red when over. */
export function TrialBadge({ className }: { className?: string }) {
  const me = getMe();
  if (me?.kind !== "user" || me.plan !== "trial" || me.daysLeft === null) return null;
  const tone = me.expired
    ? "text-destructive bg-destructive/10 hover:bg-destructive/20"
    : me.daysLeft <= 2
      ? "text-warn-text bg-warn/20 hover:bg-warn/30"
      : "text-muted-foreground bg-muted hover:bg-secondary hover:text-foreground";
  const label = me.expired ? "Trial ended" : me.daysLeft === 0 ? "Trial ends today" : `Trial · ${me.daysLeft}d left`;
  return (
    <Link
      to="/dashboard/account"
      className={cn("inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-micro font-medium no-underline transition-[background-color,color] duration-150", tone, className)}
      title="Your plan"
    >
      <Clock className="size-3" />
      {label}
    </Link>
  );
}

/** The hard stop: shown above the composer once the trial is over. */
export function TrialEndedNotice() {
  const me = getMe();
  const still = useReducedMotion();
  if (me?.kind !== "user" || !me.expired) return null;
  const upgrade = me.billingUrl ?? "mailto:hello@agent-sandbox.dev?subject=Agent%20Sandbox%20upgrade";
  return (
    <motion.div
      initial={still ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: still ? 0.12 : 0.24, ease: [0.22, 1, 0.36, 1] }}
      className="bg-card raised border-l-attention mb-4 flex flex-col gap-3 rounded-xl border-l-[3px] p-4 sm:flex-row sm:items-center sm:justify-between"
      role="status"
    >
      <div>
        <p className="text-foreground text-meta font-medium">Your free trial has ended.</p>
        <p className="text-muted-foreground mt-0.5 text-meta">Your runs, GitHub accounts and MCP servers are kept. Upgrade to keep starting machines — or self-host for free.</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
          <a href="https://github.com/HatriGt/agent-sandbox/blob/main/docs/self-hosting.md" target="_blank" rel="noreferrer">
            Self-host
          </a>
        </Button>
        <Button asChild>
          <a href={upgrade}>
            Upgrade
            <ArrowRight className="size-3.5" />
          </a>
        </Button>
      </div>
    </motion.div>
  );
}
