/**
 * Drive the LIVE console in headless Chrome over CDP — no mock, the real controller and a real box
 * with a real agent mid-turn.
 *
 * Answers the questions the mock suite could not: while the agent is genuinely working, do several
 * messages PILE UP in the queue (rather than one replacing another, or being swallowed), does every
 * queued row offer the "send now" button, and does actually clicking it interrupt the live run and
 * deliver that one message?
 *
 *   node test/ui-live.mjs <box> <token> [--send]
 *
 * Without --send it stops before the interrupt (read-only: queue, inspect, then cancel everything).
 * With --send it clicks through the two-click arm on the FIRST queued row, which really does stop
 * the agent's current turn. The run resumes via `claude -c`, so the session survives — but it is a
 * real interruption of real work, hence the explicit flag.
 */
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BOX = process.argv[2];
const TOKEN = process.argv[3];
const DO_SEND = process.argv.includes("--send");
const BASE = "https://agent-sandbox.ajeethkumar.dev";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
if (!BOX || !TOKEN) throw new Error("usage: node test/ui-live.mjs <box> <token> [--send]");

// Three distinct messages: distinct so we can prove the queue keeps all of them, in order, rather
// than collapsing them. The first is the one --send will deliver, so it must be a safe instruction.
const MSGS = [
  "Just a note: no action needed on this message, please carry on with what you were doing.",
  "Second queued note — ignore, this is a queue test.",
  "Third queued note — ignore, this is a queue test.",
];

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "eval failed");
    return r.result.value;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOT_DIR = process.env.TEMP ?? ".";
