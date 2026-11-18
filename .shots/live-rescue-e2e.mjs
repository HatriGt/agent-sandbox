// Live end-to-end for rescue copies (src/rescue.ts) against the public controller, as the operator.
//   ASB_TOKEN=<operator bearer> node .shots/live-rescue-e2e.mjs run
//       → delegates a tiny task that plants a code word, waits for done, prints the box and host.
//   (remove the box by hand on its host: msb rm --force <box>; check keep/<box> first)
//   ASB_TOKEN=<operator bearer> node .shots/live-rescue-e2e.mjs restore --box=<box> --word=<word>
//       → waits for the fleet to drop the box, GET /rescue.json says a copy is kept and the box is
//         absent, POST /rescue/restore.json brings it back, a /resume.json asks for the code word and
//         the planted file, the answer must carry both, then teardown.
const flags = process.argv.slice(2);
const flag = (k, d) => flags.find((f) => f.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const BASE = flag("base", "https://agent-sandbox.ajeethkumar.dev");
const phase = flags.find((f) => !f.startsWith("--")) ?? "run";
const TOKEN = process.env.ASB_TOKEN;
if (!TOKEN) throw new Error("ASB_TOKEN is required");
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const fails = [];
const check = (ok, what, extra) => {
  log(ok ? "PASS" : "FAIL", what, extra !== undefined ? JSON.stringify(extra).slice(0, 500) : "");
  if (!ok) fails.push(what);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, path, body) {
  const headers = { "content-type": "application/json", authorization: `Bearer ${TOKEN}`, "x-requested-with": "agent-sandbox", origin: BASE };
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (text.includes(TOKEN)) check(false, `the token was echoed by ${method} ${path}`);
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, json, text };
}
const fleetView = async (box) => ((await call("GET", "/fleet.json")).json?.boxes ?? []).find((b) => b.name === box);
async function waitDone(box, maxPolls = 45) {
  let view;
  for (let i = 0; i < maxPolls; i++) {
    await sleep(8000);
    view = await fleetView(box);
    if (view && /done|failed|waiting/.test(view.runState ?? "")) break;
  }
  return view;
}

if (phase === "run") {
  const word = `turquoise-walrus-${Date.now().toString(36)}`;
  const t0 = Date.now();
  const r = await call("POST", "/delegate.json", {
    task: `Remember this code word for later in our conversation: ${word}. Write exactly that code word into /workspace/rescue-marker.txt, then reply with one line confirming you have remembered it (do not repeat the word). Nothing else. (rescue e2e)`,
  });
  const box = r.json?.box;
  check(r.status === 200 && typeof box === "string", `delegate started a run (${Math.round((Date.now() - t0) / 1000)}s)`, { status: r.status, box, error: r.json?.error });
  if (!box) process.exit(1);
  const view = await waitDone(box);
  check(view?.runState === "done", `the run finished (${Math.round((Date.now() - t0) / 1000)}s)`, view && { host: view.host, runState: view.runState, exitCode: view.exitCode });
  // The copy is pulled right after the turn-end checkpoint; give it a moment, then ask the API.
  let rescue;
  for (let i = 0; i < 12; i++) {
    await sleep(5000);
    rescue = (await call("GET", `/rescue.json?box=${box}`)).json;
    if (rescue?.rescue) break;
  }
  check(!!rescue?.rescue && rescue.present === true, "GET /rescue.json: a copy is kept and the box is present", rescue);
  console.log(`\nBOX=${box}\nHOST=${view?.host ?? ""}\nWORD=${word}\n`);
  process.exit(fails.length ? 1 : 0);
}

if (phase === "restore") {
  const box = flag("box");
  const word = flag("word");
  if (!box || !word) throw new Error("--box and --word are required");
  // The fleet sweep must have noticed the removal first.
  let present = true;
  for (let i = 0; i < 20 && present; i++) {
    await sleep(6000);
    present = !!(await fleetView(box));
  }
  check(!present, "the fleet no longer lists the removed box");
  let r = await call("GET", `/rescue.json?box=${box}`);
  check(r.status === 200 && r.json?.rescue && r.json.present === false, "GET /rescue.json: a copy is kept, the box is gone", r.json);
  const turn = r.json?.rescue?.turn;
  const t0 = Date.now();
  r = await call("POST", "/rescue/restore.json", { box });
  check(r.status === 200 && r.json?.ok === true && r.json.box === box, `POST /rescue/restore.json brought it back (${Math.round((Date.now() - t0) / 1000)}s)`, r.json);
  if (r.status !== 200) process.exit(1);
  let view;
  for (let i = 0; i < 10 && !view; i++) {
    await sleep(5000);
    view = await fleetView(box);
  }
  check(!!view, "the fleet lists the restored box again", view && { host: view.host, runState: view.runState, task: (view.task ?? "").slice(0, 60) });
  r = await call("GET", `/rescue.json?box=${box}`);
  check(r.json?.present === true, "GET /rescue.json: present again", r.json?.present);
  // Continuity: the same session must still know the code word, and the file must be there.
  const t1 = Date.now();
  r = await call("POST", "/resume.json", { box, message: "Two things, each on its own line: first, the code word I asked you to remember earlier in this conversation; second, the exact contents of /workspace/rescue-marker.txt. Nothing else." });
  check(r.status === 200, `POST /resume.json accepted (${r.status})`, r.json?.error);
  view = await waitDone(box, 30);
  check(view?.runState === "done", `the resumed turn finished (${Math.round((Date.now() - t1) / 1000)}s)`, view && { runState: view.runState, exitCode: view.exitCode });
  const w = (await call("GET", `/watch.json?box=${box}`)).json;
  const logText = w?.log ?? "";
  const seam = logText.indexOf("brought back from a copy taken after turn");
  check(seam >= 0, `the log carries the restore seam (turn ${turn})`);
  const after = seam >= 0 ? logText.slice(seam) : logText;
  const hits = after.split(word).length - 1;
  check(hits >= 2, `the answer after the seam names the code word from memory and from the file (${hits} mentions)`, after.slice(-600));
  const t = await call("POST", "/teardown.json", { box });
  check(t.status === 200, "teardown", t.json?.error);
  r = await call("GET", `/rescue.json?box=${box}`);
  check(r.status === 200 && r.json?.rescue === null, "the copy went with the teardown", r.json);
  console.log(fails.length ? `\n${fails.length} FAILED:\n - ${fails.join("\n - ")}` : "\nALL PASS");
  process.exit(fails.length ? 1 : 0);
}
