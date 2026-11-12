/**
 * A warm box belongs to one owner. Found live: the pool prepared every box with the OPERATOR's MCP
 * servers and handed it to whoever asked first, so another person's box carried packages that were
 * never theirs and they still paid their own install at claim time.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickWarmOwners, ownerTag, BLANK_OWNER, LAST_OWNER_KEEP_MS } from "../src/warm-owners.ts";
import { claimableBoxes, refillPool, hostHasRoom, memoryMb } from "../src/pool.ts";
import { parseWarmProbe } from "../src/msb.ts";
import type { Config } from "../src/config.ts";

const H = 3600_000;

test("owners seen inside the window get a box, most recent first, up to the cap", () => {
  const seen = new Map([["a", 10 * H - 10], ["b", 10 * H - 5], ["c", 10 * H - 1], ["old", 1 * H]]);
  assert.deepEqual(pickWarmOwners(seen, 10 * H, 2 * H, 2), ["c", "b"]);
  assert.deepEqual(pickWarmOwners(seen, 10 * H, 2 * H, 5), ["c", "b", "a"]);
});

test("with nobody around, the one most recent owner keeps their box; after a week, nobody does", () => {
  const seen = new Map([["a", 1 * H], ["b", 2 * H]]);
  assert.deepEqual(pickWarmOwners(seen, 30 * H, 2 * H, 2), ["b"]);
  assert.deepEqual(pickWarmOwners(seen, 2 * H + LAST_OWNER_KEEP_MS + 1, 2 * H, 2), []);
  assert.deepEqual(pickWarmOwners(seen, 30 * H, 2 * H, 0), []);
});

test("the owner marker is a tag, never the account id", () => {
  const tag = ownerTag("user_12345");
  assert.match(tag, /^[0-9a-f]{16}$/);
  assert.ok(!tag.includes("12345"));
  assert.notEqual(tag, ownerTag("operator"));
});

test("a run takes its owner's box first, then a blank one, and never anyone else's", () => {
  const boxes = [
    { name: "pool-1-other", owner: ownerTag("bob") },
    { name: "pool-2-blank", owner: BLANK_OWNER },
    { name: "pool-3-mine", owner: ownerTag("alice") },
    { name: "pool-4-old", owner: "legacy" },
  ];
  assert.deepEqual(claimableBoxes(boxes, "alice"), ["pool-3-mine", "pool-2-blank"]);
  assert.deepEqual(claimableBoxes(boxes, "carol"), ["pool-2-blank"]);
  assert.deepEqual(claimableBoxes(boxes, undefined), ["pool-2-blank"]);
});

test("the free-probe reads the owner, and a box with no marker is legacy", () => {
  assert.deepEqual(parseWarmProbe("free abc123\n"), { state: "free", owner: "abc123" });
  assert.deepEqual(parseWarmProbe("noise\nfree legacy\n"), { state: "free", owner: "legacy" });
  assert.deepEqual(parseWarmProbe("claimed\n"), { state: "claimed", owner: "legacy" });
  assert.equal(parseWarmProbe("warming").state, "warming");
});

test("a warm box is the first thing a short host gives up", () => {
  assert.equal(memoryMb("1G"), 1024);
  assert.equal(memoryMb("1536M"), 1536);
  assert.equal(hostHasRoom(undefined, "1G"), true);
  assert.equal(hostHasRoom(1535, "1G"), false);
  assert.equal(hostHasRoom(1536, "1G"), true);
});

const cfg = { poolSize: 1, ompPoolSize: 0, snapshot: "agent-base", egressAllowAll: true, memory: "1G" } as unknown as Config;

function rig(listed: Array<{ name: string; owner: string }>, freeMb?: number) {
  const calls: string[] = [];
  const io = {
    listPoolBoxes: async () => listed.map((b) => b.name),
    listWarmBoxes: async () => listed.map((b) => ({ ...b })),
    bootWarmBox: async (_c: Config, agent?: string, owner?: string | null) => {
      calls.push(`boot:${agent}:${owner ?? "blank"}`);
      return `pool-${Date.now()}-new${calls.length}`;
    },
    adoptWarmBox: async (_c: Config, box: string, _a: string, owner: string) => {
      calls.push(`adopt:${box}:${owner}`);
    },
    removeBox: async (_c: Config, box: string) => {
      calls.push(`rm:${box}`);
    },
    hostFreeMb: async () => freeMb,
    ownerFlavor: () => "claude" as const,
  };
  return { io, calls };
}

test("an owner with no box takes over the blank one in place: no second VM is booted", async () => {
  const { io, calls } = rig([{ name: "pool-100-blank", owner: BLANK_OWNER }]);
  await refillPool(cfg, io, new Set(["claude"]), ["alice"]);
  assert.deepEqual(calls, ["adopt:pool-100-blank:alice"]);
});

test("an owner with no box and no blank one gets a box booted for them, and no blank box beside it", async () => {
  const { io, calls } = rig([]);
  await refillPool(cfg, io, new Set(["claude"]), ["alice"]);
  assert.deepEqual(calls, ["boot:claude:alice"]);
});

test("a box whose owner left, and a box from before owners existed, are removed", async () => {
  const { io, calls } = rig([
    { name: "pool-100-bob", owner: ownerTag("bob") },
    { name: "pool-200-old", owner: "legacy" },
    { name: "pool-300-alice", owner: ownerTag("alice") },
  ]);
  await refillPool(cfg, io, new Set(["claude"]), ["alice"]);
  assert.deepEqual(calls, ["rm:pool-100-bob", "rm:pool-200-old"]);
});

test("with nobody on the list the pool keeps one blank box, as before", async () => {
  const { io, calls } = rig([]);
  await refillPool(cfg, io, new Set(["claude"]), []);
  assert.deepEqual(calls, ["boot:claude:blank"]);
});

test("a host short of memory boots no warm box", async () => {
  const { io, calls } = rig([], 900);
  await refillPool(cfg, io, new Set(["claude"]), ["alice"]);
  assert.deepEqual(calls, []);
});

test("the warm box follows the agent an owner last started, and a saved default takes over again", async () => {
  const { ownerFlavor } = await import("../src/pool.js");
  const { noteOwnerAgent, lastOwnerAgent, forgetOwnerAgent } = await import("../src/warm-owners.js");
  assert.equal(ownerFlavor("carol", "omp"), "omp");
  assert.equal(ownerFlavor("carol", "claude"), "claude");
  assert.equal(noteOwnerAgent("carol", "omp"), true);
  assert.equal(noteOwnerAgent("carol", "omp"), false);
  assert.equal(lastOwnerAgent("carol"), "omp");
  forgetOwnerAgent("carol");
  assert.equal(lastOwnerAgent("carol"), undefined);
});

test("an owner who switched to omp gets an omp box and their Claude Code box is given up", async () => {
  const both = { ...cfg, ompPoolSize: 1, ompImage: "agent-omp" } as unknown as Config;
  const { io, calls } = rig([{ name: "pool-300-alice", owner: ownerTag("alice") }]);
  await refillPool(both, { ...io, ownerFlavor: () => "omp" as const }, new Set(["claude", "omp"]), ["alice"]);
  assert.deepEqual(calls, ["rm:pool-300-alice", "boot:omp:alice"]);
});
