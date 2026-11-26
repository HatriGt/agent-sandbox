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
import { assertPrOnlyPush, guardOrStop, installPrOnlyGuard } from "./pr-only.js";
import express, { type Request, type Response } from "express";
import compression from "compression";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isDeadSession } from "./mcp-session.js";
import { loadDotEnv } from "./dotenv.js";
import { configuredImage, loadConfig, type Config } from "./config.js";
import { registerTools } from "./handlers.js";
import { makeBridge } from "./server-bridge.js";
import { deps as rawDeps, resolveCredsForBox, detectSetupInBox } from "./deps.js";
import { SETUP_SENTINEL, parseSentinel, type SetupProfile } from "./setup-profile.js";
import { addManualNote, deleteNote, exportMemoryMarkdown, getNote, importMemoryMarkdown, forgetEpisode, loadMemoryStore, noteHistory, playbookToSkill, recordEpisode, saveMemoryStore, updateNote, viewMemory, type MemoryNote, type MemoryReceipt, type MemoryStore } from "./memory-store.js";
import { MemoryHarvester } from "./memory-harvest.js";
import { deleteSetup, getSetup, listSetups, recordLearned, repoKey, repoSlugFromUrl, saveSetup } from "./setup-store.js";
import { kickRefill, refillPool, startPoolMaintainer } from "./pool.js";
import { forgetOwnerAgent, noteOwnerActive } from "./warm-owners.js";
import { checkBearer } from "./http-auth.js";
import { clientOf, makeAuthThrottle, makeRateLimiter } from "./auth-throttle.js";
import { auditFields, formatAudit, listAuditEvents, MUTATING, pruneAuditEvents } from "./audit.js";
import { openDb } from "./db.js";
import {
  API_KEY_PREFIX, clearSessionCookie, consumeLoginState, createApiKey, createSession, csrfOk, deleteSession, getUser, listApiKeys, newLoginState, parseCookies,
  principalFromApiKey, principalFromSession, revokeApiKey, SESSION_COOKIE, sessionCookie, upsertGithubUser, mayAccess, type Principal,
} from "./identity.js";
import { githubAuthorizeUrl, githubExchangeCode, githubIdentity } from "./github-oauth.js";
import { keyFromEnvOrFile, makeSecretBox } from "./secretbox.js";
import { allBlobs, loadBlob, ownerKey, registerSharedOwners, registerUserStoreBackend, saveBlob, withOwner, OPERATOR_OWNER } from "./user-store.js";
import { addMembers, canManage, createOrg, deleteOrg, followNote, followServer, followSkill, getOrg, leaveOrg, listMembers, orgRole, orgsOf, removeMember, renameOrg, searchUsersByLogin, setMemberRole, sharedOrgIds, transferOrg, type OrgRole, type PersonHit } from "./orgs.js";
import { detectTransitions, formatNotification, makeNotifier, shouldNotify, toggleFor, type BoxRunView, type NotifyEvent } from "./notify.js";
import { StartFailureStreak, isStartFailure, logTail, startFailureAlertText } from "./run-health.js";
import { CANARY_TASK, canaryAlertText, canaryVerdict, isCanaryTask, makeCanary, type CanaryResult } from "./canary.js";
import { hostDiskAlarmed, hostDiskAlertText, type DiskReading } from "./host-disk.js";
import { configureHostPool, makeHostPool, placeRun } from "./host-pool.js";
import { createBox, claudeRootSource, teardown as msbTeardown } from "./msb.js";
import { harvestCodeModeKnowledge, mcpModeFromNotes, type McpModeNote } from "./msb.js";
import { markClaimed } from "./claims.js";
import { RESCUE_MAX_MB, capturedTurn, listRescues, moveSeam, pullRescue, pushRescue, readRescue, rescueBoxes, stampRescueKept, summarize, sweepRescues } from "./rescue.js";
import { KeptBoxError } from "./msb.js";
import { getThread, listThreads, markThreadDeleted, readTranscript, removeTranscript, syncTranscript, threadFromBox, threadRunMetas, threadViews, upsertThread, noteAbsentThreads, noteDormantThreads } from "./threads.js";
import { closeSshMasters } from "./ssh.js";
import { PRIMARY_HOST_ID, boxHostOf, slugify as hostSlug } from "./hosts.js";
import { attentionHoldMs } from "./host-sleep.js";
import { listProviders, providerFor } from "./host-providers.js";
import { prepareCuresCheck, prepareStatus, startPrepare } from "./host-prepare.js";
import { sweepHosts } from "./host-sweep.js";
import { countBoxes as countBoxesOnHost } from "./msb.js";
import { BAKED_MCP_PACKAGES, BASE_PACKAGES, fetchLatestVersions, imageChanges, packageNameOf, provisionOf, rebakeDueText, type Outdated } from "./package-watch.js";
import { clearImageOverride, makeImageUpdater, planImageUpdate, writeImageOverride } from "./image-update.js";
import { browserFastMissed, browserFastSh, browserStubScript, makeBoxQueue, moliInstallSh, parseBrowserAction, parseBrowserReply } from "./browser.js";
import { bakeAgentImage, hostDisk, mcpProvisionState, sweepOrphanSandboxDirs } from "./msb.js";
import { claimNonce, mintNonce, questionChoices, releaseNonce } from "./answer-choice.js";
import { buildPushMessages, deviceCount, listDeviceTokens, makeOwnerRateCap, pruneToken, registerDevice, sendExpoPush, unregisterDevice } from "./push.js";
import { fetchPinned } from "./net-guard.js";
import { buildDigest, type RunDigest } from "./digest.js";
import { buildOutcome, outcomeOf, resolveFollowedBy, type RunOutcome } from "./outcome.js";
import { archiveRun, deleteRun, getDigest, getRun, listActivity, listRuns, pruneArchive, ledgerTotals, listLedger, type LedgerFilter } from "./run-archive.js";
import { autoRetryOf, makeVerifyRetrier, verifyPlanOf, type VerifyPlan, type VerifyResult } from "./verify.js";
import { parseTrace, resizeContinueMessage } from "./trace.js";
import { loadNotifySettings, normalizeNotifySettings, saveNotifySettings } from "./notify-store.js";
import { AGENT_KINDS, AGENT_LABELS, isAgentKind, loadAgentPrefs, normalizeAgentPrefs, saveAgentPrefs } from "./agent-kind.js";
import { absorbKnowledge } from "./code-mode/knowledge.js";
import { assertSelectable, driverFor, listDrivers } from "./drivers/index.js";
import { isCompactCommand } from "./drivers/sentinels.js";
import {
  allProviderSecrets,
  CLI_LOGIN_POLICY,
  deleteProvider,
  driversFor,
  getProvider,
  loadProviders,
  PROVIDER_KINDS,
  PROVIDER_LABELS,
  refreshModels,
  upsertProvider,
  viewOf,
} from "./providers.js";
import { requestSessions, boxParam, createLocalUser, deleteUser, listUsers, ownerOf, setUserRole, validateSignup, createPasswordUser, authenticatePassword, setPassword, updateProfile, verifyPassword, PASSWORD_MIN, listSessions, revokeSession, revokeOtherSessions, startTrial, planOf, setPlan, TrialExpiredError, taskHeadOf } from "./identity.js";
import { parseStore } from "./gh-token-store.js";
import { seedStarterSkills } from "./starter-skills.js";
import { parseMcpStore } from "./mcp-store.js";
import { currentPrincipal, guardDeps, makeOwnership, NotOwnedError, QuotaError, withPrincipal } from "./tenancy.js";
import { allowShellScripts, securityHeaders } from "./security-headers.js";
import { gatherMonitor, gatherWatch, readAgentLogFull, askInBox, driverStateLine, startBoxIfStopped, noteRunning, wokenAtOf, stopBox, noteStopped, interruptAgentRun, mirrorInboxMessage, unmirrorInboxMessage, takeDeliveredInbox, setBoxMemory, isMemoryTier, MEMORY_TIERS, setBoxDisk, isDiskTier, DISK_TIERS, msbIo, pauseRunForResize, type MemoryTier, type DiskTier } from "./msb.js";
import { isBoxName } from "./sync.js";
import { run as runCmd, shellQuote, sshLaneFront } from "./exec.js";
import { touchClaimed, markParked } from "./claims.js";
import { reapVerdicts, groupByHost, asleepSecOf } from "./sleep-reaper.js";
import { askParkEnabled, askParkGraceMs, askParkTtlSec, parkWaitingBox, shouldPark } from "./snapshot.js";
import { safeWorkspacePath } from "./artifact.js";
import { gitStatus, gitCommitAll, gitPush } from "./git-ops.js";
import { loadTitles, generateTitle, forgetTitle, saveTitle, cleanTitle } from "./titles.js";
import { runDelegateFlow } from "./delegate-flow.js";
import { sseFrame, streamWatch } from "./watch-sse.js";
import { LaunchRegistry, isLaunchId, type LaunchReporter } from "./launch-progress.js";
import { WatchHub } from "./watch-hub.js";
import { makeFleetReader } from "./fleet.js";
import { Inbox, startInboxDelivery } from "./inbox.js";
import { makeCredentialBroker } from "./broker.js";
import { FILE_INDEX_CAP, fileDetailsCommand, makeFileIndex, parseFileDetails, parseSearchOutput, searchCommand, searchExitStatus, searchStderr } from "./files.js";
import { confineFsOp, exitCodeOf, fsCommand, fsFailure } from "./fs-ops.js";
import { canRevert, captureCmd, checkpointForMessage, listCmd, parseCkptLs, revertCmd, withBoxLock } from "./checkpoint.js";
import { fetchModels, isAllowedModel } from "./models.js";
import { execInBox, boxRepoSlugs, forgetMemoryReceipt, learnHostGuard, memoryReceiptOf, reapStoreBuilders } from "./msb.js";
import { loadStore, saveStore, pickDefaultAccount, upsertAccount, removeAccount, setDefaultAccount } from "./gh-token-store.js";
import { probeToken } from "./gh-probe.js";
import { viewAccounts, deviceStart, devicePoll } from "./accounts.js";
import { makeRepoLister, fetchGithubRepos, matchRepos, inferRepos, attachRepoToBox } from "./repos.js";
import { loadMcpStore, saveMcpStore, normalizeServer, parseMcpImport, viewServers, toEditableConfig, replaceFromJson, mergeSecrets, type McpServer as McpServerDef } from "./mcp-store.js";
import { loadSkillStore, saveSkillStore, normalizeSkill, viewSkills, editedSinceImport, type SkillDef } from "./skill-store.js";
import { listRepoSkills, fetchRepoFileWithSource, fetchRepoSkillDir, resolveSkillRepoToken, checkSkillSources, fetchSkillUpdate } from "./github-skills.js";
import { listClaims, listKept, markKept, unmarkKept } from "./claims.js";
import { makeRedactor, isPlumbingError } from "./redact.js";
import { isSecretKey, probeMcpServer, boxSecretPolicy, boxExclusion } from "./mcp-store.js";
import { parseDurationSec, type BoxView, type WatchSnapshot } from "./monitor.js";
import { quietSinceSec, shouldNap } from "./nap.js";
import { listChanges, readDiff, readFullDiff, discardChange, fetchPull, fetchPullDetail, forgetPull } from "./changes.js";
import { loadRunMetas, saveRunMeta, forgetRunMeta, forgetRunMetas, loadRunMetasLocal, saveRunMetaLocal, forgetRunMetaLocal, type RunMeta } from "./run-memory.js";
import { contentDisposition, readArtifact } from "./artifact.js";
import { existsSync, readFileSync } from "node:fs";
import { withStartedBy, currentStartedBy, recordStartedBy, startedByOf, type StartedBy } from "./started-by.js";
import { makeDispatcher, type StartRunInput } from "./trigger-dispatch.js";
import { GhRateLimitError, makeRepoWatcher, rateInfoOf } from "./repo-watch.js";
import { makeMentionWatcher } from "./agent-mentions.js";
import { makeFollowupEngine, type GhRequest } from "./pr-followup-engine.js";
import { registerFollowupRoutes } from "./pr-followup-routes.js";
import { followupsForBox } from "./pr-followup-store.js";
import { followupLine, normalizePrefs, type FollowupPrefs } from "./pr-followups.js";
import { registerTriggerRoutes } from "./trigger-routes.js";
import { hookAuditPath, hookBodyParser } from "./hooks.js";
import { createTrigger, firstSighting, getTriggerById, listTriggers, logDelivery, pruneDeliveries, type TriggerRow } from "./trigger-store.js";
import { automateNeedsApproval, isQuietRun, parseAutomate, parseAutomateRejects, type AutomateReject } from "./triggers.js";
import { registerIntakeRoutes } from "./intake-routes.js";
import { candidateAccounts, ownerOf as repoOwnerOf } from "./gh-token-store.js";
import { applyHarness, getHarness, harnessSummaryLine, loadHarnesses, normalizeEgress, putHarness, HARNESS_LIMITS, type HarnessDef } from "./harness.js";
import { allSecretValues, deleteSecret, listSecrets, resolveSecrets, saveSecret, secretName } from "./secrets-store.js";
import { reservedBoxes } from "./capacity.js";
import { archivedDigestOf, checkCompareSide, recordRunHarness, runHarnessOf, skillPickBackend, skillSelectionBackend } from "./harness-runs.js";
import { registerSkillPickBackend, skillPicksOf, type SkillPick } from "./skill-match.js";
import { defaultAttemptSpecs, getGroup, groupOfBox, listGroups, makeAttempts, normalizeAttempts, OVERRIDE_WINDOW_MS, specLabel, tieChoices, type AttemptGroup, type AttemptSpec } from "./attempts.js";
import { registerHarnessRoutes } from "./harness-routes.js";
import { registerWorkflowRoutes } from "./workflow-routes.js";
import { makeWorkflowEngine } from "./workflow-engine.js";
import { firstTask, getWorkflow, type WorkflowDef } from "./workflow.js";
import { registerSkillSelectionBackend } from "./skill-store.js";
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
// The box hosts (src/host-pool.ts): the .env host plus any added from the dashboard. Every
// box-scoped call below goes through hcfg(box) so it lands on the host the box lives on; the timed
// loops ask the pool before touching a host, and each host has its own sleep clock.
const hostPool = configureHostPool(
  makeHostPool(cfg, db, {
    log: (m) => console.error(m),
    quiesce: (c) => closeSshMasters(c.vpsSsh).then(() => new Promise<void>((r) => setTimeout(r, 1_500))),
    probe: async (c) => {
      // Front of the host's ssh lane: the probe is what makes a woken host "answer", and behind a
      // sweep's commands through the proxy it ran out of its cap (src/exec.ts, sshLaneFront).
      const [live, disk] = await sshLaneFront(() => Promise.all([countBoxesOnHost(c), hostDisk(c).catch(() => undefined)]));
      return `${live} live box(es)${disk ? `, disk ${disk.usedPct}% used` : ""}`;
    },
  })
);
// A box the pool cannot place (its box_hosts row lost, its host paused so no listing names it) is
// placed by its thread row: the thread remembers the host it ran on. Without this, every command
// for such a box went to the primary host, and a Destroy answered "ok" with nothing removed (seen
// live 2026-11-19 on two boxes of a paused Freestyle host).
/**
 * The operator is using this box's thread (opened it, woke it, replied): its host is held awake for
 * the provider's attention span (attentionHoldMs), whatever the sweeps read meanwhile. A sweep that
 * times out right after a resume reads "nothing working", and the clock used to pause the host
 * under the reader.
 */
const attend = (box: string, reason: string): void => {
  const h = hostPool.get(hcfg(box).hostId ?? PRIMARY_HOST_ID);
  if (!h) return;
  const ms = attentionHoldMs(providerFor(h.spec).attentionMs);
  if (ms) h.sleep.hold(ms, reason);
};
const hcfg = (box: string): Config => {
  if (!hostPool.hostOfBox(box)) {
    const th = getThread(db, box)?.host;
    if (th && hostPool.get(th)) hostPool.rememberBox(box, th);
  }
  return hostPool.cfgForBox(box);
};
// The primary host's sleep clock, for the health payload and the loops that go quiet when every host does.
const hostSleep = {
  get enabled() {
    return hostPool.primary().sleep.enabled;
  },
  asleep: () => hostPool.allAsleep(),
  state: () => hostPool.primary().sleep.state(),
};
if (hostSleep.enabled) console.error(`[host-sleep] on: the host is left to pause after ${Math.round(cfg.hostSleepAfterMs / 60_000)}m without an agent working`);
{
  const n = hostPool.hosts().length;
  if (n > 1) console.error(`[hosts] ${n} box hosts: ${hostPool.state().map((h) => `${h.id} (${h.provider}, priority ${h.priority}${h.enabled ? "" : ", disabled"})`).join(", ")}`);
}
// Integrations (GitHub accounts, MCP servers) are per owner and encrypted at rest from here on. The
// operator's row is seeded from the legacy shared files on first read.
const secretBox = makeSecretBox(keyFromEnvOrFile(process.env.SECRETS_KEY, cfg.dataDir));
registerUserStoreBackend({ db, box: secretBox });
// Organisations (src/orgs.ts): whose stores a member's runs merge in. Resolved per install, so a
// new invite reaches the member's very next turn.
registerSharedOwners((owner) => sharedOrgIds(db, owner));
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
  (req.path.startsWith("/hooks/")
    ? hookBodyParser // raw bytes, capped (src/hooks.ts): the vendor HMAC is over the exact body
    : req.path === "/file.json" || req.path === "/delegate.json"
    ? jsonLarge
    : req.path === "/mcp" || req.path.startsWith("/mcp/") || req.path === "/skills.json"
    ? jsonMcp // a multi-file skill upsert (scripts + docs) can be a few MB
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
/** Routes whose `box` may be gone from the fleet (archived runs): owner-scoped by their own queries. */
const ARCHIVED_BOX_ROUTES: Record<string, true> = { "/history/outcome.json": true, "/attempt-groups.json": true, "/questions/answer.json": true, "/triggers/for-box.json": true };
app.use((req: Request, res: Response, next) => {
  const p = resolvePrincipal(req);
  res.locals.principal = p;
  const isMcpPath = req.path === "/mcp" || req.path.startsWith("/mcp/");
  // A `box` (or, from older clients, `session`) on any non-MCP route names a box, and a box name
  // becomes a directory name and a shell word downstream. Routes validated it individually and
  // inconsistently: isBoxName on four, an ad-hoc /^[\w.-]+$/ on four more (which accepts "." and
  // ".." — exactly what isBoxName exists to reject), and nothing at all on /tree.json, /files.json,
  // /changes.json and /diff.json. One check at the edge, on the same fields the ownership check
  // below already reads, is the version that cannot drift as routes are added.
  // BOTH the body's and the query's keys are checked (requestSessions): GET routes read the query
  // even when a JSON body is present, so checking only one let {"session":""} in the body wave a
  // query-named box past the ownership check below.
  const sessions = isMcpPath ? [] : requestSessions(req.body, req.query);
  if (sessions.some((s) => !isBoxName(s))) {
    res.status(400).json({ error: "invalid session name" });
    return;
  }
  // Box-scoped JSON routes: a user may only name their own boxes. 404, not 403 — no existence oracle.
  // The archive routes name boxes whose ownership record a teardown already dropped; they scope by
  // owner in their own queries instead.
  if (p && p.kind === "user" && p.role !== "admin" && !ARCHIVED_BOX_ROUTES[req.path] && sessions.some((s) => !mayAccess(db, p, s as string))) {
    res.status(404).json({ error: "no such machine" });
    return;
  }
  if (p) withPrincipal(p, next);
  else next();
});

// Rate limit state-changing calls per caller (60/min): a runaway script or a hostile key cannot spin
// machines or hammer sign-in faster than that. Reads are unlimited; /mcp has its own transport.
const mutationLimiter = makeRateLimiter({ limit: Number(process.env.RATE_LIMIT_PER_MIN ?? "60") || 60, windowMs: 60_000 });
const BROWSER_ACT_PATH = "/browser.json";
const browserLimiter = makeRateLimiter({ limit: 600, windowMs: 60_000 });
app.use((req: Request, res: Response, next) => {
  // /hooks/ has its own per-trigger limiter (trigger-routes.ts): GitHub delivers every tenant's
  // events from a shared pool of addresses, so a per-IP anonymous cap would throttle them all together.
  if (!MUTATING.has(req.method) || req.path === "/mcp" || req.path.startsWith("/mcp/") || req.path.startsWith("/hooks/")) return next();
  const p = res.locals.principal as Principal | null;
  const key = p ? (p.kind === "user" ? p.userId : "operator") : `anon:${clientOf(req.headers, req.socket.remoteAddress)}`;
  // The browser pane sends one call per click, scroll and keystroke burst: a person reading a page
  // passes 60 a minute without trying. It gets its own, wider budget instead of the shared one.
  if (req.path === BROWSER_ACT_PATH ? browserLimiter.over(key) : mutationLimiter.over(key)) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ error: "slow down — too many requests this minute" });
    return;
  }
  next();
});

// Audit every state-changing call (not /mcp — the MCP transport has its own tool-level log lines).
app.use((req: Request, res: Response, next) => {
  // Browser actions change nothing the account owns (they move a page inside the caller's own box),
  // and a row per scroll would bury the trail the audit exists to keep readable.
  if (!MUTATING.has(req.method) || req.path === "/mcp" || req.path.startsWith("/mcp/") || req.path === BROWSER_ACT_PATH) return next();
  const started = Date.now();
  res.on("finish", () => {
    const p = res.locals.principal as Principal | null;
    const ev = {
      at: new Date(started).toISOString(),
      client: clientOf(req.headers, req.socket.remoteAddress),
      method: req.method,
      // The webhook secret is a path segment — never let it reach a log line or an audit row.
      path: hookAuditPath(req.path),
      status: res.statusCode,
      ms: Date.now() - started,
      ...auditFields(req.body, req.query),
      // A route that knows the semantic action (memory.keep, …) names it; the body's field otherwise.
      ...(typeof res.locals.auditAction === "string" ? { action: res.locals.auditAction as string } : {}),
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

// --- Stored audit trail: bounded retention + the account page's "Recent activity" ----------------
// The table grows on every mutating request; prune at startup and every ~6 h (unref'd — never keeps
// the process alive). Retention is AUDIT_MAX_AGE_DAYS in src/audit.ts.
try {
  pruneAuditEvents(db);
} catch {
  /* pruning must never block startup */
}
setInterval(() => {
  try {
    pruneAuditEvents(db);
  } catch {
    /* retry next tick */
  }
}, 6 * 3600 * 1000).unref();

// Run history retention (src/run-archive.ts): 500 rows/owner or 90 days. Same cadence, same rule —
// pruning must never block startup or keep the process alive.
try {
  pruneArchive(db);
} catch {
  /* retry on the interval */
}
setInterval(() => {
  try {
    pruneArchive(db);
  } catch {
    /* retry next tick */
  }
}, 6 * 3600 * 1000).unref();

// Raw stored events, reverse-chron. A user sees only their own rows; operator/admin see everything
// and may scope with ?user=<id>. `?limit=` (≤100, default 50) and `?before=<at>` page backwards.
// The server stays raw and honest — the dashboard turns method+path into human verbs.
app.get("/audit.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const p = principalOf(res);
  const admin = p.kind === "operator" || p.role === "admin";
  const q = req.query as Record<string, unknown>;
  const limit = typeof q.limit === "string" ? Number(q.limit) : undefined;
  const before = typeof q.before === "string" ? q.before : undefined;
  // `at` is not unique (a burst of requests shares a millisecond), so the cursor carries the row id
  // as a tiebreaker — see listAuditEvents. The client echoes back both from its last row.
  const beforeId = typeof q.beforeId === "string" ? Number(q.beforeId) : undefined;
  const userId = admin ? (typeof q.user === "string" && q.user ? q.user : undefined) : (p as { userId: string }).userId;
  res.json({
    events: listAuditEvents(db, {
      userId,
      ...(Number.isFinite(limit) ? { limit } : {}),
      before,
      ...(Number.isInteger(beforeId) ? { beforeId } : {}),
    }).map((e) => ({
      id: e.id, at: e.at, method: e.method, path: e.path, status: e.status, session: e.session, action: e.action, client: e.client,
    })),
  });
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
    out.push(...allProviderSecrets());
    for (const raw of allBlobs("mcp"))
      for (const s of Object.values(parseMcpStore(raw).servers)) for (const m of [s.env, s.headers]) for (const [k, v] of Object.entries(m ?? {})) if (isSecretKey(k)) out.push(v);
  } catch {
    /* same */
  }
  if (cfg.npmToken) out.push(cfg.npmToken);
  out.push(...allSecretValues(db, secretBox));
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
// Memory v2 incremental harvest (src/memory-harvest.ts). It reads the REDACTED log the hub serves,
// so a secret that leaked into the log can never become a note. Load→mutate→save runs synchronously
// (no await in between), so it cannot interleave with a route's locked read-modify-write.
const memoryHarvester = new MemoryHarvester({ load: (owner) => loadMemoryStore(owner), save: (store, owner) => saveMemoryStore(store, owner) });
// The box's repo slugs for scoping notes mid-run, probed once per box (the same origin-remote probe
// installMemory uses). A repo attached later files under the operator until the finish edge, which
// re-reads the repos from the setup collector.
const boxRepoCache = new Map<string, Promise<string[]>>();
const reposOfBox = (box: string): Promise<string[]> => {
  let p = boxRepoCache.get(box);
  if (!p) {
    p = boxRepoSlugs(hcfg(box), box).catch(() => {
      boxRepoCache.delete(box);
      return [];
    });
    boxRepoCache.set(box, p);
  }
  return p;
};
/** Harvest a box's log into its owner's memory (idempotent per box); see MemoryHarvester.harvest. */
const harvestMemory = (box: string, owner: string, log: string, repos: string[], opts: { questions?: Array<{ question: string; answer?: string }>; force?: boolean } = {}) =>
  memoryHarvester.harvest(box, owner, log, repos, opts);
const withMemoryNew = (snap: WatchSnapshot, box: string): WatchSnapshot => {
  const memoryNew = memoryHarvester.memoryNew(box);
  return memoryNew ? { ...snap, memoryNew } : snap;
};
// What each dashboard launch is doing, from the POST to the agent's first words (src/launch-progress.ts).
const launches = new LaunchRegistry();

/**
 * A box that is asleep or gone cannot be asked for its transcript: the controller's copy
 * (src/threads.ts) answers instead, with the thread row's state, so the page reads the same.
 */
const withStoredTranscript = async (s: string, snap: WatchSnapshot): Promise<WatchSnapshot> => {
  if (snap.boxStatus === "running") return snap;
  const text = await readTranscript(cfg, s).catch(() => null);
  if (text === null || text.length <= snap.log.length) return snap;
  const row = getThread(db, s);
  return {
    ...snap,
    log: redactor.redact(text),
    logTruncated: false,
    ...(row ? { runState: row.run_state, exitCode: row.exit_code ?? undefined, question: row.question ?? undefined, task: snap.task ?? row.task ?? undefined, agent: snap.agent ?? row.agent ?? undefined } : {}),
    ...(snap.boxStatus === "missing" && row ? { boxStatus: "absent" } : {}),
  };
};
const watchHub = new WatchHub({
  // A box on a paused host is not asked (the SSH fails at the gateway, or starts a Freestyle
  // resume nobody wanted): it reads asleep, with the stored transcript and the thread row's
  // state, the way an Away thread does. Seen live 2026-11-19: with no snapshot to park, three
  // failed reads answered the thread page "could not read" for as long as the host stayed paused.
  read: async (s) => {
    const dormant = hostPool.dormant(hostPool.hostOfBox(s) ?? PRIMARY_HOST_ID);
    const snap: WatchSnapshot = dormant ? { name: s, boxStatus: "stopped", runState: "idle", log: "" } : redactSnap(await gatherWatch(hcfg(s), s, undefined, { metrics: false }));
    return withMemoryNew(await withStoredTranscript(s, snap), s);
  },
  // A thread open on a box whose host is asleep or paused is served its last snapshot: an SSH would
  // hang on the proxy, and on a Freestyle VM it would start a resume nobody asked for.
  skip: (s) => hostPool.dormant(hostPool.hostOfBox(s) ?? PRIMARY_HOST_ID),
  // The live thread's first frame of a long run: the whole log, not the tail window (readFull).
  readLog: async (s) => {
    const live = await readAgentLogFull(hcfg(s), s).catch(() => "");
    return redactor.redact(live || ((await readTranscript(cfg, s).catch(() => null)) ?? ""));
  },
});
// The dashboard's fleet read: gatherMonitor behind a short shared cache, plus lifecycle config and
// sleeping (Stopped-but-resumable) boxes merged from memory.
// Follow-ups typed while the agent is mid-turn wait here and are delivered when the run finishes.
// Backed by sqlite so a controller restart keeps the queue (hydrated messages just re-queue).
const inbox = new Inbox(db);
// Detached: kicks the run and returns; the transcript streams. (deps.resume would block up to
// WAIT_TIMEOUT_MS for the agent's next boundary — fine for an MCP tool call, wrong for a chat send.)
// Per-box sticky model (Cursor semantics: a pick holds until changed). In-memory: a controller
// restart falls back to the default, and the thread's "session started (model …)" lines keep the
// historical truth regardless.
const boxModels = new Map<string, string>();
// The provider label a dashboard thread started on, for receipt provenance (same lifetime as boxModels).
const boxProviders = new Map<string, string>();
// Verified outcomes for dashboard runs: a browser delegate returns before the run finishes, so the
// clause waits here and runs on the done edge of the fleet sweep; the result feeds /digest.json and
// the done notification. In-memory like boxModels — a restart drops the pending clause (visible,
// not silent: the digest simply carries no verified stamp), never a queued answer.
const boxVerify = new Map<string, VerifyPlan>();
const boxVerified = new Map<string, VerifyResult>();
// Done means verified: a harness run whose verification failed is sent back with the failure
// (harness rule autoRetry, src/verify.ts). The budget is per box, in memory like boxVerify; the
// retrier is built below resumeQuietly, which it needs.
let verifyRetrier: ReturnType<typeof makeVerifyRetrier> | undefined;
/** The digest's `retries` for a box (0 when it was never sent back). */
const retriesOf = (box: string) => verifyRetrier?.retriesOf(box) ?? 0;

// Per-user box quota on EVERY delegation lane. The browser route checks it inline, but the MCP
// `delegate` tool reaches deps.runDelegation directly — without this wrapper a quota'd user could
// drive /mcp and boot boxes up to the GLOBAL cap, starving other tenants.
{
  const rawRun = deps.runDelegation.bind(deps);
  deps.runDelegation = async (c, plan, allowDomains, creds, interact) => {
    if (ownership.isUser()) {
      ownership.assertCanRun();
      const p = currentPrincipal();
      const max = (p.kind === "user" && getUser(db, p.userId)?.max_boxes) || cfg.userMaxBoxes;
      ownership.assertQuota(ownership.liveOwned((await readFleet()).boxes), max);
    }
    const r = await rawRun(c, plan, allowDomains, creds, interact);
    // How it was started: whatever lane wrapped this call (composer: manual, trigger, MCP after:),
    // else it came in over MCP. Best-effort — a provenance write must never fail a started run.
    try {
      recordStartedBy(db, r.box, currentStartedBy() ?? { kind: "mcp" });
    } catch {
      /* receipt degrades to no startedBy */
    }
    return r;
  };
}

// Per-box controller state must die with the box on EVERY teardown lane, not just /teardown.json —
// the MCP `teardown` tool goes through deps.teardown too, and without this the maps above (plus the
// watch cache and any queued inbox message for the gone box) grow for the life of the process.
{
  const rawTeardown = deps.teardown.bind(deps);
  deps.teardown = async (c, session, opts) => {
    // The host first: a Destroy while the box's VM is paused used to answer "ok" with nothing removed
    // (the SSH gate is shut for a dormant host, and stop/rm are best-effort). Waking it is the cost of
    // a removal that really happens; a host that never answers makes the teardown fail, honestly.
    await hostPool.readyForBox(session, `destroy ${session}`);
    // `force` (a deliberate Destroy of a kept box) travels through this lane too.
    await rawTeardown(c, session, opts);
    // Gone from the pool's memory of its host as well: a paused host is served from that memory.
    hostPool.forgetBox(session);
    watchHub.drop(session);
    inbox.clear(session);
    boxModels.delete(session);
    boxVerify.delete(session);
    boxVerified.delete(session);
    verifyRetrier?.forget(session);
    dispatcher.forget(session);
    memoryHarvester.forget(session);
    forgetMemoryReceipt(session);
    boxRepoCache.delete(session);
    memoryTickAt.delete(session);
  };
}

// The MCP resume lanes must hold the per-box checkpoint lock while `claude -c` launches: without it
// an MCP `resume` landing during the ~1 s turn-end tar mutates /workspace mid-capture, and the torn
// tar is ACCEPTED as a restore point (captureCmd tolerates tar exit 1 by design). The dashboard lane
// already locks in resumeQuietly; these wrappers give the tool lane the same guarantee — the lock
// covers only the launch, not deps.resume's long boundary wait. resumeQuietly below already takes
// the lock itself, so it must call the RAW functions, never these wrappers (non-reentrant lock).
const rawResume = deps.resume.bind(deps);
const rawResumeDetached = deps.resumeDetached?.bind(deps);
// ownership.check comes FIRST in both: the checkpoint runs a command inside the box (and wakes a
// sleeping one), so it must never run on a box the caller doesn't own. The wrapped raw functions
// check again; this only moves the refusal ahead of the side effects.
deps.resume = async (c, session, message, secrets, interact, model) => {
  ownership.check(session);
  await withBoxLock(session, async () => captureBeforeMessage(session).catch(() => {}));
  return rawResume(c, session, message, secrets, interact, model);
};
if (rawResumeDetached) {
  deps.resumeDetached = async (c, session, message, secrets, model) => {
    ownership.check(session);
    return withBoxLock(session, async () => {
      await captureBeforeMessage(session).catch(() => {});
      return rawResumeDetached(c, session, message, secrets, model);
    });
  };
}

/**
 * Vault secrets granted to a box's thread (src/secrets-store.ts): its harness's list plus the envVars
 * of its repos' setup profiles, resolved for the box's owner. Resumes re-exec the agent with a fresh
 * env, so every lane re-injects them; `extra` are one-shot values the caller typed (Resolve row).
 */
const grantedSecretsOf = async (box: string, extra?: Record<string, string>): Promise<Record<string, string> | undefined> => {
  const owner = ownerOf(db, box) ?? OPERATOR_OWNER;
  const link = runHarnessOf(db, box);
  const h = link?.harnessId ? getHarness(link.harnessId, owner) : undefined;
  const repos = await reposOfBox(box);
  const names = [...(h?.secrets ?? []), ...repos.flatMap((slug) => getSetup(db, owner, slug)?.envVars ?? [])];
  const out = { ...resolveSecrets(db, secretBox, owner, names), ...extra };
  return Object.keys(out).length ? out : undefined;
};

const resumeQuietly = (session: string, message: string, extraSecrets?: Record<string, string>) => {
  // A resume boots a sleeping box; forget the "stopped" memory and the cached idle snapshot at once so
  // the thread does not show it asleep (and close its stream) for the next 15 s.
  noteRunning(session);
  watchHub.drop(session);
  // A verified stamp describes ONE finish. The next turn has not been checked, so carrying the stamp
  // forward would let the digest, the archive record and the done push all claim "verified" about
  // work nobody verified. Drop it here — the one choke point every resume lane goes through.
  boxVerified.delete(session);
  // Same for the memory tally: the next finish reports what ITS turn remembered.
  memoryHarvester.resetRun(session);
  // Whoever triggers it (inbox delivery, broker, an admin), the box runs with its OWNER's integrations.
  // Behind the checkpoint lock: a follow-up landing inside the ~1 s turn-end capture waits for it
  // instead of mutating the workspace mid-tar.
  return withBoxLock(session, async () => {
    // The box's host first: a reply to a box whose VM was paused meanwhile (the host fell asleep
    // behind the question) starts the VM and waits for it, instead of dying on the first SSH.
    await hostPool.readyForBox(session, `message ${session}`);
    // The box is a holder; the thread is the thing. A reply to a thread whose box is gone (reaped,
    // crashed, removed by hand) brings the machine back from the kept copy first, then continues
    // the same agent session: nobody has to know a box died.
    if ((await startBoxIfStopped(hcfg(session), session)) === "absent") {
      if (!(await readRescue(cfg, session))) throw new Error("this machine is gone and no copy of the thread is kept");
      await bringBack(session);
    }
    // Capture fallback: a run that finished before any fleet sweep observed it running produces no
    // done EDGE, so the sweep never checkpointed the turn. Capture here, right before the new
    // message changes anything — heavy dirs are excluded, so this is ~1 s on the send path at worst.
    await captureBeforeMessage(session).catch(() => {});
    try {
      const secrets = await grantedSecretsOf(session, extraSecrets);
      const out = await withOwner(ownerOf(db, session) ?? null, () =>
        rawResumeDetached
          ? rawResumeDetached(hcfg(session), session, message, secrets, boxModels.get(session))
          : rawResume(hcfg(session), session, message, secrets, {}, boxModels.get(session)).then(() => undefined)
      );
      // The controller started this turn itself, so the next sweep that reads the box "done" is a
      // finish edge even if no sweep caught it running (see turnStarted).
      turnStarted.set(session, Date.now());
      return out;
    } catch (e) {
      // The optimistic "running" note above was wrong — the resume never happened. Roll it back and
      // drop the (now doubly wrong) cache so the fleet shows the honest stopped state immediately
      // instead of a phantom live box until the next full sweep.
      noteStopped(session);
      watchHub.drop(session);
      throw e;
    }
  });
};

/** Ensure the CURRENT turn has a checkpoint before a new message rewrites the workspace. */
const captureBeforeMessage = async (box: string): Promise<void> => {
  const snap = await watchHub.read(box);
  if (!canRevert(snap.runState)) return; // mid-turn resume (queued send-now): no consistent point to capture
  // The turn number is computed in-box from the log itself (captureCmd), so a stale snapshot here
  // can no longer mislabel the tar; idempotent when the turn is already captured.
  const r = await execInBox(hcfg(box), box, captureCmd());
  if (!/CKPT_(OK|HAVE)/.test(r.stdout)) console.error(`[ckpt] pre-message capture on ${box}: ${r.stdout.trim().slice(-200)}`);
  noteCaptured(box, r.stdout);
};

/**
 * A checkpoint was just written (or confirmed) in the box: keep a copy of it OFF the box
 * (src/rescue.ts), so the thread survives the box. Fire-and-forget, off every user-facing path;
 * a copy of the same turn already here costs one file read and no SSH.
 */
const noteCaptured = (box: string, stdout: string): void => {
  const c = capturedTurn(stdout);
  if (!c) return;
  void (async () => {
    const snap = await watchHub.read(box).catch(() => null);
    const titles = await loadTitles(hcfg(box)).catch(() => ({}) as Record<string, string>);
    await pullRescue(hcfg(box), box, c.turn, {
      owner: ownerOf(db, box) ?? null,
      hostId: hostPool.hostOfBox(box),
      agent: snap?.agent,
      task: snap?.task,
      title: titles[box],
      kept: isKeptBox(box),
    });
  })().catch(() => {});
};
/** Kept, by the last sweep's markers or the thread row (the row is on the controller, so it answers while the host is out of reach). */
const isKeptBox = (box: string): boolean => lastKept.has(box) || getThread(db, box)?.kept === 1;
let lastKept = new Set<string>();
const keptStamped = new Set<string>();
/**
 * A kept thread must have a copy off its box from the moment it is kept, not from the next turn
 * end: the keep is the user's word that this one must not be lost. Between turns the checkpoint is
 * captured (idempotent) and pulled; mid-turn the turn end does it.
 */
const ensureKeptCopy = async (box: string): Promise<void> => {
  const have = await readRescue(cfg, box).catch(() => null);
  if (have && !have.tooBig && have.kept) return;
  const snap = await watchHub.read(box).catch(() => null);
  if (snap?.runState === "running") return;
  await withFinishing(box, () => captureTurnCheckpoint(box));
};
verifyRetrier = makeVerifyRetrier({ resume: resumeQuietly, log: (m) => console.error(m) });
// Workflows ride the same quiet resume lane and the verify command lane (src/workflow-engine.ts).
const workflowEngine = makeWorkflowEngine({
  resume: resumeQuietly,
  check: (box, command) => deps.verify!(cfg, box, { mode: "command", command }),
  log: (m) => console.error(m),
});
startInboxDelivery({
  inbox,
  read: (s) => watchHub.read(s),
  resume: resumeQuietly,
  delivered: (s) => takeDeliveredInbox(hcfg(s), s),
  log: (m) => console.error(m),
});
// Credential broker: a box that pauses to ask for GitHub auth is resumed with the stored account.
const brokerConsider = makeCredentialBroker({
  defaultLogin: async () => pickDefaultAccount(await loadStore(cfg))?.login,
  resume: resumeQuietly,
  log: (m) => console.error(m),
});
/**
 * Walk-away notifications (docs/features-2026-09.md §1). detectTransitions diffs consecutive fleet
 * sweeps; the send resolves the box OWNER's webhook (their encrypted `notify` blob) with the
 * controller-level NOTIFY_WEBHOOK_URL env as the fallback, honours the per-event toggles, redacts
 * the outgoing text like every other surface, and POSTs generic JSON `{text, url, event}` with a
 * short timeout. All failures are logged and swallowed — a webhook can never break the sweep.
 */
let prevRunViews: BoxRunView[] = [];
// Boxes whose turn the controller itself started since the last sweep (a reply delivered). A turn
// shorter than one sweep interval (`date -u`, a one-line answer) went done→done between two
// sweeps and so left no finish edge: no notification, no history row, no memory notes, no
// checkpoint (seen live 2026-11-17, a 20 s reply turn on the Freestyle host). The sweep reads
// such a box as "running" in the previous view, so its next "done" is the edge it is. Keyed by
// when the turn started: only a sweep that BEGAN after that consumes the mark. A sweep already in
// flight read the box before the reply and would report the old "done" as a second finish (seen
// live: a duplicate done push one second after the reply).
const turnStarted = new Map<string, number>();
const notifyCtx = new Map<string, { title?: string; task?: string }>();
const sendNotification = async (ev: NotifyEvent): Promise<void> => {
  const owner = ownerOf(db, ev.box) ?? OPERATOR_OWNER;
  const settings = loadNotifySettings(owner);
  const url = settings.url || process.env.NOTIFY_WEBHOOK_URL || "";
  // Consume the context BEFORE the config gates: box names are unique per run, so an entry left
  // behind when notifications are unconfigured (the default) would leak forever, task text and all.
  const ctx = notifyCtx.get(ev.box) ?? {};
  notifyCtx.delete(ev.box);
  // Phone first and independent of the webhook: either channel failing never blocks the other.
  // Push has no settings — a registered phone always hears its runs; the toggles gate the webhook.
  const pushed = sendPushFor(owner, ev, ctx.title || ctx.task).catch((e) => {
    console.error(`[push] ${ev.box}/${ev.kind}: ${(e as Error).message.slice(0, 200)}`);
    throw e;
  });
  if (!url || !settings.events[toggleFor(ev.kind)]) return void (await pushed);
  // A finished run's notification carries the digest headline ("done · 3 files · 4 steps"), so the
  // push is a review-at-a-glance, not just a ping. Best-effort: a headline failure drops the
  // enrichment, never the notification.
  let headline: string | undefined;
  if (ev.kind === "done" || ev.kind === "failed") {
    headline = await watchHub
      .read(ev.box)
      .then((snap) =>
        buildDigest({ box: ev.box, task: snap.task ?? "", runState: snap.runState, exitCode: snap.exitCode, events: parseTrace(snap.log ?? ""), files: [], verified: boxVerified.get(ev.box), retries: retriesOf(ev.box) }).headline
      )
      .catch(() => undefined);
  }
  const msg = formatNotification(
    { ...ev, ...(ev.question ? { question: redactor.redact(ev.question) } : {}) },
    { publicUrl: cfg.publicUrl ?? "", title: ctx.title, task: ctx.task ? redactor.redact(ctx.task) : undefined, headline }
  );
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 5000);
  try {
    // fetchPinned re-vets the URL and pins the resolved address: stored blobs may predate the
    // stricter validation, and the send runs on the controller — SSRF/rebinding surface.
    await fetchPinned(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: msg.text, url: msg.url, event: msg.event }),
      signal: ac.signal,
    });
  } finally {
    clearTimeout(t);
  }
  await pushed.catch(() => {}); // the webhook went out; a push failure alone must not re-fire it
};
/**
 * Mobile push via the Expo service (src/push.ts). Only the owner's registered devices; the title is
 * redacted and trimmed, the body is a fixed phrase — never the question or task text on a lock screen.
 */
const pushCap = makeOwnerRateCap();
const sendPushFor = async (owner: string, ev: NotifyEvent, label: string | undefined): Promise<void> => {
  const tokens = listDeviceTokens(db, secretBox, owner);
  if (tokens.length === 0) return;
  if (!pushCap.allow(owner)) return void console.error(`[push] rate cap hit for an owner; dropped ${ev.kind}`);
  // Answer from the notification (src/answer-choice.ts): choice LABELS only, redacted, plus a
  // one-use nonce in the (never displayed) data payload. The question text itself never leaves.
  const choices = ev.kind === "waiting" ? questionChoices(ev.question) : [];
  const pushChoices = choices.length
    ? { labels: choices.map((c) => redactor.redact(c.label)), nonce: mintNonce(db, owner, ev.box, ev.question ?? "") }
    : undefined;
  await sendExpoPush(buildPushMessages(ev, tokens, label ? redactor.redact(label) : ev.box, pushChoices), {
    fetch,
    prune: (tok) => pruneToken(db, tok),
    accessToken: process.env.EXPO_ACCESS_TOKEN || undefined,
    log: (m) => console.error(m),
  });
};
/** Receipt provenance for a box: the agent mark from the snapshot, and the model only when known —
 *  the dashboard's explicit per-box pick. Not the controller default: an MCP delegate can pass its
 *  own model that this map never sees, so falling back would be a guess. */
const runProvenance = (box: string, agent: string | undefined, mcpNotes?: string[]): {
  agent?: string;
  model?: string;
  provider?: string;
  startedBy?: ReturnType<typeof startedByOf>;
  skills?: SkillPick[];
  memory?: MemoryReceipt;
  mcpMode?: McpModeNote;
} => {
  const model = boxModels.get(box);
  const provider = boxProviders.get(box);
  let startedBy: ReturnType<typeof startedByOf>;
  try {
    startedBy = startedByOf(db, box);
  } catch {
    startedBy = undefined;
  }
  // Code mode: what the install wrote (the box keeps the notes; the probe reports them). Only a
  // box whose notes say "on" or "fallback" records a mode; an older box says nothing.
  const mcpMode = mcpNotes?.some((l) => l.startsWith("code-mode: ")) ? mcpModeFromNotes(mcpNotes) : undefined;
  return {
    ...(agent ? { agent } : {}),
    ...(model ? { model } : {}),
    ...(provider ? { provider } : {}),
    ...(startedBy ? { startedBy } : {}),
    ...(mcpMode ? { mcpMode } : {}),
    ...skillPicksView(box),
    ...memoryReceiptView(box),
  };
};
/** What the run's latest turn was handed from memory ("Memory: 6 notes"); absent when nothing was. */
function memoryReceiptView(box: string): { memory?: MemoryReceipt } {
  try {
    const r = memoryReceiptOf(box, ownerOf(db, box) ?? OPERATOR_OWNER);
    return r && (r.core || r.picked || r.episodes || r.areas.length) ? { memory: r } : {};
  } catch {
    return {};
  }
}
/** The skills a run was pointed at ("Skills: fix-issue (auto)"); absent when none. */
function skillPicksView(box: string): { skills?: SkillPick[] } {
  try {
    const picks = skillPicksOf(box);
    return picks?.length ? { skills: picks } : {};
  } catch {
    return {};
  }
}
const notifier = makeNotifier({ send: sendNotification, log: (m) => console.error(m) });

/**
 * Infrastructure alerts for the OPERATOR (not a run's owner): start-failure streaks, the canary,
 * the host disk, a rebake due. The operator's webhook (or NOTIFY_WEBHOOK_URL) and their phones;
 * the per-event toggles do not apply — these say the service is failing, not that a run ended.
 * Best-effort like every notification: a failed alert is logged, never thrown into a timer.
 */
const alertOperator = async (text: string, alert: string): Promise<void> => {
  console.error(`[alert] ${alert}: ${text}`);
  const settings = loadNotifySettings(OPERATOR_OWNER);
  const url = settings.url || process.env.NOTIFY_WEBHOOK_URL || "";
  const ev: NotifyEvent = { box: "controller", kind: "failed", exitCode: 1, note: text };
  const pushed = sendPushFor(OPERATOR_OWNER, ev, "Agent Sandbox").catch((e) => console.error(`[push] alert/${alert}: ${(e as Error).message.slice(0, 200)}`));
  if (url) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 5000);
    try {
      await fetchPinned(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, url: `${(cfg.publicUrl ?? "").replace(/\/+$/, "")}/dashboard/#/sandboxes`, event: { kind: "alert", alert, box: "controller" } }),
        signal: ac.signal,
      });
    } catch (e) {
      console.error(`[alert] webhook ${alert}: ${(e as Error).message.slice(0, 200)}`);
    } finally {
      clearTimeout(t);
    }
  }
  await pushed;
};

