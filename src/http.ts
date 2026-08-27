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
import compression from "compression";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadDotEnv } from "./dotenv.js";
import { loadConfig } from "./config.js";
import { registerTools } from "./handlers.js";
import { makeBridge } from "./server-bridge.js";
import { deps } from "./deps.js";
import { refillPool, startPoolMaintainer } from "./pool.js";
import { checkBearer } from "./http-auth.js";
import { securityHeaders } from "./security-headers.js";
import { gatherMonitor, gatherWatch, askInBox, driverStateLine, startBoxIfStopped, noteRunning } from "./msb.js";
import { safeWorkspacePath } from "./artifact.js";
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
import { makeRepoLister, fetchGithubRepos, matchRepos, inferRepos, attachRepoToBox } from "./repos.js";
import { loadMcpStore, saveMcpStore, normalizeServer, parseMcpImport, viewServers, toEditableConfig, replaceFromJson, mergeSecrets, type McpServer as McpServerDef } from "./mcp-store.js";
import { listClaims, listKept, markKept, unmarkKept } from "./claims.js";
import { makeRedactor } from "./redact.js";
import { isSecretKey } from "./mcp-store.js";
import type { WatchSnapshot } from "./monitor.js";
import { listChanges, readDiff, fetchPull, forgetPull } from "./changes.js";
import { loadRunMetas, saveRunMeta, forgetRunMeta } from "./run-memory.js";
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

// Security headers on EVERY response (static shell, JSON, SSE, artifact bytes) — registered first so
// nothing, not even an error page, escapes them. The CSP profile is chosen per path; see
// security-headers.ts for why the console needs a strict script-src in particular.
app.use((req: Request, res: Response, next) => {
  for (const [k, v] of Object.entries(securityHeaders(req.path))) res.setHeader(k, v);
  next();
});

// gzip/brotli for JSON and the SPA — but never for the streams (SSE and the MCP transport), which
// must flush every event as it happens.
app.use(
  compression({
    filter: (req, res) => (req.path.endsWith(".sse") || req.path === "/mcp" || req.path.startsWith("/mcp/") ? false : compression.filter(req, res)),
  })
);
app.use(express.json({ limit: "4mb" }));

