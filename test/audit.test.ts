import test from "node:test";
import assert from "node:assert/strict";
import { auditFields, formatAudit } from "../src/audit.js";

test("audit: whitelisted scalar fields only — no bodies, tokens or messages", () => {
  const f = auditFields({ session: "pool-1", message: "secret text", token: "ghp_x", action: "push", repo: "a/b" }, { session: "ignored-when-body-has-it" });
  assert.deepEqual(f, { session: "pool-1", action: "push", repo: "a/b" });
  assert.deepEqual(auditFields(undefined, { session: "from-query" }), { session: "from-query" });
  const line = formatAudit({ at: "t", client: "1.2.3.4", method: "POST", path: "/teardown.json", status: 200, ms: 12, session: "pool-1" });
  assert.match(line, /^\[audit\] \{/);
  assert.doesNotMatch(line, /ghp_|secret/);
});