/**
 * Runs that died before their first turn (src/run-health.ts): the fleet sweep classifies every
 * failed edge, the notification says "failed to start" with the box's last lines, and the third
 * in a row wakes the operator — the 2026-10 disk outage produced 55 of these over two weeks with
 * nothing but "failed (exit 1)" to show for them.
 */
const startFailures = new StartFailureStreak();

/**
 * Run history archive (docs/roadmap-saas.md #7). Archive a finished run as a digest-shaped record.
 * The done/failed edge of the fleet sweep is the natural moment: the box is still running there, so
 * listChanges can capture the file list — at teardown a stopped box can't answer it. Redaction: the
 * hub snapshot's log/task/question are already redacted by its reader (redactSnap), so everything
 * the digest derives — and therefore everything archived — is redacted at archive time; /history.json
 * can serve rows verbatim. Best-effort everywhere: archiving must never break the sweep or teardown.
 */
/**
 * Repo setup learning at the finish edge (src/setup-profile.ts): the agent's SETUP_SENTINEL refines
 * the stored profile; a GitHub repo with no profile yet gets one detected from its files (covers
 * runs that did not come through /delegate.json). Repos are identified from each dir's origin
 * remote, so this works after a controller restart too. A user-edited profile is never touched.
 */
const collectRepoSetup = async (box: string, owner: string): Promise<Array<{ name: string; slug: string }>> => {
  // The box's own host: with the primary's config this ran `msb exec` where the box was not, so a
  // run on a Freestyle VM never filed its memory notes under its repos (seen live 2026-11-17).
  const r = await execInBox(
    hcfg(box),
    box,
    `for d in /workspace/*/; do n=$(basename "$d"); u=$(git -C "$d" remote get-url origin 2>/dev/null); [ -n "$u" ] && echo "@@R $n|$u"; done; ` +
      `[ -f ${SETUP_SENTINEL} ] && { echo "@@S"; head -c 50000 ${SETUP_SENTINEL}; }; true`,
    { timeoutMs: 20_000 }
  );
  const [head, sentinel] = r.stdout.split(/^@@S$/m);
  const repos: Array<{ name: string; slug: string }> = [];
  for (const m of head.matchAll(/^@@R ([^|\n]+)\|(.+)$/gm)) {
    const slug = repoSlugFromUrl(m[2]);
    if (slug) repos.push({ name: m[1].trim(), slug });
  }
  if (!repos.length) return repos;
  const agent = sentinel ? parseSentinel(sentinel.trim(), repos.map((x) => x.name)) : {};
  for (const { name, slug } of repos) {
    const existing = getSetup(db, owner, slug);
    const detected = !existing && !agent[name] ? await detectSetupInBox(hcfg(box), box, `/workspace/${name}`) : undefined;
    const saved = recordLearned(db, owner, slug, { agent: agent[name], detected });
    if (saved) console.error(`[setup] ${box}: learned ${slug} (${saved.confirmedBy})`);
  }
  return repos;
};

/**
 * The live half of the memory harvest, from the fleet sweep: each running box whose log moved (its
 * lastOutputAt changed) at most once per MEMORY_TICK_GAP_MS, reading the hub's cached snapshot. Also
 * auto-keeps stale proposals for the owners in view, so a run that finished unwatched still has its
 * lessons confirmed after the window. Never throws into the sweep.
 */
const MEMORY_TICK_GAP_MS = 5_000;
const memoryTickAt = new Map<string, { at: number; out: number | undefined }>();
async function memoryTick(boxes: BoxView[]): Promise<void> {
  const owners = new Set<string>();
  const now = Date.now();
  for (const b of boxes) {
    if (b.role === "pool-free" || !/^running$/i.test(b.boxStatus) || isCanaryTask(b.task)) continue;
    const owner = ownerOf(db, b.name) ?? OPERATOR_OWNER;
    owners.add(owner);
    // Finished runs too: a run that ended between sweeps never produces a finish edge for this
    // process, and the lastOutputAt gate below makes it one read per run.
    if (!["running", "waiting", "done", "failed"].includes(b.runState)) continue;
    const prev = memoryTickAt.get(b.name);
    if (prev && (now - prev.at < MEMORY_TICK_GAP_MS || prev.out === b.lastOutputAt)) continue;
    memoryTickAt.set(b.name, { at: now, out: b.lastOutputAt });
    try {
      const snap = await watchHub.read(b.name);
      if (!snap.log) continue;
      const { added } = harvestMemory(b.name, owner, snap.log, await reposOfBox(b.name));
      if (added.length) console.error(`[memory] ${b.name}: remembered ${added.length} note${added.length === 1 ? "" : "s"} live`);
      // Proposed automations surface mid-run (the thread's schedule pill), not only at sign-off.
      try {
        proposeAutomations(b.name, owner, snap.log, startedByOf(db, b.name));
      } catch (e) {
        console.error(`[triggers] ${b.name}: live proposal failed: ${(e as Error).message.slice(0, 200)}`);
      }
    } catch (e) {
      console.error(`[memory] ${b.name}: live harvest failed: ${(e as Error).message.slice(0, 200)}`);
    }
  }
  for (const k of [...memoryTickAt.keys()]) if (!boxes.some((b) => b.name === k)) memoryTickAt.delete(k);
  for (const owner of owners) {
    try {
      memoryHarvester.sweepPending(owner);
    } catch {
      /* next sweep retries */
    }
  }
}

/**
 * The finish-edge pass of the memory harvest (src/memory-harvest.ts): whatever the live tick has
 * not seen yet, plus the questions the operator answered as decisions. Stamps the digest with this
 * run's total (live + final) by kind.
 */
const finishMemory = (box: string, owner: string, log: string, digest: RunDigest, repos: string[], closing = ""): void => {
  const { added } = harvestMemory(box, owner, log, repos, { force: true, questions: digest.questions });
  // The episodic half: what this run was asked and how it ended, for the next run in the same repo.
  if (repos.length && (digest.state === "done" || digest.state === "failed") && !digest.startFailure) {
    try {
      const store = loadMemoryStore(owner);
      if (recordEpisode(store, repos, { box, task: digest.task, state: digest.state, summary: closing, files: digest.files.map((f) => f.path) })) saveMemoryStore(store, owner);
    } catch (e) {
      console.error(`[memory] ${box}: episode not saved: ${(e as Error).message.slice(0, 200)}`);
    }
  }
  if (added.length) console.error(`[memory] ${box}: remembered ${added.length} note${added.length === 1 ? "" : "s"} at finish`);
  const kinds = memoryHarvester.rememberedKinds(box);
  const total = Object.values(kinds).reduce((a, b) => a + (b ?? 0), 0);
  if (total) {
    digest.remembered = total;
    digest.rememberedKinds = kinds;
  }
};

/**
 * Agent-authored schedules (src/triggers.ts parseAutomate), owned by the run's owner and live at once:
 *   `<!-- schedule: <time | in 2h | cron> | <task> -->`  follow-up work for this chat → Scheduled
 *   `<!-- automate: <cron> | <task> -->`                  a standing automation the user asked for → Automations
 * A critical one (deploys, deletes, merges, production, very frequent — see automateNeedsApproval),
 * or one the agent flagged with `?`, is created PAUSED and marked proposed for the owner to approve.
 * The box never touches the controller. The repo is inherited from the automation that started the run.
 */
// Markers that could not become a schedule, per box: the chat shows them so "I set it up" is never
// silently untrue. In memory — they are re-read from the live log on every sweep.
const scheduleRejects = new Map<string, AutomateReject[]>();

const proposeAutomations = (box: string, owner: string, log: string, startedBy: StartedBy | undefined): void => {
  const rejects = parseAutomateRejects(log);
  if (rejects.length) {
    if (!scheduleRejects.has(box)) for (const r of rejects) console.error(`[triggers] ${box}: dropped ${r.scope} marker (${r.reason}): ${r.task.slice(0, 80)}`);
    scheduleRejects.set(box, rejects);
  } else scheduleRejects.delete(box);
  const proposals = parseAutomate(log);
  if (!proposals.length) return;
  const parent = startedBy?.kind === "trigger" ? getTriggerById(db, startedBy.triggerId) : undefined;
  const existing = listTriggers(db, owner);
  for (const p of proposals) {
    if (existing.length >= 50) break;
    // Read from the live log on every sweep: one row per proposal per thread, and a dismissed one stays gone.
    if (!firstSighting(db, box, p.scope === "automation" ? `${p.cron}|${p.task}` : `${p.scope}|${p.when}|${p.task}`)) continue;
    // The same repeating proposal from another run (a re-run, a chain) is one row, not two.
    if (p.cron && existing.some((t) => t.sourceBox && t.spec.cron === p.cron && t.taskTemplate === p.task)) continue;
    const name = p.task.split(/[.!?](?=\s|$)/)[0].trim().slice(0, 80) || (p.scope === "automation" ? "Automation" : "Follow-up");
    // Routine work starts on its own; critical work (or work the agent flagged) waits for the owner.
    const ask = automateNeedsApproval(p.cron ?? "", p.task, p.asked);
    // A repo the task names ("in repo acme/api", a github.com URL) is cloned when it fires.
    const repo = parent?.repos?.[0] ?? p.task.match(/(?:\brepo(?:sitory)?\s+|github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?(?=[\s,;:)]|\.?$|\.\s)/i)?.[1];
    const { row } = createTrigger(
      db,
      secretBox,
      owner,
      {
        name,
        kind: "schedule",
        spec: p.at ? { at: p.at } : { cron: p.cron, timezone: "UTC" },
        ...(repo ? { repos: [repo] } : {}),
        taskTemplate: p.task,
        enabled: !ask,
        prComment: false,
        // Something asked for once ("merge the PR at 2pm") always reports back; a repeating check stays quiet when nothing is wrong.
        quiet: !p.at,
      },
      Date.now(),
      { proposed: !!ask, sourceBox: box, scope: p.scope }
    );
    existing.push(row);
    auditTrigger(owner, ask ? "trigger.propose" : "trigger.auto-create", { trigger: row.id, box, scope: p.scope, ...(ask ? { why: ask } : {}) });
    console.error(`[triggers] ${box} ${ask ? `proposed (${ask})` : "scheduled"} ${p.scope} ${row.id}: ${p.at ? new Date(p.at).toISOString() : p.cron} — ${name}`);
  }
};

// Boxes whose finish edge is being wrapped up right now: the diff and changed files, the repo
// setup, a verify clause, the turn checkpoint - SSHes to the box's host for seconds (a verify:
// minutes) after `done`. An operator's pause landing in that window turned the next of them into
// the provider proxy's own slow resume (seen live twice, once from the archive's diff read and
// once from the checkpoint tar), so the pause route refuses while any of it is in flight.
const finishing = new Map<string, number>();
const withFinishing = async <T>(box: string, fn: () => Promise<T>): Promise<T> => {
  finishing.set(box, (finishing.get(box) ?? 0) + 1);
  try {
    return await fn();
  } finally {
    const n = (finishing.get(box) ?? 1) - 1;
    if (n <= 0) finishing.delete(box);
    else finishing.set(box, n);
  }
};
const finishingOn = (hostId: string): boolean => [...finishing.keys()].some((b) => (hostPool.hostOfBox(b) ?? PRIMARY_HOST_ID) === hostId);
const archiveFinishedRun = (box: string, opts: { withFiles: boolean; quiet?: boolean } = { withFiles: true }): Promise<void> => withFinishing(box, () => archiveFinishedRunInner(box, opts));
const archiveFinishedRunInner = async (box: string, opts: { withFiles: boolean; quiet?: boolean }): Promise<void> => {
  const snap = await watchHub.read(box);
  if (snap.boxStatus === "missing") return;
  // Only a genuinely FINISHED run earns a record. Testing for "not running and not waiting" is not
  // the same thing: RunState also has "idle" — a box that never ran a task (a pool machine, one
  // claimed but never delegated to). Those reach buildDigest as state "done" with an empty headline
  // and would land in history as phantom completed runs the user never started.
  if (snap.runState !== "done") return;
  const up = /^running$/i.test(snap.boxStatus);
  const files = opts.withFiles && up ? await listChanges(hcfg(box), box).catch(() => []) : [];
  // Full workspace diff, captured NOW because this is the last moment the box can answer: after
  // teardown a run's only reviewable diff is this row. Redacted like everything box-produced.
  const diffText = opts.withFiles && up ? await readFullDiff(hcfg(box), box).then((d) => redactor.redact(d)).catch(() => "") : "";
  const events = parseTrace(snap.log ?? "");
  const digest = buildDigest({
    box,
    task: snap.task ?? "",
    runState: snap.runState,
    exitCode: snap.exitCode,
    events,
    files,
    verified: boxVerified.get(box),
    retries: retriesOf(box),
    ...runProvenance(box, snap.agent, snap.mcpNotes),
  });
  const runOwner = ownerOf(db, box) ?? OPERATOR_OWNER;
  // Code mode: what the box learned about the owner's MCP servers (result shapes, tool counts)
  // goes into the owner's knowledge blob, so the next box starts from it and the auto decision has
  // the counts it needs. Only a box that is still up can answer, and only a run that had the
  // script server (the digest says) has anything to harvest.
  if (up && digest.provenance?.mcp && digest.provenance.mcp.mode !== "direct") {
    try {
      const learned = await harvestCodeModeKnowledge(hcfg(box), box);
      if (Object.keys(learned.shapes).length || Object.keys(learned.toolCounts).length) {
        await withOwner(ownerOf(db, box) ?? null, async () => absorbKnowledge(learned));
      }
    } catch (e) {
      console.error(`[code-mode] ${box}: knowledge not harvested: ${(e as Error).message.slice(0, 200)}`);
    }
  }
  // Repo setup first: it also yields the repos' slugs, which file this run's memory notes. A box
  // that is already down keeps its notes too (as global ones — the repo can no longer be asked).
  const repos = up ? await collectRepoSetup(box, runOwner).catch((e) => (console.error(`[setup] ${box}: ${(e as Error).message.slice(0, 200)}`), [])) : [];
  try {
    const closing = [...events].reverse().find((e) => e.kind === "say")?.text ?? "";
    finishMemory(box, runOwner, snap.log ?? "", digest, repos.map((r) => r.slug), closing);
    // Knowledge-base drift: notes anchored to files this run touched are now "unverified" until a
    // later run (or the operator) confirms them. Only files the box could still report count.
    const stale = memoryHarvester.markStale(box, runOwner, repos.map((r) => r.slug), files.map((f) => f.path));
    if (stale.length) console.error(`[memory] ${box}: ${stale.length} note${stale.length === 1 ? "" : "s"} may be outdated (${[...new Set(stale.map((n) => n.area ?? "unfiled"))].join(", ")})`);
  } catch (e) {
    console.error(`[memory] ${box}: ${(e as Error).message.slice(0, 200)}`);
  }
  // The outcome card (src/outcome.ts): persisted inside the archived digest, so it outlives the box.
  try {
    digest.outcome = buildOutcome({ digest, events, log: snap.log ?? "", filesKnown: opts.withFiles && up, diffText });
  } catch (e) {
    console.error(`[outcome] ${box}: ${(e as Error).message.slice(0, 200)}`);
  }
  const workflowId = workflowEngine.viewOf(box)?.id;
  const archiveId = archiveRun(db, { box, owner: runOwner, digest, ...(diffText ? { diffText } : {}), ...(workflowId ? { workflowId } : {}) });
  // A trigger-started run finishing frees its slot, stamps the automation's last result, posts the
  // receipt comment and fires any chain. Only on a NEW record (null = this finish was already seen).
  const fin = archiveId !== null ? await dispatcher.onRunFinished(box, digest, digest.provenance?.startedBy, archiveId, { quiet: opts.quiet === true, events }) : { destroy: false };
  // Automations the agent proposed in its sign-off: created paused, pending the operator's approval.
  if (archiveId !== null) {
    try {
      proposeAutomations(box, runOwner, snap.log ?? "", digest.provenance?.startedBy);
    } catch (e) {
      console.error(`[triggers] ${box}: proposal failed: ${(e as Error).message.slice(0, 200)}`);
    }
  }
  // PR follow-ups: the PRs this run opened become agent PRs; a finished follow-up replies on GitHub.
  if (archiveId !== null) {
    try {
      const harnessId = runHarnessOf(db, box)?.harnessId ?? undefined;
      followups.onArchived({ box, owner: runOwner, digest, archiveId, ...(harnessId ? { harnessId } : {}) });
    } catch (e) {
      console.error(`[followup] ${box}: recording PRs failed: ${(e as Error).message.slice(0, 200)}`);
    }
    await followups.onRunFinished(box, digest, snap.log ?? "", archiveId).catch((e) => console.error(`[followup] ${box}: ${(e as Error).message.slice(0, 200)}`));
  }
  // An attempt finishing may complete its group: score it now rather than at the next sweep tick.
  if (archiveId !== null) sweepAttempts(true);
  // The automation's box policy: destroy the finished box now instead of waiting out the global
  // sleep TTL. Last, so the archive, memory, chains and follow-ups above have read what they need.
  // A box the operator pinned (Keep) stays; a listing failure keeps it too (fail safe).
  if (fin.destroy && opts.withFiles) {
    const kept = await listKept(hcfg(box)).catch(() => null);
    if (kept && !kept.has(box)) {
      await deps
        .teardown(hcfg(box), box)
        .then(() => {
          void forgetTitle(hcfg(box), box).catch(() => {});
          console.error(`[triggers] ${box}: destroyed on finish (automation box policy)`);
        })
        .catch((e) => console.error(`[triggers] ${box}: destroy on finish failed: ${(e as Error).message.slice(0, 200)}`));
    }
  }
};

/**
 * Capture the turn-end checkpoint for `box`. The turn number is computed in-box from the log the
 * tar captures (captureCmd) — never from the controller's cached snapshot, which can be stale.
 * Idempotent, best-effort, serialized per box; any failure logs and the fleet sweep never notices.
 */
const captureTurnCheckpoint = (box: string): Promise<void> =>
  withBoxLock(box, async () => {
    try {
      const r = await execInBox(hcfg(box), box, captureCmd());
      if (!/CKPT_(OK|HAVE)/.test(r.stdout)) console.error(`[ckpt] capture on ${box}: ${r.stdout.trim().slice(-200)}`);
      noteCaptured(box, r.stdout);
    } catch (e) {
      console.error(`[ckpt] capture on ${box} errored: ${(e as Error).message.slice(0, 200)}`);
    }
  });

// Ask-park (ASK_PARK=1): when the sweep first sees a box WAITING, and again past the grace window.
const waitingSince = new Map<string, number>();
const parkInFlight = new Set<string>();
const maybePark = (boxes: Array<{ name: string; runState?: string; boxStatus?: string; role?: string }>) => {
  if (!askParkEnabled()) return;
  const now = Date.now();
  for (const b of boxes) {
    if (b.role === "pool-free") continue;
    const running = /^running$/i.test(b.boxStatus ?? "");
    if (b.runState !== "waiting" || !running) {
      waitingSince.delete(b.name);
      continue;
    }
    if (!waitingSince.has(b.name)) waitingSince.set(b.name, now);
    if (
      shouldPark({ enabled: true, runState: "waiting", boxRunning: true, waitingSinceMs: waitingSince.get(b.name), graceMs: askParkGraceMs(), nowMs: now }) &&
      !parkInFlight.has(b.name)
    ) {
      parkInFlight.add(b.name);
      void parkWaitingBox(msbIo(hcfg(b.name)), b.name)
        .then(async (ok) => {
          if (!ok) return;
          noteStopped(b.name); // stop readers from exec-booting the box we just stopped
          waitingSince.delete(b.name);
          await markParked(hcfg(b.name), b.name).catch(() => {});
          await touchClaimed(hcfg(b.name), b.name).catch(() => {}); // park clock counts from the park
        })
        .catch(() => {})
        .finally(() => parkInFlight.delete(b.name));
    }
  }
  for (const k of [...waitingSince.keys()]) if (!boxes.some((b) => b.name === k)) waitingSince.delete(k);
};

/**
 * The idle nap is the controller's (2026-11-19). The runtime's own `--idle-timeout` counts the
 * sweep's reads as activity, so a finished box sat "sleeps any moment" for as long as the dashboard
 * watched it. Now a session box that is done and has been quiet for the idle timeout by the agent
 * log's clock is stopped here, and the dashboard's countdown is this rule, exact to the sweep. A
 * box whose turn the controller just started is left alone until the agent writes (shouldNap).
 */
const napInFlight = new Set<string>();
const maybeNap = (boxes: BoxView[], claims: Map<string, number>, nowMs: number) => {
  const idleTimeoutSec = parseDurationSec(cfg.idleTimeout);
  if (!idleTimeoutSec) return;
  for (const b of boxes) {
    if (napInFlight.has(b.name)) continue;
    // A paused host's listing is memory: nothing is stopped on it until it is up for something else.
    if (hostPool.dormant(hostPool.hostOfBox(b.name) ?? PRIMARY_HOST_ID)) continue;
    const since = quietSinceSec(b.lastOutputAt, wokenAtOf(b.name));
    const verdict = shouldNap({ role: b.role, boxStatus: b.boxStatus, runState: b.runState, lastOutputAtSec: since, idleTimeoutSec, nowMs, turnStartedAtMs: turnStarted.get(b.name) });
    if (!verdict) continue;
    napInFlight.add(b.name);
    const quiet = Math.round((nowMs / 1000 - (since ?? nowMs / 1000)) / 60);
    void stopBox(hcfg(b.name), b.name)
      .then(async () => {
        noteStopped(b.name);
        console.error(`[nap] ${b.name}: quiet for ${quiet}m, stopped (a reply wakes it)`);
        // The sleep TTL counts from the nap (see the Running → Stopped re-stamp in the sweep).
        await (claims.has(b.name) ? touchClaimed(hcfg(b.name), b.name) : markClaimed(hcfg(b.name), b.name)).catch(() => {});
      })
      .catch((e) => console.error(`[nap] ${b.name}: stop failed: ${String((e as Error).message ?? e).slice(0, 160)}`))
      .finally(() => napInFlight.delete(b.name));
  }
};

const SLEEP_REAP_EVERY_MS = 5 * 60_000;
const lastSeenStatus = new Map<string, boolean>();
/**
 * The harness a box started on, as the thread header shows it ("Bug fixer · asks before guessing ·
 * verify on done"). The link is in run_harness; the rule summary comes from the owner's current
 * definition (so an edit shows up), falling back to the recorded name if the harness was deleted.
 * Cached per box — a sweep polls every box every tick and the link never changes after the start.
 */
