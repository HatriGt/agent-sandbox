/**
 * The operator dashboard (pure — returns a self-contained HTML string, no build step).
 *
 * A master-detail app: a fleet list (left on desktop, full-screen on mobile) and a box detail pane
 * (right on desktop, a second full-screen view reached by tapping a box on mobile — never a
 * cramped expanding row). Polls `/monitor.json` for the list and `/watch.json?session=` for the
 * selected box's log. Three actions beyond watching: `POST /resume.json` answers a WAITING box (the
 * only state that needs a human — it gets a banner impossible to miss), `POST /teardown.json` stops
 * one (two-step inline confirm, never a modal), and `POST /delegate.json` starts a new one from a
 * chat-style composer that is *always on screen*, not behind a button. `POST /ask.json` remains the
 * read-only co-pilot lane and stays visually and structurally distinct from all of the above: it is
 * a conversation with an observer, never a way to steer the agent.
 *
 * Same page, two shapes: <900px collapses the two panes into one view with a back affordance;
 * >=900px shows both side by side. No separate mobile build.
 */

/** Poll interval (ms) the page uses for the fleet list. */
export const DASHBOARD_POLL_MS = 3000;

const STYLE = `<style>
  :root, [data-theme="dark"] {
    --bg: #09090b; --panel: #0c0c0f; --elev: #131317; --border: #1e1e22; --border-2: #27272b;
    --fg: #fafafa; --muted: #a1a1aa; --faint: #82828c;
    --hover: #17171b; --sidebar: #0b0b0d; --accent: #5457ea; --accent-fg: #fff;
    --green: #22c55e; --amber: #f59e0b; --blue: #60a5fa; --red: #ef4444;
    --shadow: 0 1px 2px rgba(0,0,0,.4);
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
    --term-bg: #1c1c22; --term-bar: #26262e; --term-border: #33333c; --term-fg: #e4e4e7;
    --term-title: #a9a9b3; --term-err: #f87171; --term-warn: #fbbf24; --term-ok: #4ade80;
    --term-cmd: #a5b4fc; --term-dim: #8a8a95; --term-q: #fcd34d;
  }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body { height: 100%; overscroll-behavior-y: none; }
  body {
    margin: 0; background: var(--bg); color: var(--fg);
    font: 13.5px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  ::selection { background: color-mix(in srgb, var(--accent) 35%, transparent); }
  ::-webkit-scrollbar { width: 9px; height: 9px; }
  ::-webkit-scrollbar-thumb { background: var(--border-2); border-radius: 999px; border: 2px solid transparent; background-clip: padding-box; }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
  button, input, textarea { font: inherit; color: inherit; }

  /* ---------- app shell: list pane + detail pane ---------- */
  .app { display: grid; grid-template-columns: 340px 1fr; height: 100vh; height: 100dvh; }

  .listpane { display: flex; flex-direction: column; min-width: 0; background: var(--sidebar);
              border-right: 1px solid var(--border); }
  .lp-head { padding: 16px 16px 10px; display: flex; flex-direction: column; gap: 12px; }
  .brand { display: flex; align-items: center; gap: 10px; }
  .brand .logo { width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center;
                 background: var(--accent); color: var(--accent-fg); font-size: 13px; font-weight: 700;
                 flex-shrink: 0; }
  .brand .name { font-weight: 650; letter-spacing: -.01em; font-size: 14px; }
  .brand .name .sub { display: block; color: var(--faint); font-weight: 400; font-size: 12px; margin-top: 1px; }
  .brand-actions { margin-left: auto; display: flex; align-items: center; gap: 6px; }
  .iconbtn { display: inline-flex; align-items: center; justify-content: center; gap: 7px;
             width: 30px; height: 30px; border-radius: 8px; border: 1px solid var(--border);
             background: var(--panel); color: var(--muted); cursor: pointer; transition: background .12s, border-color .12s, color .12s; }
  .iconbtn:hover { background: var(--hover); border-color: var(--border-2); color: var(--fg); }

  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
  .stat { background: var(--panel); border: 1px solid var(--border); border-radius: 9px; padding: 7px 6px; text-align: center; }
  .stat b { display: block; font-size: 16px; font-weight: 650; letter-spacing: -.02em; font-variant-numeric: tabular-nums; line-height: 1.25; }
  .stat span { font-size: 12px; color: var(--faint); text-transform: uppercase; letter-spacing: .04em; }
  .stat.c-amber b { color: var(--amber); } .stat.c-green b { color: var(--green); }

  .live { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); }
  .live .dot { width: 6px; height: 6px; border-radius: 999px; background: var(--green);
               box-shadow: 0 0 0 3px color-mix(in srgb, var(--green) 22%, transparent); animation: pulse 1.8s ease-in-out infinite; }
  .live.stale .dot { background: var(--red); animation: none; box-shadow: 0 0 0 3px color-mix(in srgb, var(--red) 22%, transparent); }
  #err { color: var(--red); font-size: 12px; }
  #err:empty { display: none; }

  .fleet { flex: 1; overflow-y: auto; padding: 4px 8px; }
  .card { display: flex; flex-direction: column; gap: 6px; padding: 10px 10px; border-radius: 10px;
          cursor: pointer; border: 1px solid transparent; margin-bottom: 2px; transition: background .1s, border-color .1s; }
  .card:hover { background: var(--hover); }
  .card.active { background: color-mix(in srgb, var(--accent) 10%, var(--hover)); border-color: color-mix(in srgb, var(--accent) 28%, transparent); }
  .card-top { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .card .name { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; font-weight: 600;
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .card .role { font-size: 12px; color: var(--faint); flex-shrink: 0; margin-left: auto; }
  .card .task { font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis;
                display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; line-height: 1.35; }
  .card .task:empty::before { content: "task-less run"; color: var(--faint); font-style: italic; }
  .card .meta { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--faint);
                font-variant-numeric: tabular-nums; }
  .card .meta .q { color: color-mix(in srgb, var(--amber) 85%, var(--fg)); font-weight: 600; }

  .badge { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 600;
           padding: 2px 8px; border-radius: 999px; border: 1px solid transparent; white-space: nowrap; flex-shrink: 0; }
  .badge::before { content: ""; width: 5px; height: 5px; border-radius: 999px; background: currentColor; flex-shrink: 0; }
  .b-running { color: var(--green); background: color-mix(in srgb, var(--green) 13%, transparent); border-color: color-mix(in srgb, var(--green) 30%, transparent); }
  .b-running::before { animation: pulse 1.6s ease-in-out infinite; }
  .b-waiting { color: var(--amber); background: color-mix(in srgb, var(--amber) 15%, transparent); border-color: color-mix(in srgb, var(--amber) 36%, transparent); }
  .b-done { color: var(--blue); background: color-mix(in srgb, var(--blue) 13%, transparent); border-color: color-mix(in srgb, var(--blue) 30%, transparent); }
  .b-idle { color: var(--faint); background: var(--hover); border-color: var(--border); }
  .b-pending { color: var(--muted); background: var(--hover); border-color: var(--border); }
  .b-pending::before { animation: pulse 1s ease-in-out infinite; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }

  .fleet-empty { padding: 40px 16px; text-align: center; color: var(--faint); font-size: 12.5px; }
  .fleet-empty b { display: block; color: var(--muted); font-size: 13px; font-weight: 600; margin-bottom: 4px; }

  /* ---------- composer: always-on chat bar to start a new sandbox ---------- */
  .composer { border-top: 1px solid var(--border); padding: 10px; flex-shrink: 0; }
  .composer.busy { opacity: .7; pointer-events: none; }
  .composer-box { border: 1px solid var(--border-2); border-radius: 12px; background: var(--panel);
                  transition: border-color .12s; }
  .composer-box:focus-within { border-color: var(--accent); }
  .composer textarea { width: 100%; resize: none; border: 0; background: transparent; padding: 10px 12px 4px;
                        font-size: 13px; line-height: 1.45; max-height: 120px; display: block; }
  .composer textarea:focus { outline: none; }
  .composer-row { display: flex; align-items: center; gap: 6px; padding: 2px 8px 8px; }
  .composer-opts { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .chip { font-size: 12px; color: var(--muted); background: var(--hover); border: 1px solid var(--border);
          border-radius: 999px; padding: 3px 9px; cursor: pointer; }
  .chip:hover { border-color: var(--border-2); color: var(--fg); }
  .chip.on { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 40%, transparent);
             background: color-mix(in srgb, var(--accent) 10%, transparent); }
  .composer-fields { display: none; grid-template-columns: 1fr 1fr; gap: 6px; padding: 0 8px 8px; }
  .composer-fields.open { display: grid; }
  .composer-fields input { width: 100%; border: 1px solid var(--border-2); background: var(--elev);
                            border-radius: 8px; padding: 6px 9px; font-size: 12px; }
  .composer-fields input:focus { outline: none; border-color: var(--accent); }
  .composer-send { margin-left: auto; width: 30px; height: 30px; border-radius: 9px; border: 0;
                   background: var(--accent); color: var(--accent-fg); cursor: pointer; display: grid; place-items: center;
                   flex-shrink: 0; transition: opacity .12s, transform .08s; font-size: 14px; }
  .composer-send:disabled { opacity: .35; cursor: default; }
  .composer-send:active:not(:disabled) { transform: scale(.92); }
  .composer-hint { font-size: 12px; color: var(--faint); padding: 0 8px 8px; }
  .composer-hint .err { color: var(--red); }
  .theme-btn-row { display: flex; justify-content: center; padding-top: 2px; }

  /* ---------- detail pane ---------- */
  .detailpane { display: flex; flex-direction: column; min-width: 0; background: var(--bg); }
  .dp-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
              color: var(--faint); gap: 8px; text-align: center; padding: 40px; }
  .dp-empty b { color: var(--muted); font-size: 14px; font-weight: 600; }

  .dp-head { display: flex; align-items: flex-start; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--border);
             flex-shrink: 0; }
  .back-btn { display: none; }
  .dp-head .titles { min-width: 0; flex: 1; }
  .dp-head .name { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 650; font-size: 14px;
                    display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
  .dp-head .task { color: var(--muted); font-size: 12.5px; margin-top: 5px; max-width: 70ch; }
  .dp-head .meta { display: flex; gap: 12px; margin-top: 8px; font-size: 12px; color: var(--faint); font-variant-numeric: tabular-nums; flex-wrap: wrap; }
  .dp-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 8px;
         border: 1px solid var(--border-2); background: var(--panel); color: var(--fg); cursor: pointer;
         font-size: 12.5px; font-weight: 500; transition: background .12s, border-color .12s, color .12s; white-space: nowrap; }
  .btn:hover { background: var(--hover); }
  .btn.danger { color: var(--red); }
  .btn.danger.confirm { background: var(--red); color: #fff; border-color: var(--red); }
  .btn:disabled { opacity: .5; cursor: default; }

  .dp-body { flex: 1; overflow-y: auto; padding: 16px 20px 28px; display: flex; flex-direction: column; gap: 16px; }

  .waitband { border-radius: 12px; border: 1px solid color-mix(in srgb, var(--amber) 40%, transparent);
              background: color-mix(in srgb, var(--amber) 11%, transparent); padding: 13px 14px 14px; }
  .waitband .wb-label { display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 700;
                         text-transform: uppercase; letter-spacing: .05em; color: color-mix(in srgb, var(--amber) 88%, var(--fg)); margin-bottom: 8px; }
  .waitband .wb-q { font-size: 13.5px; line-height: 1.5; color: var(--fg); margin-bottom: 12px; white-space: pre-wrap; }
  .wb-row { display: flex; gap: 8px; }
  .wb-row textarea { flex: 1; resize: none; border: 1px solid var(--border-2); background: var(--panel);
                      border-radius: 9px; padding: 8px 11px; font-size: 13px; min-height: 40px; max-height: 140px; }
  .wb-row textarea:focus { outline: none; border-color: var(--accent); }
  .wb-send { background: var(--accent); color: var(--accent-fg); border: 0; border-radius: 9px; padding: 0 16px;
             cursor: pointer; font-weight: 600; font-size: 12.5px; flex-shrink: 0; }
  .wb-send:disabled { opacity: .5; cursor: default; }

  .term { border-radius: 10px; overflow: hidden; border: 1px solid var(--term-border);
          box-shadow: 0 1px 2px rgba(0,0,0,.06); background: var(--term-bg); }
  .term-bar { display: flex; align-items: center; gap: 8px; padding: 8px 12px;
              background: var(--term-bar); border-bottom: 1px solid var(--term-border); }
  .term-dots { display: flex; gap: 6px; }
  .term-dots i { width: 11px; height: 11px; border-radius: 50%; display: inline-block; }
  .term-dots i.r { background: #ff5f56; } .term-dots i.y { background: #ffbd2e; } .term-dots i.g { background: #27c93f; }
  .term-title { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
                color: var(--term-title); font-weight: 600; letter-spacing: .01em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .term-live { display: inline-flex; align-items: center; gap: 5px; margin-left: auto; font-size: 12px;
               color: var(--term-title); text-transform: uppercase; letter-spacing: .05em; flex-shrink: 0; }
  .term-live .pulse { width: 7px; height: 7px; border-radius: 50%; background: var(--green);
                      box-shadow: 0 0 0 0 color-mix(in srgb, var(--green) 60%, transparent); animation: termpulse 1.6s infinite; }
  @keyframes termpulse { 0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--green) 55%,transparent)} 70%{box-shadow:0 0 0 6px transparent} 100%{box-shadow:0 0 0 0 transparent} }
  .term-copy { margin-left: 8px; cursor: pointer; border: 1px solid var(--term-border); background: transparent;
               color: var(--term-title); border-radius: 6px; padding: 3px 8px; font-size: 12px; flex-shrink: 0; transition: background .12s; }
  .term-copy:hover { background: var(--term-bar); }
  pre.log { margin: 0; padding: 12px 14px; background: var(--term-bg); max-height: 42vh; overflow: auto;
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

  .section-label { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: var(--faint);
                   display: flex; align-items: center; gap: 8px; }
  .section-label .tag { color: var(--faint); font-weight: 400; text-transform: none; letter-spacing: 0; }

  /* Ask panel — the co-pilot lane. Deliberately distinct from the terminal above: this is a
     conversation with an OBSERVER, never a way to steer the agent. */
  .askp { display: flex; flex-direction: column; gap: 8px; }
  .ask-log { display: flex; flex-direction: column; gap: 7px; max-height: 320px; overflow-y: auto; }
  .ask-msg { padding: 8px 11px; border-radius: 9px; font-size: 12.5px; white-space: pre-wrap;
             word-break: break-word; border: 1px solid var(--border); background: var(--elev); max-width: 92%; }
  .ask-msg.you { background: color-mix(in srgb, var(--accent) 12%, transparent);
                 border-color: color-mix(in srgb, var(--accent) 30%, transparent); align-self: flex-end; max-width: 82%; }
  .ask-msg.cop { background: var(--hover); }
  .ask-msg.err { color: var(--red); border-color: color-mix(in srgb, var(--red) 34%, transparent); background: color-mix(in srgb, var(--red) 10%, transparent); }
  .ask-msg .who { display: block; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: var(--faint); margin-bottom: 3px; }
  .ask-msg.pending { color: var(--muted); font-style: italic; }
  .ask-row { display: flex; gap: 7px; }
  .ask-in { flex: 1; background: var(--panel); color: var(--fg); border: 1px solid var(--border-2);
            border-radius: 8px; padding: 7px 10px; font-size: 12.5px; }
  .ask-in:focus { outline: none; border-color: var(--accent); }
  .ask-btn { cursor: pointer; border: 1px solid var(--border-2); background: var(--elev); color: var(--fg);
             border-radius: 8px; padding: 7px 13px; font-size: 12px; font-weight: 500; transition: background .12s, border-color .12s; white-space: nowrap; }
  .ask-btn:hover:not(:disabled) { background: var(--hover); border-color: var(--accent); }
  .ask-btn:disabled { opacity: .5; cursor: default; }
  .ask-btn.primary { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }

  .toast-stack { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); z-index: 40;
                 display: flex; flex-direction: column; gap: 6px; align-items: center; pointer-events: none; }
  .toast { background: var(--fg); color: var(--bg); font-size: 12.5px; font-weight: 500; padding: 8px 14px;
           border-radius: 999px; box-shadow: 0 4px 16px rgba(0,0,0,.25); }
  .toast.err { background: var(--red); color: #fff; }

  /* ---------- responsive: <900px collapses to one pane at a time ---------- */
  @media (max-width: 899px) {
    .app { grid-template-columns: 1fr; }
    .detailpane { position: fixed; inset: 0; z-index: 20; transform: translateX(100%); transition: transform .22s ease; }
    .app.detail-open .detailpane { transform: translateX(0); }
    .app.detail-open .listpane { display: none; }
    .back-btn { display: inline-flex; }
    .dp-head .task { max-width: none; }
    pre.log { max-height: none; }
  }
  @media (min-width: 900px) {
    .dp-empty { display: flex; }
  }
</style>`;

