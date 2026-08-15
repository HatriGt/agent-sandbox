/**
 * agent-sandbox MCP orchestrator (skeleton).
 *
 * Runs on the VPS as a remote MCP server. Cursor connects to it; it drives `msb`
 * (microsandbox) locally on the box to delegate a task into an isolated microVM.
 *
 * Tools (skeleton — wired to delegate.sh in Phase 3, see docs/plan.md):
 *   delegate(repo, task) -> session id
 *   status(session)      -> state + recent logs
 *   resume(session, msg) -> answer a follow-up / continue in the running box
 *   teardown(session)    -> stop + remove the box
 *
 * This file intentionally does not shell out yet; it defines the tool surface and
 * validates inputs so the contract is stable before we implement the msb plumbing.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "agent-sandbox",
  version: "0.1.0",
});

server.tool(
  "delegate",
  "Ship a repo into a fresh microsandbox microVM and run Claude Code on a task.",
  {
    repo: z.string().describe("Absolute path to the repo on the VPS (or a ref the host can resolve)."),
    task: z.string().describe("Natural-language task for the in-box agent."),
    idleTimeout: z.string().default("10m").describe("Auto-stop after this idle period."),
    maxDuration: z.string().default("1h").describe("Hard cap on box lifetime."),
  },
  async ({ repo, task }) => {
    // Phase 3: spawn scripts/delegate.sh, capture the box name, return a session id.
    return {
      content: [
        {
          type: "text",
          text: `SKELETON: would delegate task to a new box.\nrepo=${repo}\ntask=${task}`,
        },
      ],
    };
  }
);

server.tool(
  "status",
  "Get the current state and recent logs for a delegated session.",
  { session: z.string().describe("Session/box id returned by delegate.") },
  async ({ session }) => {
    // Phase 3: `msb status <session>` + tail captured logs.
    return { content: [{ type: "text", text: `SKELETON: status for ${session}` }] };
  }
);

server.tool(
  "resume",
  "Send a follow-up message / continue the task in a running box.",
  {
    session: z.string(),
    message: z.string().describe("Follow-up instruction or answer for the agent."),
  },
  async ({ session, message }) => {
    // Phase 3: `msb exec <session> -- claude -c -p "<message>"` (continue session).
    return { content: [{ type: "text", text: `SKELETON: resume ${session}: ${message}` }] };
  }
);

server.tool(
  "teardown",
  "Stop and remove a delegated box.",
  { session: z.string() },
  async ({ session }) => {
    // Phase 3: `msb stop <session> && msb rm <session>`.
    return { content: [{ type: "text", text: `SKELETON: teardown ${session}` }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
