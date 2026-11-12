/**
 * The browser in the sandbox. Moli (github.com/lexmount/moli) is one static binary that lays pages
 * out and paints them without Chromium: about 100 to 200 MB of memory for a page where a headless
 * Chrome wants 400 and up, which is what makes a browser affordable inside a 1 GB box.
 *
 * Two readers use it. The agent runs it from its shell (`moli fetch ...`). The person in the
 * dashboard gets a pane beside the conversation: the controller sends one action at a time (go,
 * click, scroll, type, pick an element) to a helper inside the box (src/browser-daemon.ts) and gets
 * the page state and a picture back. Because the browser is IN the box, `localhost` is the dev
 * server the agent started, which is the point: look at what it built and point at what is wrong.
 *
 * Nothing here is reachable from outside the box: the helper and Moli's protocol port both listen
 * on the box's loopback, and every action arrives through `msb exec` like any other controller call.
 */
import { createHash } from "node:crypto";
import { BROWSER_DAEMON_SRC } from "./browser-daemon.js";

export const MOLI_VERSION = "1.1.23";
/** sha256 of the release tarball below; a download that does not match is not installed. */
export const MOLI_SHA256 = "df360c04e567ce2e56a8391a03dc677d794465848b5821f944d2de10f3f1f430";
export const MOLI_BIN = "/usr/local/bin/moli";
const MOLI_URL = `https://github.com/lexmount/moli/releases/download/v${MOLI_VERSION}/moli-x86_64-unknown-linux-gnu.tar.gz`;

/**
 * Install the pinned Moli if this exact version is not there yet. Used by the image bake and, for
 * a box born from an older image, on the first open of the browser pane. The archive goes to
 * /var/tmp (the root disk): /tmp in a box is memory, and 150 MB of archive plus binary there would
 * come out of the same 1 GB the agent runs in.
 */
export function moliInstallSh(): string {
  return (
    `if [ "$(${MOLI_BIN} --version 2>/dev/null)" != "moli ${MOLI_VERSION}" ]; then ` +
    `D=/var/tmp/asb-moli.$$ && mkdir -p "$D" && ` +
    `curl -fsSL --retry 2 -o "$D/m.tgz" ${MOLI_URL} && ` +
    `echo "${MOLI_SHA256}  $D/m.tgz" | sha256sum -c - >/dev/null && ` +
    `tar -xzf "$D/m.tgz" -C "$D" && install -m 755 "$D"/moli-v*/moli ${MOLI_BIN}; R=$?; rm -rf "$D"; [ $R -eq 0 ]; fi`
  );
}

/** One line for the agent's standing prompt. States what exists, not what to do with it. */
export const MOLI_PROMPT_HINT =
  "A headless browser may be installed: when `command -v moli` succeeds, `moli fetch --dump markdown <url>` prints a page as text and " +
  "`moli fetch --layout --dump screenshot <url> > page.png` renders it to an image, including a dev server on localhost.";

export const BROWSER_OPS = ["open", "goto", "reload", "back", "forward", "click", "scroll", "type", "key", "shot", "pick", "quit"] as const;
export type BrowserOp = (typeof BROWSER_OPS)[number];

export interface BrowserAction {
  op: BrowserOp;
  w: number;
  h: number;
  dpr: number;
  url?: string;
  x?: number;
  y?: number;
  dx?: number;
  dy?: number;
  text?: string;
  key?: string;
  i?: number;
  have?: string;
  map?: boolean;
}

const num = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/**
 * What a person typed in the address field, as a URL the box may load. Only http and https: the
 * pane is for pages, and `file:` would turn it into a second, unaudited file reader. A bare
 * `localhost:5173` or an IP is http (a dev server has no certificate); a bare domain is https;
 * anything that is not an address at all is a web search.
 */
