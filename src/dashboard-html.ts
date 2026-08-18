/**
 * The monitoring dashboard page (pure — returns a self-contained HTML string).
 *
 * It's a thin client: on load it reads the `token` from its own URL and polls `/monitor.json` every
 * few seconds to render box cards; clicking a card polls `/watch.json?session=…` for that box's live
 * log. All auth rides on the token already in the URL (query param), so the page needs no secrets
 * baked in. Kept as one string (no framework/build step) so the container serves it with zero deps.
 */

/** Poll interval (ms) the page uses for the fleet list. */
export const DASHBOARD_POLL_MS = 3000;

export function dashboardHtml(pollMs: number = DASHBOARD_POLL_MS): string {
  // NOTE: this is browser JS embedded as a string; keep it dependency-free and defensive.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>agent-sandbox monitor</title>
<style>
  /* shadcn-style design tokens (zinc, dark) — hand-authored so the page stays dependency-free. */
  :root {
    color-scheme: dark;
    --background: #09090b; --foreground: #fafafa;
    --card: #0c0c0f; --card-border: #1f1f23;
    --muted: #18181b; --muted-foreground: #a1a1aa;
    --accent: #27272a; --ring: #3f3f46;
    --radius: 12px;
    --green: #22c55e; --green-bg: rgba(34,197,94,.12); --green-bd: rgba(34,197,94,.30);
    --amber: #f59e0b; --amber-bg: rgba(245,158,11,.12); --amber-bd: rgba(245,158,11,.32);
    --blue: #3b82f6; --blue-bg: rgba(59,130,246,.12); --blue-bd: rgba(59,130,246,.30);
    --red: #ef4444;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0; background: var(--background); color: var(--foreground);
    font: 14px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

  header {
    position: sticky; top: 0; z-index: 10;
    padding: 16px 24px; display: flex; align-items: center; gap: 16px;
    background: rgba(9,9,11,.8); backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--card-border);
  }
  .brand { display: flex; align-items: center; gap: 10px; }
  .dot { width: 8px; height: 8px; border-radius: 999px; background: var(--green);
         box-shadow: 0 0 0 4px var(--green-bg); }
  header h1 { font-size: 15px; margin: 0; font-weight: 600; letter-spacing: -.01em; }
  header h1 .sub { color: var(--muted-foreground); font-weight: 400; margin-left: 6px; }
  .stats { display: flex; gap: 8px; margin-left: 8px; flex-wrap: wrap; }
  .stat { display: inline-flex; align-items: baseline; gap: 6px; padding: 4px 10px;
          background: var(--muted); border: 1px solid var(--card-border); border-radius: 999px;
          font-size: 12px; color: var(--muted-foreground); }
  .stat b { color: var(--foreground); font-weight: 600; font-variant-numeric: tabular-nums; }
  #err { margin-left: auto; color: var(--red); font-size: 12.5px; }
  #err:empty { display: none; }

  main { padding: 20px 24px 48px; display: grid; gap: 16px;
         grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); }

  .card {
    border: 1px solid var(--card-border); border-radius: var(--radius); background: var(--card);
    overflow: hidden; transition: border-color .15s ease, transform .15s ease;
    box-shadow: 0 1px 2px rgba(0,0,0,.4);
  }
  .card:hover { border-color: var(--ring); }
  .card > h2 {
    all: unset; display: flex; align-items: center; gap: 10px; cursor: pointer;
    padding: 14px 16px; border-bottom: 1px solid var(--card-border);
  }
  .card > h2 .name { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px;
                     font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .card > h2 .role { font-size: 11px; color: var(--muted-foreground); }
  .card > h2 .chev { margin-left: auto; color: var(--muted-foreground); transition: transform .15s ease;
                     font-size: 12px; }
  .card.open > h2 .chev { transform: rotate(90deg); }
  .card .body { padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }

  .metrics { display: flex; gap: 6px; flex-wrap: wrap; }
  .pill { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; font-size: 12px;
          background: var(--muted); border: 1px solid var(--card-border); border-radius: 8px;
          color: var(--muted-foreground); font-variant-numeric: tabular-nums; }
  .pill b { color: var(--foreground); font-weight: 500; }

  .field-label { font-size: 11px; text-transform: uppercase; letter-spacing: .04em;
                 color: var(--muted-foreground); margin-bottom: 2px; }
  .task { word-break: break-word; }
  .q { padding: 10px 12px; border-radius: 8px; background: var(--amber-bg);
       border: 1px solid var(--amber-bd); color: #fcd34d; word-break: break-word; font-size: 13px; }
  .q:empty { display: none; }

  pre.log { margin: 0; padding: 12px 14px; background: #050506; border: 1px solid var(--card-border);
            border-radius: 8px; max-height: 340px; overflow: auto; white-space: pre-wrap;
            word-break: break-word; display: none; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            font-size: 12px; color: #d4d4d8; line-height: 1.5; }
  .card.open pre.log { display: block; }

  .badge { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 500;
           padding: 3px 9px; border-radius: 999px; border: 1px solid transparent; white-space: nowrap; }
  .badge::before { content: ""; width: 6px; height: 6px; border-radius: 999px; background: currentColor; }
  .b-running { background: var(--green-bg); color: var(--green); border-color: var(--green-bd); }
  .b-running::before { animation: pulse 1.6s ease-in-out infinite; }
  .b-waiting { background: var(--amber-bg); color: var(--amber); border-color: var(--amber-bd); }
  .b-done    { background: var(--blue-bg);  color: var(--blue);  border-color: var(--blue-bd); }
  .b-idle    { background: var(--muted); color: var(--muted-foreground); border-color: var(--card-border); }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .3; } }

  .empty { grid-column: 1 / -1; text-align: center; color: var(--muted-foreground);
           padding: 64px 20px; border: 1px dashed var(--card-border); border-radius: var(--radius);
           background: var(--card); }
  .empty .big { font-size: 15px; color: var(--foreground); font-weight: 500; margin-bottom: 4px; }
</style>
</head>
<body>
<header>
  <div class="brand"><span class="dot"></span>
    <h1>agent-sandbox <span class="sub">monitor</span></h1></div>
  <div class="stats" id="stats"></div>
  <span id="err"></span>
</header>
<main id="fleet">
  <div class="empty" id="empty"><div class="big">Loading…</div>connecting to the fleet</div>
</main>
<script>
(function () {
  var POLL = ${JSON.stringify(pollMs)};
  var params = new URLSearchParams(location.search);
  var token = params.get("token") || "";
  var qs = token ? ("?token=" + encodeURIComponent(token)) : "";
  var expanded = {};       // session -> true when the log panel is open
  var errEl = document.getElementById("err");

  function badgeClass(s) {
    return s === "running" ? "b-running" : s === "waiting" ? "b-waiting"
         : s === "done" ? "b-done" : "b-idle";
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>]/g, function (c) {
      return c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;";
    });
  }

  function watchUrl(session) {
    return "/watch.json" + (qs ? qs + "&" : "?") + "session=" + encodeURIComponent(session);
  }

  function roleLabel(r) {
    return r === "pool-free" ? "warm pool" : r === "pool-claimed" ? "session · pool" : "session";
  }
  function stat(label, n) {
    return '<span class="stat"><b>' + n + "</b> " + esc(label) + "</span>";
  }

  function render(views) {
    var fleet = document.getElementById("fleet");
    var running = views.filter(function (v) { return /^running$/i.test(v.boxStatus || ""); });

    var sessions = running.filter(function (v) { return v.role !== "pool-free"; }).length;
    var free = running.filter(function (v) { return v.role === "pool-free"; }).length;
    var wait = running.filter(function (v) { return v.runState === "waiting"; }).length;
    var active = running.filter(function (v) { return v.runState === "running"; }).length;
    document.getElementById("stats").innerHTML =
      stat("up", running.length) + stat("sessions", sessions) + stat("pool free", free) +
      stat("running", active) + stat("waiting", wait);

    // Empty state (kept as a child so the grid centers it).
    var empty = document.getElementById("empty");
    if (!running.length) {
      if (!empty) {
        empty = document.createElement("div");
        empty.className = "empty"; empty.id = "empty";
        fleet.appendChild(empty);
      }
      empty.innerHTML = '<div class="big">No sandboxes are up</div>delegate a task to spin one up';
    } else if (empty) {
      empty.remove();
    }

    // Order: sessions, then claimed pool, then free pool; stable by name.
    var order = { "session": 0, "pool-claimed": 1, "pool-free": 2 };
    running.sort(function (a, b) {
      return (order[a.role] - order[b.role]) || a.name.localeCompare(b.name);
    });

    // Reconcile cards by session id (stable DOM so scroll/log state survives polls).
    var seen = {};
    running.forEach(function (v) {
      seen[v.name] = true;
      var card = document.getElementById("card-" + v.name);
      if (!card) {
        card = document.createElement("section");
        card.className = "card";
        card.id = "card-" + v.name;
        card.innerHTML =
          '<h2><span class="name"></span><span class="role"></span>' +
          '<span class="badge"></span><span class="chev">▸</span></h2>' +
          '<div class="body">' +
          '<div class="metrics"></div>' +
          '<div class="taskwrap" style="display:none"><div class="field-label">Task</div>' +
          '<div class="task mono"></div></div>' +
          '<div class="q"></div>' +
          '<pre class="log">(open to load log)</pre></div>';
        fleet.appendChild(card);
        card.querySelector("h2").addEventListener("click", function () {
          expanded[v.name] = !expanded[v.name];
          card.classList.toggle("open", !!expanded[v.name]);
          if (expanded[v.name]) loadLog(v.name);
        });
      }
      card.querySelector(".name").textContent = v.name;
      card.querySelector(".role").textContent = roleLabel(v.role);
      var badge = card.querySelector(".badge");
      badge.textContent = v.runState + (v.runState === "done" && v.exitCode != null ? " " + v.exitCode : "");
      badge.className = "badge " + badgeClass(v.runState);
      card.querySelector(".metrics").innerHTML =
        (v.uptime ? '<span class="pill">up <b>' + esc(v.uptime) + "</b></span>" : "") +
        (v.cpu ? '<span class="pill">cpu <b>' + esc(v.cpu) + "</b></span>" : "") +
        (v.mem ? '<span class="pill">mem <b>' + esc(v.mem) + "</b></span>" : "");
      var taskwrap = card.querySelector(".taskwrap");
      if (v.task) { taskwrap.style.display = "block"; card.querySelector(".task").textContent = v.task; }
      else { taskwrap.style.display = "none"; }
      card.querySelector(".q").textContent = v.question ? "❓ " + v.question : "";
      card.classList.toggle("open", !!expanded[v.name]);
      if (expanded[v.name]) loadLog(v.name);
    });
    // Drop cards for boxes no longer running.
    Array.prototype.slice.call(fleet.querySelectorAll(".card")).forEach(function (c) {
      var name = c.id.replace(/^card-/, "");
      if (!seen[name]) { delete expanded[name]; c.remove(); }
    });
  }

  function loadLog(session) {
    fetch(watchUrl(session), { headers: token ? { Authorization: "Bearer " + token } : {} })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (s) {
        if (!s) return;
        var card = document.getElementById("card-" + session);
        if (!card) return;
        var log = card.querySelector(".log");
        if (expanded[session]) log.textContent = s.log || "(no output yet)";
      })
      .catch(function () {});
  }

  function tick() {
    fetch("/monitor.json" + qs, { headers: token ? { Authorization: "Bearer " + token } : {} })
      .then(function (r) {
        if (r.status === 401) throw new Error("unauthorized — check the ?token= in the URL");
        return r.json();
      })
      .then(function (views) { errEl.textContent = ""; render(views || []); })
      .catch(function (e) { errEl.textContent = String(e.message || e); });
  }

  tick();
  setInterval(tick, POLL);
})();
</script>
</body>
</html>`;
}
