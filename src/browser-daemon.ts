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
// Two callers share the page: the dashboard's Browser pane (through the controller) and the agent,
// which runs this same file with arguments as the "browser" command (see cli() at the end).
const http = require("http"), cp = require("child_process"), fs = require("fs"), crypto = require("crypto"), os = require("os"), path = require("path");
const V = "@@V@@";
const BIN = process.env.ASB_MOLI_BIN || "/usr/local/bin/moli";
const PORT = +(process.env.ASB_BROWSER_PORT || 9334), CDP = PORT - 1;
// Five idle minutes and the browser's memory goes back to the agent. The page is not lost: the
// address and scroll position are written down and the next action from anyone restores them.
const IDLE_MS = 5 * 60000;
const HOME_DIR = path.join(os.homedir(), ".asb");
const TOKEN_FILE = path.join(HOME_DIR, "browser.token"), LAST_FILE = path.join(HOME_DIR, "browser-last.json");
let TOKEN = "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, lo, hi, d) => { v = Math.round(+v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
let moli = null, ws = null, seq = 0, loading = false, idle = null, vp = "";
const pend = new Map();
// The agent looks at the page at its own size, whatever width the person's pane happens to be.
let agentVp = { w: 1280, h: 800 };
// What the page logged or threw, and requests that failed, until the agent reads them.
const logs = [];
// The same, for the person: what went wrong on the page now showing. Not emptied by reading.
let pageErrs = [];
// What the agent last did here, so the person's pane can say it.
let lastAgent = null;
let spawned = false, lastSaved = "";
let hist = null, histUrl = "";
function note(level, text) {
  // Moli wraps an uncaught error in words about its own plumbing; the error is what follows 'threw: '.
  let t = String(text); const k = t.indexOf(' threw: ');
  if (k > 0 && k < 140 && t.slice(0, k).indexOf('callback') >= 0) t = t.slice(k + 8);
  const line = { level: level, text: t.slice(0, 500) };
  logs.push(line); if (logs.length > 200) logs.shift();
  if (level === "error" || level === "network") { pageErrs.push(line); if (pageErrs.length > 50) pageErrs.shift(); }
}
function memAvailableKb() {
  try { const m = /MemAvailable:\s+(\d+)/.exec(fs.readFileSync("/proc/meminfo", "utf8")); return m ? +m[1] : null; } catch (e) { return null; }
}
function readLast() { try { const o = JSON.parse(fs.readFileSync(LAST_FILE, "utf8")); return o && typeof o.url === "string" ? o : null; } catch (e) { return null; } }
function saveLast(st) {
  if (!/^https?:/i.test(st.url)) return;
  const line = JSON.stringify({ url: st.url, sy: st.sy });
  if (line === lastSaved) return;
  lastSaved = line;
  try { fs.mkdirSync(HOME_DIR, { recursive: true }); fs.writeFileSync(LAST_FILE, line); } catch (e) {}
}

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
    // Starting a browser in a box that is nearly out of memory gets the agent killed, not a page shown.
    const free = memAvailableKb();
    if (free !== null && free < 160000) throw fail("low-memory", "the sandbox has " + Math.round(free / 1024) + " MB of memory free and the browser needs about 200. Try again when the agent is doing less.");
    try { if (moli) moli.kill("SIGKILL"); } catch (e) {}
    // --image and --font: without them Moli fetches neither, and every page was drawn with empty
    // boxes for its pictures and a fallback for its type.
    moli = cp.spawn(BIN, ["serve", "--layout", "--image", "--font", "--host", "127.0.0.1", "-p", String(CDP)], { stdio: "ignore" });
    moli.on("exit", () => { moli = null; });
    moli.on("error", () => { moli = null; });
    for (let i = 0; i < 80 && !t; i++) { await sleep(100); t = await targets(); }
    if (!t) throw fail("no-start", "the browser did not start");
    spawned = true;
  }
  const page = t.find((x) => x.type === "page") || t[0];
  if (!page) throw fail("no-start", "the browser has no page");
  const sock = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { sock.onopen = res; sock.onerror = () => rej(fail("no-start", "cannot reach the browser")); });
  sock.onmessage = (m) => {
    let d; try { d = JSON.parse(m.data); } catch (e) { return; }
    if (d.id && pend.has(d.id)) { const p = pend.get(d.id); pend.delete(d.id); p(d); return; }
    if (d.method === "Page.frameStartedLoading") loading = true;
    else if (d.method === "Page.frameNavigated" && d.params && d.params.frame && !d.params.frame.parentId) pageErrs = [];
    else if (d.method === "Page.frameStoppedLoading" || d.method === "Page.loadEventFired") loading = false;
    else if (d.method === "Runtime.consoleAPICalled") {
      const p = d.params || {};
      note(p.type || "log", (p.args || []).map((x) => (x.value !== undefined ? (typeof x.value === "string" ? x.value : JSON.stringify(x.value)) : x.description || x.type || "")).join(" "));
    } else if (d.method === "Runtime.exceptionThrown") {
      const x = (d.params || {}).exceptionDetails || {};
      note("error", (x.exception && x.exception.description) || x.text || "uncaught error");
    } else if (d.method === "Network.responseReceived") {
      const r = (d.params || {}).response || {};
      if (r.status >= 400) note("network", r.status + " " + r.url);
    } else if (d.method === "Network.loadingFailed") {
      const f = d.params || {};
      if (!f.canceled) note("network", "failed " + (f.errorText || "") + " " + (f.url || ""));
    }
  };
  sock.onclose = () => {
    if (ws === sock) ws = null;
    for (const p of pend.values()) p({ error: { message: "the browser closed" } });
    pend.clear();
  };
  ws = sock; loading = false;
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
}

