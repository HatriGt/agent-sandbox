/**
 * Direct SSH to a VM that sits behind its provider's SSH proxy (Freestyle: beta-ssh.freestyle.sh).
 *
 * Every command through the proxy costs ~0.7 s on top of the command itself, however warm the
 * multiplexed master is, and commands sent in parallel are run one after the other (measured from
 * the controller 2026-11-17: `true` 700 ms; five in parallel, one at a time). A box launch is ~20
 * such commands and a reply ~10, so most of a 19 s launch on a Freestyle host was the proxy, not
 * the work. The proxy forwards TCP and the VM runs a plain sshd, so one long-lived `ssh -N -L` to
 * the proxy exposes that sshd on a local port, and every ssh/msb call rides a multiplexed
 * connection to it instead (`true` 430 ms, five in parallel 570 ms). The controller's own key goes
 * into the VM's authorized_keys first, through the proxy, once per host and process. sshMuxOpts
 * (src/ssh.ts) redirects a call with -o HostName/Port/User while the tunnel is up and goes back
 * to the proxy when it is not, so no call site knows which it got.
 *
 * The tunnel is wanted only while the host is awake: the pool drops it before a pause (an SSH to
 * a paused VM makes the proxy resume it), and one that dies is dialled again only while the pool
 * still wants it. ASB_SSH_DIRECT=0 turns the whole thing off.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import type { Config } from "./config.js";
import { run, shellQuote } from "./exec.js";
import { setDirectRoute, sshMuxOpts, sshTargetTag, type DirectRoute, SOCK_DIR } from "./ssh.js";

export interface TunnelIO {
  /** Start the forwarding ssh; `onExit` fires once when it ends, however it ends. */
  spawn(args: string[], onExit: (code: number | null) => void): { kill(): void };
  /** Resolves once something listens on the local port. */
  waitPort(port: number, ms: number): Promise<void>;
  /** One command through the route; rejects when the VM's sshd does not take the controller's key. */
  probe(cfg: Config, route: DirectRoute, ms: number): Promise<void>;
  /** Put the controller's public key in the VM's authorized_keys through the proxy; false when there is no key to put. */
  installKey(cfg: Config): Promise<boolean>;
  log(m: string): void;
}

interface Entry {
  target: string;
  wanted: () => boolean;
  child?: { kill(): void };
  route?: DirectRoute;
  starting?: Promise<boolean>;
  failures: number;
  retry?: NodeJS.Timeout;
  keyInstalled: boolean;
  /** No key to install, or the VM refuses it: no more dials this process. */
  off?: string;
}

const entries = new Map<string, Entry>();

/** The user the VM's sshd knows: `vm+user:token@proxy` carries it after the `+`; a plain target has it before the `@`. */
export function directUser(target: string): string {
  const m = target.match(/^[^+@]+\+([^:@]+)(?::[^@]*)?@/);
  if (m) return m[1];
  const at = target.indexOf("@");
  return at > 0 ? target.slice(0, at) : "root";
}

/** A fixed local port per target, so a restarted controller lands on the same one. */
export function directPort(target: string): number {
  return 40_000 + (parseInt(sshTargetTag(target).slice(0, 4), 16) % 20_000);
}

export function routeFor(target: string): DirectRoute {
  const tag = sshTargetTag(target);
  return { user: directUser(target), port: directPort(target), alias: `asb-direct-${tag}`, knownHosts: `${SOCK_DIR}/${tag}.known`, tag };
}

/** The `-i <key>` a host is reached with, from its extra ssh options. */
export function identityOf(cfg: Config): string | undefined {
  const o = cfg.sshExtraOpts ?? [];
  const i = o.indexOf("-i");
  return i >= 0 ? o[i + 1] : undefined;
}

/** The forwarding command: its own connection to the proxy, never the shared master. */
export function tunnelArgs(cfg: Config, route: DirectRoute): string[] {
  return [
    "-N",
    "-o", "BatchMode=yes",
    "-o", "ExitOnForwardFailure=yes",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=2",
    "-o", "ControlMaster=no",
    "-o", "ControlPath=none",
    ...(cfg.sshExtraOpts ?? []),
    "-L", `127.0.0.1:${route.port}:127.0.0.1:22`,
    cfg.vpsSsh,
  ];
}

