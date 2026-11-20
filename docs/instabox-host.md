# Running a box host on an Instabox machine

An Instabox machine (instabox.sh) joined the host pool on 2026-11-19. This note records what
was found, what the controller does differently there, and how to keep it healthy.

## What an Instabox machine is

- A Firecracker microVM. **No `/dev/kvm`**, so microsandbox (`msb`) cannot boot its own microVMs
  inside it. Docker (29.x, overlayfs, cgroup v2) runs fine.
- A suspended machine is **not** resumed by SSH: the gateway refuses the channel
  ("administratively prohibited: machine … is suspended; start it in the instabox dashboard").
  Only the API's `start` (or the dashboard) brings it back; the controller's `ready` does that
  before any SSH to a dormant host. An API call does not resume it either, only `start` does.
- Login user `user` (uid 1000, in the docker and sudo groups, passwordless sudo), home
  `/data/home`. Root disk 16 GB (Docker's data root `/var/lib/docker` lives there), `/data`
  20 GB, `/tmp` a 2 GB tmpfs.
- SSH through the gateway: `ssh -p 2222 ibssh_TOKEN@ssh.instabox.sh`. Exit codes propagate,
  stdin works, the `sh -c "$(cat)"` command style and ControlMaster multiplexing work. One call
  takes about 1.7 s from a laptop; four parallel starts landed in 2 s, so unlike the Freestyle
  proxy no one-at-a-time lane is needed. `sshd` also listens on port 22 inside the VM, which is
  what the direct route uses (`user` on 22).
- API: `https://api.instabox.sh`, header `X-API-Key`, an `Idempotency-Key` on every lifecycle
  call, `X-Confirm-Delete: <id>` on delete. Machine states: creating, starting, running,
  stopping, stopped, suspending, suspended, resuming, deleting, deleted, error. The free plan
  allows one machine (4 vCPU, 8 GiB), templates agent-browser / android / omarchy / ci, and a
  fixed 30-minute idle pause of its own.

## How the controller drives it

Every box operation the controller does is an `msb` verb over SSH. On an Instabox machine the
`msb` at `/usr/local/bin/msb` is a Python shim (`src/host-shim/msb-docker.py`) that maps each
verb to Docker:

| verb | what the shim does |
| --- | --- |
| `run -d --name … -m … --cpus … --copy-dir … --from-snapshot … --max-duration …` | `docker run -d --init` of the image (or of the `asb-snap:NAME` commit for a snapshot), a 256 MB `/tmp` tmpfs, the copy-dir put in with `docker cp`, a detached watchdog that stops the container after `--max-duration` |
| `exec -e K=V box -- cmd` | `docker exec -i`; a stopped container is started for the command and stopped again; the command's exit code is returned |
| `ls --format json`, `status`, `metrics` | `docker ps` plus inspect, in msb's shapes (`running`/`stopped`, the metrics table with "exited" rows) |
| `start`, `stop`, `rm --force`, `modify --memory`, `copy` | the Docker equivalents |
| `snapshot create/ls/rm` | `docker commit` into the `asb-snap` repository |
| `image inspect/ls/rm`, `load -q -t TAG`, `save` | Docker images; `load` reads a docker-format tar on stdin |

Ignored flags: `--root-disk`, `--net …` and `--net-rule` (no egress allowlist; prod runs with
`EGRESS_ALLOW_ALL=1`), `--idle-timeout` (the controller's own nap stops a quiet finished box),
`--max-memory`.

The adapter (`instabox` in `src/host-providers.ts`) reads, suspends and starts the machine
through the API, mints the SSH token when a row is added without one, creates a machine for
`/hosts/provision.json`, snapshots it, deletes it, and owns the **prepare** step
(`src/host-prepare.ts`): shim install, rsync, directories, then the box images streamed from the
primary. The host row's config comes from the adapter where the row is blank: `-p 2222` in
front of the SSH options, `msb` at the shim, home `/data`, staging `/data/home/agent-sandbox-staging`,
and `user` as the direct-route login.

## Adding one

From an API key alone (the account has no machine yet): Fleet → Box hosts → Add host → A new
machine, provider "Instabox sandbox", a name, the key. Or:

```
POST /hosts/provision.json {"provider":"instabox","name":"instabox-b","apiKey":"ibk_…",
  "priority":0,"maxBoxes":3,"sleepAfterMs":300000}
```

The controller creates the machine from the agent-browser template, mints the SSH token, proves
SSH through the gateway (about 6 s in all), saves the row and checks it. That first check fails
(no `msb` on a stock machine), which is the cue to prepare: the shim, rsync, directories, then
the box images streamed from the primary, in the background; the host is checked again when it
ends. A free account takes one machine, so one row per account.

From a machine that exists already: Fleet → Box hosts → Add host → An existing machine, provider
"Instabox sandbox", name, the machine id, the API key, SSH left blank. Or:

```
POST /hosts.json {"action":"upsert","spec":{"name":"instabox-a","provider":"instabox",
  "cloud":{"vmId":"m_…","apiKey":"ibk_…"},"priority":0,"sleepAfterMs":300000,"maxBoxes":4}}
```

The reply carries the host (its SSH target already minted and redacted) and `prepare.running`.
Watch the row until it says "prepared"; the first run on the host then boots a container of the
claude image. A machine the free plan has paused on its own 30-minute timer is resumed by the
first wake like any paused host.

## Disk

Docker's data root is on the 16 GB root disk. After the claude image (1.9 GB) about 6.5 GB are
free; the omp image (2.6 GB) fits but leaves little for containers and layers. If the host fills
up, move Docker's data root to `/data` (`/etc/docker/daemon.json` `{"data-root":"/data/docker"}`,
then restart Docker and run Prepare again), or set the row's `ompImage` to the claude image so
only one is streamed.

## What was verified live (2026-11-19)

Against machine `m_agq5uelpl6qyy44ht6hbqm247i` ("sandbox", agent-browser template): every verb
above with the controller's real flags, a `--copy-dir` run, exec with stdin, env and exit code,
exec on a stopped box (boots, runs, stops), snapshot create / boot from / rm, modify memory with
restart, `save` on hostbrr piped into `load` here (1.87 GB in 2m48s), rm of a missing box
failing the way msb does.

Through the deployed controller (7c9c510), `.shots/live-instabox-run.mjs`: the row added with the
machine id and key alone, token minted, check 2.5 s, prepare in 4m27s (shim reinstalled, claude
image present, omp image streamed), then one delegated run: the machine resumed from the
provider's own pause, the box ran as a container (hostname a container id, 4 CPUs, no
/dev/kvm), the run finished and was torn down, 56 s end to end.

