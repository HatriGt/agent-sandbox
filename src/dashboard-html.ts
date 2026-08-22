/**
 * The monitoring dashboard page (pure — returns a self-contained HTML string).
 *
 * It's a thin client: on load it reads the `token` from its own URL and polls `/monitor.json` every
 * few seconds to render the fleet as a data table; expanding a row polls `/watch.json?session=…` for
 * that box's live log and offers an ASK panel (POST `/ask.json`) that puts a question to the box's
 * read-only co-pilot without interrupting the agent. All auth rides on the token already in the URL (query param), so the page needs
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
    /* terminal panel (dark) */
    --term-bg: #0a0a0c; --term-bar: #131318; --term-border: #26262c; --term-fg: #d4d4d8;
    --term-title: #8a8a93; --term-err: #f87171; --term-warn: #fbbf24; --term-ok: #4ade80;
    --term-cmd: #818cf8; --term-dim: #6b6b73; --term-q: #fcd34d;
  }
  [data-theme="light"] {
    --bg: #fafafa; --panel: #fff; --elev: #fff; --border: #e7e7ea; --border-2: #dedee1;
    --fg: #0a0a0a; --muted: #52525b; --faint: #8a8a93;
    --hover: #f4f4f5; --sidebar: #fbfbfc; --accent: #4f46e5; --accent-fg: #fff;
    --green: #16a34a; --amber: #b45309; --blue: #2563eb; --red: #dc2626;
    --shadow: 0 1px 2px rgba(0,0,0,.05);
    /* terminal panel (light — a soft dark IDE terminal reads better than white for logs) */
    --term-bg: #1c1c22; --term-bar: #26262e; --term-border: #33333c; --term-fg: #e4e4e7;
    --term-title: #a9a9b3; --term-err: #f87171; --term-warn: #fbbf24; --term-ok: #4ade80;
    --term-cmd: #a5b4fc; --term-dim: #8a8a95; --term-q: #fcd34d;
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
  tr.detail.open .drawer { max-height: 560px; padding: 14px 16px; }
  .drawer .q { padding: 9px 12px; border-radius: 9px; margin-bottom: 12px; font-size: 13px;
       background: color-mix(in srgb, var(--amber) 13%, transparent);
       border: 1px solid color-mix(in srgb, var(--amber) 32%, transparent);
       color: color-mix(in srgb, var(--amber) 82%, var(--fg)); }
  .drawer .q:empty { display: none; }
  .drawer .field-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em;
                         color: var(--faint); margin-bottom: 5px; }
  /* Terminal-style live log panel */
  .term { border-radius: 10px; overflow: hidden; border: 1px solid var(--term-border);
          box-shadow: 0 1px 2px rgba(0,0,0,.06); background: var(--term-bg); }
  .term-bar { display: flex; align-items: center; gap: 8px; padding: 8px 12px;
              background: var(--term-bar); border-bottom: 1px solid var(--term-border); }
  .term-dots { display: flex; gap: 6px; }
  .term-dots i { width: 11px; height: 11px; border-radius: 50%; display: inline-block; }
  .term-dots i.r { background: #ff5f56; } .term-dots i.y { background: #ffbd2e; } .term-dots i.g { background: #27c93f; }
  .term-title { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px;
                color: var(--term-title); font-weight: 600; letter-spacing: .01em; }
  .term-live { display: inline-flex; align-items: center; gap: 5px; margin-left: auto; font-size: 10.5px;
               color: var(--term-title); text-transform: uppercase; letter-spacing: .05em; }
  .term-live .pulse { width: 7px; height: 7px; border-radius: 50%; background: var(--green);
                      box-shadow: 0 0 0 0 color-mix(in srgb, var(--green) 60%, transparent);
                      animation: pulse 1.6s infinite; }
  @keyframes pulse { 0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--green) 55%,transparent)} 70%{box-shadow:0 0 0 6px transparent} 100%{box-shadow:0 0 0 0 transparent} }
  .term-copy { margin-left: 8px; cursor: pointer; border: 1px solid var(--term-border); background: transparent;
               color: var(--term-title); border-radius: 6px; padding: 3px 8px; font-size: 10.5px; font: inherit;
               font-size: 10.5px; transition: background .12s; }
  .term-copy:hover { background: var(--term-bar); }
  pre.log { margin: 0; padding: 12px 14px; background: var(--term-bg); max-height: 360px; overflow: auto;
            white-space: pre-wrap; word-break: break-word; tab-size: 2;
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--term-fg);
            line-height: 1.55; }
  pre.log .l { display: block; padding: 0 2px; border-radius: 3px; }
  pre.log .l-err  { color: var(--term-err); }
  pre.log .l-warn { color: var(--term-warn); }
  pre.log .l-ok   { color: var(--term-ok); }
  pre.log .l-cmd  { color: var(--term-cmd); font-weight: 600; }
  pre.log .l-dim  { color: var(--term-dim); }
  pre.log .l-q    { color: var(--term-q); }
  pre.log .empty  { color: var(--term-dim); font-style: italic; }

  /* Ask panel — the co-pilot lane. Visually distinct from the terminal: this is a conversation
     with an OBSERVER, not the agent's own output, and conflating the two would mislead. */
  .askp { margin-top: 14px; }
  .ask-log { display: flex; flex-direction: column; gap: 7px; max-height: 260px; overflow: auto;
             margin-bottom: 9px; }
  .ask-log:empty { display: none; }
  .ask-msg { padding: 8px 11px; border-radius: 9px; font-size: 12.5px; white-space: pre-wrap;
             word-break: break-word; border: 1px solid var(--border); background: var(--elev); }
  .ask-msg.you { background: color-mix(in srgb, var(--accent) 12%, transparent);
                 border-color: color-mix(in srgb, var(--accent) 30%, transparent);
                 align-self: flex-end; max-width: 82%; }
  .ask-msg.cop { background: var(--hover); max-width: 92%; }
  .ask-msg.err { color: var(--red); border-color: color-mix(in srgb, var(--red) 34%, transparent);
                 background: color-mix(in srgb, var(--red) 10%, transparent); }
  .ask-msg .who { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: .05em;
                  color: var(--faint); margin-bottom: 3px; }
  .ask-msg.pending { color: var(--muted); font-style: italic; }
  .ask-row { display: flex; gap: 7px; }
  .ask-in { flex: 1; background: var(--panel); color: var(--fg); border: 1px solid var(--border-2);
            border-radius: 8px; padding: 7px 10px; font: inherit; font-size: 12.5px; }
  .ask-in:focus { outline: none; border-color: var(--accent); }
  .ask-btn { cursor: pointer; border: 1px solid var(--border-2); background: var(--elev); color: var(--fg);
             border-radius: 8px; padding: 7px 13px; font: inherit; font-size: 12px; font-weight: 500;
             transition: background .12s, border-color .12s; }
  .ask-btn:hover:not(:disabled) { background: var(--hover); border-color: var(--accent); }
  .ask-btn:disabled { opacity: .5; cursor: default; }
  .ask-btn.primary { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }

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
        '<div class="term">' +
          '<div class="term-bar">' +
            '<span class="term-dots"><i class="r"></i><i class="y"></i><i class="g"></i></span>' +
            '<span class="term-title">' + esc(v.name) + ' — claude-code</span>' +
            '<span class="term-live"><span class="pulse"></span>live</span>' +
            '<button class="term-copy" type="button">copy</button>' +
          '</div>' +
          '<pre class="log"><span class="empty">(loading…)</span></pre>' +
        '</div>' +
        '<div class="askp">' +
          '<div class="field-label">Ask the co-pilot — read-only, does not interrupt the agent</div>' +
          '<div class="ask-log"></div>' +
          '<div class="ask-row">' +
            '<input class="ask-in" type="text" placeholder="what has it changed so far? why is it stuck?" />' +
            '<button class="ask-btn primary ask-send" type="button">ask</button>' +
            '<button class="ask-btn ask-new" type="button" title="start a fresh co-pilot thread">new thread</button>' +
          '</div>' +
        '</div>' +
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

    // Rebuild rows (small fleet; cheap). Preserve which drawers were open + their rendered logs.
    var openLogs = {};
    running.forEach(function (v) {
      var d = tbody.querySelector('tr.detail[data-detail="' + cssEsc(v.name) + '"] pre.log');
      if (d) openLogs[v.name] = d.innerHTML;
    });
    tbody.innerHTML = sortViews(running).map(rowHtml).join("");

    running.forEach(function (v) {
      var detail = tbody.querySelector('tr.detail[data-detail="' + cssEsc(v.name) + '"]');
      var q = detail.querySelector(".q");
      q.textContent = v.question ? "❓ " + v.question : "";
      // Copy button: copies the terminal's visible text.
      var copyBtn = detail.querySelector(".term-copy");
      if (copyBtn) copyBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        var pre = detail.querySelector("pre.log");
        var txt = pre ? pre.textContent : "";
        if (navigator.clipboard) navigator.clipboard.writeText(txt);
        copyBtn.textContent = "copied"; setTimeout(function () { copyBtn.textContent = "copy"; }, 1200);
      });
      wireAsk(detail, v.name);
      if (expanded[v.name]) {
        tbody.querySelector('tr.row[data-box="' + cssEsc(v.name) + '"]').classList.add("open");
        detail.classList.add("open");
        var log = detail.querySelector("pre.log");
        if (openLogs[v.name]) log.innerHTML = openLogs[v.name];
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

  // Strip ANSI/OSC escape sequences and carriage-return spinner rewrites so the log reads cleanly.
  function stripAnsi(s) {
    return String(s)
      .replace(/\\u001b\\[[0-9;?]*[ -\/]*[@-~]/g, "")   // CSI (colors, cursor)
      .replace(/\\u001b\\][^\\u0007]*(\\u0007|\\u001b\\\\)/g, "") // OSC
      .replace(/\\u001b[=>PX^_].*?(\\u001b\\\\|\\u0007)/g, "")   // other escapes
      .replace(/[^\\n]*\\r(?!\\n)/g, "")                  // CR spinner overwrites: keep final segment
      .replace(/[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f]/g, ""); // stray control chars (keep \\t \\n \\r)
  }

  // Classify a log line so we can colour it like a terminal.
  function lineClass(line) {
    var t = line.trim();
    if (!t) return "";
    if (/error|fail(ed|ure)?|exception|traceback|fatal|✗|✘|\\bENO|not found|denied|rejected/i.test(t)) return "l-err";
    if (/warn(ing)?|deprecat|retired|⚠/i.test(t)) return "l-warn";
    if (/success|done|✓|✔|completed|created|passed|✅|committed|pushed|opened pr/i.test(t)) return "l-ok";
    if (/^[$>#❯]\\s|^\\s*(npm|git|gh|node|claude|sh|bash|cd|export|curl|yarn|pnpm)\\b/.test(t)) return "l-cmd";
    if (/^\\s*(❓|QUESTION[: ]|USER-INPUT)/i.test(t)) return "l-q";
    return "";
  }

  function renderLog(pre, raw) {
    var clean = stripAnsi(raw || "").replace(/\\n{3,}/g, "\\n\\n");
    if (!clean.trim()) { pre.innerHTML = '<span class="empty">(no output yet)</span>'; return; }
    var atBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40;
    var html = clean.split("\\n").map(function (ln) {
      var c = lineClass(ln);
      return '<span class="l' + (c ? " " + c : "") + '">' + (esc(ln) || " ") + "</span>";
    }).join("");
    pre.innerHTML = html;
    if (atBottom) pre.scrollTop = pre.scrollHeight; // keep tailing if the user was at the bottom
  }

  function loadLog(session) {
    fetch(watchUrl(session), { headers: authHeaders })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (s) {
        if (!s || !expanded[session]) return;
        var pre = document.querySelector('tr.detail[data-detail="' + cssEsc(session) + '"] pre.log');
        if (pre) renderLog(pre, s.log);
      })
      .catch(function () {});
  }

  // ---- Ask panel: a conversation with the box's READ-ONLY co-pilot -------------------------
  // State lives here, not in the DOM, because the fleet table is rebuilt on every poll. The one
  // thing the DOM owns is the caret: we save the draft + restore focus so a 3s tick can't eat what
  // someone is typing.
  var askLog = {};     // session -> [{who, text, cls}]
  var askBusy = {};    // session -> true while a turn is in flight
  var askDraft = {};   // session -> the half-typed question
  var askFocus = null; // session whose input had focus before the last rebuild

  function renderAsk(detail, name) {
    var box = detail.querySelector(".ask-log");
    if (!box) return;
    var msgs = (askLog[name] || []).slice();
    if (askBusy[name]) msgs.push({ who: "co-pilot", text: "reading the box…", cls: "cop pending" });
    box.innerHTML = msgs.map(function (m) {
      return '<div class="ask-msg ' + m.cls + '"><span class="who">' + esc(m.who) + '</span>' +
             esc(m.text) + '</div>';
    }).join("");
    box.scrollTop = box.scrollHeight;

    var input = detail.querySelector(".ask-in");
    var send = detail.querySelector(".ask-send");
    var fresh = detail.querySelector(".ask-new");
    if (!input) return;
    input.value = askDraft[name] || "";
    input.disabled = !!askBusy[name];
    if (send) send.disabled = !!askBusy[name];
    if (fresh) fresh.disabled = !!askBusy[name] || !(askLog[name] || []).length;
    if (askFocus === name && !input.disabled) {
      input.focus();
      try { input.setSelectionRange(input.value.length, input.value.length); } catch (e) {}
    }
  }

  function sendAsk(name, newThread) {
    var q = (askDraft[name] || "").trim();
    if (!q || askBusy[name]) return;
    askLog[name] = askLog[name] || [];
    if (newThread) askLog[name] = [];
    askLog[name].push({ who: "you", text: q, cls: "you" });
    askDraft[name] = "";
    askBusy[name] = true;
    var detail = document.querySelector('tr.detail[data-detail="' + cssEsc(name) + '"]');
    if (detail) renderAsk(detail, name);

    fetch("/ask.json" + qs, {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, authHeaders),
      body: JSON.stringify({ session: name, question: q, newThread: !!newThread }),
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        askBusy[name] = false;
        if (!res.ok) {
          askLog[name].push({ who: "error", text: res.j.error || "ask failed", cls: "err" });
        } else {
          var t = res.j.answer || "(the co-pilot returned nothing)";
          if (res.j.timedOut) t += "\\n\\n(time cap reached — this answer may be partial)";
          askLog[name].push({ who: "co-pilot", text: t, cls: "cop" });
        }
      })
      .catch(function (e) {
        askBusy[name] = false;
        askLog[name].push({ who: "error", text: String(e.message || e), cls: "err" });
      })
      .then(function () {
        var d = document.querySelector('tr.detail[data-detail="' + cssEsc(name) + '"]');
        if (d) renderAsk(d, name);
      });
  }

  function wireAsk(detail, name) {
    var input = detail.querySelector(".ask-in");
    var send = detail.querySelector(".ask-send");
    var fresh = detail.querySelector(".ask-new");
    if (!input) return;
    input.addEventListener("input", function () { askDraft[name] = input.value; });
    input.addEventListener("focus", function () { askFocus = name; });
    input.addEventListener("blur", function () { if (askFocus === name) askFocus = null; });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); askFocus = name; sendAsk(name, false); }
    });
    if (send) send.addEventListener("click", function () { askFocus = name; sendAsk(name, false); });
    if (fresh) fresh.addEventListener("click", function () { askFocus = name; sendAsk(name, true); });
    renderAsk(detail, name);
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