const KEY_INSTALL_SH =
  'umask 077; mkdir -p "$HOME/.ssh"; F="$HOME/.ssh/authorized_keys"; touch "$F"; K=$(cat); ' +
  'grep -qxF "$K" "$F" || printf "%s\\n" "$K" >> "$F"; echo installed';

const defaultIO: TunnelIO = {
  spawn: (args, onExit) => {
    const child = spawn("ssh", args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (d: string) => (err = (err + d).slice(-400)));
    let done = false;
    const end = (code: number | null) => {
      if (done) return;
      done = true;
      onExit(code);
    };
    child.on("error", () => end(-1));
    child.on("close", (code) => {
      if (err.trim()) console.error(`[ssh-direct] forward ended: ${err.trim().split("\n").pop()}`);
      end(code);
    });
    return { kill: () => child.kill("SIGKILL") };
  },
  waitPort: async (port, ms) => {
    const until = Date.now() + ms;
    for (;;) {
      const ok = await new Promise<boolean>((res) => {
        const s = net.connect({ host: "127.0.0.1", port });
        s.once("connect", () => (s.destroy(), res(true)));
        s.once("error", () => res(false));
      });
      if (ok) return;
      if (Date.now() >= until) throw new Error(`nothing listens on port ${port} after ${Math.round(ms / 1000)}s`);
      await new Promise((r) => setTimeout(r, 250));
    }
  },
  probe: async (cfg, route, ms) => {
    await run("ssh", [...sshMuxOpts(cfg, { direct: route }), cfg.vpsSsh, "true"], { timeoutMs: ms });
  },
  installKey: async (cfg) => {
    const key = identityOf(cfg);
    if (!key) return false;
    let pub = "";
    try {
      pub = (await run("ssh-keygen", ["-y", "-f", key], { timeoutMs: 10_000 })).stdout.trim();
    } catch {
      try {
        pub = fs.readFileSync(`${key}.pub`, "utf8").trim();
      } catch {
        return false;
      }
    }
    if (!/^(ssh-|ecdsa-|sk-)\S+ \S+/.test(pub)) return false;
    const r = await run("ssh", [...sshMuxOpts(cfg, { direct: false }), cfg.vpsSsh, `sh -c ${shellQuote(KEY_INSTALL_SH)}`], { input: `${pub.split(/\s+/).slice(0, 2).join(" ")}\n`, timeoutMs: 30_000 });
    return /installed/.test(r.stdout);
  },
  log: (m) => console.error(m),
};

const label = (cfg: Config): string => cfg.hostId ?? cfg.vpsSsh.replace(/^[^@]*@/, "");

/** Up, or being dialled: the route every call to this host takes once it is up. */
export function tunnelState(cfg: Config): "up" | "dialling" | "down" | "off" {
  const e = entries.get(cfg.vpsSsh);
  if (!e) return "down";
  if (e.off) return "off";
  return e.route ? "up" : e.starting ? "dialling" : "down";
}

/**
 * Have the tunnel up for this host, or keep trying while `wanted` says so. Cheap when it is up.
 * Resolves true once a command has gone through it.
 */
export function ensureTunnel(cfg: Config, wanted: () => boolean = () => true, io: TunnelIO = defaultIO): Promise<boolean> {
  if (process.env.ASB_SSH_DIRECT === "0") return Promise.resolve(false);
  const target = cfg.vpsSsh;
  let e = entries.get(target);
  if (!e) {
    e = { target, wanted, failures: 0, keyInstalled: false };
    entries.set(target, e);
  }
  e.wanted = wanted;
  if (e.off) return Promise.resolve(false);
  if (e.route) return Promise.resolve(true);
  if (e.starting) return e.starting;
  // A dial already scheduled after a failure keeps its backoff: a sweep every 15 s is not a reason
  // to try sooner (each try is a connection to the proxy and a log line).
  if (e.retry) return Promise.resolve(false);
  const entry = e;
  e.starting = dial(cfg, entry, io).finally(() => {
    entry.starting = undefined;
  });
  return e.starting;
}

