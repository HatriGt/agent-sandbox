/**
 * Which coding agent a run launches inside the box: Claude Code (default) or oh-my-pi (omp).
 *
 * The kind is a controller decision that ends up inside a shell command (agentSh branches on it),
 * so it is a closed enum — never caller-shaped text. The per-user default lives in the same
 * encrypted per-owner blob store the notify settings use; the per-thread truth is the in-box
 * `.agent.kind` sentinel written by the FIRST run, so every resume lane (dashboard, inbox, MCP,
 * broker) self-detects the agent without plumbing it through each caller.
 */
import { allBlobs, hasUserStoreBackend, loadBlob, saveBlob, ownerKey } from "./user-store.js";

export type AgentKind = "claude" | "omp" | "codex" | "opencode";

export const AGENT_KINDS: readonly AgentKind[] = ["claude", "omp", "codex", "opencode"] as const;

export const AGENT_LABELS: Record<AgentKind, string> = {
  claude: "Claude Code",
  omp: "oh-my-pi",
  codex: "Codex CLI",
  opencode: "OpenCode",
};

export function isAgentKind(v: unknown): v is AgentKind {
  return v === "claude" || v === "omp" || v === "codex" || v === "opencode";
}

export interface AgentPrefs {
  defaultAgent: AgentKind;
  /** The model the composer preselects for this owner (a model id of the default agent); absent = the agent's own default. */
  defaultModel?: string;
  /** When Claude Code compacts the conversation on its own; absent = "standard" (its default). */
  autoCompact?: AutoCompactMode;
}

/**
 * Auto-compaction, for Claude Code threads. Claude Code summarizes the conversation by itself when
 * the context window nearly fills; this picks when:
 *  - "standard": Claude Code's default, close to the full window.
 *  - "early": at about 100K tokens — a leaner context, cheaper and sharper turns on long threads,
 *    at the cost of detail from early in the conversation.
 *  - "off": never on its own; the thread warns as the window fills and /compact still works. A
 *    run that hits the limit stops with "prompt is too long".
 */
export type AutoCompactMode = "standard" | "early" | "off";
export const AUTO_COMPACT_MODES: readonly AutoCompactMode[] = ["standard", "early", "off"] as const;
export function isAutoCompactMode(v: unknown): v is AutoCompactMode {
  return v === "standard" || v === "early" || v === "off";
}

export const AGENT_PREFS_KIND = "agent-prefs";

/**
 * Validate a caller-supplied prefs body. Missing means the default; a PRESENT-but-unknown value is
 * an error (silently coercing a typo'd pick to claude would look like the setting didn't save).
 */
export function normalizeAgentPrefs(raw: unknown): AgentPrefs {
  const r = (raw ?? {}) as { defaultAgent?: unknown; defaultModel?: unknown; autoCompact?: unknown };
  const model = modelOf(r.defaultModel);
  if (r.autoCompact !== undefined && r.autoCompact !== null && r.autoCompact !== "" && !isAutoCompactMode(r.autoCompact)) {
    throw new Error(`autoCompact must be one of: ${AUTO_COMPACT_MODES.join(", ")}`);
  }
  const compact = compactOf(r.autoCompact);
  if (r.defaultAgent === undefined || r.defaultAgent === null || r.defaultAgent === "") {
    return { defaultAgent: "claude", ...model, ...compact };
  }
  if (!isAgentKind(r.defaultAgent)) {
    throw new Error(`defaultAgent must be one of: ${AGENT_KINDS.join(", ")}`);
  }
  return { defaultAgent: r.defaultAgent, ...model, ...compact };
}

/** A non-empty, short model id; anything else means "no preference". */
function modelOf(v: unknown): { defaultModel?: string } {
  const s = typeof v === "string" ? v.trim().slice(0, 120) : "";
  return s ? { defaultModel: s } : {};
}

/** "standard" is the default and is not stored, so an untouched blob and a reset one read the same. */
function compactOf(v: unknown): { autoCompact?: AutoCompactMode } {
  return isAutoCompactMode(v) && v !== "standard" ? { autoCompact: v } : {};
}

/** The stored prefs for an owner; a missing/corrupt blob degrades to the default, never throws. */
export function loadAgentPrefs(owner = ownerKey()): AgentPrefs {
  try {
    const raw = loadBlob(AGENT_PREFS_KIND, owner);
    if (!raw) return { defaultAgent: "claude" };
    const parsed = JSON.parse(raw) as { defaultAgent?: unknown; defaultModel?: unknown; autoCompact?: unknown };
    return { defaultAgent: isAgentKind(parsed.defaultAgent) ? parsed.defaultAgent : "claude", ...modelOf(parsed.defaultModel), ...compactOf(parsed.autoCompact) };
  } catch {
    return { defaultAgent: "claude" };
  }
}

export function saveAgentPrefs(prefs: AgentPrefs, owner = ownerKey()): void {
  saveBlob(AGENT_PREFS_KIND, JSON.stringify(prefs), owner);
}

/**
 * Which agents ANY owner has picked as their default — the warm pool keeps boxes only for these
 * flavors, so a single-user deployment that switched to omp doesn't also burn 1G on an idle claude
 * box (and vice versa). Union across owners: on a multi-user deployment each user's pick keeps
 * their flavor warm. Caveat, documented deliberately: owners who never touched the setting store
 * no blob and are invisible here — once at least one pref is stored, only stored picks count.
 * No stored prefs at all (or no store backend, e.g. the stdio entry) means the classic claude pool.
 */
export function preferredAgents(): Set<AgentKind> {
  const set = new Set<AgentKind>();
  try {
    if (hasUserStoreBackend()) {
      for (const raw of allBlobs(AGENT_PREFS_KIND)) {
        try {
          const d = (JSON.parse(raw) as { defaultAgent?: unknown }).defaultAgent;
          if (isAgentKind(d)) set.add(d);
        } catch {
          /* one bad blob never hides the rest */
        }
      }
    }
  } catch {
    /* fall through to the default */
  }
  if (set.size === 0) set.add("claude");
  return set;
}
