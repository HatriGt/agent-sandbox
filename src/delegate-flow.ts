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
import { validateDelegateInput, type DelegateSource } from "./delegate-input.js";
import type { AgentCreds } from "./msb.js";

export interface DelegateFlowInput {
  source?: DelegateSource;
  repo?: string;
  repos?: Array<{ repo: string; ref?: string }>;
  task?: string;
  ref?: string;
  allowDomains?: string[];
  githubToken?: string;
  githubAccount?: string;
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
  });
  if (!v.ok) return { ok: false, question: v.question };

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

  const live = await deps.countBoxes(cfg);
  if (live >= cfg.maxBoxes) {
    return {
      ok: false,
      question: `Refused: ${live}/${cfg.maxBoxes} boxes already running. Tear one down or raise MSB_MAX_BOXES.`,
    };
  }

  const r = await deps.runDelegation(cfg, v.plan, input.allowDomains, creds, {});
  return { ok: true, box: r.box, warm: r.warm, output: r.output, repos: v.plan.repos };
}
