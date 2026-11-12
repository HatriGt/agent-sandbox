/** Boxes are kept off the host's own public addresses. See src/host-guard.ts. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { hostGuardFlagsFor, publicAddrs } from "../src/host-guard.ts";

test("only the host's globally routable addresses are guarded", () => {
  const all = ["203.0.113.7", "10.0.0.5", "172.17.0.1", "172.32.0.1", "192.168.1.2", "169.254.1.1", "100.64.0.9", "127.0.0.1", "fe80::1", "fd42:6d73:62::1", "2a01:4f8:c0c:1::1", "::1", "not-an-ip", "203.0.113.7"];
  assert.deepEqual(publicAddrs(all), ["203.0.113.7", "172.32.0.1", "2a01:4f8:c0c:1::1"]);
});

test("web ports stay open, everything else on the host is refused, and the allow comes first", () => {
  assert.deepEqual(hostGuardFlagsFor(["203.0.113.7", "2a01:4f8::1", "10.1.1.1"]), [
    "--net-rule",
    "allow@203.0.113.7:tcp:443,allow@203.0.113.7:tcp:80,deny@203.0.113.7",
    "--net-rule",
    "allow@[2a01:4f8::1]:tcp:443,allow@[2a01:4f8::1]:tcp:80,deny@[2a01:4f8::1]",
  ]);
  assert.deepEqual(hostGuardFlagsFor([]), []);
});
