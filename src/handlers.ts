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
import type { GitAccessResolution } from "./gh-token-store.js";
import type { AgentCreds } from "./msb.js";

export interface DelegationResult {
  box: string;
  warm: boolean;
  output: string;
}

/** Injected side-effecting operations (real impls live in deps.ts; fakes in tests). */
export interface HandlerDeps {
  /** Count live boxes for the concurrency cap. */
  countBoxes(cfg: Config): Promise<number>;
  /**
   * Resolve GitHub access per repo by ACCESS from the login-keyed store (both sources). Returns the
   * owner->token, owner->login maps + a primary. For git a missing/ambiguous account is a question
   * (need token / choose login); for local it's best-effort (owner derived from the origin remote,
   * unresolved repos just get no injected identity/token).
   */
  resolveGitAccess(
    cfg: Config,
    plan: DelegatePlan,
    opts: { githubToken?: string; githubAccount?: string }
  ): Promise<GitAccessResolution>;
  /** Acquire a box for the plan (rsync local tree OR git-clone on VPS), run the agent. */
  runDelegation(
    cfg: Config,
    plan: DelegatePlan,
    allowDomains?: string[],
    creds?: AgentCreds
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
  /** Fleet report: how many boxes are up and what each is doing (role/state/task/metrics). */
  monitor(cfg: Config): Promise<string>;
  /** Probe a token (login/orgs) and store it by account login. Optional repo confirms access. Returns a summary. */
  addGhToken(cfg: Config, token: string, repo?: string): Promise<string>;
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
      githubToken: z
        .string()
        .optional()
        .describe(
          "Provide when delegate asks for one (a repo needs access no stored account has). It is " +
            "validated, stored by its GitHub account login, and reused automatically next time."
        ),
      githubAccount: z
        .string()
        .optional()
        .describe(
          "Provide when delegate asks you to choose among several accounts that can access the repo: " +
            "the GitHub login to use for this delegation."
        ),
    },
    async ({
      source,
      repo,
      repos,
      task,
      ref,
      allowDomains,
      githubToken,
      githubAccount,
    }: {
      source?: DelegateSource;
      repo?: string;
      repos?: Array<{ repo: string; ref?: string }>;
      task?: string;
      ref?: string;
      allowDomains?: string[];
      githubToken?: string;
      githubAccount?: string;
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

      // Resolve GitHub access by ACCESS from the login-keyed store (no default account anywhere):
      // pick, per repo, the account whose token can actually reach it. This drives the CLONE (git),
      // the per-repo push token, the per-repo commit IDENTITY, and the `gh` CLI. Runs for BOTH
      // sources — for local we derive each repo's owner from its origin remote.
      //  - git:   a missing/ambiguous account is a hard question (we can't clone a private repo blind).
      //  - local: best-effort — the working tree is already shipped, so we set identity/token for what
      //           resolves and DON'T block read-only tasks when nothing matches (agent can ask later).
      let creds: AgentCreds | undefined;
      {
        const res = await deps.resolveGitAccess(cfg, v.plan, { githubToken, githubAccount });
        if (!res.ok) {
          if (v.plan.source === "git") return text(res.question);
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
        return text(
          `Refused: ${live}/${cfg.maxBoxes} boxes already running. Tear one down (teardown) or raise MSB_MAX_BOXES.`
        );
      }

      const r = await deps.runDelegation(cfg, v.plan, allowDomains, creds);
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
    "Get the current box state + recent agent log for a delegated session. States: run:running, " +
      "run:done exit=N, run:idle, or run:waiting. IMPORTANT — this is an INTERACTIVE session: when " +
      "you see 'run:waiting' the in-box agent asked a QUESTION and paused. As the calling agent you " +
      "should ANSWER it yourself if you can determine it from the repo/context, otherwise ask the " +
      "user; then call resume(session, <answer>) to continue. Poll status a few times (with short " +
      "waits) until you see run:waiting or run:done — don't assume it finished after delegate.",
    { session: z.string().describe("Session id returned by delegate.") },
    async ({ session }: { session: string }) => text(await deps.status(cfg, session))
  );

  server.tool(
    "resume",
    "Continue the in-box Claude Code session — primarily to ANSWER a question it asked (status shows " +
      "run:waiting). Put the answer in `message`; the agent reads it and proceeds. As the calling " +
      "agent, answer from repo/context when you can, and only ask the user for real decisions or " +
      "secrets. If it needs a credential/connection detail (GitHub token for a private repo, DB URL), " +
      "pass it via `secrets` — injected as env for THIS step only, never stored, gone on teardown.",
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
    "monitor",
    "Fleet overview: how many sandboxes are up right now and what each is doing. Lists every box " +
      "with its role (session vs warm-pool), agent run-state (running / waiting-for-an-answer / " +
      "done / idle), the task it's working on, uptime, and CPU/MEM. Use this to see all in-flight " +
      "delegations at a glance (e.g. which ones are waiting on a question).",
    {},
    async () => text(await deps.monitor(cfg))
  );

  server.tool(
    "gh_token_add",
    "Pre-register a GitHub token so private-repo delegations are automatic. The token identifies " +
      "itself (GET /user) and is stored by its account login, with its org memberships recorded. " +
      "Optionally pass a repo to confirm+record access to it. Usually you don't need this — delegate " +
      "asks for a token on demand when a repo needs one. Stored on the VPS (chmod 600).",
    {
      token: z.string().describe("A GitHub PAT (classic or fine-grained)."),
      repo: z
        .string()
        .optional()
        .describe("Optional owner/name to confirm and record access to (e.g. 'atom-insurance/foo')."),
    },
    async ({ token, repo }: { token: string; repo?: string }) =>
      text(await deps.addGhToken(cfg, token, repo))
  );
}