// One shared tail loop per watched box (see watch-hub.ts): every SSE viewer, /watch.json call and
// hover-prefetch of the same box reads one cached snapshot instead of each paying an SSH round trip.
// The tick path skips `msb metrics` — vitals arrive with the fleet poll.
// Everything the dashboard shows from inside a box passes through here: the exact secrets the
// controller holds (GitHub tokens, MCP secrets, npm/bearer) are replaced wherever they appear, and
// anything shaped like a credential is masked too. See redact.ts.
const redactor = makeRedactor(async () => {
  const out: string[] = [];
  try {
    for (const a of Object.values((await loadStore(cfg)).accounts)) out.push(a.token);
  } catch {
    /* store unreachable: shapes still apply */
  }
  try {
    for (const s of Object.values((await loadMcpStore(cfg)).servers)) {
      for (const m of [s.env, s.headers]) for (const [k, v] of Object.entries(m ?? {})) if (isSecretKey(k)) out.push(v);
    }
  } catch {
    /* same */
  }
  if (cfg.npmToken) out.push(cfg.npmToken);
  if (cfg.httpToken) out.push(cfg.httpToken);
  return out;
});
void redactor.prime();
const redactSnap = (snap: WatchSnapshot): WatchSnapshot => ({
  ...snap,
  log: redactor.redact(snap.log),
  ...(snap.question ? { question: redactor.redact(snap.question) } : {}),
  ...(snap.task ? { task: redactor.redact(snap.task) } : {}),
});
const watchHub = new WatchHub({ read: async (s) => redactSnap(await gatherWatch(cfg, s, undefined, { metrics: false })) });
// The dashboard's fleet read: gatherMonitor behind a short shared cache, plus lifecycle config and
// sleeping (Stopped-but-resumable) boxes merged from memory.
// Follow-ups typed while the agent is mid-turn wait here and are delivered when the run finishes.
const inbox = new Inbox();
// Detached: kicks the run and returns; the transcript streams. (deps.resume would block up to
// WAIT_TIMEOUT_MS for the agent's next boundary — fine for an MCP tool call, wrong for a chat send.)
const resumeQuietly = (session: string, message: string) =>
  deps.resumeDetached ? deps.resumeDetached(cfg, session, message) : deps.resume(cfg, session, message, undefined, {}).then(() => undefined);
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
const readFleet = makeFleetReader(
  cfg,
  async () => {
    const [boxes, kept, claims] = await Promise.all([
      gatherMonitor(cfg),
      listKept(cfg).catch(() => new Set<string>()),
      listClaims(cfg).catch(() => new Map<string, number>()),
    ]);
    return boxes.map((b) => ({
      ...b,
      // The task and any pending question are operator/agent text too — same redaction as the log.
      ...(b.task ? { task: redactor.redact(b.task) } : {}),
      ...(b.question ? { question: redactor.redact(b.question) } : {}),
      ...(kept.has(b.name) ? { kept: true } : {}),
      // For a stopped box the claim age is (a good proxy for) how long it has been asleep.
      ...(!/^running$/i.test(b.boxStatus) && claims.has(b.name) ? { asleepSec: claims.get(b.name) } : {}),
    }));
  },
  {
  decorate: (boxes) =>
    boxes.map((b) => {
      const q = inbox.list(b.name);
      return q.length ? { ...b, queued: q.map((m) => m.text) } : b;
    }),
    store: {
      load: () => loadRunMetas(cfg),
      save: (meta) => saveRunMeta(cfg, meta as Parameters<typeof saveRunMeta>[1]),
      forget: (box) => forgetRunMeta(cfg, box),
    },
  }
);
// Repositories reachable through the connected accounts (picker, inference, attach).
const listRepos = makeRepoLister(cfg, fetchGithubRepos);
// The same repo capabilities for MCP clients (Cursor etc.): list_repos / attach_repo tools.
deps.listRepos = async (_cfg, query) => {
  const all = matchRepos(await listRepos(), query, 25);
  if (!all.length) return query ? `No repository matches "${query}".` : "No repositories — connect a GitHub account first.";
  return all.map((r) => `${r.fullName}${r.private ? " (private)" : ""} · default ${r.defaultBranch}${r.description ? ` — ${r.description}` : ""}`).join("\n");
};
deps.attachRepo = async (c, session, repo, ref) => {
  const r = await attachRepoToBox(c, session, repo, ref);
  inbox.enqueue(session, `The repository ${repo} is now checked out at /workspace/${r.name}${ref ? ` (ref ${ref})` : ""}. Use it for the task where relevant.`);
  return `Attached ${repo} to ${session} at /workspace/${r.name}${r.login ? ` as ${r.login}` : ""}. The agent is told at its next turn.`;
};
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
// Header-only. The dashboard used to accept `?token=` so a page could be opened by URL; that put a
// root-equivalent secret into browser history, server logs and referrers. The client now keeps the
// token in local storage and sends it as a bearer header on every call — including the SSE stream
// (fetch-based) and artifact downloads (fetch + blob) — so the query form is gone. There is no
// query-parameter path here and nothing should add one back.
function dashAuthed(req: Request, res: Response): boolean {
  if (checkBearer(req.headers.authorization, cfg.httpToken)) return true;
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
  // Hashed assets are immutable; the HTML shell must never be cached or a browser keeps referencing
  // a bundle that no longer exists after a deploy (the "old index.js" crash reports).
  app.use(
    "/dashboard",
    express.static(WEB_DIST, {
      index: false,
      setHeaders: (res, filePath) => {
        if (/\/assets\//.test(filePath)) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        else res.setHeader("Cache-Control", "no-cache");
      },
    })
  );
  const sendShell = (res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(join(WEB_DIST, "index.html"));
  };
  // SPA fallback: /dashboard and anything under it that isn't a built asset returns index.html, so
  // a deep link (or a reload on one) still boots the app.
  app.get(/^\/dashboard(?:\/.*)?$/, (_req: Request, res: Response) => sendShell(res));
  // The public landing page is the same SPA at the site root (its assets are absolute under
  // /dashboard/). It carries no data and no token; the console routes stay bearer-guarded.
  app.get("/", (_req: Request, res: Response) => sendShell(res));
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
      Number.isFinite(lines) && lines > 0 ? redactSnap(await gatherWatch(cfg, session, lines)) : await watchHub.read(session)
    );
  } catch (e) {
    res.status(500).json({ error: String((e as Error).message ?? e) });
  }
});

