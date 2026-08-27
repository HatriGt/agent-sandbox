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
3. **Done.** The operator may want a follow-up ("also run lint") or to read the produced files. A
   **15m follow-up window before sleep** matches how people actually work: you read the result, react,
   and if you don't, the machine costs nothing while asleep. A sleeping box still allows a follow-up
   later — it simply pays a few seconds to restart. The one loss on sleep is the co-pilot (it needs a
   running box), which the UI says plainly.
4. **Abandoned.** A sleeping box that nobody ever wakes is destroyed after `MSB_SLEEP_TTL` (default
   `24h`) by the pool maintainer. **Implemented** — and it fixed a real bug: the maintainer used to
   treat *any* stopped `pool-*` box as dead and force-remove it, which destroyed sleeping claimed runs
   (the "a reply wakes it" promise was broken). Claims are now recorded on the host
   (`~/.agent-sandbox/claims/<box>`, see `src/claims.ts`), so a stopped box's status as a run is
   knowable without exec'ing into it; its mtime is the sleep clock.

Warm pool: `MSB_POOL_IDLE_TIMEOUT` should be long (`6h`+) because an unclaimed warm box is the whole
point of the pool; the refill interval keeps one ready even after a max-duration reap.

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
