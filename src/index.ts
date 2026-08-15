/**
 * agent-sandbox MCP orchestrator.
 *
 * Runs as a remote MCP server that Cursor connects to. In chat you say
 * "delegate this to agent sandbox" and Cursor calls the `delegate` tool. This server is the
 * single entry point: it syncs your local working tree to the VPS, then drives `msb`
 * (microsandbox) to boot a microVM with the repo baked in and run Claude Code on the task.
 *
 * Tools:
 *   delegate(repo, task) -> session id + initial result
 *   status(session)      -> box state + recent agent log
 *   resume(session, msg) -> continue the in-box Claude Code session with a follow-up
 *   teardown(session)    -> stop + remove the box
 *
 * Command shapes are the ones verified in docs/runbook.md (Phase 1).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadDotEnv } from "./dotenv.js";
import { loadConfig } from "./config.js";
import { syncTreeToVps, stagingPathFor, cleanupStaging } from "./sync.js";
import {
  runAgentTask,
  resumeAgentTask,
  exec,
  countBoxes,
  status as msbStatus,
  teardown as msbTeardown,
} from "./msb.js";
import { acquireBox, refillPool, poolEligible } from "./pool.js";
import { newSessionId } from "./session.js";

// Load .env next to the project (dist/../.env) so config lives in one gitignored place.
// Vars already set in the environment (e.g. by the MCP launch config) take precedence.
loadDotEnv();

const cfg = loadConfig();

const server = new McpServer({
  name: "agent-sandbox",
  version: "0.1.0",
});

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

server.tool(
  "delegate",
  "Ship the local repo (incl. uncommitted changes) into a fresh microsandbox microVM and run Claude Code on a task. Returns a session id.",
  {
    repo: z.string().describe("Absolute path to the local repo (working tree) to delegate."),
    task: z.string().describe("Natural-language task for the in-box agent."),
    allowDomains: z
      .array(z.string())
      .optional()
      .describe("Extra domains the box may reach (added to the curated egress allowlist)."),
  },
  async ({ repo, task, allowDomains }) => {
    // Concurrency cap: don't let boxes pile up and starve the host.
    const live = await countBoxes(cfg);
    if (live >= cfg.maxBoxes) {
      return text(
        `Refused: ${live}/${cfg.maxBoxes} boxes already running. Tear one down first (teardown) or raise MSB_MAX_BOXES.`
      );
    }

    // Merge any per-call egress extras onto the curated allowlist for this delegation only.
    const runCfg = allowDomains?.length
      ? { ...cfg, egressDomains: Array.from(new Set([...cfg.egressDomains, ...allowDomains])) }
      : cfg;

    // A restricted-egress delegation must NOT reuse an open-egress pooled box.
    const eligible = poolEligible(runCfg, !!allowDomains?.length);

    // The session id doubles as the box name; staging path is derived from it (the sync uses the
    // session id, so warm-box reuse still stages under a per-session path). No shared in-memory
    // state — status/resume/teardown work even if the MCP process is respawned between calls.
    const id = newSessionId();
    // 1. Push the local working tree (incl. uncommitted changes) to a staging dir on the VPS.
    const staging = await syncTreeToVps(runCfg, repo, id);
    // 2. Claim a warm box if eligible+available (skips ~4s boot + bootstrap), else cold-boot.
    const { box, warm } = await acquireBox(runCfg, id, staging, eligible);
    // Staging is transient (already copied into the box). Clean it now so teardown doesn't need
    // to know the id (warm box name != staging key). Best-effort.
    void cleanupStaging(runCfg, staging);
    // 3. Refill the pool on claim so the next delegation is also instant (fire-and-forget).
    if (warm) void refillPool(cfg);
    // 4. Run the task. A warm box is already bootstrapped; runAgentTask's bootstrap is idempotent.
    const result = await runAgentTask(runCfg, box, task);

    return text(
      `Delegated. session=${box}${warm ? " (warm)" : ""}\n\n--- agent output ---\n${result.stdout.trim() || result.stderr.trim()}`
    );
  }
);

server.tool(
  "status",
  "Get the current box state and recent agent log for a delegated session.",
  { session: z.string().describe("Session id returned by delegate.") },
  async ({ session }) => {
    const state = await msbStatus(cfg, session);
    const log = await exec(cfg, session, "tail -n 40 /workspace/.agent.log 2>/dev/null || true");
    return text(`state:\n${state}\n\nrecent log:\n${log.stdout.trim()}`);
  }
);

server.tool(
  "resume",
  "Send a follow-up / continue the in-box Claude Code session.",
  {
    session: z.string().describe("Session id returned by delegate."),
    message: z.string().describe("Follow-up instruction or answer for the agent."),
  },
  async ({ session, message }) => {
    const result = await resumeAgentTask(cfg, session, message);
    return text(
      `Resumed session=${session}\n\n--- agent output ---\n${result.stdout.trim() || result.stderr.trim()}`
    );
  }
);

server.tool(
  "teardown",
  "Stop and remove the box for a delegated session.",
  { session: z.string().describe("Session id returned by delegate.") },
  async ({ session }) => {
    await msbTeardown(cfg, session, stagingPathFor(cfg, session));
    return text(`Torn down session=${session} (box removed).`);
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
// Startup marker on stderr (stdout is reserved for the JSON-RPC stream).
console.error("[agent-sandbox] MCP server ready");