// Live stream of one box's log over SSE. EventSource can't set headers, so the client reads this
// stream with fetch instead and sends the bearer header like every other call — auth here is the
// same header-only dashAuthed guard, never a query param. The controller fast-tails the log server-side and
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

// Download / preview a file the agent produced inside a box's /workspace. Same header-only dashAuthed
// guard as the other data routes; the client fetches the bytes and saves them as a blob. Path handling is
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
    // Text artifacts (source, logs, JSON, .env dumps) are redacted like the transcript; binaries pass.
    if (/^(text\/|application\/(json|javascript|xml|x-sh))/.test(result.contentType)) {
      res.send(redactor.redact(Buffer.isBuffer(result.data) ? result.data.toString("utf8") : String(result.data)));
    } else {
      res.send(result.data);
    }
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
    await resumeQuietly(session, message);
    res.json({ ok: true });
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

// Repositories the connected accounts can reach, ranked for the picker (?q=). ?refresh=1 re-fetches.
app.get("/repos.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const q = typeof req.query.q === "string" ? req.query.q : "";
  try {
    const all = await listRepos(req.query.refresh === "1");
    res.json({ repos: matchRepos(all, q), total: all.length });
  } catch (e) {
    res.status(500).json({ error: String((e as Error).message ?? e) });
  }
});
// Attach a repository to a RUNNING sandbox: clone with the account that can access it, place it at
// /workspace/<name>, and tell the agent (queued, delivered at its next boundary).
app.post("/repos/attach.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const { session, repo, ref } = (req.body ?? {}) as { session?: string; repo?: string; ref?: string };
  if (!session || !repo || !/^[\w.-]+\/[\w.-]+$/.test(repo.trim())) {
    res.status(400).json({ error: "session and repo (owner/name) are required" });
    return;
  }
  try {
    const r = await attachRepoToBox(cfg, session, repo.trim(), ref?.trim() || undefined);
    inbox.enqueue(session, `The repository ${repo.trim()} is now checked out at /workspace/${r.name}${ref ? ` (ref ${ref})` : ""}. Use it for the task where relevant.`);
    res.json({ ok: true, name: r.name, login: r.login });
  } catch (e) {
    res.status(500).json({ error: String((e as Error).message ?? e) });
  }
});

// MCP servers for the sandbox agent. GET lists (secrets masked); POST mutates:
//   {action:"upsert", server:{name,type,command,args,url,env,headers,enabled}}
//   {action:"import", json:"<{mcpServers:{...}}>"}  {action:"remove", name}  {action:"toggle", name, enabled}
app.get("/mcp-servers.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  try {
    const store = await loadMcpStore(cfg);
    res.json({ servers: viewServers(store), config: toEditableConfig(store) });
  } catch (e) {
    res.status(500).json({ error: String((e as Error).message ?? e) });
  }
});
app.post("/mcp-servers.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    const store = await loadMcpStore(cfg);
    const action = body.action;
    if (action === "upsert") {
      const s = normalizeServer(body.server as Partial<McpServerDef> & { name: string });
      // Rename: the entry moves under the new name and the old one goes.
      const previous = typeof body.previousName === "string" ? body.previousName : "";
      if (previous && previous !== s.name && store.servers[previous]) {
        const old = store.servers[previous];
        s.addedAt = old.addedAt;
        s.env = mergeSecrets(s.env, old.env) ?? old.env;
        s.headers = mergeSecrets(s.headers, old.headers) ?? old.headers;
        delete store.servers[previous];
      }
      // Keep secret values the form left masked/blank: merge over the stored entry.
      const prev = store.servers[s.name];
      if (prev) {
        s.addedAt = prev.addedAt;
        s.env = mergeSecrets(s.env, prev.env);
        s.headers = mergeSecrets(s.headers, prev.headers);
      }
      store.servers[s.name] = s;
    } else if (action === "import") {
      for (const s of parseMcpImport(String(body.json ?? ""))) store.servers[s.name] = s;
    } else if (action === "replace") {
      // The JSON editor saved the whole config.
      const next = replaceFromJson(store, String(body.json ?? ""));
      store.servers = next.servers;
    } else if (action === "remove") {
      delete store.servers[String(body.name ?? "")];
    } else if (action === "toggle") {
      const s = store.servers[String(body.name ?? "")];
      if (s) s.enabled = body.enabled !== false;
    } else {
      res.status(400).json({ error: "unknown action" });
      return;
    }
    await saveMcpStore(cfg, store);
    res.json({ servers: viewServers(store), config: toEditableConfig(store) });
  } catch (e) {
    res.status(400).json({ error: String((e as Error).message ?? e) });
  }
});

