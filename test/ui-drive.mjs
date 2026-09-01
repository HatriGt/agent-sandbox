/**
 * Drive the real built console in headless Chrome over CDP, against test/ui-mock-server.mjs.
 *
 * Verifies the "send now" flow end to end in the actual UI: a message typed while the agent is
 * mid-turn appears as a queued row; that row offers "send now"; the first click arms it; the second
 * calls /send-now.json, which removes it from the queue and resumes the agent with it.
 *
 * No test framework and no browser-automation dependency: Node's built-in WebSocket speaks CDP to a
 * headless Chrome we spawn ourselves.
 *   node test/ui-drive.mjs [port]
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.argv[2] ?? 8799);
const BASE = `http://127.0.0.1:${PORT}`;
const BOX = "pool-1788256499900-jnq6ys";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

// ---- minimal CDP client -------------------------------------------------------------------------
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

// Screenshots of the states this change is about, for the record.
const SHOT_DIR = process.env.TEMP ?? ".";
async function shot(cdp, name) {
  const r = await cdp.send("Page.captureScreenshot", { format: "png" });
  const { writeFile } = await import("node:fs/promises");
  const path = `${SHOT_DIR}\\asb-send-now-${name}.png`;
  await writeFile(path, Buffer.from(r.data, "base64"));
  console.log(`      shot: ${path}`);
}
async function waitFor(cdp, expr, { timeout = 15000, label = expr } = {}) {
  const t0 = Date.now();
  for (;;) {
    if (await cdp.eval(`!!(${expr})`)) return true;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for: ${label}`);
    await sleep(250);
  }
}

// Page helpers expressed in the page's own DOM, so we assert what a user would see.
const TEXT = `document.body.innerText`;
const findByText = (text, tag = "*") =>
  `[...document.querySelectorAll('${tag}')].filter(e => e.textContent.trim().toLowerCase() === ${JSON.stringify(text.toLowerCase())} && !e.querySelector('${tag}'))[0]`;

async function main() {
  const profile = await mkdtemp(join(tmpdir(), "asb-ui-"));
  const chrome = spawn(CHROME, [
    "--headless=new",
    "--remote-debugging-port=9333",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--window-size=1280,900",
    "about:blank",
  ]);
  chrome.stderr.on("data", () => {});

  // Wait for the debugger, then attach to the first page target.
  let wsUrl = "";
  for (let i = 0; i < 60 && !wsUrl; i++) {
    await sleep(300);
    try {
      const list = await fetch("http://127.0.0.1:9333/json/list").then((r) => r.json());
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
    // Seed the bearer token the console expects, then load the box thread.
    await cdp.send("Page.navigate", { url: BASE });
    await sleep(1200);
    await cdp.eval(`localStorage.setItem('asb-token','test-operator-token')`);
    await cdp.send("Page.navigate", { url: `${BASE}/dashboard/box/${BOX}` });
    await waitFor(cdp, `${TEXT}.includes('2319')`, { label: "thread loaded (task text visible)" });
    check("thread loads for a running box", true, "task and transcript rendered");

    // The agent is mid-turn: the composer should queue, not send.
    const composer = `document.querySelector('textarea')`;
    await waitFor(cdp, composer, { label: "composer present" });
    const MSG = "guess the runners are not available. skip waiting for it and continue with comment";
    await cdp.eval(`(() => {
      const ta = ${composer};
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
      set.call(ta, ${JSON.stringify(MSG)});
      ta.dispatchEvent(new Event('input',{bubbles:true}));
      return ta.value.length;
    })()`);
    await sleep(200);
    // Submit with Enter (the console's send key).
    await cdp.eval(`(() => {
      const ta = ${composer}; ta.focus();
      ta.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}));
      return true;
    })()`);

    await waitFor(cdp, `${TEXT}.includes('delivers when this turn finishes')`, { label: "queued row appears" });
    check("a message sent mid-turn shows as queued", true, "'Queued · delivers when this turn finishes' rendered");

    const srvQueue = await fetch(`${BASE}/__state`).then((r) => r.json());
    check("controller holds it in the inbox", srvQueue.queue.length === 1, `queue=${JSON.stringify(srvQueue.queue.map((m) => m.id))}`);

    // The new affordance.
    await waitFor(cdp, findByText("send now", "button"), { label: "'send now' button" });
    check("'send now' is offered on the queued row", true);
    await shot(cdp, "queued");

    const hasCancel = await cdp.eval(`!!${findByText("cancel", "button")}`);
    check("'cancel' is still offered alongside it", hasCancel);

    // First click arms (two-step, because it stops a live turn).
    await cdp.eval(`${findByText("send now", "button")}.click()`);
    await waitFor(cdp, `${TEXT}.toLowerCase().includes('stop the turn')`, { label: "armed confirm label" });
    check("first click arms a confirmation instead of firing", true, "label becomes 'stop the turn & send?'");
    await shot(cdp, "armed");

    const notYet = await fetch(`${BASE}/__state`).then((r) => r.json());
    check("arming alone does not interrupt the run", notYet.interrupted === null && notYet.queue.length === 1);

    // Second click fires.
    await cdp.eval(`${findByText("stop the turn & send?", "button")}.click()`);
    // The queued ROW is gone. (Don't test for the word "queued" anywhere on the page — the composer's
    // own mode chip says "Queue for agent" and its hint mentions queueing, both legitimately.)
    await waitFor(cdp, `!${TEXT}.includes('delivers when this turn finishes')`, { timeout: 20000, label: "queued row clears" });

    const after = await fetch(`${BASE}/__state`).then((r) => r.json());
    check("second click calls /send-now.json", after.interrupted !== null, after.interrupted ? `interrupted id=${after.interrupted.id}` : "no interrupt recorded");
    check("the message leaves the queue exactly once", after.queue.length === 0, `queue=${JSON.stringify(after.queue)}`);
    check("the interrupted turn resumed with that text", (after.interrupted?.text ?? "") === MSG);
    check("the transcript records the interruption", after.log.includes("run interrupted by the operator"), "log line present");

    await waitFor(cdp, `${TEXT}.includes('Turn interrupted') || ${TEXT}.toLowerCase().includes('skipping the wait')`, { timeout: 20000, label: "delivery visible in the thread" });
    check("the delivered message and reply appear in the thread", true);

    // A stale row (already delivered) must fail cleanly, not wedge the UI.
    const stale = await fetch(`${BASE}/send-now.json`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session: BOX, id: "q999" }),
    });
    check("send-now on a vanished message is a clean 404", stale.status === 404, `status=${stale.status}`);

    // Idle box: nothing to interrupt, so the affordance should be gone.
    await fetch(`${BASE}/__set-run-state?v=done`);
    await sleep(2500);
    const goneWhenIdle = await cdp.eval(`!${findByText("send now", "button")}`);
    check("'send now' is not offered when no turn is running", goneWhenIdle);

    const realErrors = consoleErrors.filter((e) => !/Content Security Policy|favicon|401/i.test(e));
    check("no unexpected console errors during the flow", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));

    await shot(cdp, "delivered");
  } finally {
    ws.close();
    chrome.kill();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error("driver error:", e.message);
  process.exit(2);
});
