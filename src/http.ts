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
import { refillPool, startPoolMaintainer } from "./pool.js";
import { checkBearer, checkDashboardAuth } from "./http-auth.js";
import { gatherMonitor, gatherWatch, askInBox, driverStateLine } from "./msb.js";
import { runDelegateFlow } from "./delegate-flow.js";
import { streamWatch } from "./watch-sse.js";
import { WatchHub } from "./watch-hub.js";
import { makeFleetReader } from "./fleet.js";
import { Inbox, startInboxDelivery } from "./inbox.js";
import { makeCredentialBroker } from "./broker.js";
import { makeFileIndex } from "./files.js";
import { exec as execInBox } from "./msb.js";
import { loadStore, saveStore, pickDefaultAccount, upsertAccount, removeAccount, setDefaultAccount } from "./gh-token-store.js";
import { probeToken } from "./gh-probe.js";
import { viewAccounts, deviceStart, devicePoll } from "./accounts.js";
import { readArtifact } from "./artifact.js";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

// One shared tail loop per watched box (see watch-hub.ts): every SSE viewer, /watch.json call and
// hover-prefetch of the same box reads one cached snapshot instead of each paying an SSH round trip.
// The tick path skips `msb metrics` — vitals arrive with the fleet poll.
const watchHub = new WatchHub({ read: (s) => gatherWatch(cfg, s, undefined, { metrics: false }) });
// The dashboard's fleet read: gatherMonitor behind a short shared cache, plus lifecycle config and
// sleeping (Stopped-but-resumable) boxes merged from memory.
// Follow-ups typed while the agent is mid-turn wait here and are delivered when the run finishes.
const inbox = new Inbox();
const resumeQuietly = (session: string, message: string) => deps.resume(cfg, session, message, undefined, {});
startInboxDelivery({
  inbox,
  read: (s) => watchHub.read(s),
  resume: resumeQuietly,
  log: (m) => console.error(m),
});
// Credential broker: a box that pauses to ask for GitHub auth is resumed with the stored account.
const brokerConsider = makeCredentialBroker({
  defaultLogin: async () => pickDefaultAccount(await loadStore(cfg))?.login,
  resume: resumeQuietly,
  log: (m) => console.error(m),
});
const readFleet = makeFleetReader(cfg, () => gatherMonitor(cfg), {
  decorate: (boxes) =>
    boxes.map((b) => {
      const q = inbox.list(b.name);
      return q.length ? { ...b, queued: q.map((m) => m.text) } : b;
    }),
});
// `@` mentions: a briefly cached file index per box.
const fileIndex = makeFileIndex(async (box, sh) => (await execInBox(cfg, box, sh)).stdout);

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

// --- the dashboard SPA (React + Tailwind, built by Vite into web/dist) ---------------------------
// Static assets are served WITHOUT the token: they are the app shell (JS/CSS/HTML) and carry no
// secrets, and a browser can't attach an Authorization header to its own <script> fetches. Every
// route that returns real data stays bearer-guarded, which is where the actual protection belongs.
const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_DIST = resolve(HERE, "..", "web", "dist");
const HAS_WEB = existsSync(join(WEB_DIST, "index.html"));

if (HAS_WEB) {
  app.use("/dashboard", express.static(WEB_DIST, { index: false, maxAge: "1h" }));
  // SPA fallback: /dashboard and anything under it that isn't a built asset returns index.html, so
  // a deep link (or a reload on one) still boots the app.
  app.get(/^\/dashboard(?:\/.*)?$/, (_req: Request, res: Response) => {
    res.sendFile(join(WEB_DIST, "index.html"));
  });
  // The public landing page is the same SPA at the site root (its assets are absolute under
  // /dashboard/). It carries no data and no token; the console routes stay bearer-guarded.
  app.get("/", (_req: Request, res: Response) => {
    res.sendFile(join(WEB_DIST, "index.html"));
  });
} else {
  app.get("/dashboard", (_req: Request, res: Response) => {
    res
      .status(503)
      .type("text/plain")
      .send("Dashboard bundle missing: run `npm --prefix web ci && npm --prefix web run build`.");
  });
}

// Fleet snapshot as JSON (what `monitor` renders as text).
app.get("/monitor.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  try {
    res.json(await gatherMonitor(cfg));
  } catch (e) {
    res.status(500).json({ error: String((e as Error).message ?? e) });
  }
});

// The dashboard's fleet read: boxes + lifecycle facts (idle/max timeouts, capacity) + sleeping boxes.
// Cached ~1.5s server-side so N tabs cost one SSH sweep.
app.get("/fleet.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  try {
    const fleet = await readFleet();
    // Let the broker look at every waiting box (fire-and-forget; guarded once per question).
    for (const b of fleet.boxes) {
      if (b.runState === "waiting" && /^running$/i.test(b.boxStatus)) void brokerConsider(b.name, b.question);
    }
    res.json(fleet);
  } catch (e) {
    res.status(500).json({ error: String((e as Error).message ?? e) });
  }
});

