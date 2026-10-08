import * as React from "react";
import { Check, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { api, type AgentPrefs } from "@/lib/api";
import { DriverBadges } from "@/components/DriverPicker";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";
import { SettingsSection } from "@/components/ui/settings";
import { Swap } from "@/components/ui/swap";
import { Bar } from "@/components/thread/Skeletons";
import { cn } from "@/lib/utils";

type AgentId = AgentPrefs["defaultAgent"];
/** The factory default — what a fresh deployment runs. `Reset` returns to it. */
const FACTORY: AgentId = "claude";
const DESC: Record<AgentId, string> = {
  claude: "Anthropic's Claude Code CLI — question-pausing and the full toolset.",
  omp: "oh-my-pi — a batteries-included pi fork (LSP, debugger, kernels).",
  codex: "OpenAI's Codex CLI — runs on OpenAI or OpenAI-compatible models.",
  opencode: "OpenCode — open-source agent that runs on any provider, including local models.",
};

/**
 * Default coding agent for NEW threads. A running thread keeps the agent it started on — the pick
 * only changes what the next "Start a task" launches, so switching is always safe.
 */
export function AgentSettings() {
  const [prefs, setPrefs] = React.useState<AgentPrefs | null>(null);
  const [catalog, setCatalog] = React.useState<{ default: string; models: { id: string; label: string }[] } | null>(null);
  // Which control is saving: an agent id, or "model" for the select.
  const [busy, setBusy] = React.useState<AgentId | "model" | null>(null);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    const ctrl = new AbortController();
    api
      .agentPrefs(ctrl.signal)
      .then(setPrefs)
      .catch(() => {});
    api
      .models(undefined, ctrl.signal)
      .then((r) => setCatalog({ default: r.default, models: r.models }))
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  const save = async (next: { defaultAgent: AgentId; defaultModel: string }, who: AgentId | "model") => {
    if (!prefs || busy) return;
    setBusy(who);
    try {
      const choice = prefs.agents.find((a) => a.id === next.defaultAgent);
      setPrefs(await api.saveAgentPrefs({ ...next, ...(choice?.supervised === false ? { allowPartialSupervision: true } : {}) }));
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      toast.error("Could not save", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };
  const pick = (id: AgentId) => {
    if (prefs && prefs.defaultAgent !== id) void save({ defaultAgent: id, defaultModel: prefs.defaultModel ?? "" }, id);
  };

  const isFactory = prefs?.defaultAgent === FACTORY && !prefs?.defaultModel;
  return (
    <SettingsSection
      id="agent"
      title="Coding agent"
      purpose="Which agent — and which model — new machines run. Threads already running keep what they started with."
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
          <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={() => void save({ defaultAgent: FACTORY, defaultModel: "" }, FACTORY)} disabled={busy !== null}>
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
                      {a.id !== "claude" && <span className="border-line-strong text-muted-foreground rounded-full border px-1.5 py-px text-micro font-normal">beta</span>}
                    </span>
                    <span className="text-muted-foreground mt-0.5 block text-micro">{DESC[a.id] ?? ""}</span>
                    <span className="mt-1.5 block"><DriverBadges choice={a} /></span>
                    {a.capabilities?.caveat && <span className="text-faint mt-1 block text-micro">{a.capabilities.caveat}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </Swap>
      {prefs && (
        <Field
          label="Default model"
          className="mt-5 max-w-xl"
          hint={
            catalog === null
              ? "Loading the model catalog…"
              : prefs.defaultModel
                ? "Preselected in every new-task composer you open; a thread keeps whatever it started on."
                : `New tasks start on the deployment default${catalog.default ? ` (${catalog.models.find((m) => m.id === catalog.default)?.label ?? catalog.default})` : ""}.`
          }
        >
          {(wire) => (
            <select
              {...wire}
              className={cn(inputClass, "cursor-pointer")}
              value={prefs.defaultModel ?? ""}
              disabled={busy !== null || catalog === null}
              onChange={(e) => void save({ defaultAgent: prefs.defaultAgent, defaultModel: e.target.value }, "model")}
            >
              <option value="">Deployment default{catalog?.default ? ` — ${catalog.models.find((m) => m.id === catalog.default)?.label ?? catalog.default}` : ""}</option>
              {(catalog?.models ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
              {prefs.defaultModel && catalog && !catalog.models.some((m) => m.id === prefs.defaultModel) && <option value={prefs.defaultModel}>{prefs.defaultModel} (not in the catalog)</option>}
            </select>
          )}
        </Field>
      )}
    </SettingsSection>
  );
}
