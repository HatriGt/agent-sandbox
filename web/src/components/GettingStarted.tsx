import * as React from "react";
import { ArrowRight, Check, Github, PlugZap, Sparkles, X } from "lucide-react";
import { motion } from "motion/react";
import { api } from "@/lib/api";
import { useGo } from "@/lib/route";
import { cn } from "@/lib/utils";

const KEY = "asb-gs-dismissed";

/**
 * A fresh account's first screen: three things worth doing, each one click away, gone as soon as
 * they are done or dismissed. Not a tour — a checklist that reflects real state.
 */
export function GettingStarted() {
  const go = useGo();
  const [hidden, setHidden] = React.useState(() => {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  });
  const [accounts, setAccounts] = React.useState<number | null>(null);
  const [keys, setKeys] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (hidden) return;
    api.accounts().then((r) => setAccounts(r.accounts.length)).catch(() => setAccounts(0));
    api.apiKeys().then((r) => setKeys(r.keys.filter((k) => !k.revoked_at).length)).catch(() => setKeys(0));
  }, [hidden]);
  if (hidden) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* fine */
    }
    setHidden(true);
  };
  const steps = [
    { done: (accounts ?? 0) > 0, icon: <Github />, title: "Connect a GitHub account", body: "So machines can clone your private repositories and open pull requests.", cta: "Integrations", run: () => go({ view: "integrations" }) },
    { done: false, icon: <Sparkles />, title: "Start your first task", body: "Describe it above — a machine boots in seconds and you watch it work.", cta: "Focus the composer", run: () => document.getElementById("new-task")?.focus() },
    { done: (keys ?? 0) > 0, icon: <PlugZap />, title: "Connect your IDE", body: "Delegate from Cursor or Claude Code with a personal API key.", cta: "Connect", run: () => go({ view: "connect" }) },
  ];
  return (
    <motion.section
      aria-labelledby="gs-h"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="bg-card raised relative rounded-xl p-4 sm:p-5"
    >
      <button type="button" onClick={dismiss} aria-label="Dismiss" className="text-faint hover:text-foreground absolute top-3 right-3 grid size-7 cursor-pointer place-items-center rounded-md">
        <X className="size-4" />
      </button>
      <h2 id="gs-h" className="text-foreground text-h3 font-semibold tracking-[-0.01em]">
        Get set up
      </h2>
      <p className="text-muted-foreground mt-0.5 text-meta">Three things, each optional, each a click away.</p>
      <ol className="mt-4 grid gap-2 sm:grid-cols-3">
        {steps.map((s) => (
          <li key={s.title} className={cn("flex flex-col gap-2 rounded-md p-3", s.done ? "bg-ok/10" : "bg-muted/60")}>
            <span className={cn("grid size-7 place-items-center rounded-full [&_svg]:size-3.5", s.done ? "bg-ok text-white" : "bg-background text-muted-foreground")}>{s.done ? <Check /> : s.icon}</span>
            <span className="text-foreground text-meta font-medium">{s.title}</span>
            <span className="text-muted-foreground flex-1 text-micro leading-relaxed">{s.body}</span>
            {!s.done && (
              <button type="button" onClick={s.run} className="text-live inline-flex cursor-pointer items-center gap-1 text-micro font-medium">
                {s.cta}
                <ArrowRight className="size-3" />
              </button>
            )}
          </li>
        ))}
      </ol>
    </motion.section>
  );
}
