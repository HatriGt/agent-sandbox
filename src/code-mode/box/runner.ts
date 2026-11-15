/**
 * Code mode, the sandbox: the child program that runs one model-written script, and the host side
 * of its bridge, which spawns the child, answers its requests and enforces the limits.
 *
 * The script is prompt-injectable (it is written by a model that reads MCP results), so it runs in a
 * separate node process with nothing to steal, and the layers are independent:
 *  1. a `vm` context whose global has only call/recall/saveFile/sleep/console and the JS built-ins,
 *     with code generation from strings disabled; only strings cross into or out of it;
 *  2. the child process has an empty environment (the upstream tokens live in the server, not here),
 *     `--disallow-code-generation-from-strings` for the whole process, and `--permission` with read
 *     access to its own program file only (no other files, no child processes, no workers, no addons);
 *  3. `unshare -rn` puts it in an empty network namespace when the kernel allows it (verified in the
 *     microVM); without it there is still no fetch/require/process in the script's context;
 *  4. `ulimit -t` caps CPU time and the host kills the child at the wall-clock limit.
 * The bridge is JSON lines on the child's stdin/stdout in both directions: the host owns both ends.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { CallLine } from "./result.js";

/** Calls one script may make. A loop that fires more is a bug, and every queued call costs memory. */
export const MAX_CALLS = 1000;
/** Upstream calls running at once; the rest wait in order. */
export const MAX_IN_FLIGHT = 8;
/** One line from the child larger than this is not a bridge message: the child is stopped. */
const MAX_LINE = 64 * 1024 * 1024;
/** Console chars the child forwards before it only counts; the server shows CONSOLE_CAP of them. */
const CHILD_LOG_CAP = 6000;

/**
 * The child program. It is serialised with Function.prototype.toString, like guard.js, so the
 * tests run exactly what the box runs; it must not use anything from this module's scope.
 */
