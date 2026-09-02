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
import { isDeadSession } from "./mcp-session.js";
import { loadDotEnv } from "./dotenv.js";
import { loadConfig } from "./config.js";
import { registerTools } from "./handlers.js";
import { makeBridge } from "./server-bridge.js";
import { deps as rawDeps, resolveCredsForBox } from "./deps.js";
import { refillPool, startPoolMaintainer } from "./pool.js";
import { checkBearer } from "./http-auth.js";
import { clientOf, makeAuthThrottle, makeRateLimiter } from "./auth-throttle.js";
import { auditFields, formatAudit, MUTATING } from "./audit.js";
import { openDb } from "./db.js";
import {
  API_KEY_PREFIX, clearSessionCookie, consumeLoginState, createApiKey, createSession, csrfOk, deleteSession, getUser, listApiKeys, newLoginState, parseCookies,
  principalFromApiKey, principalFromSession, revokeApiKey, SESSION_COOKIE, sessionCookie, upsertGithubUser, mayAccess, type Principal,
} from "./identity.js";
import { githubAuthorizeUrl, githubExchangeCode, githubIdentity } from "./github-oauth.js";
import { keyFromEnvOrFile, makeSecretBox } from "./secretbox.js";
import { allBlobs, registerUserStoreBackend, withOwner } from "./user-store.js";
import { createLocalUser, deleteUser, listUsers, ownerOf, setUserRole, validateSignup, createPasswordUser, authenticatePassword, setPassword, updateProfile, verifyPassword, PASSWORD_MIN, listSessions, revokeSession, revokeOtherSessions, startTrial, planOf, setPlan, TrialExpiredError } from "./identity.js";
import { parseStore } from "./gh-token-store.js";
import { parseMcpStore } from "./mcp-store.js";
import { guardDeps, makeOwnership, NotOwnedError, QuotaError, withPrincipal } from "./tenancy.js";
import { securityHeaders } from "./security-headers.js";
import { gatherMonitor, gatherWatch, askInBox, driverStateLine, startBoxIfStopped, noteRunning, stopBox, noteStopped, interruptAgentRun } from "./msb.js";
import { isBoxName } from "./sync.js";
import { shellQuote } from "./exec.js";
import { touchClaimed } from "./claims.js";
import { safeWorkspacePath } from "./artifact.js";
import { gitStatus, gitCommitAll, gitPush } from "./git-ops.js";
import { loadTitles, generateTitle, forgetTitle, saveTitle, cleanTitle } from "./titles.js";
import { runDelegateFlow } from "./delegate-flow.js";
import { streamWatch } from "./watch-sse.js";
import { WatchHub } from "./watch-hub.js";
import { makeFleetReader } from "./fleet.js";
import { Inbox, startInboxDelivery } from "./inbox.js";
import { makeCredentialBroker } from "./broker.js";
import { makeFileIndex } from "./files.js";
import { exec as execInBox, execWithInput } from "./msb.js";
import { loadStore, saveStore, pickDefaultAccount, upsertAccount, removeAccount, setDefaultAccount } from "./gh-token-store.js";
import { probeToken } from "./gh-probe.js";
import { viewAccounts, deviceStart, devicePoll } from "./accounts.js";
import { makeRepoLister, fetchGithubRepos, matchRepos, inferRepos, attachRepoToBox } from "./repos.js";
import { loadMcpStore, saveMcpStore, normalizeServer, parseMcpImport, viewServers, toEditableConfig, replaceFromJson, mergeSecrets, type McpServer as McpServerDef } from "./mcp-store.js";
import { loadSkillStore, saveSkillStore, normalizeSkill, viewSkills, type SkillDef } from "./skill-store.js";
import { listRepoSkills, fetchRepoFile } from "./github-skills.js";
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

// The controller's own state (users, sessions, API keys, box ownership, audit). Opened in both modes:
// in "token" mode it only receives audit rows and ownership records for the operator.
const db = openDb(cfg.dataDir);
// Integrations (GitHub accounts, MCP servers) are per owner and encrypted at rest from here on. The
// operator's row is seeded from the legacy shared files on first read.
registerUserStoreBackend({ db, box: makeSecretBox(keyFromEnvOrFile(process.env.SECRETS_KEY, cfg.dataDir)) });
const ownership = makeOwnership(db, cfg);
const deps = guardDeps(rawDeps, ownership);
const SAAS = cfg.authMode === "saas";
const SECURE_COOKIE = (cfg.publicUrl ?? "").startsWith("https://");
const GITHUB_LOGIN = SAAS && !!(cfg.githubOauthClientId && cfg.githubOauthClientSecret && cfg.publicUrl);
if (SAAS && !GITHUB_LOGIN) console.error("[agent-sandbox] AUTH_MODE=saas without a GitHub OAuth App: users sign in with personal access tokens issued by an admin.");

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
const jsonSmall = express.json({ limit: "1mb" });
const jsonLarge = express.json({ limit: "96mb" }); // /file.json (≤8 MB file as base64) and /delegate.json (≤8 images)
// /mcp carries delegate calls whose `patch` can be a multi-MB diff (MAX_PATCH_BYTES = 8 MB, plus
// JSON-escaping overhead) — 1 MB would reject them at the parser with an error the MCP client
// can't interpret. 16 MB bounds it without opening the firehose the file/image routes need.
const jsonMcp = express.json({ limit: "16mb" });
app.use((req: Request, res: Response, next) =>
  (req.path === "/file.json" || req.path === "/delegate.json"
    ? jsonLarge
    : req.path === "/mcp" || req.path.startsWith("/mcp/")
    ? jsonMcp
    : jsonSmall)(req, res, next)
);
app.use((err: unknown, _req: Request, res: Response, next: express.NextFunction) => {
  const e = err as { type?: string; status?: number; message?: string } | undefined;
  if (e && (e.type === "entity.too.large" || e.type === "entity.parse.failed" || e.status === 400 || e.status === 413)) {
    res.status(e.status ?? 400).json({ error: e.type === "entity.too.large" ? "request body too large" : "malformed JSON body" });
    return;
  }
  next(err);
});

