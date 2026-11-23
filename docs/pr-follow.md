# Seeing a reviewed PR through to merge

A repo-activity automation that reviews pull requests can keep its reviewer on each PR until it
merges. The first run reviews the PR as before; from then on the controller watches that PR and
brings the reviewer back when something changes, the way a human reviewer with the PR open in a
tab would. The code is `src/pr-follow.ts` (store, decisions, the round's task) and the follow
branch of `src/repo-watch.ts`.

## Turning it on

Dashboard → Automations → a *Repo activity* automation with a pull-request event on → **Follow
each reviewed PR until it merges**. Under it:

| Option | What it does |
|---|---|
| Re-review when new commits are pushed | A push to the PR branch starts a round that reads the diff since the last review. |
| Re-review when someone else comments | A conversation comment or an inline review comment by a person other than the connected account starts a round. Bots and the reviewer's own words never do. |
| Resolve its own review threads once a push addresses them | The round replies "Addressed in `<sha>`" and resolves the thread. Off: it replies and leaves resolving to people. |
| Rounds per PR, at most | 3, 5 or 10 (the API accepts 1–20). Changes that land while a round is running are reviewed together in the next one. |

Saved as `spec.follow = { onPush, onComment, resolve, rounds }`; `follow` is absent when neither
change is followed.

## What a round does

The round's task is the automation's own template for the PR, followed by a preface that says
which round this is, the commit the last review saw, and every change since (the new head, each
comment quoted with its author and file). The reviewer is told to:

1. check out the PR's current head and read the delta (`git diff <last>...HEAD`) and the quoted comments;
2. answer each comment by others that asks it something or disagrees, keeping or withdrawing the point;
3. reply "Addressed in `<sha>`" on its own earlier threads a push resolved (and resolve them when the option is on), leaving a line on those that still stand;
4. review the delta to the first pass's standard without repeating findings already on the PR;
5. submit a review: approve when nothing blocking remains, request changes otherwise. Never merge, push to the branch or close.

When the connected account also authored the PR, GitHub refuses a formal approval from it, so the
round posts its verdict as a review comment instead (seen on the first live proof, a PR the account
opened itself).

Every comment it posts ends with `<!-- agent-sandbox:follow -->`, so later rounds (and the
watcher) can tell its words from the author's.

## Lifecycle and guards

- **Registration.** A PR is followed from the moment a `pr_*` event of the automation starts a run
  on an open PR. That run is round 0; the row lives in `watch_followed_prs` and survives restarts.
- **One round at a time.** While a round's box is running (its `trigger_fires` row is open), new
  changes queue on the row (up to eight, deduplicated by change) and start one round together on
  the first poll after the box finishes.
- **The cap.** Past `rounds`, further changes are logged and ignored; the follow stays open so a
  merge still closes it.
- **The end.** `pr_merged` or `pr_closed` marks the row merged/closed; nothing on that PR starts a
  round afterwards. A reopened PR is followed again only through a fresh review.
- **No self-feeding.** The connected account's comments, bot comments, receipts, follow-up replies
  and marked round comments never start a round. Forks follow the automation's *Also run on PRs
  from forks* switch.
- **Storm cap and dedupe.** Rounds go through the same dispatcher as every fire: the 30-per-hour
  cap applies, and each change is claimed once under `follow:<key>` in `trigger_deliveries`. A
  round the cap would refuse is not fired and dropped: the watcher asks the dispatcher first
  (`admits`), keeps the change as a queued note (changes meanwhile join it) and starts one round
  at the end of the first poll after the window frees. A fresh `pr_*` event over the cap is
  deferred by the dispatcher itself (below) and registers its PR when it finally starts.

## The storm cap: delayed, never dropped

`MAX_FIRES_PER_HOUR` (src/triggers.ts, 30) bounds how many runs one automation starts per rolling
hour, counted from `trigger_fires`. It was 12 until 2026-11-23, when Deal Reviewer on two busy
repos saw seven PRs opened and four pushed within an hour, hit the cap, and every later event was
consumed (its delivery key claimed) and lost: a PR opened in that hour was never reviewed, and the
runs page showed rows reading only "storm cap: 12 fires in the last hour".

Now an event over the cap waits:

- The dispatcher writes a `trigger_deferred` row with the whole fire context (payload, event,
  subject, chain parent) and a delivery log row with outcome `deferred` (the UI reads "waiting ·
  limit reached") that names the PR, so the runs page shows *what* waits.
- Every dispatcher tick (20 s) drains each automation's queue oldest first while admission allows,
  replacing the waiting row with the fire's own. The after-fire hook runs for a deferred start as
  for an immediate one, so a deferred review still puts its PR under follow.
- "Run now" over the cap is still refused on the spot (the person is there to read the answer),
  a schedule's next slot is its retry, and a paused or deleted automation drops its queue (the rows
  turn into skips that say so). An automation holds at most 100 deferred events.
- **Polling cost.** A following automation reads the repo's pulls source whether or not it fires
  on PR events, and the comment sources (`/issues/comments`, `/pulls/comments`) when comments are
  followed. All reads are conditional; a 304 is free.
- **Runs page.** A round's delivery shows "round N" beside the PR, with the event that caused it.

A review's summary body alone (a review submitted without inline comments) has no repo-wide
listing on GitHub and is not seen; the inline comments of a review and conversation comments are.
