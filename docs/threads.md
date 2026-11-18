# Threads: the durable unit

A **box** is a holder: a microVM with a workspace, cloned repos and the agent's session files. It
can fall asleep, be reaped, crash with its host, or be removed by hand. A **thread** is what the
user actually has: the transcript and context that drove the work, plus the changes that work
produced. Boxes are replaceable; threads are not. Before 2026-11-18 the fleet list *was* the box
list, so a box that vanished took its thread off the page with it, twice in one day
(`docs/lifecycle.md`, "A thread survives its machine"). This document is the design that makes a
thread outlive its box.

## What is kept where

| Thing | Lives | Copy on the controller |
| --- | --- | --- |
| Thread row (owner, title, task, state, host, question, repos, kept) | `threads` table in SQLite | authoritative |
| Transcript (`/workspace/.agent.log`) | in the box | `<dataDir>/threads/<id>/transcript.log`, synced every sweep while running and at every turn end |
| Workspace + Claude session (the changes) | in the box | `<dataDir>/rescue/<box>/t<n>.tar.gz` (`src/rescue.ts`), one checkpoint per turn end |
| Run memory (state the box reported last) | `~/.agent-sandbox/runs` on the host | `<dataDir>/runs/<box>.json` |

The thread id is the box name, so every URL, bookmark, trigger and history row keeps working
across a machine replacement.

## The list

`/fleet.json` is built from both sides (`src/http.ts`, the sweep callback):

1. the boxes the hosts listed this sweep, as before;
2. plus the threads from the table whose box the hosts did **not** list (`threadViews` in
   `src/threads.ts`):
   - its host did not answer (`stale`): shown **Asleep**, untouched, like any sleeping box;
   - a rescue copy is kept: shown **Away** (`boxStatus: "Absent"`, `absent: true`). The machine is
     gone; the thread is not;
   - neither: not listed. History still has the run; nothing more can be rebuilt.

The dashboard treats Away as a kind of sleeping (`isSleeping`, `displayState`): the transcript
renders from the controller's copy, the sidebar and header say "Away", the composer says type
ahead. A teardown is the only thing that ends a thread (`deleted_at`); a sweep that sees the name
again revives it.

## Reading a thread whose box cannot be asked

`WatchHub.read` asks the box. When the box is not running and the controller's transcript copy is
longer than what the box answered (an asleep box answers nothing; a gone box answers "missing"),
the copy is served instead, with the row's `run_state`, `exit_code` and `question`, and
`boxStatus: "absent"` when the box is gone. The full-log read falls back the same way.

The copy is maintained by `syncTranscript`: one probe per sweep per running session box
(`stat` size, then `tail -c` from the stored byte count), appending only whole lines. A log that
shrank (a restore from an older checkpoint) comes back whole with a marker and replaces the copy.
A box that does not answer the probe is an error, never an empty transcript.

## Bringing a machine back

`bringBack(session)` in `src/http.ts` is the one path, shared by:

- `POST /rescue/restore.json` (the explicit button on a lost thread);
- `POST /wake.json` when the start answers "absent" and a copy is kept (opening an Away thread);
- `resumeQuietly` (a reply or an MCP/trigger continuation to an Away thread).

It asks the box's last host first (wake, `msb start`, read the log): found with content → nothing
is touched; found empty → the copy goes in; the probe fails → abort, nothing changed. Only when
the host says the box is really gone does `placeRun` create a fresh box under the old name, claim
it, and put the copy back with `pushRescue` (`msb copy`, `gzip -t` before any `rm -rf`). The
Claude session resumes from the restored `/root/.claude`, so the agent continues the same
conversation with the same files, which is the "next day, continue the change" case.

## What the user sees

- Working today, box reaped tonight, open tomorrow: the row says **Away** instead of vanishing.
  Opening it shows the transcript at once and a "Bringing the machine back" card with stages
  (finding a host, starting a machine, putting the copy back, reconnecting). A reply typed ahead
  sends when the machine is back.
- Box asleep on a host that is asleep: **Asleep**, as before; nothing is rebuilt.
- Controller restarted (a deploy) while a host was unreachable: the table lists every thread from
  the first sweep; nothing is forgotten because a host did not answer.
- Backfill: on the first start after this change, every kept copy and every mirrored run memory
  gets a thread row, so threads from before the table existed are listed too.

## Limits

- The rescue copy is taken at turn ends; a box that dies mid-turn loses that turn's file changes
  (the transcript is synced every sweep, so at most ~15 s of it is lost).
- Copies above `RESCUE_MAX_MB` (512) are not kept; such a thread shows in History only once its
  box is gone.
- Only Claude Code threads can be brought back today (the session files are agent-specific).

## The thread table seeds the fleet's memory (2026-11-18, evening)

A sleeping box cannot be asked what it was doing, so the fleet shows it from memory: the
controller's own run-memory mirror first, then each host's `~/.agent-sandbox/runs`, read once per
host and only while the host is awake (an SSH to a paused Freestyle VM resumes it). After a restart
while a host was paused, every sleeping thread on it that predated the mirror read as "No task yet —
claim it with a new task" until the host next woke. Now `threadRunMetas` (src/threads.ts) seeds that
memory from the thread table at load, and a row whose task was never learned uses the head of the
task stored at claim time (`boxes.task_head`), so a thread is named from the controller's own
records; the host's answer, when it comes, still wins per box and fills the row's full task.

Two more rules landed the same evening. A later load replaces what the fleet remembered of a
stopped box (the host's own memory, arriving once the host is awake, wins over the thread-table
seed; a running box's live reading is never replaced). And a metered host nobody has heard from yet
(the first seconds after boot, before its provider answered) counts as dormant: neither the warm
refill nor the run-memory read SSHes it on a guess, because on Freestyle's proxy that SSH resumes a
paused VM (both VMs came up by themselves after the 2026-11-18 evening deploy).
