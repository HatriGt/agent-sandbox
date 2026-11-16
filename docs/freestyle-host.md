# Running the box host on a Freestyle VM

The controller never touches a box directly: every `msb` call, the staging rsync, the package
store, the claims and keep markers, `gh-tokens.json` and `mcp.json` all go over one SSH target,
`VPS_SSH`. That makes the box host swappable. This note records how a Freestyle VM
(freestyle.sh) was set up as that host on 2026-11-16, so the VPS disk is no longer where boxes
live, and what it costs.

## What was verified

- A `freestyle/ubuntu` VM (4 vCPU, 8 GiB, 32 GB, the Free plan's maximum) exposes `/dev/kvm`
  with nested virtualization on, so microsandbox boots its microVMs inside it. A `node` box
  boots in about three seconds and has egress.
- msb **0.6.9** is the version the controller's flags target. The Freestyle VM must run that
  exact build: the public installer (`get.microsandbox.dev`) ignores a version pin and installs
  0.7.x, whose `run` has no `--from-snapshot`, whose `snapshot create` lost `--from`, and whose
  `--pull` takes `if-missing` instead of `missing`. The 0.6.9 bundle (`bin/` + `lib/` under
  `~/.microsandbox`) was copied from hostbrr instead.
- The controller container reaches the VM through Freestyle's SSH proxy with an identity token
  carried in the username. `BatchMode`, the `sh -c "$(cat)"` stdin-command style and
  `ControlMaster` multiplexing all work through the proxy; a multiplexed call takes about
  0.8 s against roughly 0.1 s to `host.docker.internal`.

## Setup, step by step

```bash
export FREESTYLE_API_KEY=…                       # account key from dash.freestyle.sh
npx -y freestyle@latest vm create --snapshot-id freestyle/ubuntu --slug asb-host --no-ssh

# msb 0.6.9 from the current host (same glibc 2.39 on both sides)
ssh hostbrr 'cd /root/.microsandbox && tar czf /root/msb-0.6.9.tgz bin lib'
scp hostbrr:/root/msb-0.6.9.tgz . && npx -y freestyle@latest vm scp ./msb-0.6.9.tgz asb-host:/root/
npx -y freestyle@latest vm exec asb-host --linux-user root -- bash -c \
  'mkdir -p ~/.microsandbox ~/.local/bin && tar xzf /root/msb-0.6.9.tgz -C ~/.microsandbox && \
   ln -sf ~/.microsandbox/bin/msb ~/.local/bin/msb && ~/.local/bin/msb pull node && mkdir -p /root/agent-sandbox-staging'

# an identity the controller SSHes as (root, this VM only); the token never expires until revoked
ID=$(npx -y freestyle@latest --output json identity create | jq -r .id)
npx -y freestyle@latest identity permission grant "$ID" <vm-id> --allowed-linux-user root
npx -y freestyle@latest --output json identity token create "$ID" | jq -r .token   # shown once
```

Move the host-side state and the box images (run from inside the controller container, which
holds the key for hostbrr and can reach the proxy):

```sh
U="asb-host+root:<token>"
H="ssh -i /root/.ssh/id_ed25519 root@host.docker.internal"
F="ssh -o BatchMode=yes -l $U beta-ssh.freestyle.sh"
$H 'tar czC /root .agent-sandbox' | $F 'tar xzC /root'                    # claims, keep, mcp.json, gh-tokens.json, npm-store
$H '/root/.local/bin/msb save agent-claude:<tag> -o /root/asb-claude.tar' # then stream it
$H 'cat /root/asb-claude.tar' | $F '/root/.local/bin/msb load'
# same for agent-omp:1
```

Snapshots are not needed while `MSB_CLAUDE_IMAGE` and `MSB_OMP_IMAGE` are set: an image wins
over its snapshot (`config.ts`), and image layers are stored once per host.

## The switch

The VM is left **paused** between uses (a paused VM costs no compute), so start it first:

```bash
npx -y freestyle@latest vm start asb-host
```

Then three lines in the deploy's `.env`, and `docker compose up -d`:

```
VPS_SSH=asb-host+root:<token>@beta-ssh.freestyle.sh
SSH_EXTRA_OPTS=-o StrictHostKeyChecking=accept-new
MSB_SNAPSHOT=
MSB_OMP_SNAPSHOT=
HOST_SLEEP_AFTER_MS=300000
```

`MSB`, `VPS_STAGING_DIR`, `MSB_HOME` and the image tags stay as they are. The token sits in
`.env` and in the argv of every ssh the controller spawns; both are inside the container only.
Revoke it with `freestyle identity token revoke` and mint another to rotate.

What does **not** follow the switch: boxes already on hostbrr. The fleet lists what the new host
runs, so a pinned or sleeping run on the old host becomes invisible until `VPS_SSH` points back.
Finish or snapshot those first.

Switching back is the same three lines with the old values; nothing on hostbrr is removed by
the move.

## Start, use, stop: host sleep

The VM pauses itself when nothing talks to it, and the next SSH connection wakes it (measured:
about 6 s for the first call, 0.8 s after). Set the idle timeout once:

```bash
npx -y freestyle@latest vm update asb-host --idle-timeout-seconds 300
```

That alone changes nothing, because the controller talks to the host all day: the fleet sweep
every 15 s, the warm-pool refill every minute, the disk reading every ten, the canary every hour.
`HOST_SLEEP_AFTER_MS` (src/host-sleep.ts) makes the controller go quiet: after that long with no
agent working in any box, the sweeps, refills, disk reads and scheduled canary runs stop, the
dashboard keeps showing the last snapshot ("host asleep" on the Sandboxes page), and the VM's
own idle timeout pauses it. Every launch (a new box, a resumed box, a follow-up message) wakes the
controller first and the VM with its first SSH, so a run never waits on a sweep. A box waiting on a
question or sitting finished does not keep the host up; the answer is a launch.

```
HOST_SLEEP_AFTER_MS=300000      # five quiet minutes, then the VM's own five: paused ~10 min after the last run
```

Warm-pool boxes are frozen inside the paused VM and thaw with it, so the first run after a pause
still claims a warm box. The scheduled canary is skipped while asleep (it would wake the host for
a quarter of an hour every hour); "Run now" on the Sandboxes page still runs it.

What a run costs with the gate on, from the live archive (76 runs in the last 30 days, median
2.8 min, mean 5.7 min): wake 6 s + the run + ten quiet minutes, so roughly 16 awake minutes per
run, about 20 host-hours a month, which is 80 vCPU-hours and 160 GiB-hours against the Free
plan's 200 and 400. A box itself is 1 vCPU and 1 GiB inside the VM; what is billed is the VM.

## Cost, and why this is temporary

Freestyle meters allocated vCPU and memory per hour while the VM runs; a paused VM only pays
for disk. The Free plan includes 200 vCPU-hours and 400 GiB-hours a month (doubled once a card is
on file) and pauses the VM when they run out.

| Host size | Running around the clock | Free allowance lasts | Hobby price (first $50 included) |
|---|---|---|---|
| 4 vCPU / 8 GiB (`freestyle/ubuntu`) | 2,880 vCPU-h + 5,760 GiB-h a month | ~2 days (~4 with a card) | ~$190 a month |
| 2 vCPU / 4 GiB (`freestyle/ubuntu-sm`) | 1,440 vCPU-h + 2,880 GiB-h a month | ~4 days (~8 with a card) | ~$95 a month |

So on Free the host is a burst resource: run it while the VPS is being cleaned up or
resized, pause it (`freestyle vm pause asb-host`) when nobody is running, and expect it to be
paused for you when the allowance is gone. A paused VM resumes with its boxes' disks intact
(`freestyle vm start asb-host`), and the controller's reaper handles the boxes that died in the
pause the way it handles any dead box.

The per-VM maximum on Free is the default size, so a 32 GB disk is the ceiling: images take
about 5 GB, each box's private upper is small on an image boot, and the package store is under
1 GB.