const harnessLineCache = new Map<string, { harness: { id: string; name: string; line: string } } | Record<string, never>>();
/** The workflow a box is running (or just ran): name, step n/total, one line (src/workflow.ts viewOf). */
const workflowLineOf = (box: string): { workflow: ReturnType<typeof workflowEngine.viewOf> } | Record<string, never> => {
  const v = workflowEngine.viewOf(box);
  return v ? { workflow: v } : {};
};
const harnessLineOf = (box: string): { harness: { id: string; name: string; line: string } } | Record<string, never> => {
  const hit = harnessLineCache.get(box);
  if (hit) return hit;
  let out: { harness: { id: string; name: string; line: string } } | Record<string, never> = {};
  try {
    const link = runHarnessOf(db, box);
    if (link?.harnessId) {
      const def = link.owner ? getHarness(link.harnessId, link.owner) : undefined;
      const name = def?.name ?? link.harnessName ?? link.harnessId;
      out = { harness: { id: link.harnessId, name, line: def ? harnessSummaryLine(def) : name } };
    }
  } catch {
    /* a missing link is simply "no harness" */
  }
  // Only a found link is cached: a box whose link is recorded moments after its first sweep is
  // re-checked until it has one (or forever stays a plain run, which costs one indexed read a tick).
  if ("harness" in out) harnessLineCache.set(box, out);
  return out;
};
/** Hosts whose durable run memory has been read since this controller started (see the store below). */
const runMemoryRead = new Set<string>();
// Thread rows (src/threads.ts) are written only when a box's description changed since the last sweep.
const threadSeen = new Map<string, { fp: string; runState: string }>();
const recordThreads = (boxes: BoxView[], kept: Set<string>, titles: Record<string, string>, now: number): void => {
  const listed = new Set<string>();
  for (const b of boxes) {
    if (b.role === "pool-free") continue;
    listed.add(b.name);
    const running = /^running$/i.test(b.boxStatus);
    const fp = JSON.stringify([b.role, b.runState, b.exitCode, b.task, titles[b.name] ?? b.title, b.agent, b.host, b.question, b.repos, kept.has(b.name), running]);
    const prev = threadSeen.get(b.name);
    if (prev?.fp === fp) continue;
    threadSeen.set(b.name, { fp, runState: b.runState });
    try {
      const u = threadFromBox(b, ownerOf(db, b.name) ?? null, { title: titles[b.name], kept: kept.has(b.name) }, now);
      // A turn just ended (done, failed, or paused on a question): stamp it.
      if (prev && prev.runState !== b.runState && (b.runState === "done" || b.runState === "waiting")) u.lastTurnAt = now;
      upsertThread(db, u, now, { revive: true });
    } catch (e) {
      console.error(`[threads] ${b.name}: ${String((e as Error).message ?? e).slice(0, 160)}`);
    }
  }
  for (const k of [...threadSeen.keys()]) if (!listed.has(k)) threadSeen.delete(k);
};
// The transcript's copy on the controller: one sync per box at a time, errors logged sparingly.
const transcriptSyncs = new Map<string, Promise<void>>();
const transcriptSyncErrors = new Map<string, number>();
const syncThreadTranscript = (box: string): Promise<void> => {
  const running = transcriptSyncs.get(box);
  if (running) return running;
  const p = syncTranscript(cfg, box, async (sh) => (await execInBox(hcfg(box), box, sh, { timeoutMs: 60_000 })).stdout)
    .then(() => {
      transcriptSyncErrors.delete(box);
    })
    .catch((e) => {
      const n = (transcriptSyncErrors.get(box) ?? 0) + 1;
      transcriptSyncErrors.set(box, n);
      if (n === 1 || n % 20 === 0) console.error(`[transcript] ${box}: sync failed (${n}): ${String((e as Error).message ?? e).slice(0, 160)}`);
    })
    .finally(() => {
      if (transcriptSyncs.get(box) === p) transcriptSyncs.delete(box);
    });
  transcriptSyncs.set(box, p);
  return p;
};
const readFleet = makeFleetReader(
  cfg,
  async () => {
    const sweepAt = Date.now();
    const { boxes, kept, claims, titles, stale, swept } = await sweepHosts(cfg);
    lastKept = kept;
    // Copies taken before the box was kept (or before copies knew about keeps) get the stamp once.
    for (const k of kept) if (!keptStamped.has(k)) { keptStamped.add(k); void stampRescueKept(cfg, k).then((did) => did && console.error(`[keep] ${k}: copy stamped kept`)).catch(() => {}); }
    // A box seen Running last sweep and Stopped now just fell asleep: re-stamp its claim so the sleep
    // TTL (and the "asleep for" figure) count from the nap rather than from when the run started.
    for (const b of boxes) {
      const was = lastSeenStatus.get(b.name);
      const runningNow = /^running$/i.test(b.boxStatus);
      // A session box (a delegate) is launched without a claim marker: its first nap writes one, so
      // the sleep TTL covers it exactly as it covers a pool box (src/claims.ts stoppedBoxVerdict).
      // Not on a host served from memory this sweep: an SSH to a paused VM resumes it (Freestyle).
      if (was === true && !runningNow && b.role !== "pool-free" && !stale.includes(b.host ?? PRIMARY_HOST_ID)) void (claims.has(b.name) ? touchClaimed(hcfg(b.name), b.name) : markClaimed(hcfg(b.name), b.name)).catch(() => {});
      lastSeenStatus.set(b.name, runningNow);
    }
    for (const k of [...lastSeenStatus.keys()]) if (!boxes.some((b) => b.name === k)) lastSeenStatus.delete(k);
    maybeNap(boxes, claims, sweepAt);
    // Walk-away notifications: diff this sweep against the last one and push the edges (waiting /
    // done / failed) to the box owner's webhook. Fire-and-forget — a webhook must never slow or
    // fail the fleet read the dashboard is polling on.
    {
      const nextRunViews = boxes
        .filter((b) => b.role !== "pool-free")
        .map((b) => ({ name: b.name, runState: b.runState, exitCode: b.exitCode, question: b.question, stalled: b.stalled, lastOutputAt: b.lastOutputAt }));
      if (turnStarted.size) {
        const ripe = new Set([...turnStarted].filter(([, t]) => t < sweepAt).map(([name]) => name));
        prevRunViews = prevRunViews.map((v) => (ripe.has(v.name) && (v.runState === "done" || v.runState === "idle") ? { ...v, runState: "running" } : v));
        for (const name of ripe) turnStarted.delete(name);
      }
      for (const ev0 of detectTransitions(prevRunViews, nextRunViews)) {
        const edgeTask = boxes.find((b) => b.name === ev0.box)?.task;
        // The canary's runs are the controller's own: no notification, no history row, no memory.
        // The canary reads its box itself (see makeCanary below) and tears it down.
        if (isCanaryTask(edgeTask)) continue;
        // A failed edge is classified before anything hears of it: a non-zero exit with no agent
        // turn behind it is the sandbox's failure, and the event carries that and the log tail.
        const ev: NotifyEvent = { ...ev0 };
        const classify = async (): Promise<void> => {
          if (ev.kind !== "failed" && ev.kind !== "done") return;
          const snap = await watchHub.read(ev.box).catch(() => undefined);
          const sf = ev.kind === "failed" && !!snap && isStartFailure(ev.exitCode, parseTrace(snap.log ?? ""));
          if (sf) {
            ev.startFailure = true;
            const tail = logTail(snap?.log ?? "");
            if (tail) ev.tail = tail;
            console.error(`[run-health] ${ev.box}: died before its first turn (exit ${ev.exitCode})${tail ? `: ${tail.split("\n").slice(-1)[0]}` : ""}`);
          }
          const rec = startFailures.record(ev.box, sf, ev.tail);
          if (rec.alert) void alertOperator(startFailureAlertText(rec.streak, startFailures.state().last, cfg.publicUrl ?? ""), "start-failures");
        };
        notifyCtx.set(ev.box, { title: titles[ev.box], task: edgeTask });
        // Quiet automations: a done edge whose log ends with the quiet marker (and that asked nothing
        // and opened no PR) is a check that found nothing — no notification, ledger row marked quiet.
        // Everything else notifies as before. Best-effort: an unreadable log is a normal finish.
        const quietDone = async (): Promise<boolean> => {
          if (ev.kind !== "done" || !dispatcher.quietTriggerOf(ev.box)) return false;
          const snap = await watchHub.read(ev.box).catch(() => undefined);
          return !!snap && isQuietRun(snap.log ?? "", { question: snap.question });
        };
        const settle = async (): Promise<void> => {
          // Classified first (one hub read, off the sweep): the notification and the archive row
          // then both know whether this was the sandbox's failure.
          await classify();
          const quiet = await quietDone();
          if (shouldNotify(ev, { quiet })) void notifier.notify(ev);
          // Run history archive: persist the digest at the finish edge (box still up → files listable).
          if (ev.kind === "done" || ev.kind === "failed")
            await archiveFinishedRun(ev.box, { withFiles: true, quiet }).catch((e) => console.error(`[archive] ${ev.box}: ${(e as Error).message.slice(0, 200)}`));
        };
        // Off the sweep: a workflow check may run `npm test` for minutes, and the fleet read is what
        // the dashboard polls on.
        void withFinishing(ev.box, async () => {
          // Workflows (src/workflow-engine.ts): a finish that only advances to the next step is the
          // workflow's business — no notification, no archive row, no verify clause yet. The engine
          // returns false when the finish is the run's own (no workflow, or it just ended), and the
          // ordinary path below runs on that one finish.
          const wfState = ev.kind === "waiting" ? "waiting" : ev.kind === "failed" ? "failed" : "done";
          if (await workflowEngine.onFinish(ev.box, wfState, ev.exitCode)) return;
          // Verified outcomes for dashboard runs: a clean finish runs the stored clause BEFORE the
          // notification so the push can honestly say verified/UNVERIFIED. Failure paths drop the
          // clause — verification of a failed run would prove nothing.
          const vplan = ev.kind === "done" || ev.kind === "failed" ? boxVerify.get(ev.box) : undefined;
          if (vplan) boxVerify.delete(ev.box);
          if (vplan && ev.kind === "done" && (ev.exitCode ?? 0) === 0 && deps.verify) {
            const runState = nextRunViews.find((b) => b.name === ev.box)?.runState ?? "done";
            // Awaited (this block is already off the sweep) so the host counts the run as finishing
            // until the verification and the settle behind it are done.
            await deps
              .verify(hcfg(ev.box), ev.box, vplan)
              .then((r) => boxVerified.set(ev.box, r))
              .catch(() => {})
              // Done means verified: a failed check with retry budget left sends the run back with the
              // failure instead of stamping it. The clause is re-armed so the next finish is checked
              // again; the intermediate finish gets no notification and no archive row — the operator
              // hears once, when the loop ends. Otherwise settle (quiet-aware notify + archive AFTER
              // verification so the record carries the verified stamp).
              .then(() => verifyRetrier!.consider(ev.box, boxVerified.get(ev.box), runState))
              .then((retrying) => {
                if (retrying) {
                  boxVerify.set(ev.box, vplan);
                  return;
                }
                return settle();
              });
          } else {
            await settle();
          }
        }).catch((e) => console.error(`[finish] ${ev.box}: ${String((e as Error).message ?? e).slice(0, 200)}`));
        // Turn-end checkpoint: the moment a turn settles (done or paused on a question) is the
        // restore point for whatever the operator sends next. Online in-box tar (~1 s, no VM stop)
        // behind the per-box lock so a fast follow-up queues instead of racing the capture.
        if (ev.kind === "done" || ev.kind === "waiting") void withFinishing(ev.box, () => captureTurnCheckpoint(ev.box));
        // The transcript's copy on the controller catches up the moment a turn ends (src/threads.ts).
        if (ev.kind === "done" || ev.kind === "waiting" || ev.kind === "failed") void syncThreadTranscript(ev.box);
      }
      prevRunViews = nextRunViews;
    }
    // Ask-park: a box waiting past the grace window is snapshotted and stopped (fire-and-forget; the
    // next sweep sees it Stopped and the fleet card shows it asleep-with-question).
    maybePark(boxes);
    // Attempt groups: deadlines and the losers' override window are time-based, so tick them here.
    sweepAttempts();
    // Memory v2: harvest live runs so a mid-run lesson reaches the thread now, not at the finish.
    void memoryTick(boxes);
    // Threads (src/threads.ts): every session box the hosts listed is written to the thread table,
    // its transcript is pulled up to date while it runs, and the threads whose box the hosts did
    // NOT list are added from the table: asleep when their host did not answer, away when the box
    // is really gone and a copy is kept. A box can vanish; a thread cannot.
    recordThreads(boxes, kept, titles, sweepAt);
    // Only the boxes a host answered for this round: a box served from memory while its host is
    // paused reads "running" too, and syncing it cost one refused SSH per sweep (seen live
    // 2026-11-19: sixty failed syncs into a thread on a suspended Instabox machine).
    const unanswered = new Set(stale);
    for (const b of boxes) {
      if (!/^running$/i.test(b.boxStatus) || b.role === "pool-free") continue;
      const hostId = b.host ?? PRIMARY_HOST_ID;
      if (unanswered.has(hostId) || hostPool.dormant(hostId)) continue;
      void syncThreadTranscript(b.name);
    }
    const copies = await rescueBoxes(cfg).catch(() => new Set<string>());
    const present = new Set(boxes.map((b) => b.name));
    // A host that answered with a listing and did not list a thread's box: the row records it
    // (box_status "absent"), so the sweeps served from memory while that host sleeps show the thread
    // away, not as a box asleep on it. Only a listing with something in it counts: an empty answer
    // from a host that had boxes is far more likely cut short than emptied.
    const answered = new Set(swept.filter((id) => boxes.some((b) => b.host === id)));
    noteAbsentThreads(db, listThreads(db), present, answered, sweepAt);
    // A host paused at its provider or by its own clock runs nothing: a row that still has its box
    // running there is asleep, and its sleep clock starts (src/threads.ts noteDormantThreads).
    noteDormantThreads(db, listThreads(db), (host) => hostPool.dormant(host), sweepAt);
    const threadRows = listThreads(db);
    const threadRow = new Map(threadRows.map((r) => [r.id, r]));
    const away = threadViews(threadRows, present, new Set(stale), (id) => copies.has(id));
    // A Stopped box nobody remembers is dead capacity only when nobody holds it (fleet.ts mergeWithMemory).
    // A thread row holds its box too: a box can vanish, a thread cannot.
    // A deleted thread row holds nothing: its box was destroyed (or found gone) on purpose.
    const held = (name: string): boolean => {
      if (kept.has(name) || claims.has(name) || ownerOf(db, name) != null) return true;
      const t = getThread(db, name);
      return t != null && t.deleted_at == null;
    };
    // A row a listing already marked "absent" is not re-listed asleep from memory while its host
    // sleeps: the memory's own `absent` flag dies with a restart, the row does not (an Away thread
    // on freestyle-a read as asleep for two days, 2026-11-21).
    const gone = (name: string): boolean => threadRow.get(name)?.box_status === "absent";
    const views = [...boxes, ...away].map((b) => {
      // A running box with no task mark is still the thread its row names: a box mid-launch (the
      // mark is written when the agent starts), or one a restore left empty. The row's task and
      // title stand in; without a task anywhere a claimed box is nobody's thread yet and is listed
      // as warm capacity, not as "No task yet" under a machine name (seen 2026-11-22 on instabox-a).
      const row = threadRow.get(b.name);
      const task = b.task || row?.task || undefined;
      const unowned = !task && b.role === "pool-claimed" && /^running$/i.test(b.boxStatus);
      return {
        ...b,
        ...(unowned ? { role: "pool-free" as const } : {}),
        ...(titles[b.name] ? { title: titles[b.name] } : !b.title && row?.title ? { title: row.title } : {}),
        ...harnessLineOf(b.name),
        ...workflowLineOf(b.name),
        ...skillPicksView(b.name),
        ...memoryReceiptView(b.name),
        // The task and any pending question are operator/agent text too — same redaction as the log.
        ...(task ? { task: redactor.redact(task) } : {}),
      ...(b.question ? { question: redactor.redact(b.question) } : {}),
      ...(kept.has(b.name) ? { kept: true } : {}),
      // The quiet clock the dashboard counts down is the nap's own: a wake is activity.
      ...(/^running$/i.test(b.boxStatus) && quietSinceSec(b.lastOutputAt, wokenAtOf(b.name)) !== b.lastOutputAt ? { lastOutputAt: quietSinceSec(b.lastOutputAt, wokenAtOf(b.name)) } : {}),
      // For a stopped box the claim age is (a good proxy for) how long it has been asleep; with the
      // host's markers out of reach (asleep, unreachable, a restart) the thread's own clock counts.
      ...(!/^running$/i.test(b.boxStatus) && (claims.has(b.name) || asleepSecOf(row, sweepAt) !== undefined)
        ? { asleepSec: claims.get(b.name) ?? asleepSecOf(row, sweepAt) }
        : {}),
      };
    });
    return { boxes: views, stale, held, gone };
  },
  {
  decorate: (boxes) =>
    boxes.map((b) => {
      const q = inbox.list(b.name);
      return q.length ? { ...b, queued: q.map((m) => m.text) } : b;
    }),
    sleep: { asleep: () => hostPool.allAsleep(), noteFleet: () => {} },
    capacity: () => hostPool.capacity(),
    // The dashboard's poll is answered from the last sweep while the next one runs behind it; a
    // snapshot older than this waits for the sweep (the background sweep below runs every 15 s,
    // so this is reached only when a sweep is wedged).
    staleMs: 12_000,
    store: {
      // Each host keeps the memory of its own boxes, and the controller keeps a mirror of all of them
      // (run-memory.ts). The mirror is read first, so a host that is asleep or unreachable when the
      // controller starts still has its sleeping threads listed; the host's own answer wins per box
      // and a host that could not be read (or was asleep — an SSH would wake it) is read on a later
      // sweep instead of being written off.
      load: async () => {
        const out = new Map<string, RunMeta>();
        // The thread table first (src/threads.ts): what the controller itself last knew of every live
        // thread, so a restart while a host is paused does not strip its sleeping threads to "No task yet".
        try {
          for (const [k, v] of threadRunMetas(listThreads(db), (id) => taskHeadOf(db, id))) out.set(k, v);
        } catch (e) {
          console.error(`[fleet] thread memory not read: ${String((e as Error).message ?? e).slice(0, 120)}`);
        }
        for (const [k, v] of await loadRunMetasLocal(cfg).catch(() => new Map<string, RunMeta>())) out.set(k, v);
        await Promise.all(
          hostPool.active().map(async (h) => {
            const id = h.spec.id;
            if (runMemoryRead.has(id) || hostPool.dormant(id)) return;
            try {
              const remembered = await loadRunMetas(h.cfg);
              for (const [k, v] of remembered) {
                const m: RunMeta = { ...v, host: id };
                out.set(k, m);
                // The mirror learns what the host remembers, so the next restart does not depend on the host answering.
                void saveRunMetaLocal(cfg, m).catch((e) => console.error(`[fleet] run memory mirror of ${k}: ${String((e as Error).message ?? e).slice(0, 120)}`));
              }
              runMemoryRead.add(id);
              console.error(`[fleet] run memory of ${id}: ${remembered.size} run(s) remembered on the host`);
            } catch (e) {
              console.error(`[fleet] run memory of ${id} not read yet: ${String((e as Error).message ?? e).slice(0, 120)}`);
            }
          })
        );
        return out;
      },
      incomplete: () => hostPool.active().some((h) => !runMemoryRead.has(h.spec.id)),
      save: async (meta) => {
        const m = meta as RunMeta;
        await Promise.all([saveRunMetaLocal(cfg, m), saveRunMeta(hcfg(m.name), m)]);
      },
      forget: async (box) => {
        await Promise.all([forgetRunMetaLocal(cfg, box), forgetRunMeta(hcfg(box), box)]);
      },
      forgetMany: async (boxes) => {
        await Promise.all(boxes.map((b) => forgetRunMetaLocal(cfg, b).catch(() => {})));
        const byHost = new Map<string, { cfg: Config; boxes: string[] }>();
        for (const b of boxes) {
          const c = hcfg(b);
          const e = byHost.get(c.vpsSsh) ?? { cfg: c, boxes: [] };
          e.boxes.push(b);
          byHost.set(c.vpsSsh, e);
        }
        await Promise.all([...byHost.values()].map((e) => forgetRunMetas(e.cfg, e.boxes)));
      },
    },
  }
);
// Background sweep: finish edges, notifications and the memory harvest ride on fleet reads, so a
// run nobody is watching still gets its history, push and memory.
setInterval(() => void readFleet().catch(() => {}), 15_000).unref();
// Threads from before the table existed: every kept copy and every remembered run gets a row, so
// the list is complete from the first sweep after this deploy.
void (async () => {
  try {
    for (const name of await rescueBoxes(cfg)) {
      const m = await readRescue(cfg, name);
      if (!m || getThread(db, name)) continue;
      upsertThread(db, { id: name, owner: m.owner, task: m.task ?? null, title: m.title ?? null, agent: m.agent ?? null, host: m.hostId ?? null, boxStatus: "unknown" }, m.at);
    }
    for (const [name, r] of await loadRunMetasLocal(cfg)) {
      if (getThread(db, name) || r.role === "pool-free") continue;
      upsertThread(db, { id: name, owner: ownerOf(db, name) ?? null, task: r.task ?? null, host: r.host ?? null, role: r.role === "pool-claimed" ? "pool-claimed" : "session", runState: r.runState, exitCode: r.exitCode ?? null, question: r.question ?? null, repos: r.repos ?? null, boxStatus: "unknown" });
    }
  } catch (e) {
    console.error(`[threads] backfill: ${String((e as Error).message ?? e).slice(0, 200)}`);
  }
})();

// Repositories reachable through the connected accounts (picker, inference, attach).
const listRepos = makeRepoLister(cfg, fetchGithubRepos);
// The same repo capabilities for MCP clients (Cursor etc.): list_repos / attach_repo tools.
deps.listRepos = async (_cfg, query) => {
  const all = matchRepos(await listRepos(), query, 25);
  if (!all.length) return query ? `No repository matches "${query}".` : "No repositories — connect a GitHub account first.";
  return all.map((r) => `${r.fullName}${r.private ? " (private)" : ""} · default ${r.defaultBranch}${r.description ? ` — ${r.description}` : ""}`).join("\n");
};
deps.attachRepo = async (c, session, repo, ref) => {
  // Installed AFTER guardDeps wrapped the deps object, so the tenancy wrapper never saw this member —
  // the ownership check must live here. Without it any signed-in user could attach (and inject their
  // git credentials into) another tenant's box via the MCP attach_repo tool.
  ownership.check(session);
  const r = await attachRepoToBox(c, session, repo, ref);
  inbox.enqueue(session, `The repository ${repo} is now checked out at /workspace/${r.name}${ref ? ` (ref ${ref})` : ""}. Use it for the task where relevant.`);
  return `Attached ${repo} to ${session} at /workspace/${r.name}${r.login ? ` as ${r.login}` : ""}. The agent is told at its next turn.`;
};
// Per-owner serialization of the whole-blob stores (accounts / MCP servers / skills). Each mutating
// route does load → mutate → save of the entire blob; two overlapping requests would silently lose
// the first writer's change. Same chain shape as withBoxLock.
const storeLocks = new Map<string, Promise<unknown>>();
function withStoreLock<T>(kind: string, fn: () => Promise<T>): Promise<T> {
  const key = `${ownerKey()}|${kind}`;
  const prev = storeLocks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  storeLocks.set(key, next.catch(() => {}));
  return next;
}

// `@` mentions: a briefly cached file index per box.
const fileIndex = makeFileIndex(async (box, sh) => (await execInBox(hcfg(box), box, sh)).stdout);

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
// Idle expiry: a client that reconnects with a fresh `initialize` (network drop, editor restart)
// never DELETEs its old session, so without a sweep each one leaks a transport + full McpServer
// for the life of the process. An hour of silence means the client is gone; closing fires
// transport.onclose, which removes the map entry.
const transportSeen = new Map<string, number>();
const MCP_IDLE_MS = 60 * 60_000;
setInterval(() => {
  const cutoff = Date.now() - MCP_IDLE_MS;
  for (const [id, at] of transportSeen) {
    if (at >= cutoff) continue;
    transportSeen.delete(id);
    const t = transports[id];
    if (t) void t.close().catch(() => {});
  }
}, 10 * 60_000).unref();

async function handle(req: Request, res: Response) {
  const sid = req.headers["mcp-session-id"] as string | undefined;
  let transport = sid ? transports[sid] : undefined;
  if (sid && transport) transportSeen.set(sid, Date.now());

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
        transportSeen.set(id, Date.now());
      },
    });
    transport.onclose = () => {
      if (transport!.sessionId) {
        delete transports[transport!.sessionId];
        transportSeen.delete(transport!.sessionId);
      }
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
  // Anything else is a 500, through the redactor: an msb/git failure can quote a command line that
  // carried a token. Redaction alone is not enough though — the message is no longer only
  // operator-facing. `run()` rejects with the FULL argv to keep ssh failures debuggable, so a
  // /tree.json for a box that simply doesn't exist answered a signed-in tenant with the control
  // plane's ssh invocation: key path, control-socket path, the host it dials, and the msb binary
  // path. None of that is a secret the redactor knows a shape for, and all of it is reconnaissance.
  // The plumbing is stripped for the client and kept in full in the server log.
  else res.status(500).json({ error: clientError(e) });
}

const PLUMBING_MESSAGE =
  "The sandbox host did not complete that command. The machine may be stopped, gone, or still booting — reload the fleet, and if it persists check the controller log.";

/**
 * The message a client may see: redacted, plumbing replaced (and logged in full server-side), then
 * trimmed. Every route error goes through this — including the ones that tail-slice, which is why
 * the substitution happens BEFORE the slice: a `.slice(-400)` of an ssh dump cuts off the
 * recognisable prefix and keeps the paths.
 */