export function normalizeUrl(input: string): string | null {
  const s = input.trim();
  if (!s || s.length > 2000) return null;
  if (s === "about:blank") return s;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    if (!/^https?:\/\//i.test(s)) return null;
    try {
      return new URL(s).href;
    } catch {
      return null;
    }
  }
  if (/^(javascript|data|file|view-source|chrome|about|blob):/i.test(s)) return null;
  const host = s.split(/[/?#]/)[0];
  const looksLikeHost = !/\s/.test(s) && (/^localhost(:\d+)?$/i.test(host) || /^\[[0-9a-f:]+\](:\d+)?$/i.test(host) || /^[\w-]+(\.[\w-]+)+(:\d+)?$/.test(host) || /^[\w-]+:\d+$/.test(host));
  if (!looksLikeHost) return `https://duckduckgo.com/html/?q=${encodeURIComponent(s)}`;
  const local = /^(localhost|\[[0-9a-f:]+\]|\d{1,3}(\.\d{1,3}){3}|[\w-]+)(:\d+)?$/i.test(host) && !/^[\w-]+(\.[a-z][\w-]*)+(:\d+)?$/i.test(host);
  try {
    return new URL(`${local ? "http" : "https"}://${s}`).href;
  } catch {
    return null;
  }
}

/** The request body as an action the helper may run, or why not. Every field is clamped or dropped. */
export function parseBrowserAction(body: unknown): { ok: true; action: BrowserAction } | { ok: false; message: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const op = b.op as BrowserOp;
  if (typeof op !== "string" || !BROWSER_OPS.includes(op)) return { ok: false, message: "unknown browser action" };
  const action: BrowserAction = { op, w: num(b.w, 320, 1920, 1024), h: num(b.h, 240, 1600, 720), dpr: Number(b.dpr) >= 1.5 ? 2 : 1 };
  if (op === "goto" || (op === "open" && typeof b.url === "string" && b.url)) {
    const url = typeof b.url === "string" ? normalizeUrl(b.url) : null;
    if (!url) return { ok: false, message: "That is not an address this browser can open. Use an http or https address." };
    action.url = url;
  }
  if (op === "click" || op === "scroll") {
    action.x = num(b.x, 0, 1920, 0);
    action.y = num(b.y, 0, 1600, 0);
  }
  if (op === "scroll") {
    action.dx = num(b.dx, -20_000, 20_000, 0);
    action.dy = num(b.dy, -20_000, 20_000, 0);
  }
  if (op === "type") {
    if (typeof b.text !== "string" || !b.text) return { ok: false, message: "nothing to type" };
    action.text = b.text.slice(0, 2000);
  }
  if (op === "key") {
    if (typeof b.key !== "string" || !/^[A-Za-z]{1,12}$/.test(b.key)) return { ok: false, message: "unknown key" };
    action.key = b.key;
  }
  if (op === "pick") action.i = num(b.i, 0, 5000, 0);
  if (op === "shot" && typeof b.have === "string" && /^[0-9a-f]{1,32}$/.test(b.have)) action.have = b.have;
  if (b.map === true) action.map = true;
  return { ok: true, action };
}

/** Changes whenever the helper's source does, so a box running an older helper replaces it. */
export const BROWSER_DAEMON_VERSION = createHash("sha256").update(BROWSER_DAEMON_SRC).digest("hex").slice(0, 12);
const DAEMON_SRC = BROWSER_DAEMON_SRC.replace("@@V@@", BROWSER_DAEMON_VERSION);
const REPLY_MARK = "@@ASB-BROWSER@@";

/**
 * The script one action runs in the box (fed to `node -` on stdin, so nothing about the action is
 * ever a shell word): make sure the current helper is running, hand it the action, print its reply
 * after a marker. Starting the helper is the slow path, taken once per box per idle period.
 */
export function browserStubScript(action: BrowserAction): string {
  return `(async () => {
  const A = ${JSON.stringify(action)}, SRC = ${JSON.stringify(DAEMON_SRC)}, V = ${JSON.stringify(BROWSER_DAEMON_VERSION)};
  const fs = require("fs"), cp = require("child_process"), os = require("os"), path = require("path");
  const U = "http://127.0.0.1:9334/";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const say = (o) => process.stdout.write("\\n${REPLY_MARK}" + JSON.stringify(o) + "\\n");
  const ping = async () => { try { return (await (await fetch(U, { signal: AbortSignal.timeout(1200) })).json()).v || ""; } catch (e) { return null; } };
  const post = async (a, ms) => (await fetch(U, { method: "POST", body: JSON.stringify(a), signal: AbortSignal.timeout(ms) })).json();
  let v = await ping();
  if (A.op === "quit" && v === null) return say({ ok: true });
  if (v !== null && v !== V) { try { await post({ op: "quit" }, 3000); } catch (e) {} await sleep(400); v = null; }
  if (v === null) {
    const dir = path.join(os.homedir(), ".asb");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "browser-daemon.cjs");
    fs.writeFileSync(file, SRC);
    cp.spawn(process.execPath, [file], { detached: true, stdio: "ignore" }).unref();
    for (let i = 0; i < 50 && v === null; i++) { await sleep(100); v = await ping(); }
    if (v === null) return say({ ok: false, code: "no-start", error: "the browser helper did not start" });
  }
  try { say(await post(A, 50000)); } catch (e) { say({ ok: false, code: "failed", error: String((e && e.message) || e).slice(0, 300) }); }
})();
`;
}

export interface BrowserReply {
  ok: boolean;
  code?: string;
  error?: string;
  [k: string]: unknown;
}

/** The helper's reply out of the exec's stdout (a login shell may print before it). */
export function parseBrowserReply(stdout: string): BrowserReply {
  const at = stdout.lastIndexOf(REPLY_MARK);
  if (at < 0) return { ok: false, code: "failed", error: "the sandbox did not answer" };
  try {
    const o = JSON.parse(stdout.slice(at + REPLY_MARK.length).split("\n")[0]) as BrowserReply;
    return o && typeof o === "object" && typeof o.ok === "boolean" ? o : { ok: false, code: "failed", error: "the sandbox sent an unreadable answer" };
  } catch {
    return { ok: false, code: "failed", error: "the sandbox sent an unreadable answer" };
  }
}

/** Per-box queue: actions reach the page in the order the person made them. */
export function makeBoxQueue() {
  const tails = new Map<string, Promise<unknown>>();
  return function enqueue<T>(box: string, fn: () => Promise<T>): Promise<T> {
    const next = (tails.get(box) ?? Promise.resolve()).then(fn, fn);
    const tail = next.catch(() => {});
    tails.set(box, tail);
    void tail.then(() => {
      if (tails.get(box) === tail) tails.delete(box);
    });
    return next;
  };
}