const BODY = `<div class="app" id="app">
  <div class="listpane">
    <div class="lp-head">
      <div class="brand">
        <span class="logo">A</span>
        <span class="name">agent-sandbox<span class="sub">fleet</span></span>
        <span class="brand-actions">
          <span class="live" id="live"><span class="dot"></span><span id="live-text">connecting…</span></span>
          <button class="iconbtn" id="theme-btn" title="Toggle theme"><span id="theme-icon">🌙</span></button>
        </span>
      </div>
      <div class="stats" id="stats"></div>
      <div id="err"></div>
    </div>
    <div class="fleet" id="fleet"><div class="fleet-empty">loading…</div></div>
    <div class="composer" id="composer">
      <div class="composer-box">
        <textarea id="composer-task" rows="1" placeholder="Describe a task to run in a new sandbox…"></textarea>
        <div class="composer-row">
          <div class="composer-opts">
            <button class="chip" id="composer-opts-toggle" type="button">repo / source</button>
          </div>
          <button class="composer-send" id="composer-send" type="button" title="Delegate" disabled>➔</button>
        </div>
        <div class="composer-fields" id="composer-fields">
          <input id="composer-repo" placeholder="owner/repo (optional)" />
          <input id="composer-ref" placeholder="branch / ref (optional)" />
        </div>
      </div>
      <div class="composer-hint" id="composer-hint">git source · no repo runs a task-only sandbox</div>
    </div>
  </div>
  <div class="detailpane" id="detailpane">
    <div class="dp-empty" id="dp-empty">
      <b>Select a sandbox</b>
      pick a box on the left, or describe a task below to start one
    </div>
  </div>
</div>
<div class="toast-stack" id="toasts"></div>`;

