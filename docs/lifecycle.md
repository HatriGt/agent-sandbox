# Sandbox lifecycle — how long a machine lives, and why

A machine is a microVM that exists for one delegated task. Three timers and one operator action decide
how long it stays:

| Mechanism | Today (`.env`) | What it does | Reversible? |
|---|---|---|---|
| `--max-duration` | `MSB_MAX_DURATION=1h` | Hard cap on the microVM's lifetime from boot. msb kills it regardless of state. | No — the rootfs is gone. |
| `--idle-timeout` | `MSB_IDLE_TIMEOUT=15m` | msb **stops** the microVM after this long without activity. The rootfs (workspace, `.agent.*` sentinels, the Claude session) survives on disk. | **Yes** — `msb start` (what `resume` does first) brings it back with the same session. |
| pool idle timeout | `MSB_POOL_IDLE_TIMEOUT` (hours) | Same stop, for **unclaimed** warm boxes, so the pool does not drain between tasks. The maintainer reaps and refills. | n/a (never claimed) |
| `teardown` | dashboard **Destroy**, MCP `teardown` | Stops and removes the box. Workspace and session are discarded. | No. |

So "stale" has two meanings and the system already treats them differently: a *quiet* machine is
**stopped, not destroyed**, and only the hard cap (or a human) destroys anything. The dashboard now
reflects this — a stopped box with a run shows as **sleeping** ("wakes on reply") instead of vanishing.

## The recommended policy (and what the defaults get right)

Think about the machine from the operator's side. After a task is delegated there are four moments:

1. **Running.** The agent is working. Nothing should stop it except the hard cap. `1h` is a sane cap
   for one delegated coding task; a run that needs more is usually a run that should have been split.
   If long research/migration tasks become common, raise `MSB_MAX_DURATION` to `2h` rather than
   removing the cap — the cap is the only thing that bounds cost when an agent loops.
2. **Waiting on a question.** The agent is paused and every tool call is denied; the box is burning
   RAM for nothing. Letting it **sleep after 15m** is correct: the question and session are preserved,
   and the answer wakes it. Keep this. What matters is that the *dashboard* keeps showing the question
   (it now does) and can notify the operator (desktop notifications, opt-in).
   **Ask-park (`ASK_PARK=1`, opt-in):** the fleet sweep goes further — after a grace window (default
   3m, `ASK_PARK_GRACE_MS`) a waiting box is stopped and its ask snapshot captured (`src/snapshot.ts
   parkWaitingBox`), so it costs disk, not RAM, immediately instead of at the 15m idle timeout. A
   parked box (host marker `~/.agent-sandbox/parked/<box>`) is held for `ASK_PARK_TTL` (default 48h)
   rather than `MSB_SLEEP_TTL`, so an overnight question survives to be answered; answering wakes it
   like any sleeping box and clears the marker. If the snapshot cannot be captured the box is
   restarted — never parked without the safety copy.
3. **Done.** The operator may want a follow-up ("also run lint") or to read the produced files. A
   **15m follow-up window before sleep** matches how people actually work: you read the result, react,
   and if you don't, the machine costs nothing while asleep. A sleeping box still allows a follow-up
   later — it simply pays a few seconds to restart. The one loss on sleep is the co-pilot (it needs a
   running box), which the UI says plainly.
4. **Abandoned.** A sleeping box that nobody ever wakes is destroyed after `MSB_SLEEP_TTL` (default
   `1h`, i.e. the run cap; pin a sandbox with **Keep** to hold it) by the pool maintainer. This covers
   every box kind: a delegate box is launched without a claim marker, so its first nap writes one
   (the sweep that sees it go Running → Stopped), and a delegate box found asleep with no clock (it
   fell asleep while the controller was down or its host paused) has its clock started on sight and is
   judged on the next sweeps, never destroyed on sight (`stoppedBoxVerdict` in `src/claims.ts`; until
   2026-11-19 only `pool-*` boxes were judged, and sleeping delegate boxes stayed for days). The
   maintainer only runs against a host that is awake: a paused Freestyle VM is left paused, and its
   expired sleepers go the first time it is up for something else. A thread whose box was destroyed
   is Away (its copy brings it back), and the fleet files it under Done, not Sleeping: the thread
   row records `absent` the first time an awake host lists without it, and that word holds while the
   host sleeps (before, every such thread came back as "asleep" each time its host paused). **Implemented** — and it fixed a real bug: the maintainer used to
   treat *any* stopped `pool-*` box as dead and force-remove it, which destroyed sleeping claimed runs
   (the "a reply wakes it" promise was broken). Claims are now recorded on the host
   (`~/.agent-sandbox/claims/<box>`, see `src/claims.ts`), so a stopped box's status as a run is
   knowable without exec'ing into it; its mtime is the sleep clock.

