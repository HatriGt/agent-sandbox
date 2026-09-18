/**
 * The transient booting-state copy. Pure, so covered here. Regression: a warm claim (a pre-booted
 * pool box reused instantly) was shown "Booting a fresh sandbox" — a visible lie. Only a real cold
 * boot (pool empty) may say that; a warm claim says it's starting on a warm sandbox.
 *
 * Staging: the booting pane must visibly PROGRESS when delegate returns the machine (assigning →
 * connecting to <name>) instead of repeating one line and then jump-cutting through a generic
 * skeleton — observed live as a rough three-screen transition.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bootingLabel, bootingHeadline, bootingStage } from "../web/src/lib/booting.ts";

test("bootingLabel: warm claim never says 'fresh sandbox'", () => {
  const warm = bootingLabel(true);
  assert.match(warm, /warm/i);
  assert.doesNotMatch(warm, /fresh sandbox/i);
});

test("bootingLabel: cold boot says fresh sandbox", () => {
  assert.match(bootingLabel(false), /fresh sandbox/i);
});

test("bootingHeadline: before the machine is known it is the boot copy; after, it names the machine", () => {
  assert.equal(bootingHeadline(true), bootingLabel(true));
  assert.equal(bootingHeadline(false), bootingLabel(false));
  assert.equal(bootingHeadline(true, "dusk-cedar"), "Connecting to dusk-cedar");
});

test("bootingStage: assigning until the machine is known, then connecting", () => {
  assert.equal(bootingStage(), "assigning");
  assert.equal(bootingStage(undefined), "assigning");
  assert.equal(bootingStage("dusk-cedar"), "connecting");
});
