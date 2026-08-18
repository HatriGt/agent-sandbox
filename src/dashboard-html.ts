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
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
         background: #0b0e14; color: #d7dce5; }
  header { padding: 14px 20px; border-bottom: 1px solid #1c2130; display: flex;
           align-items: baseline; gap: 16px; position: sticky; top: 0; background: #0b0e14; }
  header h1 { font-size: 15px; margin: 0; font-weight: 600; }
  #summary { color: #8b93a7; }
  #err { color: #ff7b72; margin-left: auto; }
  main { padding: 16px 20px; display: grid; gap: 12px;
         grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); }
  .card { border: 1px solid #1c2130; border-radius: 8px; background: #11151f; overflow: hidden; }
  .card h2 { font-size: 13px; margin: 0; padding: 10px 12px; background: #141a26;
             border-bottom: 1px solid #1c2130; display: flex; align-items: center; gap: 8px;
             cursor: pointer; }
  .card h2 .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .card .body { padding: 10px 12px; }
  .row { display: flex; gap: 8px; color: #8b93a7; flex-wrap: wrap; }
  .task { margin-top: 8px; color: #d7dce5; word-break: break-word; }
  .q { margin-top: 8px; color: #e3b341; word-break: break-word; }
  pre.log { margin: 10px 0 0; padding: 10px; background: #0b0e14; border: 1px solid #1c2130;
            border-radius: 6px; max-height: 320px; overflow: auto; white-space: pre-wrap;
            word-break: break-word; display: none; }
  .badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; border: 1px solid transparent; }
  .b-running { background: #12261a; color: #57d364; border-color: #1f4a2e; }
  .b-waiting { background: #2b2410; color: #e3b341; border-color: #5a4a13; }
  .b-done    { background: #16202e; color: #6ea8fe; border-color: #234; }
  .b-idle    { background: #1a1f2b; color: #8b93a7; border-color: #2a3040; }
  .empty { color: #8b93a7; padding: 24px 20px; }
</style>
</head>
<body>
<header>
  <h1>agent-sandbox monitor</h1>
  <span id="summary">loading…</span>
  <span id="err"></span>
</header>
<main id="fleet"></main>
<p class="empty" id="empty" style="display:none">No sandboxes are up.</p>
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

  function render(views) {
    var fleet = document.getElementById("fleet");
    var empty = document.getElementById("empty");
    var running = views.filter(function (v) { return /^running$/i.test(v.boxStatus || ""); });
    empty.style.display = running.length ? "none" : "block";

    var sessions = running.filter(function (v) { return v.role !== "pool-free"; }).length;
    var free = running.filter(function (v) { return v.role === "pool-free"; }).length;
    var wait = running.filter(function (v) { return v.runState === "waiting"; }).length;
    document.getElementById("summary").textContent =
      running.length + " up · " + sessions + " session(s) · " + free + " pool free · " + wait + " waiting";

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
          '<h2><span class="name"></span><span class="badge"></span></h2>' +
          '<div class="body"><div class="meta"></div>' +
          '<div class="task"></div><div class="q"></div>' +
          '<pre class="log">(open to load log)</pre></div>';
        fleet.appendChild(card);
        card.querySelector("h2").addEventListener("click", function () {
          expanded[v.name] = !expanded[v.name];
          var log = card.querySelector(".log");
          log.style.display = expanded[v.name] ? "block" : "none";
          if (expanded[v.name]) loadLog(v.name);
        });
      }
      card.querySelector(".name").textContent = v.name + "  [" + v.role + "]";
      var badge = card.querySelector(".badge");
      badge.textContent = v.runState + (v.runState === "done" && v.exitCode != null ? " " + v.exitCode : "");
      badge.className = "badge " + badgeClass(v.runState);
      card.querySelector(".meta").innerHTML =
        '<div class="row">' +
        (v.uptime ? "<span>up " + esc(v.uptime) + "</span>" : "") +
        (v.cpu ? "<span>cpu " + esc(v.cpu) + "</span>" : "") +
        (v.mem ? "<span>mem " + esc(v.mem) + "</span>" : "") +
        "</div>";
      card.querySelector(".task").textContent = v.task ? "task: " + v.task : "";
      card.querySelector(".q").textContent = v.question ? "❓ " + v.question : "";
      var log = card.querySelector(".log");
      log.style.display = expanded[v.name] ? "block" : "none";
      if (expanded[v.name]) loadLog(v.name);
    });
    // Drop cards for boxes no longer running.
    Array.prototype.slice.call(fleet.children).forEach(function (c) {
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