export function clientError(e: unknown, maxLen = 2000): string {
  const msg = redactor.redact(String((e as Error)?.message ?? e));
  if (isPlumbingError(msg)) {
    console.error(`[http] ${msg}`);
    return PLUMBING_MESSAGE;
  }
  return msg.length > maxLen ? msg.slice(-maxLen) : msg;
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
      if (user.plan === "trial" && !user.trial_ends_at) {
        // First sign-in of a brand-new account: stamp the trial and seed the starter skills.
        startTrial(db, user.id, cfg.trialDays);
        void seedStarterSkills(cfg, user.id);
      }
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
      void seedStarterSkills(cfg, u.id); // best-effort: a seeding failure never fails signup
      startSession(req, res, u.id);
      res.json({ ok: true, id: u.id, login: u.login, role: u.role });
    } catch (e) {
      authThrottle.fail(client); // enumeration attempts count
      res.status(409).json({ error: clientError(e) });
    }
  });
  // Global cap on scrypt work: each verification blocks the event loop ~70 ms, and the per-client
  // throttle keys on X-Forwarded-For, which an attacker rotates freely. Whatever the headers say,
  // the controller will not do more than this much synchronous hashing per window.
  const loginWork = makeRateLimiter({ limit: 30, windowMs: 10_000 });
  app.post("/auth/login", (req: Request, res: Response) => {
    const client = clientOf(req.headers, req.socket.remoteAddress);
    const sock = req.socket.remoteAddress ?? "unknown";
    // Throttle on the socket address too — XFF is attacker-controlled, the socket is not.
    if (authThrottle.blocked(client) || (client !== sock && authThrottle.blocked(sock))) {
      res.setHeader("Retry-After", "600");
      res.status(429).json({ error: "too many attempts — try again later" });
      return;
    }
    if (!csrfOk(req.headers as Record<string, string | string[] | undefined>, cfg.publicUrl)) {
      res.status(403).json({ error: "bad origin" });
      return;
    }
    if (loginWork.over("login")) {
      res.setHeader("Retry-After", "10");
      res.status(429).json({ error: "too many attempts — try again later" });
      return;
    }
    const { login, password } = (req.body ?? {}) as { login?: string; password?: string };
    const u = typeof login === "string" && typeof password === "string" ? authenticatePassword(db, login, password) : null;
    if (!u) {
      authThrottle.fail(client);
      if (client !== sock) authThrottle.fail(sock);
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
  // The CSRF check upstream nulls the principal on a cross-site POST. Clearing the cookie anyway
  // would let any web page log the operator out at will; a forged logout must be a no-op.
  if (!p) {
    res.status(403).json({ error: "not signed in" });
    return;
  }
  if (p.kind === "user" && p.sessionId) deleteSession(db, p.sessionId);
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
  res.json({ kind: "user", mode: cfg.authMode, id: p.userId, login: p.login, name: u?.name ?? null, role: p.role, via: p.via, email: u?.email ?? null, avatarUrl: u?.avatar_url ?? null, github: !!u?.github_id, hasPassword: !!u?.password_hash, maxBoxes: u?.max_boxes ?? cfg.userMaxBoxes, ...plan, billingUrl: cfg.billingUrl ?? null, orgs: orgsOf(db, p.userId).map((o) => ({ id: o.id, name: o.name, role: o.role, members: o.members, pending: o.pending })) });
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
    void seedStarterSkills(cfg, u.id); // admin-invited accounts get the same starters as signups
    const key = createApiKey(db, u.id, "first sign-in");
    res.json({ id: u.id, login: u.login, role: u.role, token: key.token });
  } catch (e) {
    res.status(400).json({ error: clientError(e) });
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

// Signed-in devices: list and revoke browser logins. `/sessions.json` is the old name (a "session"
// elsewhere is a box); remove the alias once mobile builds older than 2026-10 have aged out.
const DEVICES_PATHS = ["/devices.json", "/sessions.json"];
app.get(DEVICES_PATHS, (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const p = principalOf(res);
  if (p.kind !== "user") {
    res.json({ sessions: [] });
    return;
  }
  res.json({ sessions: listSessions(db, p.userId).map((s) => ({ id: s.id.slice(0, 8), current: s.id === p.sessionId, createdAt: s.created_at, lastSeenAt: s.last_seen_at, ip: s.ip, userAgent: s.user_agent })) });
});
app.delete(DEVICES_PATHS, (req: Request, res: Response) => {
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

// --- Android App Links -------------------------------------------------------------------------
// The mobile app claims https://<host>/dashboard/box/* and /dashboard/pr/* (mobile/app.json
// intentFilters, autoVerify). Android only honours that claim if this file is served over HTTPS,
// unauthenticated, as application/json. The signing-cert fingerprints come from the environment
// (`keytool -list -v` / Play Console → App signing) — a self-hoster with no app simply leaves
// ANDROID_CERT_SHA256 unset and the route 404s, which is the honest answer.
app.get("/.well-known/assetlinks.json", (_req: Request, res: Response) => {
  const prints = (process.env.ANDROID_CERT_SHA256 ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (!prints.length) return res.status(404).json({ error: "no android app is linked to this host" });
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.json([
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: process.env.ANDROID_PACKAGE ?? "dev.ajeethkumar.agentsandbox",
        sha256_cert_fingerprints: prints,
      },
    },
  ]);
});

// --- the dashboard SPA (React + Tailwind, built by Vite into web/dist) ---------------------------
// Static assets are served WITHOUT the token: they are the app shell (JS/CSS/HTML) and carry no
// secrets, and a browser can't attach an Authorization header to its own <script> fetches. Every
// route that returns real data stays bearer-guarded, which is where the actual protection belongs.
const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_DIST = resolve(HERE, "..", "web", "dist");
const HAS_WEB = existsSync(join(WEB_DIST, "index.html"));

if (HAS_WEB) {
  allowShellScripts(readFileSync(join(WEB_DIST, "index.html"), "utf8"));
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

// The dashboard's fleet read: boxes + lifecycle facts (idle/max timeouts, capacity) + sleeping boxes.
// Cached ~1.5s server-side so N tabs cost one SSH sweep.
app.get("/fleet.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  // The dashboard polls this while it is open, so it doubles as "this person is here": their warm
  // box is prepared while they are still typing, not after they press send.
  if (noteOwnerActive(cfg, ownerKey(principalOf(res)))) for (const c of hostPool.warmCfgs()) kickRefill(c);
  try {
    const fleet = await readFleet();
    // Let the broker look at every waiting box (fire-and-forget; guarded once per question).
    for (const b of fleet.boxes) {
      if (b.runState === "waiting" && /^running$/i.test(b.boxStatus))
        void withOwner(ownerOf(db, b.name) ?? null, () => brokerConsider(b.name, b.question)).catch((e) =>
          console.error(`[broker] consider ${b.name} failed: ${(e as Error).message}`)
        );
    }
    // Which hosts are asleep or paused, so a thread can say "waking the host" (a minute) rather than
    // "waking the sandbox" (seconds) when its box lives on one.
    const hostsAsleep = hostPool.state().filter((h) => h.asleep).map((h) => h.id);
    if (!ownership.isUser()) {
      res.json({ ...fleet, hostsAsleep });
      return;
    }
    const p = principalOf(res);
    const max = (p.kind === "user" && getUser(db, p.userId)?.max_boxes) || cfg.userMaxBoxes;
    res.json({ ...fleet, hostsAsleep, boxes: ownership.visible(fleet.boxes), lifecycle: { ...fleet.lifecycle, capacity: Math.min(max, fleet.lifecycle.capacity || max) } });
  } catch (e) {
    failWith(res, e);
  }
});

// One box's live snapshot (what `watch` renders); ?session=… required, optional ?lines=.
// Served through the hub: a box someone is (or was just) watching answers from cache instantly.
// An explicit ?lines= bypasses the hub (different truncation → different snapshot).
app.get("/watch.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const session = boxParam(req.query);
  if (!session) {
    res.status(400).json({ error: "session query param required" });
    return;
  }
  const lines = Number(req.query.lines);
  try {
    res.json(
      Number.isInteger(lines) && lines > 0 && lines <= 5000 && !hostPool.dormant(hostPool.hostOfBox(session) ?? PRIMARY_HOST_ID)
        ? redactSnap(await gatherWatch(hcfg(session), session, lines))
        : await watchHub.read(session)
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
  const session = boxParam(req.query);
  if (session) attend(session, `open ${session}`);
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
    // The client's last bytes at `from` — proves its offset still points where it thinks in the
    // log; on mismatch streamWatch sends the full log instead of a corrupting slice.
    expectTail: typeof req.query.tail === "string" ? req.query.tail.slice(0, 256) : undefined,
    // The whole conversation, grown by appends — never the sliding tail window, which lost the
    // start of a long run and reset the transcript on every tick once it filled.
    read: (s) => watchHub.readFull(s),
  });
  // Stop the server-side tail the instant the browser goes away (tab closed, navigated, network drop)
  // so a disconnected viewer never keeps hitting SSH for a box no one is watching.
  req.on("close", stop);
});

// A launch's stages as they happen (src/launch-progress.ts): `step` frames (id = the step's index,
// so a reconnect's Last-Event-ID resumes after it), `done` once the agent has started or the launch
// failed. Same header-only auth as /watch.sse; the entry must belong to the caller. Subscribing
// before the delegate POST has opened the entry is the normal order — the browser does both at once.
app.get("/launch.sse", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const id = req.query.id;
  if (!isLaunchId(id)) {
    res.status(400).json({ error: "id query param required" });
    return;
  }
  const principal = principalOf(res);
  const owner = principal.kind === "user" ? principal.userId : OPERATOR_OWNER;
  const lastEventId = Number(req.headers["last-event-id"]);
  const from = Number.isFinite(lastEventId) && lastEventId >= 0 ? lastEventId + 1 : 0;
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`retry: 2000\n\n`);
  let closed = false;
  const beat = setInterval(() => {
    if (!closed) res.write(`: ping\n\n`);
  }, 15_000);
  const finish = () => {
    if (closed) return;
    closed = true;
    clearInterval(beat);
    res.end();
  };
  const off = launches.subscribe(
    id,
    {
      owner,
      onStep: (step, index) => {
        if (!closed) res.write(sseFrame("step", step, index));
      },
      onClose: () => {
        if (!closed) res.write(sseFrame("done", {}));
        finish();
      },
    },
    from
  );
  if (off === false) {
    // Not this caller's launch: nothing to tell, and nothing to reveal.
    res.write(sseFrame("done", {}));
    finish();
    return;
  }
  req.on("close", () => {
    off();
    finish();
  });
});

// Download / preview a file the agent produced inside a box's /workspace. Same header-only dashAuthed
// guard as the other data routes; the client fetches the bytes and saves them as a blob. Path handling is
// hostile-input hardened in artifact.ts: pure-layer rejects, then an on-box realpath + regular-file +
// size check before any bytes are read. Never serves text/html; unknown types force a download.
app.get("/artifact", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const session = boxParam(req.query);
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
    const result = await readArtifact(hcfg(session), session, path);
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
    res.setHeader("Content-Disposition", contentDisposition(disposition, name));
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
  const session = boxParam(req.body);
  const { question, newThread } = (req.body ?? {}) as { question?: string; newThread?: boolean };
  if (!session || !question?.trim()) {
    res.status(400).json({ error: "session and question are required" });
    return;
  }
  try {
    // Read-only gh needs GH_TOKEN in env (nothing persists in the box) — resolve the box owner's
    // default account so `gh pr checks` etc. work in the ask lane too. Best-effort.
    const creds = await withOwner(ownerOf(db, session) ?? null, () => resolveCredsForBox(hcfg(session), session)).catch(() => undefined);
    const [result, driverState] = await Promise.all([
      askInBox(hcfg(session), session, question, { newThread: !!newThread, ghToken: creds?.primaryToken }),
      driverStateLine(hcfg(session), session),
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
  const session = boxParam(req.body);
  const { message, force, model, secrets } = (req.body ?? {}) as { message?: string; force?: boolean; model?: string; secrets?: unknown };
  if (!session || !message?.trim()) {
    res.status(400).json({ error: "session and message are required" });
    return;
  }
  attend(session, `reply ${session}`);
  // One-shot secrets (the Resolve row): -e flags on this turn only, same rules as the MCP resume
  // tool (src/secret-env.ts refuses reserved names when the flags are built). Never stored here.
  const oneShot: Record<string, string> = {};
  if (secrets !== undefined) {
    if (!secrets || typeof secrets !== "object" || Array.isArray(secrets)) return void res.status(400).json({ error: "secrets must be an object of NAME: value" });
    for (const [k, v] of Object.entries(secrets)) {
      if (typeof v !== "string") return void res.status(400).json({ error: `secret ${k} must be text` });
      oneShot[k] = v;
    }
  }
  try {
    // Per-message model switch: validate against the catalog, then make it STICK for this box —
    // every later lane (inbox delivery, send-now, broker, question answers) uses the sticky value
    // unless a new explicit pick replaces it. Cursor semantics: the picker holds until changed.
    if (model?.trim()) {
      const catalog = await fetchModels(cfg).catch(() => []);
      if (!isAllowedModel(model.trim(), catalog, cfg)) {
        res.status(400).json({ error: `Unknown model '${model}'. Allowed: ${[cfg.anthropicModel, ...catalog.map((m) => m.id)].filter((v, i, a) => a.indexOf(v) === i).join(", ")}` });
        return;
      }
      boxModels.set(session, model.trim());
    }
    // `/compact` is a command to the CLI, not words for the agent: only drivers that implement it
    // take it (an omp/codex thread would receive the literal text as a task).
    const compact = isCompactCommand(message);
    if (compact) {
      const agent = (await watchHub.read(session)).agent ?? "claude";
      if (!isAgentKind(agent) || !driverFor(agent).capabilities.compact) {
        res.status(400).json({ error: `/compact works on Claude Code threads; this thread runs ${isAgentKind(agent) ? AGENT_LABELS[agent] : agent}.` });
        return;
      }
    }
    // The box's host first: the read below would otherwise SSH a paused VM (and the provider's proxy
    // would begin a slow resume behind our back) before the reply's own wait for the host.
    await hostPool.readyForBox(session, `message ${session}`);
    // Mid-turn: a second `claude -c` would race the running one, so the message waits in the inbox
    // and is delivered the moment the run finishes. `force` (answering a question) bypasses.
    if (!force) {
      const snap = await watchHub.read(session);
      if (snap.runState === "running") {
        // Anything typed after a queued /compact waits behind it, so it is not mirrored either.
        const behindCompact = compact || inbox.list(session).some((m) => isCompactCommand(m.text));
        const q = inbox.enqueue(session, message);
        // Mirror it into the box: the gate delivers it at the agent's next tool call, inside the
        // turn (src/drivers/inbox-gate.ts). Best-effort — turn-end delivery is the fallback. Never a
        // /compact: compacting is its own turn, after this one ends.
        if (!behindCompact) mirrorInboxMessage(hcfg(session), session, q).catch((e) => console.error(`[inbox] mirror to ${session} failed: ${(e as Error).message}`));
        res.json({ queued: true, id: q.id, delivery: behindCompact ? "turn-end" : "next-step" });
        return;
      }
    }
    await resumeQuietly(session, message, Object.keys(oneShot).length ? oneShot : undefined);
    res.json({ ok: true });
  } catch (e) {
    failWith(res, e);
  }
});

// The model catalog for the dashboard picker: ccproxy's Claude aliases, labeled and tiered, plus
// which one is the default and any per-box sticky picks.
app.get("/models.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  try {
    const models = await fetchModels(cfg);
    const session = boxParam(req.query);
    res.json({
      default: cfg.anthropicModel,
      current: (session && boxModels.get(session)) || cfg.anthropicModel,
      models,
    });
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
  const session = boxParam(req.body);
  const { id } = (req.body ?? {}) as { id?: string };
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
    await withOwner(ownerOf(db, session) ?? null, () => interruptAgentRun(hcfg(session), session));
    await resumeQuietly(session, msg.text);
    res.json({ ok: true, queued: inbox.list(session) });
  } catch (e) {
    inbox.enqueue(session, msg.text, msg.at);
    failWith(res, e);
  }
});

// Stop the running turn without removing anything: the "Stop" on a watch (a monitoring loop the
// agent keeps going until told otherwise). Same interrupt as send-now (the session survives, so a
// later message resumes it with `claude -c`), just with no message to deliver.
app.post("/interrupt.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const session = boxParam(req.body);
  if (!session) {
    res.status(400).json({ error: "session is required" });
    return;
  }
  try {
    // No reason in the seam: "Stopped by you" is the whole story (a watch, a loop, a wrong turn).
    const stopped = await withOwner(ownerOf(db, session) ?? null, () => interruptAgentRun(hcfg(session), session, ""));
    res.json({ ok: true, stopped });
  } catch (e) {
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
    const store = await withStoreLock("gh", async () => {
      const s = upsertAccount(await loadStore(cfg), acc);
      await saveStore(cfg, s);
      return s;
    });
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
    const store = await withStoreLock("gh", async () => {
      const s = removeAccount(await loadStore(cfg), login);
      await saveStore(cfg, s);
      return s;
    });
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
    const store = await withStoreLock("gh", async () => {
      const s = setDefaultAccount(await loadStore(cfg), login);
      await saveStore(cfg, s);
      return s;
    });
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
    const store = await withStoreLock("gh", async () => {
      const s = upsertAccount(await loadStore(cfg), acc);
      await saveStore(cfg, s);
      return s;
    });
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
  const session = boxParam(req.body);
  const { repo, ref } = (req.body ?? {}) as { repo?: string; ref?: string };
  if (!isBoxName(session) || !repo || !/^[\w.-]+\/[\w.-]+$/.test(repo.trim())) {
    res.status(400).json({ error: "session and repo (owner/name) are required" });
    return;
  }
  try {
    const r = await attachRepoToBox(hcfg(session), session, repo.trim(), ref?.trim() || undefined);
    inbox.enqueue(session, `The repository ${repo.trim()} is now checked out at /workspace/${r.name}${ref ? ` (ref ${ref})` : ""}. Use it for the task where relevant.`);
    res.json({ ok: true, name: r.name, login: r.login });
  } catch (e) {
    failWith(res, e);
  }
});

/* ───────────────────────────── organisations (src/orgs.ts) ───────────────────────────── */

/** Signed-in people only: the operator token has no email, no org, nothing to share. */
function userOf(res: Response): Extract<Principal, { kind: "user" }> | null {
  const p = principalOf(res);
  if (p.kind !== "user") {
    res.status(403).json({ error: "organisations belong to signed-in people — sign in to use them" });
    return null;
  }
  return p;
}
/** The org a request names plus the caller's role in it; 404 when either is missing (no existence oracle). */
function orgOf(req: Request, res: Response, need: "member" | "manage" | "owner"): { id: string; role: OrgRole } | null {
  const p = userOf(res);
  if (!p) return null;
  const raw = (req.body as { org?: unknown } | undefined)?.org ?? req.query.org;
  const id = typeof raw === "string" ? raw : "";
  const role = id ? orgRole(db, id, p.userId) : null;
  if (!role || (need === "manage" && !canManage(role)) || (need === "owner" && role !== "owner")) {
    res.status(role ? 403 : 404).json({ error: role ? "only the organisation's owner or an admin can do that" : "no such organisation" });
    return null;
  }
  return { id, role };
}
/**
 * `?org=` (or `org` in the body) on the MCP, skills and memory routes scopes them to an
 * organisation's stores: the same routes, under the org's owner key. Reads need membership, writes
 * an admin. The audit row keeps the real person (res.locals.principal); only the ambient owner
 * the stores read changes.
 */
const ORG_SCOPED = ["/mcp-servers.json", "/mcp-servers/test.json", "/skills.json", "/memory-notes.json", "/memory-import.json", "/memory-export.md", "/memory-promote.json"];
app.use(ORG_SCOPED, (req: Request, res: Response, next) => {
  const raw = (MUTATING.has(req.method) ? (req.body as { org?: unknown } | undefined)?.org : undefined) ?? req.query.org;
  if (typeof raw !== "string" || !raw) return next();
  if (!dashAuthed(req, res)) return;
  const scope = orgOf(req, res, MUTATING.has(req.method) ? "manage" : "member");
  if (!scope) return;
  res.locals.orgScope = scope;
  withPrincipal({ kind: "user", userId: scope.id, login: "", role: "user", via: "apikey" }, next);
});
/** For a signed-in member on an unscoped list: each organisation's view of the same store. */
async function sharedViews<T>(res: Response, view: () => Promise<T> | T): Promise<Array<{ org: { id: string; name: string; role: OrgRole }; data: T }>> {
  const p = principalOf(res);
  if (p.kind !== "user" || res.locals.orgScope) return [];
  const out: Array<{ org: { id: string; name: string; role: OrgRole }; data: T }> = [];
  for (const o of orgsOf(db, p.userId)) {
    try {
      out.push({ org: { id: o.id, name: o.name, role: o.role }, data: await withOwner(o.id, () => Promise.resolve(view())) });
    } catch (e) {
      console.error(`[orgs] could not read ${o.id}:`, (e as Error).message);
    }
  }
  return out;
}
/**
 * After a person saves one of their OWN servers, skills or notes: every organisation copy of it
 * ("From yours", stamped `from`) follows, in each organisation the person can still manage —
 * src/orgs.ts followSkill / followServer / followNote decide per org store. Runs after the
 * person's own save, under each org's store lock, and never fails that save: an org whose store
 * cannot be written is logged and skipped. Returns the names of the organisations whose copy
 * changed, for the dashboard's toast. Nothing happens on an org-scoped request (that IS the org's
 * copy being edited) or for the operator identity (no orgs).
 */
async function followIntoOrgs(res: Response, kind: "skills" | "mcp" | "memory", apply: (who: { user: string; login: string }) => Promise<boolean> | boolean): Promise<string[]> {
  const p = principalOf(res);
  if (p.kind !== "user" || res.locals.orgScope) return [];
  const who = { user: p.userId, login: p.login };
  const followed: string[] = [];
  for (const o of orgsOf(db, p.userId)) {
    if (!canManage(o.role)) continue;
    try {
      if (await withOwner(o.id, () => withStoreLock(kind, async () => apply(who)))) followed.push(o.name);
    } catch (e) {
      console.error(`[orgs] ${kind}: could not update ${o.id}'s copy:`, (e as Error).message);
    }
  }
  return followed;
}
app.get("/orgs.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const p = userOf(res);
  if (!p) return;
  res.json({ orgs: orgsOf(db, p.userId) });
});
app.post("/orgs.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const p = userOf(res);
  if (!p) return;
  try {
    const o = createOrg(db, p.userId, (req.body as { name?: unknown } | undefined)?.name);
    res.locals.auditAction = "org.create";
    const orgs = orgsOf(db, p.userId);
    res.json({ org: orgs.find((x) => x.id === o.id), orgs });
  } catch (e) {
    res.status(400).json({ error: clientError(e) });
  }
});
app.post("/orgs/update.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const scope = orgOf(req, res, "manage");
  if (!scope) return;
  try {
    renameOrg(db, scope.id, (req.body as { name?: unknown }).name);
    res.locals.auditAction = "org.rename";
    res.json({ ok: true, orgs: orgsOf(db, userOf(res)!.userId) });
  } catch (e) {
    res.status(400).json({ error: clientError(e) });
  }
});
app.delete("/orgs.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const scope = orgOf(req, res, "owner");
  if (!scope) return;
  deleteOrg(db, scope.id);
  res.locals.auditAction = "org.delete";
  res.json({ ok: true, orgs: orgsOf(db, userOf(res)!.userId) });
});
app.get("/orgs/members.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const scope = orgOf(req, res, "member");
  if (!scope) return;
  const org = getOrg(db, scope.id)!;
  res.json({ org: { id: org.id, name: org.name, role: scope.role, ownerId: org.owner_id }, members: listMembers(db, scope.id) });
});
app.post("/orgs/members.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const scope = orgOf(req, res, "manage");
  if (!scope) return;
  const { emails, role } = req.body as { emails?: unknown; role?: unknown };
  try {
    const r = addMembers(db, scope.id, String(emails ?? ""), userOf(res)!.userId, role === "admin" ? "admin" : "member");
    res.locals.auditAction = "org.invite";
    res.json({ ...r, members: listMembers(db, scope.id) });
  } catch (e) {
    res.status(400).json({ error: clientError(e) });
  }
});
app.delete("/orgs/members.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const scope = orgOf(req, res, "manage");
  if (!scope) return;
  const email = String((req.body as { email?: unknown }).email ?? "");
  // An admin may not remove another admin — that is the owner's call.
  const target = listMembers(db, scope.id).find((m) => m.email === email.toLowerCase());
  if (target?.role === "admin" && scope.role !== "owner") {
    res.status(403).json({ error: "only the owner can remove an admin" });
    return;
  }
  removeMember(db, scope.id, email);
  res.locals.auditAction = "org.remove";
  res.json({ ok: true, members: listMembers(db, scope.id) });
});
/**
 * The invite field's "@" typeahead: people on the site whose login starts with the typed text
 * (they link the moment they are added), then GitHub's user search for the rest. GitHub is asked
 * from here because the dashboard's CSP keeps the browser on this origin; one stored GitHub account
 * of the caller lifts the unauthenticated 10-a-minute limit, and a 403/429 pauses the lookup until
 * the window resets rather than hammering it. Answers are cached a few minutes per prefix.
 */
const PEOPLE_SEARCH_TTL_MS = 5 * 60_000;
const peopleSearchCache = new Map<string, { at: number; hits: Omit<PersonHit, "status">[] }>();
let peopleSearchPausedUntil = 0;
app.get("/orgs/people-search.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const scope = orgOf(req, res, "manage");
  if (!scope) return;
  const q = String(req.query.q ?? "").trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9](?:-?[a-z0-9]){0,38}$/.test(q)) {
    res.json({ people: [], github: "skipped" });
    return;
  }
  const standing = new Map<string, PersonHit["status"]>();
  for (const m of listMembers(db, scope.id)) if (m.login) standing.set(m.login.toLowerCase(), m.role);
  for (const m of listMembers(db, scope.id)) if (m.status === "invited" && m.email.startsWith("@")) standing.set(m.email.slice(1), "invited");
  const people: PersonHit[] = searchUsersByLogin(db, q, 6).map((p) => ({ ...p, status: standing.get(p.login.toLowerCase()) ?? null }));
  let github: "ok" | "limited" | "error" | "skipped" = "skipped";
  if (q.length >= 2) {
    const cached = peopleSearchCache.get(q);
    let found: Omit<PersonHit, "status">[] | undefined = cached && Date.now() - cached.at < PEOPLE_SEARCH_TTL_MS ? cached.hits : undefined;
    if (found) github = "ok";
    else if (Date.now() < peopleSearchPausedUntil) github = "limited";
    else {
      try {
        const token = pickDefaultAccount(await loadStore(cfg))?.token;
        const r = await fetch(`https://api.github.com/search/users?q=${encodeURIComponent(`${q} in:login`)}&per_page=8`, {
          headers: { accept: "application/vnd.github+json", "user-agent": "agent-sandbox", ...(token ? { authorization: `Bearer ${token}` } : {}) },
          signal: AbortSignal.timeout(8_000),
        });
        if (r.status === 403 || r.status === 429) {
          const rate = rateInfoOf(r.headers);
          peopleSearchPausedUntil = Date.now() + Math.min(rate.retryAfterMs ?? (rate.resetAt ? Math.max(rate.resetAt - Date.now(), 5_000) : 60_000), 10 * 60_000);
          github = "limited";
        } else if (!r.ok) github = "error";
        else {
          const j = (await r.json()) as { items?: Array<{ login?: string; avatar_url?: string }> };
          found = (j.items ?? []).filter((u): u is { login: string; avatar_url?: string } => typeof u.login === "string").map((u) => ({ login: u.login, name: null, avatarUrl: u.avatar_url ?? null, onSite: false }));
          peopleSearchCache.set(q, { at: Date.now(), hits: found });
          if (peopleSearchCache.size > 500) peopleSearchCache.delete(peopleSearchCache.keys().next().value as string);
          github = "ok";
        }
      } catch {
        github = "error";
      }
    }
    const seen = new Set(people.map((p) => p.login.toLowerCase()));
    for (const h of found ?? []) {
      if (seen.has(h.login.toLowerCase()) || people.length >= 10) continue;
      seen.add(h.login.toLowerCase());
      people.push({ ...h, status: standing.get(h.login.toLowerCase()) ?? null });
    }
  }
  res.json({ people, github });
});
app.post("/orgs/members/role.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const scope = orgOf(req, res, "owner");
  if (!scope) return;
  const { email, role } = req.body as { email?: unknown; role?: unknown };
  if (role !== "admin" && role !== "member") {
    res.status(400).json({ error: "role must be admin or member" });
    return;
  }
  setMemberRole(db, scope.id, String(email ?? ""), role);
  res.locals.auditAction = "org.role";
  res.json({ ok: true, members: listMembers(db, scope.id) });
});
app.post("/orgs/leave.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const scope = orgOf(req, res, "member");
  if (!scope) return;
  if (scope.role === "owner") {
    res.status(400).json({ error: "the owner cannot leave — hand the organisation to someone or delete it" });
    return;
  }
  leaveOrg(db, scope.id, userOf(res)!.userId);
  res.locals.auditAction = "org.leave";
  res.json({ ok: true, orgs: orgsOf(db, userOf(res)!.userId) });
});
// Copy some of the caller's own servers / skills / memory notes into an organisation they manage.
// Done here, not in the browser, because the browser only ever sees masked secrets: the org's copy
// of a server gets the real env and headers. {org, servers?: string[], skills?: string[], notes?: string[]}
app.post("/orgs/copy.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const scope = orgOf(req, res, "manage");
  if (!scope) return;
  const body = (req.body ?? {}) as { servers?: unknown; skills?: unknown; notes?: unknown };
  const names = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 200) : []);
  const want = { servers: names(body.servers), skills: names(body.skills), notes: names(body.notes) };
  if (!want.servers.length && !want.skills.length && !want.notes.length) {
    res.status(400).json({ error: "nothing to copy" });
    return;
  }
  const me = userOf(res);
  if (!me) return;
  try {
    // The caller's own stores, under the caller's principal.
    const ownMcp = want.servers.length ? await loadMcpStore(cfg) : null;
    const ownSkills = want.skills.length ? await loadSkillStore(cfg) : null;
    const ownMemory = want.notes.length ? loadMemoryStore() : null;
    const copied = { servers: [] as string[], skills: [] as string[], notes: 0 };
    const now = Date.now();
    // Each copy is stamped with its source, so the caller's later saves of the original reach it
    // (followIntoOrgs). The org's copy is enabled regardless of the original's own switch.
    const from = (name?: string) => ({ user: me.userId, login: me.login, ...(name ? { name } : {}), at: now });
    await withOwner(scope.id, async () => {
      if (ownMcp) {
        const store = await loadMcpStore(cfg);
        for (const name of want.servers) {
          const s = ownMcp.servers[name];
          if (!s) continue;
          store.servers[name] = { ...structuredClone(s), addedAt: now, from: from(name) };
          copied.servers.push(name);
        }
        await saveMcpStore(cfg, store);
      }
      if (ownSkills) {
        const store = await loadSkillStore(cfg);
        for (const name of want.skills) {
          const s = ownSkills.skills[name];
          if (!s) continue;
          store.skills[name] = { ...structuredClone(s), addedAt: store.skills[name]?.addedAt ?? now, updatedAt: now, from: from(name) };
          copied.skills.push(name);
        }
        await saveSkillStore(cfg, store);
      }
      if (ownMemory) {
        const store = loadMemoryStore();
        const mine = [...ownMemory.global, ...Object.values(ownMemory.repos).flat()];
        for (const id of want.notes) {
          const n = mine.find((x) => x.id === id);
          if (!n || n.until != null || n.status !== "kept") continue;
          const list = n.scope === "repo" && n.repo ? (store.repos[n.repo] ??= []) : store.global;
          if (list.some((x) => x.id === n.id)) continue;
          const { uses: _u, lastUsed: _l, stale: _s, from: _f, ...rest } = n;
          list.push({ ...structuredClone(rest), source: "you", at: now, from: from() });
          copied.notes++;
        }
        saveMemoryStore(store);
      }
    });
    res.locals.auditAction = "org.copy";
    res.json({ ok: true, copied });
  } catch (e) {
    res.status(400).json({ error: clientError(e) });
  }
});

app.post("/orgs/transfer.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const scope = orgOf(req, res, "owner");
  if (!scope) return;
  const to = String((req.body as { userId?: unknown }).userId ?? "");
  if (!transferOrg(db, scope.id, to)) {
    res.status(400).json({ error: "hand-over needs a member who has already signed in" });
    return;
  }
  res.locals.auditAction = "org.transfer";
  res.json({ ok: true, orgs: orgsOf(db, userOf(res)!.userId) });
});

// MCP servers for the sandbox agent. GET lists (secrets masked); POST mutates:
//   {action:"upsert", server:{name,type,command,args,url,env,headers,enabled}}
//   {action:"import", json:"<{mcpServers:{...}}>"}  {action:"remove", name}  {action:"toggle", name, enabled}
app.get("/mcp-servers.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  try {
    const store = await loadMcpStore(cfg);
    // How each npx server's package reaches a box (src/package-watch.ts): baked into the image, an
    // install on every task start, or dropped from the last run. Known once a box has reported.
    const { baked, last } = mcpProvisionState();
    // Until a box has reported its manifest (the first task start after a controller restart)
    // nothing is known, and "per-run" for everything would be a guess dressed as a fact.
    const known = Object.keys(baked).length > 0;
    // Why a server stays out of every box: it can only run on the operator's machine, or it carries
    // the controller's own operator token (src/mcp-store.ts boxExclusion). Computed on the unmasked
    // store — the view has already masked the token.
    const policy = boxSecretPolicy(cfg);
    const servers = viewServers(store).map((s) => {
      const spec = npxSpecOf(s);
      const excluded = boxExclusion(store.servers[s.name], policy);
      return { ...s, ...(spec && known ? { provision: provisionOf(spec, baked, last) } : {}), ...(excluded ? { excluded } : {}) };
    });
    // A member also sees what each organisation shares with them, read-only, under the org's key.
    const shared = (await sharedViews(res, async () => viewServers(await loadMcpStore(cfg)))).map((s) => ({ org: s.org, servers: s.data }));
    res.json({ servers, config: toEditableConfig(store), baked, lastProvision: last, ...(shared.length ? { shared } : {}) });
  } catch (e) {
    failWith(res, e);
  }
});
/** The npm package spec an `npx` stdio server runs, by the same rule msb.ts npxPackagesOf uses. */
const npxSpecOf = (s: { type?: string; command?: string; args?: string[] }): string | undefined => {
  if (s.type !== "stdio" || s.command !== "npx") return undefined;
  const spec = (s.args ?? []).find((a) => a && !a.startsWith("-"));
  return spec && /^(@[\w.-]+\/)?[\w.-]+(@[\w.^~-]+)?$/.test(spec) && !/^https?:/.test(spec) ? spec : undefined;
};
app.post("/mcp-servers.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const action = body.action;
  if (!["upsert", "import", "replace", "remove", "toggle"].includes(String(action))) {
    res.status(400).json({ error: "unknown action" });
    return;
  }
  try {
    // What changed, for the organisation copies that follow this server (followIntoOrgs).
    let change: { name: string; before?: McpServerDef; after?: McpServerDef } | undefined;
    const store = await withStoreLock("mcp", async () => {
      const store = await loadMcpStore(cfg);
      if (action === "upsert") {
        const s = normalizeServer(body.server as Partial<McpServerDef> & { name: string });
        // Rename: the entry moves under the new name and the old one goes.
        const previous = typeof body.previousName === "string" ? body.previousName : "";
        const before = store.servers[previous && previous !== s.name ? previous : s.name];
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
        // An organisation's copy edited in place stays a copy: the form never sends the stamp.
        if (before?.from) s.from = before.from;
        store.servers[s.name] = s;
        change = { name: previous || s.name, before, after: s };
      } else if (action === "import") {
        for (const s of parseMcpImport(String(body.json ?? ""))) store.servers[s.name] = s;
      } else if (action === "replace") {
        // The JSON editor saved the whole config.
        const next = replaceFromJson(store, String(body.json ?? ""));
        store.servers = next.servers;
      } else if (action === "remove") {
        const name = String(body.name ?? "");
        change = { name, before: store.servers[name] };
        delete store.servers[name];
      } else if (action === "toggle") {
        const s = store.servers[String(body.name ?? "")];
        if (s) s.enabled = body.enabled !== false;
      }
      await saveMcpStore(cfg, store);
      return store;
    });
    const c = change;
    const followed = c
      ? await followIntoOrgs(res, "mcp", async (who) => {
          const org = await loadMcpStore(cfg);
          if (!followServer(org, who, c.name, c.before, c.after)) return false;
          await saveMcpStore(cfg, org);
          return true;
        })
      : [];
    res.json({ servers: viewServers(store), config: toEditableConfig(store), ...(followed.length ? { followed } : {}) });
  } catch (e) {
    res.status(400).json({ error: clientError(e) });
  }
});

// Test one MCP server from the controller: the same `initialize` handshake the in-box claude does.
// This is how the operator learns WHY a server is missing from the agent's tool list (claude drops
// servers that fail to connect, silently) — most often an expired static token, called out by name.
app.post("/mcp-servers/test.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const name = String((req.body as Record<string, unknown> | undefined)?.name ?? "");
  try {
    const store = await loadMcpStore(cfg);
    const server = store.servers[name];
    if (!server) {
      res.status(404).json({ error: "no such server" });
      return;
    }
    res.json(await probeMcpServer(server));
  } catch (e) {
    failWith(res, e);
  }
});

// Skills: the owner's reusable playbooks, synced into every box before each run/resume. Same shape
// of API as the MCP servers: one GET for the list, one POST with an action.
// Walk-away notifications: view / set the caller's webhook and per-event toggles. The webhook is
// per OWNER (encrypted blob, like skills) so each tenant routes their own boxes' events; the
// NOTIFY_WEBHOOK_URL env is the deployment-wide fallback when an owner has none configured.
// Default coding agent (Claude Code vs oh-my-pi): per-owner encrypted blob, same pattern as the
// notify settings. The pick applies to NEW threads only; a running thread keeps the agent it
// started on (the box's .agent.kind mark is the per-thread truth).
/** The agent picker's choices: each driver with its capability badges and supervision floor. */
function agentChoices() {
  return listDrivers().map((d) => ({ id: d.kind, label: d.label, capabilities: d.capabilities, supervised: d.supervised }));
}
app.get("/agent-prefs.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const p = principalOf(res);
  res.json({
    ...loadAgentPrefs(p.kind === "user" ? p.userId : OPERATOR_OWNER),
    agents: agentChoices(),
    // What an owner who never chose gets (Config.codeModeDefault), so the control shows the truth.
    codeModeDefault: cfg.codeModeDefault,
  });
});
app.post("/agent-prefs.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const p = principalOf(res);
  try {
    // A body without `autoCompact` (the driver picker) keeps the stored one: the two settings are
    // saved from different controls and neither may silently reset the other.
    const body = { ...((req.body ?? {}) as Record<string, unknown>) };
    // Same for `codeMode` (code mode for MCP, off unless "on"): no body that lacks it may turn it off.
    const stored = loadAgentPrefs(p.kind === "user" ? p.userId : OPERATOR_OWNER);
    if (!("autoCompact" in body)) body.autoCompact = stored.autoCompact;
    if (!("codeMode" in body)) body.codeMode = stored.codeMode;
    const prefs = normalizeAgentPrefs(body);
    assertSelectable(prefs.defaultAgent, (req.body as { allowPartialSupervision?: unknown } | undefined)?.allowPartialSupervision === true);
    saveAgentPrefs(prefs, p.kind === "user" ? p.userId : OPERATOR_OWNER);
    forgetOwnerAgent(ownerKey(p));
    // The pool follows this setting (only the picked agent's flavor stays warm) — reconcile now
    // instead of waiting for the maintainer tick, so the first task after switching is warm too.
    for (const c of hostPool.warmCfgs()) void refillPool(c);
    res.json({ ...prefs, agents: agentChoices(), codeModeDefault: cfg.codeModeDefault });
  } catch (e) {
    res.status(400).json({ error: clientError(e) });
  }
});

// Model providers (src/providers.ts): per-owner, keys sealed at rest and returned masked only.
const providerOwner = (res: Response): string => {
  const p = principalOf(res);
  return p.kind === "user" ? p.userId : OPERATOR_OWNER;
};
const providersPayload = (owner: string) => ({
  providers: loadProviders(owner).map(viewOf),
  kinds: PROVIDER_KINDS.map((k) => ({ id: k, label: PROVIDER_LABELS[k], drivers: driversFor(k) })),
  cliLoginPolicy: CLI_LOGIN_POLICY,
});
app.get("/providers.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  res.json(providersPayload(providerOwner(res)));
});
app.post("/providers.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const owner = providerOwner(res);
  try {
    const body = (req.body ?? {}) as { id?: unknown };
    const rec = upsertProvider(req.body, typeof body.id === "string" && body.id ? body.id : undefined, owner);
    void redactor.prime(); // the new key is redacted from transcripts from now on
    res.json({ ...providersPayload(owner), saved: rec.id });
  } catch (e) {
    res.status(400).json({ error: clientError(e) });
  }
});
app.post("/providers/delete.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const owner = providerOwner(res);
  const id = (req.body as { id?: unknown } | undefined)?.id;
  if (typeof id !== "string" || !deleteProvider(id, owner)) {
    res.status(404).json({ error: "no such provider" });
    return;
  }
  res.json(providersPayload(owner));
});
app.post("/providers/models.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const owner = providerOwner(res);
  const b = (req.body ?? {}) as { id?: unknown; force?: unknown };
  if (typeof b.id !== "string" || !getProvider(b.id, owner)) {
    res.status(404).json({ error: "no such provider" });
    return;
  }
  res.json(await refreshModels(b.id, { force: b.force === true, owner }));
});

// Repo setup profiles (src/setup-profile.ts): list / edit / reset, per caller. An edit is stamped
// confirmedBy "user" and is never overwritten by a run; a reset makes the next run re-detect.
const SETUP_REPO_RE = /^[\w.-]+\/[\w.-]+$/;
const setupPayload = (owner: string) => ({ profiles: listSetups(db, owner) });
app.get("/repo-setup.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  res.json(setupPayload(providerOwner(res)));
});
app.post("/repo-setup.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const owner = providerOwner(res);
  const b = (req.body ?? {}) as { repo?: unknown; profile?: unknown };
  if (typeof b.repo !== "string" || !SETUP_REPO_RE.test(b.repo.trim().replace(/\.git$/i, ""))) {
    res.status(400).json({ error: "repo must be owner/name" });
    return;
  }
  const prev = getSetup(db, owner, b.repo);
  const input = { ...(b.profile && typeof b.profile === "object" ? b.profile : {}), ...(prev ? { detectedAt: prev.detectedAt } : {}) };
  saveSetup(db, owner, b.repo, input, "user");
  res.json(setupPayload(owner));
});
app.post("/repo-setup/delete.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const owner = providerOwner(res);
  const repo = (req.body as { repo?: unknown } | undefined)?.repo;
  if (typeof repo !== "string" || !deleteSetup(db, owner, repo)) {
    res.status(404).json({ error: "no setup profile for that repo" });
    return;
  }
  res.json(setupPayload(owner));
});

// Secrets vault (src/secrets-store.ts). GET lists names + who they are granted to (harnesses whose
// `secrets` list names them, repo setup profiles whose envVars do) — never a value. POST
// {action:"save", name, value, repo?} stores (and with `repo`, grants it to that repo's profile);
// {action:"remove", name} deletes the value and every grant that named it.
const secretsPayload = (owner: string) => {
  const harnesses = loadHarnesses(owner);
  const setups = listSetups(db, owner);
  return {
    secrets: listSecrets(db, owner).map((s) => ({
      ...s,
      grantedTo: [
        ...harnesses.filter((h) => h.secrets?.includes(s.name)).map((h) => ({ kind: "harness" as const, id: h.id, label: h.name })),
        ...setups.filter((r) => r.profile.envVars.includes(s.name)).map((r) => ({ kind: "repo" as const, id: r.repo, label: r.repo })),
      ],
    })),
  };
};
app.get("/secrets.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  res.json(secretsPayload(providerOwner(res)));
});
app.post("/secrets.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const owner = providerOwner(res);
  const b = (req.body ?? {}) as { action?: unknown; name?: unknown; value?: unknown; repo?: unknown };
  try {
    if (b.action === "save") {
      const meta = saveSecret(db, secretBox, owner, b.name, b.value);
      res.locals.auditAction = "secret.save";
      if (typeof b.repo === "string" && b.repo) {
        if (!SETUP_REPO_RE.test(b.repo.trim().replace(/\.git$/i, ""))) throw new Error("repo must be owner/name");
        const prev = getSetup(db, owner, b.repo);
        if (!prev?.envVars.includes(meta.name)) saveSetup(db, owner, b.repo, { ...prev, envVars: [...(prev?.envVars ?? []), meta.name] }, prev?.confirmedBy ?? "user");
      }
      void redactor.prime();
    } else if (b.action === "remove") {
      const name = secretName(b.name);
      if (!deleteSecret(db, owner, name)) return void res.status(404).json({ error: "no secret by that name" });
      res.locals.auditAction = "secret.remove";
      for (const h of loadHarnesses(owner)) if (h.secrets?.includes(name)) putHarness({ ...h, secrets: h.secrets.filter((n) => n !== name) }, owner);
      for (const r of listSetups(db, owner)) if (r.profile.envVars.includes(name)) saveSetup(db, owner, r.repo, { ...r.profile, envVars: r.profile.envVars.filter((n) => n !== name) }, r.profile.confirmedBy);
      void redactor.prime();
    } else {
      return void res.status(400).json({ error: "action must be save or remove" });
    }
    res.json(secretsPayload(owner));
  } catch (e) {
    res.status(400).json({ error: clientError(e) });
  }
});

app.get("/notify.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const p = principalOf(res);
  res.json({
    ...loadNotifySettings(p.kind === "user" ? p.userId : OPERATOR_OWNER),
    fallbackConfigured: Boolean(process.env.NOTIFY_WEBHOOK_URL),
  });
});
app.post("/notify.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const p = principalOf(res);
  try {
    const s = normalizeNotifySettings((req.body ?? {}) as { url?: unknown; events?: unknown });
    saveNotifySettings(p.kind === "user" ? p.userId : OPERATOR_OWNER, s);
    res.json({ ...s, fallbackConfigured: Boolean(process.env.NOTIFY_WEBHOOK_URL) });
  } catch (e) {
    res.status(400).json({ error: clientError(e) });
  }
});
// Fire a test event at the stored webhook so the operator can confirm the wiring without waiting
// for a real run to finish.
app.post("/notify/test.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const p = principalOf(res);
  const s = loadNotifySettings(p.kind === "user" ? p.userId : OPERATOR_OWNER);
  // Only the caller's OWN webhook is testable on demand. The operator fallback still delivers real
  // sweep events, but letting any tenant fire it at will would hand them an on-demand request
  // generator against the operator's endpoint.
  const url = s.url || (p.kind === "operator" ? process.env.NOTIFY_WEBHOOK_URL || "" : "");
  if (!url) {
    res.status(400).json({ error: "no webhook configured — set one first" });
    return;
  }
  const msg = formatNotification({ box: "test", kind: "done", exitCode: 0 }, { publicUrl: cfg.publicUrl ?? "", title: "Test notification" });
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 5000);
    // fetchPinned: re-vets the URL (stored blobs may predate stricter validation) and pins the
    // resolved IP — this endpoint must never become a status oracle against internal hosts.
    const r = await fetchPinned(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: msg.text, url: msg.url, event: msg.event }), signal: ac.signal }).finally(() => clearTimeout(t));
    res.json({ ok: r.ok, status: r.status });
  } catch (e) {
    res.status(502).json({ error: `webhook unreachable: ${String((e as Error).message ?? e).slice(0, 200)}` });
  }
});

// Answer a question from a notification action (docs/plan-demo-parity.md bet 1). Auth is the normal
// dashboard auth (the app's stored session); the nonce binds the tap to ONE (owner, box, question)
// so a stale push can never answer a newer question. Answers once; a replay of the same choice is
// an idempotent success, a different choice after the first is 409.
app.post("/questions/answer.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const p = principalOf(res);
  const owner = p.kind === "user" ? p.userId : OPERATOR_OWNER;
  const b = (req.body ?? {}) as { box?: unknown; nonce?: unknown; choice?: unknown };
  if (typeof b.box !== "string" || !b.box) return void res.status(400).json({ error: "box required" });
  try {
    const snap = await watchHub.read(b.box).catch(() => undefined);
    const current = snap?.runState === "waiting" ? snap.question : undefined;
    const r = claimNonce(db, { owner, box: b.box, nonce: b.nonce, choice: b.choice, currentQuestion: current });
    if (!r.ok) return void res.status(r.status).json({ error: r.error });
    if (r.already) return void res.json({ ok: true, already: true });
    try {
      await resumeQuietly(b.box, r.choice.answer);
    } catch (e) {
      releaseNonce(db, b.nonce as string);
      throw e;
    }
    res.json({ ok: true, answer: redactor.redact(r.choice.label) });
  } catch (e) {
    failWith(res, e);
  }
});

