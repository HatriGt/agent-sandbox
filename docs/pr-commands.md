# `/agent` on any pull request

Comment `/agent <ask>` (or mention `@agent`) on a pull request and Agent Sandbox runs the ask on
that PR's branch, replies on the PR, and keeps listening for the next comment. It works on any PR
in any repo the connected GitHub account can push to, including PRs the agent did not open.

## What it does

1. A trusted commenter (owner, member or collaborator of the repo) writes `/agent add a test for
   the login path` on a PR.
2. The controller reads the PR with the account's own token, adopts it if it is not already known,
   and starts a run on the PR's branch. The run reads the PR description, the conversation so far
   and the diff, does what was asked (code changes are committed and pushed to the same branch; a
   question is answered without touching code) and ends with a reply block.
3. The reply is posted on the PR as a comment with a link to the run.
4. The next `/agent …` on the same PR starts a fresh turn with the whole PR conversation as
   context. A new ask while a run is still working gets a short "still working" note instead of a
   second run. A PR allows up to 50 requests.

A PR the agent did not open only reacts to `/agent` commands. CI failures and review comments
only start follow-ups on PRs the agent opened.

## How comments reach the controller

Two paths, both landing in the same engine:

- **Polling (no webhook).** Every two seconds, as every stored GitHub account with its own
  token (all accounts at once), the controller lists the issues and PRs that account can see
  which changed since its last look (`GET /issues?filter=all&since=…`, a conditional read: an
  unchanged answer is a 304, which GitHub does not count against the rate limit) and reads the
  new comments on every changed PR in one go. Any `/agent` comment the account can read arrives
  this way, whoever wrote it, within a second or two. Nothing written before the controller
  started watching is replayed. (The GitHub activity feed is not used: it delivers events late,
  drops them again, and its ids are not one sequence.)
- **Webhook (instant).** The per-user PR follow-up webhook (and GitHub automations) deliver
  `issue_comment` events the moment they happen. Dashboard → Automations → PR follow-ups →
  **Install on GitHub** puts it on an organisation (every repo in it, current and future) or one
  repo in one click, as the connected account (which must administer the org or repo).
  Re-installing updates the webhook GitHub already has instead of adding a second one; removing
  it from the list deletes it on GitHub.

Each comment is answered once, whichever path delivers it first. The moment a command is taken
the agent reacts to the comment with 👀 (sent in parallel with reading the PR, before any work);
the reply follows when the run finishes.

## Settings

Dashboard → Automations → PR follow-ups → **Answer “/agent …” on any PR** (on by default). Turning
it off stops the polling for that account and ignores `/agent` on PRs the agent did
not open; `/agent` on agent-opened PRs still follows **Address review comments**.

## Operational notes

- Runs started this way show up in the thread list as `/agent · owner/repo#N` and in the fleet
  view with the request number.
- The poller logs under `[mentions]`. A rate-limited account backs off and resumes on its own.
- Deliveries are recorded under the source id `mentions:<owner>` next to the webhook's, so the
  PR follow-ups panel shows them in one list.
