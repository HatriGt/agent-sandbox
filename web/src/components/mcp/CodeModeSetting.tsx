import * as React from "react";
import { AlertTriangle, Code2 } from "lucide-react";
import { toast } from "sonner";
import { api, type AgentPrefs, type CodeModeSetting as Setting, type CodeModeSnippet, type McpServersResponse } from "@/lib/api";
import { Segmented } from "@/components/ui/segmented";
import { fmtAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

/** The package the in-box code-mode server needs baked into the image (src/code-mode). */
const SDK = "@modelcontextprotocol/sdk";

const LABELS: Record<Setting, string> = { auto: "Auto", on: "Always", off: "Never" };
const TOASTS: Record<Setting, string> = {
  auto: "Code mode on auto — decided per server from each thread's next run",
  on: "Code mode on for every server — from each thread's next run",
  off: "Code mode off — from each thread's next run",
};

/**
 * Code mode for MCP (docs/plan-code-mode.md §13): the three-way control above the server list,
 * bound to the caller's agent-prefs `codeMode`. Auto lets the controller decide per server (big
 * servers behind the script tool, small or step-by-step ones direct; a server's own `codeMode`
 * key overrides); Always wraps every server; Never none. An owner who never chose shows the
 * deployment default. The POST echoes the stored driver and model, because a prefs body without
 * them resets those. Two states come from the last box that reported: an image without the SDK
 * (runs fall back to direct servers) and the last install's split or fallback reason.
 */
export function CodeModeSetting({ data, enabledServers }: { data: McpServersResponse | null; enabledServers: number }) {
  const [prefs, setPrefs] = React.useState<AgentPrefs | null>(null);
  const [busy, setBusy] = React.useState<Setting | null>(null);
  const [snippets, setSnippets] = React.useState<CodeModeSnippet[]>([]);
  const [removing, setRemoving] = React.useState<string | null>(null);

  React.useEffect(() => {
    const ctrl = new AbortController();
    api.agentPrefs(ctrl.signal).then(setPrefs).catch(() => {});
    api
      .codeModeSnippets(ctrl.signal)
      .then((r) => setSnippets(r.snippets))
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  const remove = async (name: string) => {
    if (removing) return;
    setRemoving(name);
    try {
      await api.deleteCodeModeSnippet(name);
      setSnippets((list) => list.filter((s) => s.name !== name));
      toast.success(`Removed the saved script ${name}`);
    } catch (e) {
      toast.error("Could not remove", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setRemoving(null);
    }
  };

  const value: Setting = prefs?.codeMode ?? prefs?.codeModeDefault ?? "off";
  const chosen = prefs?.codeMode !== undefined;
  const pick = async (next: Setting) => {
    if (!prefs || busy || next === value) return;
    setBusy(next);
    try {
      const choice = prefs.agents.find((a) => a.id === prefs.defaultAgent);
      const saved = await api.saveAgentPrefs({
        defaultAgent: prefs.defaultAgent,
        defaultModel: prefs.defaultModel ?? "",
        codeMode: next,
        ...(choice?.supervised === false ? { allowPartialSupervision: true } : {}),
      });
      setPrefs(saved);
      toast.success(TOASTS[next]);
    } catch (e) {
      toast.error("Could not save", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const baked = data?.baked;
  // Only a box that reported its packages can say the SDK is missing; before that, say nothing.
  const needsRebake = !!baked && Object.keys(baked).length > 0 && !(SDK in baked);
  const last = data?.lastProvision;
  const fallback = last?.codeModeFallback;
  const split = last?.codeMode;
  const inert = enabledServers === 0;
  const active = value !== "off";

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
            Auto puts servers with many tools behind it and keeps small or step-by-step ones (a browser) direct; a server's own <code className="font-mono">codeMode</code> key overrides.
            In a 4-task bench: −57% context, −56% cost, −72% wall time vs direct calls; +4% on a one-call task; 20/20 correct.
          </p>
          <p className="text-faint mt-1 text-micro">
            Claude Code threads only; omp and Codex keep direct servers. Applies from each thread's next run.
            {!chosen && prefs && ` Showing the default (${LABELS[value].toLowerCase()}); pick one to keep it.`}
          </p>
          {inert && <p className="text-faint mt-1 text-micro">No server is on, so this changes nothing yet.</p>}
          {active && split && !fallback && (
            <p className="text-faint mt-1 text-micro [overflow-wrap:anywhere]">
              Last run: {split.wrapped.length ? `${split.wrapped.join(", ")} through code mode` : "nothing through code mode"}
              {split.direct.length ? ` · ${split.direct.join(", ")} direct` : ""}.
            </p>
          )}
          {active && needsRebake && (
            <p role="status" className="mt-1.5 flex items-start gap-1.5 text-micro text-amber-600 dark:text-amber-300">
              <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />
              <span>
                Needs the image rebaked (<code className="font-mono">{SDK}</code>) — until then runs fall back to direct servers.
              </span>
            </p>
          )}
          {active && fallback && (
            <p role="status" className="mt-1.5 flex items-start gap-1.5 text-micro text-amber-600 dark:text-amber-300">
              <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />
              <span className="min-w-0 [overflow-wrap:anywhere]">Last run fell back to direct servers: {fallback}</span>
            </p>
          )}
          {active && snippets.length > 0 && (
            <div className="mt-2.5">
              <p className="text-faint text-micro">
                Saved scripts — a run keeps a script that ran clean, and later runs rerun it by name instead of writing it again.
              </p>
              <ul className="mt-1 divide-y divide-border/60">
                {snippets.map((s) => (
                  <li key={s.name} className="flex items-baseline gap-3 py-1.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-micro text-foreground" title={s.description}>
                        {s.name}
                      </span>
                      <span className="text-faint block truncate text-micro">
                        {s.description || "no description"} · {s.calls.length} tool{s.calls.length === 1 ? "" : "s"} · {s.runs} run{s.runs === 1 ? "" : "s"}
                        {s.savedAt ? ` · ${fmtAgo(Math.floor(s.savedAt / 1000))}` : ""}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => void remove(s.name)}
                      disabled={removing === s.name}
                      className="text-muted-foreground hover:text-foreground shrink-0 cursor-pointer text-micro underline-offset-2 hover:underline disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <Segmented
          ariaLabel="Code mode"
          value={value}
          onChange={(v) => void pick(v)}
          busy={busy}
          disabled={!prefs || (inert && value === "off")}
          options={(["auto", "on", "off"] as const).map((v) => ({
            value: v,
            label: LABELS[v],
            title: v === "auto" ? "The controller decides per server" : v === "on" ? "Every server behind the script tool" : "Every server called directly",
          }))}
          className="mt-0.5 shrink-0"
        />
      </div>
    </div>
  );
}
