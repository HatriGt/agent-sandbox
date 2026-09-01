/**
 * Session-id validity for the remote (Streamable HTTP) MCP entry.
 *
 * Lives apart from http.ts so it can be tested without importing that module, which binds a port
 * on import.
 */
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

/**
 * Whether a request carries a session id that no longer exists and must be rejected with 404.
 *
 * A session id we don't know is a session that DIED — the transport map is in-memory, so every
 * deploy or restart drops all of them while clients keep their id. The spec answer is 404, which
 * tells the client to discard the id and re-initialize. We used to fall through and build a fresh
 * transport instead; a fresh transport is `_initialized === false`, so it rejected the client's
 * tools/call with "400 Bad Request: Server not initialized" — an error no client treats as
 * "re-handshake". Cursor sat there until its own timer gave up and reported the sandbox as
 * unreachable.
 *
 * The exception is an `initialize` that still carries the dead id: that IS the client
 * re-handshaking, so it is let through to a fresh transport rather than 404-ing the very request
 * that would recover.
 */
export function isDeadSession(sid: string | undefined, known: boolean, body: unknown): boolean {
  return Boolean(sid) && !known && !isInitializeRequest(body);
}