function send(method, params) {
  return new Promise((res) => {
    if (!ws || ws.readyState !== 1) return res({ error: { message: "the browser closed" } });
    const id = ++seq; pend.set(id, res);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pend.has(id)) { pend.delete(id); res({ error: { message: method + " timed out" } }); } }, 25000);
  });
}
async function ev(expression, awaitPromise) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: !!awaitPromise });
  if (r.error) throw new Error(r.error.message);
  if (r.result.exceptionDetails) {
    const x = r.result.exceptionDetails;
    throw fail("script", (x.exception && x.exception.description) || x.text || "the page refused a script");
  }
  return r.result.result.value;
}
// Moli lays a page out when it paints, not when a script asks for a size: an element added by a
// click measures 0 x 0 until the next picture. So before anything is measured for the agent, paint
// a few pixels.
async function layout() { await send("Page.captureScreenshot", { format: "jpeg", quality: 1, clip: { x: 0, y: 0, width: 8, height: 8, scale: 1 } }); }
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

// The shortest selector that matches an element alone (same rule as PICK above).
function selectorOf(e) {
  var ident = /^[A-Za-z_][\w-]*$/;
  var parts = [], n = e, selector = "";
  while (n && n.nodeType === 1 && n !== document.documentElement && parts.length < 6) {
    var p = n.localName;
    if (n.id && ident.test(n.id)) { parts.unshift(p + "#" + n.id); return parts.join(" > "); }
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
    try { if (document.querySelectorAll(selector).length === 1) return selector; } catch (x) {}
    n = par;
  }
  return selector;
}

// One element from what the agent wrote: a CSS selector first, else the visible text (a button's
// words, a field's label or placeholder). The shortest text that contains the words wins, so
// "Save" finds the button and not the form around it. With go, it is scrolled into view.
const FIND = function (q, go) {
  var e = null;
  try { e = document.querySelector(q); } catch (x) {}
  if (!e) {
    var want = String(q).replace(/\s+/g, " ").trim().toLowerCase(), best = null, bestScore = Infinity;
    var all = document.body ? document.body.querySelectorAll("*") : [];
    for (var i = 0; i < all.length; i++) {
      var n = all[i], tag = n.localName;
      if (tag === "script" || tag === "style" || tag === "noscript" || tag === "template") continue;
      var t = (n.getAttribute("aria-label") || n.getAttribute("placeholder") || n.getAttribute("title") || n.getAttribute("alt") || (tag === "input" && /^(button|submit|reset)$/.test(n.type) ? n.value : "") || n.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      if (!t || t.indexOf(want) < 0) continue;
      var r = n.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      var score = (t === want ? 0 : 100000) + t.length;
      if (score <= bestScore) { best = n; bestScore = score; }
    }
    e = best;
    // Words that name a field ("Email") mean the field, not its label.
    if (e && e.localName === "label") { var f = e.control || e.querySelector("input,textarea,select"); if (f) e = f; }
  }
  if (!e) return "null";
  if (go) { try { e.scrollIntoView({ block: "center", inline: "center" }); } catch (x) { try { e.scrollIntoView(); } catch (y) {} } }
  var b = e.getBoundingClientRect();
  window.__asbHit = e;
  return JSON.stringify({ x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2), tag: e.localName, text: (e.getAttribute("aria-label") || e.textContent || e.getAttribute("placeholder") || "").replace(/\s+/g, " ").trim().slice(0, 80) });
};

// Empty the element FIND just returned and focus it, so typed text replaces what was there. A
// select takes its option by value or by words. Goes through the native setter: a framework that
// tracks the value (React) only notices a change made that way.
const CLEAR = function (text) {
  var e = window.__asbHit;
  if (!e) return "gone";
  e.focus();
  if (e.localName === "select") {
    var want = String(text).trim().toLowerCase(), hit = -1;
    for (var i = 0; i < e.options.length; i++) { var o = e.options[i]; if (o.value.toLowerCase() === want || o.text.replace(/\s+/g, " ").trim().toLowerCase() === want) { hit = i; break; } }
    if (hit < 0) return "no-option";
    e.selectedIndex = hit;
    e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true }));
    return "select";
  }
  if (e.isContentEditable) { e.textContent = ""; return "text"; }
  if (!("value" in e)) return "not-a-field";
  var proto = e.localName === "textarea" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  var d = Object.getOwnPropertyDescriptor(proto, "value");
  if (d && d.set) d.set.call(e, ""); else e.value = "";
  e.dispatchEvent(new Event("input", { bubbles: true }));
  return "text";
};

