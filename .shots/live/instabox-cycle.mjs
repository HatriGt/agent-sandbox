// The real user's day on an Instabox host, against production, timed step by step.
//   node .shots/live/instabox-cycle.mjs [--host=instabox-b] [--base=https://...] [--nap] [--keep]
//
//   1. a task starts on the host (delegate with host=<id>)        -> delegate answered, run done
//   2. the box is put to sleep (POST /sleep.json, the thread's Sleep)  -> answered, fleet shows Stopped
//   3. a reply brings it back and continues the work (POST /resume.json) -> answered, running, done
//   4. the host is paused at the provider (Fleet view's Pause)      -> answered, provider says paused
//   5. a reply on the paused host continues the work                -> answered, running, done
//   6. box asleep + host paused, then the thread is opened (POST /wake.json) -> answered, watch live
//   7. one more reply, then (--nap) wait for the controller's own idle nap
//   8. teardown (never with --keep)
// Each turn appends a line to /workspace/journal/log.md; every later turn must still see the earlier
// lines, which proves the work survived the sleep. Timings land in .shots/live/instabox-cycle-<ts>.json.
import { readFileSync, writeFileSync } from "node:fs";
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
const briefHost = (h) => h && { asleep: h.asleep, unreachable: h.unreachable, prov: h.providerState?.state, running: h.running, reserved: h.reserved, lastError: h.lastError };
const fleetView = async (box) => (await get("/fleet.json")).json?.boxes?.find((b) => b.name === box);
const until = async (what, fn, { every = 3000, max = 300_000 } = {}) => {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < max) {
    last = await fn();
    if (last && last.ok) return { ...last, ms: Date.now() - t0 };
    await sleep(every);
  }
  return { ok: false, timedOut: true, last, ms: Date.now() - t0 };
};
const runStateOf = (v) => v?.runState ?? "";
const ended = (v) => /^(done|failed|waiting)$/.test(runStateOf(v));
const watchText = async (box) => {
  const w = await get(`/watch.json?box=${encodeURIComponent(box)}&lines=400`);
  return { ...w, text: String(w.json?.log ?? "") };
};
const word = (n) => `w${n}-${Math.random().toString(36).slice(2, 8)}`;
const words = [];
const journalTask = (n, extra = "") => {
  words[n] = word(n);
  return `Append the line "turn ${n}: ${words[n]}" to /workspace/journal/log.md (create the directory and file on the first turn). Then print the whole file with \`cat\` and print \`hostname\`. ${extra}Finish right after that; no questions.`;
};
// Only what the agent printed after the last message it was sent: the message itself names the word.
const agentSaid = (text) => { const i = text.lastIndexOf("⟦/you⟧"); return i < 0 ? text : text.slice(i); };
const sawAllWords = (text, upto) => words.slice(1, upto + 1).every((w) => agentSaid(text).includes(w));

// A turn that is sent to a thread (reply) and watched until it ends.
async function reply(box, n, label, extra) {
  const t0 = Date.now();
  const r = await post("/resume.json", { session: box, message: journalTask(n, extra) });
  stat(`${label}: reply answered`, r.ms, `${r.status} ${JSON.stringify(r.json).slice(0, 120)}`);
  check(r.status === 200, `${label}: the reply was accepted`, r.json);
  // The thread page reads /watch.json: the turn is running once the snapshot says so, or over once
  // the agent printed this turn's word after the message. The fleet still says "done" from the
  // previous turn for a sweep or two, so it is not the thing to watch here.
  const turnOver = (w) => /^(done|failed|waiting)$/.test(w.json?.runState ?? "") && agentSaid(w.text).includes(words[n]);
  const run = await until("running", async () => { const w = await watchText(box); return { ok: w.json?.runState === "running" || turnOver(w), w }; }, { every: 2000, max: 240_000 });
  stat(`${label}: thread shows the turn running`, Date.now() - t0, `runState=${run.w?.json?.runState} boxStatus=${run.w?.json?.boxStatus}`);
  const done = await until("ended", async () => { const w = await watchText(box); return { ok: turnOver(w), w }; }, { every: 2000, max: 420_000 });
  stat(`${label}: turn done`, Date.now() - t0, `runState=${done.w?.json?.runState} exit=${done.w?.json?.exitCode}`);
  check(done.w?.json?.runState === "done", `${label}: the turn finished`, { runState: done.w?.json?.runState, exit: done.w?.json?.exitCode });
  const w = done.w ?? (await watchText(box));
  check(sawAllWords(w.text, n), `${label}: the agent printed every earlier line (work survived)`, { want: words.slice(1, n + 1), tail: agentSaid(w.text).slice(-300) });
  const v = await fleetView(box);
  const settled = await until("fleet done", async () => { const v = await fleetView(box); return { ok: ended(v), v }; }, { every: 3000, max: 60_000 });
  stat(`${label}: fleet shows the turn done`, Date.now() - t0, `runState=${runStateOf(settled.v)} host=${settled.v?.host}`);
  return settled.v ?? v;
}

