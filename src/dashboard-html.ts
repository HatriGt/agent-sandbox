/**
 * The monitoring dashboard page (pure — returns a self-contained HTML string).
 *
 * It's a thin client: on load it reads the `token` from its own URL and polls `/monitor.json` every
 * few seconds to render the fleet as a data table; expanding a row polls `/watch.json?session=…` for
 * that box's live log. All auth rides on the token already in the URL (query param), so the page needs
 * no secrets baked in. Kept as one string (no framework/build step) so the container serves it with
 * zero deps.
 *
 * UX: a shadcn-style dashboard shell — left sidebar (brand + nav + theme toggle), a main column with a
 * header row, KPI cards, and a proper sortable data table (hover rows, inline status badges, an
 * expandable log drawer per row). Light/dark via `data-theme` token sets on <html>, persisted.
 */

/** Poll interval (ms) the page uses for the fleet list. */
export const DASHBOARD_POLL_MS = 3000;

/** shadcn tokens for both themes + the dashboard shell / KPI / table styling. No deps, no build step. */
const STYLE = `<style>
  :root, [data-theme="dark"] {
    --bg: #09090b; --panel: #0c0c0f; --elev: #131317; --border: #1e1e22; --border-2: #27272b;
    --fg: #fafafa; --muted: #a1a1aa; --faint: #71717a;
    --hover: #17171b; --sidebar: #0b0b0d; --accent: #6366f1; --accent-fg: #fff;
    --green: #22c55e; --amber: #f59e0b; --blue: #60a5fa; --red: #ef4444;
    --shadow: 0 1px 2px rgba(0,0,0,.4);
  }
  [data-theme="light"] {
    --bg: #fafafa; --panel: #fff; --elev: #fff; --border: #e7e7ea; --border-2: #dedee1;
    --fg: #0a0a0a; --muted: #52525b; --faint: #8a8a93;
    --hover: #f4f4f5; --sidebar: #fbfbfc; --accent: #4f46e5; --accent-fg: #fff;
    --green: #16a34a; --amber: #b45309; --blue: #2563eb; --red: #dc2626;
    --shadow: 0 1px 2px rgba(0,0,0,.05);
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0; background: var(--bg); color: var(--fg);
    font: 13.5px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased; transition: background .2s, color .2s;
  }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-thumb { background: var(--border-2); border-radius: 999px; border: 2px solid var(--bg); }

  /* app shell: fixed sidebar + fluid main */
  .app { display: grid; grid-template-columns: 240px 1fr; min-height: 100vh; }
  .sidebar { background: var(--sidebar); border-right: 1px solid var(--border);
             padding: 16px 14px; display: flex; flex-direction: column; gap: 4px;
             position: sticky; top: 0; height: 100vh; }
  .brand { display: flex; align-items: center; gap: 10px; padding: 6px 8px 14px; font-weight: 600;
           letter-spacing: -.01em; }
  .brand .logo { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center;
                 background: var(--accent); color: var(--accent-fg); font-size: 14px; font-weight: 700; }
  .brand .sub { color: var(--faint); font-weight: 400; font-size: 11px; }
  .navlabel { font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--faint);
              padding: 12px 8px 6px; }
  .navitem { display: flex; align-items: center; gap: 10px; padding: 7px 8px; border-radius: 7px;
             color: var(--muted); text-decoration: none; font-size: 13px; }
  .navitem.active { background: var(--hover); color: var(--fg); font-weight: 500; }
  .navitem .ico { width: 16px; text-align: center; opacity: .85; }
  .navitem .count { margin-left: auto; font-size: 11px; color: var(--faint);
                    font-variant-numeric: tabular-nums; }
  .side-foot { margin-top: auto; display: flex; flex-direction: column; gap: 8px; }
  .live { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted);
          padding: 6px 8px; }
  .live .dot { width: 7px; height: 7px; border-radius: 999px; background: var(--green);
               box-shadow: 0 0 0 3px color-mix(in srgb, var(--green) 22%, transparent);
               animation: pulse 1.8s ease-in-out infinite; }
  .live.stale .dot { background: var(--red); animation: none; box-shadow: 0 0 0 3px color-mix(in srgb, var(--red) 22%, transparent); }
  .iconbtn { display: flex; align-items: center; gap: 9px; padding: 7px 8px; border-radius: 7px;
             border: 1px solid var(--border); background: var(--panel); color: var(--fg); cursor: pointer;
             font: inherit; font-size: 13px; transition: background .15s, border-color .15s; }
  .iconbtn:hover { background: var(--hover); border-color: var(--border-2); }

  /* main */
  .main { min-width: 0; display: flex; flex-direction: column; }
  .head { display: flex; align-items: baseline; gap: 12px; padding: 22px 28px 6px; }
  .head h1 { font-size: 20px; margin: 0; letter-spacing: -.02em; font-weight: 650; }
  .head .desc { color: var(--muted); font-size: 13px; }
  #err { margin-left: auto; color: var(--red); font-size: 12.5px; align-self: center; }
  #err:empty { display: none; }
  .content { padding: 14px 28px 40px; display: flex; flex-direction: column; gap: 18px; }

  /* KPI cards */
  .kpis { display: grid; gap: 14px; grid-template-columns: repeat(4, 1fr); }
  .kpi { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 15px 16px;
         box-shadow: var(--shadow); }
  .kpi .row { display: flex; align-items: center; justify-content: space-between; }
  .kpi .k-label { font-size: 12.5px; color: var(--muted); font-weight: 500; }
  .kpi .k-ico { width: 24px; height: 24px; border-radius: 7px; display: grid; place-items: center;
                background: var(--hover); font-size: 13px; }
  .kpi .k-val { font-size: 26px; font-weight: 650; margin-top: 10px; line-height: 1; letter-spacing: -.02em;
                font-variant-numeric: tabular-nums; }
  .kpi .k-sub { font-size: 12px; color: var(--faint); margin-top: 7px; }
  .kpi .k-val.c-green { color: var(--green); } .kpi .k-val.c-amber { color: var(--amber); }
  @media (max-width: 1100px) { .kpis { grid-template-columns: repeat(2, 1fr); } }

  /* table card */
  .tablecard { background: var(--panel); border: 1px solid var(--border); border-radius: 12px;
               box-shadow: var(--shadow); overflow: hidden; }
  .tablehead { display: flex; align-items: center; gap: 12px; padding: 14px 16px;
               border-bottom: 1px solid var(--border); }
  .tablehead h2 { font-size: 14px; margin: 0; font-weight: 600; }
  .tablehead .hint { color: var(--faint); font-size: 12px; }
  .tablewrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  thead th { text-align: left; font-weight: 500; font-size: 11.5px; text-transform: uppercase;
             letter-spacing: .04em; color: var(--faint); padding: 10px 16px; background: var(--elev);
             border-bottom: 1px solid var(--border); white-space: nowrap; user-select: none; }
  thead th.sortable { cursor: pointer; }
  thead th.sortable:hover { color: var(--muted); }
  thead th .arrow { opacity: .5; font-size: 10px; margin-left: 3px; }
  thead th.num, tbody td.num { text-align: right; font-variant-numeric: tabular-nums; }
  tbody tr.row { border-bottom: 1px solid var(--border); cursor: pointer; transition: background .1s; }
  tbody tr.row:last-child { border-bottom: 0; }
  tbody tr.row:hover { background: var(--hover); }
  tbody td { padding: 11px 16px; vertical-align: middle; }
  td.box { white-space: nowrap; }
  td.box .name { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 600;
                 font-size: 12.5px; display: flex; align-items: center; gap: 8px; }
  td.box .chev { color: var(--faint); font-size: 10px; transition: transform .15s;
                 display: inline-block; }
  tr.row.open td.box .chev { transform: rotate(90deg); }
  td.task { max-width: 340px; color: var(--muted); overflow: hidden; text-overflow: ellipsis;
            white-space: nowrap; }
  td.role span { font-size: 12px; color: var(--muted); }

  .badge { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 500;
           padding: 3px 9px; border-radius: 999px; border: 1px solid transparent; white-space: nowrap; }
  .badge::before { content: ""; width: 6px; height: 6px; border-radius: 999px; background: currentColor; }
  .b-running { color: var(--green); background: color-mix(in srgb, var(--green) 13%, transparent);
               border-color: color-mix(in srgb, var(--green) 30%, transparent); }
  .b-running::before { animation: pulse 1.6s ease-in-out infinite; }
  .b-waiting { color: var(--amber); background: color-mix(in srgb, var(--amber) 14%, transparent);
               border-color: color-mix(in srgb, var(--amber) 34%, transparent); }
  .b-done { color: var(--blue); background: color-mix(in srgb, var(--blue) 13%, transparent);
            border-color: color-mix(in srgb, var(--blue) 30%, transparent); }
  .b-idle { color: var(--faint); background: var(--hover); border-color: var(--border); }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }

  /* expandable detail drawer row */
  tr.detail td { padding: 0; border-bottom: 1px solid var(--border); }
  tr.detail:last-child td { border-bottom: 0; }
  .drawer { padding: 0 16px; max-height: 0; overflow: hidden; transition: max-height .2s ease, padding .2s ease; }
  tr.detail.open .drawer { max-height: 460px; padding: 14px 16px; }
  .drawer .q { padding: 9px 12px; border-radius: 9px; margin-bottom: 12px; font-size: 13px;
       background: color-mix(in srgb, var(--amber) 13%, transparent);
       border: 1px solid color-mix(in srgb, var(--amber) 32%, transparent);
       color: color-mix(in srgb, var(--amber) 82%, var(--fg)); }
  .drawer .q:empty { display: none; }
  .drawer .field-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em;
                         color: var(--faint); margin-bottom: 5px; }
  pre.log { margin: 0; padding: 12px 14px; background: var(--bg); border: 1px solid var(--border);
            border-radius: 9px; max-height: 340px; overflow: auto; white-space: pre-wrap; word-break: break-word;
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--fg);
            line-height: 1.5; }

  .emptyrow td { padding: 60px 20px; text-align: center; color: var(--muted); }
  .emptyrow .big { font-size: 15px; color: var(--fg); font-weight: 600; margin-bottom: 4px; }
</style>`;