// What a person could click or type into, each with the selector that finds it.
const ELEMS = function () {
  var out = [], vh = innerHeight;
  var all = document.body ? document.body.querySelectorAll("a[href],button,input,textarea,select,summary,[role=button],[role=link],[role=tab],[role=checkbox],[role=menuitem],[role=switch],[onclick],[contenteditable=true]") : [];
  for (var i = 0; i < all.length && out.length < 120; i++) {
    var e = all[i], b = e.getBoundingClientRect();
    if (b.width < 2 || b.height < 2) continue;
    try { var cs = getComputedStyle(e); if (cs.visibility === "hidden" || cs.display === "none") continue; } catch (x) {}
    if (e.localName === "input" && e.type === "hidden") continue;
    var text = (e.getAttribute("aria-label") || e.getAttribute("placeholder") || e.getAttribute("name") || e.textContent || e.value || "").replace(/\s+/g, " ").trim();
    if (text.length > 70) text = text.slice(0, 69) + "…";
    var kind = e.localName === "input" ? "input:" + (e.type || "text") : e.localName;
    var o = { kind: kind, text: text, sel: selectorOf(e) };
    if ("value" in e && e.localName !== "button" && e.value) o.value = String(e.value).slice(0, 60);
    if (e.disabled) o.disabled = true;
    if (b.bottom < 0 || b.top > vh) o.off = true;
    out.push(o);
  }
  return JSON.stringify(out);
};

// Moli lays out position: sticky as if it were static: a sticky header or sidebar scrolls away
// with the page and is missing from every picture taken further down. Before a picture, each one
// is moved to where a browser would hold it (against the top or bottom edge, never past its
// parent) with the translate property, which Moli does paint and which leaves the page's own
// transform alone.
//
// Two steps, because a picture is the only thing that lays a Moli page out and every picture costs
// a full paint of the document (half a second on a long page, measured, whatever its size).
// Measuring used to take a picture of its own, so every look was two paints. Now the places are
// remembered in page coordinates: STICK_SET moves the elements from the scroll position alone
// (no layout needed), the picture is taken, and STICK_MEASURE reads the places again from the
// layout that picture just made. Only when that finds something out of place (the first picture
// of a page opened scrolled, a page that grew) is the picture taken a second time.
const STICK_SET = function () {
  var list = window.__asbSticky;
  if (!list || window.__asbStickyUrl !== location.href) return 0;
  var vh = innerHeight, sy = scrollY, moved = 0;
  for (var j = 0; j < list.length; j++) {
    var c = list[j], el = c.e;
    if (!el.isConnected) continue;
    var nt = c.top - sy, nb = c.bot - sy, shift = 0;
    if (!isNaN(c.t) && nt < c.t) shift = Math.max(0, Math.min(c.t - nt, c.pbot - sy - nb));
    else if (!isNaN(c.b) && nb > vh - c.b) shift = Math.min(0, Math.max(vh - c.b - nb, c.ptop - sy - nt));
    shift = Math.round(shift);
    if (shift !== (el.__asbShift || 0)) {
      if (el.__asbTranslate === undefined) el.__asbTranslate = el.style.translate || "";
      el.style.translate = shift ? "0px " + shift + "px" : el.__asbTranslate;
      el.__asbShift = shift; moved++;
    }
  }
  return moved;
};
// Run right after a picture. With full, the page is searched for sticky elements again.
const STICK_MEASURE = function (full, set) {
  var old = window.__asbSticky, els = [];
  if (full || !old || window.__asbStickyUrl !== location.href) {
    var all = document.body ? document.body.querySelectorAll("*") : [];
    for (var i = 0; i < all.length && i < 4000 && els.length < 60; i++) {
      var e = all[i], cs;
      try { cs = getComputedStyle(e); } catch (x) { continue; }
      if (cs.position !== "sticky") continue;
      // Sticky inside its own scrolling box holds against that box, which this does not model.
      var inner = false;
      for (var p = e.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
        var o = ""; try { o = getComputedStyle(p).overflowY; } catch (x) {}
        if (o === "auto" || o === "scroll" || o === "hidden") { inner = true; break; }
      }
      if (!inner) els.push(e);
    }
    (old || []).forEach(function (c) { if (els.indexOf(c.e) < 0 && c.e.__asbShift) { c.e.style.translate = c.e.__asbTranslate || ""; c.e.__asbShift = 0; } });
  } else els = old.map(function (c) { return c.e; });
  var sy = scrollY, list = [];
  for (var j = 0; j < els.length; j++) {
    var el = els[j];
    if (!el.isConnected || !el.parentElement) continue;
    var st = getComputedStyle(el), prev = el.__asbShift || 0, r = el.getBoundingClientRect(), par = el.parentElement.getBoundingClientRect();
    list.push({ e: el, top: r.top - prev + sy, bot: r.bottom - prev + sy, ptop: par.top + sy, pbot: par.bottom + sy, t: parseFloat(st.top), b: parseFloat(st.bottom) });
  }
  window.__asbSticky = list; window.__asbStickyUrl = location.href;
  return list.length + ":" + set();
};
let hasSticky = true, stickFull = 0;
async function stickBefore() {
  if (!hasSticky) return;
  try { await ev("(" + STICK_SET + ")()"); } catch (e) {}
}
// True when the picture just taken has a sticky element in the wrong place and should be retaken.
// A page without any pays one small script every few seconds and nothing else.
async function stickAfter() {
  const now = Date.now(), full = now - stickFull >= 4000;
  if (!hasSticky && !full) return false;
  let r;
  try { r = String(await ev("(" + STICK_MEASURE + ")(" + full + ", " + STICK_SET + ")")); } catch (e) { return false; }
  if (full) stickFull = now;
  const p = r.split(":");
  hasSticky = p[0] !== "0";
  return +p[1] > 0;
}

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

