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

A pick reserves a slot on that host until the box exists or the boot fails, so a parallel
fan-out cannot overshoot one host while the total gate still passes. The moment the box exists it
is counted as running on that host (the next sweep lists it for real) and the reservation is given
back, so a box mid-bootstrap is never counted twice. A sweep that began before the box existed
does not uncount it (a placed box stays counted for 90 s until a sweep lists it). The global
capacity shown on the Fleet page is the sum of every enabled host's slots, and the capacity gate
before a delegation is answered from the last sweep when it is under 30 s old, not with another
SSH round trip per host.

A failure before the box exists is the host's fault and moves the run to the next host, unless it
is plainly the task's own: a ref that does not exist, a patch that does not apply, a clone the
token cannot see. Those come back to the caller as they are, and the host is not marked
unreachable for them (it used to be, one host per attempt, until every host was out).

Before the box is launched the host is made ready (`ready` in src/host-pool.ts): the host's clock
is woken, a paused VM is started through its provider and waited for (up to 2.5 minutes for the
provider to say running), and a host that was asleep, unreachable or just came up has to answer
one probe (`msb ls` over SSH, three tries of 45 s, ten seconds apart) before a box is started on
it. A resumed VM crawls for about a minute while its memory pages back in, which is what the three
tries absorb. A start call the provider refuses (a pause still landing) is tried again a few polls
later; when the provider cannot be asked at all (API down, wrong key) the wait is skipped and the
probe decides. A host that `ready` gave up on sits out of the ranking for five minutes
(`READY_COOLDOWN_MS`), so each run does not pay the same wait again; a sweep or a check that gets
through ends the cooldown early.

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

**The controller's own canary** (the hourly self-test run) only ever uses an awake host; it never
wakes a paused VM to check it.

**The chosen host is asleep.** The run is not refused and nothing is tried blind: the VM is
started through the provider's API, the controller waits for "running", then for the first SSH
to get through, then boots the box. Measured on 2026-11-16 and 17: the provider answers running
after 18 s to 2 min, the first SSH lands 10 to 30 s later, and a cold boot from the image takes
about 24 s more, so the first run after a pause starts its task roughly one to three minutes
after the request. A run on an awake host starts in a few seconds (a warm box) or ~25 s (a cold
boot).

**The host does not come up.** After 2.5 minutes without "running" (75 s when an awake host with
room is standing by: the run goes there and the VM, started meanwhile, is up for the next one), or
three probes without an
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

**A reply, a resume, a rewind, an ask or a teardown reaches a box whose VM is paused.** Every
box-scoped call asks the pool for the box's host *ready* first (`readyForBox`): the VM is started
through the provider and waited for, one probe has to get through, and only then does the SSH that
carries the message run. Before this the first SSH died on the proxy and the answer was lost. A
dashboard reply on a paused VM takes the resume time (20 s to a minute) before the thread shows
the run; the thread's "Waking the sandbox" card covers the wait. Several replies or runs that pick the
same paused host at once share one start and one set of probes.

**The VM is paused at the provider while the controller thinks it is awake** (paused by hand, by
the provider's own idle timer, or before a controller restart). SSH to it fails, the provider is
asked, and the answer "paused" makes the host dormant rather than unreachable: served from its last
sweep, ranked as asleep, not SSHed to by any loop, and started by `ready` when a run picks it, or
by any launch on a box it holds (a reply, a resume). A check on it says "paused at the provider; it
is started for the next run" and passes. A frozen warm box on it does not count as "warm ready":
a resume plus a claim is slower than a cold boot on an awake host.

**The VM runs at the provider while the controller has it asleep** (the pause call failed, or
somebody started it by hand). A dormant metered host is asked for its provider state once a
minute; "running" for longer than 90 s past the clock's sleep with nothing working on it is
paused again, and the minutes it ran are billed. A pause or start call that fails never
overwrites the last good reading; its error is shown with it.

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

**A host is disabled while machines run on it.** It is *draining*: no new run lands there, its
slots leave the capacity, but it is still swept, so its runs keep their finish edges, pushes,
notifications and history, and every reply still reaches them. The row says "draining · 2". When
two sweeps in a row list none of its boxes it stops being read. A box the sweeps have not listed
twice is forgotten from the box map at the same time (reaped by its idle timeout, removed by
hand), so a stale name no longer points at a host.

**A host is removed.** Refused while machines run or boot on it; disable it instead and let them
finish, then remove. Removal forgets the box map for that host; the primary cannot be removed,
only disabled.

**A restart of the controller.** The primary is re-seeded from .env, the other rows come from the
table, each box's host comes from `box_hosts` until the first sweep, and nothing about the hosts
depends on the container's filesystem. A metered host is asked for its provider state at once,
so a VM that was paused when the controller restarted is dormant from the first sweep on instead
of costing that sweep 45 s on a dead SSH and a false "unreachable"; the boot-time host reads (the
host guard, the store-builder reaper) skip a paused VM too.

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
since, unreachable with the last error, draining, off), machines over slots, this month's allowance, the
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

The pool in production, same day, 01:30 to 01:56 UTC: the Freestyle VM as a real host at order 0
with the VPS at order 10. Five quiet minutes after the controller restarted the host fell asleep
and the VM was paused through the API in the same second. A real run then arrived while it was
paused: the controller started the VM through the API, waited for "running", got one probe
through, booted the box and answered the delegate call 23 s after the request; the task was done
at 53 s and the box torn down on the right host. The first cycle, before the fixes in this file,
had shown the two gaps the live run was for: a wake that landed while the pause was still in
flight issued no start (the run failed over to the VPS after 150 s, which is what failover is
for), and the hourly canary had woken the VM for nothing.

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
| "unreachable" with "host … is paused after 150s" and the host is skipped for a while | The VM did not come up within the patience; the run went elsewhere and the host sits out for five minutes. | Click wake, then check. If "starting" never becomes "running", look at the VM in the provider's console. |
| The primary is disabled after a restart | You disabled it while another host was enabled; that choice is kept. | Enable it on its row. With no other enabled host it is always on. |
| A reply on a thread takes a minute to show the run | The box's VM was paused; the reply started it and waited. | Nothing. Raise the host's sleep-after if this happens often. |
| "draining · 1" on a disabled host | Machines still run there; the host is swept for them and takes no new run. | Let them finish, or tear them down, then remove the host. |
| "pause" is refused with "a run is being started on this host" | A run picked this host and its box is booting. | Wait for the box to appear, then pause. |
| The canary says "every box host is asleep, and this run does not wake one" | Every enabled host is dormant; the hourly check never wakes a VM. | Nothing; a real run wakes it. |

## What is not covered

- A box does not move between hosts. A pinned or sleeping run lives on the host it started on;
  disabling that host keeps it reachable for a resume, removing the host does not.
- Provider adapters exist for `static` and `freestyle` (src/host-providers.ts). Another provider
  with a pause/start API is one adapter with `state`, `pause` and `start`.
- The allowance is the controller's count of awake minutes, not the provider's bill; it will be
  a little under the bill (resume time before the first SSH is not counted).
