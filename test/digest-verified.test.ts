/**
 * Verified outcomes riding in the digest (the /delegate.json → sweep → /digest.json path). The
 * digest is the surface the dashboard and mobile receipt cards read, so the verified stamp and the
 * headline suffix are the contract here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDigest } from "../src/digest.ts";
import { verifyPlanOf } from "../src/verify.ts";

const base = { box: "b1", task: "t", runState: "done" as const, exitCode: 0, events: [], files: [] };

test("a passing verification stamps the digest and the headline", () => {
  const d = buildDigest({ ...base, verified: { mode: "command", pass: true, detail: "24 passing" } });
  assert.equal(d.verified?.pass, true);
  assert.match(d.headline, /verified$/);
});

test("a failing verification reads UNVERIFIED, never hides the finish", () => {
  const d = buildDigest({ ...base, verified: { mode: "criterion", pass: false, detail: "endpoint 500s" } });
  assert.equal(d.state, "done"); // verify never un-finishes a run
  assert.equal(d.verified?.pass, false);
  assert.match(d.headline, /UNVERIFIED$/);
});

test("no verify clause -> no verified key, headline unchanged", () => {
  const d = buildDigest(base);
  assert.equal("verified" in d, false);
  assert.equal(d.headline, "done");
});

test("the route-level clause validation refuses both keys and blank input", () => {
  assert.equal(verifyPlanOf({ command: "npm test", criterion: "x" }).ok, false);
  assert.equal(verifyPlanOf({}).ok, false);
  const ok = verifyPlanOf({ command: "npm test" });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.deepEqual(ok.plan, { mode: "command", command: "npm test" });
});
