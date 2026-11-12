import { test } from "node:test";
import assert from "node:assert/strict";
import { isChunkLoadError, shouldReload, RELOAD_GUARD_MS } from "./lazy-retry";

test("a missing chunk is recognised in every browser's wording", () => {
  assert.ok(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: https://x/dashboard/assets/Activity-B7MlUkqr.js")));
  assert.ok(isChunkLoadError(new TypeError("error loading dynamically imported module: https://x/a.js")));
  assert.ok(isChunkLoadError(new TypeError("Importing a module script failed.")));
  assert.ok(isChunkLoadError(new Error("Unable to preload CSS for /assets/a.css")));
  assert.ok(!isChunkLoadError(new Error("Cannot read properties of undefined")));
  assert.ok(!isChunkLoadError(null));
});

test("one reload per failure, never a loop", () => {
  assert.equal(shouldReload(null, 1000), true);
  assert.equal(shouldReload(1000, 1000 + RELOAD_GUARD_MS - 1), false);
  assert.equal(shouldReload(1000, 1000 + RELOAD_GUARD_MS + 1), true);
  assert.equal(shouldReload(Number.NaN, 5), true);
});
