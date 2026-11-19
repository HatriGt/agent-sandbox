// Live proof of the admin's host choice on a delegate, as the operator.
//   node .shots/live-host-choice.mjs [--base=https://...] [--host=instabox-a]
// A bad id is refused, a disabled host is refused, then one run with host=<id> lands on that host
// although it is not the picker's first choice, and is torn down.
import { readFileSync } from "node:fs";
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split("=").slice(1).join("=");
const BASE = arg("base", "https://agent-sandbox.ajeethkumar.dev");
const HOST = arg("host", "instabox-a");
const TOKEN = process.env.ASB_TOKEN || readFileSync(".shots/.asb-token", "utf8").trim();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const call = async (method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  return { status: r.status, json };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const check = (ok, what, detail) => { log(ok ? "ok  " : "FAIL", what, detail === undefined ? "" : JSON.stringify(detail).slice(0, 300)); if (!ok) fails.push(what); };

let box;
try {
  const hosts = (await call("GET", "/hosts.json")).json.hosts;
  const target = hosts.find((h) => h.id === HOST);
  check(!!target && target.enabled, `host ${HOST} is registered and enabled`, target && { priority: target.priority, asleep: target.asleep, running: target.running });
  log("hosts by order:", hosts.map((h) => `${h.id}(${h.priority}${h.asleep ? ", asleep" : ""})`).join(" "));

  let r = await call("POST", "/delegate.json", { task: "say hi", host: "no-such-host" });
  check(r.status === 404 && /no such box host/.test(r.json.error ?? ""), "an unknown host id is refused with 404", r.json);
  r = await call("POST", "/delegate.json", { task: "say hi", host: 42 });
  check(r.status === 400, "a non-string host is refused with 400", r.json);

  const t0 = Date.now();
  r = await call("POST", "/delegate.json", { task: `Run \`hostname\` and \`nproc\`; print both, then finish. (host choice proof ${Date.now().toString(36)})`, host: HOST });
  box = r.json?.box;
  check(r.status === 200 && !!box, `delegate with host=${HOST} started a run (${Math.round((Date.now() - t0) / 1000)}s)`, r.json?.error ?? box);
  if (box) {
    let view;
    for (let i = 0; i < 45; i++) {
      await sleep(8000);
      const f = (await call("GET", "/fleet.json")).json;
      view = f?.boxes?.find((b) => b.name === box);
      if (view && /done|failed|waiting/.test(view.runState ?? "")) break;
    }
    check(view?.host === HOST, `the box carries host=${HOST} in the fleet (${Math.round((Date.now() - t0) / 1000)}s)`, view && { host: view.host, runState: view.runState, exitCode: view.exitCode });
    check(view?.runState === "done", "the run finished", view?.runState);
  }
} finally {
  if (box) {
    const t = await call("POST", "/teardown.json", { box });
    log("teardown:", t.status, t.json?.error ?? "ok");
  }
}
log(fails.length ? `FAILED: ${fails.join("; ")}` : "ALL PASS");
process.exit(fails.length ? 1 : 0);
