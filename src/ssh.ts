/**
 * SSH connection multiplexing. A fresh ssh handshake to the VPS costs ~2s; reusing one
 * multiplexed master connection drops each subsequent call to ~0.4s. Since a delegation makes
 * several ssh/rsync calls, sharing one master (same ControlPath) turns ~6×2s of handshake
 * overhead into a single handshake — the biggest boot-to-ready win.
 *
 * ControlPath is derived from the target so every ssh AND rsync call in this process (and any
 * concurrent ones) reuse the same socket. ControlPersist keeps it warm briefly after the last use.
 *
 * A host behind a provider's SSH proxy may have a direct route registered (src/ssh-tunnel.ts: a
 * forwarded port to the VM's own sshd). While it is, every call is redirected there with
 * -o HostName/Port/User; the destination on the command line stays the proxy target, so no call
 * site changes, and the two routes keep separate masters and known-hosts pins.
 */
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import type { Config } from "./config.js";

/**
 * Directory holding the multiplexing sockets (created once). Kept SHORT and under $HOME:
 * Unix domain socket paths are capped near 104 chars, and macOS's long $TMPDIR plus ssh's
 * `%r@%h:%p` tokens overflow it. We use ~/.ssh/asb and a short hash of the target instead.
 */
export const SOCK_DIR = path.join(os.homedir(), ".ssh", "asb");
fs.mkdirSync(SOCK_DIR, { recursive: true });

/** Short, fixed-length name derived from the target: socket names, the direct route's alias and port. */
export function sshTargetTag(target: string): string {
  return crypto.createHash("sha1").update(target).digest("hex").slice(0, 8);
}

/** Where a proxied host's own sshd is reachable from this process (src/ssh-tunnel.ts). */
export interface DirectRoute {
  user: string;
  port: number;
  /** The known-hosts name the VM's key is pinned under, whatever the port. */
  alias: string;
  knownHosts: string;
  tag: string;
}

const directRoutes = new Map<string, DirectRoute>();

export function setDirectRoute(target: string, route: DirectRoute | undefined): void {
  if (route) directRoutes.set(target, route);
  else directRoutes.delete(target);
}

export function directRoute(target: string): DirectRoute | undefined {
  return directRoutes.get(target);
}

/**
 * Targets no SSH may be opened to right now: a host being paused at its provider, until it is
 * started again. The provider's proxy answers a session that is open when the pause lands, or that
 * arrives while the VM is paused, by resuming the VM (four pauses in a row were undone that way
 * live, 2026-11-17), so the pause closes every session first and shuts the door behind it. A gated
 * command fails at once, locally, without a connection: ProxyCommand=false and no master.
 */
const sshGates = new Set<string>();

export function gateSsh(target: string, closed: boolean): void {
  if (closed) sshGates.add(target);
  else sshGates.delete(target);
}

export function sshGated(target: string): boolean {
  return sshGates.has(target);
}

/** The ssh -o flags that make a command fail locally, at once, without reaching the network. */
export const SSH_GATED_OPTS = ["-o", "ProxyCommand=false", "-o", "ControlMaster=no", "-o", "ControlPath=none", "-o", "BatchMode=yes"];

/** The multiplexing sockets a target's commands share: the proxy's and the direct route's. */
export function sshMasterSockets(target: string): string[] {
  const tag = sshTargetTag(target);
  return [path.join(SOCK_DIR, `${tag}.sock`), path.join(SOCK_DIR, `${tag}d.sock`)];
}

/**
 * Close the target's master connections (`ssh -O exit` on each socket) and wait, briefly, for the
 * sockets to go. Commands in flight on them fail ("read from master failed"); the caller has
 * decided that is better than a session still open at the proxy. Errors are swallowed: a socket
 * that is not there is the wanted state.
 */
export async function closeSshMasters(target: string, settleMs = 1_000): Promise<void> {
  const socks = sshMasterSockets(target).filter((p) => fs.existsSync(p));
  await Promise.all(
    socks.map(
      (sock) =>
        new Promise<void>((resolve) => {
          const c = execFile("ssh", ["-O", "exit", "-o", `ControlPath=${sock}`, "asb-master"], { timeout: 3_000 }, () => resolve());
          c.on("error", () => resolve());
        })
    )
  );
  const until = Date.now() + settleMs;
  while (Date.now() < until && socks.some((p) => fs.existsSync(p))) await new Promise((r) => setTimeout(r, 50));
}

/**
 * ssh -o flags enabling connection reuse. Applied identically to ssh and rsync's ssh.
 * `direct: false` forces the proxy (the tunnel's own key install and probe); a route forces that
 * route (its check before it is registered); unset takes the registered route when there is one.
 */
export function sshMuxOpts(cfg: Config, o: { direct?: false | DirectRoute } = {}): string[] {
  if (sshGates.has(cfg.vpsSsh)) return [...SSH_GATED_OPTS, ...(cfg.sshExtraOpts ?? [])];
  const route = o.direct === false ? undefined : (o.direct ?? directRoute(cfg.vpsSsh));
  const tag = sshTargetTag(cfg.vpsSsh);
  // A separate socket per route: a master to the proxy must not answer for the direct route or the other way round.
  const controlPath = path.join(SOCK_DIR, `${tag}${route ? "d" : ""}.sock`);
  return [
    // ssh takes the first value given for an option, so the redirect comes before the extras
    // (which carry their own StrictHostKeyChecking for the proxy's key).
    ...(route
      ? ["-o", "HostName=127.0.0.1", "-o", `Port=${route.port}`, "-o", `User=${route.user}`, "-o", `HostKeyAlias=${route.alias}`, "-o", `UserKnownHostsFile=${route.knownHosts}`, "-o", "StrictHostKeyChecking=accept-new"]
      : []),
    "-o",
    "BatchMode=yes",
    "-o",
    "ControlMaster=auto",
    "-o",
    `ControlPath=${controlPath}`,
    "-o",
    `ControlPersist=${cfg.sshPersist}`,
    // A master whose connection died underneath (Freestyle's proxy drops a session after a pause or
    // an idle spell without closing it) must notice and exit, or every command rides a dead channel
    // until its own timeout (seen live 2026-11-19: four 45 s probes in a row through one such master).
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=2",
    // Deploy-time extras (e.g. `-i <key>`, StrictHostKeyChecking) for the containerized controller.
    ...(cfg.sshExtraOpts ?? []),
  ];
}

/** The `-e ssh ...` transport string rsync should use so it shares the same master socket. */
export function rsyncSshFlag(cfg: Config): string {
  // rsync -e takes a single string; quote nothing here (spawned via argv, not a shell).
  return ["ssh", ...sshMuxOpts(cfg)].join(" ");
}
