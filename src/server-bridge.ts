/**
 * Build the ServerBridge that connects the transport-agnostic handlers to a concrete MCP server for
 * interactive features (native Elicitation + progress). Shared by the stdio and HTTP entries.
 *
 * - canElicit: reflects the client's advertised `elicitation.form` capability (Cursor advertises it).
 * - elicit: sends an `elicitation/create` (form mode) with a single free-text `answer` field, and
 *   maps the ElicitResult back to our ElicitOutcome (accept+answer / decline / cancel).
 * - progress: a keep-alive logging notification during long, question-less waits (best-effort).
 */
import { ElicitResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerBridge } from "./handlers.js";
import type { ElicitOutcome } from "./interactive.js";

/**
 * The single-field form schema we elicit: a free-text answer to the box's question. Each property
 * carries a `title` (the shape Cursor's v1.5 form-style elicitation renders) and stays flat with a
 * primitive `string` type (Cursor supports only string/number/boolean/enum, no nesting).
 */
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
      const can = !!core.getClientCapabilities()?.elicitation?.form;
      console.error(`[elicit] canElicit=${can}`);
      return can;
    },
    async elicit(question: string): Promise<ElicitOutcome> {
      console.error(`[elicit] sending elicitation/create: ${question.slice(0, 80)}`);
      try {
        // Send the raw elicitation/create WITHOUT the newer `mode` field. Cursor's v1.5 form-style
        // elicitation predates the 2025-11-25 `mode`/`form`/`url` capability shape; sending `mode`
        // makes it treat the call as unsupported and decline instantly with no card. The spec says a
        // missing mode MUST be treated as "form", so this is the most compatible request.
        const res = await core.request(
          {
            method: "elicitation/create",
            params: { message: question, requestedSchema: ANSWER_SCHEMA },
          },
          ElicitResultSchema,
          // Human-in-the-loop: hold the request open for a real answer instead of the SDK's short
          // default request timeout (which would otherwise reject the card as "timed out").
          { timeout: 3_600_000, resetTimeoutOnProgress: true }
        );
        console.error(`[elicit] result action=${res.action}`);
        if (res.action === "accept") {
          const answer = typeof (res.content as any)?.answer === "string" ? (res.content as any).answer : "";
          return { action: "accept", answer };
        }
        return { action: res.action === "decline" ? "decline" : "cancel" };
      } catch (e) {
        console.error(`[elicit] THREW: ${e instanceof Error ? e.message : String(e)}`);
        throw e;
      }
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
