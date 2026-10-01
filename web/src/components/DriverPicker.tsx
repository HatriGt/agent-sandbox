import * as React from "react";
import { api, type AgentChoice, type AgentId } from "@/lib/api";
import { cn } from "@/lib/utils";

const SOURCE_LABEL: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  "openai-compatible": "OpenAI-compatible",
  local: "Local",
};

function Badge({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "ok" | "attention" }) {
  return (
    <span
      className={cn(
        "rounded-full border px-1.5 py-px text-micro font-normal whitespace-nowrap",
        tone === "ok" && "border-ok/40 text-ok",
        tone === "attention" && "border-attention/50 text-attention",
        tone === "muted" && "border-line-strong text-muted-foreground"
      )}
    >
      {children}
    </span>
  );
}

/**
 * What a driver can actually do, as badges. The words come straight from the server's capability
 * record — "supervised: partial" whenever a pending question cannot stop the agent, never softened.
 */
export function DriverBadges({ choice }: { choice: AgentChoice }) {
  const c = choice.capabilities;
  if (!c) return null;
  const supervised = choice.supervised !== false;
  return (
    <span className="flex flex-wrap items-center gap-1">
      <Badge tone={supervised ? "ok" : "attention"}>{supervised ? "supervised" : "supervised: partial"}</Badge>
      <Badge>{c.gate === "hook" ? "pre-action gate" : c.gate === "wrapper" ? "stop-and-resume gate" : "no gate"}</Badge>
      {c.planEvents && <Badge>plan card</Badge>}
      {c.sideQuestion && <Badge>side questions</Badge>}
      <Badge>{c.modelSources.map((s) => SOURCE_LABEL[s] ?? s).join(" · ")}</Badge>
    </span>
  );
}

/** The composer's agent pick for the NEXT thread; null = the stored default. */
export function useAgentChoice() {
  const [choices, setChoices] = React.useState<AgentChoice[]>([]);
  const [defaultId, setDefaultId] = React.useState<AgentId>("claude");
  const [picked, setPicked] = React.useState<AgentId | null>(null);
  React.useEffect(() => {
    const ctrl = new AbortController();
    api
      .agentPrefs(ctrl.signal)
      .then((p) => {
        setChoices(p.agents);
        setDefaultId(p.defaultAgent);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, []);
  const currentId = picked ?? defaultId;
  const current = choices.find((c) => c.id === currentId) ?? null;
  return { choices, defaultId, current, picked, pick: setPicked };
}