// Mobile push registration (owner-scoped). The token is never echoed back by any route.
app.post("/push/register.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const p = principalOf(res);
  const b = (req.body ?? {}) as { token?: unknown; platform?: unknown };
  const r = registerDevice(db, secretBox, p.kind === "user" ? p.userId : OPERATOR_OWNER, b.token, b.platform);
  if (!r.ok) return void res.status(400).json({ error: r.error });
  res.json({ ok: true, id: r.id });
});
app.post("/push/unregister.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const p = principalOf(res);
  const owner = p.kind === "user" ? p.userId : OPERATOR_OWNER;
  res.json({ ok: true, removed: unregisterDevice(db, owner, (req.body ?? {}).token), devices: deviceCount(db, owner) });
});

app.get("/skills.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  try {
    const shared = (await sharedViews(res, async () => viewSkills(await loadSkillStore(cfg)))).map((s) => ({ org: s.org, skills: s.data }));
    res.json({ skills: viewSkills(await loadSkillStore(cfg)), ...(shared.length ? { shared } : {}) });
  } catch (e) {
    failWith(res, e);
  }
});
app.post("/skills.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const action = body.action;
  if (!["upsert", "remove", "toggle", "check-updates", "update"].includes(String(action))) {
    res.status(400).json({ error: "unknown action" });
    return;
  }
  try {
    // Read-only: compare every imported skill (or the named ones) against its repository.
    if (action === "check-updates") {
      const store = await loadSkillStore(cfg);
      const names = Array.isArray(body.names) ? new Set((body.names as unknown[]).map(String)) : null;
      const candidates = Object.values(store.skills).filter((s) => s.source && (!names || names.has(s.name)));
      res.json({ updates: await checkSkillSources(candidates, (o, r) => resolveSkillRepoToken(cfg, o, r)) });
      return;
    }
    // Pull the latest version of an imported skill. Edits made here since the import are only
    // replaced with `force` — the dashboard asks first. The GitHub reads happen outside the store
    // lock; the swap inside it re-reads the entry so a concurrent remove or rename is respected.
    let updated: { name: string; changed: boolean; skipped: string[] } | undefined;
    if (action === "update") {
      const name = String(body.name ?? "");
      const current = (await loadSkillStore(cfg)).skills[name];
      if (!current) throw new Error(`No skill named "${name}".`);
      if (!current.source) throw new Error(`/${name} was not imported from a repository, so there is no newer version to fetch.`);
      if (editedSinceImport(current) && body.force !== true) {
        res.status(409).json({ error: `/${name} was edited here after it was imported — getting the latest version replaces those edits.`, edited: true });
        return;
      }
      const token = await resolveSkillRepoToken(cfg, current.source.owner, current.source.repo);
      const latest = await fetchSkillUpdate(current.source, token);
      updated = { name, changed: !!latest, skipped: latest?.skipped ?? [] };
      if (!latest) {
        res.json({ skills: viewSkills(await loadSkillStore(cfg)), updated });
        return;
      }
      let pulled: { before: SkillDef; after: SkillDef } | undefined;
      const store = await withStoreLock("skills", async () => {
        const store = await loadSkillStore(cfg);
        const s = store.skills[name];
        if (!s) throw new Error(`/${name} was removed while its update was fetched.`);
        // normalizeSkill restamps importedAt = updatedAt = now, so the entry reads as unedited.
        const next = normalizeSkill({ ...s, description: latest.description, content: latest.content, files: latest.files, source: latest.source });
        if (s.from) next.from = s.from;
        store.skills[name] = next;
        pulled = { before: s, after: next };
        await saveSkillStore(cfg, store);
        return store;
      });
      const p = pulled;
      const followed = p
        ? await followIntoOrgs(res, "skills", async (who) => {
            const org = await loadSkillStore(cfg);
            if (!followSkill(org, who, name, p.before, p.after)) return false;
            await saveSkillStore(cfg, org);
            return true;
          })
        : [];
      res.json({ skills: viewSkills(store), updated, ...(followed.length ? { followed } : {}) });
      return;
    }
    // What changed, for the organisation copies that follow this skill (followIntoOrgs).
    let change: { name: string; before?: SkillDef; after?: SkillDef } | undefined;
    const store = await withStoreLock("skills", async () => {
      const store = await loadSkillStore(cfg);
      if (action === "upsert") {
        const s = normalizeSkill(body.skill as Partial<SkillDef> & { name: string });
        // Rename: the entry moves under the new name and the old one goes.
        const previous = typeof body.previousName === "string" ? body.previousName : "";
        const before = store.skills[previous && previous !== s.name ? previous : s.name];
        if (previous && previous !== s.name && store.skills[previous]) {
          s.addedAt = store.skills[previous].addedAt;
          delete store.skills[previous];
        }
        if (store.skills[s.name]) s.addedAt = store.skills[s.name].addedAt;
        // An ordinary save sends no source: the import provenance stays, and the save's later
        // updatedAt is what marks the skill as edited since import. `source: null` detaches it.
        if (!("source" in (body.skill as object)) && before?.source) s.source = before.source;
        // An organisation's copy edited in place stays a copy: the form never sends the stamp.
        if (before?.from) s.from = before.from;
        store.skills[s.name] = s;
        change = { name: previous || s.name, before, after: s };
      } else if (action === "remove") {
        const name = String(body.name ?? "");
        change = { name, before: store.skills[name] };
        delete store.skills[name];
      } else if (action === "toggle") {
        const s = store.skills[String(body.name ?? "")];
        if (s) s.enabled = body.enabled !== false;
      }
      await saveSkillStore(cfg, store);
      return store;
    });
    const c = change;
    const followed = c
      ? await followIntoOrgs(res, "skills", async (who) => {
          const org = await loadSkillStore(cfg);
          if (!followSkill(org, who, c.name, c.before, c.after)) return false;
          await saveSkillStore(cfg, org);
          return true;
        })
      : [];
    res.json({ skills: viewSkills(store), ...(followed.length ? { followed } : {}) });
  } catch (e) {
    res.status(400).json({ error: clientError(e) });
  }
});

// Memory across runs (src/memory-store.ts, docs/memory.md): the owner's notes with keep/edit/pin/
// forget, manual add, promote-to-skill, Markdown export/import and the on/off switch. Not
// /memory.json — that one is the VM's RAM. Every mutation is one synchronous load→mutate→save inside
// the owner's store lock; the harvester is told about keeps/edits/forgets so the thread's toasts
// (WatchSnapshot.memoryNew) match the store at the next read.
// The ambient owner: the person, or — on a request scoped with ?org= — the organisation.
const memoryOwner = (_res: Response): string => ownerKey();
// A revised note carries its earlier versions (capped at 10); every other note stays as it is.
const memoryView = (store: MemoryStore) => ({
  enabled: store.enabled,
  // The episodic half and the proof of use: what runs did, and what each recent run was handed.
  episodes: Object.entries(store.episodes ?? {}).flatMap(([repo, list]) => list.map((e) => ({ ...e, repo }))).sort((a, b) => b.at - a.at),
  receipts: Object.entries(store.receipts ?? {}).map(([box, r]) => ({ box, at: r.at, core: r.core, areas: r.areas, picked: r.picked, episodes: r.episodes, matched: r.matched })).sort((a, b) => b.at - a.at),
  notes: viewMemory(store).map((n) => {
    if (!n.supersedes) return n;
    const history = noteHistory(store, n.id);
    return history.length ? { ...n, history } : n;
  }),
});
app.get("/memory-notes.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  try {
    const shared = (
      await sharedViews(res, () => {
        const s = loadMemoryStore();
        return { enabled: s.enabled, notes: viewMemory(s) };
      })
    ).map((s) => ({ org: s.org, ...s.data }));
    res.json({ ...memoryView(loadMemoryStore(memoryOwner(res))), ...(shared.length ? { shared } : {}) });
  } catch (e) {
    failWith(res, e);
  }
});
app.post("/memory-notes.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const owner = memoryOwner(res);
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    // The edited note, for the organisation copies that follow it (followIntoOrgs).
    let edited: MemoryNote | undefined;
    const store = await withStoreLock("memory", async () => {
      const store = loadMemoryStore(owner);
      if (body.enabled !== undefined) {
        if (typeof body.enabled !== "boolean") throw new Error("enabled must be true or false.");
        store.enabled = body.enabled;
      }
      if (body.add !== undefined) {
        if (!body.add || typeof body.add !== "object") throw new Error("add must be { kind, text, why?, repo?, area?, paths?, links? }.");
        addManualNote(store, body.add as { kind: unknown; text: unknown; why?: unknown; repo?: unknown; area?: unknown; paths?: unknown; links?: unknown });
        res.locals.auditAction = "memory.add";
      } else if (body.id !== undefined) {
        if (typeof body.id !== "string" || !body.id) throw new Error("id must be a note id.");
        const before = getNote(store, body.id);
        const wasPending = before?.status === "pending";
        const note = updateNote(store, body.id, { text: body.text, why: body.why, pinned: body.pinned, status: body.status, area: body.area, paths: body.paths, links: body.links, verified: body.verified, repo: body.repo });
        const changed = body.text !== undefined || body.why !== undefined || body.area !== undefined || body.paths !== undefined || body.links !== undefined || body.repo !== undefined;
        res.locals.auditAction = changed ? "memory.edit" : wasPending && body.status === "kept" ? "memory.keep" : body.verified ? "memory.verify" : "memory.edit";
        memoryHarvester.noteChanged(note.id, { status: note.status, ...(changed ? { text: note.text, why: note.why ?? "" } : {}) });
        edited = note;
      }
      saveMemoryStore(store, owner);
      return store;
    });
    const n = edited;
    const followed = n
      ? await followIntoOrgs(res, "memory", (who) => {
          const org = loadMemoryStore();
          if (!followNote(org, who, n.id, n)) return false;
          saveMemoryStore(org);
          return true;
        })
      : [];
    res.json({ ...memoryView(store), ...(followed.length ? { followed } : {}) });
  } catch (e) {
    res.status(400).json({ error: clientError(e) });
  }
});
app.delete("/memory-notes.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const owner = memoryOwner(res);
  // The contract is ?id=; a body id is still honoured for clients built before it.
  const id = typeof req.query.id === "string" ? req.query.id : typeof (req.body as { id?: unknown } | undefined)?.id === "string" ? String((req.body as { id: string }).id) : "";
  // ?episode=<box> forgets what a run did, the same way ?id= forgets a note.
  const episode = typeof req.query.episode === "string" ? req.query.episode : "";
  try {
    let forgot = false;
    const store = await withStoreLock("memory", async () => {
      const store = loadMemoryStore(owner);
      if (episode && forgetEpisode(store, episode)) {
        saveMemoryStore(store, owner);
        res.locals.auditAction = "memory.forget";
      }
      if (id && deleteNote(store, id)) {
        saveMemoryStore(store, owner);
        memoryHarvester.noteDeleted(id);
        res.locals.auditAction = "memory.forget";
        forgot = true;
      }
      return store;
    });
    // The organisation keeps its copy of a forgotten note; it just stops following.
    if (forgot)
      await followIntoOrgs(res, "memory", (who) => {
        const org = loadMemoryStore();
        if (!followNote(org, who, id, undefined)) return false;
        saveMemoryStore(org);
        return true;
      });
    res.json(memoryView(store));
  } catch (e) {
    failWith(res, e);
  }
});
// A playbook that proved itself becomes a first-class skill. The note stays (it is history and
// still feeds MEMORY.md); the skill is created enabled under a slug of the playbook's title.
app.post("/memory-promote.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const owner = memoryOwner(res);
  const id = (req.body as { id?: unknown } | undefined)?.id;
  try {
    if (typeof id !== "string" || !id) throw new Error("id must be a note id.");
    const memStore = loadMemoryStore(owner);
    const note = getNote(memStore, id);
    if (!note) throw new Error("That note no longer exists.");
    const draft = playbookToSkill(note);
    const skill = normalizeSkill({ ...draft, enabled: true });
    const clash = await withStoreLock("skills", async () => {
      const store = await loadSkillStore(cfg);
      if (store.skills[skill.name]) return true;
      store.skills[skill.name] = skill;
      await saveSkillStore(cfg, store);
      return false;
    });
    if (clash) {
      res.status(409).json({ error: `A skill named "${skill.name}" already exists — rename it or the playbook title first.` });
      return;
    }
    res.locals.auditAction = "memory.promote";
    res.json({ skill: { name: skill.name }, ...memoryView(memStore) });
  } catch (e) {
    res.status(400).json({ error: clientError(e) });
  }
});
app.get("/memory-export.md", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  try {
    res.type("text/markdown; charset=utf-8").send(exportMemoryMarkdown(loadMemoryStore(memoryOwner(res))));
  } catch (e) {
    failWith(res, e);
  }
});
app.post("/memory-import.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const owner = memoryOwner(res);
  const markdown = (req.body as { markdown?: unknown } | undefined)?.markdown;
  try {
    if (typeof markdown !== "string" || !markdown.trim()) throw new Error("markdown must be the exported Markdown text.");
    if (markdown.length > 1_000_000) throw new Error("That file is too large to import (max 1 MB).");
    const store = await withStoreLock("memory", async () => {
      const store = loadMemoryStore(owner);
      if (importMemoryMarkdown(store, markdown)) saveMemoryStore(store, owner);
      return store;
    });
    res.locals.auditAction = "memory.import";
    res.json(memoryView(store));
  } catch (e) {
    res.status(400).json({ error: clientError(e) });
  }
});

/**
 * Browse a GitHub repository for importable skills. Proxied here rather than fetched from the
 * page because the SPA runs under `connect-src 'self'` — see github-skills.ts for the why. When
 * a stored GitHub account can access the repo its token is used (private repos work); otherwise
 * the reads are anonymous (public repos, no token spent).
 */
app.post("/skill-repo.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : "");
  const owner = str("owner");
  const repo = str("repo");
  try {
    const token = await resolveSkillRepoToken(cfg, owner, repo);
    if (body.action === "list") {
      const r = await listRepoSkills(owner, repo, str("branch") || undefined, str("subpath") || undefined, token);
      res.json({ ...r, authed: !!token });
    } else if (body.action === "fetch") {
      res.json(await fetchRepoFileWithSource(owner, repo, str("branch"), str("path"), token));
    } else if (body.action === "fetch-skill") {
      res.json(await fetchRepoSkillDir(owner, repo, str("branch"), str("path"), token));
    } else {
      res.status(400).json({ error: "unknown action" });
    }
  } catch (e) {
    res.status(400).json({ error: clientError(e) });
  }
});

// What the agent changed: per-file +/- and status across the checked-out repos (and loose files).
// The run digest: what was asked, the plan of record, files touched, failed commands, questions
// asked and answered, and one phone-readable headline. Pure derivation (src/digest.ts) from the
// same log the thread renders plus the changed-files listing — no extra instrumentation in the box.
app.get("/digest.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const session = boxParam(req.query);
  if (!session) {
    res.status(400).json({ error: "session query param required" });
    return;
  }
  try {
    const snap = await watchHub.read(session);
    if (snap.boxStatus === "missing") {
      res.status(404).json({ error: "no such machine" });
      return;
    }
    // A stopped box cannot answer listChanges (exec would boot it); the digest degrades to no files.
    const files = /^running$/i.test(snap.boxStatus) ? await listChanges(hcfg(session), session).catch(() => []) : [];
    const digest = buildDigest({
      box: session,
      task: snap.task ?? "",
      runState: snap.runState,
      exitCode: snap.exitCode,
      events: parseTrace(snap.log ?? ""),
      files,
      verified: boxVerified.get(session),
      retries: retriesOf(session),
      ...runProvenance(session, snap.agent, snap.mcpNotes),
    });
    // The snapshot's log/task/question are already redacted by the hub's reader; the trace-derived
    // strings inherit that. Task from the sentinel file is redacted there too.
    res.json(digest);
  } catch (e) {
    failWith(res, e);
  }
});

/**
 * Run history archive (docs/roadmap-saas.md #7): a RECORD of finished runs, never live state
 * (PRODUCT.md principle 4). List: `GET /history.json` → {runs:[…]} for the caller's owner, reverse-
 * chron, ?limit (≤50) and ?before=<id> to page. Detail: `?id=N` → the full row incl. parsed digest.
 * Redaction: archived text came from the watchHub snapshot, whose reader redacts log/task/question
 * before anything derives from it — rows were redacted at archive time and are served verbatim.
 */
app.get("/history.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const p = principalOf(res);
  const owner = p.kind === "user" ? p.userId : OPERATOR_OWNER;
  try {
    if (typeof req.query.id === "string") {
      const id = Number(req.query.id);
      if (!Number.isInteger(id)) {
        res.status(400).json({ error: "id must be an integer" });
        return;
      }
      const run = getRun(db, owner, id);
      if (!run) {
        res.status(404).json({ error: "no such run" });
        return;
      }
      res.json({ run });
      return;
    }
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
    const before = typeof req.query.before === "string" ? Number(req.query.before) : undefined;
    // A run whose box is gone but whose copy is kept (src/rescue.ts) can be brought back from here.
    const rescues = new Map((await listRescues(cfg)).map((r) => [r.box, r]));
    res.json({
      runs: listRuns(db, owner, {
        ...(Number.isFinite(limit) ? { limit } : {}),
        ...(Number.isInteger(before) ? { before } : {}),
      }).map((r) => ({ ...r, outcome: outcomeWithFollow(owner, r.box, r.outcome), rescue: rescues.get(r.box) ?? null })),
    });
  } catch (e) {
    failWith(res, e);
  }
});

// Run activity for the History heatmap: [{t, failed}] for the caller's owner since ?since (epoch ms,
// clamped to the last 200 days). Read-only; same owner scoping as /history.json.
app.get("/history/activity.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const p = principalOf(res);
  const owner = p.kind === "user" ? p.userId : OPERATOR_OWNER;
  try {
    const floor = Date.now() - 200 * 24 * 60 * 60 * 1000;
    const q = typeof req.query.since === "string" ? Number(req.query.since) : NaN;
    res.json({ runs: listActivity(db, owner, Number.isFinite(q) ? Math.max(q, floor) : floor) });
  } catch (e) {
    failWith(res, e);
  }
});

// Users may remove a record of their own run; the id must belong to the caller's owner.
app.delete("/history.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const p = principalOf(res);
  const owner = p.kind === "user" ? p.userId : OPERATOR_OWNER;
  const id = Number(req.query.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "id query param required" });
    return;
  }
  try {
    if (!deleteRun(db, owner, id)) {
      res.status(404).json({ error: "no such run" });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    failWith(res, e);
  }
});

app.get("/changes.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const session = boxParam(req.query);
  if (!session) {
    res.status(400).json({ error: "session query param required" });
    return;
  }
  try {
    res.json({ files: await listChanges(hcfg(session), session) });
  } catch (e) {
    failWith(res, e);
  }
});
// The whole workspace's unified diff for the Review-all panel: live from the box while it is up.
// (A finished run's diff survives teardown in the archive — /history.json?id=N carries diffText.)
app.get("/rundiff.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const session = boxParam(req.query);
  if (!session) {
    res.status(400).json({ error: "session query param required" });
    return;
  }
  try {
    res.json({ diff: redactor.redact(await readFullDiff(hcfg(session), session)) });
  } catch (e) {
    res.status(400).json({ error: clientError(e) });
  }
});
// The unified diff for one file (git diff HEAD), or "untracked" for a new file; path under /workspace.
app.get("/diff.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const session = boxParam(req.query);
  const path = typeof req.query.path === "string" ? req.query.path : "";
  if (!session || !path) {
    res.status(400).json({ error: "session and path are required" });
    return;
  }
  try {
    const d = await readDiff(hcfg(session), session, path);
    res.json({ ...d, ...("diff" in d && typeof d.diff === "string" ? { diff: redactor.redact(d.diff) } : {}), ...("original" in d && typeof d.original === "string" ? { original: redactor.redact(d.original) } : {}) });
  } catch (e) {
    res.status(400).json({ error: clientError(e) });
  }
});
// Reject one file's change — or one hunk of it — from the review surfaces: `git checkout` / delete
// for a whole path, `git apply -R` for a hunk (src/changes.ts discardChange). Refused mid-turn
// like /revert.json: pulling the file out from under a working agent is a race nobody wins.
// Answers with the refreshed file list so the dock's counts roll without a second round trip.
app.post("/discard.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const session = boxParam(req.body);
  const { path, hunk } = (req.body ?? {}) as { path?: string; hunk?: string };
  if (!isBoxName(session) || typeof path !== "string" || !path || (hunk !== undefined && typeof hunk !== "string")) {
    res.status(400).json({ error: "session and path are required" });
    return;
  }
  if (hunk && hunk.length > 400_000) {
    res.status(413).json({ error: "hunk too large" });
    return;
  }
  try {
    const snap = await watchHub.read(session);
    if (!canRevert(snap.runState)) {
      res.status(409).json({ error: "The agent is mid-turn — wait for it to finish (or stop it) before discarding its changes." });
      return;
    }
    const r = await withBoxLock(session, () => discardChange(hcfg(session), session, path, hunk || undefined));
    res.json({ ok: true, scope: r.scope, path, files: await listChanges(hcfg(session), session).catch(() => []) });
  } catch (e) {
    const msg = clientError(e, 400);
    res.status(/invalid path|@@ header/.test(msg) ? 400 : 422).json({ error: msg });
  }
});
// Pull request metadata for the PR card (through a connected account; cached a minute).
// Merge the run's pull request from inside its sandbox: `gh` there already carries the account
// that opened it, so the merge is attributed like the agent's own pushes. Method is merge-commit.
app.post("/pr/merge.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const session = boxParam(req.body);
  const { repo, number, method, auto, admin } = (req.body ?? {}) as { repo?: string; number?: number; method?: string; auto?: boolean; admin?: boolean };
  if (!session || !/^[\w.-]+$/.test(session) || !repo || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !(Number.isInteger(Number(number)) && Number(number) > 0)) {
    res.status(400).json({ error: "session, repo (owner/name) and number are required" });
    return;
  }
  // The method whitelist doubles as injection-proofing: only these three words ever reach the shell.
  const methodFlag = method === "squash" ? "--squash" : method === "rebase" ? "--rebase" : "--merge";
  try {
    // `gh` in the box has NO persisted auth (tokens are per-exec env only, by design), so the merge
    // must carry the owner's token the same way the ask lane does. Without it every merge failed
    // with "gh auth login required".
    const creds = await withOwner(ownerOf(db, session) ?? null, () => resolveCredsForBox(hcfg(session), session)).catch(() => undefined);
    if (!creds?.primaryToken) {
      res.status(422).json({ error: "No GitHub account connected for this machine's owner — connect one in Integrations, then retry the merge." });
      return;
    }
    // `repo` is quoted rather than relied on to be metacharacter-free: the validating regex above
    // and this interpolation are far apart, and only one of them has to loosen for the other to
    // become a remote shell.
    // `auto` = GitHub's own auto-merge: queue the merge to fire the moment branch-policy
    // requirements (approvals, checks) are met — the answer to "the base branch policy prohibits
    // the merge" that doesn't involve coming back later.
    // `admin` = gh's --admin: use the account's administrator bypass to merge despite branch
    // policy. Only meaningful when the connected account actually has bypass rights; the UI keeps
    // it behind its own explicit confirm. --auto and --admin are mutually exclusive in gh.
    const extra = admin ? " --admin" : auto ? " --auto" : "";
    const r = await execInBox(hcfg(session), session, `gh pr merge ${Number(number)} --repo ${shellQuote(repo)} ${methodFlag}${extra} 2>&1`, {
      secretEnv: { GH_TOKEN: creds.primaryToken, GITHUB_TOKEN: creds.primaryToken },
    });
    forgetPull(repo, Number(number));
    res.json({ ok: true, auto: !!auto && !admin, output: redactor.redact((r.stdout ?? "").trim().slice(-600)) });
  } catch (e) {
    forgetPull(repo, Number(number));
    // gh's own message (not mergeable, checks, permissions…) is on the lines AFTER the argv line of
    // the exec error; surface those words, not the plumbing. clientError would mask the whole thing
    // as "the sandbox host did not complete that command", which reads as OUR bug, not the PR's state.
    const raw = String((e as Error)?.message ?? e);
    const afterArgv = raw.split("\n").slice(1).filter((l) => l.trim() && !/^(ssh|Warning: Permanently added|• Backend)/.test(l.trim()));
    const ghMsg = afterArgv.join("\n").trim();
    res.status(422).json({ error: ghMsg ? redactor.redact(ghMsg).slice(-600) : clientError(e, 600) });
  }
});

// Approve the run's pull request from inside its sandbox, mirroring /pr/merge.json: `gh pr review
// --approve` with the owner's token. GitHub refuses self-approval; that message is surfaced as-is.
app.post("/pr/approve.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const session = boxParam(req.body);
  const { repo, number } = (req.body ?? {}) as { repo?: string; number?: number };
  if (!session || !/^[\w.-]+$/.test(session) || !repo || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !(Number.isInteger(Number(number)) && Number(number) > 0)) {
    res.status(400).json({ error: "session, repo (owner/name) and number are required" });
    return;
  }
  try {
    const creds = await withOwner(ownerOf(db, session) ?? null, () => resolveCredsForBox(hcfg(session), session)).catch(() => undefined);
    if (!creds?.primaryToken) {
      res.status(422).json({ error: "No GitHub account connected for this machine's owner — connect one in Integrations, then retry." });
      return;
    }
    const r = await execInBox(hcfg(session), session, `gh pr review ${Number(number)} --repo ${shellQuote(repo)} --approve 2>&1`, {
      secretEnv: { GH_TOKEN: creds.primaryToken, GITHUB_TOKEN: creds.primaryToken },
    });
    forgetPull(repo, Number(number));
    res.json({ ok: true, output: redactor.redact((r.stdout ?? "").trim().slice(-600)) });
  } catch (e) {
    forgetPull(repo, Number(number));
    const raw = String((e as Error)?.message ?? e);
    const afterArgv = raw.split("\n").slice(1).filter((l) => l.trim() && !/^(ssh|Warning: Permanently added|• Backend)/.test(l.trim()));
    const ghMsg = afterArgv.join("\n").trim();
    res.status(422).json({ error: ghMsg ? redactor.redact(ghMsg).slice(-600) : clientError(e, 600) });
  }
});

/**
 * The shared body of every PR write action (comment, review, close/reopen/ready): validate, borrow
 * the owner's token the way /pr/merge.json does, run one `gh` command inside the box, invalidate
 * the PR caches, and surface gh's own words on failure. `build` returns the command's arguments
 * AFTER `gh pr` — it is responsible for quoting anything user-supplied.
 */
async function runPrAction(req: Request, res: Response, build: (number: number, repo: string) => string | { error: string }) {
  if (!dashAuthed(req, res)) return;
  const session = boxParam(req.body);
  const { repo, number } = (req.body ?? {}) as { repo?: string; number?: number };
  if (!session || !/^[\w.-]+$/.test(session) || !repo || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !(Number.isInteger(Number(number)) && Number(number) > 0)) {
    res.status(400).json({ error: "session, repo (owner/name) and number are required" });
    return;
  }
  const built = build(Number(number), repo);
  if (typeof built !== "string") {
    res.status(400).json(built);
    return;
  }
  try {
    const creds = await withOwner(ownerOf(db, session) ?? null, () => resolveCredsForBox(hcfg(session), session)).catch(() => undefined);
    if (!creds?.primaryToken) {
      res.status(422).json({ error: "No GitHub account connected for this machine's owner — connect one in Integrations, then retry." });
      return;
    }
    const r = await execInBox(hcfg(session), session, `gh pr ${built} 2>&1`, {
      secretEnv: { GH_TOKEN: creds.primaryToken, GITHUB_TOKEN: creds.primaryToken },
    });
    forgetPull(repo, Number(number));
    res.json({ ok: true, output: redactor.redact((r.stdout ?? "").trim().slice(-600)) });
  } catch (e) {
    forgetPull(repo, Number(number));
    const raw = String((e as Error)?.message ?? e);
    const afterArgv = raw.split("\n").slice(1).filter((l) => l.trim() && !/^(ssh|Warning: Permanently added|• Backend)/.test(l.trim()));
    const ghMsg = afterArgv.join("\n").trim();
    res.status(422).json({ error: ghMsg ? redactor.redact(ghMsg).slice(-600) : clientError(e, 600) });
  }
}

// Comment on the PR. The body is operator prose heading for a shell, so it is ALWAYS shellQuote'd.
app.post("/pr/comment.json", async (req: Request, res: Response) => {
  const body = typeof (req.body ?? {}).body === "string" ? ((req.body as { body: string }).body).trim() : "";
  await runPrAction(req, res, (n, repo) =>
    body ? `comment ${n} --repo ${shellQuote(repo)} --body ${shellQuote(body)}` : { error: "body is required" }
  );
});

// Submit a review: approve / request changes / plain comment. /pr/approve.json stays as the
// dedicated approve path (both clients already call it); this covers the other two verdicts.
app.post("/pr/review.json", async (req: Request, res: Response) => {
  const { event, body } = (req.body ?? {}) as { event?: string; body?: string };
  const text = typeof body === "string" ? body.trim() : "";
  // Whitelist, not interpolation: only these three words can ever reach the shell.
  const flag = event === "approve" ? "--approve" : event === "request-changes" ? "--request-changes" : event === "comment" ? "--comment" : "";
  await runPrAction(req, res, (n, repo) => {
    if (!flag) return { error: "event must be approve, request-changes or comment" };
    // gh requires a body for both of these; approve is the only verdict that may stand alone.
    if (!text && flag !== "--approve") return { error: "body is required for this review" };
    return `review ${n} --repo ${shellQuote(repo)} ${flag}${text ? ` --body ${shellQuote(text)}` : ""}`;
  });
});

// Close / reopen / mark ready for review.
app.post("/pr/state.json", async (req: Request, res: Response) => {
  const { action } = (req.body ?? {}) as { action?: string };
  const verb = action === "close" ? "close" : action === "reopen" ? "reopen" : action === "ready" ? "ready" : "";
  await runPrAction(req, res, (n, repo) => (verb ? `${verb} ${n} --repo ${shellQuote(repo)}` : { error: "action must be close, reopen or ready" }));
});

// The dedicated PR page's payload: the chip's summary plus body, commits, files+patches,
// conversation and check runs, in one request.
app.get("/pr/detail.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const repo = typeof req.query.repo === "string" ? req.query.repo : "";
  const number = Number(req.query.number);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !(Number.isInteger(number) && number > 0)) {
    res.status(400).json({ error: "repo (owner/name) and number are required" });
    return;
  }
  try {
    const detail = await fetchPullDetail(cfg, repo, number);
    if (!detail) {
      res.status(404).json({ error: "pull request not reachable with the connected accounts" });
      return;
    }
    // Bodies are author-written text we are echoing back to a browser; scrub them like any other
    // relayed output rather than trusting GitHub not to be carrying a leaked secret.
    res.json({
      ...detail,
      ...(detail.body ? { body: redactor.redact(detail.body) } : {}),
      ...(detail.comments ? { comments: detail.comments.map((c) => ({ ...c, body: redactor.redact(c.body) })) } : {}),
      ...(detail.commits ? { commits: detail.commits.map((c) => ({ ...c, message: redactor.redact(c.message) })) } : {}),
    });
  } catch (e) {
    failWith(res, e);
  }
});

app.get("/pr.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const repo = typeof req.query.repo === "string" ? req.query.repo : "";
  const number = Number(req.query.number);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !(Number.isInteger(number) && number > 0)) {
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
  const session = boxParam(req.body);
  const { keep } = (req.body ?? {}) as { keep?: boolean };
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
    if (keep === false) await unmarkKept(hcfg(session), session);
    else await markKept(hcfg(session), session);
    // The thread row carries the keep at once (the rescue sweep and the copy's cap read it), and a
    // kept thread gets its copy off the box now, not at the next turn end.
    upsertThread(db, { id: session, kept: keep !== false });
    if (keep !== false) {
      lastKept.add(session);
      void ensureKeptCopy(session).catch((e) => console.error(`[keep] ${session}: copy after keep failed: ${String((e as Error).message ?? e).slice(0, 200)}`));
    } else lastKept.delete(session);
    res.json({ ok: true, kept: keep !== false });
  } catch (e) {
    failWith(res, e);
  }
});

// Queued follow-ups for a box: list, or remove one (`?id=`) / all.
app.get("/inbox.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const session = boxParam(req.query);
  if (!session) {
    res.status(400).json({ error: "session query param required" });
    return;
  }
  res.json({ queued: inbox.list(session) });
});
app.delete("/inbox.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const session = boxParam(req.query);
  const id = typeof req.query.id === "string" ? req.query.id : "";
  if (!session) {
    res.status(400).json({ error: "session query param required" });
    return;
  }
  // The box's mirrored copy goes too, or the gate would still deliver a cancelled message at the
  // next tool call. Not awaited: the inbox answers now, the box catches up.
  if (id) {
    if (inbox.remove(session, id)) void unmirrorInboxMessage(hcfg(session), session, id);
  } else {
    for (const m of inbox.list(session)) void unmirrorInboxMessage(hcfg(session), session, m.id);
    inbox.clear(session);
  }
  res.json({ queued: inbox.list(session) });
});
// Rewrite a queued message before the agent has it. Same id and slot; the box's mirrored copy is
// taken back first and mirrored again with the new words, so the gate never delivers the old ones.
// If the gate already delivered it (a receipt is waiting), the edit is too late: 409, and the
// receipt is reconciled here exactly as the delivery loop would have.
app.patch("/inbox.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const session = boxParam(req.body);
  const { id, message } = (req.body ?? {}) as { id?: string; message?: string };
  const text = typeof message === "string" ? message.trim() : "";
  if (!session || !id || !/^q\d+$/.test(id)) {
    res.status(400).json({ error: "session and a queued message id are required" });
    return;
  }
  if (!text) {
    res.status(400).json({ error: "the message cannot be empty — remove it from the queue instead" });
    return;
  }
  const list = inbox.list(session);
  const at = list.findIndex((m) => m.id === id);
  if (at < 0) {
    res.status(404).json({ error: "that queued message is gone (already delivered or removed)" });
    return;
  }
  try {
    const delivered = await takeDeliveredInbox(hcfg(session), session);
    for (const d of delivered) inbox.remove(session, d);
    if (delivered.includes(id)) {
      res.status(409).json({ error: "the agent already read that message — send a new one", queued: inbox.list(session) });
      return;
    }
    await unmirrorInboxMessage(hcfg(session), session, id);
    const m = inbox.update(session, id, text);
    if (!m) {
      res.status(404).json({ error: "that queued message is gone (already delivered or removed)", queued: inbox.list(session) });
      return;
    }
    // Mirrored again on the same terms as a fresh send: only into a running box, never a /compact
    // or anything that waits behind one.
    const behindCompact = isCompactCommand(text) || list.slice(0, at).some((x) => isCompactCommand(x.text));
    if (!behindCompact && (await watchHub.read(session)).runState === "running") {
      mirrorInboxMessage(hcfg(session), session, m).catch((e) => console.error(`[inbox] mirror to ${session} failed: ${(e as Error).message}`));
    }
    res.json({ queued: inbox.list(session) });
  } catch (e) {
    failWith(res, e);
  }
});

// Workspace files for `@` mentions: ?session=&q=; at most 40 ranked matches.
// Name a run from its first message via the in-box helper. Idempotent; sleeping boxes are skipped.
app.post("/title.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const session = boxParam(req.body);
  if (!session || !/^[\w.-]+$/.test(session)) {
    res.status(400).json({ error: "session is required" });
    return;
  }
  try {
    const existing = (await loadTitles(hcfg(session)))[session];
    if (existing) {
      res.json({ title: existing });
      return;
    }
    const box = (await readFleet()).boxes.find((b) => b.name === session);
    if (!box?.task) {
      res.json({});
      return;
    }
    res.json({ title: await generateTitle(hcfg(session), session, box.task) });
  } catch (e) {
    failWith(res, e);
  }
});

// Rename a run. The generated title is a guess; the operator's word replaces it everywhere.
app.post("/rename.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const session = boxParam(req.body);
  const { title } = (req.body ?? {}) as { title?: string };
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
    await saveTitle(hcfg(session), session, clean);
    res.json({ title: clean });
  } catch (e) {
    failWith(res, e);
  }
});

