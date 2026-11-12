// Which element a pointer means, and the words that carry a picked element to the agent.
// Run from web/:  npx --yes tsx --tsconfig tsconfig.json --test src/lib/browser-model.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { elementNote, hitTest, type MappedElement } from "./browser-model";

const map: MappedElement[] = [
  [0, 0, 800, 600, "main", "main", ""],
  [20, 20, 300, 100, "div", "div.card", "Pricing Start free"],
  [40, 60, 120, 40, "a", "a.button", "Start free"],
  [40, 60, 120, 40, "span", "span.label", "Start free"],
];

test("hitTest picks the smallest box under the pointer, the deeper one on a tie", () => {
  assert.equal(hitTest(map, 500, 500), 0);
  assert.equal(hitTest(map, 200, 30), 1);
  assert.equal(hitTest(map, 60, 70), 3);
  assert.equal(hitTest(map, 900, 10), -1);
  assert.equal(hitTest([], 1, 1), -1);
});

test("elementNote is one line with the exact selector, the text and the size", () => {
  const note = elementNote(2, "http://localhost:5173/pricing", map[2], {
    selector: "main > div.card > a.button",
    text: "Start free",
    html: '<a class="button" title="it`s free" href="/signup">',
    component: "PricingCard",
    style: { font: "Inter 14px" },
  });
  assert.equal(
    note,
    "Element 2, picked in the browser on http://localhost:5173/pricing: selector `main > div.card > a.button`; text \"Start free\"; html `<a class=\"button\" title=\"it's free\" href=\"/signup\">`; component PricingCard; 120 x 40 px in Inter 14px.",
  );
  assert.ok(!note.includes("\n"));
});

test("elementNote falls back to the map's label and leaves out a minified component name", () => {
  assert.equal(elementNote(1, "https://react.dev/", map[2], null), 'Element 1, picked in the browser on https://react.dev/: selector `a.button`; text "Start free"; 120 x 40 px.');
  assert.doesNotMatch(elementNote(1, "https://react.dev/", map[2], { component: "t" }), /component/);
});
