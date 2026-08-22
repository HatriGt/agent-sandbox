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
import { makeBridge } from "./server-bridge.js";
import { deps } from "./deps.js";
import { refillPool } from "./pool.js";
import { checkBearer, checkDashboardAuth } from "./http-auth.js";
import { gatherMonitor, gatherWatch, askInBox, driverStateLine } from "./msb.js";
import { runDelegateFlow } from "./delegate-flow.js";
import { dashboardHtml } from "./dashboard-html.js";

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
    registerTools(
      server as unknown as Parameters<typeof registerTools>[0],
      cfg,
      deps,
      makeBridge(server)
    );
    // Log what the client advertises on connect — decisive for whether we can use native
    // Elicitation (server→client questions mid tool-call) vs. the poll-based fallback.
    server.server.oninitialized = () => {
      const caps = server.server.getClientCapabilities();
      const info = server.server.getClientVersion();
      console.error(
        `[mcp] client connected: ${info?.name ?? "?"}@${info?.version ?? "?"} ` +
          `capabilities=${JSON.stringify(caps ?? {})}`
      );
    };
    await server.connect(transport);
  }

  await transport.handleRequest(req, res, req.body);
}

app.post("/mcp", handle);
app.get("/mcp", handle);
app.delete("/mcp", handle);

// --- Monitoring dashboard (token-protected; poll-based) ---------------------------------------
// Auth accepts the token via Bearer header (the page's fetch calls) OR a ?token= query param (so the
// page can be opened directly in a browser, which can't set headers on a navigation). Same secret.
function dashAuthed(req: Request, res: Response): boolean {
  if (checkDashboardAuth(req.headers.authorization, req.query.token, cfg.httpToken)) return true;
  res.status(401).json({ error: "unauthorized" });
  return false;
}

// The page itself (static HTML; it reads ?token= and polls the JSON endpoints below).
app.get("/dashboard", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  res.type("html").send(dashboardHtml());
});

// Fleet snapshot as JSON (what `monitor` renders as text).
app.get("/monitor.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  try {
    res.json(await gatherMonitor(cfg));
  } catch (e) {
    res.status(500).json({ error: String((e as Error).message ?? e) });
  }
});

// One box's live snapshot (what `watch` renders); ?session=… required, optional ?lines=.
app.get("/watch.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const session = typeof req.query.session === "string" ? req.query.session : "";
  if (!session) {
    res.status(400).json({ error: "session query param required" });
    return;
  }
  const lines = Number(req.query.lines);
  try {
    res.json(await gatherWatch(cfg, session, Number.isFinite(lines) && lines > 0 ? lines : undefined));
  } catch (e) {
    res.status(500).json({ error: String((e as Error).message ?? e) });
  }
});

// Ask the box's READ-ONLY co-pilot a question (what `ask` does over MCP). POST so the question isn't
// logged in a URL. Deliberately NOT wired to resume/status: this must never touch the driver lane.
// One turn is capped in-box by ASK_TIMEOUT_MS, so this request is bounded too.
app.post("/ask.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const { session, question, newThread } = (req.body ?? {}) as {
    session?: string;
    question?: string;
    newThread?: boolean;
  };
  if (!session || !question?.trim()) {
    res.status(400).json({ error: "session and question are required" });
    return;
  }
  try {
    const [result, driverState] = await Promise.all([
      askInBox(cfg, session, question, { newThread: !!newThread }),
      driverStateLine(cfg, session),
    ]);
    res.json({ ...result, driverState });
  } catch (e) {
    res.status(500).json({ error: String((e as Error).message ?? e) });
  }
});

// Answer a WAITING box's question (the only way to steer the driver). Blocks server-side up to
// WAIT_TIMEOUT_MS driving the same interactive loop resume() uses over MCP.
app.post("/resume.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const { session, message } = (req.body ?? {}) as { session?: string; message?: string };
  if (!session || !message?.trim()) {
    res.status(400).json({ error: "session and message are required" });
    return;
  }
  try {
    res.json({ output: await deps.resume(cfg, session, message, undefined, {}) });
  } catch (e) {
    res.status(500).json({ error: String((e as Error).message ?? e) });
  }
});

// Stop and remove a box. Destructive; the dashboard confirms before calling this.
app.post("/teardown.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const { session } = (req.body ?? {}) as { session?: string };
  if (!session) {
    res.status(400).json({ error: "session is required" });
    return;
  }
  try {
    await deps.teardown(cfg, session);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String((e as Error).message ?? e) });
  }
});

// Start a new delegation from the dashboard composer. Same validate -> resolve -> run flow as the
// MCP `delegate` tool (see delegate-flow.ts); source defaults to "git" here since a browser has no
// local working tree to ship.
app.post("/delegate.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body.task !== "string" || !body.task.trim()) {
    res.status(400).json({ error: "task is required" });
    return;
  }
  try {
    const result = await runDelegateFlow(cfg, deps, {
      source: body.source === "local" ? "local" : "git",
      repo: typeof body.repo === "string" ? body.repo : undefined,
      task: body.task,
      ref: typeof body.ref === "string" ? body.ref : undefined,
      githubToken: typeof body.githubToken === "string" ? body.githubToken : undefined,
      githubAccount: typeof body.githubAccount === "string" ? body.githubAccount : undefined,
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String((e as Error).message ?? e) });
  }
});

app.listen(cfg.httpPort, cfg.httpHost, () => {
  console.error(`[agent-sandbox] HTTP MCP on ${cfg.httpHost}:${cfg.httpPort} (bearer-guarded)`);
  // Auto-seed the shared warm pool so the first remote delegation is fast too.
  void refillPool(cfg);
});