// Wake a sleeping sandbox the moment its thread is opened — no need to type first. Idempotent.
// --- Rescue copies (src/rescue.ts): a thread survives its box -------------------------------------
// GET: is a copy of this thread kept, and what does it hold? POST restore: a fresh box under the
// SAME name on whichever host can take it, the copy put back, the claim marked — the thread's URL,
// transcript, files and agent session are back, and the next message continues the same session.
app.get("/rescue.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const session = boxParam(req.query);
  if (!isBoxName(session)) {
    res.status(400).json({ error: "session is required" });
    return;
  }
  try {
    ownership.check(session);
    const m = await readRescue(cfg, session);
    const present = (await readFleet()).boxes.some((b) => b.name === session && !b.absent);
    // Not listed is not gone: the box's host may be asleep or unreachable, in which case the fleet
    // is going by memory. The client words the page accordingly and the restore checks the host first.
    const lastHost = hostPool.hostOfBox(session) ?? boxHostOf(db, session) ?? null;
    const unsure = (h: { id: string; asleep: boolean; unreachable: boolean }) => h.asleep || h.unreachable;
    const hosts = hostPool.state();
    const uncertain = !present && (lastHost ? hosts.some((h) => h.id === lastHost && unsure(h)) : hosts.some(unsure));
    res.json({ rescue: m ? summarize(m) : null, present, uncertain, host: lastHost, maxMb: RESCUE_MAX_MB });
  } catch (e) {
    failWith(res, e);
  }
});

// --- Bring a thread's machine back (src/threads.ts + src/rescue.ts) --------------------------------
// The one choke point behind the restore route, /wake.json and every resume lane: the host the box
// was last seen on is asked first (woken if need be), nothing is created or wiped on a guess, and
// concurrent callers for the same thread share one attempt.
type BringBack = { ok: true; box: string; host: string | null; found?: boolean; inBox?: boolean; turn?: number; at?: number };
const bringingBack = new Map<string, Promise<BringBack>>();
const bringBack = (session: string): Promise<BringBack> => {
  const running = bringingBack.get(session);
  if (running) return running;
  const p = bringBackInner(session).finally(() => {
    if (bringingBack.get(session) === p) bringingBack.delete(session);
  });
  bringingBack.set(session, p);
  return p;
};
const bringBackInner = async (session: string): Promise<BringBack> => {
  const m = await readRescue(cfg, session);
  if (!m) throw new Error("no copy of this thread is kept, so its machine cannot be brought back");
  if (m.tooBig && !m.bytes) throw new Error(`the last checkpoint was ${Math.round(m.tooBig / 1048576)} MB, over the ${RESCUE_MAX_MB} MB copy limit, so nothing was kept`);
  if ((m.agent ?? "claude") !== "claude") throw new Error("only Claude Code threads can be brought back for now");
  const lostAt = Date.now();
  const t0 = Date.now();
  // The fleet must not serve a stale "gone"/"stopped" memory of this name once it is back.
  const back = () => {
    readFleet.forget(session);
    watchHub.drop(session);
    noteRunning(session);
  };
  // The fleet not listing a box is not proof it is gone: its host may have been asleep or
  // unreachable when the fleet last looked. (2026-11-18: a deploy restarted the controller while
  // the Freestyle tunnel was down; a pinned thread read as lost for hours while its machine sat
  // untouched, and the restore of that day wiped it before the copy could land.) So the host the
  // box was last seen on is asked directly, woken if need be, before anything is created or wiped.
  const lastHost = hostPool.hostOfBox(session) ?? boxHostOf(db, session);
  if (lastHost) {
    hostPool.rememberBox(session, lastHost);
    const hostCfg = await hostPool.readyForBox(session, `restore ${session}`).catch((e) => {
      console.error(`[rescue] ${session}: host ${lastHost} not ready: ${String((e as Error).message ?? e).slice(0, 200)}`);
      return null;
    });
    const outcome = hostCfg ? await startBoxIfStopped(hostCfg, session) : "absent";
    if (hostCfg && outcome === "running") {
      // A probe that fails is NOT an empty transcript: nothing may be wiped on a guess.
      const probe = await execInBox(hostCfg, session, "wc -c < /workspace/.agent.log 2>/dev/null || echo 0").catch((e) => {
        throw new Error(`the machine is on ${lastHost} but did not answer (${String((e as Error).message ?? e).slice(0, 160)}); nothing was changed, try again`);
      });
      const logBytes = Number(probe.stdout.trim().split("\n").pop()) || 0;
      await markClaimed(hostCfg, session).catch(() => {});
      if (logBytes > 0) {
        // Out of sight, not gone: nothing is restored. The next sweep lists it.
        back();
        console.error(`[rescue] ${session}: found intact on ${lastHost} (${logBytes} bytes of transcript), nothing restored`);
        return { ok: true, box: session, found: true, host: lastHost };
      }
      // The machine is there but empty (a restore that failed half-way): the copy goes into it.
      await execInBox(hostCfg, session, "touch /.claimed");
      await pushRescue(hostCfg, session, m, lostAt);
      if (m.title) await saveTitle(hostCfg, session, m.title).catch(() => {});
      back();
      console.error(`[rescue] ${session}: machine found empty on ${lastHost}, copy of turn ${m.turn} put back in ${Date.now() - t0} ms`);
      return { ok: true, box: session, turn: m.turn, at: m.at, host: lastHost, inBox: true };
    }
    if (outcome === "failed") throw new Error(`the machine is still on ${lastHost} but will not start; try again in a minute`);
  }
  const hostId = await placeRun(hostPool, cfg, `restore ${session}`, async (hostCfg, onAcquired) => {
    // The same rootfs a cold claude run boots from (prepareRunCfg in deps.ts), under the old name.
    const runCfg: Config = { ...hostCfg, ...claudeRootSource(hostCfg) };
    await createBox(runCfg, { name: session });
    onAcquired(session);
    if (hostCfg.hostId) hostPool.rememberBox(session, hostCfg.hostId);
    try {
      // Claimed BEFORE the copy goes in, in the box and on the host: a Running pool-named box
      // with neither /.claimed nor /.ready reads as an orphaned warm-up to the pool maintainer
      // (its name's timestamp is hours old), and the copy takes seconds to arrive.
      await execInBox(runCfg, session, "touch /.claimed");
      await markClaimed(runCfg, session);
      await pushRescue(runCfg, session, m, lostAt);
    } catch (e) {
      // The copy did not land: what stands under the thread's name is an empty, claimed box. Left
      // there it is listed as the thread ("idle · No task yet" on the Fleet, 2026-11-22, when the
      // Docker shim refused the upload) and shadows the copy on the next attempt (/wake.json finds
      // it running and restores nothing). It goes; the thread stays Away with its copy.
      console.error(`[rescue] ${session}: the copy did not land on ${hostCfg.hostId ?? "the primary host"}, removing the empty box: ${String((e as Error).message ?? e).slice(0, 200)}`);
      await deps.teardown(runCfg, session, { force: true }).catch((e2) => console.error(`[rescue] ${session}: the empty box could not be removed: ${String((e2 as Error).message ?? e2).slice(0, 160)}`));
      throw e;
    }
    if (m.title) await saveTitle(runCfg, session, m.title).catch(() => {});
    return hostCfg.hostId;
  });
  back();
  console.error(`[rescue] ${session}: brought back from turn ${m.turn} on ${hostId ?? "the primary host"} in ${Date.now() - t0} ms`);
  return { ok: true, box: session, turn: m.turn, at: m.at, host: hostId ?? null };
};

app.post("/rescue/restore.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const session = boxParam(req.body);
  if (!isBoxName(session)) {
    res.status(400).json({ error: "session is required" });
    return;
  }
  try {
    ownership.check(session);
    ownership.assertCanRun();
    if (!(await readRescue(cfg, session))) {
      res.status(404).json({ error: "no copy of this thread is kept" });
      return;
    }
    if ((await readFleet()).boxes.some((b) => b.name === session && !b.absent)) {
      res.status(409).json({ error: "this machine still exists; open it instead" });
      return;
    }
    res.json(await bringBack(session));
  } catch (e) {
    failWith(res, e);
  }
});

// --- Move a thread's machine to another host ------------------------------------------------------
// The same copy a lost thread is brought back from, taken fresh (a checkpoint captured now and
// pulled to the controller), put into a new box under the same name on the host asked for, and the
// old box removed only once the new one holds the whole transcript. Between turns only: a turn in
// progress has no consistent point to copy. The copy stays on the controller afterwards.
const moving = new Set<string>();
app.post("/threads/move.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const session = boxParam(req.body);
  const { host: toHost, keepSource } = (req.body ?? {}) as { host?: string; keepSource?: boolean };
  if (!isBoxName(session) || typeof toHost !== "string" || !toHost) {
    res.status(400).json({ error: "session and host are required" });
    return;
  }
  const target = hostPool.get(toHost);
  if (!target || !target.spec.enabled) {
    res.status(404).json({ error: `no such host: ${toHost}` });
    return;
  }
  if (moving.has(session)) {
    res.status(409).json({ error: "this thread is already being moved" });
    return;
  }
  moving.add(session);
  const t0 = Date.now();
  try {
    ownership.check(session);
    ownership.assertCanRun();
    const fromHost = hostPool.hostOfBox(session) ?? getThread(db, session)?.host ?? PRIMARY_HOST_ID;
    if (fromHost === toHost) {
      res.status(409).json({ error: `the machine is already on ${toHost}` });
      return;
    }
    const srcCfg = hcfg(session);
    await hostPool.readyForBox(session, `move ${session}`);
    const snap = await watchHub.read(session);
    if (snap.boxStatus === "missing") {
      res.status(404).json({ error: "no such machine on its host; open the thread to bring it back first" });
      return;
    }
    if ((snap.agent ?? "claude") !== "claude") {
      res.status(409).json({ error: "only Claude Code threads can be moved for now" });
      return;
    }
    if (snap.runState === "running") {
      res.status(409).json({ error: "the agent is working; a move waits for the turn to end" });
      return;
    }
    if (!/^running$/i.test(snap.boxStatus)) {
      const outcome = await startBoxIfStopped(srcCfg, session);
      if (outcome !== "running") {
        res.status(503).json({ error: `the machine on ${fromHost} would not start (${outcome})` });
        return;
      }
      noteRunning(session);
    }
    // 1. A fresh copy off the source, awaited (the turn-end pull is fire-and-forget).
    const kept = isKeptBox(session);
    const m = await withFinishing(session, () =>
      withBoxLock(session, async () => {
        const cap = await execInBox(srcCfg, session, captureCmd());
        const c = capturedTurn(cap.stdout);
        if (!c) throw new Error(`the source machine did not capture a checkpoint: ${cap.stdout.trim().slice(-200)}`);
        const srcBytes = Number((await execInBox(srcCfg, session, "wc -c < /workspace/.agent.log 2>/dev/null || echo 0")).stdout.trim().split("\n").pop()) || 0;
        const titles = await loadTitles(srcCfg).catch(() => ({}) as Record<string, string>);
        const meta = await pullRescue(srcCfg, session, c.turn, { owner: ownerOf(db, session) ?? null, hostId: fromHost, agent: snap.agent, task: snap.task, title: titles[session], kept });
        if (!meta || meta.turn !== c.turn || meta.tooBig || !meta.bytes) throw new Error(meta?.tooBig ? `the checkpoint is ${Math.round(meta.tooBig / 1048576)} MB, over the copy limit` : "the copy did not reach the controller");
        return { ...meta, srcBytes };
      })
    );
    // 2. A box under the same name on the target host, the copy put in and confirmed.
    await hostPool.ready(toHost, `move ${session}`, { patienceMs: 150_000 });
    const runCfg: Config = { ...cfg, ...target.cfg, ...claudeRootSource({ ...cfg, ...target.cfg }) };
    await createBox(runCfg, { name: session });
    hostPool.notePlaced(toHost, session);
    await execInBox(runCfg, session, "touch /.claimed");
    await markClaimed(runCfg, session);
    await pushRescue(runCfg, session, m, Date.now(), undefined, moveSeam(m.turn, fromHost, toHost));
    if (m.title) await saveTitle(runCfg, session, m.title).catch(() => {});
    if (kept) await markKept(runCfg, session);
    const dstBytes = Number((await execInBox(runCfg, session, "wc -c < /workspace/.agent.log 2>/dev/null || echo 0")).stdout.trim().split("\n").pop()) || 0;
    const sessions = Number((await execInBox(runCfg, session, "ls /root/.claude/projects 2>/dev/null | wc -l")).stdout.trim().split("\n").pop()) || 0;
    if (dstBytes < m.srcBytes || (m.srcBytes > 0 && sessions === 0)) {
      throw new Error(`the copy on ${toHost} is short (${dstBytes} of ${m.srcBytes} transcript bytes, ${sessions} session dirs); the source on ${fromHost} is untouched, and the new box was left for inspection`);
    }
    // 3. The source goes (or stays stopped when asked). The copy on the controller is the third holder.
    let source: "removed" | "stopped" = "stopped";
    if (keepSource) await stopBox(srcCfg, session);
    else {
      await msbTeardown(srcCfg, session, undefined, { force: true });
      source = "removed";
    }
    hostPool.forgetBox(session);
    hostPool.rememberBox(session, toHost);
    upsertThread(db, { id: session, host: toHost, kept });
    readFleet.forget(session);
    watchHub.drop(session);
    noteRunning(session);
    if (kept) lastKept.add(session);
    console.error(`[move] ${session}: ${fromHost} → ${toHost}, turn ${m.turn}, ${Math.round(m.bytes / 1024)} KB, source ${source}, ${Date.now() - t0} ms`);
    res.json({ ok: true, box: session, from: fromHost, host: toHost, turn: m.turn, bytes: m.bytes, transcriptBytes: dstBytes, source, ms: Date.now() - t0 });
  } catch (e) {
    console.error(`[move] ${session}: failed after ${Date.now() - t0} ms: ${String((e as Error).message ?? e).slice(0, 300)}`);
    failWith(res, e);
  } finally {
    moving.delete(session);
  }
});

app.post("/wake.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const session = boxParam(req.body);
  if (!session || !/^[\w.-]+$/.test(session)) {
    res.status(400).json({ error: "session is required" });
    return;
  }
  try {
    // Waking a stopped machine is starting a machine: the trial gate applies here exactly as it
    // does to delegation and resume.
    ownership.assertCanRun();
    attend(session, `wake ${session}`);
    const outcome = await startBoxIfStopped(await hostPool.readyForBox(session, `wake ${session}`), session);
    // Report honestly. Answering `ok` for a box the runtime never started is indistinguishable
    // from a real wake, so the client sits on a progress card forever waiting for a boot that was
    // never asked for. 404 matches the shape a destroyed box already returns elsewhere.
    if (outcome === "absent") {
      // The box is gone; the thread is not. With a copy kept, opening the thread brings the machine
      // back (src/threads.ts), the same way a reply would.
      if (await readRescue(cfg, session)) {
        const r = await bringBack(session);
        res.json({ ok: true, broughtBack: true, found: r.found ?? false, host: r.host });
        return;
      }
      res.status(404).json({ error: "no such machine" });
      return;
    }
    if (outcome === "failed") {
      res.status(503).json({ error: "the sandbox host could not start this machine — try again shortly" });
      return;
    }
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
  const session = boxParam(req.body);
  if (!session || !/^[\w.-]+$/.test(session)) {
    res.status(400).json({ error: "session is required" });
    return;
  }
  const { force } = (req.body ?? {}) as { force?: boolean };
  try {
    const hostId = hostPool.hostOfBox(session) ?? PRIMARY_HOST_ID;
    // The host is paused: the box is as asleep as it gets, and an SSH would start the host
    // (or, at a provider whose gateway refuses a suspended machine, fail) only to stop it.
    if (hostPool.dormant(hostId)) {
      noteStopped(session);
      watchHub.drop(session);
      res.json({ ok: true, hostAsleep: true });
      return;
    }
    // Mid-turn, `msb stop` kills the agent and the thread ends on "the sandbox restarted mid-run"
    // (seen live 2026-11-19 on an Instabox box: exit 254, the turn's work lost). The same answer the
    // host pause gives; the thread header disables the item, the command palette did not know.
    // A turn the controller started itself (turnStarted) is judged by a read that began after it:
    // the hub's cached snapshot from before the reply still says "done". The mark alone refused a
    // Sleep for up to a sweep after the turn had ended (seen live 2026-11-20: 409 on a finished
    // box, the fifth pass on instabox-b).
    if (!force && (await watchHub.read(session, turnStarted.get(session))).runState === "running") {
      res.status(409).json({ error: "the agent is working on this machine; wait for the turn to end or stop the run first" });
      return;
    }
    const outcome = await stopBox(hcfg(session), session);
    if (outcome === "absent") {
      res.status(404).json({ error: "no such machine" });
      return;
    }
    if (outcome === "failed") {
      res.status(503).json({ error: "the sandbox host could not stop this machine — try again shortly" });
      return;
    }
    noteStopped(session);
    watchHub.drop(session); // the cached "running" snapshot must not be served as live
    res.json({ ok: true });
  } catch (e) {
    failWith(res, e);
  }
});

/**
 * Resize a box (memory or root disk). Always a reboot — this runtime has no live resize — done as
 * ONE sequence here rather than three calls from the browser, so a closed tab halfway through can
 * no longer leave a box resized but never resumed:
 *   1. a live turn is PAUSED cleanly (pauseRunForResize: SIGTERM, a "paused to add memory" row in
 *      the log, exit 252) — the old hard restart under a running agent lost its unflushed output
 *      and the next probe wrote "the sandbox restarted mid-run" over it;
 *   2. the box is rebooted with the new size, /tmp stashed across it (setBoxMemory);
 *   3. with `continue`, the same session is resumed with the controller's continuation line
 *      (resizeContinueMessage), which the thread draws as a lifecycle row, not as the user's words.
 * The watch snapshot is dropped for the same reason /wake.json does: the pre-reboot cache must not
 * be served as live. `noteRunning` because `msb modify --restart` brings the box back up.
 */
async function resizeBox(session: string, what: "memory" | "storage", tier: MemoryTier | DiskTier, cont: boolean): Promise<{ paused: boolean; continued: boolean }> {
  ownership.assertCanRun(); // resize reboots the box back up — same gate as wake
  const c = hcfg(session);
  await hostPool.readyForBox(session, `resize ${session}`);
  const paused = await withOwner(ownerOf(db, session) ?? null, () => pauseRunForResize(c, session, what, tier));
  watchHub.drop(session);
  if (what === "memory") await setBoxMemory(c, session, tier as MemoryTier);
  else await setBoxDisk(c, session, tier as DiskTier);
  noteRunning(session);
  watchHub.drop(session);
  if (!cont) return { paused, continued: false };
  await resumeQuietly(session, resizeContinueMessage(what, tier));
  return { paused, continued: true };
}

app.post("/memory.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const session = boxParam(req.body);
  const { memory, continue: cont } = (req.body ?? {}) as { memory?: string; continue?: boolean };
  if (!session || !/^[\w.-]+$/.test(session)) {
    res.status(400).json({ error: "session is required" });
    return;
  }
  if (!isMemoryTier(memory)) {
    res.status(400).json({ error: `memory must be one of ${MEMORY_TIERS.join(", ")}` });
    return;
  }
  try {
    const r = await resizeBox(session, "memory", memory, cont === true);
    res.json({ ok: true, memory, ...r });
  } catch (e) {
    failWith(res, e);
  }
});

/**
 * Grow a box's root disk. Same pause-reboot-resume sequence as /memory.json, with one extra
 * constraint: the runtime cannot SHRINK a managed disk, so a tier below the current size is refused
 * here rather than left to fail confusingly inside msb.
 */
app.post("/disk.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const session = boxParam(req.body);
  const { disk, continue: cont } = (req.body ?? {}) as { disk?: string; continue?: boolean };
  if (!session || !/^[\w.-]+$/.test(session)) {
    res.status(400).json({ error: "session is required" });
    return;
  }
  if (!isDiskTier(disk)) {
    res.status(400).json({ error: `disk must be one of ${DISK_TIERS.join(", ")}` });
    return;
  }
  try {
    const r = await resizeBox(session, "storage", disk, cont === true);
    res.json({ ok: true, disk, ...r });
  } catch (e) {
    failWith(res, e);
  }
});

// Source control for one cloned repo, from the workspace pane: status / commit-all / push.
app.post("/git.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const session = boxParam(req.body);
  const { repo, action, message } = (req.body ?? {}) as { repo?: string; action?: string; message?: string };
  if (!session || !/^[\w.-]+$/.test(session) || !repo) {
    res.status(400).json({ error: "session and repo are required" });
    return;
  }
  try {
    if (action === "status") res.json(await gitStatus(hcfg(session), session, repo));
    else if (action === "commit") res.json(await gitCommitAll(hcfg(session), session, repo, String(message ?? "")));
    else if (action === "push") {
      // PR-only for automation-started runs, enforced here too — independent of the box-side hook.
      if (startedByOf(db, session)?.kind === "trigger") await assertPrOnlyPush(hcfg(session), session, repo);
      res.json({ output: redactor.redact((await gitPush(hcfg(session), session, repo)).output) });
    }
    else res.status(400).json({ error: "action must be status | commit | push" });
  } catch (e) {
    res.status(422).json({ error: clientError(e, 500) });
  }
});

// Every file under /workspace (same exclusions as the @-mention index), for the file explorer.
app.get("/tree.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const session = boxParam(req.query);
  if (!session) {
    res.status(400).json({ error: "session query param required" });
    return;
  }
  try {
    // details=1: sizes + mtimes for the workspace records table. Same exclusions, same cap, its own
    // (short-lived) fetch — the plain path index stays the cheap default for @-mention search.
    if (req.query.details === "1") {
      const out = (await execInBox(hcfg(session), session, fileDetailsCommand())).stdout;
      const files = parseFileDetails(out);
      res.json({ files, total: files.length, truncated: files.length >= FILE_INDEX_CAP });
      return;
    }
    res.json(await fileIndex(session, "", Number.POSITIVE_INFINITY));
  } catch (e) {
    failWith(res, e);
  }
});

// Write one text file under /workspace (the explorer's editor). Path-confined like /artifact; the
// body travels base64 so no byte can escape the shell quoting. Size-capped at 2 MB.
app.put("/file.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const session = boxParam(req.body);
  const { path, content, encoding } = (req.body ?? {}) as { path?: string; content?: string; encoding?: string };
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
    await execInBox(hcfg(session), session, `mkdir -p ${q(dir)} && base64 -d > ${q(abs)} && wc -c < ${q(abs)}`, { input: b64 });
    res.json({ ok: true, path: safe.relPath, bytes: isB64 ? Buffer.from(b64, "base64").length : Buffer.byteLength(content, "utf8") });
  } catch (e) {
    res.status(422).json({ error: clientError(e, 400) });
  }
});

app.get("/search.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const session = boxParam(req.query);
  const q = typeof req.query.q === "string" ? req.query.q : "";
  if (!session || !/^[\w.-]+$/.test(session) || !q || q.length > 200) {
    res.status(400).json({ error: "session and q (1-200 chars) are required" });
    return;
  }
  try {
    const r = await execInBox(hcfg(session), session, searchCommand({ regex: req.query.regex === "1", caseSensitive: req.query.case === "1" }), {
      input: q.replace(/\r?\n/g, " ") + "\n",
    });
    const found = parseSearchOutput(r.stdout);
    // 1 is "nothing matched"; a higher status with nothing matched is a bad pattern or an unreadable
    // tree (with matches it is a per-file warning the results already answer).
    const status = searchExitStatus(r.stderr) ?? 0;
    if (status >= 2 && found.matches.length === 0) {
      res.status(422).json({ error: redactor.redact(searchStderr(r.stderr).slice(-400)) || "search failed" });
      return;
    }
    res.json(found);
  } catch (e) {
    res.status(422).json({ error: clientError(e, 400) });
  }
});

app.post("/fs.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const session = boxParam(req.body);
  if (!session || !/^[\w.-]+$/.test(session)) {
    res.status(400).json({ error: "session is required" });
    return;
  }
  const confined = confineFsOp(req.body);
  if (!confined.ok) {
    res.status(confined.status).json({ error: confined.message });
    return;
  }
  try {
    await execInBox(hcfg(session), session, fsCommand(confined.op));
  } catch (e) {
    const known = fsFailure(exitCodeOf(e));
    if (known) res.status(known.status).json({ error: known.message });
    else res.status(422).json({ error: clientError(e, 400) });
    return;
  }
  fileIndex.invalidate(session);
  try {
    res.json({ ok: true, files: (await fileIndex(session, "", Number.POSITIVE_INFINITY)).files });
  } catch (e) {
    failWith(res, e);
  }
});

app.get("/files.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const session = boxParam(req.query);
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

// ---- The browser pane (src/browser.ts) -----------------------------------------------------------
// One action per call, in order per box; the reply is the page state and a JPEG. The box name is
// validated and ownership-checked at the edge like every other box route.
const browserQueue = makeBoxQueue();
app.post(BROWSER_ACT_PATH, async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const session = boxParam(req.body);
  if (!isBoxName(session)) {
    res.status(400).json({ error: "session is required" });
    return;
  }
  const parsed = parseBrowserAction(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.message });
    return;
  }
  try {
    const r = await browserQueue(session, async () => {
      // Quick path first (curl to a helper that is already up); the full script only to start one.
      const fast = await execInBox(hcfg(session), session, browserFastSh(), { input: JSON.stringify(parsed.action), timeoutMs: 70_000 }).catch(() => null);
      if (fast && !browserFastMissed(fast.stdout)) return fast;
      return execInBox(hcfg(session), session, "node -", { input: browserStubScript(parsed.action), timeoutMs: 70_000 });
    });
    res.setHeader("Cache-Control", "no-store");
    res.json(parseBrowserReply(r.stdout));
  } catch (e) {
    res.status(422).json({ error: clientError(e, 300) });
  }
});
// A box born from an image that predates the browser gets it on first use: one download, then
// it stays for the life of the box.
app.post("/browser/install.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const session = boxParam(req.body);
  if (!isBoxName(session)) {
    res.status(400).json({ error: "session is required" });
    return;
  }
  try {
    await browserQueue(session, () => execInBox(hcfg(session), session, moliInstallSh(), { timeoutMs: 240_000 }));
    res.json({ ok: true });
  } catch (e) {
    console.error(`[browser] install failed in ${session}: ${redactor.redact(String((e as Error)?.message ?? e)).slice(-400)}`);
    res.status(422).json({ error: "The browser could not be downloaded into this sandbox. Check that it can reach github.com, then try again." });
  }
});

// Per-message revert: which operator messages have a restore point, and the revert itself.
// Checkpoints are in-box tars (src/checkpoint.ts) — restore is ~1 s, no VM stop/boot.
app.get("/revert-points.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const session = boxParam(req.query);
  if (!isBoxName(session)) {
    res.status(400).json({ error: "session query param required" });
    return;
  }
  try {
    const turns = parseCkptLs((await execInBox(hcfg(session), session, listCmd())).stdout);
    // Checkpoint t<n> is the restore point for operator message n+1 (see checkpointForMessage).
    res.json({ messages: turns.map((n) => n + 1) });
  } catch {
    // A gone/bogus box has no revert points — that's an empty list, not a 500 (found by the
    // negative-scenario sweep: the exec failure was surfacing as a plumbing error).
    res.json({ messages: [] });
  }
});
app.post("/revert.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const session = boxParam(req.body);
  const { message } = (req.body ?? {}) as { message?: number };
  const k = Number(message);
  const turn = checkpointForMessage(k);
  if (!isBoxName(session) || turn === null) {
    res.status(400).json({ error: "session and message (≥2) are required" });
    return;
  }
  try {
    const snap = await watchHub.read(session);
    if (!canRevert(snap.runState)) {
      res.status(409).json({ error: "The agent is mid-turn — wait for it to finish (or stop it) before reverting." });
      return;
    }
    await withBoxLock(session, async () => {
      // The discarded-count for the seam line is computed in-box from the live log (revertCmd).
      const r = await execInBox(hcfg(session), session, revertCmd(turn));
      if (!/CKPT_RESTORED/.test(r.stdout)) throw new Error(r.stdout.trim().slice(-300) || "restore did not complete");
    });
    watchHub.drop(session); // next poll reads the restored (shorter) log fresh
    res.json({ ok: true, message: k });
  } catch (e) {
    res.status(422).json({ error: clientError(e, 400) });
  }
});

/**
 * End a thread for good: archive what the last snapshot knows, tear the box down (waking its host
 * when it must), and drop every controller-side trace of it. The Destroy button, the bulk "destroy
 * sleeping" and the sleep reaper (src/sleep-reaper.ts) all come through here. `boxGone`: the host
 * already lists the thread without its box, so nothing is torn down and no host is woken.
 */
const destroyThread = async (session: string, opts: { force?: boolean; boxGone?: boolean } = {}): Promise<void> => {
  // Archive fallback: a run that finished without a fleet sweep observing the edge (controller
  // restart, teardown racing the sweep) would evaporate. Best-effort from the last-known snapshot
  // BEFORE the box is destroyed; files may be empty here (a stopped box can't answer listChanges —
  // honest degradation), and the dedupe rule in archiveRun makes this a no-op when the sweep
  // already recorded the same finish.
  await archiveFinishedRun(session, { withFiles: false }).catch(() => {});
  if (!opts.boxGone) await deps.teardown(hcfg(session), session, { force: opts.force === true });
  // The teardown forgets the box's host mapping itself; with no box to tear down, do it here, or
  // a paused host's remembered listing brings the closed thread back on the next sweep.
  else hostPool.forgetBox(session);
  readFleet.forget(session);
  watchHub.drop(session);
  inbox.clear(session);
  markThreadDeleted(db, session);
  void removeTranscript(cfg, session);
  boxModels.delete(session);
  boxVerify.delete(session);
  boxVerified.delete(session);
  verifyRetrier?.forget(session);
  if (!opts.boxGone) void forgetTitle(hcfg(session), session).catch(() => {});
};

/**
 * The sleep TTL, judged by the controller from the thread rows (src/sleep-reaper.ts): a temporary
 * box past it is destroyed wherever its host is, asleep or not; an automation's box goes as soon
 * as it is not running. Hosts are taken one at a time within, so a paused one is woken once for
 * all its overdue boxes; a kept box is refused by the teardown and left.
 */
let sleepReapRunning = false;
const sleepReapTick = async (): Promise<void> => {
  if (sleepReapRunning) return;
  sleepReapRunning = true;
  try {
    const sleepTtlSec = parseDurationSec(cfg.sleepTtl);
    if (!sleepTtlSec) return;
    const now = Date.now();
    // A box parked on a question is held longer only when ask-park stops it the moment it asks
    // (ASK_PARK=1); otherwise it fell asleep after the idle timeout like any other, and the sleep
    // TTL is the rule for every temporary box (the owner's rule: idle → asleep → an hour → gone).
    const actions = reapVerdicts({ rows: listThreads(db), startedBy: (id) => startedByOf(db, id), nowMs: now, sleepTtlSec, parkTtlSec: askParkEnabled() ? askParkTtlSec() : sleepTtlSec });
    for (const a of actions) {
      if (a.action === "clock") upsertThread(db, { id: a.id, boxStatus: "stopped" }, now);
    }
    await Promise.all(
      [...groupByHost(actions.filter((a) => a.action !== "clock"))].map(async ([host, list]) => {
        for (const a of list) {
          try {
            await destroyThread(a.id, { boxGone: a.action === "forget" });
            console.error(`[sleep] ${a.id}${host ? ` on ${host}` : ""}: ${a.action === "forget" ? "thread closed" : "destroyed"} (${a.why})`);
          } catch (e) {
            if (e instanceof KeptBoxError) continue;
            console.error(`[sleep] ${a.id}${host ? ` on ${host}` : ""}: could not destroy (${a.why}): ${String((e as Error).message ?? e).slice(0, 200)}`);
          }
        }
      })
    );
  } catch (e) {
    console.error(`[sleep] sweep failed: ${String((e as Error).message ?? e).slice(0, 200)}`);
  } finally {
    sleepReapRunning = false;
  }
};

app.post("/teardown.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const session = boxParam(req.body);
  const { force } = (req.body ?? {}) as { force?: boolean };
  if (!isBoxName(session)) {
    res.status(400).json({ error: "session is required" });
    return;
  }
  try {
    // Archive fallback: a run that finished without a fleet sweep observing the edge (controller
    // restart, teardown racing the sweep) would evaporate. Best-effort from the last-known snapshot
    // BEFORE the box is destroyed; files may be empty here (a stopped box can't answer listChanges —
    // honest degradation), and the dedupe rule in archiveRun makes this a no-op when the sweep
    // already recorded the same finish.
    // A kept thread is destroyed only when the caller says `force` (the thread's own dialog, which
    // names the keep); the bulk "destroy sleeping" never passes it, so it can never take a kept one.
    await destroyThread(session, { force: force === true });
    res.json({ ok: true });
  } catch (e) {
    if (e instanceof KeptBoxError) {
      res.status(409).json({ error: e.message, kept: true });
      return;
    }
    failWith(res, e);
  }
});

