/**
 * The delegate orchestration (validate -> resolve GitHub access -> capacity check -> run), factored
 * out of the MCP `delegate` tool so the dashboard's composer can start a real delegation over HTTP
 * without duplicating that logic or routing through an MCP transport. `handlers.ts` keeps its own
 * inline copy for the MCP tool (its tests fake individual HandlerDeps methods, not this shape) — this
 * is the second, HTTP-facing caller, not a replacement.
 *
 * Pure orchestration: every side effect is the injected HandlerDeps, same as handlers.ts, so this is
 * unit-testable with fakes and carries no VPS dependency of its own.
 */
import type { Config } from "./config.js";
import type { HandlerDeps } from "./handlers.js";
import { validateDelegateInput, type DelegateSource, type Attachment } from "./delegate-input.js";
import type { AgentCreds } from "./msb.js";
import { reserveBox } from "./capacity.js";
import type { VerifyPlan } from "./verify.js";
import { providerFitsDriver, driversFor, type ProviderRecord } from "./providers.js";
import type { RunBudget } from "./budget.js";
import { AGENT_LABELS } from "./agent-kind.js";

export interface DelegateFlowInput {
  source?: DelegateSource;
  repo?: string;
  /** `patch`: a handoff carry diff (src/handoff.ts) — set only by trigger chains. */
  repos?: Array<{ repo: string; ref?: string; patch?: string }>;
  task?: string;
  ref?: string;
  allowDomains?: string[];
  githubToken?: string;
  githubAccount?: string;
  attachments?: Attachment[];
  /** Model alias for message 1 (already allowlist-validated by the route). */
  model?: string;
  /** Coding agent for this thread ("claude" | "omp"); validated by validateDelegateInput. */
  agent?: string;
  /**
   * Verified-outcomes clause (src/verify.ts), already validated by the route via verifyPlanOf.
   * The flow itself does not run it — a browser delegate returns before the run finishes, so the
   * route runs verification on the done edge of the fleet sweep and stamps the digest.
   */
  verify?: VerifyPlan;
  /**
   * Return as soon as the agent is LAUNCHED instead of blocking to the first interactive boundary.
   * The dashboard path sets this: the browser only needs the box name (the thread attaches over
   * SSE), and blocking the HTTP response on the wait window made "start a task" feel ~50s slower
   * than it was. MCP callers keep the blocking default — the open tool call IS their listener.
   */
  detach?: boolean;
  /** Explicit acknowledgement of a "supervised: partial" driver. */
  allowPartialSupervision?: boolean;
  /** The caller's model provider (already resolved to the owner's record by the route). */
  provider?: ProviderRecord;
  /** Per-run budget, already normalized (src/budget.ts). */
  budget?: RunBudget;
}

export type DelegateFlowResult =
  | { ok: true; box: string; warm: boolean; output: string; repos: Array<{ repo: string; name: string }> }
  | { ok: false; question: string };

export async function runDelegateFlow(
  cfg: Config,
  deps: HandlerDeps,
  input: DelegateFlowInput
): Promise<DelegateFlowResult> {
  const resolvedSource: DelegateSource = input.source ?? "local";
  const noRepos = !input.repo && (!input.repos || input.repos.length === 0);
  const resolvedRepo =
    input.repo ?? (noRepos && resolvedSource === "local" ? cfg.workspaceDir : undefined);

  const v = validateDelegateInput({
    source: resolvedSource,
    repo: resolvedRepo,
    repos: input.repos,
    task: input.task,
    ref: input.ref,
    model: input.model,
    agent: input.agent,
    allowPartialSupervision: input.allowPartialSupervision,
  });
  if (!v.ok) return { ok: false, question: v.question };
  if (input.attachments?.length) v.plan.attachments = input.attachments;
  if (input.provider) {
    const driver = v.plan.agent ?? "claude";
    if (!providerFitsDriver(input.provider, driver)) {
      return {
        ok: false,
        question: `${AGENT_LABELS[driver]} cannot run on the ${input.provider.label} provider. Pick a driver that supports it: ${driversFor(input.provider.kind).map((d) => AGENT_LABELS[d]).join(", ") || "none"}.`,
      };
    }
    v.plan.provider = input.provider;
  }
  if (input.budget) v.plan.budget = input.budget;

  const tFlow = Date.now();
  let creds: AgentCreds | undefined;
  {
    const res = await deps.resolveGitAccess(cfg, v.plan, {
      githubToken: input.githubToken,
      githubAccount: input.githubAccount,
    });
    if (!res.ok) {
      if (v.plan.source === "git") return { ok: false, question: res.question };
      // local: unresolved access is not fatal — proceed with no injected identity/token.
    } else {
      creds = {
        ownerTokens: res.ownerTokens,
        ownerLogins: res.ownerLogins,
        primaryToken: res.primaryToken,
        primaryLogin: res.primaryLogin,
      };
    }
  }

  const tAccess = Date.now();
  const live = await deps.countBoxes(cfg);
  console.error(`[timing] flow access=${tAccess - tFlow}ms capacity=${Date.now() - tAccess}ms`);
  // reserveBox counts concurrent delegations that have passed this check but not yet booted, so a
  // parallel fan-out cannot overshoot MSB_MAX_BOXES between the count and the boot.
  const release = reserveBox(live, cfg.maxBoxes);
  if (!release) {
    return {
      ok: false,
      question: `Refused: ${live}/${cfg.maxBoxes} boxes already running or starting. Tear one down or raise MSB_MAX_BOXES.`,
    };
  }

  try {
    const r = await deps.runDelegation(cfg, v.plan, input.allowDomains, creds, { detach: input.detach });
    return { ok: true, box: r.box, warm: r.warm, output: r.output, repos: v.plan.repos };
  } finally {
    release();
  }
}
