/**
 * The model catalog: labeling, tiering, ccproxy filtering, and the allowlist gate every model
 * override must pass before it reaches an -e ANTHROPIC_MODEL flag.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isAllowedModel, isClaudeAlias, labelFor, parseCatalog, tierOf } from "../src/models.ts";

test("labelFor prettifies the real proxy aliases; unparseable ids fall back to raw", () => {
  assert.equal(labelFor("ak-claude-opus-4.8"), "Opus 4.8");
  assert.equal(labelFor("ak-claude-haiku-4.5"), "Haiku 4.5");
  assert.equal(labelFor("ak-claude-opus-5-medium"), "Opus 5 (medium)");
  assert.equal(labelFor("ak-claude-opus-4.8-high"), "Opus 4.8 (high)");
  assert.equal(labelFor("ak-claude-opus4-7"), "Opus 4.7");
  assert.equal(labelFor("ak-claude-sonnet-5"), "Sonnet 5");
  assert.equal(labelFor("claude-3-7-sonnet-20250219"), "Sonnet 3.7");
  assert.equal(labelFor("totally-unknown"), "totally-unknown");
});

test("tierOf buckets by family", () => {
  assert.equal(tierOf("ak-claude-opus-4.8"), "opus");
  assert.equal(tierOf("ak-claude-sonnet-5"), "sonnet");
  assert.equal(tierOf("ak-claude-haiku-4.5"), "haiku");
  assert.equal(tierOf("claude-fable-5-1"), "opus");
});

test("parseCatalog keeps Claude aliases only, tier-ordered", () => {
  const body = JSON.stringify({
    data: [
      { id: "gpt-5-mini" },
      { id: "ak-claude-haiku-4.5" },
      { id: "gpt-4.1-mini" },
      { id: "ak-claude-opus-4.8" },
      { id: "ak-claude-sonnet-5" },
    ],
  });
  const cat = parseCatalog(body);
  assert.deepEqual(cat.map((m) => m.id), ["ak-claude-opus-4.8", "ak-claude-sonnet-5", "ak-claude-haiku-4.5"]);
  assert.ok(!cat.some((m) => !isClaudeAlias(m.id)));
  assert.deepEqual(parseCatalog("not json"), []);
});

test("isAllowedModel: catalog members and configured defaults pass; everything else is refused", () => {
  const cat = parseCatalog(JSON.stringify({ data: [{ id: "ak-claude-haiku-4.5" }] }));
  const cfg = { anthropicModel: "ak-claude-opus-4.8", askModel: "ak-claude-sonnet-5" };
  assert.equal(isAllowedModel("ak-claude-haiku-4.5", cat, cfg), true);
  assert.equal(isAllowedModel("ak-claude-opus-4.8", cat, cfg), true); // default, even if unlisted
  assert.equal(isAllowedModel("ak-claude-sonnet-5", cat, cfg), true); // ask default
  assert.equal(isAllowedModel("gpt-5-mini", cat, cfg), false); // served by proxy but filtered
  assert.equal(isAllowedModel("bogus", cat, cfg), false);
});