// --- Triggers (docs/plan-agent-cloud.md, workstream C) ------------------------------------------
// Every fire runs the SAME runDelegateFlow as the composer, under the trigger OWNER's principal (so
// quota, trial gate and box ownership all apply) and tagged with a `trigger` StartedBy for the receipt.
function auditTrigger(owner: string, action: string, detail: Record<string, string | undefined>): void {
  try {
    db.prepare(`INSERT INTO audit_events (at, user_id, client, method, path, status, session, action) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      new Date().toISOString(),
      owner === OPERATOR_OWNER ? "operator" : owner,
      "trigger",
      "TRIGGER",
      `/triggers/${detail.trigger ?? ""}`,
      200,
      detail.box ?? null,
      `${action}${detail.outcome ? `:${detail.outcome}` : ""}`
    );
  } catch {
    /* audit storage must never fail a fire */
  }
}
const startTriggerRun = (input: StartRunInput): Promise<{ ok: true; box: string } | { ok: false; question: string }> =>
    withOwner(input.owner, () =>
      withStartedBy(input.startedBy, async () => {
        const t = input.trigger;
        let repos = input.repos;
        // A chain hands off from the finished parent: same repos@branch plus the carry diff.
        if (input.after) {
          if (!deps.handoff) return { ok: false as const, question: "handoff is not available on this controller" };
          const h = await deps.handoff(cfg, input.after, { task: input.task, ...(t.repos?.length === 1 ? { repo: t.repos[0] } : {}), carry: t.spec.carry });
          if (!h.ok) return { ok: false as const, question: h.question };
          repos = h.repos;
        }
        // A trigger's harness fills what the trigger leaves out (its own agent/model win), through
        // the same applyHarness the composer uses. A missing or unreviewed harness fails the fire.
        let hb: Record<string, unknown> = { task: input.task, ...(t.agent ? { agent: t.agent } : {}), ...(t.model ? { model: t.model } : {}) };
        const th = t.harnessId ? getHarness(t.harnessId, input.owner) : undefined;
        if (t.harnessId && !th) return { ok: false as const, question: "The trigger's harness no longer exists." };
        let hRules: string | undefined;
        if (th) {
          try {
            const applied = applyHarness(th, hb);
            hb = applied.body as Record<string, unknown>;
            hRules = applied.rules;
          } catch (e) {
            return { ok: false as const, question: (e as Error).message };
          }
        }
        // A trigger's workflow: the rendered task fills {{task}} in step one; later steps run on the finish edge.
        const tw = t.workflowId ? getWorkflow(t.workflowId, input.owner) : undefined;
        if (t.workflowId && !tw) return { ok: false as const, question: "The trigger's workflow no longer exists." };
        const rawTask = typeof hb.task === "string" ? hb.task : input.task;
        const tf = tw ? firstTask(tw, rawTask) : undefined;
        const hProvider = typeof hb.provider === "string" ? getProvider(hb.provider, input.owner) : undefined;
        if (typeof hb.provider === "string" && !hProvider) return { ok: false as const, question: "The harness's provider no longer exists." };
        let model: string | undefined;
        const wantModel = typeof hb.model === "string" ? hb.model : undefined;
        if (wantModel && hProvider) {
          if (hProvider.models?.length && !hProvider.models.includes(wantModel)) return { ok: false as const, question: `Unknown model '${wantModel}' for ${hProvider.label}.` };
          model = wantModel;
        } else if (wantModel) {
          const catalog = await fetchModels(cfg).catch(() => []);
          if (!isAllowedModel(wantModel, catalog, cfg)) return { ok: false as const, question: `Unknown model '${wantModel}'.` };
          model = wantModel;
        }
        let hVerify: VerifyPlan | undefined;
        if (hb.verify !== undefined) {
          const vp = verifyPlanOf(hb.verify as Record<string, unknown>);
          if (!vp.ok) return { ok: false as const, question: vp.question };
          hVerify = vp.plan ?? undefined;
        }
        const hAgent = typeof hb.agent === "string" ? hb.agent : undefined;
        const agent = hAgent && isAgentKind(hAgent) ? hAgent : loadAgentPrefs(input.owner).defaultAgent;
        const hSkills = Array.isArray(hb.skills) ? (hb.skills as string[]) : undefined;
        const hEgress = Array.isArray(hb.allowDomains) ? (hb.allowDomains as string[]) : undefined;
        // Vault secrets granted to this unattended run: the harness's list plus the repos' profiles' envVars.
        const tSecrets = resolveSecrets(db, secretBox, input.owner, [...(th?.secrets ?? []), ...(repos ?? []).flatMap((rp) => getSetup(db, input.owner, rp.repo)?.envVars ?? [])]);
        const r = await runDelegateFlow(cfg, deps, {
          ...(Object.keys(tSecrets).length ? { secrets: tSecrets } : {}),
          agent,
          source: "git",
          ...(repos?.length ? { repos } : {}),
          task: tf ? tf.task : rawTask,
          model,
          ...(hProvider ? { provider: hProvider } : {}),
          ...(hVerify ? { verify: hVerify } : {}),
          ...(hEgress?.length ? { allowDomains: hEgress } : {}),
          ...(hSkills ? { skills: hSkills } : {}),
          ...(hRules ? { rules: hRules } : {}),
          // A harness-pinned partial-supervision driver carries its own acknowledgement (applyHarness).
          allowPartialSupervision: hb.allowPartialSupervision === true,
          detach: true,
        });
        if (!r.ok) return { ok: false as const, question: r.question };
        if (model) boxModels.set(r.box, model);
        if (hProvider) boxProviders.set(r.box, hProvider.label);
        if (hVerify) boxVerify.set(r.box, hVerify);
        if (hVerify && th) verifyRetrier?.arm(r.box, autoRetryOf(th.rules.autoRetry));
        if (tw && tf) workflowEngine.arm(r.box, tw, rawTask, tf.cursor);
        if (th) {
          try {
            recordRunHarness(db, { box: r.box, owner: input.owner, harnessId: th.id, harnessName: th.name, skills: hSkills });
          } catch {
            /* bookkeeping only */
          }
        }
        // PR-only at the git layer: a pre-push hook refusing the default branch (src/pr-only.ts).
        // Fail closed: no guard, no run. The box is torn down and the fire is recorded as failed.
        // On the box's own host: with the primary's config every fire whose box landed on another
        // host failed here with "sandbox not found" (every Deal Reviewer delivery, 2026-11-21/22),
        // and the failed start left a thread row the sleep reaper had to close later.
        const guard = await guardOrStop(r.box, (b) => installPrOnlyGuard(hcfg(b), b), (b) => destroyThread(b));
        if (!guard.ok) return guard;
        void generateTitle(hcfg(r.box), r.box, t.name).catch(() => {});
        return { ok: true as const, box: r.box };
      })
    );
/**
 * The GitHub REST/GraphQL API as the owner, with their own stored token (the account that can
 * reach `repo`). Server-side only: the dashboard CSP never talks to GitHub.
 */
const ghAsOwner = (owner: string, repo: string, req: GhRequest): Promise<any> =>
  withOwner(owner, async () => {
    const store = await loadStore(cfg);
    // An account with a verified repo under this owner very likely reaches the owner's other repos
    // (and is the one to install an org webhook with) when nothing matches more precisely.
    const under = `${(repoOwnerOf(repo) ?? "").toLowerCase()}/`;
    const acc = candidateAccounts(store, repo)[0] ?? (under.length > 1 ? Object.values(store.accounts).find((a) => a.verifiedRepos.some((r) => r.toLowerCase().startsWith(under))) : undefined);
    if (!acc) throw new Error("no stored GitHub account can reach this repo");
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15_000);
    try {
      const r = await fetch(`https://api.github.com${req.path}`, {
        method: req.method ?? "GET",
        headers: {
          authorization: `Bearer ${acc.token}`,
          accept: "application/vnd.github+json",
          "user-agent": "agent-sandbox",
          ...(req.body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
        redirect: "follow", // job logs answer with a redirect to blob storage
        signal: ctl.signal,
      });
      if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
      if (req.text) {
        const t = await r.text();
        return t.length > 2_000_000 ? t.slice(-2_000_000) : t;
      }
      return r.status === 204 ? null : await r.json();
    } finally {
      clearTimeout(timer);
    }
  });
const dispatcher = makeDispatcher({
  db,
  publicUrl: cfg.publicUrl,
  log: (m) => console.error(m),
  audit: (owner, action, detail) => auditTrigger(owner, action, detail),
  // Every five minutes the dispatcher frees slots held by boxes that are gone. While the host sleeps
  // nothing launches or dies unseen (a launch wakes it first), so the last sweep is the live set; a
  // fresh sweep here was the one SSH that kept a sleeping host from pausing (seen live 2026-11-16).
  liveBoxes: async () => (await sweepHosts(cfg)).boxes.map((b) => b.name),
  startRun: startTriggerRun,
  // The receipt comment on the issue/PR that fired the run, with the owner's own GitHub token.
  postComment: async (owner, repo, number, body) => {
    const r = await ghAsOwner(owner, repo, { method: "POST", path: `/repos/${repo}/issues/${number}/comments`, body: { body: redactor.redact(body) } });
    return typeof r?.html_url === "string" ? r.html_url : undefined;
  },
});
// Repo activity (src/repo-watch.ts): polls GitHub as each automation's owner, conditional on the
// last ETag (a 304 is free against the rate limit), and fires matching automations on what changed.
// Rate-limit headers ride back on every answer so the watcher can slow down before the owner's
// quota (shared with their dashboard and runs) is spent; a 403/429 is a typed error it backs off on.
const repoWatcher = makeRepoWatcher({
  db,
  dispatcher,
  redact: (s) => redactor.redact(s),
  log: (m) => console.error(m),
  get: (owner, repo, path, etag) =>
    withOwner(owner, async () => {
      const acc = candidateAccounts(await loadStore(cfg), repo)[0];
      if (!acc) throw new Error("no stored GitHub account can reach this repo");
      const r = await fetch(`https://api.github.com${path}`, {
        headers: { authorization: `Bearer ${acc.token}`, accept: "application/vnd.github+json", "user-agent": "agent-sandbox", ...(etag ? { "if-none-match": etag } : {}) },
        signal: AbortSignal.timeout(15_000),
      });
      const rate = rateInfoOf(r.headers);
      if (r.status === 304) return { notModified: true as const, rate };
      if (r.status === 403 || r.status === 429) throw new GhRateLimitError(r.status, rate, path.split("?")[0]);
      if (!r.ok) throw new Error(`GitHub answered ${r.status} for ${path.split("?")[0]}`);
      return { notModified: false as const, data: await r.json(), etag: r.headers.get("etag") ?? undefined, login: acc.login, rate };
    }),
});
const FOLLOWUP_PREFS_KIND = "pr-followups";
const loadFollowupPrefs = (owner: string): FollowupPrefs => {
  try {
    const raw = loadBlob(FOLLOWUP_PREFS_KIND, owner);
    return normalizePrefs(raw ? JSON.parse(raw) : {});
  } catch {
    return normalizePrefs({});
  }
};
/**
 * PR follow-ups (src/pr-followup-engine.ts): back on an agent PR's branch when CI fails or review
 * feedback lands. Starts through the SAME trigger start path (harness, PR-only guard, title) with a
 * synthetic automation row carrying the original run's harness/agent/model.
 */
const followups = makeFollowupEngine({
  db,
  publicUrl: cfg.publicUrl,
  log: (m) => console.error(m),
  redact: (s) => redactor.redact(s),
  gh: ghAsOwner,
  prefs: loadFollowupPrefs,
  triggerSpec: (id) => getTriggerById(db, id)?.spec,
  logDelivery: (id, e) => logDelivery(db, id, e),
  startFollowup: (f) => {
    const at = Date.now();
    const pseudo: TriggerRow = {
      id: f.pr.triggerId ?? `followup:${f.pr.repo}#${f.pr.number}`,
      owner: f.owner,
      name: `${f.startedBy.followup === "ci" ? "Fix CI" : f.startedBy.followup === "command" ? "/agent" : "Address review"} · ${f.pr.repo}#${f.pr.number}`,
      kind: "github",
      spec: {},
      repos: [f.startedBy.pr.repo],
      taskTemplate: f.task,
      enabled: true,
      prComment: false,
      quiet: false,
      proposed: false,
      scope: "automation",
      ...(f.pr.agent ? { agent: f.pr.agent } : {}),
      ...(f.pr.model ? { model: f.pr.model } : {}),
      ...(f.pr.harnessId ? { harnessId: f.pr.harnessId } : {}),
      lastFired: null,
      nextFire: null,
      lastResult: null,
      hasPayload: false,
      hasSigningSecret: false,
      createdAt: at,
      updatedAt: at,
    };
    return startTriggerRun({ owner: f.owner, trigger: pseudo, task: f.task, repos: [{ repo: f.startedBy.pr.repo, ref: f.branch }], startedBy: f.startedBy });
  },
});
// `/agent …` on any PR (src/agent-mentions.ts): as each stored GitHub account, with its own token,
// the controller lists the PRs updated since its last look and reads their new comments; those
// addressed to the agent go to the follow-up engine, which adopts the PR and answers on it. No
// webhook, no repo list.
const mentionWatcher = makeMentionWatcher({
  db,
  engine: followups,
  log: (m) => console.error(m),
  enabled: (owner) => loadFollowupPrefs(owner).commandAnywhere,
  accounts: async () => {
    const out: Array<{ owner: string; login: string }> = [];
    const owners = [OPERATOR_OWNER, ...listUsers(db).map((u) => u.id)];
    for (const owner of owners) {
      try {
        const store = await withOwner(owner, () => loadStore(cfg));
        for (const a of Object.values(store.accounts)) if (a.login) out.push({ owner, login: a.login });
      } catch {
        /* an owner without a usable token store is simply not watched */
      }
    }
    return out;
  },
  get: (owner, login, path, etag) =>
    withOwner(owner, async () => {
      const acc = (await loadStore(cfg)).accounts[login];
      if (!acc) throw new Error(`no stored token for @${login}`);
      const r = await fetch(`https://api.github.com${path}`, {
        headers: { authorization: `Bearer ${acc.token}`, accept: "application/vnd.github+json", "user-agent": "agent-sandbox", ...(etag ? { "if-none-match": etag } : {}) },
        signal: AbortSignal.timeout(15_000),
      });
      const rate = rateInfoOf(r.headers);
      const pollRaw = Number(r.headers.get("x-poll-interval"));
      const pollInterval = Number.isFinite(pollRaw) && pollRaw > 0 ? pollRaw : undefined;
      if (r.status === 304) return { notModified: true as const, rate, ...(pollInterval ? { pollInterval } : {}) };
      if (r.status === 403 || r.status === 429) throw new GhRateLimitError(r.status, rate, path.split("?")[0]);
      if (!r.ok) throw new Error(`GitHub answered ${r.status} for ${path.split("?")[0]}`);
      return { notModified: false as const, data: await r.json(), etag: r.headers.get("etag") ?? undefined, rate, ...(pollInterval ? { pollInterval } : {}) };
    }),
});
registerFollowupRoutes(app, {
  db,
  box: secretBox,
  engine: followups,
  dashAuthed,
  principalOf,
  failWith,
  loadPrefs: loadFollowupPrefs,
  savePrefs: (owner, p) => saveBlob(FOLLOWUP_PREFS_KIND, JSON.stringify(p), owner),
  publicUrl: cfg.publicUrl,
  audit: auditTrigger,
  gh: ghAsOwner,
});
registerTriggerRoutes(app, {
  followups,
  db,
  box: secretBox,
  dispatcher,
  dashAuthed,
  principalOf,
  failWith,
  redact: (s) => redactor.redact(s),
  publicUrl: cfg.publicUrl,
  audit: auditTrigger,
  // Chat names for the Scheduled table. Cosmetic: a slow fleet read just shows machine names.
  titles: () =>
    Promise.race([
      Promise.all(hostPool.active().filter((h) => !hostPool.dormant(h.spec.id) && !h.unreachableSince).map((h) => loadTitles(h.cfg).catch(() => ({})))).then((all) => Object.assign({}, ...all) as Record<string, string>),
      new Promise<Record<string, string>>((r) => setTimeout(() => r({}), 1500)),
    ]),
  rejects: (box) => scheduleRejects.get(box) ?? [],
});
// Intake (src/intake-routes.ts): email / Slack / pasted links start runs as the owner, through the
// same runDelegateFlow as the composer. User-initiated, so no PR-only guard (unlike an automation).
registerIntakeRoutes(app, {
  db,
  box: secretBox,
  dashAuthed,
  principalOf,
  failWith,
  publicUrl: cfg.publicUrl,
  audit: auditTrigger,
  // Only a GitHub-sourced address is verified; a password signup's email was never proven, so it
  // must be added to the allowlist explicitly.
  ownerEmail: (owner) => {
    if (owner === OPERATOR_OWNER) return null;
    const u = getUser(db, owner);
    return u?.github_id ? u.email ?? null : null;
  },
  listRepos: (owner) => withOwner(owner, () => listRepos()),
  githubToken: (owner, repo) => withOwner(owner, async () => candidateAccounts(await loadStore(cfg), repo)[0]?.token),
  startRun: (owner, input) =>
    withOwner(owner, () =>
      withStartedBy(input.startedBy, async () => {
        const r = await runDelegateFlow(cfg, deps, {
          agent: loadAgentPrefs(owner).defaultAgent,
          source: "git",
          ...(input.repo ? { repo: input.repo } : {}),
          task: input.task,
          ...(input.attachments?.length ? { attachments: input.attachments } : {}),
          detach: true,
        });
        if (!r.ok) return { ok: false as const, question: r.question };
        void generateTitle(hcfg(r.box), r.box, input.task).catch(() => {});
        return { ok: true as const, box: r.box };
      })
    ),
});
// Harnesses (src/harness.ts): definitions per owner, bundles, compares. The per-box skill selection
// a harness sets is made durable through run_harness so a resume installs the same skills.
registerSkillSelectionBackend(skillSelectionBackend(db));
registerSkillPickBackend(skillPickBackend(db));
registerWorkflowRoutes(app, {
  cfg,
  dashAuthed,
  ownerOf: (res) => providerOwner(res),
  clientError: (e) => clientError(e),
});
registerHarnessRoutes(app, {
  cfg,
  db,
  dashAuthed,
  ownerOf: (res) => providerOwner(res),
  clientError: (e) => clientError(e),
  redact: (s) => redactor.redact(s),
  loadSkills: () => loadSkillStore(cfg),
  addSkills: (skills) =>
    withStoreLock("skills", async () => {
      const store = await loadSkillStore(cfg);
      // Never overwrite: planImport already renamed clashes; a name taken since is skipped.
      for (const s of skills) if (!store.skills[s.name]) store.skills[s.name] = s;
      await saveSkillStore(cfg, store);
    }),
  liveDigest: async (box) => {
    const snap = await watchHub.read(box);
    if (snap.boxStatus === "missing") return null;
    const files = /^running$/i.test(snap.boxStatus) ? await listChanges(hcfg(box), box).catch(() => []) : [];
    return buildDigest({
      box,
      task: snap.task ?? "",
      runState: snap.runState,
      exitCode: snap.exitCode,
      events: parseTrace(snap.log ?? ""),
      files,
      verified: boxVerified.get(box),
      retries: retriesOf(box),
      ...runProvenance(box, snap.agent, snap.mcpNotes),
    }) as unknown as Record<string, unknown>;
  },
});
setInterval(() => {
  try {
    pruneDeliveries(db);
  } catch {
    /* retry next tick */
  }
}, 6 * 3600 * 1000).unref();

/** An archived outcome card with "followed by" resolved now (owner-scoped). */
const outcomeWithFollow = (owner: string, box: string, o: RunOutcome | null) => {
  if (!o) return null;
  const mine = (b: string) => (ownerOf(db, b) ?? OPERATOR_OWNER) === owner;
  let fu: ReturnType<typeof followupsForBox> = [];
  try {
    fu = followupsForBox(db, owner, box);
  } catch {
    fu = []; // follow-ups are an extra line on the card, never a reason it fails
  }
  return { ...o, result: { ...o.result, followedBy: resolveFollowedBy(db, owner, box, mine), followups: fu.map((f) => ({ ...f, line: followupLine(f) })) } };
};

// The outcome card (docs/plan-demo-parity.md bet 2): ?id=<archive id> or ?box=<name> (latest record).
app.get("/history/outcome.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const p = principalOf(res);
  const owner = p.kind === "user" ? p.userId : OPERATOR_OWNER;
  const id = typeof req.query.id === "string" ? Number(req.query.id) : undefined;
  const box = typeof req.query.box === "string" ? req.query.box : undefined;
  if (id === undefined ? !box || !/^[\w.-]+$/.test(box) : !Number.isInteger(id)) {
    res.status(400).json({ error: "id (integer) or box is required" });
    return;
  }
  try {
    const row = getDigest(db, owner, id !== undefined ? { id } : { box: box! });
    const outcome = row ? outcomeWithFollow(owner, row.box, outcomeOf(row.digest)) : null;
    if (!row || !outcome) {
      // "Not archived yet" is the ordinary answer while a run is open, and the console asks on
      // every thread it shows: with `soft` it gets a plain null instead of a 404 the browser logs
      // in red. Without it (the phone app, older tabs) the answer is the 404 it always was.
      if (req.query.soft === "1") res.json({ outcome: null });
      else res.status(404).json({ error: "no outcome for that run" });
      return;
    }
    res.json({ id: row.id, box: row.box, outcome });
  } catch (e) {
    failWith(res, e);
  }
});

// The History ledger: totals + filtered rows over the run archive. Totals come from stored columns
// only — cost is summed where a run reported one, never estimated.
app.get("/history/ledger.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const p = principalOf(res);
  const owner = p.kind === "user" ? p.userId : OPERATOR_OWNER;
  const q = req.query as Record<string, unknown>;
  const str = (k: string) => (typeof q[k] === "string" && (q[k] as string).trim() ? (q[k] as string).trim().slice(0, 80) : undefined);
  const num = (k: string) => {
    const n = Number(q[k]);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const f: LedgerFilter = {
    ...(num("since") ? { since: num("since") } : {}),
    ...(num("until") ? { until: num("until") } : {}),
    ...(str("startedBy") ? { startedBy: str("startedBy") } : {}),
    ...(str("trigger") ? { triggerId: str("trigger") } : {}),
    ...(str("agent") ? { agent: str("agent") } : {}),
    ...(str("state") ? { state: str("state") } : {}),
    ...(str("verified") ? { verified: str("verified") } : {}),
    ...(str("workflow") ? { workflow: str("workflow") } : {}),
  };
  try {
    res.json({
      totals: ledgerTotals(db, owner, f),
      rows: listLedger(db, owner, { ...f, limit: Math.min(num("limit") ?? 50, 200), ...(num("before") ? { before: num("before") } : {}) }).map((r) => ({
        ...r,
        outcome: outcomeWithFollow(owner, r.box, r.outcome),
      })),
    });
  } catch (e) {
    failWith(res, e);
  }
});

// Start a new delegation from the dashboard composer. Same validate -> resolve -> run flow as the
// MCP `delegate` tool (see delegate-flow.ts); source defaults to "git" here since a browser has no
// local working tree to ship.
type DelegateReply = { status: number; json: Record<string, unknown> };
/**
 * The composer's delegation, factored out of the route so an attempt group (src/attempts.ts) and the
 * MCP `attempts` lane start each attempt through exactly the same gates. `principal` replaces the
 * response locals; `attempt` links the box to its group instead of a harness compare.
 */
const delegateOnce = async (body: Record<string, unknown>, principal: Principal, attempt?: { groupId: string; index: number }): Promise<DelegateReply> => {
  // The launch bubble's feed: opened on the browser's id, closed by the flow's `started` step or by
  // whatever stopped the launch, so a viewer is never left waiting on a launch that already failed.
  // One attempt of a group does not report: the group's page follows its boxes, not one launch.
  const launchId = !attempt && isLaunchId(body.launchId) ? body.launchId : undefined;
  const launch = launchId ? launches.open(launchId, principal.kind === "user" ? principal.userId : OPERATOR_OWNER) : undefined;
  launch?.("accepted");
  try {
    const r = await delegateOnceInner(body, principal, attempt, launch);
    if (launchId && (r.status !== 200 || (r.json as { ok?: boolean }).ok === false)) {
      launches.fail(launchId, String((r.json as { error?: string; question?: string }).error ?? (r.json as { question?: string }).question ?? `HTTP ${r.status}`));
    }
    return r;
  } catch (e) {
    if (launchId) launches.fail(launchId, (e as Error).message ?? String(e));
    throw e;
  }
};

/**
 * `host` on a delegate body: the box host the run must land on. Admins only (where boxes boot is
 * the operator's business, as /hosts.json is); the id must be a registered, enabled host. Blank or
 * absent means the picker's choice, as ever.
 */
const hostChoice = (body: Record<string, unknown>, principal: Principal): { host?: string } | { status: number; error: string } => {
  if (body.host === undefined || body.host === null || body.host === "") return {};
  if (typeof body.host !== "string") return { status: 400, error: "host must be a box host id." };
  if (!isAdmin(principal)) return { status: 403, error: "Choosing the box host is for admins." };
  const h = hostPool.get(body.host);
  if (!h) return { status: 404, error: `no such box host: ${body.host}` };
  if (!h.spec.enabled) return { status: 400, error: `Box host ${h.spec.name} is disabled.` };
  return { host: h.spec.id };
};

const delegateOnceInner = async (body0: Record<string, unknown>, principal: Principal, attempt: { groupId: string; index: number } | undefined, launch: LaunchReporter | undefined): Promise<DelegateReply> => {
  let body = body0;
  if (typeof body.task !== "string" || !body.task.trim()) return { status: 400, json: { error: "task is required" } };
  const chosen = hostChoice(body, principal);
  if ("error" in chosen) return { status: chosen.status, json: { error: chosen.error } };
  const rawTask = body.task;
  {
    // A saved harness (src/harness.ts) fills the fields this body leaves out; explicit fields win.
    // Merged BEFORE validation so every harness value passes the same gates as a typed one.
    const hOwner = principal.kind === "user" ? principal.userId : OPERATOR_OWNER;
    let harness: HarnessDef | undefined;
    let applied: string[] = [];
    // The harness RULES go to the agent's system prompt (DelegatePlan.rules), never into the task.
    let harnessRules: string | undefined;
    if (typeof body.harness === "string" && body.harness) {
      harness = getHarness(body.harness, hOwner);
      if (!harness) {
        return { status: 400, json: { error: "Unknown harness." } };
      }
      try {
        const r = applyHarness(harness, body);
        body = r.body as Record<string, unknown>;
        applied = r.applied;
        harnessRules = r.rules;
      } catch (e) {
        return { status: 400, json: { error: (e as Error).message } };
      }
    }
    // A workflow (src/workflow.ts) rewrites the task to its first step and arms the engine on
    // success; the operator's typed text is kept as {{task}} and as the thread's title source.
    let workflow: WorkflowDef | undefined;
    let workflowCursor = 0;
    if (body.workflow !== undefined && body.workflow !== null && body.workflow !== "") {
      if (typeof body.workflow !== "string") return { status: 400, json: { error: "workflow must be a saved workflow id." } };
      workflow = getWorkflow(body.workflow, hOwner);
      if (!workflow) return { status: 400, json: { error: "Unknown workflow." } };
      const f = firstTask(workflow, rawTask);
      body = { ...body, task: f.task };
      workflowCursor = f.cursor;
    }
    let compareSide: "a" | "b" | undefined;
    const compareId = attempt ? attempt.groupId : typeof body.compareId === "string" && body.compareId ? body.compareId : undefined;
    if (compareId && !attempt) {
      const c = checkCompareSide(db, hOwner, compareId, body.compareSide, harness?.id);
      if (!c.ok) {
        return { status: 400, json: { error: c.error } };
      }
      compareSide = c.side;
    }
    let allowDomains: string[] | undefined;
    let skills: string[] | undefined;
    try {
      allowDomains = body.allowDomains === undefined ? undefined : normalizeEgress(body.allowDomains);
      if (body.skills !== undefined) {
        if (!Array.isArray(body.skills) || body.skills.length > HARNESS_LIMITS.maxSkills || !body.skills.every((s) => typeof s === "string" && /^[\w.-]{1,80}$/.test(s))) throw new Error("skills must be a list of skill names.");
        skills = [...new Set(body.skills as string[])];
      }
    } catch (e) {
      return { status: 400, json: { error: (e as Error).message } };
    }
    // Explicit repos from the picker win. With none given, a repo the TASK names ("review the last PR
    // in elseco deal service") is attached automatically, so the agent starts with the checkout it
    // was clearly asked about instead of hunting for it with `gh search`.
    const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
    if (typeof body.repo === "string" && !REPO_RE.test(body.repo.trim().replace(/\.git$/i, ""))) {
      return { status: 400, json: { error: "repo must be owner/name" } };
    }
    // Verified outcomes: validate FIRST (same rule as the MCP tool — a malformed clause must fail
    // before any box work). The plan is stored on success and run on the done edge of the sweep.
    let verifyPlan: VerifyPlan | undefined;
    if (body.verify !== undefined) {
      const vp = verifyPlanOf(body.verify as Record<string, unknown>);
      if (!vp.ok) {
        return { status: 400, json: { error: vp.question } };
      }
      verifyPlan = vp.plan ?? undefined;
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
        const matches = inferRepos(rawTask, await listRepos());
        inferred = matches.map((m) => m.fullName);
        repos = matches.map((m) => ({ repo: m.fullName, ref: undefined }));
      } catch {
        /* inference is best-effort; a task-only run is the honest fallback */
      }
    }
    // Files attached in the composer (pictures, PDFs, documents, a long paste): named now so the
    // task can reference them; staged by the flow. The tail's wording mirrors web/src/lib/attachments.ts
    // (`attachmentsTail`), which the bubble folds back into chips.
    const rawAtt = Array.isArray(body.attachments) ? (body.attachments as Array<{ name?: string; dataUrl?: string; kind?: string; note?: string }>) : [];
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    const attachments = rawAtt
      .filter((a) => typeof a.dataUrl === "string" && a.dataUrl.length < 11_000_000)
      .slice(0, 8)
      .map((a, i) => ({
        path: `.attachments/${stamp}-${i + 1}-${String(a.name ?? "file").replace(/[^\w.-]+/g, "-").slice(0, 60)}`,
        base64: a.dataUrl!,
        kind: a.kind === "image" || /\.(png|jpe?g|gif|webp)$/i.test(String(a.name ?? "")) ? "image" : "file",
        note: typeof a.note === "string" ? a.note.replace(/\s+/g, " ").trim().slice(0, 200) : "",
      }));
    const baseTask = typeof body.task === "string" ? body.task : rawTask;
    const allImages = attachments.every((a) => a.kind === "image");
    const noun = allImages ? (attachments.length === 1 ? "image" : "images") : attachments.length === 1 ? "file" : "files";
    const task = attachments.length
      ? `${baseTask}\n\nAttached ${noun} (open with the Read tool):\n${attachments.map((a) => `- /workspace/${a.path}${a.note ? `\n  ${a.note}` : ""}`).join("\n")}`
      : baseTask;
    if (ownership.isUser()) {
      ownership.assertCanRun();
      const p = principal;
      const max = (p.kind === "user" && getUser(db, p.userId)?.max_boxes) || cfg.userMaxBoxes;
      ownership.assertQuota(ownership.liveOwned((await readFleet()).boxes), max);
    }
    // Model pick for message 1: same catalog gate as /resume.json, and it seeds the sticky value.
    let model: string | undefined;
    // A user provider (src/providers.ts) brings its own model list; the controller catalog does not apply.
    const provider = typeof body.provider === "string" && body.provider ? getProvider(body.provider, hOwner) : undefined;
    if (typeof body.provider === "string" && body.provider && !provider) {
      return { status: 400, json: { error: "Unknown provider." } };
    }
    if (provider && typeof body.model === "string" && body.model.trim()) {
      const m = body.model.trim();
      if (!/^[\w.:\/@-]{1,120}$/.test(m) || (provider.models?.length && !provider.models.includes(m))) {
        return { status: 400, json: { error: `Unknown model '${m}' for ${provider.label}.` } };
      }
      model = m;
    } else if (typeof body.model === "string" && body.model.trim()) {
      const catalog = await fetchModels(cfg).catch(() => []);
      if (!isAllowedModel(body.model.trim(), catalog, cfg)) {
        return { status: 400, json: { error: `Unknown model '${body.model}'.` } };
      }
      model = body.model.trim();
    }
    // Agent pick for the thread: an explicit body.agent (closed enum) wins; otherwise the caller's
    // stored default. Validated here so an unknown value 400s instead of becoming a question blob.
    let agent: string;
    if (typeof body.agent === "string" && body.agent.trim()) {
      if (!isAgentKind(body.agent.trim())) {
        return { status: 400, json: { error: `Unknown agent '${body.agent}'. Allowed: ${AGENT_KINDS.join(", ")}` } };
      }
      agent = body.agent.trim();
    } else {
      const p = principal;
      agent = loadAgentPrefs(p.kind === "user" ? p.userId : OPERATOR_OWNER).defaultAgent;
    }
    // Repo setup (src/setup-profile.ts): this owner's learned profiles for the run's repos. A single
    // repo's test command becomes the default verify clause, so the outcome card gets real counts.
    const setupSlugs = (repos.length ? repos.map((r) => r.repo) : typeof body.repo === "string" ? [body.repo] : []).map(repoKey);
    const setup: Record<string, SetupProfile> = {};
    for (const s of setupSlugs) {
      const p = getSetup(db, hOwner, s);
      if (p) setup[s] = p;
    }
    if (!verifyPlan && setupSlugs.length === 1 && setup[setupSlugs[0]]?.test) {
      verifyPlan = { mode: "command", command: setup[setupSlugs[0]].test! };
    }
    // Vault secrets (src/secrets-store.ts) granted by name: the harness's list plus every repo
    // profile's envVars, resolved to the values this owner holds. Missing ones are simply not set.
    const grantedSecrets = resolveSecrets(db, secretBox, hOwner, [...(harness?.secrets ?? []), ...Object.values(setup).flatMap((p) => p.envVars)]);
    const result = await withStartedBy({ kind: "manual" }, () => runDelegateFlow(cfg, deps, {
      ...(setupSlugs.length ? { setup } : {}),
      ...(Object.keys(grantedSecrets).length ? { secrets: grantedSecrets } : {}),
      agent,
      attachments: attachments.length ? attachments : undefined,
      // A browser has no local tree to ship: git only. (`source:"local"` would rsync a controller-host path.)
      source: "git",
      repo: typeof body.repo === "string" ? body.repo : undefined,
      repos: repos.length ? repos : undefined,
      task,
      ref: typeof body.ref === "string" ? body.ref : undefined,
      githubToken: typeof body.githubToken === "string" ? body.githubToken : undefined,
      githubAccount: typeof body.githubAccount === "string" ? body.githubAccount : undefined,
      model,
      provider,
      allowPartialSupervision: body.allowPartialSupervision === true,
      verify: verifyPlan,
      ...(allowDomains?.length ? { allowDomains } : {}),
      ...(skills ? { skills } : {}),
      ...(harnessRules ? { rules: harnessRules } : {}),
      ...(chosen.host ? { host: chosen.host } : {}),
      // The browser needs only the box name (the thread attaches over SSE); blocking this response
      // on the interactive wait window made task starts ~50s slower than the box actually was.
      detach: true,
      onPhase: launch,
    }));
    if (result.ok) {
      if (model) boxModels.set(result.box, model);
      if (provider) boxProviders.set(result.box, provider.label);
      if (verifyPlan) boxVerify.set(result.box, verifyPlan);
      if (workflow) workflowEngine.arm(result.box, workflow, rawTask, workflowCursor);
      // The retry budget is a harness rule: a hand-typed verify clause without a harness stamps only.
      if (verifyPlan && harness) verifyRetrier?.arm(result.box, autoRetryOf(harness.rules.autoRetry));
      for (const [slug, p] of Object.entries(result.setupDetected ?? {})) {
        try {
          recordLearned(db, hOwner, slug, { detected: p });
        } catch {
          /* learning is bookkeeping; the run already started */
        }
      }
      if (harness || compareId) {
        try {
          recordRunHarness(db, { box: result.box, owner: hOwner, harnessId: harness?.id, harnessName: harness?.name, skills, compareId, side: attempt ? String(attempt.index) : compareSide });
        } catch {
          /* the link is bookkeeping; the run already started */
        }
      }
      void generateTitle(hcfg(result.box), result.box, rawTask).catch(() => {});
    }
    const extra = { ...(inferred.length ? { inferred } : {}), ...(harness ? { harness: { id: harness.id, name: harness.name, applied } } : {}) };
    return { status: 200, json: { ...result, ...extra } };
  }
};

// "Tries several approaches" (src/attempts.ts): N attempts of one task, scored by the controller,
// one PR. Each attempt is a delegateOnce with its own driver/model.
const attempts = makeAttempts({
  db,
  startOne: async (spec, task, link) => {
    const job = attemptJobs.get(link.groupId);
    if (!job) return { ok: false, question: "attempt group context lost" };
    const body: Record<string, unknown> = { ...job.body, task, attempts: undefined, attemptSpecs: undefined, compareId: undefined, compareSide: undefined, launchId: undefined };
    for (const k of ["agent", "model", "provider", "harness"] as const) if (spec[k]) body[k] = spec[k];
    if (spec.agent && !spec.model) delete body.model;
    if (spec.agent && !spec.provider && spec.model) delete body.provider;
    const r = await withPrincipal(job.principal, () => withStartedBy(job.startedBy, () => delegateOnce(body, job.principal, link)));
    const j = r.json as { ok?: boolean; box?: string; question?: string; error?: string };
    return r.status === 200 && j.ok && j.box ? { ok: true, box: j.box } : { ok: false, question: j.question ?? j.error ?? `HTTP ${r.status}` };
  },
  archived: (owner, box) => archivedDigestOf(db, owner, box),
  exists: async (box) => (await readFleet()).boxes.some((b) => b.name === box),
  exec: async (box, script) => (await execInBox(hcfg(box), box, script)).stdout,
  teardown: (box) => deps.teardown(hcfg(box), box),
  log: (m) => console.error(m),
});
// The launching request's context, for the duration of the launch only.
const attemptJobs = new Map<string, { body: Record<string, unknown>; principal: Principal; startedBy: StartedBy }>();
let attemptSweepAt = 0;
const sweepAttempts = (force = false) => {
  if (!force && Date.now() - attemptSweepAt < 20_000) return;
  attemptSweepAt = Date.now();
  // As the operator: the sweep acts on every owner's groups, whichever request happened to tick it.
  void withPrincipal({ kind: "operator" }, () => attempts.sweep()).catch((e) => console.error(`[attempts] sweep: ${(e as Error).message.slice(0, 200)}`));
};

const delegateAttempts = async (body: Record<string, unknown>, principal: Principal, n: number, given: AttemptSpec[] | undefined, startedBy: StartedBy): Promise<DelegateReply> => {
  if (typeof body.task !== "string" || !body.task.trim()) return { status: 400, json: { error: "task is required" } };
  if (body.compareId) return { status: 400, json: { error: "attempts cannot join a harness compare." } };
  // Refused here, before any attempt starts; each attempt's body carries the choice to delegateOnce.
  const chosen = hostChoice(body, principal);
  if ("error" in chosen) return { status: chosen.status, json: { error: chosen.error } };
  const owner = principal.kind === "user" ? principal.userId : OPERATOR_OWNER;
  // Fleet + per-user quota for ALL attempts up front: a group is never half-started on purpose.
  const live = await deps.countBoxes(cfg);
  const capacity = deps.capacity?.(cfg) ?? cfg.maxBoxes;
  const free = capacity - live - reservedBoxes();
  if (free < n) {
    return { status: 200, json: { ok: false, question: `Refused: ${n} attempts need ${n} free sandbox slots, but only ${Math.max(0, free)} of ${capacity} are free. Use fewer attempts, tear a run down, or raise MSB_MAX_BOXES.` } };
  }
  if (principal.kind === "user") {
    const max = getUser(db, principal.userId)?.max_boxes || cfg.userMaxBoxes;
    const owned = await withPrincipal(principal, async () => ownership.liveOwned((await readFleet()).boxes));
    if (owned + n > max) {
      return { status: 429, json: { error: `${n} attempts need ${n} sandboxes; your plan allows ${max} at once and ${owned} are running. Use fewer attempts or tear a run down.` } };
    }
  }
  const baseAgent = typeof body.agent === "string" && body.agent ? body.agent : loadAgentPrefs(owner).defaultAgent;
  const provs = loadProviders(owner);
  const specs =
    given ??
    defaultAttemptSpecs(n, {
      baseAgent,
      ...(typeof body.model === "string" && body.model ? { baseModel: body.model } : {}),
      ...(typeof body.provider === "string" && body.provider ? { baseProvider: body.provider } : {}),
      catalog: (await fetchModels(cfg).catch(() => [])).map((m) => m.id),
      providers: provs.map((p) => ({ id: p.id, drivers: driversFor(p.kind), models: p.models ?? [] })),
    });
  const harnessNames = Object.fromEntries(loadHarnesses(owner).map((h) => [h.id, h.name]));
  const provNames = Object.fromEntries(provs.map((p) => [p.id, p.label]));
  const labels = specs.map((s) =>
    specLabel(s.agent || s.model || s.provider || s.harness ? s : { agent: baseAgent }, {
      agent: (id) => (isAgentKind(id) ? AGENT_LABELS[id] : id),
      provider: (id) => provNames[id] ?? id,
      harness: (id) => harnessNames[id] ?? id,
    })
  );
  // The group id is minted inside launch; the job context is looked up by it from startOne.
  const job = { body, principal, startedBy };
  const r = await attempts.launch({
    owner,
    task: body.task,
    specs,
    labels,
    onCreated: (id) => attemptJobs.set(id, job),
  });
  for (const [k, v] of attemptJobs) if (v === job) attemptJobs.delete(k);
  if (!r.ok) return { status: 200, json: { ok: false, question: r.question } };
  const first = r.group.attempts.find((a) => a.box)!;
  for (const a of r.group.attempts) if (a.box) void generateTitle(hcfg(a.box), a.box, `${body.task} (attempt ${a.index})`).catch(() => {});
  return {
    status: 200,
    json: {
      ok: true,
      box: first.box,
      warm: false,
      output: `Started ${r.group.attempts.filter((a) => a.box).length} of ${n} attempts.`,
      attemptGroup: { id: r.group.id, attempts: r.group.attempts.map((a) => ({ index: a.index, box: a.box, label: a.label, branch: a.branch, ...(a.error ? { error: a.error } : {}) })) },
    },
  };
};