/**
 * Who is calling — resolved once, before any route, and carried through async continuations so the
 * shared deps can enforce ownership. Order: operator bearer → API key bearer → session cookie (not
 * for /mcp: machine clients never use cookies). A cookie-authenticated MUTATION must also pass the
 * CSRF check; when it does not, the request is treated as anonymous (→ 401 from the route guard).
 */
function bearerOf(req: Request): string | undefined {
  const h = req.headers.authorization;
  return h && h.startsWith("Bearer ") ? h.slice("Bearer ".length) : undefined;
}
function resolvePrincipal(req: Request): Principal | null {
  const isMcp = req.path === "/mcp" || req.path.startsWith("/mcp/");
  const bearer = bearerOf(req);
  if (bearer) {
    if (checkBearer(req.headers.authorization, isMcp ? cfg.httpToken : cfg.dashboardToken)) return { kind: "operator" };
    if (!isMcp && !SAAS && checkBearer(req.headers.authorization, cfg.httpToken)) return { kind: "operator" };
    if (bearer.startsWith(API_KEY_PREFIX)) return principalFromApiKey(db, bearer);
    return null;
  }
  if (isMcp || !SAAS) return null;
  const p = principalFromSession(db, parseCookies(req.headers.cookie)[SESSION_COOKIE]);
  if (p && MUTATING.has(req.method) && !csrfOk(req.headers as Record<string, string | string[] | undefined>, cfg.publicUrl)) return null;
  return p;
}
app.use((req: Request, res: Response, next) => {
  const p = resolvePrincipal(req);
  res.locals.principal = p;
  const isMcpPath = req.path === "/mcp" || req.path.startsWith("/mcp/");
  // A `session` on any non-MCP route names a box, and a box name becomes a directory name and a
  // shell word downstream. Routes validated it individually and inconsistently: isBoxName on four,
  // an ad-hoc /^[\w.-]+$/ on four more (which accepts "." and ".." — exactly what isBoxName exists
  // to reject), and nothing at all on /tree.json, /files.json, /changes.json and /diff.json. One
  // check at the edge, on the same field the ownership check below already reads, is the version
  // that cannot drift as routes are added.
  if (!isMcpPath) {
    const s = (req.body as Record<string, unknown> | undefined)?.session ?? (req.query as Record<string, unknown>).session;
    if (s !== undefined && s !== "" && !isBoxName(s)) {
      res.status(400).json({ error: "invalid session name" });
      return;
    }
  }
  // Box-scoped JSON routes: a user may only name their own boxes. 404, not 403 — no existence oracle.
  if (p && p.kind === "user" && p.role !== "admin" && !isMcpPath) {
    const s = (req.body as Record<string, unknown> | undefined)?.session ?? (req.query as Record<string, unknown>).session;
    if (typeof s === "string" && s && !mayAccess(db, p, s)) {
      res.status(404).json({ error: "no such machine" });
      return;
    }
  }
  if (p) withPrincipal(p, next);
  else next();
});

// Rate limit state-changing calls per caller (60/min): a runaway script or a hostile key cannot spin
// machines or hammer sign-in faster than that. Reads are unlimited; /mcp has its own transport.
const mutationLimiter = makeRateLimiter({ limit: Number(process.env.RATE_LIMIT_PER_MIN ?? "60") || 60, windowMs: 60_000 });
app.use((req: Request, res: Response, next) => {
  if (!MUTATING.has(req.method) || req.path === "/mcp" || req.path.startsWith("/mcp/")) return next();
  const p = res.locals.principal as Principal | null;
  const key = p ? (p.kind === "user" ? p.userId : "operator") : `anon:${clientOf(req.headers, req.socket.remoteAddress)}`;
  if (mutationLimiter.over(key)) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ error: "slow down — too many requests this minute" });
    return;
  }
  next();
});

