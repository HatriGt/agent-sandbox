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
 * ssh -o flags enabling connection reuse. Applied identically to ssh and rsync's ssh.
 * `direct: false` forces the proxy (the tunnel's own key install and probe); a route forces that
 * route (its check before it is registered); unset takes the registered route when there is one.
 */
export function sshMuxOpts(cfg: Config, o: { direct?: false | DirectRoute } = {}): string[] {
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
    // Deploy-time extras (e.g. `-i <key>`, StrictHostKeyChecking) for the containerized controller.
    ...(cfg.sshExtraOpts ?? []),
  ];
}

/** The `-e ssh ...` transport string rsync should use so it shares the same master socket. */
export function rsyncSshFlag(cfg: Config): string {
  // rsync -e takes a single string; quote nothing here (spawned via argv, not a shell).
  return ["ssh", ...sshMuxOpts(cfg)].join(" ");
}
