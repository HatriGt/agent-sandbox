import * as React from "react";
import { AlertTriangle, Code2 } from "lucide-react";
import { toast } from "sonner";
import { api, type AgentPrefs, type McpServersResponse } from "@/lib/api";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/** The package the in-box code-mode server needs baked into the image (src/code-mode). */
const SDK = "@modelcontextprotocol/sdk";

/**
 * Code mode for MCP (docs/plan-code-mode.md): the switch above the server list, bound to the
 * caller's agent-prefs `codeMode`. The POST echoes the stored driver and model, because a prefs body
 * without them resets those (the server keeps only autoCompact/codeMode when absent). Two states come
 * from the last box that reported: an image without the SDK (runs fall back to direct servers) and
 * the last fallback reason the install recorded.
 */
export function CodeModeSetting({ data, enabledServers }: { data: McpServersResponse | null; enabledServers: number }) {
  const [prefs, setPrefs] = React.useState<AgentPrefs | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    const ctrl = new AbortController();
    api.agentPrefs(ctrl.signal).then(setPrefs).catch(() => {});
    return () => ctrl.abort();
  }, []);

  const on = prefs?.codeMode === "on";
  const toggle = async (next: boolean) => {
    if (!prefs || busy) return;
    setBusy(true);
    try {
      const choice = prefs.agents.find((a) => a.id === prefs.defaultAgent);
      const saved = await api.saveAgentPrefs({
        defaultAgent: prefs.defaultAgent,
        defaultModel: prefs.defaultModel ?? "",
        codeMode: next ? "on" : "off",
        ...(choice?.supervised === false ? { allowPartialSupervision: true } : {}),
      });
      setPrefs(saved);
      toast.success(next ? "Code mode on — from each thread's next run" : "Code mode off — from each thread's next run");
    } catch (e) {
      toast.error("Could not save", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const baked = data?.baked;
  // Only a box that reported its packages can say the SDK is missing; before that, say nothing.
  const needsRebake = !!baked && Object.keys(baked).length > 0 && !(SDK in baked);
  const fallback = data?.lastProvision?.codeModeFallback;
  const inert = enabledServers === 0;

  return (
    <div className={cn("border-border bg-card mb-3 rounded-lg border p-3", inert && "opacity-70")}>
      <div className="flex items-start gap-3">
        <Code2 className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span id="code-mode-h" className="text-foreground text-meta font-medium">
              Code mode
            </span>
            <span className="bg-foreground/6 text-muted-foreground rounded-full px-1.5 py-px text-micro">beta</span>
          </div>
          <p className="text-muted-foreground mt-0.5 text-micro">
            Claude reaches your MCP servers through one script tool instead of calling each tool directly, and filters results inside the script, so only what the task needs enters the conversation.
            In a 4-task bench: −57% context, −56% cost, −72% wall time vs direct calls; +4% on a one-call task; 20/20 correct.
          </p>
          <p className="text-faint mt-1 text-micro">Claude Code threads only; omp and Codex keep direct servers. Applies from each thread's next run.</p>
          {inert && <p className="text-faint mt-1 text-micro">No server is on, so this changes nothing yet.</p>}
          {on && needsRebake && (
            <p role="status" className="mt-1.5 flex items-start gap-1.5 text-micro text-amber-600 dark:text-amber-300">
              <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />
              <span>
                Needs the image rebaked (<code className="font-mono">{SDK}</code>) — until then runs fall back to direct servers.
              </span>
            </p>
          )}
          {on && fallback && (
            <p role="status" className="mt-1.5 flex items-start gap-1.5 text-micro text-amber-600 dark:text-amber-300">
              <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />
              <span className="min-w-0 [overflow-wrap:anywhere]">Last run fell back to direct servers: {fallback}</span>
            </p>
          )}
        </div>
        <Switch
          checked={on}
          onCheckedChange={(v) => void toggle(v)}
          disabled={!prefs || busy || (inert && !on)}
          aria-labelledby="code-mode-h"
          className="mt-0.5"
        />
      </div>
    </div>
  );
}
