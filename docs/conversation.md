# The thread as a conversation

The agent is a chat partner, not a stream you read at the end. Two mechanisms make that true.

## Messages reach the agent mid-turn

A turn is one CLI process with its prompt in argv and stdin on /dev/null, so there is no channel
into it. There is a seam the turn passes through at every tool call: the PreToolUse gate (the same
hook that halts a turn on a pending question). `src/drivers/inbox-gate.ts`:

1. `POST /resume.json` while the box is `running` queues the message in the SQLite inbox (as
   before) AND mirrors it into the box as one JSON line in `/workspace/.agent.inbox`.
2. The next tool call the gate sees becomes the delivery. The gate stamps the message into
   `.agent.log` as a `⟦you⟧` bubble (between the step before and the step after, where it belongs),
   appends the id to `.agent.inbox.delivered`, and denies that one call with a reason that quotes the
   message: "The operator just said: … Reply to them first, then continue — change course if they
   asked you to. This tool call was only held; run it again." The model reads deny reasons, so it
   answers inside the same turn. Claude (hook `inbox-gate.sh/.js`), omp (extension) and opencode
   (plugin) all embed the same function.
3. The inbox delivery loop (`src/inbox.ts startInboxDelivery`) reads the receipt while the box has
   mail and drops those ids, so nothing is sent twice when the turn ends. A message the turn never
   reached (it ended first) delivers at turn end exactly as before. A pending question still wins:
   the ask-gate runs first and the inbox gate stays quiet.

The run wrapper clears the mailbox and receipts at the start of every turn. Nothing here kills a
turn; `/send-now.json` (interrupt) still exists for "stop and do this instead".

## Chat density

`web/src/components/thread/TraceItems.tsx` `Density`: **chat** (default) shows prose, your
messages, questions and results; every stretch of tool work folds to one line unless it is running,
notable (a test run, a PR, a failed external call) or its output draws as a visual. Thinking is
hidden once a turn ends. **trace** shows every step. The header toggle persists
(`asb-trace-density`).

The prompts (`src/drivers/prompts.ts` CONVERSATION) ask for short replies, a one-line heads-up
before a long tool burst, an immediate answer when the operator speaks, and questions over guesses.