### The second account, from its key alone (2026-11-19, later the same day)

`instabox-b` (machine `m_agq7j4ryfmtnbd6lneogxmqj4y`, a second free account) was the first
Instabox host built through `POST /hosts/provision.json`, and the first live run of that route
found four faults in a row, each fixed and deployed before the next step:

1. **The readiness probe dialled port 22.** The probe in the provision route used the
   controller's SSH options but not the adapter's (`-p 2222`), knocked on the gateway's port 22
   and gave up after two minutes. Fixed in 191a702: the adapter's options come first.
2. **The rollback left the machine behind.** The undo `DELETE` carried no Idempotency-Key, which
   the API answers with 400, so the fresh machine stayed on the account (`could not delete
   machine …; remove it by hand`; it was deleted by hand). Fixed in 191a702: every machine
   delete carries the key.
3. **The failing first check stopped the preparation.** The second attempt created the machine,
   minted the token and proved SSH in 6 s, but the row's first check failed (`msb … not found`,
   as a stock machine must) and that failure used to skip the auto-prepare, so the row sat at
   "unreachable" until the Prepare button. Fixed in fb70812: a failure preparation cures starts
   it (`prepareCuresCheck`), and the host is checked again when it ends well.
4. **The sleep gate suspended the host under the stream.** That preparation installed the shim
   and began streaming the claude image; five quiet minutes later the gate logged "quiet for 5m:
   letting the host sleep", suspended the machine, the ssh died, `msb load` closed, the pipe into
   it broke and the controller went down on an unhandled EPIPE (`node:events … write EPIPE`),
   the report with it. Fixed in 175981a: the load's stdin has an error handler (the step fails
   with "the host stopped taking the image", the process lives), a running preparation holds its
   host awake for 15 minutes and renews the hold every five, and it awaits the pool's `ready`
   before its first ssh, since the gateway refuses a suspended machine outright.