let vpSpec = null;
async function applyVp() {
  if (!vpSpec) return;
  await send("Emulation.setDeviceMetricsOverride", { width: vpSpec.w, height: vpSpec.h, deviceScaleFactor: vpSpec.dpr, mobile: false });
  await sleep(80);
  // The new size only takes hold at the next paint (see layout): without this the first picture
  // after the agent looked at a phone width is that phone layout, stretched to the pane.
  await layout(); await sleep(40); await layout();
}

const KEYS = { Enter: 13, Backspace: 8, Tab: 9, Escape: 27, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Delete: 46, Home: 36, End: 35, PageUp: 33, PageDown: 34 };

async function history() {
  const r = await send("Page.getNavigationHistory");
  const entries = (r.result && r.result.entries) || [], cur = (r.result && r.result.currentIndex) || 0;
  const first = entries.length && entries[0].url === "about:blank" ? 1 : 0;
  return { entries, cur, canBack: cur > first, canForward: cur < entries.length - 1 };
}

async function nav(url) {
  loading = true; pageErrs = []; hasSticky = true; stickFull = 0;
  const r = await send("Page.navigate", { url });
  if (r.error) { loading = false; throw fail("failed", r.error.message); }
  await settle(20000, 120);
  await sleep(250);
  return r.result && r.result.errorText ? String(r.result.errorText) : "";
}

