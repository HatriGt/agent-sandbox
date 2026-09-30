import * as React from "react";
import { Check, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { api, type AgentPrefs } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/components/ui/settings";
import { Swap } from "@/components/ui/swap";
import { Bar } from "@/components/thread/Skeletons";
import { cn } from "@/lib/utils";

type AgentId = AgentPrefs["defaultAgent"];
/** The factory default — what a fresh deployment runs. `Reset` returns to it. */
const FACTORY: AgentId = "claude";
const DESC: Record<AgentId, string> = {
  claude: "Anthropic's Claude Code CLI — question-pausing and the full toolset.",
  omp: "oh-my-pi — a batteries-included pi fork (LSP, debugger, kernels). Beta: questions don't hard-pause the run yet.",
};

/**
 * Default coding agent for NEW threads. A running thread keeps the agent it started on — the pick
 * only changes what the next "Start a task" launches, so switching is always safe.
 */
export function AgentSettings() {
  const [prefs, setPrefs] = React.useState<AgentPrefs | null>(null);
  const [busy, setBusy] = React.useState<AgentId | null>(null);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    const ctrl = new AbortController();
    api
      .agentPrefs(ctrl.signal)
      .then(setPrefs)
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  const pick = async (id: AgentId) => {
    if (!prefs || prefs.defaultAgent === id || busy) return;
    setBusy(id);
    try {
      setPrefs(await api.saveAgentPrefs(id));
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      toast.error("Could not save", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const isFactory = prefs?.defaultAgent === FACTORY;
  return (
    <SettingsSection
      id="agent"
      title="Coding agent"
      purpose="Which agent new machines run. Threads already running keep the agent they started with."
      status={
        <Swap state={saved} className="inline-flex" y={3}>
          {saved ? (
            <span role="status" className="text-live inline-flex items-center gap-1 text-micro">
              <Check className="size-3.5" /> Saved
            </span>
          ) : null}
        </Swap>
      }
      actions={
        prefs && !isFactory ? (
          <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={() => void pick(FACTORY)} disabled={busy !== null}>
            <RotateCcw className="size-3.5" />
            Reset to default
          </Button>
        ) : undefined
      }
    >
      <Swap state={prefs ? "list" : "loading"}>
        {!prefs ? (
          <div className="flex max-w-xl flex-col gap-2" aria-busy="true" aria-label="Loading">
            <Bar className="h-16 w-full rounded-lg" />
            <Bar className="h-16 w-full rounded-lg" />
          </div>
        ) : (
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
                    "flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-left transition-[border-color,background-color,box-shadow] duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-default",
                    active ? "border-ring bg-card raised" : "border-border hover:border-line-strong hover:bg-muted/40"
                  )}
                >
                  <span aria-hidden className={cn("mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border transition-colors duration-150", active ? "border-ring" : "border-line-strong")}>
                    {busy === a.id ? <Loader2 className="text-muted-foreground size-3 animate-spin" /> : active && <span className="bg-ring size-2 rounded-full" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-foreground flex flex-wrap items-center gap-2 text-meta font-medium">
                      {a.label}
                      {a.id === FACTORY && <span className="text-faint text-micro font-normal">default</span>}
                      {a.id === "omp" && <span className="border-line-strong text-muted-foreground rounded-full border px-1.5 py-px text-micro font-normal">beta</span>}
                    </span>
                    <span className="text-muted-foreground mt-0.5 block text-micro">{DESC[a.id] ?? ""}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </Swap>
    </SettingsSection>
  );
}
