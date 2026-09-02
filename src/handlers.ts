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
import { isBoxName } from "./sync.js";
import { z } from "zod";
import type { Config } from "./config.js";
import { validateDelegateInput, type DelegateSource, type DelegatePlan } from "./delegate-input.js";
import type { GitAccessResolution } from "./gh-token-store.js";
import type { AgentCreds } from "./msb.js";
import type { ElicitOutcome } from "./interactive.js";
import { verifyPlanOf, formatVerifyResult, type VerifyPlan, type VerifyResult } from "./verify.js";

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
  /** Continue the in-box session WITHOUT waiting for the next boundary (dashboard / queue / broker). */
  resumeDetached?(cfg: Config, session: string, message: string, secrets?: Record<string, string>): Promise<void>;
  /** Stop + remove the box. */
  teardown(cfg: Config, session: string): Promise<void>;
  /** Warm pool status line. */
  poolStatus(cfg: Config): Promise<string>;
  /** Fleet report: how many boxes are up and what each is doing (role/state/task/metrics). */
  monitor(cfg: Config): Promise<string>;
  /** Live over-the-shoulder view of ONE box: state + task + a log tail (lines default in impl). */
  watch(cfg: Config, session: string, lines?: number): Promise<string>;
  /**
   * Ask a read-only co-pilot about a box WITHOUT interrupting the driver agent (separate lane,
   * separate Claude session; nothing it says reaches the driver).
   */
  ask(cfg: Config, session: string, question: string, newThread?: boolean): Promise<string>;
  /** Probe a token (login/orgs) and store it by account login. Optional repo confirms access. Returns a summary. */
  addGhToken(cfg: Config, token: string, repo?: string): Promise<string>;
  /** Repositories reachable through the connected accounts, ranked for `query`. Optional (HTTP entry). */
  listRepos?(cfg: Config, query: string): Promise<string>;
  /** Clone a repository into a RUNNING sandbox at /workspace/<name>. Optional (HTTP entry). */
  attachRepo?(cfg: Config, session: string, repo: string, ref?: string): Promise<string>;
  /**
   * Verify a FINISHED run against the caller's verify clause (command exit code, or a read-only
   * co-pilot judging a criterion). Runs after run:done exit=0; the result stamps the run — a failed
   * verification never un-finishes it. Optional: entries without it ignore `verify`.
   */
  verify?(cfg: Config, session: string, plan: VerifyPlan): Promise<VerifyResult>;
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
  bridge?: ServerBridge,
  /**
   * True for the REMOTE (HTTP) entry, where the client is on another machine.
   *
   * `source:"local"` means "rsync the caller's working tree", which only makes sense on the stdio
   * entry where the controller and the IDE share a filesystem. Over HTTP that path rsyncs from the
   * SERVER's disk: a Windows/Mac checkout path doesn't exist there, so it failed with a bare
   * "spawn rsync ENOENT" that reads to the calling agent like the sandbox is unreachable. Remote
   * callers must use source:"git" (clone on the VPS), so the default flips and an explicit
   * source:"local" is answered with a question instead of a broken sync.
   */
  remoteEntry = false
): void {
  server.tool(
    "delegate",
    "Delegate a task to an isolated microVM running Claude Code. source=local ships the working " +
      "tree from the machine your IDE runs on (stdio entry); source=git makes the sandbox check out " +
      "owner/name itself (any remote MCP client). With source=git, UNCOMMITTED local work can still " +
      "ride along as `patch` — see that argument for when to send one. A task may span " +
      "several repos open in the same IDE window — pass repos:[{repo,ref?},...]; each lands in " +
      "/workspace/<name> in ONE box and gets its own PR. A single `repo` still works. " +
      "A repo is OPTIONAL: pass ONLY a task (no repo/repos) for repo-less work — e.g. 'write a " +
      "detailed report about X' — and the box boots with an empty /workspace. " +
      "Missing info is asked back, not failed. " +
      "INTERACTIVE — this call ships the repo, launches the in-box agent, and blocks until the agent " +
      "either FINISHES or PAUSES to ask a question. Two outcomes:\n" +
      "• 'run:done' → report the result/PR link to the user. Done.\n" +
      "• 'run:waiting — …QUESTION FROM THE SANDBOX…' → the agent needs an answer and is STILL running. " +
      "You MUST NOT end your turn. Answer it from repo/task context if you confidently can; otherwise " +
      "ask the USER using your native question UI (e.g. AskQuestion). Then call " +
      "resume({session, message:<answer>}). Keep answering→resuming until you get run:done. " +
      "NEVER say the delegation was cancelled/declined or that you'll 'report back later' when it is " +
      "waiting — it is actively blocked on your answer.",
    {
      source: z
        .enum(["local", "git"])
        .optional()
        .describe(
          remoteEntry
            ? "git = the sandbox checks out owner/name itself (DEFAULT, and the only option here: " +
                "this sandbox is remote and cannot see your filesystem — use `patch` to bring " +
                "uncommitted work). Do NOT pass local."
            : "local = ship local working tree(s) (default); git = the sandbox checks out owner/name itself."
        ),
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
            patch: z.string().optional().describe("git only: a diff for THIS repo — same rules as the top-level `patch`."),
          })
        )
        .optional()
        .describe(
          "Multiple repos for a cross-repo task (e.g. several folders in a multi-root workspace). " +
            "Each becomes /workspace/<name>; the agent opens a PR per repo it changes."
        ),
      task: z.string().optional().describe("Natural-language task for the in-box agent."),
      ref: z.string().optional().describe("git only: branch/tag/SHA for the single `repo` shorthand."),
      patch: z
        .string()
        .optional()
        .describe(
          "git only. A `git diff` from your machine, carrying work that is NOT pushed yet. Pass it " +
            "ONLY when the task you are delegating actually depends on those uncommitted/unpushed " +
            "changes — e.g. you are half-way through a feature and the sandbox must continue it. If " +
            "the task is independent of your working tree, OMIT it: a clean checkout of `ref` is " +
            "correct and safer. Generate with `git add -A -N && git diff origin/<ref> --binary` " +
            "(--binary so image/asset changes survive; -N so new files are included), and pass the " +
            "same <ref> as `ref` so the patch applies to what the sandbox checks out."
        ),
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
      verify: z
        .object({
          command: z.string().optional().describe("Shell command run in the box after run:done; exit 0 = verified."),
          criterion: z.string().optional().describe("Acceptance criterion judged by the READ-ONLY co-pilot after run:done."),
        })
        .optional()
        .describe(
          "Make 'done' mean PROVEN: after a clean finish, run {command} (its exit code is the " +
            "verdict) or have the read-only co-pilot judge {criterion} against the actual workspace. " +
            "Exactly one key. The result stamps the run as verified/UNVERIFIED — a failed check never " +
            "un-finishes it."
        ),
    },
    async ({
      source,
      repo,
      repos,
      task,
      ref,
      patch,
      allowDomains,
      githubToken,
      githubAccount,
      verify,
    }: {
      source?: DelegateSource;
      repo?: string;
      repos?: Array<{ repo: string; ref?: string; patch?: string }>;
      task?: string;
      ref?: string;
      patch?: string;
      allowDomains?: string[];
      githubToken?: string;
      githubAccount?: string;
      verify?: { command?: string; criterion?: string };
    }) => {
      // Validate the verify clause FIRST — a malformed one must be a question before any box work.
      const vp = verifyPlanOf(verify);
      if (!vp.ok) return text(vp.question);
      // Remote callers have no shared filesystem, so "git" is the only source that can work there.
      const resolvedSource: DelegateSource = source ?? (remoteEntry ? "git" : "local");
      if (remoteEntry && resolvedSource === "local") {
        return text(
          `This sandbox is reached over HTTP, so it cannot see your machine's files — ` +
            `source:"local" would try to copy the path from the sandbox host's own disk. ` +
            `Re-call delegate with source:"git" and repo:"owner/name" (plus ref for a specific ` +
            `branch); the sandbox checks the repo out itself. If the task depends on UNCOMMITTED ` +
            `local changes, also pass patch: run \`git add -A -N && git diff origin/<ref> --binary\` ` +
            `and send that diff — it is applied on top of the fresh checkout. ` +
            `Nothing was started, and the sandbox is up — this is not a connectivity problem.`
        );
      }
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
        patch,
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
      // Verified outcomes: a clean finish runs the verify clause and stamps the result. Only on
      // exit=0 — a failed run needs no second proof of failure — and never on run:waiting.
      let verifyLine = "";
      if (vp.plan && deps.verify && /run:done exit=0/.test(r.output)) {
        verifyLine = `\n\n${formatVerifyResult(await deps.verify(cfg, r.box, vp.plan))}`;
      }
      // r.output already carries the full imperative protocol for a waiting box, or the result when
      // done — don't append a contradicting tail.
      return text(`Delegated. session=${r.box}${r.warm ? " (warm)" : ""}${repoLine}\n\n${r.output}${verifyLine}`);
    }
  );

  server.tool(
    "status",
    "Reconnect to a delegated session and block until it FINISHES or PAUSES to ask — same outcomes as " +
      "delegate. Use it if a delegate/resume call was interrupted. If it returns 'run:waiting' with a " +
      "QUESTION, do NOT end your turn: answer from context or ask the USER via your native question UI " +
      "(AskQuestion), then resume({session, message:<answer>}). Repeat until run:done. Never report a " +
      "waiting session as cancelled or say you'll check back later.",
    { session: z.string().describe("Session id returned by delegate.") },
    async ({ session }: { session: string }) => text(await deps.status(cfg, session, interactFrom(bridge)))
  );

  server.tool(
    "resume",
    "Continue the in-box Claude Code session — primarily to ANSWER a question it asked (run:waiting). " +
      "Put the answer in `message`; the agent reads it and proceeds. BLOCKING: it feeds the answer in " +
      "and WAITS until the agent asks the NEXT question or finishes, then returns that. If it returns " +
      "another 'run:waiting' QUESTION, do NOT end your turn — answer from context or ask the USER via " +
      "your native question UI (AskQuestion), then resume again. Keep going until run:done. It also " +
      "auto-starts the box if it idle-stopped while waiting. Answer from repo/context when you can, and " +
      "only ask the user for real decisions or secrets. If it needs a credential/connection detail " +
      "(GitHub token for a private repo, DB URL), pass it via `secrets` — injected as env for THIS " +
      "step only, never stored, gone on teardown.",
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
      // deps.resume answers run:gone when no box exists for the id — nothing was resumed, so the
      // "Resumed session=…" header would be a claim the tool did something it did not. Observed
      // live on a torn-down box: the header sat directly above "no sandbox exists for session".
      if (out.startsWith("run:gone")) return text(out);
      return text(`Resumed session=${session}\n\n${out}`);
    }
  );

  server.tool(
    "teardown",
    "Stop and remove the box for a delegated session.",
    { session: z.string().describe("Session id returned by delegate.") },
    async ({ session }: { session: string }) => {
      if (!isBoxName(session)) throw new Error("invalid session name");
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
    "ask",
    "Ask a question ABOUT a running delegation without interrupting it. A second, read-only " +
      "co-pilot agent runs inside the same box, reads the workspace and the driver's live log, and " +
      "answers you. The driver agent keeps working, never sees this exchange, and is not paused — " +
      "so use this freely mid-run (\"what has it changed so far?\", \"why is it stuck?\", \"show me " +
      "the diff\", \"is it about to do something dumb?\"). " +
      "Use `watch` for a raw log tail; use `ask` when you want the log INTERPRETED. " +
      "IMPORTANT: this can only LOOK, never steer. To change what the driver does, answer its " +
      "question with resume({session, message}) — nothing said here reaches it. Works while the " +
      "driver is running AND while it is parked on a question.",
    {
      session: z.string().describe("Session id returned by delegate."),
      question: z
        .string()
        .describe("What you want to know about the run, in plain language."),
      newThread: z
        .boolean()
        .optional()
        .describe(
          "Start a fresh co-pilot thread instead of continuing the previous one. Default false — " +
            "follow-ups keep their context, so you can just say 'and the other repo?'."
        ),
    },
    async ({
      session,
      question,
      newThread,
    }: {
      session: string;
      question: string;
      newThread?: boolean;
    }) => text(await deps.ask(cfg, session, question, newThread))
  );

  if (deps.listRepos) {
    const listRepos = deps.listRepos;
    server.tool(
      "list_repos",
      "Repositories the connected GitHub accounts can reach, ranked for an optional query. Use it to " +
        "find the exact owner/name before delegate or attach_repo when the user only names a repo loosely.",
      { query: z.string().optional().describe("Substring of the repo name/owner, e.g. 'deal service'.") },
      async ({ query }: { query?: string }) => text(await listRepos(cfg, query ?? ""))
    );
  }
  if (deps.attachRepo) {
    const attachRepo = deps.attachRepo;
    server.tool(
      "attach_repo",
      "Check out another repository into a RUNNING sandbox at /workspace/<name>, with the GitHub " +
        "account that can access it, and tell the agent at its next turn. Use when a run turns out to " +
        "need a second repo (a shared library, the service it calls) without starting over.",
      {
        session: z.string().describe("Session id returned by delegate."),
        repo: z.string().describe("owner/name"),
        ref: z.string().optional().describe("Branch or tag; default branch when omitted."),
      },
      async ({ session, repo, ref }: { session: string; repo: string; ref?: string }) => text(await attachRepo(cfg, session, repo, ref))
    );
  }

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
