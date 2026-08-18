/**
 * The monitoring dashboard page (pure — returns a self-contained HTML string).
 *
 * It's a thin client: on load it reads the `token` from its own URL and polls `/monitor.json` every
 * few seconds to render box cards; clicking a card polls `/watch.json?session=…` for that box's live
 * log. All auth rides on the token already in the URL (query param), so the page needs no secrets
 * baked in. Kept as one string (no framework/build step) so the container serves it with zero deps.
 *
 * UX: a dashboard layout — top bar (brand + live status + theme toggle), a KPI stat-card row, then a
 * "Sandboxes" section of cards. Light/dark themes via CSS variables (shadcn-style tokens), toggled by
 * a button and persisted in localStorage.
 */

/** Poll interval (ms) the page uses for the fleet list. */
export const DASHBOARD_POLL_MS = 3000;

/** shadcn-style tokens for BOTH themes; `[data-theme]` on <html> flips them. No deps/build step. */
const STYLE = `<style>
  :root, [data-theme="dark"] {
    --bg: #09090b; --panel: #0c0c0f; --panel-2: #101014; --border: #1f1f23;
    --fg: #fafafa; --muted: #a1a1aa; --muted-2: #71717a;
    --hover: #18181b; --ring: #3f3f46;
    --green: #22c55e; --amber: #f59e0b; --blue: #3b82f6; --red: #ef4444; --violet: #a78bfa;
    --shadow: 0 1px 3px rgba(0,0,0,.5);
  }
  [data-theme="light"] {
    --bg: #f7f7f8; --panel: #ffffff; --panel-2: #fafafa; --border: #e4e4e7;
    --fg: #18181b; --muted: #52525b; --muted-2: #71717a;
    --hover: #f4f4f5; --ring: #d4d4d8;
    --green: #16a34a; --amber: #d97706; --blue: #2563eb; --red: #dc2626; --violet: #7c3aed;
    --shadow: 0 1px 2px rgba(0,0,0,.06), 0 1px 3px rgba(0,0,0,.1);
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0; background: var(--bg); color: var(--fg);
    font: 14px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased; transition: background .2s ease, color .2s ease;
  }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .wrap { max-width: 1280px; margin: 0 auto; padding: 0 24px; }

  /* top bar */
  .topbar { position: sticky; top: 0; z-index: 20; background: color-mix(in srgb, var(--bg) 82%, transparent);
            backdrop-filter: blur(10px); border-bottom: 1px solid var(--border); }
  .topbar .wrap { display: flex; align-items: center; gap: 14px; height: 60px; }
  .brand { display: flex; align-items: center; gap: 10px; font-weight: 600; letter-spacing: -.01em; }
  .brand .logo { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center;
                 background: linear-gradient(135deg, var(--violet), var(--blue)); color: #fff;
                 font-size: 15px; font-weight: 700; }
  .brand .sub { color: var(--muted); font-weight: 400; }
  .live { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--muted); }
  .live .dot { width: 8px; height: 8px; border-radius: 999px; background: var(--green);
               box-shadow: 0 0 0 4px color-mix(in srgb, var(--green) 20%, transparent);
               animation: pulse 1.8s ease-in-out infinite; }
  .live.stale .dot { background: var(--red); animation: none; }
  .spacer { margin-left: auto; }
  .iconbtn { display: inline-flex; align-items: center; gap: 8px; height: 34px; padding: 0 12px;
             border: 1px solid var(--border); background: var(--panel); color: var(--fg); cursor: pointer;
             border-radius: 8px; font: inherit; font-size: 13px; transition: background .15s, border-color .15s; }
  .iconbtn:hover { background: var(--hover); border-color: var(--ring); }
  #err { color: var(--red); font-size: 12.5px; }
  #err:empty { display: none; }

  /* KPI stat cards */
  .kpis { display: grid; gap: 14px; grid-template-columns: repeat(4, 1fr); padding: 22px 0 6px; }
  .kpi { background: var(--panel); border: 1px solid var(--border); border-radius: 14px; padding: 16px 18px;
         box-shadow: var(--shadow); }
  .kpi .k-label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
  .kpi .k-val { font-size: 30px; font-weight: 650; margin-top: 6px; font-variant-numeric: tabular-nums;
                line-height: 1; letter-spacing: -.02em; }
  .kpi .k-sub { font-size: 12px; color: var(--muted-2); margin-top: 6px; }
  .kpi .k-val.accent-green { color: var(--green); } .kpi .k-val.accent-amber { color: var(--amber); }

  /* section */
  .section { padding: 20px 0 48px; }
  .section h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted);
                margin: 8px 0 14px; font-weight: 600; }
  .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(370px, 1fr)); }

  /* box card */
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 14px; overflow: hidden;
          box-shadow: var(--shadow); transition: border-color .15s, transform .12s; }
  .card:hover { border-color: var(--ring); transform: translateY(-1px); }
  .card > h3 { all: unset; display: flex; align-items: center; gap: 10px; cursor: pointer;
               padding: 14px 16px; border-bottom: 1px solid var(--border); }
  .card .idwrap { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .card .name { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px;
                font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .card .role { font-size: 11px; color: var(--muted-2); }
  .card .chev { margin-left: auto; color: var(--muted-2); transition: transform .15s; font-size: 12px; }
  .card.open .chev { transform: rotate(90deg); }
  .card .body { padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; }

  .metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .metric { background: var(--panel-2); border: 1px solid var(--border); border-radius: 10px; padding: 8px 10px; }
  .metric .m-l { font-size: 10.5px; color: var(--muted-2); text-transform: uppercase; letter-spacing: .04em; }
  .metric .m-v { font-size: 14px; font-weight: 600; margin-top: 2px; font-variant-numeric: tabular-nums; }

  .field-label { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted);
                 margin-bottom: 3px; }
  .task { word-break: break-word; font-size: 13px; }
  .q { padding: 10px 12px; border-radius: 10px; word-break: break-word; font-size: 13px;
       background: color-mix(in srgb, var(--amber) 14%, transparent);
       border: 1px solid color-mix(in srgb, var(--amber) 34%, transparent);
       color: color-mix(in srgb, var(--amber) 85%, var(--fg)); }
  .q:empty { display: none; }

  pre.log { margin: 0; padding: 12px 14px; background: var(--panel-2); border: 1px solid var(--border);
            border-radius: 10px; max-height: 340px; overflow: auto; white-space: pre-wrap; word-break: break-word;
            display: none; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
            color: var(--fg); line-height: 1.5; }
  .card.open pre.log { display: block; }

  .badge { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 500;
           padding: 4px 10px; border-radius: 999px; border: 1px solid transparent; white-space: nowrap; }
  .badge::before { content: ""; width: 6px; height: 6px; border-radius: 999px; background: currentColor; }
  .b-running { color: var(--green); background: color-mix(in srgb, var(--green) 13%, transparent);
               border-color: color-mix(in srgb, var(--green) 30%, transparent); }
  .b-running::before { animation: pulse 1.6s ease-in-out infinite; }
  .b-waiting { color: var(--amber); background: color-mix(in srgb, var(--amber) 13%, transparent);
               border-color: color-mix(in srgb, var(--amber) 32%, transparent); }
  .b-done { color: var(--blue); background: color-mix(in srgb, var(--blue) 13%, transparent);
            border-color: color-mix(in srgb, var(--blue) 30%, transparent); }
  .b-idle { color: var(--muted); background: var(--hover); border-color: var(--border); }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }

  .empty { grid-column: 1 / -1; text-align: center; color: var(--muted); padding: 64px 20px;
           border: 1px dashed var(--border); border-radius: 14px; background: var(--panel); }
  .empty .big { font-size: 15px; color: var(--fg); font-weight: 600; margin-bottom: 4px; }

  @media (max-width: 760px) { .kpis { grid-template-columns: repeat(2, 1fr); } }
</style>`;

