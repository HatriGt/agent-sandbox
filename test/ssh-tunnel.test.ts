/**
 * The direct route to a proxied VM (src/ssh-tunnel.ts): dialled through an injected IO, registered
 * for sshMuxOpts only once a command has gone through it, re-dialled only while wanted, dropped
 * before a pause, and left alone when there is no key to put on the VM.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Config } from "../src/config.ts";
import { directPort, directUser, dropTunnel, ensureTunnel, noteDirectRouteFailure, resetTunnelsForTest, routeFor, tunnelArgs, tunnelState, type TunnelIO } from "../src/ssh-tunnel.ts";
import { noteSshFailure } from "../src/exec.ts";
import { directRoute, gateSsh, sshGated, sshMasterSockets, sshMuxOpts, SSH_GATED_OPTS } from "../src/ssh.ts";

const cfg = { vpsSsh: "asb-host+root:tok@beta-ssh.freestyle.sh", hostId: "fs-1", sshPersist: "120", sshExtraOpts: ["-i", "/k/id", "-o", "StrictHostKeyChecking=accept-new"] } as unknown as Config;

function fakeIO(o: { key?: boolean; probeFails?: number; probeError?: string } = {}) {
  const log: string[] = [];
  const spawned: { args: string[]; exit: (code: number | null) => void; killed: boolean }[] = [];
  let probeFails = o.probeFails ?? 0;
  const io: TunnelIO = {
    spawn: (args, onExit) => {
      const c = { args, exit: onExit, killed: false };
      spawned.push(c);
      return { kill: () => void (c.killed = true) };
    },
    waitPort: async () => {},
    probe: async () => {
      if (probeFails-- > 0) throw new Error(o.probeError ?? "ssh: connect to host 127.0.0.1: Connection refused");
    },
    installKey: async () => o.key ?? true,
    log: (m) => log.push(m),
  };
  return { io, log, spawned };
}

test("directUser and directPort: the VM's user rides after the + in a proxy target; the port is fixed per target", () => {
  assert.equal(directUser("asb-host+root:tok@beta-ssh.freestyle.sh"), "root");
  assert.equal(directUser("vm+ubuntu@proxy"), "ubuntu");
  assert.equal(directUser("deploy@1.2.3.4"), "deploy");
  assert.equal(directUser("host-only"), "root");
  const p = directPort("asb-host+root:tok@beta-ssh.freestyle.sh");
  assert.ok(p >= 40_000 && p < 60_000);
  assert.equal(p, directPort("asb-host+root:tok@beta-ssh.freestyle.sh"));
  assert.notEqual(p, directPort("other+root:tok@beta-ssh.freestyle.sh"));
});

test("ensureTunnel: spawns the forward with the proxy's extras, registers the route after the probe, and sshMuxOpts redirects", async () => {
  resetTunnelsForTest();
  const { io, spawned, log } = fakeIO();
  assert.equal(tunnelState(cfg), "down");
  const up = await ensureTunnel(cfg, () => true, io);
  assert.equal(up, true);
  assert.equal(tunnelState(cfg), "up");
  assert.equal(spawned.length, 1);
  const args = spawned[0].args;
  assert.ok(args.includes("-N") && args.includes("ExitOnForwardFailure=yes"), "a forward-only connection");
  assert.ok(args.join(" ").includes("-i /k/id"), "the proxy's identity");
  assert.ok(args.join(" ").includes(`127.0.0.1:${directPort(cfg.vpsSsh)}:127.0.0.1:22`));
  assert.equal(args[args.length - 1], cfg.vpsSsh);
  assert.ok(log.some((l) => /up on port/.test(l)));
  const route = directRoute(cfg.vpsSsh)!;
  assert.equal(route.user, "root");
  const opts = sshMuxOpts(cfg);
  const s = opts.join(" ");
  assert.ok(s.includes("HostName=127.0.0.1") && s.includes(`Port=${route.port}`) && s.includes("User=root"));
  assert.ok(s.indexOf("HostKeyAlias=") < s.indexOf("-i /k/id"), "the redirect precedes the extras: ssh keeps the first value of an option");
  assert.ok(/d\.sock/.test(s), "its own master socket");
  assert.ok(!sshMuxOpts(cfg, { direct: false }).join(" ").includes("HostName="), "direct:false is the proxy");
  // A second call is free.
  assert.equal(await ensureTunnel(cfg, () => true, io), true);
  assert.equal(spawned.length, 1);
  resetTunnelsForTest();
  assert.equal(directRoute(cfg.vpsSsh), undefined);
});

test("ensureTunnel: a forward that ends is dialled again only while wanted; dropTunnel kills it and unregisters the route", async () => {
  resetTunnelsForTest();
  const { io, spawned, log } = fakeIO();
  let wanted = true;
  await ensureTunnel(cfg, () => wanted, io);
  spawned[0].exit(255);
  assert.equal(directRoute(cfg.vpsSsh), undefined, "unregistered the moment it ends");
  assert.equal(tunnelState(cfg), "down");
  assert.ok(log.some((l) => /forward ended .*again in/.test(l)), log.join("\n"));
  // The scheduled dial keeps its backoff; a call meanwhile (a sweep) does not jump it.
  assert.equal(await ensureTunnel(cfg, () => wanted, io), false);
  assert.equal(spawned.length, 1);
  dropTunnel(cfg);
  // Not wanted any more (the host fell asleep): the end is final.
  await ensureTunnel(cfg, () => wanted, io);
  assert.equal(spawned.length, 2);
  wanted = false;
  spawned[1].exit(null);
  assert.ok(log.some((l) => /not awake, staying off/.test(l)), log.join("\n"));
  // Dropped while up: the child is killed, nothing re-dials.
  wanted = true;
  await ensureTunnel(cfg, () => wanted, io);
  assert.equal(tunnelState(cfg), "up");
  dropTunnel(cfg, 0);
  assert.equal(spawned[2].killed, true);
  // With the grace: the route is gone at once, the forward a moment later.
  await ensureTunnel(cfg, () => wanted, io);
  dropTunnel(cfg, 20);
  assert.equal(directRoute(cfg.vpsSsh), undefined);
  assert.equal(spawned[3].killed, false);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(spawned[3].killed, true);
  assert.equal(directRoute(cfg.vpsSsh), undefined);
  assert.equal(tunnelState(cfg), "down");
  resetTunnelsForTest();
});

test("ensureTunnel: no identity means no tunnel; a VM that refuses the key is not dialled again; a refused probe is retried later", async () => {
  resetTunnelsForTest();
  const none = fakeIO({ key: false });
  assert.equal(await ensureTunnel(cfg, () => true, none.io), false);
  assert.equal(tunnelState(cfg), "off");
  assert.equal(none.spawned.length, 0);
  assert.equal(await ensureTunnel(cfg, () => true, none.io), false, "and not asked again");
  resetTunnelsForTest();

  const refused = fakeIO({ probeFails: 1, probeError: "root@127.0.0.1: Permission denied (publickey)." });
  assert.equal(await ensureTunnel(cfg, () => true, refused.io), false);
  assert.equal(tunnelState(cfg), "off");
  assert.equal(refused.spawned[0].killed, true);
  assert.ok(refused.log.some((l) => /staying on the proxy/.test(l)));
  resetTunnelsForTest();

  const flaky = fakeIO({ probeFails: 1 });
  assert.equal(await ensureTunnel(cfg, () => true, flaky.io), false);
  assert.equal(tunnelState(cfg), "down");
  assert.ok(flaky.log.some((l) => /again in 10s/.test(l)), flaky.log.join("\n"));
  assert.equal(await ensureTunnel(cfg, () => true, flaky.io), false, "a dial is scheduled; a call meanwhile does not jump the backoff");
  assert.equal(flaky.spawned.length, 1);
  dropTunnel(cfg);
  assert.equal(await ensureTunnel(cfg, () => true, flaky.io), true, "the next dial goes through");
  resetTunnelsForTest();
});

test("ensureTunnel: a host that does not want the route (paused) is not dialled, whoever asks", async () => {
  resetTunnelsForTest();
  const { io, spawned } = fakeIO();
  assert.equal(await ensureTunnel(cfg, () => false, io), false);
  assert.equal(spawned.length, 0, "no SSH to the proxy: it would resume the paused VM");
  assert.equal(tunnelState(cfg), "down");
  resetTunnelsForTest();
});

test("ASB_SSH_DIRECT=0 turns it off", async () => {
  resetTunnelsForTest();
  process.env.ASB_SSH_DIRECT = "0";
  try {
    const { io, spawned } = fakeIO();
    assert.equal(await ensureTunnel(cfg, () => true, io), false);
    assert.equal(spawned.length, 0);
  } finally {
    delete process.env.ASB_SSH_DIRECT;
  }
});

test("routeFor and tunnelArgs are pure", () => {
  const r = routeFor(cfg.vpsSsh);
  assert.ok(r.alias.startsWith("asb-direct-") && r.knownHosts.endsWith(".known"));
  assert.deepEqual(tunnelArgs(cfg, r), tunnelArgs(cfg, r));
});

test("gateSsh: a gated target's commands fail locally (ProxyCommand=false, no master), with the extras kept; the sockets are the proxy's and the direct route's", () => {
  resetTunnelsForTest();
  gateSsh(cfg.vpsSsh, false);
  assert.ok(sshMuxOpts(cfg).includes("ControlMaster=auto"));
  gateSsh(cfg.vpsSsh, true);
  assert.equal(sshGated(cfg.vpsSsh), true);
  const o = sshMuxOpts(cfg);
  assert.deepEqual(o.slice(0, SSH_GATED_OPTS.length), SSH_GATED_OPTS);
  assert.ok(o.includes("/k/id"), "the identity is still given: ssh must not prompt or look for another");
  assert.ok(!o.join(" ").includes("ControlMaster=auto"));
  assert.ok(!o.join(" ").includes(".sock"));
  gateSsh(cfg.vpsSsh, false);
  assert.equal(sshGated(cfg.vpsSsh), false);
  assert.ok(sshMuxOpts(cfg).includes("ControlMaster=auto"));
  const socks = sshMasterSockets(cfg.vpsSsh);
  assert.equal(socks.length, 2);
  assert.ok(socks[0].endsWith(".sock") && socks[1].endsWith("d.sock"));
});

test("a command that times out or dies (255) on the direct route drops it at once: the forward is killed, the proxy is next, a re-dial is scheduled; the proxy's own socket and a route not up are nobody's business", async () => {
  resetTunnelsForTest();
  const { io, log, spawned } = fakeIO();
  assert.equal(await ensureTunnel(cfg, () => true, io), true);
  const route = routeFor(cfg.vpsSsh);
  assert.ok(directRoute(cfg.vpsSsh), "up");
  // A timeout on the proxy's socket (no d) is not the route's.
  assert.equal(noteDirectRouteFailure(`/root/.ssh/asb/${route.tag}.sock`, "timeout", io), false);
  assert.ok(directRoute(cfg.vpsSsh), "still up");
  // A timeout through the direct socket: dropped, killed, re-dial scheduled.
  assert.equal(noteDirectRouteFailure(`/root/.ssh/asb/${route.tag}d.sock`, "timeout", io), true);
  assert.equal(directRoute(cfg.vpsSsh), undefined, "the next command takes the proxy");
  assert.equal(spawned[0].killed, true, "the dead forward is killed");
  assert.equal(tunnelState(cfg), "down");
  assert.match(log.at(-1) ?? "", /fs-1: a command through the direct route timed out; the route is dropped, commands take the proxy, dialled again in \d+s/);
  // The killed forward's own exit is not reported twice.
  const n = log.length;
  spawned[0].exit(null);
  assert.equal(log.length, n);
  // Not up any more: a second failure is nobody's.
  assert.equal(noteDirectRouteFailure(`/root/.ssh/asb/${route.tag}d.sock`, "exit255", io), false);
  // The hook exec.ts calls is registered: the production io logs to the console, so only the drop is checked.
  await ensureTunnel(cfg, () => true, io).catch(() => {});
  resetTunnelsForTest();
  assert.equal(await ensureTunnel(cfg, () => true, io), true);
  noteSshFailure(`/root/.ssh/asb/${route.tag}d.sock`, "exit255");
  assert.equal(directRoute(cfg.vpsSsh), undefined, "exec.ts's hook reaches the route");
  resetTunnelsForTest();
});