// One box's live snapshot (what `watch` renders); ?session=… required, optional ?lines=.
// Served through the hub: a box someone is (or was just) watching answers from cache instantly.
// An explicit ?lines= bypasses the hub (different truncation → different snapshot).
app.get("/watch.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const session = typeof req.query.session === "string" ? req.query.session : "";
  if (!session) {
    res.status(400).json({ error: "session query param required" });
    return;
  }
  const lines = Number(req.query.lines);
  try {
    res.json(
      Number.isFinite(lines) && lines > 0 ? await gatherWatch(cfg, session, lines) : await watchHub.read(session)
    );
  } catch (e) {
    res.status(500).json({ error: String((e as Error).message ?? e) });
  }
});

// Live stream of one box's log over SSE. The browser opens an EventSource (which can't set headers),
// so auth rides on ?token= exactly like /dashboard. The controller fast-tails the log server-side and
// pushes only deltas; the old /watch.json poll stays as the fallback for clients/proxies without SSE.
app.get("/watch.sse", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const session = typeof req.query.session === "string" ? req.query.session : "";
  if (!session) {
    res.status(400).json({ error: "session query param required" });
    return;
  }
  // Resume offset: prefer the SSE-standard Last-Event-ID (set automatically by EventSource on
  // reconnect), fall back to an explicit ?from=. Either lets a reconnect skip re-sending the log.
  const lastEventId = Number(req.headers["last-event-id"]);
  const fromQuery = Number(req.query.from);
  const from = Number.isFinite(lastEventId) && lastEventId > 0
    ? lastEventId
    : Number.isFinite(fromQuery) && fromQuery > 0
      ? fromQuery
      : 0;

  const stop = streamWatch(res, {
    session,
    from,
    read: (s) => watchHub.read(s),
  });
  // Stop the server-side tail the instant the browser goes away (tab closed, navigated, network drop)
  // so a disconnected viewer never keeps hitting SSH for a box no one is watching.
  req.on("close", stop);
});

