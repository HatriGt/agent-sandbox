import { Link } from "react-router";
import { ArrowRight, Clock } from "lucide-react";
import { getMe } from "@/lib/auth";
import { cn } from "@/lib/utils";

/** Where the trial stands, in one glance. Quiet while there is time; attention colour in the last two days; red when over. */
export function TrialBadge({ className }: { className?: string }) {
  const me = getMe();
  if (me?.kind !== "user" || me.plan !== "trial" || me.daysLeft === null) return null;
  const tone = me.expired ? "text-destructive bg-destructive/10" : me.daysLeft <= 2 ? "text-attention-text bg-attention/20" : "text-muted-foreground bg-muted";
  const label = me.expired ? "Trial ended" : me.daysLeft === 0 ? "Trial ends today" : `Trial · ${me.daysLeft}d left`;
  return (
    <Link to="/dashboard/account" className={cn("inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-micro font-medium no-underline", tone, className)} title="Your plan">
      <Clock className="size-3" />
      {label}
    </Link>
  );
}

/** The hard stop: shown above the composer once the trial is over. */
export function TrialEndedNotice() {
  const me = getMe();
  if (me?.kind !== "user" || !me.expired) return null;
  const upgrade = me.billingUrl ?? "mailto:hello@agent-sandbox.dev?subject=Agent%20Sandbox%20upgrade";
  return (
    <div className="bg-card raised flex flex-col gap-3 rounded-xl p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-foreground text-meta font-medium">Your free trial has ended.</p>
        <p className="text-muted-foreground mt-0.5 text-meta">Your runs, GitHub accounts and MCP servers are kept. Upgrade to keep starting machines — or self-host for free.</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <a href="https://github.com/HatriGt/agent-sandbox/blob/main/docs/self-hosting.md" target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground text-meta">
          Self-host
        </a>
        <a href={upgrade} className="bg-primary text-primary-foreground hover:bg-primary/80 inline-flex h-9 items-center gap-1.5 rounded-md px-3.5 text-meta font-medium">
          Upgrade
          <ArrowRight className="size-3.5" />
        </a>
      </div>
    </div>
  );
}