// What the agent changed: per-file +/- and status across the checked-out repos (and loose files).
app.get("/changes.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const session = typeof req.query.session === "string" ? req.query.session : "";
  if (!session) {
    res.status(400).json({ error: "session query param required" });
    return;
  }
  try {
    res.json({ files: await listChanges(cfg, session) });
  } catch (e) {
    res.status(500).json({ error: String((e as Error).message ?? e) });
  }
});
// The unified diff for one file (git diff HEAD), or "untracked" for a new file; path under /workspace.
app.get("/diff.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const session = typeof req.query.session === "string" ? req.query.session : "";
  const path = typeof req.query.path === "string" ? req.query.path : "";
  if (!session || !path) {
    res.status(400).json({ error: "session and path are required" });
    return;
  }
  try {
    res.json(await readDiff(cfg, session, path));
  } catch (e) {
    res.status(400).json({ error: String((e as Error).message ?? e) });
  }
});
// Pull request metadata for the PR card (through a connected account; cached a minute).
// Merge the run's pull request from inside its sandbox: `gh` there already carries the account
// that opened it, so the merge is attributed like the agent's own pushes. Method is merge-commit.
app.post("/pr/merge.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const { session, repo, number } = (req.body ?? {}) as { session?: string; repo?: string; number?: number };
  if (!session || !/^[\w.-]+$/.test(session) || !repo || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !Number.isFinite(Number(number))) {
    res.status(400).json({ error: "session, repo (owner/name) and number are required" });
    return;
  }
  try {
    const r = await execInBox(cfg, session, `gh pr merge ${Number(number)} --repo ${repo} --merge 2>&1`);
    forgetPull(repo, Number(number));
    res.json({ ok: true, output: redactor.redact((r.stdout ?? "").trim().slice(-600)) });
  } catch (e) {
    // exec throws on a non-zero exit with gh's own message (not mergeable, checks, permissions…).
    forgetPull(repo, Number(number));
    res.status(422).json({ error: redactor.redact(String((e as Error).message ?? e).trim().slice(-600)) });
  }
});

app.get("/pr.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const repo = typeof req.query.repo === "string" ? req.query.repo : "";
  const number = Number(req.query.number);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !Number.isFinite(number)) {
    res.status(400).json({ error: "repo (owner/name) and number are required" });
    return;
  }
  try {
    const info = await fetchPull(cfg, repo, number);
    if (!info) res.status(404).json({ error: "pull request not reachable with the connected accounts" });
    else res.json(info);
  } catch (e) {
    res.status(500).json({ error: String((e as Error).message ?? e) });
  }
});

