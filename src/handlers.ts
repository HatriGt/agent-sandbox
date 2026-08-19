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
import type { ElicitOutcome } from "./interactive.js";

/**
 * Interactive callbacks the handler supplies to the deps layer so the wait loop can talk to the
 * client mid tool-call: `elicit` asks the user a question natively (undefined when the client can't
 * elicit — deps then falls back to returning the question), `progress` keeps a long run alive.
 */
export interface Interact {
  elicit?: (question: string) => Promise<ElicitOutcome>;
  progress?: (message: string) => Promise<void>;
}

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
    creds?: AgentCreds,
    interact?: Interact
  ): Promise<DelegationResult>;
  /** msb status + recent log (blocks to the next boundary; interactive when elicit is available). */
  status(cfg: Config, session: string, interact?: Interact): Promise<string>;
  /** Continue the in-box session, optionally injecting ephemeral secrets on this exec only. */
  resume(
    cfg: Config,
    session: string,
    message: string,
    secrets?: Record<string, string>,
    interact?: Interact
  ): Promise<string>;
  /** Stop + remove the box. */
  teardown(cfg: Config, session: string): Promise<void>;
  /** Warm pool status line. */
  poolStatus(cfg: Config): Promise<string>;
  /** Fleet report: how many boxes are up and what each is doing (role/state/task/metrics). */
  monitor(cfg: Config): Promise<string>;
  /** Live over-the-shoulder view of ONE box: state + task + a log tail (lines default in impl). */
  watch(cfg: Config, session: string, lines?: number): Promise<string>;
  /** Probe a token (login/orgs) and store it by account login. Optional repo confirms access. Returns a summary. */
  addGhToken(cfg: Config, token: string, repo?: string): Promise<string>;
}

/** Minimal shape of the MCP server's `.tool()` we rely on (keeps this file transport-agnostic). */
interface ToolRegistrar {
  tool(name: string, description: string, schema: unknown, handler: (args: any) => any): void;
}

/**
 * Bridge to the concrete MCP server for interactive features, kept as a tiny interface so handlers
 * stay transport-agnostic and tests can omit it. `canElicit` reflects the client's advertised
 * capability; `elicit` sends the native question; `progress` sends a keep-alive notification.
 */
export interface ServerBridge {
  canElicit(): boolean;
  elicit(question: string): Promise<ElicitOutcome>;
  progress(message: string): Promise<void>;
}

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

/** Build the per-call Interact from the bridge: elicit only when the client supports it. */
function interactFrom(bridge?: ServerBridge): Interact {
  if (!bridge) return {};
  return {
    elicit: bridge.canElicit() ? (q: string) => bridge.elicit(q) : undefined,
    progress: (m: string) => bridge.progress(m),
  };
}

export function registerTools(
  server: ToolRegistrar,
  cfg: Config,
  deps: HandlerDeps,
  bridge?: ServerBridge
): void {
  server.tool(
    "delegate",
    "Delegate a task to an isolated microVM running Claude Code. source=local ships local working " +
      "trees (Mac/Cursor); source=git clones owner/name on the VPS (remote clients). A task may span " +
      "several repos open in the same IDE window — pass repos:[{repo,ref?},...]; each lands in " +
      "/workspace/<name> in ONE box and gets its own PR. A single `repo` still works. " +
      "A repo is OPTIONAL: pass ONLY a task (no repo/repos) for repo-less work — e.g. 'write a " +
      "detailed report about X' — and the box boots with an empty /workspace. " +
      "Missing info is asked back, not failed. " +
      "FULLY INTERACTIVE — this single call runs the whole delegation to completion. It ships the " +
      "repo, launches the in-box agent, and drives the entire conversation itself: whenever the agent " +
      "needs a decision it asks YOU directly via a native prompt (MCP elicitation), and continues " +
      "with your answer — all without returning. You normally do NOTHING between: just answer the " +
      "prompts as they pop up. The call returns only when the task is DONE (report the PR link / " +
      "result to the user) or was cancelled (you declined a prompt). On the rare client without " +
      "elicitation support it instead returns the pending question and you answer via " +
      "resume(session, <answer>). Either way: do NOT say 'I'll report back later' — the work happens " +
      "inside this call.",
    {
      source: z
        .enum(["local", "git"])
        .optional()
        .describe("local = ship local working tree(s) (default); git = clone owner/name on the VPS."),
      repo: z
        .string()
        .optional()
        .describe(
          "Single-repo shorthand (OPTIONAL — omit for a repo-less, task-only run). local: absolute " +
            "path. git: owner/name or GitHub URL."
        ),
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

      const r = await deps.runDelegation(cfg, v.plan, allowDomains, creds, interactFrom(bridge));
      const repoLine =
        v.plan.repos.length > 1
          ? `\nrepos: ${v.plan.repos.map((x) => `${x.repo} -> /workspace/${x.name}`).join(", ")}`
          : "";
      return text(
        `Delegated. session=${r.box}${r.warm ? " (warm)" : ""}${repoLine}\n\n${r.output}\n\n` +
          `If the box asked a question (run:waiting), answer it now: resume({session:"${r.box}",message:"<answer>"}). ` +
          `If it finished (run:done), report the outcome to the user. If it's still working, reconnect with status({session:"${r.box}"}).`
      );
    }
  );

  server.tool(
    "status",
    "Reconnect to a delegated session and resume driving it interactively — same as delegate: it " +
      "runs the ask (native prompt) → answer → continue loop and returns only when the task is DONE " +
      "or cancelled. Use it if a delegate/resume call was interrupted, or (on a client without " +
      "elicitation) after answering a returned question. On such clients it returns the next pending " +
      "question; answer via resume(session, <answer>). Never end your turn while it still reports a " +
      "pending question or in-flight run.",
    { session: z.string().describe("Session id returned by delegate.") },
    async ({ session }: { session: string }) => text(await deps.status(cfg, session, interactFrom(bridge)))
  );

  server.tool(
    "resume",
    "Continue the in-box Claude Code session — primarily to ANSWER a question it asked (run:waiting). " +
      "Put the answer in `message`; the agent reads it and proceeds. Like delegate, this call is " +
      "INTERACTIVE & BLOCKING: it feeds the answer in and WAITS until the agent asks the next question " +
      "or finishes, then returns that — so keep answering/resuming until you get run:done. It also " +
      "auto-starts the box if it idle-stopped while waiting. As the calling agent, answer from " +
      "repo/context when you can, and only ask the user for real decisions or secrets. If it needs a " +
      "credential/connection detail (GitHub token for a private repo, DB URL), pass it via `secrets` " +
      "— injected as env for THIS step only, never stored, gone on teardown.",
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
      const out = await deps.resume(cfg, session, message, secrets, interactFrom(bridge));
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
    "watch",
    "Live over-the-shoulder view of ONE delegated session: its run-state, the task it's on, resource " +
      "use, and a tail of the agent's log (what it's actually doing right now). Richer than `status` " +
      "— use it to visually follow a single box. For a terminal live-stream, run `npm run watch " +
      "<session>` on the VPS instead.",
    {
      session: z.string().describe("Session id returned by delegate."),
      lines: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("How many log lines to show (default 40)."),
    },
    async ({ session, lines }: { session: string; lines?: number }) =>
      text(await deps.watch(cfg, session, lines))
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