async function act(a) {
  touch();
  if (a.op === "quit") { setTimeout(quit, 30); return { ok: true }; }
  // The person closed their pane. If the agent has not used the page lately, give its memory
  // back now instead of after the idle wait; where it was is written down for the next open.
  if (a.op === "release") {
    const busy = !!lastAgent && Date.now() - lastAgent.at < 120000;
    if (!busy) setTimeout(quit, 30);
    return { ok: true, released: !busy };
  }
  await ensure();
  const agent = a.agent === true;
  if (agent && a.op === "size") agentVp = { w: clamp(a.w, 320, 1920, 1280), h: clamp(a.h, 240, 1600, 800) };
  const w = agent ? agentVp.w : clamp(a.w, 320, 1920, 1024), h = agent ? agentVp.h : clamp(a.h, 240, 2400, 720);
  // The pane asks for exactly the device pixels it will show (1.25 on a scaled display, under 1
  // when a desktop-width page is shown smaller): a picture drawn at another size is resampled by
  // the person's browser, which is what made text soft.
  const dpr = agent ? 1 : Math.round(Math.min(3, Math.max(0.4, +a.dpr || 1)) * 100) / 100;
  const key = w + "x" + h + "@" + dpr;
  if (key !== vp) {
    vpSpec = { w: w, h: h, dpr: dpr };
    await applyVp();
    vp = key;
  }
  // The browser was just started (an idle exit, a new box): go back to where it was, unless this
  // action is itself going somewhere.
  if (spawned) {
    spawned = false;
    const last = a.op === "goto" || (a.op === "open" && a.url) ? null : readLast();
    if (last && /^https?:/i.test(last.url)) {
      await nav(last.url).catch(() => {});
      if (last.sy > 0) { await layout(); await ev("scrollTo(0, " + clamp(last.sy, 0, 1e7, 0) + ")").catch(() => {}); await sleep(60); }
    }
  }
  if (!agent && a.op === "logs") return { ok: true, logs: pageErrs.slice(-30) };
  let netError = "";
  const before = a.op === "click" || a.op === "fill" || a.op === "key" || a.op === "back" || a.op === "forward" ? await ev("location.href").catch(() => "") : "";
  let x = clamp(a.x, 0, w, 0), y = clamp(a.y, 0, h, 0);
  const extra = {};
  if (agent && a.op === "console") { const lines = logs.splice(0, logs.length); return { ok: true, logs: lines }; }
  if (agent && a.op === "eval") {
    lastAgent = { at: Date.now(), did: "ran a script" };
    const v = await ev(String(a.js || ""), true);
    return { ok: true, value: v === undefined ? "undefined" : typeof v === "string" ? v : JSON.stringify(v) };
  }
  if (agent && a.op === "wait") {
    const t0 = Date.now(), ms = clamp(a.ms, 100, 45000, 10000);
    let found = null;
    while (!found && Date.now() - t0 < ms) {
      await layout();
      found = JSON.parse((await ev("(" + FIND + ")(" + JSON.stringify(String(a.q || "")) + ", false)").catch(() => "null")) || "null");
      if (!found) await sleep(150);
    }
    if (!found) throw fail("timeout", "nothing matching " + JSON.stringify(a.q) + " appeared within " + Math.round(ms / 1000) + " s");
    extra.found = found;
  }
  if ((a.op === "click" || a.op === "fill" || a.op === "hover" || (agent && a.op === "shot")) && a.q !== undefined) {
    await layout();
    const hit = JSON.parse((await ev("(" + FIND + ")(" + JSON.stringify(String(a.q)) + ", true)")) || "null");
    if (!hit) throw fail("not-found", "nothing on the page matches " + JSON.stringify(a.q) + " (try: browser elements)");
    // It was scrolled into view: measure again where it landed.
    await layout();
    const at = JSON.parse((await ev("(function(){var e=window.__asbHit;if(!e)return 'null';var b=e.getBoundingClientRect();return JSON.stringify({x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)})})()")) || "null") || hit;
    x = clamp(at.x, 0, w, 0); y = clamp(at.y, 0, h, 0);
    extra.hit = hit;
  }
  if (a.op === "pick" || a.op === "crop") {
    const out = { ok: true };
    if (a.op === "pick") out.pick = JSON.parse((await ev("(" + PICK + ")(" + clamp(a.i, 0, 5000, 0) + ")")) || "null");
    // A cut of the page for the message, drawn again at two device pixels per page pixel: cut out
    // of the pane's picture it had the pane's resolution, which is under 1 when a desktop page is
    // shown small, and the agent got a blur.
    if (Array.isArray(a.box) && a.box.length === 4) {
      const bx = clamp(a.box[0], 0, w, 0), by = clamp(a.box[1], 0, h, 0);
      const bw = clamp(a.box[2], 2, Math.max(2, w - bx), 2), bh = clamp(a.box[3], 2, Math.max(2, h - by), 2);
      const sc = await ev("JSON.stringify([Math.round(scrollX),Math.round(scrollY)])").then(JSON.parse).catch(() => [0, 0]);
      const k = Math.round(Math.min(2, 1800 / bw, 1800 / bh) * 100) / 100;
      const pic = await send("Page.captureScreenshot", { format: "png", clip: { x: bx + sc[0], y: by + sc[1], width: bw, height: bh, scale: k / dpr } });
      if (!pic.error) { out.crop = pic.result.data; out.cropScale = k; out.cropBox = [bx, by, bw, bh]; }
    }
    return out;
  }
  if (a.op === "goto" || (a.op === "open" && a.url)) netError = await nav(String(a.url));
  else if (a.op === "reload") {
    // A reload keeps the place on the page, as a browser does.
    const at = await ev("Math.round(scrollY)").catch(() => 0);
    loading = true; await send("Page.reload"); await settle(20000, 120);
    if (at > 0) { await sleep(120); await ev("scrollTo(scrollX, " + at + ")").catch(() => {}); await sleep(60); }
  }
  else if (a.op === "back" || a.op === "forward") {
    const hs = await history();
    if (a.op === "back" ? hs.canBack : hs.canForward) {
      const entry = hs.entries[hs.cur + (a.op === "back" ? -1 : 1)];
      await send("Page.navigateToHistoryEntry", { entryId: entry.id });
      await settle(20000, 200);
      if ((await ev("location.href")) === before) { await ev(a.op === "back" ? "history.back()" : "history.forward()"); await settle(20000, 300); }
    }
  } else if (a.op === "click" || a.op === "fill") {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    if (a.op === "fill") {
      const kind = await ev("(" + CLEAR + ")(" + JSON.stringify(String(a.text || "")) + ")");
      if (kind === "not-a-field" || kind === "gone") throw fail("not-a-field", JSON.stringify(a.q) + " is not something that can be typed into");
      if (kind === "no-option") throw fail("not-found", "that list has no option " + JSON.stringify(a.text));
      if (kind === "text" && a.text) await send("Input.insertText", { text: String(a.text).slice(0, 5000) });
      await sleep(80);
    } else await settle(15000, 220);
  } else if (a.op === "hover") {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await sleep(120);
  } else if (agent && a.op === "reset") {
    await send("Network.clearBrowserCookies");
    await ev("try { localStorage.clear(); sessionStorage.clear(); } catch (e) {}").catch(() => {});
    loading = true; await send("Page.reload"); await settle(20000, 120);
  } else if (a.op === "scroll") {
    await send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: clamp(a.dx, -20000, 20000, 0), deltaY: clamp(a.dy, -20000, 20000, 0) });
    await sleep(20);
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
  saveLast(st);
  if (agent) {
    const named = extra.hit ? " " + JSON.stringify(extra.hit.text.slice(0, 40)) : "";
    const did = { goto: "opened " + st.url.replace(/^https?:\/\//, "").slice(0, 60), click: "clicked" + named, fill: "typed into" + named, hover: "pointed at" + named, shot: "looked at the page", text: "read the page", elements: "read the page", scroll: "scrolled", type: "typed", key: "pressed " + a.key, wait: "waited for " + JSON.stringify(String(a.q || "").slice(0, 40)), reload: "reloaded the page", back: "went back", forward: "went forward", reset: "cleared the page's data", size: "resized to " + st.vw + " x " + st.vh }[a.op];
    if (did) lastAgent = { at: Date.now(), did: did };
    // The agent gets words, and a picture only when it asks for one.
    if (a.op === "text" || a.op === "elements") await layout();
    const out = Object.assign({ ok: true, url: st.url, title: st.title, vw: st.vw, vh: st.vh, sy: st.sy, dh: st.dh }, extra);
    if (netError) { out.ok = false; out.code = "net"; out.error = "could not load " + String(a.url) + ": " + netError; return out; }
    if (a.op === "text") { const t = String(await ev("document.body ? document.body.innerText : ''")); out.text = t.length > 20000 ? t.slice(0, 20000) + "\n… (cut)" : t; }
    if (a.op === "elements") out.elements = JSON.parse(await ev("(function(){" + selectorOf + "; return (" + ELEMS + ")(); })()"));
    if (a.op === "shot") {
      await stickBefore();
      const full = a.full === true, fh = Math.min(Math.max(st.dh, st.vh), 8000);
      let clip = full ? { x: 0, y: 0, width: st.vw, height: fh, scale: 1 } : null, size = st.vw + "x" + (full ? fh : st.vh);
      if (a.q !== undefined) {
        // One element, with a little of what is around it.
        const b = JSON.parse(await ev("(function(){var e=window.__asbHit;if(!e)return 'null';var b=e.getBoundingClientRect();return JSON.stringify([Math.round(b.left+scrollX),Math.round(b.top+scrollY),Math.round(b.width),Math.round(b.height)])})()") || "null");
        if (b && b[2] > 0 && b[3] > 0) { clip = { x: Math.max(0, b[0] - 12), y: Math.max(0, b[1] - 12), width: b[2] + 24, height: Math.min(b[3] + 24, 4000), scale: 1 }; size = clip.width + "x" + clip.height; }
      }
      const snap = () => send("Page.captureScreenshot", clip ? { format: "png", clip: clip } : { format: "png" });
      let pic = await snap();
      if (!pic.error && (await stickAfter())) pic = await snap();
      if (pic.error && clip) pic = await send("Page.captureScreenshot", { format: "png" });
      if (pic.error) throw fail("failed", pic.error.message);
      out.shot = pic.result.data; out.size = size;
    }
    return out;
  }
  // Back and Forward only change when the page does: a scroll or a look does not ask again.
  if (!hist || (a.op !== "scroll" && a.op !== "shot") || st.url !== histUrl) { hist = await history(); histUrl = st.url; }
  const hs = hist;
  await stickBefore();
  // Extra page above and below what is shown, so a scroll moves at once and the next picture
  // catches up. More in the direction of travel (down, when nobody is scrolling: that is the way
  // people read), so a long scroll does not run into blank page.
  const up = a.op === "scroll" && +a.dy < 0, big = Math.min(1400, Math.round(st.vh * 1.4)), small = Math.min(450, Math.round(st.vh * 0.45));
  const top = Math.max(0, Math.min(st.sy, up ? big : small)), bottom = Math.max(0, Math.min(st.dh - st.vh - st.sy, up ? small : big));
  // Text needs a high quality to keep clean edges; at two device pixels per CSS pixel a lower one reads the same.
  const q = dpr >= 1.75 ? 80 : 86;
  const snap = () => send("Page.captureScreenshot", { format: "jpeg", quality: q, clip: { x: st.sx, y: st.sy - top, width: st.vw, height: st.vh + top + bottom, scale: 1 } });
  let shot = await snap();
  if (!shot.error && (await stickAfter())) shot = await snap();
  let over = [top, bottom];
  if (shot.error) { shot = await send("Page.captureScreenshot", { format: "jpeg", quality: q }); over = [0, 0]; }
  if (shot.error) throw fail("failed", shot.error.message);
  const data = shot.result.data;
  const hash = crypto.createHash("md5").update(data).digest("hex").slice(0, 16);
  const out = Object.assign({ ok: true, canBack: hs.canBack, canForward: hs.canForward, blank: st.url === "about:blank", loading, hash, dpr, over }, st);
  if (netError) { out.netError = netError; out.tried = String(a.url); }
  if (out.blank) out.ports = ports();
  if (pageErrs.length) out.errs = pageErrs.length;
  if (lastAgent && Date.now() - lastAgent.at < 60000) out.agent = { ago: Date.now() - lastAgent.at, did: lastAgent.did };
  // The picture the caller already has is not sent again, whatever the action was.
  if (a.have && a.have === hash) out.same = true; else out.shot = data;
  if (a.map) { try { out.map = JSON.parse(await ev(MAP)); } catch (e) { out.map = []; } }
  return out;
}

let chain = Promise.resolve();
function serve() {
// A page loaded IN this browser can reach 127.0.0.1 too, and a page is not to be trusted: without
// a check, any site could post "go to this address" here. So a request must not come from a page
// (no Origin, the right Host) and must carry the token only a process in the box can read.
TOKEN = crypto.randomBytes(24).toString("hex");
const server = http.createServer((req, res) => {
  const host = String(req.headers.host || "");
  const refuse = (status, code) => { res.statusCode = status; res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ ok: false, code: code, error: code })); };
  if (req.headers.origin || req.headers["sec-fetch-site"] || (host !== "127.0.0.1:" + PORT && host !== "localhost:" + PORT)) return refuse(403, "forbidden");
  if (req.method !== "POST") { res.end(JSON.stringify({ v: V })); return; }
  if (req.headers["x-asb-browser"] !== TOKEN) return refuse(403, "forbidden");
  // A caller built for another version of this file asks to be told, so it can replace this one.
  if (req.headers["x-asb-v"] && req.headers["x-asb-v"] !== V) return refuse(409, "stale");
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
});
// The token is written once this helper really owns the port. Two starts can race (the pane and
// the agent's command, a moment apart): the loser used to overwrite the token and then fail to
// listen, which left the winner refusing every caller as "forbidden" until it idled out.
server.on("error", () => process.exit(0));
server.listen(PORT, "127.0.0.1", () => {
  try { fs.mkdirSync(HOME_DIR, { recursive: true }); fs.writeFileSync(TOKEN_FILE, TOKEN, { mode: 0o600 }); fs.chmodSync(TOKEN_FILE, 0o600); } catch (e) {}
});
touch();
}