const BODY = `<div class="topbar"><div class="wrap">
  <div class="brand"><span class="logo">A</span>agent-sandbox <span class="sub">monitor</span></div>
  <span class="live" id="live"><span class="dot"></span><span id="live-text">connecting…</span></span>
  <span class="spacer"></span>
  <span id="err"></span>
  <button class="iconbtn" id="theme-btn" title="Toggle theme"><span id="theme-icon">🌙</span>
    <span id="theme-label">Dark</span></button>
</div></div>

<div class="wrap">
  <div class="kpis" id="kpis"></div>
  <div class="section">
    <h2>Sandboxes</h2>
    <div class="grid" id="fleet">
      <div class="empty" id="empty"><div class="big">Loading…</div>connecting to the fleet</div>
    </div>
  </div>
</div>`;

/** The page's browser JS as a string. Dependency-free + defensive; contract: POLL/monitor.json/watch.json/token. */
function script(pollMs: number): string {
  return `
(function () {
  var POLL = ${JSON.stringify(pollMs)};
  var params = new URLSearchParams(location.search);
  var token = params.get("token") || "";
  var qs = token ? ("?token=" + encodeURIComponent(token)) : "";
  var authHeaders = token ? { Authorization: "Bearer " + token } : {};
  var expanded = {};
  var errEl = document.getElementById("err");

  // ---- theme toggle (persisted) ----
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    document.getElementById("theme-icon").textContent = t === "dark" ? "🌙" : "☀️";
    document.getElementById("theme-label").textContent = t === "dark" ? "Dark" : "Light";
    try { localStorage.setItem("asb-theme", t); } catch (e) {}
  }
  var saved = "dark";
  try { saved = localStorage.getItem("asb-theme") || "dark"; } catch (e) {}
  applyTheme(saved);
  document.getElementById("theme-btn").addEventListener("click", function () {
    var cur = document.documentElement.getAttribute("data-theme");
    applyTheme(cur === "dark" ? "light" : "dark");
  });

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>]/g, function (c) {
      return c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;";
    });
  }
  function badgeClass(s) {
    return s === "running" ? "b-running" : s === "waiting" ? "b-waiting"
         : s === "done" ? "b-done" : "b-idle";
  }
  function roleLabel(r) {
    return r === "pool-free" ? "warm pool" : r === "pool-claimed" ? "session · pool" : "session";
  }
  function watchUrl(session) {
    return "/watch.json" + (qs ? qs + "&" : "?") + "session=" + encodeURIComponent(session);
  }
  function setLive(ok, text) {
    var el = document.getElementById("live");
    el.className = "live" + (ok ? "" : " stale");
    document.getElementById("live-text").textContent = text;
  }

  function kpi(label, val, sub, accent) {
    return '<div class="kpi"><div class="k-label">' + esc(label) + '</div>' +
      '<div class="k-val ' + (accent || "") + '">' + val + '</div>' +
      '<div class="k-sub">' + esc(sub || "") + '</div></div>';
  }

  function render(views) {
    var fleet = document.getElementById("fleet");
    var running = views.filter(function (v) { return /^running$/i.test(v.boxStatus || ""); });
    var sessions = running.filter(function (v) { return v.role !== "pool-free"; }).length;
    var free = running.filter(function (v) { return v.role === "pool-free"; }).length;
    var wait = running.filter(function (v) { return v.runState === "waiting"; }).length;
    var active = running.filter(function (v) { return v.runState === "running"; }).length;

    document.getElementById("kpis").innerHTML =
      kpi("Sandboxes up", running.length, sessions + " session · " + free + " pool") +
      kpi("Running", active, "agents working", "accent-green") +
      kpi("Waiting", wait, "need an answer", wait ? "accent-amber" : "") +
      kpi("Warm pool free", free, "ready to claim");

    var empty = document.getElementById("empty");
    if (!running.length) {
      if (!empty) { empty = document.createElement("div"); empty.className = "empty"; empty.id = "empty"; fleet.appendChild(empty); }
      empty.innerHTML = '<div class="big">No sandboxes are up</div>delegate a task to spin one up';
    } else if (empty) { empty.remove(); }

    var order = { "session": 0, "pool-claimed": 1, "pool-free": 2 };
    running.sort(function (a, b) { return (order[a.role] - order[b.role]) || a.name.localeCompare(b.name); });

    var seen = {};
    running.forEach(function (v) {
      seen[v.name] = true;
      var card = document.getElementById("card-" + v.name);
      if (!card) {
        card = document.createElement("section");
        card.className = "card"; card.id = "card-" + v.name;
        card.innerHTML =
          '<h3><span class="idwrap"><span class="name"></span><span class="role"></span></span>' +
          '<span class="badge"></span><span class="chev">▸</span></h3>' +
          '<div class="body"><div class="metrics"></div>' +
          '<div class="taskwrap" style="display:none"><div class="field-label">Task</div>' +
          '<div class="task mono"></div></div><div class="q"></div>' +
          '<pre class="log">(open to load log)</pre></div>';
        fleet.appendChild(card);
        card.querySelector("h3").addEventListener("click", function () {
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
        '<div class="metric"><div class="m-l">uptime</div><div class="m-v">' + esc(v.uptime || "—") + '</div></div>' +
        '<div class="metric"><div class="m-l">cpu</div><div class="m-v">' + esc(v.cpu || "—") + '</div></div>' +
        '<div class="metric"><div class="m-l">mem</div><div class="m-v">' + esc((v.mem || "—").split(" / ")[0]) + '</div></div>';
      var tw = card.querySelector(".taskwrap");
      if (v.task) { tw.style.display = "block"; card.querySelector(".task").textContent = v.task; }
      else { tw.style.display = "none"; }
      card.querySelector(".q").textContent = v.question ? "❓ " + v.question : "";
      card.classList.toggle("open", !!expanded[v.name]);
      if (expanded[v.name]) loadLog(v.name);
    });
    Array.prototype.slice.call(fleet.querySelectorAll(".card")).forEach(function (c) {
      var name = c.id.replace(/^card-/, "");
      if (!seen[name]) { delete expanded[name]; c.remove(); }
    });
  }

  function loadLog(session) {
    fetch(watchUrl(session), { headers: authHeaders })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (s) {
        if (!s) return;
        var card = document.getElementById("card-" + session);
        if (card && expanded[session]) card.querySelector(".log").textContent = s.log || "(no output yet)";
      })
      .catch(function () {});
  }

  function tick() {
    fetch("/monitor.json" + qs, { headers: authHeaders })
      .then(function (r) {
        if (r.status === 401) throw new Error("unauthorized — check the ?token= in the URL");
        return r.json();
      })
      .then(function (views) {
        errEl.textContent = "";
        setLive(true, "live · updates every " + Math.round(POLL / 1000) + "s");
        render(views || []);
      })
      .catch(function (e) { errEl.textContent = String(e.message || e); setLive(false, "disconnected"); });
  }

  tick();
  setInterval(tick, POLL);
})();
`;
}

export function dashboardHtml(pollMs: number = DASHBOARD_POLL_MS): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>agent-sandbox monitor</title>
${STYLE}
</head>
<body>
${BODY}
<script>
${script(pollMs)}
</script>
</body>
</html>`;
}
