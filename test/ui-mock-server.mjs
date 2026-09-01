/**
 * A throwaway mock controller for driving the real built console in a browser.
 *
 * It serves web/dist plus just enough of the JSON surface for one box thread: fleet, watch snapshot,
 * the watch SSE stream, the inbox, and the two write routes this exercise is about — /resume.json
 * (which queues while the run is "running") and /send-now.json (which "interrupts" the turn and
 * delivers the message immediately). The in-box side is faked; the queue semantics are the real
 * ones, copied in shape from src/inbox.ts, so the UI is exercised exactly as it would be live.
 *
 * Not part of the product or the test suite — a harness for manual/automated UI verification.
 *   node test/ui-mock-server.mjs [port]
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

const PORT = Number(process.argv[2] ?? 8799);
const DIST = resolve(new URL("../web/dist", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const BOX = "pool-1788256499900-jnq6ys";

// ---- fake box state -----------------------------------------------------------------------------
const state = {
  runState: "running",
  exitCode: undefined,
  log: "",
  queue: [],
  seq: 0,
  interrupted: null, // set when /send-now.json fires, so the test can assert the order of operations
};

const line = (s) => `${s}\n`;
state.log =
  line("⟦you⟧") +
  line("Review PR #2319 and merge it once checks pass.") +
  line("⟦/you⟧") +
  line("I'll wait for the mocha-unit-tests check to finish before merging.") +
  line("$ gh pr checks 2319 --watch") +
  line("mocha-unit-tests  pending  ...") +
  line("mocha-unit-tests  pending  ...");

const enqueue = (text) => {
  const m = { id: `q${++state.seq}`, text, at: Date.now() };
  state.queue.push(m);
  return m;
};

// ---- helpers ------------------------------------------------------------------------------------
const json = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};
const readBody = (req) =>
  new Promise((r) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      try {
        r(JSON.parse(b || "{}"));
      } catch {
        r({});
      }
    });
  });

const meta = () => ({
  session: BOX,
  boxStatus: "Running",
  runState: state.runState,
  ...(state.exitCode != null ? { exitCode: state.exitCode } : {}),
  task: "Review PR #2319 and merge it once checks pass.",
  role: "pool-claimed",
});

const boxView = () => ({
  name: BOX,
  role: "pool-claimed",
  boxStatus: "Running",
  runState: state.runState,
  ...(state.exitCode != null ? { exitCode: state.exitCode } : {}),
  task: "Review PR #2319 and merge it once checks pass.",
  title: "Review PR #2319",
  uptime: "18m",
  repos: [{ name: "space", branch: "main" }],
  ...(state.queue.length ? { queued: state.queue.map((m) => m.text) } : {}),
});

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2", ".png": "image/png", ".ico": "image/x-icon" };

const server = createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const p = u.pathname;

  // --- auth/session surface (any bearer is accepted; this is a local harness) ---
  if (p === "/auth/config.json") return json(res, 200, { mode: "token", providers: [], tokenLogin: true, password: false, signup: false, passwordMin: 8, trialDays: 0, billingUrl: null, beta: false });
  if (p === "/me.json") return json(res, 200, { ok: true, mode: "token", login: "operator", role: "admin", kind: "operator" });

  // --- fleet ---
  if (p === "/fleet.json")
    return json(res, 200, { boxes: [boxView()], lifecycle: { capacity: 4, poolSize: 0, idleTimeoutSec: 900, maxDurationSec: 7200 }, at: Date.now() });
  if (p === "/monitor.json") return json(res, 200, { boxes: [boxView()] });
  if (p === "/watch.json") return json(res, 200, { ...meta(), log: state.log });
  if (p === "/changes.json") return json(res, 200, { files: [] });
  if (p === "/skills.json") return json(res, 200, { skills: [] });
  if (p === "/mcp-servers.json") return json(res, 200, { servers: [] });
  if (p === "/accounts.json") return json(res, 200, { accounts: [] });
  if (p === "/repos.json") return json(res, 200, { repos: [] });
  if (p === "/pulls.json") return json(res, 200, { pulls: [] });

  // --- the live stream the thread reads ---
  if (p === "/watch.sse") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    const send = (event, data, id) => res.write(`event: ${event}\n${id ? `id: ${id}\n` : ""}data: ${JSON.stringify(data)}\n\n`);
    send("snapshot", { meta: meta(), log: state.log, from: 0 }, String(state.log.length));
    let sent = state.log.length;
    const t = setInterval(() => {
      if (state.log.length > sent) {
        send("append", { chunk: state.log.slice(sent) }, String(state.log.length));
        sent = state.log.length;
      }
      send("state", { meta: meta() });
    }, 700);
    req.on("close", () => clearInterval(t));
    return;
  }

  // --- the inbox ---
  if (p === "/inbox.json" && req.method === "GET") return json(res, 200, { queued: state.queue });
  if (p === "/inbox.json" && req.method === "DELETE") {
    const id = u.searchParams.get("id");
    state.queue = id ? state.queue.filter((m) => m.id !== id) : [];
    return json(res, 200, { queued: state.queue });
  }

  // --- the two routes under test ---
  if (p === "/resume.json" && req.method === "POST") {
    const { message, force } = await readBody(req);
    if (!force && state.runState === "running") {
      const m = enqueue(message);
      return json(res, 200, { queued: true, id: m.id });
    }
    state.runState = "running";
    state.exitCode = undefined;
    state.log += line("⟦you⟧") + line(message) + line("⟦/you⟧") + line("Understood — skipping the pending check and proceeding.");
    return json(res, 200, { ok: true });
  }

  if (p === "/send-now.json" && req.method === "POST") {
    const { id } = await readBody(req);
    const msg = state.queue.find((m) => m.id === id);
    if (!msg) return json(res, 404, { error: "that queued message is gone (already delivered or cancelled)" });
    state.queue = state.queue.filter((m) => m.id !== id);
    // Mirror the real controller: interrupt the turn, then resume with the message.
    state.interrupted = { id, text: msg.text, at: Date.now() };
    state.log += line("run interrupted by the operator to deliver a message immediately.");
    state.log += line("⟦you⟧") + line(msg.text) + line("⟦/you⟧") + line("Right — the runner never picks that check up. Skipping the wait and commenting now.");
    state.runState = "running";
    state.exitCode = undefined;
    return json(res, 200, { ok: true, queued: state.queue });
  }

  // --- test-only introspection, so the driver can assert server-side effects ---
  if (p === "/__state") return json(res, 200, state);
  if (p === "/__set-run-state") {
    state.runState = u.searchParams.get("v") ?? "running";
    return json(res, 200, state);
  }

  // --- static: the real built console (built with base "/dashboard/", so strip that prefix) ---
  const rel = p.replace(/^\/dashboard\/?/, "/").replace(/^\/+/, "");
  let file = join(DIST, rel === "" ? "index.html" : rel);
  try {
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
  } catch {
    file = join(DIST, "index.html"); // SPA fallback
  }
  try {
    const buf = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(buf);
  } catch {
    res.writeHead(404).end("not found");
  }
});

server.listen(PORT, () => console.log(`mock controller on http://localhost:${PORT} (box ${BOX})`));