// Audit every state-changing call (not /mcp — the MCP transport has its own tool-level log lines).
app.use((req: Request, res: Response, next) => {
  if (!MUTATING.has(req.method) || req.path === "/mcp" || req.path.startsWith("/mcp/")) return next();
  const started = Date.now();
  res.on("finish", () => {
    const p = res.locals.principal as Principal | null;
    const ev = {
      at: new Date(started).toISOString(),
      client: clientOf(req.headers, req.socket.remoteAddress),
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Date.now() - started,
      ...auditFields(req.body, req.query),
    };
    console.error(formatAudit(ev));
    try {
      db.prepare(`INSERT INTO audit_events (at, user_id, client, method, path, status, session, action) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        ev.at, p?.kind === "user" ? p.userId : p ? "operator" : null, ev.client, ev.method, ev.path, ev.status, ev.session ?? null, ev.action ?? null
      );
    } catch {
      /* audit storage must never fail a request */
    }
  });
  next();
});

// One shared tail loop per watched box (see watch-hub.ts): every SSE viewer, /watch.json call and
// hover-prefetch of the same box reads one cached snapshot instead of each paying an SSH round trip.
// The tick path skips `msb metrics` — vitals arrive with the fleet poll.
// Everything the dashboard shows from inside a box passes through here: the exact secrets the
// controller holds (GitHub tokens, MCP secrets, npm/bearer) are replaced wherever they appear, and
// anything shaped like a credential is masked too. See redact.ts.
const redactor = makeRedactor(async () => {
  const out: string[] = [];
  // Every owner's secrets, not just the caller's: a transcript may quote any of them.
  try {
    await loadStore(cfg); // seeds the operator row from the legacy file on first run
    for (const raw of allBlobs("gh-tokens")) for (const a of Object.values(parseStore(raw).accounts)) out.push(a.token);
  } catch {
    /* store unreachable: shapes still apply */
  }
  try {
    await loadMcpStore(cfg);
    for (const raw of allBlobs("mcp"))
      for (const s of Object.values(parseMcpStore(raw).servers)) for (const m of [s.env, s.headers]) for (const [k, v] of Object.entries(m ?? {})) if (isSecretKey(k)) out.push(v);
  } catch {
    /* same */
  }
  if (cfg.npmToken) out.push(cfg.npmToken);
  if (cfg.httpToken) out.push(cfg.httpToken);
  if (cfg.dashboardToken && cfg.dashboardToken !== cfg.httpToken) out.push(cfg.dashboardToken);
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
const resumeQuietly = (session: string, message: string) => {
  // A resume boots a sleeping box; forget the "stopped" memory and the cached idle snapshot at once so
  // the thread does not show it asleep (and close its stream) for the next 15 s.
  noteRunning(session);
  watchHub.drop(session);
  // Whoever triggers it (inbox delivery, broker, an admin), the box runs with its OWNER's integrations.
  return withOwner(ownerOf(db, session) ?? null, () =>
    deps.resumeDetached ? deps.resumeDetached(cfg, session, message) : deps.resume(cfg, session, message, undefined, {}).then(() => undefined)
  );
};
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
const lastSeenStatus = new Map<string, boolean>();
const readFleet = makeFleetReader(
  cfg,
  async () => {
    const [boxes, kept, claims, titles] = await Promise.all([
      gatherMonitor(cfg),
      listKept(cfg).catch(() => new Set<string>()),
      listClaims(cfg).catch(() => new Map<string, number>()),
      loadTitles(cfg).catch(() => ({}) as Record<string, string>),
    ]);
    // A box seen Running last sweep and Stopped now just fell asleep: re-stamp its claim so the sleep
    // TTL (and the "asleep for" figure) count from the nap rather than from when the run started.
    for (const b of boxes) {
      const was = lastSeenStatus.get(b.name);
      const runningNow = /^running$/i.test(b.boxStatus);
      if (was === true && !runningNow && claims.has(b.name)) void touchClaimed(cfg, b.name).catch(() => {});
      lastSeenStatus.set(b.name, runningNow);
    }
    for (const k of [...lastSeenStatus.keys()]) if (!boxes.some((b) => b.name === k)) lastSeenStatus.delete(k);
    return boxes.map((b) => ({
      ...b,
      ...(titles[b.name] ? { title: titles[b.name] } : {}),
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
const authThrottle = makeAuthThrottle();
app.use("/mcp", (req: Request, res: Response, next) => {
  const client = clientOf(req.headers, req.socket.remoteAddress);
  if (authThrottle.blocked(client)) {
    res.setHeader("Retry-After", "600");
    res.status(429).json({ jsonrpc: "2.0", error: { code: -32001, message: "too many failed attempts" }, id: null });
    return;
  }
  const p = res.locals.principal as Principal | null;
  if (!p) {
    authThrottle.fail(client);
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "unauthorized" },
      id: null,
    });
    return;
  }
  // The SDK forwards `req.auth` to tool handlers as `extra.authInfo`; the principal also travels via ALS.
  (req as Request & { auth?: unknown }).auth = { token: "", clientId: p.kind === "user" ? p.userId : "operator", scopes: [], extra: { principal: p } };
  next();
});

// Per-session Streamable HTTP transports, keyed by the mcp-session-id header.
const transports: Record<string, StreamableHTTPServerTransport> = {};

async function handle(req: Request, res: Response) {
  const sid = req.headers["mcp-session-id"] as string | undefined;
  let transport = sid ? transports[sid] : undefined;

  if (isDeadSession(sid, Boolean(transport), req.body)) {
    res.status(404).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Session not found: the server restarted. Re-initialize to get a new session id." },
      id: null,
    });
    return;
  }

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
      makeBridge(server),
      // Remote entry: the client is on another machine, so source:"local" (rsync the caller's tree)
      // cannot work here — it would read the server's own disk. See registerTools' remoteEntry.
      true
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

  const p = (res.locals.principal as Principal | null) ?? { kind: "operator" as const };
  await withPrincipal(p, () => transport!.handleRequest(req, res, req.body));
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
  const client = clientOf(req.headers, req.socket.remoteAddress);
  if (authThrottle.blocked(client)) {
    res.setHeader("Retry-After", "600");
    res.status(429).json({ error: "too many failed attempts — try again later" });
    return false;
  }
  if (res.locals.principal) return true;
  // Only a presented-and-wrong credential counts against the client; a missing one is just anonymous.
  if (bearerOf(req) || parseCookies(req.headers.cookie)[SESSION_COOKIE]) authThrottle.fail(client);
  res.status(401).json({ error: "unauthorized" });
  return false;
}
const principalOf = (res: Response): Principal => (res.locals.principal as Principal | null) ?? { kind: "operator" };
/** Map tenancy errors to HTTP: unknown/foreign box → 404, quota → 429, else 500. */
function failWith(res: Response, e: unknown): void {
  if (e instanceof NotOwnedError) res.status(404).json({ error: "no such machine" });
  else if (e instanceof TrialExpiredError) res.status(402).json({ error: e.message, code: "trial_expired" });
  else if (e instanceof QuotaError) res.status(429).json({ error: e.message });
  // Anything else is a 500. This branch used to call failWith itself — infinite recursion, so every
  // unexpected error blew the stack instead of answering the request. The message is operator-facing
  // (this is a single-tenant control plane) but goes through the redactor: an msb/git failure can
  // quote a command line that carried a token.
  else res.status(500).json({ error: redactor.redact(String((e as Error)?.message ?? e)) });
}

// ---- sign-in, session, API keys ----------------------------------------------------------------
// Public: tells the SPA which front door to show.
app.get("/auth/config.json", (_req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ mode: cfg.authMode, providers: SAAS && cfg.githubOauthClientId && cfg.githubOauthClientSecret ? ["github"] : [], tokenLogin: true, password: SAAS, signup: SAAS && cfg.signup === "open", passwordMin: PASSWORD_MIN, trialDays: SAAS ? cfg.trialDays : 0, billingUrl: cfg.billingUrl ?? null, beta: cfg.beta });
});
if (GITHUB_LOGIN) {
  const redirectUri = `${cfg.publicUrl}/auth/github/callback`;
  app.get("/auth/github", (req: Request, res: Response) => {
    const to = typeof req.query.to === "string" && /^\/dashboard(\/|$)/.test(req.query.to) ? req.query.to : "/dashboard/";
    res.redirect(githubAuthorizeUrl(cfg.githubOauthClientId!, redirectUri, newLoginState(db, to)));
  });
  app.get("/auth/github/callback", async (req: Request, res: Response) => {
    const st = consumeLoginState(db, typeof req.query.state === "string" ? req.query.state : undefined);
    const code = typeof req.query.code === "string" ? req.query.code : "";
    if (!st.ok || !code) {
      res.status(400).type("text/plain").send("Sign-in link expired or invalid. Go back and try again.");
      return;
    }
    try {
      const token = await githubExchangeCode(cfg.githubOauthClientId!, cfg.githubOauthClientSecret!, code, redirectUri);
      const gh = await githubIdentity(token);
      const user = upsertGithubUser(db, { githubId: gh.id, login: gh.login, email: gh.email, avatarUrl: gh.avatarUrl }, { adminLogins: cfg.adminLogins });
      if (user.plan === "trial" && !user.trial_ends_at) startTrial(db, user.id, cfg.trialDays);
      const sess = createSession(db, user.id, { ip: clientOf(req.headers, req.socket.remoteAddress), userAgent: String(req.headers["user-agent"] ?? "") });
      res.setHeader("Set-Cookie", sessionCookie(sess.id, { secure: SECURE_COOKIE }));
      res.redirect(st.redirectTo ?? "/dashboard/");
    } catch (e) {
      console.error(`[auth] github sign-in failed: ${String((e as Error).message ?? e)}`);
      res.status(502).type("text/plain").send("GitHub sign-in failed. Try again in a moment.");
    }
  });
}
/** Sign up / sign in with a password (saas). Both are throttled per client like every other credential check. */
function startSession(req: Request, res: Response, userId: string): void {
  const sess = createSession(db, userId, { ip: clientOf(req.headers, req.socket.remoteAddress), userAgent: String(req.headers["user-agent"] ?? "") });
  res.setHeader("Set-Cookie", sessionCookie(sess.id, { secure: SECURE_COOKIE }));
}
if (SAAS) {
  app.post("/auth/signup", (req: Request, res: Response) => {
    const client = clientOf(req.headers, req.socket.remoteAddress);
    if (authThrottle.blocked(client)) {
      res.status(429).json({ error: "too many attempts — try again later" });
      return;
    }
    if (cfg.signup !== "open") {
      res.status(403).json({ error: "sign-up is by invitation on this controller — ask an admin for an access token" });
      return;
    }
    if (!csrfOk(req.headers as Record<string, string | string[] | undefined>, cfg.publicUrl)) {
      res.status(403).json({ error: "bad origin" });
      return;
    }
    const v = validateSignup((req.body ?? {}) as Record<string, unknown>);
    if (!v.ok) {
      res.status(400).json({ error: v.error });
      return;
    }
    try {
      // Bootstrap rule: the very first account becomes admin ONLY when no admin is designated by
      // config — a self-hoster starting from nothing. With ADMIN_GITHUB_LOGINS set, nobody is promoted
      // by being first (open sign-up on a public instance must never hand out admin).
      const u = createPasswordUser(db, v, { adminLogins: cfg.adminLogins, firstIsAdmin: cfg.adminLogins.length === 0 });
      startTrial(db, u.id, cfg.trialDays);
      startSession(req, res, u.id);
      res.json({ ok: true, id: u.id, login: u.login, role: u.role });
    } catch (e) {
      authThrottle.fail(client); // enumeration attempts count
      res.status(409).json({ error: String((e as Error).message ?? e) });
    }
  });
  app.post("/auth/login", (req: Request, res: Response) => {
    const client = clientOf(req.headers, req.socket.remoteAddress);
    if (authThrottle.blocked(client)) {
      res.setHeader("Retry-After", "600");
      res.status(429).json({ error: "too many attempts — try again later" });
      return;
    }
    if (!csrfOk(req.headers as Record<string, string | string[] | undefined>, cfg.publicUrl)) {
      res.status(403).json({ error: "bad origin" });
      return;
    }
    const { login, password } = (req.body ?? {}) as { login?: string; password?: string };
    const u = typeof login === "string" && typeof password === "string" ? authenticatePassword(db, login, password) : null;
    if (!u) {
      authThrottle.fail(client);
      res.status(401).json({ error: "Wrong username or password." });
      return;
    }
    startSession(req, res, u.id);
    res.json({ ok: true, id: u.id, login: u.login, role: u.role });
  });
  // Profile + password. Changing the password requires the current one (a stolen session cannot lock the owner out).
  app.post("/account.json", (req: Request, res: Response) => {
    if (!dashAuthed(req, res)) return;
    const p = principalOf(res);
    if (p.kind !== "user") {
      res.status(403).json({ error: "the operator has no profile" });
      return;
    }
    const { name, email, currentPassword, newPassword } = (req.body ?? {}) as { name?: string; email?: string | null; currentPassword?: string; newPassword?: string };
    const user = getUser(db, p.userId);
    if (!user) {
      res.status(404).json({ error: "no such user" });
      return;
    }
    if (typeof newPassword === "string") {
      if (user.password_hash && !verifyPassword(String(currentPassword ?? ""), user.password_hash)) {
        res.status(403).json({ error: "Current password is wrong." });
        return;
      }
      if (newPassword.length < PASSWORD_MIN) {
        res.status(400).json({ error: `Password: at least ${PASSWORD_MIN} characters.` });
        return;
      }
      setPassword(db, p.userId, newPassword);
    }
    if (typeof name === "string" || email !== undefined) {
      if (typeof email === "string" && email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        res.status(400).json({ error: "That email address does not look right." });
        return;
      }
      updateProfile(db, p.userId, { name: typeof name === "string" ? name : undefined, email: email === undefined ? undefined : email || null });
    }
    res.json({ ok: true });
  });
}
app.post("/auth/logout", (req: Request, res: Response) => {
  const p = res.locals.principal as Principal | null;
  if (p?.kind === "user" && p.sessionId) deleteSession(db, p.sessionId);
  res.setHeader("Set-Cookie", clearSessionCookie(SECURE_COOKIE));
  res.json({ ok: true });
});
app.get("/me.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const p = principalOf(res);
  if (p.kind === "operator") {
    res.json({ kind: "operator", mode: cfg.authMode, role: "admin" });
    return;
  }
  const u = getUser(db, p.userId);
  const plan = u ? planOf(u) : { plan: "free" as const, trialEndsAt: null, daysLeft: null, expired: false };
  res.json({ kind: "user", mode: cfg.authMode, id: p.userId, login: p.login, name: u?.name ?? null, role: p.role, via: p.via, email: u?.email ?? null, avatarUrl: u?.avatar_url ?? null, github: !!u?.github_id, hasPassword: !!u?.password_hash, maxBoxes: u?.max_boxes ?? cfg.userMaxBoxes, ...plan, billingUrl: cfg.billingUrl ?? null });
});
// Users — operator/admin only. Self-hosting without OAuth: an admin creates the account and hands
// over its first access token (shown once); the person signs in with it and can mint their own keys.
function isAdmin(p: Principal): boolean {
  return p.kind === "operator" || p.role === "admin";
}
app.get("/users.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  if (!isAdmin(principalOf(res))) {
    res.status(403).json({ error: "admins only" });
    return;
  }
  res.json({ users: listUsers(db).map((u) => ({ id: u.id, login: u.login, name: u.name, email: u.email, role: u.role, maxBoxes: u.max_boxes, createdAt: u.created_at, lastSeenAt: u.last_seen_at, github: !!u.github_id, keys: u.keys, boxes: u.boxes, ...planOf(u) })) });
});
app.post("/users.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  if (!isAdmin(principalOf(res))) {
    res.status(403).json({ error: "admins only" });
    return;
  }
  const { login, email, role } = (req.body ?? {}) as { login?: string; email?: string; role?: string };
  try {
    const u = createLocalUser(db, { login: String(login ?? ""), email: typeof email === "string" ? email : null, role: role === "admin" ? "admin" : "user" });
    const key = createApiKey(db, u.id, "first sign-in");
    res.json({ id: u.id, login: u.login, role: u.role, token: key.token });
  } catch (e) {
    res.status(400).json({ error: String((e as Error).message ?? e) });
  }
});
app.post("/users/key.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  if (!isAdmin(principalOf(res))) {
    res.status(403).json({ error: "admins only" });
    return;
  }
  const { id } = (req.body ?? {}) as { id?: string };
  if (!id || !getUser(db, id)) {
    res.status(404).json({ error: "no such user" });
    return;
  }
  res.json(createApiKey(db, id, "issued by admin"));
});
app.post("/users/plan.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  if (!isAdmin(principalOf(res))) {
    res.status(403).json({ error: "admins only" });
    return;
  }
  const { id, plan, days } = (req.body ?? {}) as { id?: string; plan?: string; days?: number };
  if (!id || !["trial", "pro", "free"].includes(String(plan)) || !setPlan(db, id, plan as "trial" | "pro" | "free", typeof days === "number" && days > 0 ? Math.min(365, days) : undefined)) {
    res.status(404).json({ error: "no such user" });
    return;
  }
  res.json({ ok: true });
});
app.post("/users/role.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  if (!isAdmin(principalOf(res))) {
    res.status(403).json({ error: "admins only" });
    return;
  }
  const { id, role } = (req.body ?? {}) as { id?: string; role?: string };
  if (!id || (role !== "admin" && role !== "user") || !setUserRole(db, id, role)) {
    res.status(404).json({ error: "no such user" });
    return;
  }
  res.json({ ok: true });
});
app.delete("/users.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const p = principalOf(res);
  if (!isAdmin(p)) {
    res.status(403).json({ error: "admins only" });
    return;
  }
  const { id } = (req.body ?? {}) as { id?: string };
  if (!id || (p.kind === "user" && p.userId === id)) {
    res.status(400).json({ error: "cannot delete yourself" });
    return;
  }
  // Sessions and keys cascade; their boxes become the operator's (owner_id → NULL) and can be destroyed from Fleet.
  if (!deleteUser(db, id)) {
    res.status(404).json({ error: "no such user" });
    return;
  }
  res.json({ ok: true });
});

// Signed-in devices: list and revoke browser sessions.
app.get("/sessions.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const p = principalOf(res);
  if (p.kind !== "user") {
    res.json({ sessions: [] });
    return;
  }
  res.json({ sessions: listSessions(db, p.userId).map((s) => ({ id: s.id.slice(0, 8), current: s.id === p.sessionId, createdAt: s.created_at, lastSeenAt: s.last_seen_at, ip: s.ip, userAgent: s.user_agent })) });
});
app.delete("/sessions.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const p = principalOf(res);
  const { id, others } = (req.body ?? {}) as { id?: string; others?: boolean };
  if (p.kind !== "user") {
    res.status(403).json({ error: "no sessions" });
    return;
  }
  if (others) {
    res.json({ ok: true, revoked: revokeOtherSessions(db, p.userId, p.sessionId) });
    return;
  }
  const full = typeof id === "string" ? listSessions(db, p.userId).find((s) => s.id.startsWith(id))?.id : undefined;
  if (!full || !revokeSession(db, p.userId, full)) {
    res.status(404).json({ error: "no such session" });
    return;
  }
  res.json({ ok: true });
});

// API keys — for IDE/MCP clients and CI. Shown once at creation; the store keeps only a hash.
app.get("/api-keys.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const p = principalOf(res);
  if (p.kind !== "user") {
    res.json({ keys: [] });
    return;
  }
  res.json({ keys: listApiKeys(db, p.userId) });
});
app.post("/api-keys.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const p = principalOf(res);
  if (p.kind !== "user" || p.via !== "session") {
    res.status(403).json({ error: "sign in through the browser to create API keys" });
    return;
  }
  const { name } = (req.body ?? {}) as { name?: string };
  if (listApiKeys(db, p.userId).filter((k) => !k.revoked_at).length >= 10) {
    res.status(429).json({ error: "at most 10 active keys" });
    return;
  }
  res.json(createApiKey(db, p.userId, typeof name === "string" ? name : "key"));
});
app.delete("/api-keys.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const p = principalOf(res);
  const { id } = (req.body ?? {}) as { id?: string };
  if (p.kind !== "user" || !id || !revokeApiKey(db, p.userId, id)) {
    res.status(404).json({ error: "no such key" });
    return;
  }
  res.json({ ok: true });
});

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
  // Public auth pages are part of the SPA too (a direct visit or reload must not 404).
  app.get(/^\/(signin|signup)\/?$/, (_req: Request, res: Response) => sendShell(res));
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
    res.json(ownership.visible(await gatherMonitor(cfg)).map((b) => ({ ...b, ...(b.task ? { task: redactor.redact(b.task) } : {}), ...(b.question ? { question: redactor.redact(b.question) } : {}) })));
  } catch (e) {
    failWith(res, e);
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
      if (b.runState === "waiting" && /^running$/i.test(b.boxStatus)) void withOwner(ownerOf(db, b.name) ?? null, () => brokerConsider(b.name, b.question));
    }
    if (!ownership.isUser()) {
      res.json(fleet);
      return;
    }
    const p = principalOf(res);
    const max = (p.kind === "user" && getUser(db, p.userId)?.max_boxes) || cfg.userMaxBoxes;
    res.json({ ...fleet, boxes: ownership.visible(fleet.boxes), lifecycle: { ...fleet.lifecycle, capacity: Math.min(max, fleet.lifecycle.capacity || max) } });
  } catch (e) {
    failWith(res, e);
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
      Number.isInteger(lines) && lines > 0 && lines <= 5000 ? redactSnap(await gatherWatch(cfg, session, lines)) : await watchHub.read(session)
    );
  } catch (e) {
    failWith(res, e);
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
    const buf = Buffer.isBuffer(result.data) ? result.data : Buffer.from(String(result.data));
    // Redact anything that is text — by declared type, or by content for unknown extensions (.env,
    // .pem, .ini, extensionless dumps): no NUL bytes in the first 8 KB and it decodes as UTF-8.
    const looksText = !buf.subarray(0, 8192).includes(0) && (() => { try { new TextDecoder("utf-8", { fatal: true }).decode(buf); return true; } catch { return false; } })();
    if (/^(text\/|application\/(json|javascript|xml|x-sh))/.test(result.contentType) || (result.contentType === "application/octet-stream" && looksText)) {
      res.send(redactor.redact(buf.toString("utf8")));
    } else {
      res.send(result.data);
    }
  } catch (e) {
    failWith(res, e);
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
    // Read-only gh needs GH_TOKEN in env (nothing persists in the box) — resolve the box owner's
    // default account so `gh pr checks` etc. work in the ask lane too. Best-effort.
    const creds = await withOwner(ownerOf(db, session) ?? null, () => resolveCredsForBox(cfg, session)).catch(() => undefined);
    const [result, driverState] = await Promise.all([
      askInBox(cfg, session, question, { newThread: !!newThread, ghToken: creds?.primaryToken }),
      driverStateLine(cfg, session),
    ]);
    res.json({ ...result, ...("answer" in result && typeof result.answer === "string" ? { answer: redactor.redact(result.answer) } : {}), driverState: driverState ? redactor.redact(driverState) : driverState });
  } catch (e) {
    failWith(res, e);
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
    failWith(res, e);
  }
});

// Deliver a QUEUED message immediately: interrupt the running turn, then resume with that message.
// This exists for the stuck-turn case — the agent is polling something that will never finish (a CI
// check with no runner, a hung command) and the operator's correction sits in the inbox forever.
// The message is taken out of the inbox FIRST so it is never delivered twice; on failure it is put
// back so typed text is not lost. Other queued messages stay queued (the delivery loop sends them
// after this turn). Interrupting kills the in-box claude turn (session state is preserved — the
// resume is a normal `claude -c`), so the dashboard confirms before calling this.
app.post("/send-now.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const { session, id } = (req.body ?? {}) as { session?: string; id?: string };
  if (!session || !id) {
    res.status(400).json({ error: "session and id are required" });
    return;
  }
  const msg = inbox.list(session).find((m) => m.id === id);
  if (!msg) {
    res.status(404).json({ error: "that queued message is gone (already delivered or cancelled)" });
    return;
  }
  inbox.remove(session, id);
  try {
    await withOwner(ownerOf(db, session) ?? null, () => interruptAgentRun(cfg, session));
    await resumeQuietly(session, msg.text);
    res.json({ ok: true, queued: inbox.list(session) });
  } catch (e) {
    inbox.enqueue(session, msg.text, msg.at);
    failWith(res, e);
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
    failWith(res, e);
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
    failWith(res, e);
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
    failWith(res, e);
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
    failWith(res, e);
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
    failWith(res, e);
  }
});
// Attach a repository to a RUNNING sandbox: clone with the account that can access it, place it at
// /workspace/<name>, and tell the agent (queued, delivered at its next boundary).
app.post("/repos/attach.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const { session, repo, ref } = (req.body ?? {}) as { session?: string; repo?: string; ref?: string };
  if (!isBoxName(session) || !repo || !/^[\w.-]+\/[\w.-]+$/.test(repo.trim())) {
    res.status(400).json({ error: "session and repo (owner/name) are required" });
    return;
  }
  try {
    const r = await attachRepoToBox(cfg, session, repo.trim(), ref?.trim() || undefined);
    inbox.enqueue(session, `The repository ${repo.trim()} is now checked out at /workspace/${r.name}${ref ? ` (ref ${ref})` : ""}. Use it for the task where relevant.`);
    res.json({ ok: true, name: r.name, login: r.login });
  } catch (e) {
    failWith(res, e);
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
    failWith(res, e);
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

// Skills: the owner's reusable playbooks, synced into every box before each run/resume. Same shape
// of API as the MCP servers: one GET for the list, one POST with an action.
app.get("/skills.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  try {
    res.json({ skills: viewSkills(await loadSkillStore(cfg)) });
  } catch (e) {
    failWith(res, e);
  }
});
app.post("/skills.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    const store = await loadSkillStore(cfg);
    const action = body.action;
    if (action === "upsert") {
      const s = normalizeSkill(body.skill as Partial<SkillDef> & { name: string });
      // Rename: the entry moves under the new name and the old one goes.
      const previous = typeof body.previousName === "string" ? body.previousName : "";
      if (previous && previous !== s.name && store.skills[previous]) {
        s.addedAt = store.skills[previous].addedAt;
        delete store.skills[previous];
      }
      if (store.skills[s.name]) s.addedAt = store.skills[s.name].addedAt;
      store.skills[s.name] = s;
    } else if (action === "remove") {
      delete store.skills[String(body.name ?? "")];
    } else if (action === "toggle") {
      const s = store.skills[String(body.name ?? "")];
      if (s) s.enabled = body.enabled !== false;
    } else {
      res.status(400).json({ error: "unknown action" });
      return;
    }
    await saveSkillStore(cfg, store);
    res.json({ skills: viewSkills(store) });
  } catch (e) {
    res.status(400).json({ error: String((e as Error).message ?? e) });
  }
});

/**
 * Browse a public GitHub repository for importable skills. Proxied here rather than fetched from
 * the page because the SPA runs under `connect-src 'self'` — see github-skills.ts for the why.
 */
app.post("/skill-repo.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : "");
  const owner = str("owner");
  const repo = str("repo");
  try {
    if (body.action === "list") {
      res.json(await listRepoSkills(owner, repo, str("branch") || undefined, str("subpath") || undefined));
    } else if (body.action === "fetch") {
      res.json({ text: await fetchRepoFile(owner, repo, str("branch"), str("path")) });
    } else {
      res.status(400).json({ error: "unknown action" });
    }
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
    failWith(res, e);
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
    const d = await readDiff(cfg, session, path);
    res.json({ ...d, ...("diff" in d && typeof d.diff === "string" ? { diff: redactor.redact(d.diff) } : {}), ...("original" in d && typeof d.original === "string" ? { original: redactor.redact(d.original) } : {}) });
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
    // `repo` is quoted rather than relied on to be metacharacter-free: the validating regex above
    // and this interpolation are far apart, and only one of them has to loosen for the other to
    // become a remote shell.
    const r = await execInBox(cfg, session, `gh pr merge ${Number(number)} --repo ${shellQuote(repo)} --merge 2>&1`);
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
    failWith(res, e);
  }
});

// Keep (pin) a sandbox: it still sleeps like any other, but is never reaped — only Destroy removes it.
app.post("/keep.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const { session, keep } = (req.body ?? {}) as { session?: string; keep?: boolean };
  if (!isBoxName(session)) {
    res.status(400).json({ error: "session is required" });
    return;
  }
  try {
    // Only a box we know about: a marker for a name that never existed would be a stray file on the host.
    if (keep !== false && !(await readFleet()).boxes.some((b) => b.name === session)) {
      res.status(404).json({ error: "no such machine" });
      return;
    }
    if (keep === false) await unmarkKept(cfg, session);
    else await markKept(cfg, session);
    res.json({ ok: true, kept: keep !== false });
  } catch (e) {
    failWith(res, e);
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
// Name a run from its first message via the in-box helper. Idempotent; sleeping boxes are skipped.
app.post("/title.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const { session } = (req.body ?? {}) as { session?: string };
  if (!session || !/^[\w.-]+$/.test(session)) {
    res.status(400).json({ error: "session is required" });
    return;
  }
  try {
    const existing = (await loadTitles(cfg))[session];
    if (existing) {
      res.json({ title: existing });
      return;
    }
    const box = (await readFleet()).boxes.find((b) => b.name === session);
    if (!box?.task) {
      res.json({});
      return;
    }
    res.json({ title: await generateTitle(cfg, session, box.task) });
  } catch (e) {
    failWith(res, e);
  }
});

// Rename a run. The generated title is a guess; the operator's word replaces it everywhere.
app.post("/rename.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const { session, title } = (req.body ?? {}) as { session?: string; title?: string };
  if (!session || !/^[\w.-]+$/.test(session)) {
    res.status(400).json({ error: "session is required" });
    return;
  }
  const clean = cleanTitle(String(title ?? ""));
  if (!clean) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  try {
    await saveTitle(cfg, session, clean);
    res.json({ title: clean });
  } catch (e) {
    failWith(res, e);
  }
});

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
    failWith(res, e);
  }
});

// Put a sandbox to sleep on demand — `msb stop`, no remove. The workspace and the agent's session
// persist exactly as with the idle timeout; opening the thread (or a reply) wakes it again.
app.post("/sleep.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const { session } = (req.body ?? {}) as { session?: string };
  if (!session || !/^[\w.-]+$/.test(session)) {
    res.status(400).json({ error: "session is required" });
    return;
  }
  try {
    await stopBox(cfg, session);
    noteStopped(session);
    watchHub.drop(session); // the cached "running" snapshot must not be served as live
    res.json({ ok: true });
  } catch (e) {
    failWith(res, e);
  }
});

// Source control for one cloned repo, from the workspace pane: status / commit-all / push.
app.post("/git.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const { session, repo, action, message } = (req.body ?? {}) as { session?: string; repo?: string; action?: string; message?: string };
  if (!session || !/^[\w.-]+$/.test(session) || !repo) {
    res.status(400).json({ error: "session and repo are required" });
    return;
  }
  try {
    if (action === "status") res.json(await gitStatus(cfg, session, repo));
    else if (action === "commit") res.json(await gitCommitAll(cfg, session, repo, String(message ?? "")));
    else if (action === "push") res.json({ output: redactor.redact((await gitPush(cfg, session, repo)).output) });
    else res.status(400).json({ error: "action must be status | commit | push" });
  } catch (e) {
    res.status(422).json({ error: redactor.redact(String((e as Error).message ?? e).slice(-500)) });
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
    failWith(res, e);
  }
});

// Write one text file under /workspace (the explorer's editor). Path-confined like /artifact; the
// body travels base64 so no byte can escape the shell quoting. Size-capped at 2 MB.
app.put("/file.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const { session, path, content, encoding } = (req.body ?? {}) as { session?: string; path?: string; content?: string; encoding?: string };
  if (!session || !/^[\w.-]+$/.test(session) || typeof path !== "string" || typeof content !== "string") {
    res.status(400).json({ error: "session, path and content are required" });
    return;
  }
  // Text edits cap at 2 MB; base64 uploads (images pasted into the composer) at ~8 MB decoded.
  const isB64 = encoding === "base64";
  if ((!isB64 && content.length > 2_000_000) || (isB64 && content.length > 11_000_000)) {
    res.status(413).json({ error: isB64 ? "image too large (8 MB cap)" : "file too large to edit here (2 MB cap)" });
    return;
  }
  const safe = safeWorkspacePath(path);
  if (!safe.ok) {
    res.status(400).json({ error: safe.message });
    return;
  }
  try {
    const b64 = isB64 ? content.replace(/^data:[^,]*,/, "") : Buffer.from(content, "utf8").toString("base64");
    if (isB64 && !/^[A-Za-z0-9+/=\s]*$/.test(b64)) {
      res.status(400).json({ error: "content is not valid base64" });
      return;
    }
    const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
    const abs = `/workspace/${safe.relPath}`;
    const dir = abs.slice(0, abs.lastIndexOf("/"));
    // The body streams over stdin: argv would overflow (E2BIG) on anything larger than an icon.
    await execWithInput(cfg, session, `mkdir -p ${q(dir)} && base64 -d > ${q(abs)} && wc -c < ${q(abs)}`, b64);
    res.json({ ok: true, path: safe.relPath, bytes: isB64 ? Buffer.from(b64, "base64").length : Buffer.byteLength(content, "utf8") });
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
    failWith(res, e);
  }
});

app.post("/teardown.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const { session } = (req.body ?? {}) as { session?: string };
  if (!isBoxName(session)) {
    res.status(400).json({ error: "session is required" });
    return;
  }
  try {
    await deps.teardown(cfg, session);
    watchHub.drop(session);
    inbox.clear(session);
    void forgetTitle(cfg, session).catch(() => {});
    res.json({ ok: true });
  } catch (e) {
    failWith(res, e);
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
    const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
    if (typeof body.repo === "string" && !REPO_RE.test(body.repo.trim().replace(/\.git$/i, ""))) {
      res.status(400).json({ error: "repo must be owner/name" });
      return;
    }
    const explicit = Array.isArray(body.repos)
      ? (body.repos as Array<{ repo?: string; ref?: string }>)
          .filter((r) => r && typeof r.repo === "string" && REPO_RE.test(r.repo.trim().replace(/\.git$/i, "")))
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
    // Images attached in the composer: named now so the task can reference them; staged by the flow.
    const rawAtt = Array.isArray(body.attachments) ? (body.attachments as Array<{ name?: string; dataUrl?: string }>) : [];
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    const attachments = rawAtt
      .filter((a) => typeof a.dataUrl === "string" && a.dataUrl.length < 11_000_000)
      .slice(0, 8)
      .map((a, i) => ({ path: `.attachments/${stamp}-${i + 1}-${String(a.name ?? "image.png").replace(/[^\w.-]+/g, "-").slice(0, 60)}`, base64: a.dataUrl! }));
    const task = attachments.length
      ? `${body.task}\n\nAttached ${attachments.length === 1 ? "image" : "images"} (open with the Read tool):\n${attachments.map((a) => `- /workspace/${a.path}`).join("\n")}`
      : body.task;
    if (ownership.isUser()) {
      ownership.assertCanRun();
      const p = principalOf(res);
      const max = (p.kind === "user" && getUser(db, p.userId)?.max_boxes) || cfg.userMaxBoxes;
      ownership.assertQuota(ownership.liveOwned((await readFleet()).boxes), max);
    }
    const result = await runDelegateFlow(cfg, deps, {
      attachments: attachments.length ? attachments : undefined,
      // A browser has no local tree to ship: git only. (`source:"local"` would rsync a controller-host path.)
      source: "git",
      repo: typeof body.repo === "string" ? body.repo : undefined,
      repos: repos.length ? repos : undefined,
      task,
      ref: typeof body.ref === "string" ? body.ref : undefined,
      githubToken: typeof body.githubToken === "string" ? body.githubToken : undefined,
      githubAccount: typeof body.githubAccount === "string" ? body.githubAccount : undefined,
    });
    if (result.ok) void generateTitle(cfg, result.box, task).catch(() => {});
    res.json(inferred.length ? { ...result, inferred } : result);
  } catch (e) {
    failWith(res, e);
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
