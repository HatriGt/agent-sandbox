// E2E on the live site: a task on an Instabox box, some work in it, the box put to sleep, the
// MACHINE suspended at the provider's API behind the controller's back (what the free plan's own
// idle pause does), the box woken from the thread, the chat continued.
//   node .shots/live/instabox-provider-shut.mjs [--host=instabox-b] [--base=https://...] [--keep]
// The provider call runs inside the controller container (.shots/live/ibx-api.cjs, copied to
// /app), where the host row's API key lives. Timings land in .shots/live/provider-shut-<ts>.json.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split("=").slice(1).join("=");
const flag = (k) => process.argv.includes(`--${k}`);
const BASE = arg("base", "https://agent-sandbox.ajeethkumar.dev");
const HOST = arg("host", "instabox-b");
const TOKEN = process.env.ASB_TOKEN || readFileSync(".shots/.asb-token", "utf8").trim();
const H = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", "x-requested-with": "agent-sandbox", origin: BASE };
const started = Date.now();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), `+${String(Math.round((Date.now() - started) / 1000)).padStart(4)}s`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = async (method, path, body) => {
  const t0 = Date.now();
  const r = await fetch(BASE + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  return { status: r.status, json, ms: Date.now() - t0 };
};
const get = (p) => call("GET", p);
const post = (p, b) => call("POST", p, b);
const fails = [];
const stats = [];
const stat = (op, ms, note) => { stats.push({ op, ms: Math.round(ms), note }); log(`  [${op}] ${(ms / 1000).toFixed(1)}s${note ? "  " + note : ""}`); };
const check = (ok, what, detail) => { log(ok ? "ok  " : "FAIL", what, detail === undefined ? "" : JSON.stringify(detail).slice(0, 400)); if (!ok) fails.push(what); };
const hostRow = async () => (await get("/hosts.json")).json.hosts?.find((h) => h.id === HOST);
const briefHost = (h) => h && { asleep: h.asleep, unreachable: h.unreachable, prov: h.providerState?.state, running: h.running, lastError: h.lastError };
const fleetView = async (box) => (await get("/fleet.json")).json?.boxes?.find((b) => b.name === box);
const until = async (fn, { every = 3000, max = 300_000 } = {}) => {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < max) {
    last = await fn();
    if (last && last.ok) return { ...last, ms: Date.now() - t0 };
    await sleep(every);
  }
  return { ok: false, timedOut: true, ...last, ms: Date.now() - t0 };
};
const watchText = async (box) => {
  const w = await get(`/watch.json?box=${encodeURIComponent(box)}`);
  return { ...w, text: String(w.json?.log ?? "") };
};
const agentSaid = (text) => { const i = text.lastIndexOf("⟦/you⟧"); return i < 0 ? text : text.slice(i); };
const provider = (verb) => {
  const t0 = Date.now();
  const out = execFileSync("ssh", ["-o", "BatchMode=yes", "hostbrr", `docker exec agent-sandbox node /app/ibx-api.cjs ${HOST} ${verb}`], { encoding: "utf8", timeout: 120_000 }).trim();
  let j;
  try { j = JSON.parse(out.split("\n").pop()); } catch { j = { raw: out.slice(0, 200) }; }
  return { ...j, wall: Date.now() - t0 };
};
const ended = (w) => /^(done|failed|waiting)$/.test(w.json?.runState ?? "");
const WORD = `cw-${Math.random().toString(36).slice(2, 8)}`;

// A turn and its end, read the way the thread page reads it (the hub's snapshot). `mark` is a
// string the agent must print this turn, which tells this turn's end from the previous one's.
async function turn(label, send, mark) {
  const t0 = Date.now();
  const r = await send();
  stat(`${label}: answered`, r.ms, `${r.status} ${JSON.stringify(r.json).slice(0, 100)}`);
  check(r.status === 200, `${label}: accepted`, r.json);
  const over = (w) => ended(w) && agentSaid(w.text).includes(mark);
  const run = await until(async () => { const w = await watchText(r.json?.box ?? send.box); return { ok: w.json?.runState === "running" || over(w), w }; }, { every: 2000, max: 240_000 });
  stat(`${label}: thread shows it running`, Date.now() - t0, `runState=${run.w?.json?.runState} boxStatus=${run.w?.json?.boxStatus}`);
  const done = await until(async () => { const w = await watchText(r.json?.box ?? send.box); return { ok: over(w), w }; }, { every: 2000, max: 480_000 });
  stat(`${label}: turn done`, Date.now() - t0, `runState=${done.w?.json?.runState} exit=${done.w?.json?.exitCode}`);
  check(done.w?.json?.runState === "done" && done.w?.json?.exitCode === 0, `${label}: finished whole`, { runState: done.w?.json?.runState, exit: done.w?.json?.exitCode });
  return { box: r.json?.box, text: done.w?.text ?? "" };
}