// ---- the agent's command: browser <verb> ... ----
const HELP = [
  "browser: the page you and the person both see. It runs in this sandbox, so localhost is your dev server.",
  "",
  "  browser open <url>            go to a page (browser open localhost:3000)",
  "  browser shot [--full] [--of <target>] [file]",
  "                                save a picture (the screen, the whole page, or one element);",
  "                                open the file with Read to look at it",
  "  browser text                  the words on the page",
  "  browser elements              what can be clicked or typed into, each with its selector",
  "  browser click <target>        target is a CSS selector or the visible words (browser click \"Sign in\")",
  "  browser fill <target> <text>  replace a field's content; picks an option in a list",
  "  browser type <text>           type into whatever has focus",
  "  browser hover <target>        move the pointer over it (menus, tooltips)",
  "  browser key <Enter|Tab|Escape|ArrowDown|Backspace|...>",
  "  browser wait <target> [secs]  wait until it is on the page (default 10); fails if it never shows",
  "  browser scroll <pixels>       down, or negative for up",
  "  browser eval <javascript>     run in the page and print the result",
  "  browser console               what the page logged, threw or failed to load since you last asked",
  "  browser back | forward | reload | url",
  "  browser reset                 forget cookies and stored data, then reload (a signed-out start)",
  "  browser size <width> <height> the size you see the page at (default 1280 800; 390 844 is a phone)",
  "",
  "Every command prints the page's title and address, and exits non-zero when it fails, so a list of",
  "commands in a script is an end to end test. The person may be watching the same page.",
].join("\n");