async function dial(cfg: Config, e: Entry, io: TunnelIO): Promise<boolean> {
  const route = routeFor(cfg.vpsSsh);
  try {
    if (!e.keyInstalled) {
      if (!(await io.installKey(cfg))) {
        e.off = "no key to install";
        io.log(`[ssh-direct] ${label(cfg)}: no identity to put on the VM; staying on the proxy`);
        return false;
      }
      e.keyInstalled = true;
    }
    const child = io.spawn(tunnelArgs(cfg, route), (code) => onExit(cfg, e, child, code, io));
    e.child = child;
    await io.waitPort(route.port, 15_000);
    await io.probe(cfg, route, 20_000);
    if (e.child !== child) throw new Error("the forward ended while it was being checked");
    e.route = route;
    e.failures = 0;
    setDirectRoute(cfg.vpsSsh, route);
    io.log(`[ssh-direct] ${label(cfg)}: up on port ${route.port}`);
    return true;
  } catch (err) {
    e.failures++;
    const msg = String((err as Error).message ?? err).split("\n")[0].slice(0, 160);
    // The VM's sshd refusing the key it was just given will not change by dialling again.
    if (/Permission denied/i.test(msg) && e.keyInstalled) e.off = "the VM refused the controller's key";
    e.child?.kill();
    e.child = undefined;
    const again = !e.off && e.wanted();
    io.log(`[ssh-direct] ${label(cfg)}: ${msg}; ${e.off ? "staying on the proxy" : again ? `again in ${Math.round(retryMs(e) / 1000)}s` : "not wanted now"}`);
    if (again) scheduleRetry(cfg, e, io);
    return false;
  }
}

function onExit(cfg: Config, e: Entry, child: { kill(): void }, code: number | null, io: TunnelIO): void {
  if (e.child !== child) return;
  e.child = undefined;
  const wasUp = !!e.route;
  e.route = undefined;
  setDirectRoute(cfg.vpsSsh, undefined);
  if (!wasUp) return; // the dial's own catch reports it
  const again = e.wanted();
  io.log(`[ssh-direct] ${label(cfg)}: forward ended (${code ?? "signal"}); ${again ? `again in ${Math.round(retryMs(e) / 1000)}s` : "the host is not awake, staying off"}`);
  if (again) scheduleRetry(cfg, e, io);
}

const retryMs = (e: Entry): number => Math.min(120_000, 5_000 * 2 ** Math.min(e.failures, 5));

function scheduleRetry(cfg: Config, e: Entry, io: TunnelIO): void {
  if (e.retry) clearTimeout(e.retry);
  e.retry = setTimeout(() => {
    e.retry = undefined;
    if (e.route || e.starting || !e.wanted()) return;
    void ensureTunnel(cfg, e.wanted, io);
  }, retryMs(e));
  e.retry.unref?.();
}

/**
 * Tear the tunnel down and stop re-dialling: the host is going to sleep, or is gone. New commands
 * take the proxy at once; the forward itself is killed after `graceMs`, so a command in flight on
 * it (a sweep's `msb ls`) finishes instead of dying with "read from master failed".
 */
export function dropTunnel(cfg: Config, graceMs = 2_000): void {
  const e = entries.get(cfg.vpsSsh);
  if (!e) return;
  e.wanted = () => false;
  if (e.retry) {
    clearTimeout(e.retry);
    e.retry = undefined;
  }
  const child = e.child;
  e.child = undefined;
  e.route = undefined;
  setDirectRoute(cfg.vpsSsh, undefined);
  if (!child) return;
  if (graceMs <= 0) {
    child.kill();
    return;
  }
  setTimeout(() => child.kill(), graceMs).unref?.();
}

/** Tests. */
export function resetTunnelsForTest(): void {
  for (const e of entries.values()) {
    if (e.retry) clearTimeout(e.retry);
    e.child?.kill();
    setDirectRoute(e.target, undefined);
  }
  entries.clear();
}
