/**
 * Build the ServerBridge that connects the transport-agnostic handlers to a concrete MCP server for
 * interactive features (native Elicitation + progress). Shared by the stdio and HTTP entries.
 *
 * - canElicit: reflects the client's advertised `elicitation.form` capability (Cursor advertises it).
 * - elicit: sends an `elicitation/create` (form mode) with a single free-text `answer` field, and
 *   maps the ElicitResult back to our ElicitOutcome (accept+answer / decline / cancel).
 * - progress: a keep-alive logging notification during long, question-less waits (best-effort).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerBridge } from "./handlers.js";
import type { ElicitOutcome } from "./interactive.js";

/** The single-field form schema we elicit: a free-text answer to the box's question. */
const ANSWER_SCHEMA = {
  type: "object" as const,
  properties: {
    answer: {
      type: "string" as const,
      title: "Answer",
      description: "Your answer to the sandbox agent's question.",
    },
  },
  required: ["answer"],
};

export function makeBridge(server: McpServer): ServerBridge {
  const core = server.server;
  return {
    canElicit() {
      return !!core.getClientCapabilities()?.elicitation?.form;
    },
    async elicit(question: string): Promise<ElicitOutcome> {
      const res = await core.elicitInput({
        mode: "form",
        message: question,
        requestedSchema: ANSWER_SCHEMA,
      });
      if (res.action === "accept") {
        const answer = typeof res.content?.answer === "string" ? res.content.answer : "";
        return { action: "accept", answer };
      }
      return { action: res.action === "decline" ? "decline" : "cancel" };
    },
    async progress(message: string): Promise<void> {
      try {
        await core.sendLoggingMessage({ level: "info", data: message });
      } catch {
        // best-effort keep-alive; ignore if the client didn't enable logging.
      }
    },
  };
}