let box;
const snapshot = {};
try {
  const h = await hostRow();
  check(!!h && h.enabled && h.provider === "instabox", `host ${HOST} is an enabled Instabox host`, briefHost(h));
  snapshot.before = { controller: briefHost(h), provider: provider("state") };
  log("before:", JSON.stringify(snapshot.before));

  // 1. a task, and some work in the box
  const t1 = await turn(
    "1 task",
    () => post("/delegate.json", { task: `Build a tiny tool: write /workspace/calc/data.txt with the numbers 4, 8, 15, 16, 23 (one per line) and /workspace/calc/stats.py that reads it and prints count, sum and mean. Run it and print its output. Remember this code word for later, you will be asked for it: ${WORD}. Print "STEP1-DONE" at the end. No questions.`, host: HOST }),
    "STEP1-DONE"
  );
  box = t1.box;
  if (!box) throw new Error("no box");
  const v1 = await fleetView(box);
  check(v1?.host === HOST, "1: the box is on the chosen host", v1 && { host: v1.host, boxStatus: v1.boxStatus });
  check(/mean/i.test(agentSaid(t1.text)), "1: the tool ran and printed a mean", agentSaid(t1.text).slice(-200));

  // 2. more work in the same box
  const send2 = () => post("/resume.json", { session: box, message: "Add a median to stats.py, append 42 and 7 to data.txt, run it again and print the output. Print \"STEP2-DONE\" at the end. No questions." });
  send2.box = box;
  const t2 = await turn("2 more work", send2, "STEP2-DONE");
  check(/median/i.test(agentSaid(t2.text)), "2: the median is there", agentSaid(t2.text).slice(-200));

  // 3. the box is put to sleep from the thread
  let t0 = Date.now();
  let r = await post("/sleep.json", { box });
  stat("3 sleep.json answered", r.ms, `${r.status} ${JSON.stringify(r.json).slice(0, 80)}`);
  check(r.status === 200, "3: sleep accepted", r.json);
  const s = await until(async () => { const v = await fleetView(box); return { ok: /stopped/i.test(v?.boxStatus ?? ""), v }; }, { max: 120_000 });
  stat("3 fleet shows the box asleep", Date.now() - t0, `boxStatus=${s.v?.boxStatus}`);
  check(s.ok, "3: the fleet lists the box as Stopped", s.v && { boxStatus: s.v.boxStatus });

  // 4. the MACHINE is suspended at the provider, behind the controller's back
  log("controller before the provider suspend:", JSON.stringify(briefHost(await hostRow())));
  const sus = provider("suspend");
  stat("4 provider suspend (API, direct)", sus.wall, JSON.stringify(sus));
  check(/suspended/.test(sus.state ?? ""), "4: the machine is suspended at the provider", sus);
  // What the controller makes of it over the next while: does it notice, and what does it say?
  t0 = Date.now();
  const noticed = await until(async () => { const h = await hostRow(); return { ok: h?.providerState?.state === "paused" || h?.asleep === true || h?.unreachable === true, h }; }, { every: 5000, max: 150_000 });
  stat("4 controller notices the suspend", noticed.ms, JSON.stringify(briefHost(noticed.h)) + (noticed.timedOut ? " (never, within the wait)" : ""));
  snapshot.afterSuspend = briefHost(noticed.h);
  const fv = await fleetView(box);
  log("fleet row now:", JSON.stringify(fv && { boxStatus: fv.boxStatus, runState: fv.runState, host: fv.host, absent: fv.absent }));
  const w4 = await watchText(box);
  stat("4 watch.json while suspended", w4.ms, `boxStatus=${w4.json?.boxStatus} runState=${w4.json?.runState}`);
  check(w4.json?.boxStatus !== "missing" && w4.text.length > 0, "4: the thread still reads (no 'missing' machine, transcript present)", { boxStatus: w4.json?.boxStatus, chars: w4.text.length });

  // 5. wake the box from the thread
  t0 = Date.now();
  r = await post("/wake.json", { box });
  stat("5 wake.json answered", r.ms, `${r.status} ${JSON.stringify(r.json).slice(0, 120)}`);
  check(r.status === 200, "5: the wake was accepted", r.json);
  const live = await until(async () => { const w = await watchText(box); return { ok: /running/i.test(w.json?.boxStatus ?? ""), w }; }, { every: 2000, max: 180_000 });
  stat("5 thread reads the box awake", Date.now() - t0, `boxStatus=${live.w?.json?.boxStatus} runState=${live.w?.json?.runState}`);
  check(live.ok, "5: the box is up again", live.w?.json?.boxStatus);
  log("host after wake:", JSON.stringify(briefHost(await hostRow())), "provider:", JSON.stringify(provider("state")));

  // 6. continue the chat: memory of the session AND the files
  const send6 = () => post("/resume.json", { session: box, message: "Without reading any file: what was the code word I gave you in my first message? Say it on its own line as CODEWORD=<word>. Then run stats.py once more and print its output. Print \"STEP3-DONE\" at the end." });
  send6.box = box;
  const t6 = await turn("6 continue the chat", send6, "STEP3-DONE");
  const said = agentSaid(t6.text);
  check(new RegExp(`CODEWORD=\\s*${WORD}`).test(said), "6: the agent remembered the code word (session survived the sleep and the suspend)", said.slice(-300));
  check(/median/i.test(said), "6: the files survived (the median tool still runs)", said.slice(-200));
} catch (e) {
  check(false, `aborted: ${e.message}`);
} finally {
  if (box && !flag("keep")) {
    const t = await post("/teardown.json", { box });
    stat("7 teardown answered", t.ms, `${t.status} ${t.json?.error ?? "ok"}`);
    check(t.status === 200, "7: teardown accepted", t.json);
  } else if (box) log("kept box:", box);
  snapshot.after = { controller: briefHost(await hostRow()), provider: provider("state") };
  log("after:", JSON.stringify(snapshot.after));
  const out = `.shots/live/provider-shut-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`;
  writeFileSync(out, JSON.stringify({ host: HOST, box, word: WORD, stats, fails, snapshot }, null, 2));
  console.log("\nop                                              seconds  note");
  for (const s of stats) console.log(`${s.op.padEnd(48)}${(s.ms / 1000).toFixed(1).padStart(7)}  ${s.note ?? ""}`);
  log(fails.length ? `FAILED: ${fails.join("; ")}` : "ALL PASS", "->", out);
}
process.exit(fails.length ? 1 : 0);
