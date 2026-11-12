import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearImageOverride, makeImageUpdater, planImageUpdate, readImageOverride, resolveImage, writeImageOverride, type ImageUpdateIO } from "../src/image-update.ts";

const baked = { "@anthropic-ai/claude-code": "2.1.273", "chrome-devtools-mcp": "1.12.0", "mcp-remote": "0.1.37", npm: "10.9.0", corepack: "0.29.4" };
const due = [
  { name: "@anthropic-ai/claude-code", baked: "2.1.273", latest: "2.1.322" },
  { name: "chrome-devtools-mcp", baked: "1.12.0", latest: "1.13.0" },
];

const list = ["chrome-devtools-mcp", "mcp-remote"];

test("planImageUpdate moves only what the notice names and pins the rest where it is", () => {
  const plan = planImageUpdate(baked, due, "2.1.273", list);
  assert.equal(plan.claudeCodeVersion, "2.1.322");
  assert.deepEqual(plan.pins, ["chrome-devtools-mcp@1.13.0", "mcp-remote@0.1.37"]);
  assert.deepEqual(plan.changes, due);
});

test("planImageUpdate keeps the configured Claude Code when it is not due", () => {
  const plan = planImageUpdate(baked, [due[1]], "2.1.273", list);
  assert.equal(plan.claudeCodeVersion, "2.1.273");
  assert.deepEqual(plan.pins, ["chrome-devtools-mcp@1.13.0", "mcp-remote@0.1.37"]);
});

test("planImageUpdate installs the list: an added package at its latest, a removed one not at all", () => {
  const changes = [
    { name: "@upstash/context7-mcp", baked: "", latest: "4.6.0" },
    { name: "chrome-devtools-mcp", baked: "1.12.0", latest: "" },
  ];
  const plan = planImageUpdate(baked, changes, "2.1.273", ["mcp-remote", "@upstash/context7-mcp"]);
  assert.deepEqual(plan.pins, ["@upstash/context7-mcp@4.6.0", "mcp-remote@0.1.37"]);
  assert.equal(plan.claudeCodeVersion, "2.1.273");
});

test("the override round-trips and applies only on top of the settings it was made on", () => {
  const dir = mkdtempSync(join(tmpdir(), "asb-img-"));
  assert.equal(readImageOverride(dir), null);
  const base = { claudeImage: "agent-claude:1", claudeCodeVersion: "2.1.273" };
  writeImageOverride(dir, { claudeImage: "agent-claude:2", claudeCodeVersion: "2.1.322", base, at: 5 });
  const o = readImageOverride(dir);
  assert.deepEqual(resolveImage(base, o), { claudeImage: "agent-claude:2", claudeCodeVersion: "2.1.322" });
  // The operator edited .env by hand afterwards: the hand edit wins.
  assert.deepEqual(resolveImage({ ...base, claudeImage: "agent-claude:9" }, o), { claudeImage: "agent-claude:9", claudeCodeVersion: "2.1.273" });
  assert.deepEqual(resolveImage({ ...base, claudeCodeVersion: "2.2.0" }, o), { claudeImage: "agent-claude:1", claudeCodeVersion: "2.2.0" });
  clearImageOverride(dir);
  assert.equal(readImageOverride(dir), null);
  assert.deepEqual(resolveImage(base, null), base);
});

function harness(over: Partial<ImageUpdateIO> = {}) {
  const calls: string[] = [];
  const io: ImageUpdateIO = {
    now: () => Date.UTC(2026, 10, 11, 9, 30),
    bake: async (tag, v, pins) => void calls.push(`bake ${tag} ${v} ${pins.join(",")}`),
    use: (i) => void calls.push(i ? `use ${i.claudeImage} ${i.claudeCodeVersion}` : "use previous"),
    verify: async () => ({ ok: true, detail: "12s" }),
    log: () => {},
    ...over,
  };
  return { calls, updater: makeImageUpdater(io) };
}
const settled = async (u: { busy: () => boolean }) => {
  for (let i = 0; i < 50 && u.busy(); i++) await new Promise((r) => setImmediate(r));
};

test("an update bakes, switches, verifies and ends done", async () => {
  const { calls, updater } = harness();
  const started = updater.start(planImageUpdate(baked, due, "2.1.273", list));
  assert.equal(started.phase, "building");
  assert.equal(started.tag, "agent-claude:202611110930");
  assert.throws(() => updater.start(planImageUpdate(baked, due, "2.1.273", list)), /already running/);
  await settled(updater);
  assert.equal(updater.state().phase, "done");
  assert.deepEqual(calls, ["bake agent-claude:202611110930 2.1.322 chrome-devtools-mcp@1.13.0,mcp-remote@0.1.37", "use agent-claude:202611110930 2.1.322"]);
});

test("a failed test task puts the previous image back", async () => {
  const { calls, updater } = harness({ verify: async () => ({ ok: false, detail: "no turn in 120s" }) });
  updater.start(planImageUpdate(baked, due, "2.1.273", list));
  await settled(updater);
  const s = updater.state();
  assert.equal(s.phase, "rolled-back");
  assert.match(s.detail ?? "", /no turn in 120s/);
  assert.equal(calls.at(-1), "use previous");
});

test("a failed build changes nothing", async () => {
  const { calls, updater } = harness({ bake: async () => Promise.reject(new Error("docker build\n exited 1")) });
  updater.start(planImageUpdate(baked, due, "2.1.273", list));
  await settled(updater);
  const s = updater.state();
  assert.equal(s.phase, "failed");
  assert.match(s.detail ?? "", /docker build exited 1/);
  assert.deepEqual(calls, []);
});

test("nothing due is refused", () => {
  const { updater } = harness();
  assert.throws(() => updater.start(planImageUpdate(baked, [], "2.1.273", list)), /up to date/);
});
