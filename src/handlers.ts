/**
 * Shared MCP tool handlers — registered by BOTH the stdio entry (index.ts) and the HTTP entry
 * (http.ts) so the two controllers expose identical tools with identical behavior.
 *
 * Side-effecting work is injected via `deps` so the handlers are unit-testable without a VPS:
 *   - runDelegation: acquire a box (local rsync OR git clone), run the agent, return output.
 *   - the status/resume/teardown/pool deps map straight to msb/pool functions.
 *
 * Ask-if-missing (Phase 1): delegate validates its args and, when something required is missing,
 * returns a plain-text question instead of failing. The caller re-calls delegate with the value.
 */
import { z } from "zod";
import type { Config } from "./config.js";
import { validateDelegateInput, type DelegateSource, type DelegatePlan } from "./delegate-input.js";

export interface DelegationResult {
  box: string;
  warm: boolean;
  output: string;
}

/** Injected side-effecting operations (real impls live in deps.ts; fakes in tests). */
export interface HandlerDeps {
  /** Count live boxes for the concurrency cap. */
  countBoxes(cfg: Config): Promise<number>;
  /** Acquire a box for the plan (rsync local tree OR git-clone on VPS), run the agent. */
  runDelegation(
    cfg: Config,
    plan: DelegatePlan,
    allowDomains?: string[]
  ): Promise<DelegationResult>;
  /** msb status + recent log. */
  status(cfg: Config, session: string): Promise<string>;
  /** Continue the in-box session. */
  resume(cfg: Config, session: string, message: string): Promise<string>;
  /** Stop + remove the box. */
  teardown(cfg: Config, session: string): Promise<void>;
  /** Warm pool status line. */
  poolStatus(cfg: Config): Promise<string>;
}

/** Minimal shape of the MCP server's `.tool()` we rely on (keeps this file transport-agnostic). */
interface ToolRegistrar {
  tool(name: string, description: string, schema: unknown, handler: (args: any) => any): void;
}

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

export function registerTools(server: ToolRegistrar, cfg: Config, deps: HandlerDeps): void {
  server.tool(
    "delegate",
    "Delegate a task to an isolated microVM running Claude Code. source=local ships your local " +
      "working tree (Mac/Cursor); source=git clones owner/name on the VPS (remote clients). " +
      "Missing info is asked back, not failed.",
    {
      source: z
        .enum(["local", "git"])
        .optional()
        .describe("local = ship local working tree (default); git = clone owner/name on the VPS."),
      repo: z
        .string()
        .optional()
        .describe("local: absolute path to the working tree. git: owner/name or GitHub URL."),
      task: z.string().optional().describe("Natural-language task for the in-box agent."),
      ref: z.string().optional().describe("git only: branch/tag/SHA (default: repo default branch)."),
      allowDomains: z
        .array(z.string())
        .optional()
        .describe("Extra domains the box may reach (added to the curated egress allowlist)."),
    },
    async ({
      source,
      repo,
      task,
      ref,
      allowDomains,
    }: {
      source?: DelegateSource;
      repo?: string;
      task?: string;
      ref?: string;
      allowDomains?: string[];
    }) => {
      const resolvedSource: DelegateSource = source ?? "local";
      const v = validateDelegateInput({ source: resolvedSource, repo, task, ref });
      if (!v.ok) return text(v.question);

      const live = await deps.countBoxes(cfg);
      if (live >= cfg.maxBoxes) {
        return text(
          `Refused: ${live}/${cfg.maxBoxes} boxes already running. Tear one down (teardown) or raise MSB_MAX_BOXES.`
        );
      }

      const r = await deps.runDelegation(cfg, v.plan, allowDomains);
      return text(
        `Delegated. session=${r.box}${r.warm ? " (warm)" : ""}\n\n--- agent output ---\n${r.output}`
      );
    }
  );

  server.tool(
    "status",
    "Get the current box state and recent agent log for a delegated session.",
    { session: z.string().describe("Session id returned by delegate.") },
    async ({ session }: { session: string }) => text(await deps.status(cfg, session))
  );

  server.tool(
    "resume",
    "Send a follow-up / continue the in-box Claude Code session.",
    {
      session: z.string().describe("Session id returned by delegate."),
      message: z.string().describe("Follow-up instruction or answer for the agent."),
    },
    async ({ session, message }: { session: string; message: string }) => {
      const out = await deps.resume(cfg, session, message);
      return text(`Resumed session=${session}\n\n--- agent output ---\n${out}`);
    }
  );

  server.tool(
    "teardown",
    "Stop and remove the box for a delegated session.",
    { session: z.string().describe("Session id returned by delegate.") },
    async ({ session }: { session: string }) => {
      await deps.teardown(cfg, session);
      return text(`Torn down session=${session} (box removed).`);
    }
  );

  server.tool(
    "pool_status",
    "Show the warm pool status: how many pre-booted boxes are available vs the target.",
    {},
    async () => text(await deps.poolStatus(cfg))
  );
}
