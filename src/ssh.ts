/**
 * SSH connection multiplexing. A fresh ssh handshake to the VPS costs ~2s; reusing one
 * multiplexed master connection drops each subsequent call to ~0.4s. Since a delegation makes
 * several ssh/rsync calls, sharing one master (same ControlPath) turns ~6×2s of handshake
 * overhead into a single handshake — the biggest boot-to-ready win.
 *
 * ControlPath is derived from the target so every ssh AND rsync call in this process (and any
 * concurrent ones) reuse the same socket. ControlPersist keeps it warm briefly after the last use.
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
const SOCK_DIR = path.join(os.homedir(), ".ssh", "asb");
fs.mkdirSync(SOCK_DIR, { recursive: true });

/** ssh -o flags enabling connection reuse. Applied identically to ssh and rsync's ssh. */
export function sshMuxOpts(cfg: Config): string[] {
  // Short, fixed-length socket name derived from the target keeps us under the length cap.
  const tag = crypto.createHash("sha1").update(cfg.vpsSsh).digest("hex").slice(0, 8);
  const controlPath = path.join(SOCK_DIR, `${tag}.sock`);
  return [
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
