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

Before the box is launched the host is made ready (`ready` in src/host-pool.ts): the host's clock
is woken, a paused VM is started through its provider and waited for (up to 2.5 minutes for the
provider to say running), and a host that was asleep, unreachable or just came up has to answer
one probe (`msb ls` over SSH, three tries of 45 s) before a box is started on it. A resumed VM
crawls for about a minute while its memory pages back in, which is what the three tries absorb.

**Failover.** A failure before the box exists (the VM never came up, SSH was closed, `msb`
refused, staging failed to copy) is the host's fault, not the task's: that host is marked
unreachable, the slot is released, and the run is attempted on the next host in the ranking
(`placeRun`). Once the box exists the run stays where it is and its errors are its own. When every
host fails the error names them: "No other box host can take this run after freestyle-a failed".

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

## Day to day: what happens when

**A run arrives.** The picker ranks the enabled hosts (see Routing). With the VPS at order 0 and a
Freestyle VM at order 10, the VPS takes everything until its five slots are full, then the VM.
With the orders swapped the VM takes everything and the VPS is the fallback. Equal orders share:
warm box first, awake first, most allowance first, then the emptier host.

**The chosen host is asleep.** The run is not refused and nothing is tried blind: the VM is
started through the provider's API, the controller waits for "running", then for the first SSH
to get through, then boots the box. Measured on 2026-11-16 and 17: the provider answers running
after 18 s to 2 min, the first SSH lands 10 to 30 s later, and a cold boot from the image takes
about 24 s more, so the first run after a pause starts its task roughly one to three minutes
after the request. A run on an awake host starts in a few seconds (a warm box) or ~25 s (a cold
boot).

**The host does not come up.** After 2.5 minutes without "running", or three probes without an
answer, the run moves to the next host and the one that failed is marked unreachable with the
reason shown on its row ("boot failed: ssh: Connection closed by remote host"). The next sweep
that gets through clears the mark; nothing has to be clicked.

**The last agent on a host finishes.** The host's quiet clock starts. After `sleepAfterMs` (five
minutes on a Freestyle host) with no agent working in any of its boxes, the host is asleep: its
sweeps, refills and disk readings stop, the Fleet page serves its last snapshot with "asleep ·
since", and a Freestyle VM is paused through the API at once (its own idle timer would take
another five minutes of billed time). A box waiting on a question, or sitting finished, does not
keep the host up; a reply is a launch and wakes it. Pinned and sleeping runs are frozen inside the
paused VM and thaw with it.

**A host stops answering.** A sweep gets 45 s per host per round; past that the host is served
from its last sweep, marked unreachable (red "unreachable" on its row, with the error) and skipped
by the picker. The other hosts, the Fleet page and the trigger dispatcher carry on. Boxes on the
unreachable host stay listed from the last sweep so a resume or a teardown still knows where to
go once it answers.

**An account is spent.** Awake minutes are counted per host per billing month (`host_usage`). At
"0 of 200 vCPU-h left" the host is skipped; it comes back on `resetDay`. The count is the
controller's and will sit a little under the provider's bill (resume time before the first SSH is
not counted). Set the allowance a little under the plan's figure if that matters.

**A host is added, edited or switched on.** The target is checked before the dialog closes (an
SSH round trip with `msb ls` and a disk reading, capped at 45 s). The toast says what it found
("Freestyle account B added · 0 live box(es), disk 36% used"), or warns and leaves the host
unreachable when it did not answer, so a typo never takes a run. The controller also learns the
new host's public addresses so boxes there keep off them (the host guard).

**A host is removed.** Refused while machines run on it; disable it instead and let them finish,
then remove. Removal forgets the box map for that host; the primary cannot be removed, only
disabled (which stops routing runs there while leaving its boxes reachable).

**A restart of the controller.** The primary is re-seeded from .env, the other rows come from the
table, each box's host comes from `box_hosts` until the first sweep, and nothing about the hosts
depends on the container's filesystem.

### What it costs

A Freestyle VM bills its vCPUs and memory for every awake hour and only disk while paused. With
the five-minute sleep and the pause-on-sleep, a run costs its own length plus about six quiet
minutes, so from the live archive (median run 2.8 min, mean 5.7 min) roughly 12 awake minutes a
run. On a 4 vCPU VM that is 0.8 vCPU-hours a run: about 250 runs a month on the Free plan's 200
vCPU-hours, 500 with a card (400). Two accounts drain evenly because the picker prefers the one
with more allowance left. A VPS of your own is "unmetered": always awake, never counted.

### Which order to use

- **Spare the VPS, run on Freestyle:** Freestyle hosts at order 0, the VPS at order 10. Every run
  wakes the VM (one to three minutes for the first after a pause, then seconds) and the VPS only
  takes a run when every VM is full, unreachable or spent. Nothing about the VPS's own pinned or
  sleeping boxes changes.
- **Instant starts, Freestyle for overflow:** the VPS at order 0 with a warm box, Freestyle at
  order 10. The VM is used only when the VPS is full, so it costs almost nothing and is there
  when a fan-out needs more than five machines.

Both are one number per host in the edit dialog, changed at any time.

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

## Verified live (2026-11-17)

`.shots/live-hosts-e2e.mjs --run-on-fs` against the public controller, as the operator: the
registry lists the primary from .env; removing it is refused; a dead host added at order -1 is
checked on the way in (45 s cap), unreachable from the start and never picked, and the Fleet page
still answers with it enabled; a run lands on the primary with its host tag and is torn down; the
Freestyle VM (asb-host) is accepted with its token elided and its API key kept as a flag, a
blank key on an edit keeps the stored one, and put at order -1 it took a real run (delegate
answered in 24 s from a cold boot, done at 80 s, the teardown routed to the right host). All test
hosts were removed and the VM paused through the API afterwards.

## Troubleshooting

| What you see | What it means | What to do |
| --- | --- | --- |
| "unreachable" with "check of … timed out after 45s" | The SSH target does not answer at all (wrong host, closed port, VM gone). | Fix the target and click check, or wait: a sweep that gets through clears it. |
| "unreachable" with "boot failed: …" | A run was placed here and the box never came up; the run went to another host. | Read the error on the row. A Freestyle "placement rejected" is the provider's capacity, not yours; it clears by itself. |
| "asleep · 42m ago" and a run is slow to start | The VM is paused and being resumed for this run. | Nothing; one to three minutes. Lower the host's order only if you want it used less. |
| "0 of 200 vCPU-h left" | The month's allowance is used up; the host is skipped. | Add a card to the account and raise the allowance, add another account, or wait for the reset day. |
| A run says "No box host can take this run: every box host is full (…)" | Every enabled host is at its slot cap. | Raise a host's slots, add a host, or wait. |
| The Fleet page shows boxes the host no longer has | The host is asleep or unreachable and the page serves its last sweep. | Click check; if the host is really gone, disable it. |
| Provider state "unknown" | The API key is wrong or the API did not answer. | Edit the host and paste the key again; check runs the state read too. |

## What is not covered

- A box does not move between hosts. A pinned or sleeping run lives on the host it started on;
  disabling that host keeps it reachable for a resume, removing the host does not.
- Provider adapters exist for `static` and `freestyle` (src/host-providers.ts). Another provider
  with a pause/start API is one adapter with `state`, `pause` and `start`.
- The allowance is the controller's count of awake minutes, not the provider's bill; it will be
  a little under the bill (resume time before the first SSH is not counted).
