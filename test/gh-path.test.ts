import test from "node:test";
import assert from "node:assert/strict";
import { isSafeApiPath } from "../src/gh-probe.js";

test("gh api path guard: real GitHub paths pass, shell metacharacters do not", () => {
  for (const ok of [
    "/user",
    "/user/orgs",
    "/repos/acme/queue-service",
    "/repos/acme/queue-service/pulls/142/reviews?per_page=100",
    "/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member&page=2",
  ])
    assert.equal(isSafeApiPath(ok), true, ok);
  for (const bad of ["repos/x", "/repos/x;id", "/repos/x`id`", "/repos/x$(id)", "/repos/x y", "/repos/x'", '/repos/x"', "/repos/x|cat"]) assert.equal(isSafeApiPath(bad), false, bad);
});