On 175981a the preparation ran end to end from the Prepare button: `held awake 15m: preparing
instabox-b`, `start instabox-b: starting`, shim and rsync, agent-claude in 3m47s, agent-omp in
5m07s, 9 minutes in all, the row reachable at the end without a Check. Then
`.shots/live-host-choice.mjs --host=instabox-b`: an unknown id refused with 404, a non-string
host with 400, one delegated run pinned to instabox-b started in 47 s, carried `host:
instabox-b` in the fleet, finished (`done`, exit 0) 63 s after the call, and was torn down. The
pool is five hosts and 19 slots: freestyle-a, freestyle-b, instabox-a, instabox-b at order 0,
the VPS at 10.

Disk on the fresh machine before the images: 11 GB free of 16 on `/`, 16 GB free of 20 on
`/data`. A temporary SSH token minted to look at the machine during the post-mortem was revoked
afterwards; only the controller's token remains on the account.

## A day on the host, timed (2026-11-19, evening)

Two scripts drive production the way the dashboard does and time every step; both leave
nothing behind. `.shots/live/instabox-cycle.mjs --host=instabox-b [--nap] [--extra]` is the
sleep cycle: a task pinned to the host, the thread's Sleep, a reply to the sleeping box, the
host paused from the Fleet page, a reply on the paused host, box asleep plus host paused and
then the thread opened (wake), one more reply, with `--nap` the controller's own idle nap, then
teardown. Every turn appends to one journal file and every later turn must print the earlier
lines back, which is the proof the work survived; `--extra` adds the two refusals below.
`.shots/live/instabox-provider-shut.mjs` is the provider's side: a task, two turns of work (a
small Python tool), Sleep, then the MACHINE suspended through the Instabox API behind the
controller's back (what the free plan's idle pause does), the thread opened, the chat continued;
the agent must recall a code word from its session without reading a file, and the tool must
still run. The provider call runs inside the container (`.shots/live/ibx-api.cjs`, copied to
`/app`; the key stays on the host).

What the first pass measured on instabox-b (a cold container, no warm pool there):

| step | seconds |
|---|---|
| task accepted, machine suspended before it (resume + container boot) | 46 |
| task accepted, machine awake | 38–40 |
| first turn done, from the call | 52–61 |
| Sleep answered / fleet shows Stopped | 0.7–1.5 / 4–7 |
| reply to a sleeping box answered / turn done | 6–8 / 15 |
| host pause answered / host reads paused | 3 / 8–18 |
| reply on a paused host answered | 13.5 |
| box asleep and host paused, thread opened: wake answered / box up | 3–5 / 7–10 |
| machine suspended at the provider (API) / controller notices | 5 / 10 |
| wake after the provider suspend / chat continued, turn done | 6.6 / 14 |
| idle nap, no call (MSB_IDLE_TIMEOUT 15m) | 924 |
| teardown | 4–6 |

What it found, each fixed the same evening:

1. **The sweep synced the transcript of every box that read "running"**, including boxes
   served from memory while their host was suspended: one refused SSH per sweep, a hundred
   failed syncs into one thread on instabox-a in an afternoon. Only boxes a host answered for
   this round, on a host that is not dormant, are synced.
2. **Sleep mid-turn stopped the container under the agent**: exit 254, "the sandbox restarted
   mid-run", the turn's work lost. The thread header disables the item, the command palette did
   not. `POST /sleep.json` refuses it with 409 like the host pause (a turn the controller just
   started counts, before any sweep reads it), answers a paused host without an SSH
   (`hostAsleep: true`), and reports a stop that did not land (404 / 503) instead of "ok".
3. **The Fleet page flashed "unreachable · Connection refused"** on every pause: the pause drops
   the direct SSH forward under an in-flight sweep command. A sweep error on a dormant host is
   ignored, and a paused reading clears the error text.
4. **`GET /watch.json?lines=` went straight to the box** and would exec into one on a paused host.
   A dormant host's box is served the hub's snapshot; with no snapshot, the hub's read itself
   now answers asleep + the stored transcript instead of three failed SSHes and "could not read".
5. **A reply one second after a pause was lost**: the suspend is accepted at once and the machine
   reads "running" for a few seconds more, so the reply's start was swallowed by the suspend in
   flight, the four probes found the gateway saying "machine … is suspended", the reply
   answered 500 and the host stayed paused for eleven minutes. The adapter's pause now waits for
   the machine to read suspended; a probe refused with "is suspended" starts the machine again
   and keeps probing; a dead master's socket file is unlinked (every try through it read
   "ControlSocket … already exists, disabling multiplexing" and paid a cold connection).
