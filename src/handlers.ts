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
  /** Continue the in-box session, optionally injecting ephemeral secrets on this exec only. */
  resume(
    cfg: Config,
    session: string,
    message: string,
    secrets?: Record<string, string>
  ): Promise<string>;
  /** Stop + remove the box. */
  teardown(cfg: Config, session: string): Promise<void>;
  /** Warm pool status line. */
  poolStatus(cfg: Config): Promise<string>;
  /** Persist a GitHub token in the store, keyed by owner (auto-derives the login). Returns a summary. */
  addGhToken(cfg: Config, token: string, owner?: string): Promise<string>;
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
    "Delegate a task to an isolated microVM running Claude Code. source=local ships local working " +
      "trees (Mac/Cursor); source=git clones owner/name on the VPS (remote clients). A task may span " +
      "several repos open in the same IDE window — pass repos:[{repo,ref?},...]; each lands in " +
      "/workspace/<name> in ONE box and gets its own PR. A single `repo` still works. " +
      "Missing info is asked back, not failed.",
    {
      source: z
        .enum(["local", "git"])
        .optional()
        .describe("local = ship local working tree(s) (default); git = clone owner/name on the VPS."),
      repo: z
        .string()
        .optional()
        .describe("Single-repo shorthand. local: absolute path. git: owner/name or GitHub URL."),
      repos: z
        .array(
          z.object({
            repo: z.string().describe("local: absolute path. git: owner/name or GitHub URL."),
            ref: z.string().optional().describe("git only: branch/tag/SHA for THIS repo."),
          })
        )
        .optional()
        .describe(
          "Multiple repos for a cross-repo task (e.g. several folders in a multi-root workspace). " +
            "Each becomes /workspace/<name>; the agent opens a PR per repo it changes."
        ),
      task: z.string().optional().describe("Natural-language task for the in-box agent."),
      ref: z.string().optional().describe("git only: branch/tag/SHA for the single `repo` shorthand."),
      allowDomains: z
        .array(z.string())
        .optional()
        .describe("Extra domains the box may reach (added to the curated egress allowlist)."),
    },
    async ({
      source,
      repo,
      repos,
      task,
      ref,
      allowDomains,
    }: {
      source?: DelegateSource;
      repo?: string;
      repos?: Array<{ repo: string; ref?: string }>;
      task?: string;
      ref?: string;
      allowDomains?: string[];
    }) => {
      const resolvedSource: DelegateSource = source ?? "local";
      // Local "delegate this": with neither repo nor repos, fall back to the IDE-provided open
      // workspace (WORKSPACE_DIR=${workspaceFolder}). Only applies to the single-repo shortcut;
      // multi-root windows pass repos[] explicitly. Remote/git has no such fallback.
      const noRepos = !repo && (!repos || repos.length === 0);
      const resolvedRepo =
        repo ?? (noRepos && resolvedSource === "local" ? cfg.workspaceDir : undefined);
      const v = validateDelegateInput({
        source: resolvedSource,
        repo: resolvedRepo,
        repos,
        task,
        ref,
      });
      if (!v.ok) return text(v.question);

      const live = await deps.countBoxes(cfg);
      if (live >= cfg.maxBoxes) {
        return text(
          `Refused: ${live}/${cfg.maxBoxes} boxes already running. Tear one down (teardown) or raise MSB_MAX_BOXES.`
        );
      }

      const r = await deps.runDelegation(cfg, v.plan, allowDomains);
      const repoLine =
        v.plan.repos.length > 1
          ? `\nrepos: ${v.plan.repos.map((x) => `${x.repo} -> /workspace/${x.name}`).join(", ")}`
          : "";
      return text(
        `Delegated. session=${r.box}${r.warm ? " (warm)" : ""}${repoLine}\n\n${r.output}\n\n` +
          `Next: status({session:"${r.box}"}) to watch progress; resume({session:"${r.box}",message:"..."}) to follow up.`
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
    "Send a follow-up / continue the in-box Claude Code session. If the agent reported it needs a " +
      "credential or connection detail (e.g. a GitHub token for a private repo, a DB URL), pass it " +
      "via `secrets` — injected as env for THIS step only, never stored, gone on teardown.",
    {
      session: z.string().describe("Session id returned by delegate."),
      message: z.string().describe("Follow-up instruction or answer for the agent."),
      secrets: z
        .record(z.string())
        .optional()
        .describe(
          "Ephemeral env for this step only, e.g. {\"GITHUB_TOKEN\":\"...\",\"DB_URL\":\"...\"}. " +
            "Injected as -e KEY=VALUE; not persisted."
        ),
    },
    async ({
      session,
      message,
      secrets,
    }: {
      session: string;
      message: string;
      secrets?: Record<string, string>;
    }) => {
      const out = await deps.resume(cfg, session, message, secrets);
      return text(`Resumed session=${session}\n\n${out}`);
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

  server.tool(
    "gh_token_add",
    "Save a GitHub token permanently so private-repo delegations for its owner/org are automatic. " +
      "The token identifies itself (GET /user), so you usually don't pass an owner — but for an ORG " +
      "you don't belong to by login, pass owner to key it under that org. Stored on the VPS (chmod 600).",
    {
      token: z.string().describe("A GitHub PAT (classic or fine-grained) with access to the repos."),
      owner: z
        .string()
        .optional()
        .describe(
          "Owner/org to key this token under (e.g. 'atom-insurance'). Omit to use the token's own login."
        ),
    },
    async ({ token, owner }: { token: string; owner?: string }) =>
      text(await deps.addGhToken(cfg, token, owner))
  );
}