function childMain(): void {
  const vm = require("node:vm") as typeof import("node:vm");
  // Runs inside the script's context, before the script: it captures the built-ins it relies on so
  // a script that replaces Promise.prototype.then or JSON.parse cannot redirect the bridge, and it
  // keeps the one host function it is given (`send`) in a closure the script cannot reach. `send`
  // takes primitives only and returns nothing, so no host-realm object ever enters the context.
  const PRELUDE = `(function (send, LOG_CAP) {
  "use strict";
  const P = Promise, then = P.prototype.then, apply = Reflect.apply, parse = JSON.parse, stringify = JSON.stringify, isArray = Array.isArray;
  const Str = String, Err = Error, TypeErr = TypeError, create = Object.create, define = Object.defineProperty, freeze = Object.freeze;
  const pending = create(null);
  let next = 0, logChars = 0, dropped = 0;
  const fail = (e) => new P((_, reject) => reject(e));
  function ask(kind, payload) {
    return new P((resolve, reject) => { const id = ++next; pending[id] = { resolve, reject }; send(kind, id, payload); });
  }
  function text(v) {
    if (typeof v === "string") return v;
    try { const s = stringify(v); return typeof s === "string" ? s : Str(v); } catch (e) { try { return Str(v); } catch (e2) { return "[unprintable]"; } }
  }
  function json(v, what) {
    let s;
    try { s = stringify(v); } catch (e) { throw new TypeErr(what + " must be JSON: " + e.message); }
    if (typeof s !== "string") throw new TypeErr(what + " must be JSON");
    return s;
  }
  function log(prefix) {
    return function () {
      let line = prefix;
      for (let i = 0; i < arguments.length; i++) line += (i ? " " : "") + text(arguments[i]);
      if (logChars >= LOG_CAP) { dropped += line.length + 1; return; }
      logChars += line.length + 1;
      send("log", 0, line);
    };
  }
  const globals = {
    call(name, args) {
      if (typeof name !== "string") return fail(new TypeErr('call(name, args): name must be a string like "mcp__server__tool"'));
      try { return ask("call", stringify([name, json(args === undefined ? {} : args, "call arguments")])); } catch (e) { return fail(e); }
    },
    recall(n) { return ask("recall", Str(Number(n))); },
    saveFile(name, data) {
      try { return ask("save", stringify([Str(name), json(data === undefined ? null : data, "saveFile data")])); } catch (e) { return fail(e); }
    },
    sleep(ms) { return ask("sleep", Str(Number(ms) || 0)); },
    console: freeze({ log: log(""), info: log(""), debug: log(""), warn: log("[warn] "), error: log("[error] ") }),
  };
  for (const k of Object.keys(globals)) define(globalThis, k, { value: globals[k], enumerable: true, writable: false, configurable: false });
  function deliver(id, ok, payload) {
    const p = pending[id];
    if (!p) return;
    delete pending[id];
    if (!ok) return p.reject(new Err(payload));
    let v;
    try { v = parse(payload); } catch (e) { v = payload; }
    p.resolve(v);
  }
  function where(stack) { const m = /script\\.js:(\\d+)/.exec(stack); return m ? " (line " + m[1] + ")" : ""; }
  function errText(e) {
    try {
      if (e && typeof e === "object" && typeof e.message === "string") return Str(e.name) + ": " + e.message + where(Str(e.stack));
      return "uncaught: " + text(e);
    } catch (x) { return "uncaught error"; }
  }
  function finish(ok, v) {
    let out;
    if (!ok) out = { error: errText(v), dropped };
    else if (v === undefined) out = { dropped };
    else {
      // Object fields the value holds as undefined vanish from the JSON; name them, since that is
      // nearly always a misspelt field (comment_count for comments_count) and not an answer.
      const undef = create(null);
      let nu = 0;
      const note = function (k, x) { if (x === undefined && k !== "" && !isArray(this) && nu < 1000) { undef[k] = (undef[k] || 0) + 1; nu++; } return x; };
      try { const s = stringify(v, note); out = typeof s === "string" ? { value: s, dropped, undef } : { dropped }; }
      catch (e) { out = { error: "the returned value is not JSON: " + Str(e && e.message), dropped }; }
    }
    send("done", 0, stringify(out));
  }
  function run(fn) {
    let r;
    try { r = fn(); } catch (e) { return finish(false, e); }
    apply(then, r, [(v) => finish(true, v), (e) => finish(false, e)]);
  }
  return { deliver, run };
})`;
  const out = (m: unknown) => process.stdout.write(JSON.stringify(m) + "\n");
  let bridge: { deliver(id: number, ok: boolean, payload: string): void; run(fn: unknown): void } | undefined;
  const deliver = (id: number, ok: boolean, payload: string) => {
    try {
      bridge?.deliver(id, ok, payload);
    } catch {
      // A throwing deliver means the script broke its own promise; it will time out, nothing leaks.
    }
  };
  // The only host function the context ever holds. Primitives in, nothing out, never throws.
  function send(kind: unknown, id: unknown, payload: unknown): void {
    try {
      if (typeof kind !== "string" || typeof id !== "number" || typeof payload !== "string") return;
      if (kind === "sleep") {
        setTimeout(() => deliver(id, true, "null"), Math.max(0, Math.min(Number(payload) || 0, 300_000)));
        return;
      }
      out({ t: kind, id, payload });
    } catch {
      // Writing to a closed stdout: the host is gone and will kill us.
    }
  }
  function start(code: string, logCap: number): void {
    const ctx = vm.createContext(Object.create(null), { name: "script", codeGeneration: { strings: false, wasm: false } });
    bridge = new vm.Script(PRELUDE).runInContext(ctx)(send, logCap);
    let fn: unknown;
    try {
      fn = new vm.Script(`(async function () {\n${code}\n})`, { filename: "script.js", lineOffset: -1 }).runInContext(ctx);
    } catch (e) {
      out({ t: "done", id: 0, payload: JSON.stringify({ error: String((e as Error)?.message ?? e) }) });
      return;
    }
    bridge!.run(fn);
  }
  // A script's forgotten promise must not take the bridge down with it.
  process.on("unhandledRejection", () => {});
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (d: string) => {
    buf += d;
    for (let i; (i = buf.indexOf("\n")) >= 0; ) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      let m: { t?: string; id?: number; ok?: boolean; payload?: string; code?: string; logCap?: number };
      try {
        m = JSON.parse(line);
      } catch {
        continue;
      }
      if (m.t === "start" && !bridge) start(String(m.code), Number(m.logCap) || 0);
      else if (m.t === "res") deliver(Number(m.id), m.ok === true, String(m.payload));
    }
  });
  process.stdin.on("end", () => process.exit(0));
}

/** The child program text (CommonJS). The __name shim covers tsx/esbuild's keepNames helper. */
export function childProgram(): string {
  return `"use strict";\nvar __name = (f) => f;\n(${childMain.toString()})();\n`;
}

