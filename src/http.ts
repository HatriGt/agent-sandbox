/**
 * agent-sandbox MCP orchestrator — HTTP entry (remote clients: Claude web / phone / CI).
 *
 * Serves MCP over Streamable HTTP at POST/GET/DELETE /mcp, guarded by a bearer token. Registers
 * the SAME tools as the stdio entry (handlers.ts + deps.ts). Binds 127.0.0.1 only — TLS + public
 * hostname are terminated by Traefik in front (see docs/remote-mcp-plan.md, Phase 1, step 5).
 *
 * Each MCP session gets its own transport+server (SDK pattern); the session id lives in the
 * `mcp-session-id` header so multiple clients don't cross wires.
 */
import express, { type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadDotEnv } from "./dotenv.js";
import { loadConfig } from "./config.js";
import { registerTools } from "./handlers.js";
import { deps } from "./deps.js";
import { refillPool } from "./pool.js";
import { checkBearer } from "./http-auth.js";

loadDotEnv();
const cfg = loadConfig();

if (!cfg.httpToken) {
  console.error(
    "[agent-sandbox] REFUSING to start HTTP entry: MCP_HTTP_TOKEN is not set (would be an open, VM-spawning endpoint)."
  );
  process.exit(1);
}

const app = express();
app.use(express.json());

// Bearer guard on every /mcp method. Fails closed (checkBearer denies when no token).
app.use("/mcp", (req: Request, res: Response, next) => {
  if (!checkBearer(req.headers.authorization, cfg.httpToken)) {
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "unauthorized" },
      id: null,
    });
    return;
  }
  next();
});

// Per-session Streamable HTTP transports, keyed by the mcp-session-id header.
const transports: Record<string, StreamableHTTPServerTransport> = {};

async function handle(req: Request, res: Response) {
  const sid = req.headers["mcp-session-id"] as string | undefined;
  let transport = sid ? transports[sid] : undefined;

  if (!transport) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id: string) => {
        transports[id] = transport!;
      },
    });
    transport.onclose = () => {
      if (transport!.sessionId) delete transports[transport!.sessionId];
    };
    const server = new McpServer({ name: "agent-sandbox", version: "0.1.0" });
    registerTools(server as unknown as Parameters<typeof registerTools>[0], cfg, deps);
    await server.connect(transport);
  }

  await transport.handleRequest(req, res, req.body);
}

app.post("/mcp", handle);
app.get("/mcp", handle);
app.delete("/mcp", handle);

app.listen(cfg.httpPort, cfg.httpHost, () => {
  console.error(`[agent-sandbox] HTTP MCP on ${cfg.httpHost}:${cfg.httpPort} (bearer-guarded)`);
  // Auto-seed the shared warm pool so the first remote delegation is fast too.
  void refillPool(cfg);
});
