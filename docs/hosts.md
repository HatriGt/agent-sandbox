# Box hosts: a pool of machines runs go to

The controller never touches a box directly: every `msb` call, the staging copy, the package
store, the claims and keep markers go over one SSH target. Since 2026-11-17 that target is one
row in a registry rather than one `.env` line, and there can be any number of rows: the VPS the
controller has always used, one or more Freestyle VMs (one per account), a machine from any other
provider that has `msb` installed and answers SSH. Runs are routed across them, each host sleeps
on its own clock, and a host that is down or spent is simply not picked.

Nothing changes for a single-host install. The primary host is seeded from `.env` on every boot,
and with no other row the controller behaves exactly as before.

## The registry

`src/hosts.ts`. One row per host in the `hosts` table, the shape of `HostSpec`:

| Field | Meaning |
| --- | --- |
| `id`, `name` | The id is a slug made from the name; the primary host is always `primary`. |
| `provider` | `static` (a machine of your own; nothing to pause) or `freestyle` (a VM the controller can pause and start through the API). |
| `ssh` | The target, `user@host` or `box+user:TOKEN@beta-ssh.freestyle.sh`. Shown redacted everywhere (`box+user:…@proxy`). |
| `sshExtraOpts`, `msb`, `msbHome`, `stagingDir` | Per-host overrides of the `.env` values; blank means the primary's. |
| `maxBoxes` | Slots on this host; blank means the primary's `MAX_BOXES`. |
| `priority` | Lower runs first. The primary seeds at 0; a metered VM is sensibly 10. |
| `sleepAfterMs` | The host's own quiet delay (src/host-sleep.ts); 0 never sleeps. |
| `warm` | Keep a warm box ready here. Off for a metered host: a warm boot is not work, but it is a reason to be awake. |
| `allowance` | `{vcpuHours, vcpu, resetDay}` for a metered account; awake minutes are counted against it. |
| `freestyle` | `{vmId, apiKey}`; the key is stored and never sent back, a blank key on an edit keeps it. |
| `snapshot`, `ompSnapshot`, `claudeImage`, `ompImage` | Boot sources on this host, when they differ from the primary's. |

The primary host's connection follows `.env` (`VPS_SSH`, `SSH_EXTRA_OPTS`, `MSB`, `MSB_HOME`,
`VPS_STAGING_DIR`, `MAX_BOXES`) and is re-seeded at boot; its name, priority, warm flag and
allowance survive edits. It cannot be removed. `HOST_SLEEP_AFTER_MS` still sets its sleep delay
when set, so the Freestyle single-host setup in [freestyle-host.md](freestyle-host.md) keeps
working unchanged.

Two more tables: `box_hosts` remembers which host each box was started on, so a restart before
the first sweep still routes an exec, a resume or a teardown to the right machine; `host_usage`
holds awake minutes per host per billing month.

## Routing

`src/host-pick.ts`, pure. Every delegation (an MCP call, a chat message, a trigger, a PR comment)
asks the pool for a host:

1. Hosts that are disabled, unreachable (the last sweep failed), full, or out of allowance are
   never picked.
2. Among the rest: lowest priority number first; then a host with a warm box of the wanted
   flavour ready beats one that would cold-boot; an awake host beats one that has to resume
   (a Freestyle resume is a minute or two); the host with the most allowance left beats the one
   nearly spent, so two accounts drain evenly; then the emptier host as a share of its own slots.
3. When nothing qualifies the delegation is refused with the reason: "every box host is full
   (a 5/5, b 4/4)", "every box host with room has used up its monthly allowance", and so on.

A pick reserves a slot on that host until the box is acquired or the boot fails, so a parallel
fan-out cannot overshoot one host while the total gate still passes. The global capacity shown on
the Fleet page is the sum of every enabled host's slots.

After the pick, the whole run is bound to that host: `cfgForBox` answers the host's Config for
every box-scoped call (from the last sweep, then `box_hosts`, then the primary for any box from
before the pool), and a teardown forgets the mapping.

## Sleep, pause, allowance

Each host has its own sleep clock. After `sleepAfterMs` with no agent working in any of its
boxes, the sweeps, pool refills and disk readings for that host stop and the fleet serves the
last snapshot flagged asleep. A Freestyle host is paused through the API the moment it falls
asleep (five fewer billed minutes per cycle than waiting for the VM's own idle timer) and started
the moment a run picks it, so the resume overlaps the first SSH. A `static` host just goes quiet.

Awake time is ticked every minute into `host_usage`; a host with an allowance shows "188 of 400
vCPU-h left" and a bar on the Fleet page, is skipped once spent, and starts over on `resetDay`.

## Managing hosts

Admins only. **Fleet view → Box hosts** lists every host with its state (working, idle, asleep
since, unreachable with the last error, off), machines over slots, this month's allowance, the
order number, and per-row actions: check (an SSH round trip and, for a VM, the provider state),
pause or wake (Freestyle), edit, remove. Removing a host with machines still running is refused;
disable it and let them finish. **Add host** is a form: name, provider, SSH target, VM id and API
key, order, sleep-after, slots, the warm and enabled switches, an optional monthly allowance,
and the paths and boot sources under a fold.

The same over HTTP, admin bearer:

```
GET  /hosts.json                      → { hosts: HostView[], capacity }
POST /hosts.json  {action:"upsert", id?, spec:{...}}
POST /hosts.json  {action:"remove" | "check" | "wake" | "pause", id}
```

`/health.json` carries `hosts` for admins and the Fleet page's health line says "3 hosts ·
1 asleep · 1 unreachable" when there is more than one. Every mutation is audited
(`host.upsert:<id>`, `host.remove:<id>`, `host.wake:<id>`, `host.pause:<id>`).

## Adding a Freestyle account

Each account is its own VM and its own host row. Per account, once:

```bash
npx -y freestyle@latest vm create asb-host-b --image freestyle/ubuntu   # then msb, images, identity: see freestyle-host.md
npx -y freestyle@latest vm update asb-host-b --idle-timeout-seconds 300
```

Then **Add host**: provider Freestyle VM, the SSH target with that account's identity token, the
VM id, that account's API key, order 10, sleep after 5, allowance 200 vCPU-hours (400 with a card),
vCPUs 4, resets on the 1st. The controller checks the host at once and starts routing to it by
the rules above. The VPS stays at order 0, so a run goes to a Freestyle account only when the VPS
is full, or when you raise the VPS's order number above theirs.

## Adding any other machine

Install `msb` (the controller's version; `msb --version` on the primary), load the images, make
sure the controller's SSH key is accepted, and **Add host** with provider "My own machine". The
check action runs `msb ls` and a disk reading over SSH and shows the round trip, so a wrong
target or a missing `msb` shows up before any run lands.

## What is not covered

- A box does not move between hosts. A pinned or sleeping run lives on the host it started on;
  disabling that host keeps it reachable for a resume, removing the host does not.
- Provider adapters exist for `static` and `freestyle` (src/host-providers.ts). Another provider
  with a pause/start API is one adapter with `state`, `pause` and `start`.
- The allowance is the controller's count of awake minutes, not the provider's bill; it will be
  a little under the bill (resume time before the first SSH is not counted).
