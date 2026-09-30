# Demo parity — what to build, what to skip

The landing demo sells one promise: **walk away; you're only interrupted when it matters; you come
back to something safe to merge.** Build what makes that promise true. Skip what only makes the
demo look busy.

## Build (four bets, in order)

### 1. Answer from the notification — P0, M
The "asks instead of guessing" moment is our differentiator, and today it dies at "open the app".
- Questions carry up to 3 short choices; the push shows choice buttons (labels only, never the
  question text); one-use nonce, answered once, confirms in-app when auth is needed.
- Same choices as buttons on web and in the inbox.
- Success metric: median time from question to answer; share answered from the lock screen.

### 2. The outcome card — P0, S–M
One card at the end of every run, answering the three questions a returning user has:
**What did I get? Can I trust it? What did it cost?**
- Result: the PR, the diff size, and what's next ("followed by run #2232" if chained).
- Trust: tests (pass/fail counts when the runner output parses, otherwise exit code), PR-only
  badge, "you were asked 1 question".
- Cost: time, tokens, $ (or "—" for unpriced models) vs. the run's budget.
- Header: why it started ("Sentry alert: TypeError in checkout", link out).
- It's the History row too, so History becomes the "what your agents did" page.
- This absorbs from the old plan: receipt, verify counts, PR-only badge, provenance, the budget
  panel, chain view, the human-tap counter. Seven items become one surface.

### 3. Connect an alert source — P1, M
"On trigger" needs triggers people actually have. Presets for Sentry, Datadog, PagerDuty (plus
GitHub, which exists): signature check, payload → task fields, cooldown per alert so a storm
means one run, and a "send test event" button. Default harness: Incident responder.

### 4. Triggers that never fail silently — P1, S
The worst automation bug is the one that didn't fire and nobody knew. Per automation: last
delivery, and what happened to it (fired → run / skipped: cooldown / rejected: bad signature).
Short log, not a live feed.

## Skip or shrink

| Demo element | Call | Why |
|---|---|---|
| Timeline with chapters and scrubber | **Skip** | Replay is demo theatre. Users glance at "what's it doing now" (the thread has it) and read the outcome after. |
| Live egress chips | **Defer** | L effort, depends on runtime support, nobody watches it live. Show the network policy as one line on the outcome card. |
| Live "Automations · listening" feed | **Shrink** → bet 4 | A delivery log per automation is what people debug with. |
| Budget side panel | **Fold** → bet 2 | Budget only matters at two moments: near the cap (that's a question, bet 1) and after (outcome card). |
| Chain graph | **Fold** → bet 2 | Chains are usually 2 runs; a "followed by" line beats a graph. |
| "1 human tap · N runs" | **Fold** → bet 2 | Only meaningful per run. |

## Then
Rewrite the landing demo to show exactly what ships: the notification with choices, the outcome
card. The demo stops being aspirational.

## Rules
No made-up numbers ("—" when unknown) · amber only for "needs you" · both themes · reduced
motion · browser never calls vendors (CSP `connect-src 'self'`) · every bet works on web, mobile
and API.