Warm pool: `MSB_POOL_IDLE_TIMEOUT` should be long (`6h`+) because an unclaimed warm box is the whole
point of the pool; the refill interval keeps one ready even after a max-duration reap.

## A thread survives its machine: reaper rules and rescue copies

A live thread was lost once (2026-11-18, `pool-1794970115293-5wwb90`): the Freestyle host resumed
badly, the pool sweep's ONE probe into the claimed box failed, and the maintainer force-removed it
mid-conversation. Three layers now stand between a box and that outcome.

**1. The reaper never acts on one missed probe.** `listWarmBoxes` (`src/msb.ts`) reads the host-side
markers (`claims/`, `keep/`, `parked/`) first; a box that carries a run is not probed at all. When a
marker read fails the markers are *unknown* and nothing is reaped. An unclaimed box that misses a
probe is probed again after a short pause, and only reaped when it misses twice, the markers are
known, and the host has been awake for more than `REAP_GRACE_AFTER_WAKE_MS` (3 min, from
`HostSleep.wokeAt()`). The verdict is a pure function, `unansweringBoxVerdict`, so the rule is
tested.

**2. A copy of every turn leaves the box.** At the end of each turn (and before each message) the
in-box checkpoint (`src/checkpoint.ts`: `/workspace` + `/root/.claude`, heavy dirs excluded) is
gzipped out over `msb exec` to `<dataDir>/rescue/<box>/t<n>.tar.gz` with a `meta.json` (owner,
host, agent, task, title). One copy per box, newest turn wins, same turn never pulled twice. A
checkpoint over `RESCUE_MAX_MB` (default 512) is skipped and the older copy kept, with `tooBig`
recorded so the UI can say so. Copies die with a deliberate teardown and are swept after
`RESCUE_TTL_DAYS` (default 14), at boot and every six hours. (`src/rescue.ts`)

**3. A lost thread can be brought back.** `GET /rescue.json?box=` says whether a copy is kept and
whether the machine is still in the fleet; `POST /rescue/restore.json {box}` boots a fresh box
under the SAME name on whichever host can take it (`placeRun`), claims it (`/.claimed` in-box and
the host marker, so the orphan reaper does not eat it while the copy lands), streams the tar back
in, seams `.agent.log`, and the next `/resume.json` continues the same Claude session. The
dashboard no longer bounces to the hub when a box is missing: it asks `/rescue.json` first and, if
a copy exists, keeps the URL and shows the lost-thread page with one action, *Bring it back*.
History rows carry the same summary and offer the action too.

### Not listed is not gone (2026-11-18, second incident)

The rebuilt thread "vanished" the same evening without any reaper touching it. A deploy restarted
the controller while the Freestyle host's SSH tunnel was down; the first sweep served that host
from an empty snapshot, `mergeWithMemory` took "absent from the snapshot" as "gone", forgot every
box on the host and deleted their durable run memory, and the box — which had merely fallen asleep
— was then an unknown Stopped box, dropped as dead capacity and invisible. Pressing *Bring it back*
made it worse: the restore wiped `/workspace` and `/root/.claude` in a fresh box before streaming
the copy in over `msb exec` stdin, which parks forever above a few MB. The in-box checkpoint tar
saved the thread that time. Four rules now hold:

- **A host that did not answer cannot lose a box.** `sweepHosts` reports which hosts it served
  from memory (`stale`); `mergeWithMemory` keeps a remembered box on such a host, lists it as
  Stopped, and forgets a box only when its host answered and did not list it. Run memory carries
  the box's `host` for this.
- **Run memory has a copy on the controller's own volume** (`<dataDir>/runs/<box>.json`, mirrored
  on every save). It is read first at startup, so a host that is asleep or unreachable still has
  its sleeping threads listed; the host's own memory is read when it can be (`incomplete()` retries
  a missed host on later sweeps) and wins per box.
- **A Stopped box that someone holds is a sleeping thread, not dead capacity.** Kept, claimed or
  owned (`held` in the sweep answer), an unknown Stopped box is listed under its name instead of
  dropped.
- **The restore asks the box's host before it creates or wipes anything.** `/rescue/restore.json`
  looks up the last host (`hostOfBox` / `box_hosts`), wakes it, `msb start`s the box if needed and
  reads `/workspace/.agent.log`: a non-empty log means *found*, nothing is restored and the thread
  simply reappears; an empty one gets the copy; only an absent box gets a fresh machine. The copy
  travels host-side (`uploadSh`: stdin → `~/.agent-sandbox/rescue-in/` → `msb copy` into the box)
  and the in-box apply runs `gzip -t` on the uploaded archive BEFORE `rm -rf`, so a torn transfer
  leaves the box as it was. `/rescue.json` adds `uncertain` when the box's host is asleep or
  unreachable, and the lost-thread page then says "out of sight" and offers *Check and bring it back*.