6. **The package store never built anything on a Docker host.** Two faults: the builder container
   runs as root, so the host user could not rename or remove what it wrote (the builder now hands
   `/out` to the mount's owner before it reports); and the store's directory and build queue were
   one value for the whole controller, learned from the first host that asked after a boot, so a
   build for a box here staged under the VPS path `/root/.agent-sandbox/npm-store` (the machine's
   home is `/data/home`) and failed at `mkdir`, while boxes installed their MCP packages
   themselves on every launch. The store is per host now: its root keyed by the host's SSH
   target, one queue per host, the mount flag from the box's own host.

The fourth pass, on the build with all six fixes (a84fb99, the next morning, the machine suspended
before it): `instabox-cycle.mjs --extra --nap` ALL PASS in 1079 s, `instabox-provider-shut.mjs`
ALL PASS in 74 s. The package store is what changed the numbers: the boxes no longer install their
MCP packages on every launch.

| step | seconds (pass 4) | pass 1 |
|---|---|---|
| task accepted, machine suspended before it | 19 | 46 |
| task accepted, machine awake | 5 | 38–40 |
| first turn done, from the call | 18–34 | 52–61 |
| Sleep answered / fleet shows Stopped | 0.7–1.4 / 4–8 | same |
| reply to a sleeping box answered / turn done | 6 / 17 | 6–8 / 15 |
| host pause answered / host reads paused | 7 / 13 | 3 / 8–18 |
| reply on a paused host answered / turn done | 9 / 18 | 13.5 / – |
| box asleep and host paused, thread opened: wake answered / box up | 5.5 / 11 | 3–5 / 7–10 |
| machine suspended at the provider (API) / wake after it / chat continued | 3.5 / 5 / 15 | 5 / 6.6 / 14 |
| idle nap, no call (MSB_IDLE_TIMEOUT 15m) / reply after it, turn done | 914 / 15 | 924 / – |
| teardown | 5–6 | 4–6 |

Two more findings from that pass, fixed the same morning:

7. **The host stayed awake an hour after the last reply.** The attention hold (a thread opened,
   woken or replied to keeps its host up, `HOST_ATTENTION_MS`, an hour) was sized for a Freestyle
   resume through its proxy (165 s once); an Instabox start answers in 3–7 s, and the hour kept
   the machine up twelve times longer than its own five-minute clock, so after the idle nap the
   host still read awake. The hold is the provider's now (`ProviderAdapter.attentionMs`): fifteen
   minutes on Instabox, the hour elsewhere, the env override on top.
8. **A suspend behind the controller's back flashed "unreachable".** The sweep in flight hit the
   gateway's "administratively prohibited: machine … is suspended" (behind a stale mux socket
   line; through a live mux master the same refusal reads "Session open refused by peer") and the
   pool marked the host unreachable with that text for the seconds the provider's API took to say
   "paused" (15 s on the next pass); the thread read its box as absent meanwhile. The gateway's
   message names the state, so a sweep refused either way reads the host paused at once (the API
   is still asked, to confirm).
9. **A wake was undone by a read.** Shim 1's `exec` on a stopped box did what msb does: boot it,
   run the command, stop it again. The controller's wake (`start`) landed while a sweep's read had
   the box up for its own exec, so the start was a no-op on a running container, the read's
   clean-up stopped it, and the reply two seconds later failed with "container … is not running"
   (the fifth pass, 02:57 UTC). Shim 2: `start` and `run` leave a marker under
   `/tmp/msb-docker/wanted/`, `stop` and `rm` clear it, and an exec that booted the box leaves it
   up when a start landed during the command. Proven on the machine: stop, an exec of `sleep 6`,
   a start two seconds in, the box still running after the exec; a plain exec on a stopped box
   still stops it. Prepare on each Instabox host installs the new shim (the images are skipped).

Still open: `[alert] host-disk` on the VPS read 93 % during the first passes (86 % the next
morning); the volume is the RDP one, the sandboxes are a small part of it.

## Not covered

- The egress allowlist: a container sees whatever the machine can reach.
- Pausing a machine with a running container: Instabox suspends the whole VM; Docker and the
  container come back as they were on resume.
- Several machines per account: the free plan allows one. A paid plan would be one row per
  machine, like Freestyle accounts.
