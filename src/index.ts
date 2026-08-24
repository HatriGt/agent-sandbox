/**
 * agent-sandbox MCP orchestrator — stdio entry (Cursor on the Mac).
 *
 * Cursor spawns this over stdio. It registers the shared tools (handlers.ts) backed by the real
 * side-effecting deps (deps.ts), then serves. The HTTP entry (http.ts) registers the SAME tools
 * for remote clients. In chat you say "delegate this to agent sandbox" and Cursor calls delegate.
 *
 * Tools: delegate / status / resume / teardown / pool_status (see handlers.ts).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadDotEnv } from "./dotenv.js";
import { loadConfig } from "./config.js";
import { registerTools } from "./handlers.js";
import { makeBridge } from "./server-bridge.js";
import { deps } from "./deps.js";
import { refillPool, startPoolMaintainer } from "./pool.js";

// Load .env next to the project (dist/../.env) so config lives in one gitignored place.
// Vars already set in the environment (e.g. by the MCP launch config) take precedence.
loadDotEnv();

const cfg = loadConfig();

const server = new McpServer({ name: "agent-sandbox", version: "0.1.0" });
registerTools(server as unknown as Parameters<typeof registerTools>[0], cfg, deps, makeBridge(server));

const transport = new StdioServerTransport();
await server.connect(transport);
// Startup marker on stderr (stdout is reserved for the JSON-RPC stream).
console.error("[agent-sandbox] MCP server ready (stdio)");
// Auto-seed the warm pool on start so the first delegation is already fast. Fire-and-forget.
void refillPool(cfg);
// Keep it topped up: a claim-only reseed can't cover an idle-drained or max-duration-reaped pool.
startPoolMaintainer(cfg);
