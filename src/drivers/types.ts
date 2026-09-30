/**
 * The driver contract (docs/plan-agent-cloud.md, workstream A). A driver is everything that is
 * specific to ONE coding-agent CLI inside the box: how it is installed, how a run and a resume are
 * launched, how its pre-action gate is wired, and how its native event stream is turned into the
 * sentinel log grammar (src/drivers/sentinels.ts) that the trace parser, thread, digest and mobile
 * read. The run wrapper around the launch — pid/run/done marks, the ⟦you⟧ echo, the resume wait —
 * is driver-independent and stays in src/msb.ts (agentSh).
 *
 * Shape notes vs. the plan's sketch: every shell here reads the task and policy from the exec env
 * ($AGENT_TASK, $AGENT_SYS_PROMPT, $ANTHROPIC_* / $OPENAI_*), never from arguments, so `launch`
 * takes only what changes the command's SHAPE. `ask` (the read-only side-question lane) is still
 * Claude-only and lives in src/msb.ts askInBox; `capabilities.sideQuestion` says which drivers a
 * thread can side-ask while they work (the lane itself always runs Claude Code).
 */
import type { Config } from "../config.js";
import type { AgentKind } from "../agent-kind.js";

export type DriverKind = AgentKind;

/** Where a driver can get a model from; matches the provider kinds in src/providers.ts. */
export type ModelSource = "anthropic" | "openai" | "openai-compatible" | "local";

export interface DriverCapabilities {
  /**
   * Can a pending question DENY the agent's next tool call?
   *  - "hook": a native pre-tool hook we install (verified against the CLI's documented contract).
   *  - "wrapper": a box-side supervisor stops the process instead (coarser: the turn is killed, not
   *    denied, and the session is resumed with the answer).
   *  - "none": nothing stops the agent after it writes a question; it may keep working.
   */
  gate: "hook" | "wrapper" | "none";
  /** The read-only side-question lane can run next to this driver. */
  sideQuestion: boolean;
  /** Structured plan snapshots (⟦plan⟧) come out of the formatter. */
  planEvents: boolean;
  /** A run can be continued in the same session with an answer / follow-up. */
  resume: boolean;
  modelSources: ModelSource[];
  /** One honest sentence shown under the badges when something is weaker than Claude Code's. */
  caveat?: string;
}

export interface LaunchInput {
  resume: boolean;
}

export interface Driver {
  kind: DriverKind;
  label: string;
  capabilities: DriverCapabilities;
  /** Shell: ensure the CLI is installed (idempotent, version-aware where a pin exists). "" = nothing. */
  install(cfg: Config): string;
  /**
   * Shell fragment that runs ONE turn and pipes its events through the formatter into the agent
   * log, ending in `; ` so the wrapper can record `$?` (pipefail is on). Reads $AGENT_TASK.
   */
  launch(input: LaunchInput): string;
  /** Shell that installs the pre-action gate, or null when the driver has none of its own. */
  gateScript(): string | null;
  /** Shell that installs the native-events → sentinel-log formatter. */
  formatter(): string;
  /** The standing policy handed to the agent as $AGENT_SYS_PROMPT. */
  systemPrompt: string;
  /** Extra `-e K=V` exec flags this driver needs beyond the shared env (model roles, etc.). */
  envFlags(cfg: Config): string[];
}

/**
 * The supervision floor (plan §A): a driver is fully supervised only if a pending question can
 * stop it AND the session can be resumed with the answer. A driver below the floor may still be
 * selectable, but only with a visible "supervised: partial" badge — never silently.
 */
export function meetsSupervisionFloor(c: DriverCapabilities): boolean {
  return c.gate !== "none" && c.resume;
}
