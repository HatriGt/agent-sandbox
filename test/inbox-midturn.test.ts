/**
 * Mid-turn delivery (src/drivers/inbox-gate.ts): a message the box's gate delivered inside the
 * turn leaves the queue through the receipt, never through a second resume.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Inbox, startInboxDelivery } from "../src/inbox.ts";
import type { WatchSnapshot } from "../src/monitor.ts";
import { INBOX_MARK, INBOX_DELIVERED, inboxDeliverFn, inboxLine, inboxReason } from "../src/drivers/inbox-gate.ts";
import { askHookScript } from "../src/drivers/claude.ts";
import { ompGuardScript } from "../src/drivers/omp.ts";
import { opencodeGatePlugin } from "../src/drivers/opencode.ts";

const snap = (runState: WatchSnapshot["runState"]): WatchSnapshot => ({ name: "b", boxStatus: "running", runState, log: "" });

test("inbox: ids the gate delivered mid-turn are dropped before turn-end delivery", async () => {
  const ib = new Inbox();
  const a = ib.enqueue("b", "focus on 5xx");
  ib.enqueue("b", "and tell me the p95");
  let state: WatchSnapshot["runState"] = "running";
  let receipt: string[] = [a.id];
  const resumed: string[] = [];
  const stop = startInboxDelivery({
    inbox: ib,
    read: async () => snap(state),
    resume: async (_s, m) => void resumed.push(m),
    delivered: async () => {
      const r = receipt;
      receipt = [];
      return r;
    },
    intervalMs: 5,
  });
  await new Promise((r) => setTimeout(r, 25));
  assert.deepEqual(ib.list("b").map((m) => m.text), ["and tell me the p95"], "the delivered one is gone, the other waits");
  assert.equal(resumed.length, 0);
  state = "done";
  await new Promise((r) => setTimeout(r, 25));
  assert.deepEqual(resumed, ["and tell me the p95"], "only the undelivered message resumes the box");
  stop();
});

test("inbox gate: the embedded function consumes the mailbox, stamps the log, records the id", () => {
  const src = inboxDeliverFn();
  // Run the box-side function against an in-memory fs shim.
  const files = new Map<string, string>();
  files.set(INBOX_MARK, inboxLine({ id: "q3", text: "use ⟦at⟧ in the title", at: 5 }) + '{"torn');
  const fs = {
    readFileSync: (p: string) => {
      if (!files.has(p)) throw new Error("ENOENT");
      return files.get(p)!;
    },
    writeFileSync: (p: string, d: string) => void files.set(p, d),
    appendFileSync: (p: string, d: string) => void files.set(p, (files.get(p) ?? "") + d),
    unlinkSync: (p: string) => void files.delete(p),
  };
  const why = new Function("fs", src + "return asbInbox(fs);")(fs) as string | null;
  assert.equal(why, inboxReason(["use ⟦at⟧ in the title"]));
  assert.equal(files.get(INBOX_MARK), '{"torn\n', "a torn last line is kept for the next call");
  assert.equal(files.get(INBOX_DELIVERED), "q3\n");
  const log = files.get("/workspace/.agent.log")!;
  assert.match(log, /⟦at⟧ 5\n⟦you⟧\nuse ​⟦at⟧ in the title\n⟦\/you⟧\n/, "stamped as a you bubble with the sentinel defanged");
  assert.equal(new Function("fs", src + "return asbInbox(fs);")(fs), null, "no well-formed mail left");
});

test("inbox gate: every driver's gate embeds the delivery and holds the call", () => {
  assert.ok(askHookScript().includes("inbox-gate.sh"));
  assert.ok(askHookScript().includes("inbox-gate.js"));
  const ompB64 = ompGuardScript().match(/printf '%s' '([^']+)' \| base64 -d > "\$HOME\/\.omp\/agent\/extensions\/asb-guard\.js"/)?.[1] ?? "";
  assert.ok(Buffer.from(ompB64, "base64").toString("utf8").includes("asbInbox(fs)"));
  assert.ok(opencodeGatePlugin().includes("asbInbox(fs)"));
});
