/**
 * The browser helper that runs INSIDE a sandbox, as source text (it is written into the box and
 * started with the box's own node; see src/browser.ts). Plain CommonJS with no dependencies: Node 22+
 * has fetch and WebSocket built in. It owns one Moli page (`moli serve --layout`, CDP on loopback)
 * and answers one action at a time with the page state and a screenshot.
 *
 * Why a process that stays, not one command per action: the viewport override belongs to the CDP
 * connection (measured: a new connection is back at 1920x1080), so a page driven by a fresh
 * connection per click would be laid out twice per action and lose its scroll position.
 *
 * Kept free of backticks and dollar-brace so it can live in one raw template literal.
 */
export const BROWSER_DAEMON_SRC = String.raw`// agent-sandbox browser helper: owns one Moli page inside the sandbox and answers one action at a
// time over 127.0.0.1 with the page's state and a screenshot. Exits after 15 idle minutes.
const http = require("http"), cp = require("child_process"), fs = require("fs"), crypto = require("crypto");
const V = "@@V@@";
const BIN = process.env.ASB_MOLI_BIN || "/usr/local/bin/moli";
const PORT = +(process.env.ASB_BROWSER_PORT || 9334), CDP = PORT - 1;
const IDLE_MS = 15 * 60000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, lo, hi, d) => { v = Math.round(+v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
let moli = null, ws = null, seq = 0, loading = false, idle = null, vp = "";
const pend = new Map();

function quit() { try { if (moli) moli.kill("SIGKILL"); } catch (e) {} process.exit(0); }
function touch() { clearTimeout(idle); idle = setTimeout(quit, IDLE_MS); }
function fail(code, message) { const e = new Error(message); e.code = code; return e; }

async function targets() {
  try { const r = await fetch("http://127.0.0.1:" + CDP + "/json/list", { signal: AbortSignal.timeout(1500) }); return await r.json(); } catch (e) { return null; }
}

async function ensure() {
  if (ws && ws.readyState === 1) return;
  ws = null; vp = "";
  let t = await targets();
  if (!t) {
    if (!fs.existsSync(BIN)) throw fail("not-installed", "the browser is not installed in this sandbox");
    try { if (moli) moli.kill("SIGKILL"); } catch (e) {}
    moli = cp.spawn(BIN, ["serve", "--layout", "--host", "127.0.0.1", "-p", String(CDP)], { stdio: "ignore" });
    moli.on("exit", () => { moli = null; });
    moli.on("error", () => { moli = null; });
    for (let i = 0; i < 80 && !t; i++) { await sleep(100); t = await targets(); }
    if (!t) throw fail("no-start", "the browser did not start");
  }
  const page = t.find((x) => x.type === "page") || t[0];
  if (!page) throw fail("no-start", "the browser has no page");
  const sock = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { sock.onopen = res; sock.onerror = () => rej(fail("no-start", "cannot reach the browser")); });
  sock.onmessage = (m) => {
    let d; try { d = JSON.parse(m.data); } catch (e) { return; }
    if (d.id && pend.has(d.id)) { const p = pend.get(d.id); pend.delete(d.id); p(d); return; }
    if (d.method === "Page.frameStartedLoading") loading = true;
    else if (d.method === "Page.frameStoppedLoading" || d.method === "Page.loadEventFired") loading = false;
  };
  sock.onclose = () => {
    if (ws === sock) ws = null;
    for (const p of pend.values()) p({ error: { message: "the browser closed" } });
    pend.clear();
  };
  ws = sock; loading = false;
  await send("Page.enable");
}

function send(method, params) {
  return new Promise((res) => {
    if (!ws || ws.readyState !== 1) return res({ error: { message: "the browser closed" } });
    const id = ++seq; pend.set(id, res);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pend.has(id)) { pend.delete(id); res({ error: { message: method + " timed out" } }); } }, 25000);
  });
}
async function ev(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true });
  if (r.error) throw new Error(r.error.message);
  if (r.result.exceptionDetails) throw new Error("the page refused a script");
  return r.result.result.value;
}
// Wait out a page load: at least minMs (a click needs a beat to start one), at most maxMs.
async function settle(maxMs, minMs) {
  const t0 = Date.now();
  await sleep(minMs);
  let waited = false;
  while (loading && Date.now() - t0 < maxMs) { waited = true; await sleep(50); }
  if (waited) await sleep(150);
}

const STATE = "JSON.stringify({url:location.href,title:document.title,sx:Math.round(scrollX),sy:Math.round(scrollY),dw:document.documentElement.scrollWidth,dh:document.documentElement.scrollHeight,vw:innerWidth,vh:innerHeight})";

// Every visible element with its box, so the dashboard can hit-test a pointer without a round trip.
const MAP = "(" + function () {
  var out = [], keep = [], vw = innerWidth, vh = innerHeight;
  var ident = /^[A-Za-z_][\w-]*$/;
  function label(e) {
    var p = e.localName;
    if (e.id && ident.test(e.id) && e.id.length < 40) return p + "#" + e.id;
    var n = 0;
    for (var i = 0; i < e.classList.length && n < 2; i++) { var c = e.classList[i]; if (ident.test(c) && c.length < 32) { p += "." + c; n++; } }
    return p;
  }
  var all = document.body ? document.body.querySelectorAll("*") : [];
  for (var j = 0; j < all.length && out.length < 700; j++) {
    var e = all[j], tag = e.localName;
    if (tag === "script" || tag === "style" || tag === "br" || tag === "noscript" || tag === "template") continue;
    var b = e.getBoundingClientRect();
    if (b.width < 6 || b.height < 6 || b.bottom <= 0 || b.right <= 0 || b.top >= vh || b.left >= vw) continue;
    try { var cs = getComputedStyle(e); if (cs.visibility === "hidden" || cs.display === "none") continue; } catch (x) {}
    var text = "";
    try { text = e.getAttribute("aria-label") || e.getAttribute("alt") || e.getAttribute("placeholder") || ""; } catch (x) {}
    if (!text) { text = e.textContent || ""; }
    text = text.replace(/\s+/g, " ").trim();
    if (text.length > 90) text = text.slice(0, 89) + "…";
    keep.push(e);
    out.push([Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height), tag, label(e), text]);
  }
  window.__asbMap = keep;
  return JSON.stringify(out);
} + ")()";

// The detail of one mapped element, for the reference that goes to the agent.
const PICK = function (i) {
  var e = (window.__asbMap || [])[i];
  if (!e || !e.isConnected) return "null";
  // The shortest path from the element upward that matches it alone: short enough to read, exact
  // enough to find. Stops at an id, at uniqueness, or after six steps.
  var ident = /^[A-Za-z_][\w-]*$/;
  var parts = [], n = e, selector = "";
  while (n && n.nodeType === 1 && n !== document.documentElement && parts.length < 6) {
    var p = n.localName;
    if (n.id && ident.test(n.id)) { parts.unshift(p + "#" + n.id); selector = parts.join(" > "); break; }
    var cls = 0;
    for (var ci = 0; ci < n.classList.length && cls < 2; ci++) { var c = n.classList[ci]; if (ident.test(c) && c.length < 32) { p += "." + c; cls++; } }
    var par = n.parentElement;
    if (par) {
      var same = 0, idx = 0;
      for (var si = 0; si < par.children.length; si++) { var sb = par.children[si]; if (sb.localName === n.localName) { same++; if (sb === n) idx = same; } }
      if (same > 1) p += ":nth-of-type(" + idx + ")";
    }
    parts.unshift(p);
    selector = parts.join(" > ");
    try { if (document.querySelectorAll(selector).length === 1) break; } catch (x) {}
    n = par;
  }
  var text = (e.textContent || "").replace(/\s+/g, " ").trim();
  if (text.length > 160) text = text.slice(0, 159) + "…";
  var html = e.outerHTML || "";
  var open = html.slice(0, html.indexOf(">") + 1);
  if (open.length > 400) open = open.slice(0, 399) + "…";
  var comp = "";
  try {
    for (var k in e) {
      if (k.indexOf("__reactFiber$") === 0) {
        var f = e[k];
        while (f) { var t = f.type; if (typeof t === "function" && (t.displayName || t.name)) { comp = t.displayName || t.name; break; } f = f.return; }
        break;
      }
    }
  } catch (x) {}
  var style = {};
  try { var cs = getComputedStyle(e); style = { color: cs.color, background: cs.backgroundColor, font: cs.fontSize + " " + cs.fontFamily.split(",")[0], weight: cs.fontWeight }; } catch (x) {}
  var b = e.getBoundingClientRect();
  var attrs = {};
  ["href", "src", "name", "type", "role", "data-testid"].forEach(function (a) { var v = e.getAttribute(a); if (v) attrs[a] = v.slice(0, 200); });
  return JSON.stringify({ selector: selector, text: text, html: open, component: comp, style: style, attrs: attrs, rect: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)] });
};

// Ports something in the sandbox listens on (the dev server the agent started), from /proc/net/tcp*.
function ports() {
  const out = new Set();
  for (const f of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let s = ""; try { s = fs.readFileSync(f, "utf8"); } catch (e) { continue; }
    for (const line of s.split("\n").slice(1)) {
      const c = line.trim().split(/\s+/);
      if (c[3] !== "0A") continue;
      const p = parseInt((c[1] || "").split(":").pop(), 16);
      if (p >= 1024 && p !== PORT && p !== CDP) out.add(p);
    }
  }
  return Array.from(out).sort((a, b) => a - b).slice(0, 8);
}

const KEYS = { Enter: 13, Backspace: 8, Tab: 9, Escape: 27, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Delete: 46, Home: 36, End: 35, PageUp: 33, PageDown: 34 };

async function history() {
  const r = await send("Page.getNavigationHistory");
  const entries = (r.result && r.result.entries) || [], cur = (r.result && r.result.currentIndex) || 0;
  const first = entries.length && entries[0].url === "about:blank" ? 1 : 0;
  return { entries, cur, canBack: cur > first, canForward: cur < entries.length - 1 };
}

async function nav(url) {
  loading = true;
  const r = await send("Page.navigate", { url });
  if (r.error) { loading = false; throw fail("failed", r.error.message); }
  await settle(20000, 120);
  await sleep(250);
  return r.result && r.result.errorText ? String(r.result.errorText) : "";
}

async function act(a) {
  touch();
  if (a.op === "quit") { setTimeout(quit, 30); return { ok: true }; }
  await ensure();
  const w = clamp(a.w, 320, 1920, 1024), h = clamp(a.h, 240, 1600, 720), dpr = +a.dpr >= 1.5 ? 2 : 1;
  const key = w + "x" + h + "@" + dpr;
  if (key !== vp) {
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: dpr, mobile: false });
    vp = key; await sleep(80);
  }
  let netError = "";
  const before = a.op === "click" || a.op === "key" || a.op === "back" || a.op === "forward" ? await ev("location.href").catch(() => "") : "";
  const x = clamp(a.x, 0, w, 0), y = clamp(a.y, 0, h, 0);
  if (a.op === "pick") {
    const d = await ev("(" + PICK + ")(" + clamp(a.i, 0, 5000, 0) + ")");
    return { ok: true, pick: JSON.parse(d || "null") };
  }
  if (a.op === "goto" || (a.op === "open" && a.url)) netError = await nav(String(a.url));
  else if (a.op === "reload") { loading = true; await send("Page.reload"); await settle(20000, 120); }
  else if (a.op === "back" || a.op === "forward") {
    const hs = await history();
    if (a.op === "back" ? hs.canBack : hs.canForward) {
      const entry = hs.entries[hs.cur + (a.op === "back" ? -1 : 1)];
      await send("Page.navigateToHistoryEntry", { entryId: entry.id });
      await settle(20000, 200);
      if ((await ev("location.href")) === before) { await ev(a.op === "back" ? "history.back()" : "history.forward()"); await settle(20000, 300); }
    }
  } else if (a.op === "click") {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    await settle(15000, 220);
  } else if (a.op === "scroll") {
    await send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: clamp(a.dx, -20000, 20000, 0), deltaY: clamp(a.dy, -20000, 20000, 0) });
    await sleep(50);
  } else if (a.op === "type") {
    await send("Input.insertText", { text: String(a.text || "").slice(0, 2000) });
    await sleep(60);
  } else if (a.op === "key" && KEYS[a.key]) {
    const k = { key: a.key, code: a.key, windowsVirtualKeyCode: KEYS[a.key], nativeVirtualKeyCode: KEYS[a.key] };
    await send("Input.dispatchKeyEvent", Object.assign({ type: "keyDown" }, a.key === "Enter" ? { text: "\r" } : {}, k));
    await send("Input.dispatchKeyEvent", Object.assign({ type: "keyUp" }, k));
    await settle(15000, 150);
  }
  // A client-side route change renders after the click returns: give it a beat before the picture.
  if (before && (await ev("location.href").catch(() => before)) !== before) await sleep(350);
  const st = JSON.parse(await ev(STATE));
  const hs = await history();
  const band = Math.min(480, Math.round(st.vh * 0.6));
  const top = Math.max(0, Math.min(st.sy, band)), bottom = Math.max(0, Math.min(st.dh - st.vh - st.sy, band));
  let shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 72, clip: { x: st.sx, y: st.sy - top, width: st.vw, height: st.vh + top + bottom, scale: 1 } });
  let over = [top, bottom];
  if (shot.error) { shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 72 }); over = [0, 0]; }
  if (shot.error) throw fail("failed", shot.error.message);
  const data = shot.result.data;
  const hash = crypto.createHash("md5").update(data).digest("hex").slice(0, 16);
  const out = Object.assign({ ok: true, canBack: hs.canBack, canForward: hs.canForward, blank: st.url === "about:blank", loading, hash, dpr, over }, st);
  if (netError) { out.netError = netError; out.tried = String(a.url); }
  if (out.blank) out.ports = ports();
  if (a.op === "shot" && a.have === hash) { out.same = true; return out; }
  out.shot = data;
  if (a.map) { try { out.map = JSON.parse(await ev(MAP)); } catch (e) { out.map = []; } }
  return out;
}

let chain = Promise.resolve();
http.createServer((req, res) => {
  if (req.method !== "POST") { res.end(JSON.stringify({ v: V })); return; }
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    chain = chain.then(async () => {
      let out;
      try { out = await act(JSON.parse(body)); } catch (e) { out = { ok: false, code: e.code || "failed", error: String(e.message || e).slice(0, 300) }; }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(out));
    });
  });
}).listen(PORT, "127.0.0.1");
touch();
`;
