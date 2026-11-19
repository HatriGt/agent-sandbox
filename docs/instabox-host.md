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

## Not covered

- The egress allowlist: a container sees whatever the machine can reach.
- Pausing a machine with a running container: Instabox suspends the whole VM; Docker and the
  container come back as they were on resume.
- Several machines per account: the free plan allows one. A paid plan would be one row per
  machine, like Freestyle accounts.