/** Write the child program into a fresh private directory and return its path. */
export function writeChildProgram(): string {
  const dir = mkdtempSync(join(tmpdir(), "code-mode-"));
  const file = join(dir, "runner.cjs");
  writeFileSync(file, childProgram(), { mode: 0o500 });
  return file;
}

/** Which isolation layers this machine supports; probed once per server process. */
export interface Sandbox {
  node: string;
  /** node accepts --permission (22.13+; the box image runs 26). Older node runs without that layer. */
  permission: boolean;
  /** POSIX shell for the `ulimit -t` wrapper; absent on Windows. */
  shell?: string;
  /** Absolute path of `unshare` when `unshare -rn true` works here. */
  unshare?: string;
  cpuSeconds: number;
}

export function probeSandbox(node = process.execPath): Sandbox {
  const permission = spawnSync(node, ["--permission", "-e", "0"], { env: {}, timeout: 15_000 }).status === 0;
  const shell = process.platform !== "win32" && existsSync("/bin/sh") ? "/bin/sh" : undefined;
  let unshare: string | undefined;
  if (shell) {
    const r = spawnSync(shell, ["-c", 'u=$(command -v unshare) && "$u" -rn true && printf %s "$u"'], { encoding: "utf8", timeout: 15_000 });
    if (r.status === 0 && r.stdout.trim().startsWith("/")) unshare = r.stdout.trim();
  }
  // Half the wall clock: a script spends its time waiting on upstream calls, so one that burns a
  // full minute of CPU is a runaway loop and should stop before the 120 s wall-clock limit.
  return { node, permission, shell, unshare, cpuSeconds: 60 };
}

/** A one-line description of the layers in force, for `--check` and for the run's error text. */
export function describeSandbox(sb: Sandbox): string {
  return [
    "vm",
    "empty env",
    sb.permission ? "--permission" : "no --permission (node too old)",
    sb.unshare ? "no network (unshare -rn)" : "network namespace unavailable",
    sb.shell ? `ulimit -t ${sb.cpuSeconds}` : "no CPU ulimit (no POSIX shell)",
  ].join(", ");
}

function childCommand(sb: Sandbox, program: string): { command: string; args: string[] } {
  const nodeArgs = [
    "--disallow-code-generation-from-strings",
    "--max-old-space-size=256",
    ...(sb.permission ? ["--permission", `--allow-fs-read=${program}`] : []),
    program,
  ];
  if (!sb.shell) return { command: sb.node, args: nodeArgs };
  return {
    command: sb.shell,
    args: ["-c", `ulimit -t ${sb.cpuSeconds} 2>/dev/null; exec "$@"`, "sh", ...(sb.unshare ? [sb.unshare, "-rn"] : []), sb.node, ...nodeArgs],
  };
}

/** What a reply to a script's call carries back to the bridge. */
export interface CallReply {
  /** JSON text the script receives. */
  json: string;
  chars: number;
  cut: boolean;
  shape: string;
}

export interface BridgeHooks {
  /** The session-wide number of the next call, so recall(n) works across runs. */
  nextN(): number;
  call(n: number, name: string, argsJson: string, signal: AbortSignal): Promise<CallReply>;
  /** JSON text of an earlier result, or throws. */
  recall(n: number): string;
  /** Writes the file and returns its path, or throws. */
  saveFile(name: string, dataJson: string): string;
}

export interface BridgeResult {
  value?: string;
  /** Object fields that were undefined in the returned value, with how often. */
  undef?: Record<string, number>;
  error?: string;
  logs: string[];
  droppedLogChars: number;
  calls: CallLine[];
}

export interface RunOptions {
  sandbox: Sandbox;
  program: string;
  hooks: BridgeHooks;
  timeoutMs: number;
  maxInFlight?: number;
}

/**
 * Run one script in a fresh child and settle with what it returned, what it logged and every call
 * it made. Never rejects: every failure — a throw in the script, a timeout, a crashed child — comes
 * back as `error`, with the calls that had no reply marked unfinished.
 */
