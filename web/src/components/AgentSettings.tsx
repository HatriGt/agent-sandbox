import * as React from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, type AgentPrefs } from "@/lib/api";
import { cn } from "@/lib/utils";

const DESC: Record<string, string> = {
  claude: "Anthropic's Claude Code CLI — the default, with question-pausing and the full toolset.",
  omp: "oh-my-pi — a batteries-included pi fork (LSP, debugger, kernels). Beta: questions don't hard-pause the run yet.",
};

/**
 * Default coding agent for NEW threads. A running thread keeps the agent it started on — the pick
 * only changes what the next "Start a task" launches, so switching is always safe.
 */
export function AgentSettings() {
  const [prefs, setPrefs] = React.useState<AgentPrefs | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    const ctrl = new AbortController();
    api
      .agentPrefs(ctrl.signal)
      .then(setPrefs)
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  const pick = async (id: "claude" | "omp") => {
    if (!prefs || prefs.defaultAgent === id || busy) return;
    setBusy(id);
    try {
      setPrefs(await api.saveAgentPrefs(id));
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1600);
    } catch (e) {
      toast.error("Could not save", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  if (!prefs) return null;

  return (
    <section aria-labelledby="agent-h">
      <h2 id="agent-h" className="text-foreground mb-1 text-h3 font-semibold tracking-[-0.01em]">
        Coding agent
        {saved && (
          <span className="text-live ml-2 inline-flex items-center gap-1 text-micro font-normal">
            <Check className="size-3.5" /> Saved
          </span>
        )}
      </h2>
      <p className="text-muted-foreground mb-3 max-w-[64ch] text-meta">
        Which agent new machines run. Threads already running keep the agent they started with.
      </p>
      <div role="radiogroup" aria-labelledby="agent-h" className="flex max-w-xl flex-col gap-2">
        {prefs.agents.map((a) => {
          const active = prefs.defaultAgent === a.id;
          return (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => pick(a.id)}
              disabled={busy !== null}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                active ? "border-ring bg-card raised" : "border-line-strong hover:bg-muted/40"
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border",
                  active ? "border-ring" : "border-line-strong"
                )}
              >
                {busy === a.id ? (
                  <Loader2 className="text-muted-foreground size-3 animate-spin" />
                ) : (
                  active && <span className="bg-ring size-2 rounded-full" />
                )}
              </span>
              <span className="min-w-0">
                <span className="text-foreground flex items-center gap-2 text-meta font-medium">
                  {a.label}
                  {a.id === "omp" && (
                    <span className="border-line-strong text-muted-foreground rounded-full border px-1.5 py-px text-micro">beta</span>
                  )}
                </span>
                <span className="text-muted-foreground mt-0.5 block text-micro">{DESC[a.id] ?? ""}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