// Download / preview a file the agent produced inside a box's /workspace. Same dashAuthed guard as
// the other data routes (Bearer OR ?token= so a browser download link works). Path handling is
// hostile-input hardened in artifact.ts: pure-layer rejects, then an on-box realpath + regular-file +
// size check before any bytes are read. Never serves text/html; unknown types force a download.
app.get("/artifact", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const session = typeof req.query.session === "string" ? req.query.session : "";
  const path = typeof req.query.path === "string" ? req.query.path : "";
  if (!session) {
    res.status(400).json({ error: "session query param required" });
    return;
  }
  if (!path) {
    res.status(400).json({ error: "path query param required" });
    return;
  }
  try {
    const result = await readArtifact(cfg, session, path);
    if ("error" in result) {
      // Map the confinement/read errors to sensible statuses. A bad path is a 400 (client error),
      // a missing file / torn-down box is 404, an oversize file is 413.
      const status =
        result.error === "bad-path"
          ? 400
          : result.error === "not-found"
            ? 404
            : result.error === "not-file"
              ? 400
              : result.error === "too-large"
                ? 413
                : 502;
      res.status(status).json({ error: result.message });
      return;
    }
    const name = result.relPath.split("/").pop() || "file";
    // nosniff so the browser honours our Content-Type instead of sniffing an html/exec type. Inline
    // only for known text-ish types; everything else downloads. The filename is quote-escaped.
    res.setHeader("Content-Type", result.contentType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    const disposition = result.inlineSafe ? "inline" : "attachment";
    res.setHeader("Content-Disposition", `${disposition}; filename="${name.replace(/["\\]/g, "_")}"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(result.data);
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
  const { session, message, force } = (req.body ?? {}) as { session?: string; message?: string; force?: boolean };
  if (!session || !message?.trim()) {
    res.status(400).json({ error: "session and message are required" });
    return;
  }
  try {
    // Mid-turn: a second `claude -c` would race the running one, so the message waits in the inbox
    // and is delivered the moment the run finishes. `force` (answering a question) bypasses.
    if (!force) {
      const snap = await watchHub.read(session);
      if (snap.runState === "running") {
        const q = inbox.enqueue(session, message);
        res.json({ queued: true, id: q.id });
        return;
      }
    }
    res.json({ output: await deps.resume(cfg, session, message, undefined, {}) });
  } catch (e) {
    res.status(500).json({ error: String((e as Error).message ?? e) });
  }
});

// Stop and remove a box. Destructive; the dashboard confirms before calling this.
// GitHub accounts — the login-keyed token store, tokens masked. Add by PAT or via device flow.
app.get("/accounts.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  try {
    const store = await loadStore(cfg);
    res.json({
      accounts: viewAccounts(store, pickDefaultAccount(store)?.login),
      oauth: !!cfg.githubOauthClientId,
    });
  } catch (e) {
    res.status(500).json({ error: String((e as Error).message ?? e) });
  }
});
app.post("/accounts.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const { token } = (req.body ?? {}) as { token?: string };
  if (!token?.trim()) {
    res.status(400).json({ error: "token is required" });
    return;
  }
  try {
    const acc = await probeToken(cfg, token.trim(), "");
    if (!acc) {
      res.status(422).json({ error: "GitHub rejected this token (invalid or expired)." });
      return;
    }
    const store = upsertAccount(await loadStore(cfg), acc);
    await saveStore(cfg, store);
    res.json({ accounts: viewAccounts(store, pickDefaultAccount(store)?.login), added: acc.login });
  } catch (e) {
    res.status(500).json({ error: String((e as Error).message ?? e) });
  }
});
app.delete("/accounts.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const login = typeof req.query.login === "string" ? req.query.login : "";
  if (!login) {
    res.status(400).json({ error: "login query param required" });
    return;
  }
  try {
    const store = removeAccount(await loadStore(cfg), login);
    await saveStore(cfg, store);
    res.json({ accounts: viewAccounts(store, pickDefaultAccount(store)?.login) });
  } catch (e) {
    res.status(500).json({ error: String((e as Error).message ?? e) });
  }
});
app.post("/accounts/default.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const { login } = (req.body ?? {}) as { login?: string };
  if (!login) {
    res.status(400).json({ error: "login is required" });
    return;
  }
  try {
    const store = setDefaultAccount(await loadStore(cfg), login);
    await saveStore(cfg, store);
    res.json({ accounts: viewAccounts(store, pickDefaultAccount(store)?.login) });
  } catch (e) {
    res.status(500).json({ error: String((e as Error).message ?? e) });
  }
});
// Sign in with GitHub (device flow). start → {user_code, verification_uri}; poll until a token
// arrives, then it is probed and stored like a pasted PAT. Only when GITHUB_OAUTH_CLIENT_ID is set.
app.post("/accounts/device.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  if (!cfg.githubOauthClientId) {
    res.status(404).json({ error: "GitHub sign-in is not configured (GITHUB_OAUTH_CLIENT_ID)." });
    return;
  }
  try {
    res.json(await deviceStart(cfg.githubOauthClientId));
  } catch (e) {
    res.status(502).json({ error: String((e as Error).message ?? e) });
  }
});
app.post("/accounts/device/poll.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const { device_code } = (req.body ?? {}) as { device_code?: string };
  if (!cfg.githubOauthClientId || !device_code) {
    res.status(400).json({ error: "device_code is required" });
    return;
  }
  try {
    const r = await devicePoll(cfg.githubOauthClientId, device_code);
    if (r.status !== "token") {
      res.json(r);
      return;
    }
    const acc = await probeToken(cfg, r.token, "");
    if (!acc) {
      res.json({ status: "error", message: "GitHub issued a token the API rejected." });
      return;
    }
    const store = upsertAccount(await loadStore(cfg), acc);
    await saveStore(cfg, store);
    res.json({ status: "done", login: acc.login, accounts: viewAccounts(store, pickDefaultAccount(store)?.login) });
  } catch (e) {
    res.status(502).json({ error: String((e as Error).message ?? e) });
  }
});

// Queued follow-ups for a box: list, or remove one (`?id=`) / all.
app.get("/inbox.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const session = typeof req.query.session === "string" ? req.query.session : "";
  if (!session) {
    res.status(400).json({ error: "session query param required" });
    return;
  }
  res.json({ queued: inbox.list(session) });
});
app.delete("/inbox.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const session = typeof req.query.session === "string" ? req.query.session : "";
  const id = typeof req.query.id === "string" ? req.query.id : "";
  if (!session) {
    res.status(400).json({ error: "session query param required" });
    return;
  }
  if (id) inbox.remove(session, id);
  else inbox.clear(session);
  res.json({ queued: inbox.list(session) });
});

// Workspace files for `@` mentions: ?session=&q=; at most 40 ranked matches.
app.get("/files.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const session = typeof req.query.session === "string" ? req.query.session : "";
  const q = typeof req.query.q === "string" ? req.query.q : "";
  if (!session) {
    res.status(400).json({ error: "session query param required" });
    return;
  }
  try {
    res.json(await fileIndex(session, q));
  } catch (e) {
    res.status(500).json({ error: String((e as Error).message ?? e) });
  }
});

app.post("/teardown.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const { session } = (req.body ?? {}) as { session?: string };
  if (!session) {
    res.status(400).json({ error: "session is required" });
    return;
  }
  try {
    await deps.teardown(cfg, session);
    watchHub.drop(session);
    inbox.clear(session);
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
  // Keep it topped up so a warm box is ALWAYS ready, even through a long lull with no delegations
  // (an unclaimed box idle/max-duration reaped can't trigger its own claim-based reseed).
  startPoolMaintainer(cfg);
});