async function shot(cdp, name) {
  const r = await cdp.send("Page.captureScreenshot", { format: "png" });
  const { writeFile } = await import("node:fs/promises");
  const path = `${SHOT_DIR}\\asb-live-${name}.png`;
  await writeFile(path, Buffer.from(r.data, "base64"));
  console.log(`      shot: ${path}`);
}
async function waitFor(cdp, expr, { timeout = 20000, label = expr } = {}) {
  const t0 = Date.now();
  for (;;) {
    if (await cdp.eval(`!!(${expr})`)) return true;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for: ${label}`);
    await sleep(400);
  }
}

const TEXT = `document.body.innerText`;
// A control inside the queue list, found by its exact label. The row's own prose is split across
// elements by the renderer, so the controls are the reliable handle on "how many rows are there".
const btn = (label) =>
  `[...document.querySelectorAll('button')].filter(b => b.textContent.trim().toLowerCase() === ${JSON.stringify(label)})`;
// One "send now" button per queued row.
const ROWS = btn("send now");
// The queue note as the user reads it, matched against the whole rendered page.
const QUEUE_NOTE = `${TEXT}.includes('delivers when this turn finishes')`;

const api = (path, init = {}) =>
  fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

async function main() {
  const profile = await mkdtemp(join(tmpdir(), "asb-live-"));
  const chrome = spawn(CHROME, [
    "--headless=new",
    "--remote-debugging-port=9337",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--window-size=1400,1000",
    "about:blank",
  ]);
  chrome.stderr.on("data", () => {});

  let wsUrl = "";
  for (let i = 0; i < 60 && !wsUrl; i++) {
    await sleep(300);
    try {
      const list = await fetch("http://127.0.0.1:9337/json/list").then((r) => r.json());
      wsUrl = list.find((t) => t.type === "page")?.webSocketDebuggerUrl ?? "";
    } catch {
      /* not up yet */
    }
  }
  if (!wsUrl) throw new Error("Chrome did not expose a CDP endpoint");
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => {
    ws.addEventListener("open", r);
    ws.addEventListener("error", j);
  });
  const cdp = new Cdp(ws);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  const consoleErrors = [];
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      consoleErrors.push(m.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
    }
  });

  try {
    // The console keeps its bearer token in localStorage; seed it the way the ?token= link does.
    await cdp.send("Page.navigate", { url: `${BASE}/dashboard/` });
    await sleep(1500);
    await cdp.eval(`localStorage.setItem('asb-token',${JSON.stringify(TOKEN)})`);
    await cdp.send("Page.navigate", { url: `${BASE}/dashboard/box/${BOX}` });
    await waitFor(cdp, `${TEXT}.length > 200`, { label: "thread rendered" });
    await sleep(3000);

    const running = await cdp.eval(`${TEXT}.toLowerCase().includes('working') || ${TEXT}.toLowerCase().includes('stop')`);
    check("live thread loaded with the agent mid-turn", running, `box=${BOX}`);
    await shot(cdp, "working");

    // ---- pile-up: three messages typed one after another while the turn is still running --------
    // Real CDP key events, not synthetic DOM events: React's textarea ignores a dispatched
    // KeyboardEvent (no trusted keypress), so a synthetic Enter silently does nothing.
    const already = await cdp.eval(`${ROWS}.length`);
    for (const [i, text] of MSGS.entries()) {
      await cdp.eval(`document.querySelector('textarea').focus()`);
      for (const ch of text) await cdp.send("Input.dispatchKeyEvent", { type: "char", text: ch });
      await sleep(400);
      const typed = await cdp.eval(`document.querySelector('textarea').value`);
      if (typed !== text) throw new Error(`composer did not receive the text (got ${JSON.stringify(typed.slice(0, 40))})`);
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
      // Each send is a round trip to the real controller; give it room before typing the next.
      await waitFor(cdp, `${ROWS}.length >= ${already + i + 1}`, { label: `queued row #${i + 1} rendered` });
      console.log(`      queued #${i + 1}: ${text.slice(0, 40)}…`);
    }

    check("the queue explains itself to the user", await cdp.eval(QUEUE_NOTE), "'delivers when this turn finishes'");
    const rowCount = await cdp.eval(`${ROWS}.length`);
    check("messages PILE UP — all three held, none replaced", rowCount === 3, `rows=${rowCount}`);

    const server = await api(`/inbox.json?session=${BOX}`);
    const queued = server.body.queued ?? [];
    check("the controller holds all three, in order", queued.length === 3, `server queue=${queued.length}`);
    check(
      "queue order matches the order they were typed",
      queued[0]?.text === MSGS[0] && queued[2]?.text === MSGS[2],
      `first="${(queued[0]?.text ?? "").slice(0, 30)}…"`
    );

    const sendNows = await cdp.eval(`${btn("send now")}.length`);
    check("EVERY queued row offers 'send now'", sendNows === 3, `buttons=${sendNows}`);
    const cancels = await cdp.eval(`${btn("cancel")}.length`);
    check("'cancel' is offered alongside it on each row", cancels === 3, `buttons=${cancels}`);
    await shot(cdp, "queued-three");

    // ---- the two-click arm ----------------------------------------------------------------------
    await cdp.eval(`${btn("send now")}[0].click()`);
    await sleep(600);
    const armedLabel = await cdp.eval(`${btn("stop the turn & send?")}.length`);
    check("first click arms a confirmation instead of firing", armedLabel === 1, `armed=${armedLabel}`);
    const stillQueued = (await api(`/inbox.json?session=${BOX}`)).body.queued ?? [];
    check("arming alone does not interrupt the live run", stillQueued.length === 3, `queue=${stillQueued.length}`);
    await shot(cdp, "armed");

    if (!DO_SEND) {
      console.log("\n(read-only mode: not clicking through. Re-run with --send to deliver.)");
    } else {
      const runBefore = (await api(`/watch.json?session=${BOX}`)).body.runState;
      await cdp.eval(`${btn("stop the turn & send?")}[0].click()`);
      check("second click fires while the run was live", runBefore === "running", `runState before=${runBefore}`);

      // The interrupt kills claude, the wrapper records the exit, then the resume starts a new turn.
      let after = {};
      for (let i = 0; i < 40; i++) {
        await sleep(3000);
        after = (await api(`/inbox.json?session=${BOX}`)).body;
        if ((after.queued ?? []).length === 2) break;
      }
      check(
        "the delivered message left the queue — exactly one, the first",
        (after.queued ?? []).length === 2 && after.queued[0]?.text === MSGS[1],
        `queue=${(after.queued ?? []).length}`
      );

      // The queue drains BEFORE the resume wrapper stamps the follow-up into the log, so both of
      // these have to be polled — reading once here races the resume and fails spuriously.
      let w = {};
      for (let i = 0; i < 20; i++) {
        w = (await api(`/watch.json?session=${BOX}`)).body;
        if (String(w.log ?? "").includes(MSGS[0].slice(0, 40))) break;
        await sleep(3000);
      }
      check(
        "the transcript records the interruption",
        String(w.log ?? "").includes("run interrupted by the operator"),
        `runState now=${w.runState}`
      );
      check(
        "the delivered text landed in the transcript as a user turn",
        String(w.log ?? "").includes(MSGS[0].slice(0, 40)),
        ""
      );
      check(
        "the interrupted session kept its context (resumed, not restarted)",
        String(w.log ?? "")
          .slice(String(w.log).indexOf("run interrupted by the operator"))
          .match(/1558|mocha|merge/i) !== null,
        "the resumed turn still refers to the PR it was working on"
      );
      await sleep(4000);
      await shot(cdp, "delivered");
    }

    // ---- clean up: cancel whatever is still queued so no test noise reaches the agent ----------
    const left = (await api(`/inbox.json?session=${BOX}`)).body.queued ?? [];
    for (const m of left) await api(`/inbox.json?session=${BOX}&id=${m.id}`, { method: "DELETE" });
    const drained = (await api(`/inbox.json?session=${BOX}`)).body.queued ?? [];
    check("cleanup: queue drained after the test", drained.length === 0, `queue=${drained.length}`);

    const noisy = consoleErrors.filter((e) => !/favicon|manifest|401|SSE/i.test(e));
    check("no unexpected console errors", noisy.length === 0, noisy.slice(0, 2).join(" | "));
  } finally {
    chrome.kill();
  }

  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(`\nDRIVER ERROR: ${e.message}`);
  process.exit(1);
});
