/**
 * Which coding agent a run launches inside the box: Claude Code (default) or oh-my-pi (omp).
 *
 * The kind is a controller decision that ends up inside a shell command (agentSh branches on it),
 * so it is a closed enum — never caller-shaped text. The per-user default lives in the same
 * encrypted per-owner blob store the notify settings use; the per-thread truth is the in-box
 * `.agent.kind` sentinel written by the FIRST run, so every resume lane (dashboard, inbox, MCP,
 * broker) self-detects the agent without plumbing it through each caller.
 */
import { loadBlob, saveBlob, ownerKey } from "./user-store.js";

export type AgentKind = "claude" | "omp";

export const AGENT_KINDS: readonly AgentKind[] = ["claude", "omp"] as const;

export const AGENT_LABELS: Record<AgentKind, string> = {
  claude: "Claude Code",
  omp: "oh-my-pi",
};

export function isAgentKind(v: unknown): v is AgentKind {
  return v === "claude" || v === "omp";
}

export interface AgentPrefs {
  defaultAgent: AgentKind;
}

export const AGENT_PREFS_KIND = "agent-prefs";

/**
 * Validate a caller-supplied prefs body. Missing means the default; a PRESENT-but-unknown value is
 * an error (silently coercing a typo'd pick to claude would look like the setting didn't save).
 */
export function normalizeAgentPrefs(raw: unknown): AgentPrefs {
  const r = (raw ?? {}) as { defaultAgent?: unknown };
  if (r.defaultAgent === undefined || r.defaultAgent === null || r.defaultAgent === "") {
    return { defaultAgent: "claude" };
  }
  if (!isAgentKind(r.defaultAgent)) {
    throw new Error(`defaultAgent must be one of: ${AGENT_KINDS.join(", ")}`);
  }
  return { defaultAgent: r.defaultAgent };
}

/** The stored prefs for an owner; a missing/corrupt blob degrades to the default, never throws. */
export function loadAgentPrefs(owner = ownerKey()): AgentPrefs {
  try {
    const raw = loadBlob(AGENT_PREFS_KIND, owner);
    if (!raw) return { defaultAgent: "claude" };
    const parsed = JSON.parse(raw) as { defaultAgent?: unknown };
    return isAgentKind(parsed.defaultAgent) ? { defaultAgent: parsed.defaultAgent } : { defaultAgent: "claude" };
  } catch {
    return { defaultAgent: "claude" };
  }
}

export function saveAgentPrefs(prefs: AgentPrefs, owner = ownerKey()): void {
  saveBlob(AGENT_PREFS_KIND, JSON.stringify(prefs), owner);
}