/** The page's browser JS as a string. Dependency-free + defensive. */
function script(pollMs: number): string {
  return `
(function () {
  var POLL = ${JSON.stringify(pollMs)};
  var params = new URLSearchParams(location.search);
  var token = params.get("token") || "";
  var qs = token ? ("?token=" + encodeURIComponent(token)) : "";
  var authHeaders = token ? { Authorization: "Bearer " + token } : {};
  var jsonHeaders = Object.assign({ "Content-Type": "application/json" }, authHeaders);
  var errEl = document.getElementById("err");
  var appEl = document.getElementById("app");

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>]/g, function (c) {
      return c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;";
    });
  }
  function cssEsc(s) { return String(s).replace(/[^a-zA-Z0-9_-]/g, "\\\\$&"); }

  // ---- theme toggle (persisted) ----
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    document.getElementById("theme-icon").textContent = t === "dark" ? "🌙" : "☀️";
    try { localStorage.setItem("asb-theme", t); } catch (e) {}
  }
  var savedTheme = "dark";
  try { savedTheme = localStorage.getItem("asb-theme") || "dark"; } catch (e) {}
  applyTheme(savedTheme);
  document.getElementById("theme-btn").addEventListener("click", function () {
    applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
  });

  function toast(msg, isErr) {
    var stack = document.getElementById("toasts");
    var t = document.createElement("div");
    t.className = "toast" + (isErr ? " err" : "");
    t.textContent = msg;
    stack.appendChild(t);
    setTimeout(function () { t.style.opacity = "0"; t.style.transition = "opacity .3s"; }, 2600);
    setTimeout(function () { stack.removeChild(t); }, 3000);
  }

  function setLive(ok, text) {
    document.getElementById("live").className = "live" + (ok ? "" : " stale");
    document.getElementById("live-text").textContent = text;
  }

  function roleLabel(r) {
    return r === "pool-free" ? "warm pool" : r === "pool-claimed" ? "pool" : "session";
  }
  function badgeClass(s) {
    return s === "running" ? "b-running" : s === "waiting" ? "b-waiting" : s === "done" ? "b-done" : "b-idle";
  }
  function watchUrl(session) { return "/watch.json" + (qs ? qs + "&" : "?") + "session=" + encodeURIComponent(session); }

  // ---- selection + mobile view state ----
  var selected = null;      // session name of the box shown in the detail pane
  var pendingBoxes = [];    // [{id, task}] optimistic rows for a delegate that hasn't shown up in monitor yet
  var lastViews = null;

  function selectBox(name) {
    selected = name;
    appEl.classList.add("detail-open");
    renderDetailShell();
    if (lastViews) renderFleet(lastViews);
    loadLog(name);
  }
  function closeDetail() {
    appEl.classList.remove("detail-open");
  }

  // ================= FLEET LIST =================
  function statHtml(val, label, cls) {
    return '<div class="stat' + (cls ? " " + cls : "") + '"><b>' + val + '</b><span>' + esc(label) + '</span></div>';
  }

  function cardHtml(v) {
    var mem = (v.mem || "").split(" / ")[0];
    var metaBits = [];
    if (v.uptime) metaBits.push("up " + esc(v.uptime));
    if (v.cpu) metaBits.push("cpu " + esc(v.cpu));
    if (mem) metaBits.push("mem " + esc(mem));
    var metaLine = metaBits.join(" · ");
    return '<div class="card' + (selected === v.name ? " active" : "") + '" data-box="' + esc(v.name) + '">' +
      '<div class="card-top">' +
        '<span class="badge ' + badgeClass(v.runState) + '">' + esc(v.runState) +
          (v.runState === "done" && v.exitCode != null ? " " + esc(v.exitCode) : "") + '</span>' +
        '<span class="role">' + esc(roleLabel(v.role)) + '</span>' +
      '</div>' +
      '<div class="name">' + esc(v.name) + '</div>' +
      '<div class="task">' + (v.task ? esc(v.task) : "") + '</div>' +
      '<div class="meta">' + (v.runState === "waiting" ? '<span class="q">needs an answer</span>' : metaLine) + '</div>' +
    '</div>';
  }

  function pendingCardHtml(p) {
    return '<div class="card" data-pending="' + esc(p.id) + '">' +
      '<div class="card-top"><span class="badge b-pending">starting…</span></div>' +
      '<div class="name">new sandbox</div>' +
      '<div class="task">' + esc(p.task) + '</div>' +
    '</div>';
  }

  function renderFleet(views) {
    lastViews = views;
    var running = views.filter(function (v) { return /^running$/i.test(v.boxStatus || ""); });
    var sessions = running.filter(function (v) { return v.role !== "pool-free"; }).length;
    var free = running.filter(function (v) { return v.role === "pool-free"; }).length;
    var wait = running.filter(function (v) { return v.runState === "waiting"; }).length;
    var active = running.filter(function (v) { return v.runState === "running"; }).length;

    document.getElementById("stats").innerHTML =
      statHtml(running.length, "up", "") +
      statHtml(active, "running", active ? "c-green" : "") +
      statHtml(wait, "waiting", wait ? "c-amber" : "") +
      statHtml(free, "pool", "");

    // A pending (just-submitted) delegation graduates to a real card once monitor.json sees its box.
    pendingBoxes = pendingBoxes.filter(function (p) { return !running.some(function (v) { return v.name === p.id; }); });

    var fleetEl = document.getElementById("fleet");
    if (!running.length && !pendingBoxes.length) {
      fleetEl.innerHTML = '<div class="fleet-empty"><b>No sandboxes are up</b>describe a task below to start one</div>';
      if (selected) { selected = null; closeDetail(); renderDetailShell(); }
      return;
    }

    var order = { session: 0, "pool-claimed": 1, "pool-free": 2 };
    var sorted = running.slice().sort(function (a, b) {
      var wa = a.runState === "waiting" ? 0 : 1, wb = b.runState === "waiting" ? 0 : 1;
      if (wa !== wb) return wa - wb;
      var oa = order[a.role] ?? 9, ob = order[b.role] ?? 9;
      if (oa !== ob) return oa - ob;
      return String(a.name).localeCompare(String(b.name));
    });

    fleetEl.innerHTML = pendingBoxes.map(pendingCardHtml).join("") + sorted.map(cardHtml).join("");
    fleetEl.querySelectorAll(".card[data-box]").forEach(function (el) {
      el.addEventListener("click", function () { selectBox(el.getAttribute("data-box")); });
    });

    // If the box behind the open detail pane vanished (torn down / auto-stopped), fall back gracefully.
    if (selected && !running.some(function (v) { return v.name === selected; })) {
      var stillPending = pendingBoxes.some(function (p) { return p.id === selected; });
      if (!stillPending) { renderGone(); }
    }
  }

  // ================= DETAIL PANE =================
  var askLog = {};      // session -> [{who, text, cls}]
  var askBusy = {};     // session -> true while a turn is in flight
  var askDraft = {};    // session -> the half-typed question
  var askFocus = null;  // session whose ask input had focus before the last rebuild
  var teardownArmed = {};   // session -> confirm-state timer id
  var resumeSending = {};   // session -> in flight

  function viewFor(name) {
    return (lastViews || []).find(function (v) { return v.name === name; });
  }

  function renderDetailShell() {
    var el = document.getElementById("detailpane");
    if (!selected) {
      el.innerHTML = '<div class="dp-empty" id="dp-empty"><b>Select a sandbox</b>pick a box on the left, or describe a task below to start one</div>';
      return;
    }
    var v = viewFor(selected) || { name: selected, runState: "idle" };
    var mem = (v.mem || "").split(" / ")[0];
    el.innerHTML =
      '<div class="dp-head">' +
        '<button class="iconbtn back-btn" id="back-btn" title="Back to fleet">←</button>' +
        '<div class="titles">' +
          '<div class="name">' + esc(v.name) +
            ' <span class="badge ' + badgeClass(v.runState) + '">' + esc(v.runState) +
            (v.runState === "done" && v.exitCode != null ? " " + esc(v.exitCode) : "") + '</span></div>' +
          '<div class="task">' + (v.task ? esc(v.task) : '<span style="color:var(--faint);font-style:italic">task-less run</span>') + '</div>' +
          '<div class="meta">' +
            (v.uptime ? '<span>up ' + esc(v.uptime) + '</span>' : "") +
            (v.cpu ? '<span>cpu ' + esc(v.cpu) + '</span>' : "") +
            (mem ? '<span>mem ' + esc(mem) + '</span>' : "") +
            '<span class="mono">' + esc(roleLabel(v.role)) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="dp-actions">' +
          '<button class="btn danger" id="teardown-btn" type="button">teardown</button>' +
        '</div>' +
      '</div>' +
      '<div class="dp-body" id="dp-body">' +
        '<div id="waitband-slot"></div>' +
        '<div>' +
          '<div class="section-label" style="margin-bottom:8px">Live log <span class="tag">what it is doing right now</span></div>' +
          '<div class="term">' +
            '<div class="term-bar">' +
              '<span class="term-dots"><i class="r"></i><i class="y"></i><i class="g"></i></span>' +
              '<span class="term-title">' + esc(v.name) + ' — claude-code</span>' +
              '<span class="term-live"><span class="pulse"></span>live</span>' +
              '<button class="term-copy" id="term-copy" type="button">copy</button>' +
            '</div>' +
            '<pre class="log" id="term-log"><span class="empty">(loading…)</span></pre>' +
          '</div>' +
        '</div>' +
        '<div class="askp">' +
          '<div class="section-label">Ask the co-pilot <span class="tag">read-only, does not interrupt the agent</span></div>' +
          '<div class="ask-log" id="ask-log"></div>' +
          '<div class="ask-row">' +
            '<input class="ask-in" id="ask-in" type="text" placeholder="what has it changed so far? why is it stuck?" />' +
            '<button class="ask-btn primary" id="ask-send" type="button">ask</button>' +
            '<button class="ask-btn" id="ask-new" type="button" title="start a fresh co-pilot thread">new thread</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    var back = document.getElementById("back-btn");
    if (back) back.addEventListener("click", closeDetail);
    var td = document.getElementById("teardown-btn");
    if (td) td.addEventListener("click", function () { onTeardownClick(selected, td); });
    var copyBtn = document.getElementById("term-copy");
    if (copyBtn) copyBtn.addEventListener("click", function () {
      var pre = document.getElementById("term-log");
      if (navigator.clipboard && pre) navigator.clipboard.writeText(pre.textContent || "");
      copyBtn.textContent = "copied"; setTimeout(function () { copyBtn.textContent = "copy"; }, 1200);
    });

    renderWaitband(v);
    wireAsk(selected);
  }

  function renderGone() {
    var el = document.getElementById("detailpane");
    el.innerHTML = '<div class="dp-empty"><b>' + esc(selected) + ' is gone</b>torn down or auto-stopped — pick another sandbox</div>';
    selected = null;
  }

  // ---- WAITING band: the one state that needs a human, so it leads the detail pane ----
  function renderWaitband(v) {
    var slot = document.getElementById("waitband-slot");
    if (!slot) return;
    if (v.runState !== "waiting" || !v.question) { slot.innerHTML = ""; return; }
    slot.innerHTML =
      '<div class="waitband">' +
        '<div class="wb-label">⏸ waiting for you</div>' +
        '<div class="wb-q">' + esc(v.question) + '</div>' +
        '<div class="wb-row">' +
          '<textarea id="wb-answer" rows="1" placeholder="answer the question to continue…"></textarea>' +
          '<button class="wb-send" id="wb-send" type="button">resume</button>' +
        '</div>' +
      '</div>';
    var ta = document.getElementById("wb-answer");
    var btn = document.getElementById("wb-send");
    function auto() { ta.style.height = "auto"; ta.style.height = Math.min(140, ta.scrollHeight) + "px"; }
    ta.addEventListener("input", auto);
    ta.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendResume(); }
    });
    btn.addEventListener("click", sendResume);
    function sendResume() {
      var msg = ta.value.trim();
      if (!msg || resumeSending[selected]) return;
      resumeSending[selected] = true;
      ta.disabled = true; btn.disabled = true; btn.textContent = "sending…";
      fetch("/resume.json" + qs, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ session: selected, message: msg }) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          resumeSending[selected] = false;
          if (!res.ok) { toast(res.j.error || "resume failed", true); ta.disabled = false; btn.disabled = false; btn.textContent = "resume"; return; }
          toast("answer sent");
          tick(); // refresh state immediately rather than waiting for the next poll
        })
        .catch(function (e) {
          resumeSending[selected] = false;
          toast(String(e.message || e), true);
          ta.disabled = false; btn.disabled = false; btn.textContent = "resume";
        });
    }
  }

  function onTeardownClick(name, btn) {
    if (!teardownArmed[name]) {
      teardownArmed[name] = setTimeout(function () { teardownArmed[name] = null; if (btn.isConnected) { btn.classList.remove("confirm"); btn.textContent = "teardown"; } }, 4000);
      btn.classList.add("confirm");
      btn.textContent = "confirm?";
      return;
    }
    clearTimeout(teardownArmed[name]); teardownArmed[name] = null;
    btn.disabled = true; btn.textContent = "removing…";
    fetch("/teardown.json" + qs, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ session: name }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) { toast(res.j.error || "teardown failed", true); btn.disabled = false; btn.classList.remove("confirm"); btn.textContent = "teardown"; return; }
        toast(name + " torn down");
        if (selected === name) { selected = null; closeDetail(); }
        tick();
      })
      .catch(function (e) { toast(String(e.message || e), true); btn.disabled = false; });
  }

  // ---- live log tail ----
  function stripAnsi(s) {
    return String(s)
      .replace(/\\u001b\\[[0-9;?]*[ -\/]*[@-~]/g, "")
      .replace(/\\u001b\\][^\\u0007]*(\\u0007|\\u001b\\\\)/g, "")
      .replace(/\\u001b[=>PX^_].*?(\\u001b\\\\|\\u0007)/g, "")
      .replace(/[^\\n]*\\r(?!\\n)/g, "")
      .replace(/[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f]/g, "");
  }
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
    pre.innerHTML = clean.split("\\n").map(function (ln) {
      var c = lineClass(ln);
      return '<span class="l' + (c ? " " + c : "") + '">' + (esc(ln) || " ") + "</span>";
    }).join("");
    if (atBottom) pre.scrollTop = pre.scrollHeight;
  }
  function loadLog(session) {
    fetch(watchUrl(session), { headers: authHeaders })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (s) {
        if (!s || selected !== session) return;
        var pre = document.getElementById("term-log");
        if (pre) renderLog(pre, s.log);
        var v = viewFor(session);
        if (v) renderWaitband(v);
      })
      .catch(function () {});
  }

  // ---- Ask panel: a conversation with the box's READ-ONLY co-pilot ----
  function renderAsk(name) {
    if (selected !== name) return;
    var box = document.getElementById("ask-log");
    if (!box) return;
    var msgs = (askLog[name] || []).slice();
    if (askBusy[name]) msgs.push({ who: "co-pilot", text: "reading the box…", cls: "cop pending" });
    box.innerHTML = msgs.map(function (m) {
      return '<div class="ask-msg ' + m.cls + '"><span class="who">' + esc(m.who) + '</span>' + esc(m.text) + '</div>';
    }).join("");
    box.scrollTop = box.scrollHeight;

    var input = document.getElementById("ask-in"), send = document.getElementById("ask-send"), fresh = document.getElementById("ask-new");
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
    renderAsk(name);

    fetch("/ask.json" + qs, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ session: name, question: q, newThread: !!newThread }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        askBusy[name] = false;
        if (!res.ok) { askLog[name].push({ who: "error", text: res.j.error || "ask failed", cls: "err" }); }
        else {
          var t = res.j.answer || "(the co-pilot returned nothing)";
          if (res.j.timedOut) t += "\\n\\n(time cap reached — this answer may be partial)";
          askLog[name].push({ who: "co-pilot", text: t, cls: "cop" });
        }
      })
      .catch(function (e) { askBusy[name] = false; askLog[name].push({ who: "error", text: String(e.message || e), cls: "err" }); })
      .then(function () { renderAsk(name); });
  }

  function wireAsk(name) {
    var input = document.getElementById("ask-in"), send = document.getElementById("ask-send"), fresh = document.getElementById("ask-new");
    if (!input) return;
    input.addEventListener("input", function () { askDraft[name] = input.value; });
    input.addEventListener("focus", function () { askFocus = name; });
    input.addEventListener("blur", function () { if (askFocus === name) askFocus = null; });
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); askFocus = name; sendAsk(name, false); } });
    if (send) send.addEventListener("click", function () { askFocus = name; sendAsk(name, false); });
    if (fresh) fresh.addEventListener("click", function () { askFocus = name; sendAsk(name, true); });
    renderAsk(name);
  }

  // ================= COMPOSER: start a new sandbox =================
  var composerTask = document.getElementById("composer-task");
  var composerSend = document.getElementById("composer-send");
  var composerFields = document.getElementById("composer-fields");
  var composerRepo = document.getElementById("composer-repo");
  var composerRef = document.getElementById("composer-ref");
  var composerHint = document.getElementById("composer-hint");
  var composerEl = document.getElementById("composer");

  document.getElementById("composer-opts-toggle").addEventListener("click", function (e) {
    e.target.classList.toggle("on");
    composerFields.classList.toggle("open");
  });
  function autoGrow() { composerTask.style.height = "auto"; composerTask.style.height = Math.min(120, composerTask.scrollHeight) + "px"; }
  composerTask.addEventListener("input", function () { autoGrow(); composerSend.disabled = !composerTask.value.trim(); });
  composerTask.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submitDelegate(); }
  });
  composerSend.addEventListener("click", submitDelegate);

  function submitDelegate() {
    var task = composerTask.value.trim();
    if (!task) return;
    var repo = composerRepo.value.trim();
    var ref = composerRef.value.trim();
    var pendingId = "pending-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
    pendingBoxes.push({ id: pendingId, task: task });
    if (lastViews) renderFleet(lastViews);

    composerEl.classList.add("busy");
    composerTask.value = ""; autoGrow(); composerSend.disabled = true;

    fetch("/delegate.json" + qs, {
      method: "POST", headers: jsonHeaders,
      body: JSON.stringify({ source: repo ? "git" : "git", repo: repo || undefined, ref: ref || undefined, task: task }),
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        composerEl.classList.remove("busy");
        pendingBoxes = pendingBoxes.filter(function (p) { return p.id !== pendingId; });
        if (!res.ok || res.j.ok === false) {
          toast((res.j && (res.j.error || res.j.question)) || "delegate failed", true);
          if (lastViews) renderFleet(lastViews);
          return;
        }
        toast("sandbox " + res.j.box + " started");
        tick();
        selectBox(res.j.box);
      })
      .catch(function (e) {
        composerEl.classList.remove("busy");
        pendingBoxes = pendingBoxes.filter(function (p) { return p.id !== pendingId; });
        toast(String(e.message || e), true);
        if (lastViews) renderFleet(lastViews);
      });
  }

  // ================= POLL LOOP =================
  function tick() {
    fetch("/monitor.json" + qs, { headers: authHeaders })
      .then(function (r) {
        if (r.status === 401) throw new Error("unauthorized — check the ?token= in the URL");
        return r.json();
      })
      .then(function (views) {
        errEl.textContent = "";
        setLive(true, "live · " + Math.round(POLL / 1000) + "s");
        renderFleet(views || []);
        if (selected) {
          renderDetailShell();
          loadLog(selected);
        }
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
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>agent-sandbox</title>
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