async function cli(argv) {
  const U = "http://127.0.0.1:" + PORT + "/";
  const die = (m) => { process.stderr.write("browser: " + m + "\n"); process.exit(1); };
  const ping = async () => { try { return (await (await fetch(U, { signal: AbortSignal.timeout(1200) })).json()).v || ""; } catch (e) { return null; } };
  const token = () => { try { return fs.readFileSync(TOKEN_FILE, "utf8").trim(); } catch (e) { return ""; } };
  const post = async (a, ms) => (await fetch(U, { method: "POST", headers: { "x-asb-browser": token() }, body: JSON.stringify(a), signal: AbortSignal.timeout(ms) })).json();
  const verb = argv[0], rest = argv.slice(1);
  if (!verb || verb === "help" || verb === "--help" || verb === "-h") { process.stdout.write(HELP + "\n"); return; }
  let a = null;
  const addr = (u) => (/^[a-z][a-z0-9+.-]*:\/\//i.test(u) || u === "about:blank" ? u : (/^(localhost|127\.|0\.0\.0\.0|\[|[\w-]+:\d+$)/i.test(u) ? "http://" : "https://") + u);
  if (verb === "open" || verb === "goto") { if (!rest[0]) die("open needs an address"); a = { op: "goto", url: addr(rest[0]) }; }
  else if (verb === "shot" || verb === "screenshot") {
    const full = rest.indexOf("--full") >= 0, at = rest.indexOf("--of");
    a = { op: "shot", full: full };
    if (at >= 0) { if (!rest[at + 1]) die("--of needs a selector or the visible words"); a.q = rest[at + 1]; }
    a.file = rest.filter((x, i) => x !== "--full" && i !== at && (at < 0 || i !== at + 1))[0];
  }
  else if (verb === "hover") { if (!rest[0]) die("hover needs a selector or the visible words"); a = { op: "hover", q: rest.join(" ") }; }
  else if (verb === "reset") a = { op: "reset" };
  else if (verb === "text" || verb === "elements" || verb === "console" || verb === "back" || verb === "forward" || verb === "reload") a = { op: verb };
  else if (verb === "url") a = { op: "url" };
  else if (verb === "click") { if (!rest[0]) die("click needs a selector or the visible words"); a = { op: "click", q: rest.join(" ") }; }
  else if (verb === "fill") { if (rest.length < 2) die("fill needs a target and the text"); a = { op: "fill", q: rest[0], text: rest.slice(1).join(" ") }; }
  else if (verb === "type") { if (!rest.length) die("type needs the text"); a = { op: "type", text: rest.join(" ") }; }
  else if (verb === "key" || verb === "press") { if (!KEYS[rest[0]]) die("unknown key; one of " + Object.keys(KEYS).join(", ")); a = { op: "key", key: rest[0] }; }
  else if (verb === "wait") { if (!rest[0]) die("wait needs a selector or the visible words"); const last = rest[rest.length - 1], secs = rest.length > 1 && /^\d+(\.\d+)?$/.test(last) ? +last : 0; a = { op: "wait", q: (secs ? rest.slice(0, -1) : rest).join(" "), ms: secs ? secs * 1000 : 10000 }; }
  else if (verb === "scroll") a = { op: "scroll", dy: +(rest[0] || 600) || 600, x: 400, y: 300 };
  else if (verb === "eval") { if (!rest.length) die("eval needs some JavaScript"); a = { op: "eval", js: rest.join(" ") }; }
  else if (verb === "size") { if (!(+rest[0] >= 320) || !(+rest[1] >= 240)) die("size needs a width (320 or more) and a height (240 or more)"); a = { op: "size", w: +rest[0], h: +rest[1] }; }
  else if (verb === "quit") a = { op: "quit" };
  else die("unknown command " + JSON.stringify(verb) + ". Run: browser help");
  a.agent = true;

  let v = await ping();
  if (a.op === "quit" && v === null) return;
  if (v !== null && v !== V) { try { await post({ op: "quit" }, 3000); } catch (e) {} await sleep(400); v = null; }
  if (v === null) {
    cp.spawn(process.execPath, [__filename], { detached: true, stdio: "ignore" }).unref();
    for (let i = 0; i < 50 && v === null; i++) { await sleep(100); v = await ping(); }
    if (v === null) die("the browser helper did not start");
  }
  let r;
  try { r = await post(a, 60000); } catch (e) { die(String((e && e.message) || e)); }
  if (r && r.code === "not-installed" && fs.existsSync("/usr/local/bin/asb-moli-install")) {
    process.stderr.write("browser: installing the browser (once, a few seconds)\n");
    cp.spawnSync("/usr/local/bin/asb-moli-install", [], { stdio: "ignore", timeout: 240000 });
    try { r = await post(a, 60000); } catch (e) { die(String((e && e.message) || e)); }
  }
  if (!r || !r.ok) die((r && r.error) || "failed");
  const say = (t) => process.stdout.write(t + "\n");
  const where = (r.title ? r.title + "  " : "") + (r.url || "");
  if (a.op === "console") { if (!r.logs.length) say("(nothing logged)"); r.logs.forEach((l) => say("[" + l.level + "] " + l.text)); return; }
  if (a.op === "eval") { say(r.value); return; }
  if (a.op === "quit") return;
  if (a.op === "text") { say(where); say(""); say(r.text); return; }
  if (a.op === "elements") {
    say(where);
    if (!r.elements.length) say("(nothing to click or type into)");
    r.elements.forEach((e) => say(e.kind + "  " + JSON.stringify(e.text) + (e.value ? "  value=" + JSON.stringify(e.value) : "") + (e.disabled ? "  disabled" : "") + (e.off ? "  off-screen" : "") + "  " + e.sel));
    return;
  }
  if (a.op === "shot") {
    let file = a.file;
    if (!file) {
      const dir = path.join(process.env.TMPDIR || os.tmpdir(), "browser");
      fs.mkdirSync(dir, { recursive: true });
      file = path.join(dir, "shot-" + Date.now().toString(36) + ".png");
      // Pictures nobody named are working copies: keep the newest thirty.
      try {
        const old = fs.readdirSync(dir).filter((f) => /^shot-.*\.png$/.test(f)).map((f) => ({ f: f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((x, y) => y.t - x.t).slice(29);
        old.forEach((o) => { try { fs.unlinkSync(path.join(dir, o.f)); } catch (e) {} });
      } catch (e) {}
    }
    fs.writeFileSync(file, Buffer.from(r.shot, "base64"));
    say("saved " + path.resolve(file) + " (" + r.size + ")  " + where);
    say("Open that file with the Read tool to look at the page.");
    return;
  }
  if (a.op === "click" && r.hit) say("clicked " + r.hit.tag + " " + JSON.stringify(r.hit.text));
  if (a.op === "fill" && r.hit) say("filled " + r.hit.tag + " " + JSON.stringify(r.hit.text));
  if (a.op === "hover" && r.hit) say("over " + r.hit.tag + " " + JSON.stringify(r.hit.text));
  if (a.op === "wait" && r.found) say("there: " + r.found.tag + " " + JSON.stringify(r.found.text));
  say(where + "  (" + r.vw + "x" + r.vh + (r.dh > r.vh ? ", scrolled " + r.sy + " of " + (r.dh - r.vh) : "") + ")");
}

if (process.argv.length > 2) cli(process.argv.slice(2)).then(() => process.exit(0), (e) => { process.stderr.write("browser: " + String((e && e.message) || e) + "\n"); process.exit(1); });
else serve();
`;