let box;
const snapshot = {};
try {
  const h0 = await get("/hosts.json");
  stat("hosts.json read", h0.ms);
  const target = h0.json.hosts?.find((h) => h.id === HOST);
  check(!!target && target.enabled && target.provider === "instabox", `host ${HOST} is an enabled Instabox host`, briefHost(target));
  if (!target) throw new Error("no host");
  snapshot.before = briefHost(target);
  log("host before:", JSON.stringify(snapshot.before));
  if (target.prepare?.running) throw new Error("the host is being prepared; try later");

  // 1. a task starts on the host
  let t0 = Date.now();
  let r = await post("/delegate.json", { task: journalTask(1, "This is a timing proof on an Instabox host. "), host: HOST });
  box = r.json?.box;
  stat("1 delegate answered", r.ms, `${r.status} ${box ?? JSON.stringify(r.json).slice(0, 200)}`);
  check(r.status === 200 && !!box, "1: a run started on the host", r.json?.error ?? box);
  if (!box) throw new Error("no box");
  const listed = await until("listed", async () => { const v = await fleetView(box); return { ok: !!v, v }; }, { max: 120_000 });
  stat("1 fleet lists the box", Date.now() - t0, `host=${listed.v?.host} boxStatus=${listed.v?.boxStatus} runState=${runStateOf(listed.v)}`);
  const d1 = await until("ended", async () => { const v = await fleetView(box); return { ok: ended(v), v }; }, { max: 420_000 });
  stat("1 run done", Date.now() - t0, `runState=${runStateOf(d1.v)} exit=${d1.v?.exitCode} host=${d1.v?.host}`);
  check(d1.v?.host === HOST, "1: the box lives on the chosen host", d1.v?.host);
  check(runStateOf(d1.v) === "done", "1: the first turn finished", { runState: runStateOf(d1.v), exit: d1.v?.exitCode });
  let w = await watchText(box);
  stat("1 watch.json read (live box)", w.ms, `boxStatus=${w.json?.boxStatus}`);
  check(sawAllWords(w.text, 1), "1: the agent printed the line it wrote", w.text.slice(-300));
  log("host after turn 1:", JSON.stringify(briefHost(await hostRow())));

  // 2. the box is put to sleep
  t0 = Date.now();
  r = await post("/sleep.json", { box });
  stat("2 sleep.json answered", r.ms, `${r.status} ${JSON.stringify(r.json).slice(0, 120)}`);
  check(r.status === 200, "2: sleep accepted", r.json);
  const s1 = await until("stopped", async () => { const v = await fleetView(box); return { ok: /stopped/i.test(v?.boxStatus ?? ""), v }; }, { max: 120_000 });
  stat("2 fleet shows the box asleep", Date.now() - t0, `boxStatus=${s1.v?.boxStatus} runState=${runStateOf(s1.v)} sleeping=${JSON.stringify({ kept: s1.v?.kept, claimAge: s1.v?.claimAgeSec, sleepAge: s1.v?.sleepAgeSec })}`);
  check(s1.ok, "2: the fleet lists the box as Stopped", s1.v && { boxStatus: s1.v.boxStatus, runState: s1.v.runState });
  w = await watchText(box);
  stat("2 watch.json read (asleep box)", w.ms, `boxStatus=${w.json?.boxStatus} runState=${w.json?.runState}`);
  check(/stopped/i.test(w.json?.boxStatus ?? ""), "2: the thread reads the box as stopped", w.json?.boxStatus);

  // 3. a reply brings it back
  await reply(box, 2, "3 reply to a sleeping box");
  log("host after turn 2:", JSON.stringify(briefHost(await hostRow())));

  // 4. the host is paused at the provider (operator button)
  t0 = Date.now();
  let p;
  for (let i = 0; i < 8; i++) {
    p = await post("/hosts.json", { action: "pause", id: HOST });
    log(`pause try ${i + 1}: ${p.status} ${p.json?.providerState?.state ?? p.json?.error ?? ""} (${p.ms} ms)`);
    if (p.status === 200) break;
    await sleep(5000);
  }
  stat("4 pause answered", p.ms, `${p.status} ${p.json?.providerState?.state ?? p.json?.error ?? ""}`);
  check(p.status === 200, "4: the pause was accepted", p.json);
  const paused = await until("paused", async () => { const h = await hostRow(); return { ok: h?.providerState?.state === "paused" && h?.asleep === true, h }; }, { every: 4000, max: 180_000 });
  stat("4 host reads paused + asleep", Date.now() - t0, JSON.stringify(briefHost(paused.h)));
  check(paused.ok, "4: the host is paused at the provider and asleep in the pool", briefHost(paused.h));
  const fv = await fleetView(box);
  log("fleet row while the host is paused:", JSON.stringify(fv && { boxStatus: fv.boxStatus, runState: fv.runState, hostAsleep: fv.hostAsleep, dormant: fv.dormant }));
  w = await watchText(box);
  stat("4 watch.json read (paused host)", w.ms, `boxStatus=${w.json?.boxStatus} runState=${w.json?.runState}`);
  check(w.json?.boxStatus !== "missing", "4: a thread on a paused host does not read as a missing machine", w.json?.boxStatus);
  if (flag("extra")) {
    // Sleep on a paused host: nothing to SSH, the box is as asleep as it gets.
    r = await post("/sleep.json", { box });
    stat("4 sleep.json on a paused host", r.ms, `${r.status} ${JSON.stringify(r.json).slice(0, 120)}`);
    check(r.status === 200 && r.json?.hostAsleep === true, "4: sleep on a paused host answers without touching the host", r.json);
  }

  // 5. a reply on the paused host
  await reply(box, 3, "5 reply on a paused host");
  log("host after turn 3:", JSON.stringify(briefHost(await hostRow())));

  // 6. box asleep AND host paused, then the thread is opened (wake)
  t0 = Date.now();
  r = await post("/sleep.json", { box });
  stat("6 sleep.json answered", r.ms, `${r.status}`);
  check(r.status === 200, "6: second sleep accepted", r.json);
  await until("stopped", async () => { const v = await fleetView(box); return { ok: /stopped/i.test(v?.boxStatus ?? ""), v }; }, { max: 120_000 });
  for (let i = 0; i < 8; i++) {
    p = await post("/hosts.json", { action: "pause", id: HOST });
    log(`pause try ${i + 1}: ${p.status} ${p.json?.providerState?.state ?? p.json?.error ?? ""} (${p.ms} ms)`);
    if (p.status === 200) break;
    await sleep(5000);
  }
  const paused2 = await until("paused", async () => { const h = await hostRow(); return { ok: h?.providerState?.state === "paused", h }; }, { every: 4000, max: 180_000 });
  stat("6 box asleep + host paused", Date.now() - t0, JSON.stringify(briefHost(paused2.h)));
  t0 = Date.now();
  r = await post("/wake.json", { box });
  stat("6 wake.json answered (open the thread)", r.ms, `${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);
  check(r.status === 200, "6: the wake was accepted", r.json);
  w = await watchText(box);
  stat("6 watch.json after wake", w.ms, `boxStatus=${w.json?.boxStatus} runState=${w.json?.runState}`);
  check(/running/i.test(w.json?.boxStatus ?? ""), "6: the thread reads the box as running after the wake", w.json?.boxStatus);
  const live = await until("running", async () => { const v = await fleetView(box); return { ok: /running/i.test(v?.boxStatus ?? ""), v }; }, { max: 120_000 });
  stat("6 fleet shows the box awake", Date.now() - t0, `boxStatus=${live.v?.boxStatus}`);
  log("host after wake:", JSON.stringify(briefHost(await hostRow())));

  // 7. one more reply, awake box on an awake host
  if (flag("extra")) {
    // Sleep pressed mid-turn (the command palette offers it): refused, the turn goes on.
    t0 = Date.now();
    r = await post("/resume.json", { session: box, message: journalTask(4) });
    stat("7 reply answered", r.ms, `${r.status}`);
    const mid = await post("/sleep.json", { box });
    stat("7 sleep.json mid-turn", mid.ms, `${mid.status} ${JSON.stringify(mid.json).slice(0, 120)}`);
    check(mid.status === 409, "7: a sleep mid-turn is refused", mid.json);
    const turnOver = (w) => /^(done|failed|waiting)$/.test(w.json?.runState ?? "") && agentSaid(w.text).includes(words[4]);
    const done = await until("ended", async () => { const w = await watchText(box); return { ok: turnOver(w), w }; }, { every: 2000, max: 420_000 });
    stat("7 turn done", Date.now() - t0, `runState=${done.w?.json?.runState} exit=${done.w?.json?.exitCode}`);
    check(done.w?.json?.runState === "done" && done.w?.json?.exitCode === 0, "7: the turn finished whole after the refused sleep", { runState: done.w?.json?.runState, exit: done.w?.json?.exitCode });
    check(sawAllWords(done.w?.text ?? "", 4), "7: the agent printed every earlier line (work survived)", { want: words.slice(1, 5), tail: agentSaid(done.w?.text ?? "").slice(-300) });
  } else await reply(box, 4, "7 reply to an awake box");

  if (flag("nap")) {
    // The controller's own idle nap (MSB_IDLE_TIMEOUT), no call from here.
    t0 = Date.now();
    const nap = await until("napped", async () => { const v = await fleetView(box); return { ok: /stopped/i.test(v?.boxStatus ?? ""), v }; }, { every: 10_000, max: 25 * 60_000 });
    stat("8 idle nap (no call)", Date.now() - t0, `boxStatus=${nap.v?.boxStatus} ${nap.timedOut ? "TIMED OUT" : ""}`);
    check(nap.ok, "8: the box napped on its own", nap.v && { boxStatus: nap.v.boxStatus });
    log("host after nap:", JSON.stringify(briefHost(await hostRow())));
    await reply(box, 5, "8 reply after the idle nap");
  }
} catch (e) {
  check(false, `aborted: ${e.message}`);
} finally {
  if (box && !flag("keep")) {
    const t = await post("/teardown.json", { box });
    stat("9 teardown answered", t.ms, `${t.status} ${t.json?.error ?? "ok"}`);
    check(t.status === 200, "9: teardown accepted", t.json);
    const gone = await until("gone", async () => { const v = await fleetView(box); return { ok: !v || v.absent === true, v }; }, { max: 60_000 });
    stat("9 fleet no longer lists the box", gone.ms, gone.v ? JSON.stringify({ boxStatus: gone.v.boxStatus, absent: gone.v.absent }) : "gone");
  } else if (box) log("kept box:", box);
  snapshot.after = briefHost(await hostRow());
  log("host after:", JSON.stringify(snapshot.after));
  const out = `.shots/live/instabox-cycle-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`;
  writeFileSync(out, JSON.stringify({ host: HOST, box, words, stats, fails, snapshot }, null, 2));
  console.log("\nop                                              seconds  note");
  for (const s of stats) console.log(`${s.op.padEnd(48)}${(s.ms / 1000).toFixed(1).padStart(7)}  ${s.note ?? ""}`);
  log(fails.length ? `FAILED: ${fails.join("; ")}` : "ALL PASS", "->", out);
}
process.exit(fails.length ? 1 : 0);