/** One attempt group, shaped for the comparison view (web + mobile). */
const attemptGroupView = async (g: AttemptGroup) => {
  const facts = await attempts.factsOf(g, false);
  return {
    id: g.id,
    task: g.task,
    status: g.status,
    createdAt: g.createdAt,
    deadlineAt: g.deadlineAt,
    winnerBox: g.winnerBox,
    decidedBy: g.decidedBy,
    decidedAt: g.decidedAt,
    overrideUntil: g.decidedAt !== null ? g.decidedAt + OVERRIDE_WINDOW_MS : null,
    question: g.question ? redactor.redact(g.question) : null,
    choices: tieChoices(g.question).map((c) => ({ label: c.label, answer: c.answer, index: c.index, box: g.attempts.find((a) => a.index === c.index)?.box ?? null })),
    prUrls: g.prUrls,
    note: g.note,
    attempts: g.attempts.map((a) => ({
      index: a.index,
      label: a.label,
      branch: a.branch,
      box: a.box,
      error: a.error ?? null,
      tornDown: !!a.tornDown,
      winner: !!a.box && a.box === g.winnerBox,
      facts: facts.find((f) => f.index === a.index) ?? null,
    })),
  };
};

// The same lane for MCP clients (the `attempts` param on the delegate tool).
deps.delegateAttempts = async (_c, input) => {
  const n = normalizeAttempts(input.attempts, input.attemptSpecs);
  if (!n.ok) return n.error;
  const principal = currentPrincipal();
  const body: Record<string, unknown> = { ...input, source: "git" };
  delete body.attempts;
  delete body.attemptSpecs;
  const r = n.n > 1 ? await delegateAttempts(body, principal, n.n, n.specs, currentStartedBy() ?? { kind: "mcp" }) : await delegateOnce(body, principal);
  const j = r.json as { ok?: boolean; question?: string; error?: string; harness?: { name: string; applied: string[] }; attemptGroup?: { id: string; attempts: Array<{ index: number; box: string | null; label: string; branch: string; error?: string }> } };
  if (!j.ok) return j.question ?? j.error ?? `Refused (HTTP ${r.status}).`;
  const g = j.attemptGroup;
  if (!g) {
    const h = j.harness ? ` harness=${j.harness.name}${j.harness.applied.length ? ` (set: ${j.harness.applied.join(", ")})` : ""}` : "";
    return `Delegated. session=${(r.json as { box?: string }).box}${h}\n\nrun:started — follow it with status/watch.`;
  }
  return (
    `Started attempt group ${g.id}:\n` +
    g.attempts.map((a) => `  ${a.index}. ${a.label} — ${a.box ? `session=${a.box} branch=${a.branch}` : `did not start: ${a.error}`}`).join("\n") +
    `\n\nEach attempt works on its own branch and opens no PR. When all finish the controller scores them and opens the PR from the winner (a tie is asked in the dashboard/app). ` +
    `Follow any attempt with status/watch; the comparison is at ${cfg.publicUrl ?? ""}/ (Harnesses → Attempts).`
  );
};

app.get("/attempt-groups.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const owner = providerOwner(res);
  try {
    if (typeof req.query.box === "string") {
      const hit = groupOfBox(db, owner, req.query.box);
      return void res.json(hit ? { index: hit.index, group: await attemptGroupView(hit.group) } : { group: null });
    }
    if (typeof req.query.id === "string") {
      const g = getGroup(db, owner, req.query.id);
      if (!g) return void res.status(404).json({ error: "No such attempt group." });
      return void res.json(await attemptGroupView(g));
    }
    const groups = listGroups(db, owner, 20);
    res.json({
      groups: groups.map((g) => ({ id: g.id, task: g.task, status: g.status, createdAt: g.createdAt, winnerBox: g.winnerBox, prUrls: g.prUrls, attempts: g.attempts.map((a) => ({ index: a.index, box: a.box, label: a.label })) })),
    });
  } catch (e) {
    failWith(res, e);
  }
});

// The user's pick: answering a tie ({id, choice}) or "Pick this one instead" ({id, box}).
app.post("/attempt-groups.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const owner = providerOwner(res);
  const b = (req.body ?? {}) as Record<string, unknown>;
  if (typeof b.id !== "string") return void res.status(400).json({ error: "id is required" });
  try {
    const g = getGroup(db, owner, b.id);
    if (!g) return void res.status(404).json({ error: "No such attempt group." });
    let box = typeof b.box === "string" ? b.box : undefined;
    if (!box && typeof b.choice === "number") box = tieChoices(g.question)[b.choice] ? (g.attempts.find((a) => a.index === tieChoices(g.question)[b.choice as number].index)?.box ?? undefined) : undefined;
    if (!box) return void res.status(400).json({ error: "Pick an attempt (box or choice)." });
    const r = await attempts.pick(owner, g.id, box);
    if (!r.ok) return void res.status(r.status).json({ error: r.error });
    res.json(await attemptGroupView(r.group));
  } catch (e) {
    failWith(res, e);
  }
});

app.post("/delegate.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    const n = normalizeAttempts(body.attempts, body.attemptSpecs);
    if (!n.ok) return void res.status(400).json({ error: n.error });
    const r = n.n > 1 ? await delegateAttempts(body, principalOf(res), n.n, n.specs, { kind: "manual" }) : await delegateOnce(body, principalOf(res));
    res.status(r.status).json(r.json);
  } catch (e) {
    failWith(res, e);
  }
});

/**
 * The canary (src/canary.ts): one tiny real task through delegateOnce as the operator — the same
 * warm claim, prep and launch a dashboard delegation takes — judged by its log, its box torn down.
 * The fleet sweep skips the box (isCanaryTask) so it never notifies, archives or feeds memory.
 */
const CANARY_WAIT_MS = 180_000;
const canaryRun = async (): Promise<CanaryResult> => {
  const t0 = Date.now();
  const principal: Principal = { kind: "operator" };
  const r = await withPrincipal(principal, () => delegateOnce({ task: CANARY_TASK }, principal));
  const box = typeof r.json.box === "string" ? r.json.box : "";
  if (r.status !== 200 || !box) return { ok: false, ms: Date.now() - t0, detail: `delegate answered ${r.status}: ${String(r.json.error ?? r.json.output ?? "").slice(0, 200)}` };
  let missing = 0;
  try {
    while (Date.now() - t0 < CANARY_WAIT_MS) {
      await new Promise((res) => setTimeout(res, 3000));
      const snap = await watchHub.read(box).catch(() => undefined);
      if (!snap) continue;
      // "missing" is also what one failed read looks like (a probe that timed out on a host still
      // waking from a pause: seen live 2026-11-16, the box was fine and got torn down). A box that is
      // really gone answers missing on every read, so only a run of them is a verdict.
      missing = snap.boxStatus === "missing" ? missing + 1 : 0;
      if (missing >= 3) return { ok: false, ms: Date.now() - t0, detail: "the box vanished before finishing", box };
      if (snap.boxStatus === "missing") continue;
      if (snap.runState === "done") return { ...canaryVerdict({ runState: snap.runState, exitCode: snap.exitCode, log: snap.log ?? "", ms: Date.now() - t0 }), box };
      if (snap.runState === "waiting") return { ok: false, ms: Date.now() - t0, detail: "the agent asked a question instead of answering", box };
    }
    return { ...canaryVerdict({ runState: "running", log: "", ms: Date.now() - t0, timedOut: true }), box };
  } finally {
    void deps.teardown(hcfg(box), box).catch((e) => console.error(`[canary] teardown ${box}: ${(e as Error).message.slice(0, 200)}`));
  }
};
const canary = makeCanary(
  {
    run: canaryRun,
    notify: (s, recovered) => alertOperator(canaryAlertText(s, recovered, cfg.publicUrl ?? ""), recovered ? "canary-recovered" : "canary"),
    log: (m) => console.error(m),
    skip: () => (hostSleep.asleep() ? "host asleep" : undefined),
  },
  { intervalMs: cfg.canaryIntervalMs }
);

/** The host disk under the microsandbox home, read every ten minutes; one alert per half day above the line. */
let hostDiskState: { reading?: DiskReading; at: number; error?: string } = { at: 0 };
let hostDiskAlertedAt = 0;
const HOST_DISK_POLL_MS = 10 * 60_000;
const hostDiskTick = async (): Promise<void> => {
  // Every awake host is read; the primary's reading is the one /health.json has always carried.
  for (const h of hostPool.enabled()) {
    if (hostPool.dormant(h.spec.id) || h.unreachableSince) continue;
    let state: typeof hostDiskState;
    try {
      const reading = await hostDisk(h.cfg);
      state = { reading, at: Date.now(), ...(reading ? {} : { error: "df failed" }) };
      if (hostDiskAlarmed(reading, cfg.hostDiskAlertPct) && Date.now() - hostDiskAlertedAt >= 12 * 3600_000) {
        hostDiskAlertedAt = Date.now();
        await alertOperator(hostDiskAlertText(reading!, `${h.spec.id === "primary" ? "" : `${h.spec.name}: `}${h.cfg.msbHome}`, cfg.publicUrl ?? ""), "host-disk");
      }
    } catch (e) {
      state = { at: Date.now(), error: (e as Error).message.slice(0, 200) };
    }
    hostPool.noteDisk(h.spec.id, state);
    if (h.spec.id === "primary") hostDiskState = state;
  }
};

/** Sandbox dirs the runtime forgot (src/host-disk.ts): swept two minutes after boot, then daily. */
let lastOrphanSweep: { at: number; removed: string[]; freedMib?: number; error?: string } | undefined;
const orphanSweepTick = async (): Promise<void> => {
  if (hostSleep.asleep()) return;
  try {
    const all = await Promise.all(hostPool.enabled().filter((h) => !hostPool.dormant(h.spec.id) && !h.unreachableSince).map((h) => sweepOrphanSandboxDirs(h.cfg)));
    const r = { removed: all.flatMap((x) => x.removed), ...(all.some((x) => x.freedMib) ? { freedMib: all.reduce((n, x) => n + (x.freedMib ?? 0), 0) } : {}) };
    lastOrphanSweep = { at: Date.now(), ...r };
    if (r.removed.length) console.error(`[host-disk] removed ${r.removed.length} orphaned sandbox dir(s)${r.freedMib ? `, ${r.freedMib} MiB` : ""}: ${r.removed.join(" ")}`);
  } catch (e) {
    lastOrphanSweep = { at: Date.now(), removed: [], error: (e as Error).message.slice(0, 200) };
    console.error(`[host-disk] orphan sweep: ${(e as Error).message.slice(0, 200)}`);
  }
};

/** Baked package versions against the registry, daily (src/package-watch.ts); one alert a week while a rebake is due. */
let rebakeDue: Outdated[] = [];
let rebakeCheckedAt = 0;
let rebakeAlertedAt = 0;
const rebakeTick = async (): Promise<void> => {
  const { baked } = mcpProvisionState();
  const names = Object.keys(baked).filter((n) => !BASE_PACKAGES.has(n));
  // Nothing reported yet: no box has started since boot, so there is no image to compare.
  if (!names.length) return;
  try {
    const latest = await fetchLatestVersions([...new Set([...names, ...BAKED_MCP_PACKAGES.map(packageNameOf)])]);
    rebakeDue = imageChanges(baked, latest);
    rebakeCheckedAt = Date.now();
    if (rebakeDue.length && Date.now() - rebakeAlertedAt >= 7 * 24 * 3600_000) {
      rebakeAlertedAt = Date.now();
      await alertOperator(rebakeDueText(rebakeDue, cfg.publicUrl ?? ""), "rebake-due");
    }
  } catch (e) {
    console.error(`[package-watch] ${(e as Error).message.slice(0, 200)}`);
  }
};

/**
 * The image update behind the notice's button (src/image-update.ts): bake the versions the notice
 * names, boot new sandboxes from the result, run the canary, and go back if it fails. `cfg` is the
 * one object every boot path reads, so switching is an assignment plus the override file that makes
 * it survive a restart.
 */
const imageBefore = { claudeImage: cfg.claudeImage, claudeCodeVersion: cfg.claudeCodeVersion };
const imageUpdater = makeImageUpdater({
  now: () => Date.now(),
  bake: async (tag, claudeCodeVersion, pins) => {
    await bakeAgentImage({ ...cfg, claudeCodeVersion }, tag, pins, "claude");
  },
  use: (next) => {
    if (next) {
      imageBefore.claudeImage = cfg.claudeImage;
      imageBefore.claudeCodeVersion = cfg.claudeCodeVersion;
      cfg.claudeImage = next.claudeImage;
      cfg.claudeCodeVersion = next.claudeCodeVersion;
      writeImageOverride(cfg.dataDir, { ...next, base: configuredImage(), at: Date.now() });
      // What the boxes report from now on is the new manifest; until one does, do not keep saying "behind".
      rebakeDue = [];
    } else {
      cfg.claudeImage = imageBefore.claudeImage;
      cfg.claudeCodeVersion = imageBefore.claudeCodeVersion;
      const base = configuredImage();
      if (base.claudeImage === cfg.claudeImage && base.claudeCodeVersion === cfg.claudeCodeVersion) clearImageOverride(cfg.dataDir);
      else writeImageOverride(cfg.dataDir, { claudeImage: cfg.claudeImage, claudeCodeVersion: cfg.claudeCodeVersion, base, at: Date.now() });
      void rebakeTick();
    }
  },
  verify: async () => {
    const r = await canary.runNow();
    return { ok: !!r?.ok, detail: r?.detail ?? "the test task did not run" };
  },
  log: (m) => console.error(m),
});

/**
 * The service's own health, for the dashboard's Sandboxes page: canary, host disk, start failures,
 * baked packages. The host's disk, other people's failed runs and the image's package versions are
 * the operator's business and nothing a tenant can act on: a signed-in user who is not an admin
 * gets the one fact that concerns them (does a new task currently finish) and nothing else.
 */
app.get("/health.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  if (!isAdmin(principalOf(res))) {
    const c = canary.state();
    res.json({
      admin: false,
      canary: { enabled: cfg.canaryIntervalMs > 0, intervalMs: cfg.canaryIntervalMs, last: c ? { ok: c.ok, ms: c.ms, detail: c.ok ? c.detail : "", at: c.at, failures: c.failures, lastOkAt: c.lastOkAt } : null },
      hostDisk: { at: 0, alertPct: cfg.hostDiskAlertPct, home: "" },
      hostSleep: null,
      hosts: [],
      orphanSweep: null,
      startFailures: { streak: 0, alertedAt: 0 },
      baked: {},
      lastProvision: null,
      rebakeDue: [],
      rebakeCheckedAt: 0,
      claudeSource: null,
      imageUpdate: { phase: "idle" },
    });
    return;
  }
  const { baked, last } = mcpProvisionState();
  res.json({
    admin: true,
    imageUpdate: imageUpdater.state(),
    canary: { enabled: cfg.canaryIntervalMs > 0, intervalMs: cfg.canaryIntervalMs, last: canary.state() },
    hostDisk: { ...hostDiskState, alertPct: cfg.hostDiskAlertPct, home: cfg.msbHome },
    hostSleep: hostSleep.state(),
    hosts: hostPool.state(),
    orphanSweep: lastOrphanSweep ?? null,
    startFailures: startFailures.state(),
    baked,
    lastProvision: last ?? null,
    rebakeDue,
    rebakeCheckedAt,
    claudeSource: cfg.claudeImage ? { kind: "image", name: cfg.claudeImage } : cfg.snapshot ? { kind: "snapshot", name: cfg.snapshot } : { kind: "cold", name: cfg.image },
  });
});
/** Start the image update the notice offers. Admins only; answers at once, progress is on /health.json. */
app.post("/health/image-update.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  if (!isAdmin(principalOf(res))) {
    res.status(403).json({ error: "admins only" });
    return;
  }
  if (!cfg.claudeImage) {
    res.status(409).json({ error: "claude boxes do not boot from an image here (MSB_CLAUDE_IMAGE is unset) — bake one first, see the runbook" });
    return;
  }
  try {
    res.json(imageUpdater.start(planImageUpdate(mcpProvisionState().baked, rebakeDue, cfg.claudeCodeVersion)));
  } catch (e) {
    res.status(409).json({ error: (e as Error).message });
  }
});
// --- Box hosts (src/host-pool.ts) ---------------------------------------------------------------
// The registry of machines runs go to. Admins only: a host is the operator's infrastructure.
app.get("/hosts.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  if (!isAdmin(principalOf(res))) {
    res.status(403).json({ error: "admins only" });
    return;
  }
  res.json({ hosts: hostsWithPrepare(), capacity: hostPool.capacity(), providers: listProviders() });
});
/** The host rows with what the background preparation of each (src/host-prepare.ts) has done so far. */
const hostsWithPrepare = () => hostPool.state().map((h) => ({ ...h, ...(prepareStatus(h.id) ? { prepare: prepareStatus(h.id) } : {}) }));
/**
 * A host whose kind the controller can set up itself (the msb shim on a Docker host, the box images
 * from the primary) is prepared in the background once it answers; the row shows the progress.
 */
/**
 * What a preparation needs from the controller: the host held awake while it runs (the sleep gate
 * paused a machine under a running image stream once), and a fresh check when it ends well, so
 * the row stops saying "unreachable" without anyone pressing Check.
 */
const prepareDeps = (id: string): Parameters<typeof startPrepare>[3] => ({
  log: (m) => console.error(m),
  hold: (ms, reason) => hostPool.get(id)?.sleep.hold(ms, reason),
  ready: () => hostPool.ready(id, "preparing"),
  done: (r) => {
    if (r.ok) void hostPool.check(id).catch(() => undefined);
  },
});

// A fresh machine fails its first check (no msb on it yet: the shim is what prepare installs),
// so that failure starts the preparation rather than stopping it.
const prepareIfNeeded = (id: string, check: { ok: boolean; detail: string } | undefined): void => {
  const h = hostPool.get(id);
  if (!h || !prepareCuresCheck(check)) return;
  if (!providerFor(h.spec).prepare) return;
  startPrepare(cfg, hostPool.cfgFor(id), h.spec, prepareDeps(id));
};
app.post("/hosts.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  if (!isAdmin(principalOf(res))) {
    res.status(403).json({ error: "admins only" });
    return;
  }
  const body = (req.body ?? {}) as { action?: string; id?: string; spec?: Record<string, unknown> };
  const id = typeof body.id === "string" ? body.id : "";
  try {
    switch (body.action) {
      case "upsert": {
        const before = hostPool.get(id)?.spec;
        const raw = { ...(body.spec ?? {}), ...(id ? { id } : {}) } as Record<string, unknown> & { ssh?: unknown; cloud?: Record<string, unknown>; freestyle?: Record<string, unknown>; provider?: unknown };
        // No SSH target given for a machine whose provider can mint one (Instabox: an SSH token from
        // the API key and the machine id): minted here, before the row is validated and saved.
        const minter = providerFor({ provider: String(raw.provider ?? before?.provider ?? "static") });
        if (!String(raw.ssh ?? "").trim() && !before?.ssh && minter.mintSsh) {
          const given = (raw.cloud ?? raw.freestyle ?? {}) as Record<string, unknown>;
          const vmId = String(given.vmId ?? "").trim();
          const apiKey = String(given.apiKey ?? "").trim() || before?.cloud?.apiKey || "";
          const m = await minter.mintSsh({ ...Object.fromEntries(Object.entries(given).map(([k, v]) => [k, String(v ?? "")])), vmId, apiKey });
          if (!m.ok) {
            res.status(400).json({ error: `could not mint an SSH credential: ${m.error}` });
            return;
          }
          raw.ssh = m.ssh;
          raw.cloud = { ...given, ...m.cloud };
          delete raw.freestyle;
        }
        const spec = hostPool.upsert(raw as Parameters<typeof hostPool.upsert>[0]);
        res.locals.auditAction = `host.upsert:${spec.id}`;
        // A new target, or one switched back on, is checked now (capped by HOST_ANSWER_TIMEOUT_MS): the
        // dialog shows the answer and a dead host is unreachable, so not picked, until a sweep gets through.
        const connectionChanged =
          !before ||
          before.ssh !== spec.ssh ||
          before.msb !== spec.msb ||
          before.msbHome !== spec.msbHome ||
          JSON.stringify(before.sshExtraOpts ?? []) !== JSON.stringify(spec.sshExtraOpts ?? []) ||
          before.cloud?.vmId !== spec.cloud?.vmId ||
          (!before.enabled && spec.enabled);
        const check = spec.enabled && spec.id !== PRIMARY_HOST_ID && connectionChanged ? await hostPool.check(spec.id) : undefined;
        // A new host's own addresses, before any box starts on it (src/host-guard.ts).
        if (spec.enabled) void learnHostGuard(hostPool.cfgFor(spec.id));
        if (connectionChanged && spec.enabled && spec.id !== PRIMARY_HOST_ID) prepareIfNeeded(spec.id, check);
        res.json({ ok: true, host: hostsWithPrepare().find((h) => h.id === spec.id), hosts: hostsWithPrepare(), capacity: hostPool.capacity(), check });
        return;
      }
      case "prepare": {
        const h = hostPool.get(id);
        if (!h) {
          res.status(404).json({ error: "no such host" });
          return;
        }
        if (!providerFor(h.spec).prepare) {
          res.status(400).json({ error: `a ${providerFor(h.spec).label} host is prepared by hand (see the runbook)` });
          return;
        }
        const report = startPrepare(cfg, hostPool.cfgFor(id), h.spec, prepareDeps(id));
        res.locals.auditAction = `host.prepare:${id}`;
        res.json({ ok: true, prepare: report, host: hostsWithPrepare().find((x) => x.id === id) });
        return;
      }
      case "remove": {
        if (id === PRIMARY_HOST_ID) {
          res.status(400).json({ error: "the primary host comes from .env and cannot be removed; disable it to stop routing runs there" });
          return;
        }
        const rt = hostPool.get(id);
        const live = rt ? rt.lastBoxes.filter((b) => /^running$/i.test(b.boxStatus) && b.role !== "pool-free").length + rt.reserved : 0;
        if (live) {
          res.status(409).json({ error: `${live} machine(s) still run on this host; tear them down first, or disable the host and let them finish` });
          return;
        }
        hostPool.remove(id);
        res.locals.auditAction = `host.remove:${id}`;
        res.json({ ok: true, hosts: hostPool.state(), capacity: hostPool.capacity() });
        return;
      }
      case "check": {
        // check() asks a metered host's provider on the way in, so the row's state is fresh already.
        const r = await hostPool.check(id);
        res.json({ ok: r.ok, check: r, host: hostPool.state().find((h) => h.id === id) });
        return;
      }
      case "wake": {
        const r = await hostPool.start(id);
        res.locals.auditAction = `host.wake:${id}`;
        res.json({ ok: true, providerState: r, host: hostPool.state().find((h) => h.id === id) });
        return;
      }
      case "pause": {
        const h = hostPool.get(id);
        if (h?.lastBoxes.some((b) => /^running$/i.test(b.boxStatus) && b.runState === "running")) {
          res.status(409).json({ error: "an agent is working on this host; wait for it or stop the run first" });
          return;
        }
        if (h?.reserved) {
          res.status(409).json({ error: "a run is being started on this host; pause it once the run is up" });
          return;
        }
        if (finishingOn(id)) {
          res.status(409).json({ error: "a run on this host just finished and is being wrapped up (changes read, checks run); try again shortly" });
          return;
        }
        const r = await hostPool.pause(id);
        res.locals.auditAction = `host.pause:${id}`;
        res.json({ ok: true, providerState: r, host: hostPool.state().find((h) => h.id === id) });
        return;
      }
      default:
        res.status(400).json({ error: "action must be upsert, remove, check, wake, pause or prepare" });
    }
  } catch (e) {
    res.status(400).json({ error: clientError(e) });
  }
});

// Build a box host from an API key alone (src/host-providers.ts provision): the provider makes the
// machine, an identity with root on it and a token, the SSH target is proved through the proxy,
// and only then is the row saved and checked like any other. What the machine runs is the
// provider's base image unless a snapshot is named (`snapshotId` here, or ASB_FREESTYLE_SNAPSHOT):
// from the stock image it still needs msb and the box images from the runbook before a run lands.
// One provision at a time: two in flight would race for the same slug and the same key.
let provisioning: string | undefined;
app.post("/hosts/provision.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  if (!isAdmin(principalOf(res))) {
    res.status(403).json({ error: "admins only" });
    return;
  }
  const body = (req.body ?? {}) as { provider?: string; name?: string; apiKey?: string; snapshotId?: string; priority?: unknown; maxBoxes?: unknown; sleepAfterMs?: unknown; warm?: unknown; enabled?: unknown; allowance?: unknown };
  const provider = String(body.provider ?? "freestyle");
  const adapter = providerFor({ provider });
  if (adapter.id !== provider || !adapter.provision) {
    res.status(400).json({ error: `provider "${provider}" cannot be provisioned from a key (${listProviders().filter((p) => p.canProvision).map((p) => p.id).join(", ") || "none can"})` });
    return;
  }
  const name = String(body.name ?? "").trim().slice(0, 60);
  const id = hostSlug(name);
  const apiKey = String(body.apiKey ?? "").trim();
  if (!name || !id) {
    res.status(400).json({ error: "a name is required" });
    return;
  }
  if (!apiKey) {
    res.status(400).json({ error: "the account's API key is required" });
    return;
  }
  if (hostPool.get(id)) {
    res.status(409).json({ error: `a host "${id}" exists already; pick another name` });
    return;
  }
  if (provisioning) {
    res.status(409).json({ error: `"${provisioning}" is being provisioned; wait for it` });
    return;
  }
  provisioning = id;
  const log = (m: string) => console.error(`[hosts] provision ${id}: ${m}`);
  try {
    // The VM's sshd behind the proxy has to take the token before the row is worth saving: a plain
    // ssh (no master: the pool opens its own once the row exists) with the provider's own options
    // (`-p 2222` for the Instabox gateway), tried for up to two minutes.
    const sshReady = async (target: string): Promise<void> => {
      const until = Date.now() + 120_000;
      let last = "";
      for (;;) {
        try {
          await runCmd("ssh", ["-o", "BatchMode=yes", "-o", "ControlMaster=no", "-o", "ControlPath=none", "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=20", ...(adapter.sshOpts ?? []), ...(cfg.sshExtraOpts ?? []), target, "true"], { timeoutMs: 40_000 });
          return;
        } catch (e) {
          last = String((e as Error).message ?? e).split("\n")[0];
          if (Date.now() >= until) throw new Error(last);
          await new Promise((r) => setTimeout(r, 5_000));
        }
      }
    };
    const made = await adapter.provision({ apiKey, slug: id, snapshotId: String(body.snapshotId ?? "").trim() || process.env.ASB_FREESTYLE_SNAPSHOT || undefined, idleTimeoutSeconds: 300 }, { log, sshReady });
    if (!made.ok) {
      res.status(502).json({ error: made.error, log: made.log });
      return;
    }
    const num = (v: unknown): number | undefined => (v === undefined || v === null || v === "" ? undefined : Number(v));
    const spec = hostPool.upsert({
      id,
      name,
      provider,
      ssh: made.ssh,
      cloud: made.cloud,
      priority: num(body.priority) ?? 10,
      sleepAfterMs: num(body.sleepAfterMs) ?? 300_000,
      warm: body.warm === undefined ? false : !!body.warm,
      enabled: body.enabled === undefined ? true : !!body.enabled,
      ...(num(body.maxBoxes) !== undefined ? { maxBoxes: num(body.maxBoxes) } : {}),
      allowance: body.allowance === null ? undefined : ((body.allowance as { vcpuHours: number; vcpu: number; resetDay: number } | undefined) ?? (provider === "freestyle" ? { vcpuHours: 200, vcpu: 4, resetDay: 1 } : undefined)),
      // A fresh VM has no snapshot of the primary's: boot from the image, or cold.
      snapshot: "",
    } as Parameters<typeof hostPool.upsert>[0]);
    res.locals.auditAction = `host.provision:${spec.id}`;
    const check = await hostPool.check(spec.id);
    if (spec.enabled) void learnHostGuard(hostPool.cfgFor(spec.id));
    if (spec.enabled) prepareIfNeeded(spec.id, check);
    res.json({ ok: true, host: hostsWithPrepare().find((h) => h.id === spec.id), hosts: hostsWithPrepare(), capacity: hostPool.capacity(), check, log: made.log, snapshotId: made.snapshotId });
  } catch (e) {
    res.status(400).json({ error: clientError(e) });
  } finally {
    provisioning = undefined;
  }
});

// Capture a prepared host (msb and the images on it) as a snapshot in its account, so the next
// provision there boots from it instead of the stock image. Snapshots are per account: one taken
// on account A seeds account A's next VM, not B's.
app.post("/hosts/snapshot.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  if (!isAdmin(principalOf(res))) {
    res.status(403).json({ error: "admins only" });
    return;
  }
  const body = (req.body ?? {}) as { id?: string; slug?: string };
  const h = typeof body.id === "string" ? hostPool.get(body.id) : undefined;
  if (!h) {
    res.status(404).json({ error: "no such host" });
    return;
  }
  const adapter = providerFor(h.spec);
  if (!adapter.snapshot) {
    res.status(400).json({ error: `a ${adapter.label} host cannot be snapshotted through its provider` });
    return;
  }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "").replace(/(\d{8})(\d{4})/, "$1-$2");
  const slug = String(body.slug ?? "").trim() || `asb-host-${stamp}`;
  const r = await adapter.snapshot(h.spec, { slug, displayName: `agent-sandbox host ${h.spec.id} ${stamp}` });
  if (!r.ok) {
    res.status(502).json({ error: r.error });
    return;
  }
  res.locals.auditAction = `host.snapshot:${h.spec.id}`;
  console.error(`[hosts] snapshot ${h.spec.id}: ${r.snapshotId}${r.slug ? ` (${r.slug})` : ""}`);
  res.json({ ok: true, snapshotId: r.snapshotId, slug: r.slug ?? slug, hint: `set ASB_FREESTYLE_SNAPSHOT=${r.snapshotId} (or pass snapshotId) so the next provision on this account boots from it` });
});

// The dashboard says a run is probably on its way (a thread's composer or the new-task field got
// focus): a host that is paused is started now, so its resume overlaps the typing instead of
// following the send. Nothing is launched, nothing is touched over SSH beyond ready's own probe,
// and a host that is awake answers at once.
app.post("/hosts/prewake.json", (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  const box = boxParam(req.body);
  let id: string | undefined;
  if (box) id = hostPool.hostOfBox(box);
  else {
    // The host a new task would land on, without holding the slot.
    const r = hostPool.pick({});
    r.release();
    id = r.id;
  }
  const h = id ? hostPool.get(id) : undefined;
  if (!h || !hostPool.dormant(h.spec.id)) {
    res.json({ ok: true, starting: false, ...(h ? { host: h.spec.id } : {}) });
    return;
  }
  if (box) attend(box, `prewake ${box}`);
  void hostPool.ready(h.spec.id, `prewake ${box ?? "new task"}`).catch((e) => console.error(`[hosts] prewake ${h.spec.id}: ${(e as Error).message}`));
  res.status(202).json({ ok: true, starting: true, host: h.spec.id });
});

app.post("/health/canary.json", async (req: Request, res: Response) => {
  if (!dashAuthed(req, res)) return;
  try {
    res.json(await canary.runNow());
  } catch (e) {
    failWith(res, e);
  }
});

app.listen(cfg.httpPort, cfg.httpHost, () => {
  // Once the pool knows which VMs are paused (asked at construction): an SSH to one would hang on
  // the proxy, and these two are not worth waking it for; `ready` runs them in effect on the next run.
  void hostPool.init().then(() => {
    for (const h of hostPool.enabled()) {
      if (hostPool.dormant(h.spec.id)) continue;
      // Before any box is started or rewound: which addresses are the host's own (src/host-guard.ts).
      void learnHostGuard(h.cfg);
      // A package build cut off by the last stop leaves its builder box behind; the store itself is fine.
      void reapStoreBuilders(h.cfg);
    }
  });
  // Awake time per metered host, counted against its monthly allowance (src/host-pool.ts).
  setInterval(() => hostPool.tickUsage(), 60_000).unref();
  console.error(`[agent-sandbox] HTTP MCP on ${cfg.httpHost}:${cfg.httpPort} (bearer-guarded)`);
  // Auto-seed the shared warm pool so the first remote delegation is fast too.
  for (const c of hostPool.warmCfgs()) void refillPool(c);
  // Pre-warm the model catalog so the first delegate's model validation answers from cache (the
  // stale-while-revalidate in fetchModels keeps it warm from then on). The repo list is per-owner
  // (SaaS) so it cannot be pre-warmed here; its SWR cache covers everything after a user's first task.
  void fetchModels(cfg).catch(() => {});
  // Keep it topped up so a warm box is ALWAYS ready, even through a long lull with no delegations
  // (an unclaimed box idle/max-duration reaped can't trigger its own claim-based reseed).
  startPoolMaintainer(cfg, () => hostPool.warmCfgs());
  // Rescue copies older than their TTL go (src/rescue.ts); once now, then every six hours.
  const sweepRescueCopies = () => void sweepRescues(cfg, undefined, undefined, isKeptBox).then((n) => n && console.error(`[rescue] swept ${n} old ${n === 1 ? "copy" : "copies"}`)).catch(() => {});
  sweepRescueCopies();
  setInterval(sweepRescueCopies, 6 * 3600_000).unref();
  // Triggers: fire due schedules (the webhook and finish-edge sources call the dispatcher directly).
  dispatcher.start();
  repoWatcher.start();
  mentionWatcher.start();
  // The service watching itself: the canary, the host disk, the orphan sweep, the rebake check.
  canary.start();
  setTimeout(() => void hostDiskTick(), 20_000).unref();
  setInterval(() => void hostDiskTick(), HOST_DISK_POLL_MS).unref();
  setTimeout(() => void orphanSweepTick(), 2 * 60_000).unref();
  setInterval(() => void orphanSweepTick(), 24 * 3600_000).unref();
  // Sleeping boxes past their TTL and finished automation boxes, on every host (src/sleep-reaper.ts).
  setTimeout(() => void sleepReapTick(), 90_000).unref();
  setInterval(() => void sleepReapTick(), SLEEP_REAP_EVERY_MS).unref();
  // The baked manifest arrives with the first task start; check an hour in, then daily.
  setTimeout(() => void rebakeTick(), 3600_000).unref();
  setInterval(() => void rebakeTick(), 24 * 3600_000).unref();
  // Cold-start nudge: without a baked image or snapshot every run pays the toolchain install in the box.
  if (!cfg.snapshot && !cfg.claudeImage) {
    console.error(
      `[agent-sandbox] neither MSB_CLAUDE_IMAGE nor MSB_SNAPSHOT is set — every cold run installs claude+gh in the box (~10s). ` +
        `Run 'npm run bake:claude-image' once and set MSB_CLAUDE_IMAGE to the tag.`
    );
  }
});
