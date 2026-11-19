# Running a box host on an Instabox machine

An Instabox machine (instabox.sh) joined the host pool on 2026-11-19. This note records what
was found, what the controller does differently there, and how to keep it healthy.

## What an Instabox machine is

- A Firecracker microVM. **No `/dev/kvm`**, so microsandbox (`msb`) cannot boot its own microVMs
  inside it. Docker (29.x, overlayfs, cgroup v2) runs fine.
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

Dashboard: Fleet → Box hosts → Add host → An existing machine, provider "Instabox sandbox",
name, the machine id, the API key, SSH left blank. Or:

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

## Not covered

- The egress allowlist: a container sees whatever the machine can reach.
- Pausing a machine with a running container: Instabox suspends the whole VM; Docker and the
  container come back as they were on resume.
- Several machines per account: the free plan allows one. A paid plan would be one row per
  machine, like Freestyle accounts.