const BODY = `<div class="app">
  <aside class="sidebar">
    <div class="brand"><span class="logo">A</span>
      <div>agent-sandbox<div class="sub">fleet monitor</div></div></div>
    <div class="navlabel">Overview</div>
    <a class="navitem active"><span class="ico">▦</span>Sandboxes<span class="count" id="nav-count">0</span></a>
    <a class="navitem"><span class="ico">▶</span>Running<span class="count" id="nav-running">0</span></a>
    <a class="navitem"><span class="ico">⏸</span>Waiting<span class="count" id="nav-waiting">0</span></a>
    <a class="navitem"><span class="ico">◷</span>Warm pool<span class="count" id="nav-pool">0</span></a>
    <div class="side-foot">
      <span class="live" id="live"><span class="dot"></span><span id="live-text">connecting…</span></span>
      <button class="iconbtn" id="theme-btn" title="Toggle theme"><span id="theme-icon">🌙</span>
        <span id="theme-label">Dark</span></button>
    </div>
  </aside>
  <div class="main">
    <div class="head">
      <h1>Sandboxes</h1>
      <span class="desc">what's up right now and what each agent is doing</span>
      <span id="err"></span>
    </div>
    <div class="content">
      <div class="kpis" id="kpis"></div>
      <div class="tablecard">
        <div class="tablehead"><h2>Fleet</h2><span class="hint">click a row to see its live log</span></div>
        <div class="tablewrap">
          <table>
            <thead><tr>
              <th class="sortable" data-sort="name">Box<span class="arrow"></span></th>
              <th class="sortable" data-sort="role">Role<span class="arrow"></span></th>
              <th class="sortable" data-sort="runState">Status<span class="arrow"></span></th>
              <th>Task</th>
              <th class="sortable num" data-sort="cpu">CPU<span class="arrow"></span></th>
              <th class="sortable num" data-sort="mem">Mem<span class="arrow"></span></th>
              <th class="sortable num" data-sort="uptime">Uptime<span class="arrow"></span></th>
            </tr></thead>
            <tbody id="fleet">
              <tr class="emptyrow" id="empty"><td colspan="7"><div class="big">Loading…</div>connecting to the fleet</td></tr>
            </tbody>
          </table>
        </div>
      </div>
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
  var expanded = {};                 // session -> log drawer open?
  var sortKey = "role", sortDir = 1; // default: sessions first
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
    applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
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
    document.getElementById("live").className = "live" + (ok ? "" : " stale");
    document.getElementById("live-text").textContent = text;
  }
  // numeric-ish sort keys: percentages, MiB, and "12m03s" durations become comparable numbers.
  function num(v) {
    if (v == null) return -1;
    var s = String(v);
    var pct = s.match(/([\\d.]+)\\s*%/); if (pct) return parseFloat(pct[1]);
    var dur = s.match(/(?:(\\d+)h)?(?:(\\d+)m)?(?:(\\d+)s)?/);
    if (dur && (dur[1] || dur[2] || dur[3]))
      return (+(dur[1]||0))*3600 + (+(dur[2]||0))*60 + (+(dur[3]||0));
    var n = parseFloat(s.replace(/[^\\d.]/g, "")); return isNaN(n) ? -1 : n;
  }
  var ROLE_ORDER = { "session": 0, "pool-claimed": 1, "pool-free": 2 };
  var STATE_ORDER = { "waiting": 0, "running": 1, "done": 2, "idle": 3 };

  function kpi(label, ico, val, sub, accent) {
    return '<div class="kpi"><div class="row"><span class="k-label">' + esc(label) + '</span>' +
      '<span class="k-ico">' + ico + '</span></div>' +
      '<div class="k-val ' + (accent || "") + '">' + val + '</div>' +
      '<div class="k-sub">' + esc(sub || "") + '</div></div>';
  }

  function sortViews(views) {
    var dir = sortDir;
    return views.slice().sort(function (a, b) {
      var av, bv;
      if (sortKey === "role") { av = ROLE_ORDER[a.role] ?? 9; bv = ROLE_ORDER[b.role] ?? 9; }
      else if (sortKey === "runState") { av = STATE_ORDER[a.runState] ?? 9; bv = STATE_ORDER[b.runState] ?? 9; }
      else if (sortKey === "cpu" || sortKey === "mem" || sortKey === "uptime") { av = num(a[sortKey]); bv = num(b[sortKey]); }
      else { return dir * String(a.name).localeCompare(String(b.name)); }
      if (av !== bv) return dir * (av - bv);
      return String(a.name).localeCompare(String(b.name)); // stable tiebreak
    });
  }

  function updateSortArrows() {
    document.querySelectorAll("thead th.sortable").forEach(function (th) {
      var a = th.querySelector(".arrow");
      a.textContent = th.getAttribute("data-sort") === sortKey ? (sortDir > 0 ? "↑" : "↓") : "";
    });
  }
  document.querySelectorAll("thead th.sortable").forEach(function (th) {
    th.addEventListener("click", function () {
      var k = th.getAttribute("data-sort");
      if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = 1; }
      updateSortArrows();
      if (lastViews) render(lastViews);
    });
  });

  function rowHtml(v) {
    var mem = (v.mem || "—").split(" / ")[0];
    return '<tr class="row" data-box="' + esc(v.name) + '">' +
      '<td class="box"><span class="name"><span class="chev">▸</span>' + esc(v.name) + '</span></td>' +
      '<td class="role"><span>' + esc(roleLabel(v.role)) + '</span></td>' +
      '<td><span class="badge ' + badgeClass(v.runState) + '">' +
        esc(v.runState) + (v.runState === "done" && v.exitCode != null ? " " + esc(v.exitCode) : "") + '</span></td>' +
      '<td class="task" title="' + esc(v.task || "") + '">' + (v.task ? esc(v.task) : '<span style="color:var(--faint)">—</span>') + '</td>' +
      '<td class="num">' + esc(v.cpu || "—") + '</td>' +
      '<td class="num">' + esc(mem) + '</td>' +
      '<td class="num">' + esc(v.uptime || "—") + '</td>' +
      '</tr>' +
      '<tr class="detail" data-detail="' + esc(v.name) + '"><td colspan="7"><div class="drawer">' +
        '<div class="q"></div>' +
        '<div class="field-label">Live log</div><pre class="log">(loading…)</pre>' +
      '</div></td></tr>';
  }

  var lastViews = null;
  function render(views) {
    lastViews = views;
    var running = views.filter(function (v) { return /^running$/i.test(v.boxStatus || ""); });
    var sessions = running.filter(function (v) { return v.role !== "pool-free"; }).length;
    var free = running.filter(function (v) { return v.role === "pool-free"; }).length;
    var wait = running.filter(function (v) { return v.runState === "waiting"; }).length;
    var active = running.filter(function (v) { return v.runState === "running"; }).length;

    document.getElementById("nav-count").textContent = running.length;
    document.getElementById("nav-running").textContent = active;
    document.getElementById("nav-waiting").textContent = wait;
    document.getElementById("nav-pool").textContent = free;

    document.getElementById("kpis").innerHTML =
      kpi("Sandboxes up", "▦", running.length, sessions + " session · " + free + " pool") +
      kpi("Running", "▶", active, "agents working", active ? "c-green" : "") +
      kpi("Waiting", "⏸", wait, "need an answer", wait ? "c-amber" : "") +
      kpi("Warm pool free", "◷", free, "ready to claim");

    var tbody = document.getElementById("fleet");
    if (!running.length) {
      tbody.innerHTML = '<tr class="emptyrow" id="empty"><td colspan="7">' +
        '<div class="big">No sandboxes are up</div>delegate a task to spin one up</td></tr>';
      return;
    }

    // Rebuild rows (small fleet; cheap). Preserve which drawers were open + their logs.
    var openLogs = {};
    running.forEach(function (v) {
      var d = tbody.querySelector('tr.detail[data-detail="' + cssEsc(v.name) + '"] pre.log');
      if (d) openLogs[v.name] = d.textContent;
    });
    tbody.innerHTML = sortViews(running).map(rowHtml).join("");

    running.forEach(function (v) {
      var detail = tbody.querySelector('tr.detail[data-detail="' + cssEsc(v.name) + '"]');
      var q = detail.querySelector(".q");
      q.textContent = v.question ? "❓ " + v.question : "";
      if (expanded[v.name]) {
        tbody.querySelector('tr.row[data-box="' + cssEsc(v.name) + '"]').classList.add("open");
        detail.classList.add("open");
        var log = detail.querySelector("pre.log");
        if (openLogs[v.name]) log.textContent = openLogs[v.name];
        loadLog(v.name);
      }
    });

    tbody.querySelectorAll("tr.row").forEach(function (tr) {
      tr.addEventListener("click", function () {
        var name = tr.getAttribute("data-box");
        expanded[name] = !expanded[name];
        tr.classList.toggle("open", !!expanded[name]);
        var detail = tbody.querySelector('tr.detail[data-detail="' + cssEsc(name) + '"]');
        detail.classList.toggle("open", !!expanded[name]);
        if (expanded[name]) loadLog(name);
      });
    });
  }

  // CSS.escape isn't everywhere; box names are [A-Za-z0-9-] so a minimal escape is enough.
  function cssEsc(s) { return String(s).replace(/[^a-zA-Z0-9_-]/g, "\\\\$&"); }

  function loadLog(session) {
    fetch(watchUrl(session), { headers: authHeaders })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (s) {
        if (!s || !expanded[session]) return;
        var pre = document.querySelector('tr.detail[data-detail="' + cssEsc(session) + '"] pre.log');
        if (pre) pre.textContent = s.log || "(no output yet)";
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
        setLive(true, "live · " + Math.round(POLL / 1000) + "s");
        render(views || []);
      })
      .catch(function (e) { errEl.textContent = String(e.message || e); setLive(false, "disconnected"); });
  }

  updateSortArrows();
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