export function runInSandbox(code: string, opts: RunOptions): Promise<BridgeResult> {
  const { command, args } = childCommand(opts.sandbox, opts.program);
  const maxInFlight = opts.maxInFlight ?? MAX_IN_FLIGHT;
  return new Promise((resolve) => {
    // cwd is the program's private dir, so even the PWD a shell exports names nothing of the box.
    const child = spawn(command, args, { env: {}, cwd: dirname(opts.program), stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const abort = new AbortController();
    const calls: CallLine[] = [];
    const logs: string[] = [];
    const queue: Array<() => void> = [];
    let running = 0, finished = false, stderr = "", buf = "";

    const reply = (id: number, ok: boolean, payload: string) => {
      if (!finished) child.stdin.write(JSON.stringify({ t: "res", id, ok, payload }) + "\n");
    };
    const finish = (r: { value?: string; error?: string; dropped?: number; undef?: Record<string, number> }) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      abort.abort();
      child.kill("SIGKILL");
      for (const c of calls) if (c.state === undefined) c.state = "unfinished";
      const undef = r.undef && typeof r.undef === "object" && Object.keys(r.undef).length ? r.undef : undefined;
      resolve({ value: r.value, undef, error: r.error, logs, droppedLogChars: r.dropped ?? 0, calls });
    };
    const pump = () => {
      while (running < maxInFlight && queue.length) queue.shift()!();
    };
    const onCall = (id: number, payload: string) => {
      let name: string, argsJson: string;
      try {
        [name, argsJson] = JSON.parse(payload);
      } catch {
        return reply(id, false, "call(name, args): could not read the request");
      }
      if (calls.length >= MAX_CALLS) {
        return finish({ error: `the script made more than ${MAX_CALLS} MCP calls in one run and was stopped; batch the work or narrow it` });
      }
      const line = { n: opts.hooks.nextN(), name, sent: argsJson.length } as CallLine;
      calls.push(line);
      queue.push(() => {
        running++;
        opts.hooks.call(line.n, name, argsJson, abort.signal).then(
          (r) => {
            if (finished) return;
            Object.assign(line, { state: "ok", chars: r.chars, cut: r.cut, shape: r.shape });
            reply(id, true, r.json);
          },
          (e: unknown) => {
            if (finished) return;
            Object.assign(line, { state: "failed", error: String((e as Error)?.message ?? e) });
            reply(id, false, String((e as Error)?.message ?? e));
          }
        ).finally(() => {
          running--;
          pump();
        });
      });
      pump();
    };
    const onMessage = (m: { t?: string; id?: number; payload?: string }) => {
      const id = Number(m.id), payload = String(m.payload ?? "");
      switch (m.t) {
        case "call":
          return onCall(id, payload);
        case "recall":
        case "save":
          try {
            if (m.t === "recall") return reply(id, true, opts.hooks.recall(Number(payload)));
            const [name, data] = JSON.parse(payload) as [string, string];
            return reply(id, true, JSON.stringify(opts.hooks.saveFile(name, data)));
          } catch (e) {
            return reply(id, false, String((e as Error)?.message ?? e));
          }
        case "log":
          logs.push(payload);
          return;
        case "done": {
          let r: { value?: string; error?: string; dropped?: number; undef?: Record<string, number> } = {};
          try {
            r = JSON.parse(payload);
          } catch {
            r = { error: "the sandbox sent an unreadable result" };
          }
          return finish(r);
        }
      }
    };

    const timer = setTimeout(
      () => finish({ error: `the script ran longer than ${Math.round(opts.timeoutMs / 1000)} s and was stopped` }),
      opts.timeoutMs
    );
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d: string) => {
      buf += d;
      for (let i; (i = buf.indexOf("\n")) >= 0; ) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        let m;
        try {
          m = JSON.parse(line);
        } catch {
          continue;
        }
        onMessage(m);
        if (finished) return;
      }
      if (buf.length > MAX_LINE) finish({ error: "the script sent more data at once than the bridge accepts (64 MB); return or save less" });
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d: string) => {
      stderr = (stderr + d).slice(-2000);
    });
    child.on("error", (e) => finish({ error: `could not start the sandbox: ${e.message}` }));
    child.on("close", (code, signal) => {
      const why = signal === "SIGXCPU" || code === 152 ? "it used up its CPU time" : `it exited (${signal ?? `code ${code}`})`;
      finish({ error: `the sandbox stopped before the script finished: ${why}${stderr.trim() ? `\n${stderr.trim()}` : ""}` });
    });
    child.stdin.on("error", () => {});
    child.stdin.write(JSON.stringify({ t: "start", code, logCap: CHILD_LOG_CAP }) + "\n");
  });
}
