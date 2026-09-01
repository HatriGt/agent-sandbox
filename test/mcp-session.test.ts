/**
 * Dead MCP sessions must get a 404, not a 400.
 *
 * The transport map is in-memory, so every deploy drops all sessions while clients keep their id.
 * On an unknown id we used to build a fresh, uninitialized transport, which answered the client's
 * tools/call with "400 Bad Request: Server not initialized" — an error no client reads as "your
 * session died, re-handshake". Cursor waited for its own timer and reported the sandbox as
 * unreachable, on a server that was up and answering in 200ms.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isDeadSession } from "../src/mcp-session.ts";

const toolsCall = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "pool_status" } };
const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "cursor", version: "1" } },
};

test("an unknown session id on a normal request is dead -> 404", () => {
  // The regression: this was false, so the request fell through to a fresh transport and got a 400.
  assert.equal(isDeadSession("id-from-before-the-deploy", false, toolsCall), true);
  assert.equal(isDeadSession("id-from-before-the-deploy", false, { jsonrpc: "2.0", id: 2, method: "tools/list" }), true);
});

test("an initialize still carrying the dead id is let through, not 404'd", () => {
  // 404-ing this would reject the one request that recovers the client.
  assert.equal(isDeadSession("id-from-before-the-deploy", false, initialize), false);
});

test("a live session is never dead", () => {
  assert.equal(isDeadSession("live-id", true, toolsCall), false);
  assert.equal(isDeadSession("live-id", true, initialize), false);
});

test("a first contact with no session id at all is not dead", () => {
  // A brand-new client sends initialize with no id; it must reach a fresh transport.
  assert.equal(isDeadSession(undefined, false, initialize), false);
  assert.equal(isDeadSession("", false, initialize), false);
});