// Keep (pin) a sandbox: it still sleeps like any other, but is never reaped — only Destroy removes it.
app.post("/keep.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const { session, keep } = (req.body ?? {}) as { session?: string; keep?: boolean };
  if (!session) {
    res.status(400).json({ error: "session is required" });
    return;
  }
  try {
    if (keep === false) await unmarkKept(cfg, session);
    else await markKept(cfg, session);
    res.json({ ok: true, kept: keep !== false });
  } catch (e) {
    res.status(500).json({ error: String((e as Error).message ?? e) });
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
// Wake a sleeping sandbox the moment its thread is opened — no need to type first. Idempotent.
app.post("/wake.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const { session } = (req.body ?? {}) as { session?: string };
  if (!session || !/^[\w.-]+$/.test(session)) {
    res.status(400).json({ error: "session is required" });
    return;
  }
  try {
    await startBoxIfStopped(cfg, session);
    noteRunning(session);
    watchHub.drop(session); // the cached "stopped" snapshot must not be served as live
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String((e as Error).message ?? e) });
  }
});

// Every file under /workspace (same exclusions as the @-mention index), for the file explorer.
app.get("/tree.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const session = typeof req.query.session === "string" ? req.query.session : "";
  if (!session) {
    res.status(400).json({ error: "session query param required" });
    return;
  }
  try {
    res.json(await fileIndex(session, "", Number.POSITIVE_INFINITY));
  } catch (e) {
    res.status(500).json({ error: String((e as Error).message ?? e) });
  }
});

// Write one text file under /workspace (the explorer's editor). Path-confined like /artifact; the
// body travels base64 so no byte can escape the shell quoting. Size-capped at 2 MB.
app.put("/file.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const { session, path, content } = (req.body ?? {}) as { session?: string; path?: string; content?: string };
  if (!session || !/^[\w.-]+$/.test(session) || typeof path !== "string" || typeof content !== "string") {
    res.status(400).json({ error: "session, path and content are required" });
    return;
  }
  if (content.length > 2_000_000) {
    res.status(413).json({ error: "file too large to edit here (2 MB cap)" });
    return;
  }
  const safe = safeWorkspacePath(path);
  if (!safe.ok) {
    res.status(400).json({ error: safe.message });
    return;
  }
  try {
    const b64 = Buffer.from(content, "utf8").toString("base64");
    const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
    const abs = `/workspace/${safe.relPath}`;
    const dir = abs.slice(0, abs.lastIndexOf("/"));
    await execInBox(cfg, session, `mkdir -p ${q(dir)} && printf '%s' ${q(b64)} | base64 -d > ${q(abs)} && wc -c < ${q(abs)}`);
    res.json({ ok: true, path: safe.relPath, bytes: Buffer.byteLength(content, "utf8") });
  } catch (e) {
    res.status(422).json({ error: String((e as Error).message ?? e).slice(-400) });
  }
});

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
    // Explicit repos from the picker win. With none given, a repo the TASK names ("review the last PR
    // in elseco deal service") is attached automatically, so the agent starts with the checkout it
    // was clearly asked about instead of hunting for it with `gh search`.
    const explicit = Array.isArray(body.repos)
      ? (body.repos as Array<{ repo?: string; ref?: string }>)
          .filter((r) => r && typeof r.repo === "string" && r.repo.trim())
          .map((r) => ({ repo: r.repo!.trim(), ref: typeof r.ref === "string" && r.ref.trim() ? r.ref.trim() : undefined }))
      : [];
    let inferred: string[] = [];
    let repos = explicit;
    if (!repos.length && typeof body.repo !== "string") {
      try {
        const matches = inferRepos(body.task, await listRepos());
        inferred = matches.map((m) => m.fullName);
        repos = matches.map((m) => ({ repo: m.fullName, ref: undefined }));
      } catch {
        /* inference is best-effort; a task-only run is the honest fallback */
      }
    }
    const result = await runDelegateFlow(cfg, deps, {
      source: body.source === "local" ? "local" : "git",
      repo: typeof body.repo === "string" ? body.repo : undefined,
      repos: repos.length ? repos : undefined,
      task: body.task,
      ref: typeof body.ref === "string" ? body.ref : undefined,
      githubToken: typeof body.githubToken === "string" ? body.githubToken : undefined,
      githubAccount: typeof body.githubAccount === "string" ? body.githubAccount : undefined,
    });
    res.json(inferred.length ? { ...result, inferred } : result);
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