What a restore does not bring back: installed dependencies (excluded from the checkpoint; the agent
reinstalls), and anything written after the last turn ended.

### Keep means never lost (2026-11-18, fourth pass)

A box the user kept (pinned) cannot be lost by anything the system does on its own:

- **One removal rule at the choke points.** `removalVerdict` (src/claims.ts) runs inside
  `forceRemoveBox` and `teardown` (src/msb.ts), so every reaper, pool trim, warm-up failure,
  automation box policy, attempt loser and guard passes it: a kept box is refused, and keep
  markers that could not be read refuse too (nobody can prove the box is unkept). Only a
  teardown that says `force` proceeds; the API answers 409 `kept` otherwise.
- **Only the thread's own Destroy sends `force`**, and its dialog names the keep ("You kept this
  machine…"). The bulk "destroy sleeping" never sends it, so it can never take a kept one.
- **The copy off the box is kept too.** Keeping a thread stamps its row and its rescue copy as
  kept and takes the copy now if none exists (between turns; mid-turn the turn end does it). A
  kept copy is never swept by age and may be up to `RESCUE_KEPT_MAX_MB` (4096) instead of 512.
  So even a host that dies takes only the box: the thread comes back on another host.

What this cannot cover: `msb rm` typed by hand on the host (the copy still brings the thread
back), and file edits made between turns through the workspace editor after the last checkpoint.

### The thread is the durable unit (2026-11-18, third pass)

Both incidents had one root: the fleet list *was* the box list. Now the controller keeps a
`threads` table and a copy of every transcript, the list is built from boxes **plus** the threads
whose box is out of sight (Asleep when its host did not answer, **Away** when the box is gone and a
copy is kept), and opening or replying to an Away thread brings a machine back through one shared
path. Design and the full table of what lives where: `docs/threads.md`.

## A trap worth knowing: `msb exec` wakes a stopped box

Measured: `msb exec <stopped-box> -- cmd` boots the VM, runs the command, and stops it again (metrics
then show `ran 2.5s`). So *probing* a sleeping box wakes it. The controller therefore never execs into
a box `msb ls` reports as stopped — the fleet sweep reports it stopped and merges the last-known run
from memory, and the watch hub short-circuits. Before this, every 3s sweep booted each sleeping box,
which showed in the UI as sleeping → done → sleeping flicker.

## What the dashboard shows, and where it comes from

| UI | Source | Certainty |
|---|---|---|
| "42m left of the run cap" | `uptime` from `msb metrics` vs `maxDurationSec` from config | exact |
| "stops in ~9m if it stays quiet" | `lastOutputAt` = mtime of `.agent.log` vs `idleTimeoutSec` | **estimate** — msb's own idle accounting may differ; labelled with "~" |
| "sleeping · wakes on reply" | `msb ls` status Stopped + last-known run merged server-side | exact |
| capacity slots "3/5" | `MSB_MAX_BOXES` vs Running boxes | exact |

The controller exposes all of it on `GET /fleet.json` (`boxes`, `lifecycle`, `at`).

## Efficiency notes (what changed in this pass)

- **One tail loop per box, shared.** `/watch.sse`, `/watch.json` and hover-prefetches read from a
  server-side `WatchHub` cache; the loop skips `msb metrics` on the tick path (vitals ride the fleet
  poll) and slows to 3s once a run is terminal. Cost is O(watched boxes), not O(viewers).
- **Instant thread switch.** The browser keeps the last snapshot of every box it has seen and reopens
  the stream `?from=<offset>`, so switching back renders immediately and transfers only the delta.
  Hovering a row prefetches. The fallback poll is held 2.5s so it never races the stream.
- **Fleet read cached 1.5s** server-side; N tabs cost one SSH sweep.

## A Destroy wakes the host first (2026-11-19)

A Destroy of a box whose Freestyle VM was paused used to answer "ok" with nothing removed: the SSH
gate is shut for a dormant host, `msb stop` and `msb rm` are best-effort, and the keep-marker read
came back empty (an SSH that never ran) and so read as "nothing kept". Now every teardown lane
brings the box's host up first (`readyForBox`), and the removal guard reads the markers strictly
(`listKeptStrict`): a host that did not answer counts as "could not be read", which refuses. A
host that never comes up makes the Destroy fail with its reason instead of pretending.
