import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { openMemoryDb } from "../src/db.js";
import { makeSecretBox } from "../src/secretbox.js";
import { registerUserStoreBackend } from "../src/user-store.js";
import { withPrincipal } from "../src/tenancy.js";
import {
  normalizeProviderInput,
  upsertProvider,
  loadProviders,
  deleteProvider,
  viewOf,
  refreshModels,
  modelsRequest,
  parseModelList,
  providerEnv,
  providerEnvFile,
  providerEgressDomains,
  providerFitsDriver,
} from "../src/providers.js";

function setup() {
  const db = openMemoryDb();
  registerUserStoreBackend({ db, box: makeSecretBox(crypto.randomBytes(32)) });
}

test("validation: https required except local kinds; injection chars refused", () => {
  assert.throws(() => normalizeProviderInput({ kind: "nope" }), /kind/);
  assert.throws(() => normalizeProviderInput({ kind: "openai", baseUrl: "http://x.com", apiKey: "sk-abcdef1234" }), /https/);
  assert.ok(normalizeProviderInput({ kind: "ollama", baseUrl: "http://10.0.0.2:11434" }));
  assert.throws(() => normalizeProviderInput({ kind: "anthropic" }), /API key/);
  assert.throws(() => normalizeProviderInput({ kind: "openai", apiKey: "sk-a'b" }), /not allowed/);
  assert.throws(() => normalizeProviderInput({ kind: "openai-compatible", baseUrl: "https://u:p@x.com" }), /credentials/);
  assert.equal(normalizeProviderInput({ kind: "openai", apiKey: "sk-1234567890" }).baseUrl, "https://api.openai.com/v1");
});

test("keys are masked in views and blank key on update keeps the stored one", () => {
  setup();
  const alice = { kind: "user" as const, userId: "u_p1", login: "alice", role: "user" as const, via: "session" as const };
  withPrincipal(alice, () => {
    const p = upsertProvider({ kind: "openai", apiKey: "sk-secret-abcd1234" });
    const v = viewOf(p);
    assert.equal(JSON.stringify(v).includes("sk-secret-abcd1234"), false);
    assert.equal(v.apiKeyMasked, "sk-…1234");
    assert.ok(v.drivers.includes("codex"));
    const p2 = upsertProvider({ label: "Mine", apiKey: "" }, p.id);
    assert.equal(p2.apiKey, "sk-secret-abcd1234");
    assert.equal(p2.label, "Mine");
  });
  assert.equal(loadProviders().length, 0, "other owners do not see it");
  withPrincipal(alice, () => {
    const [p] = loadProviders();
    assert.equal(deleteProvider(p.id), true);
    assert.equal(loadProviders().length, 0);
  });
});

test("model lists: per-kind request shape, parse, cache, failure keeps cache", async () => {
  setup();
  const p = upsertProvider({ kind: "ollama", baseUrl: "http://localhost:11434" });
  assert.equal(modelsRequest(p).url, "http://localhost:11434/api/tags");
  const a = { ...p, kind: "anthropic" as const, baseUrl: "https://api.anthropic.com", apiKey: "k-1234567890" };
  assert.equal(modelsRequest(a).headers["x-api-key"], "k-1234567890");
  assert.deepEqual(parseModelList("openai", { data: [{ id: "b" }, { id: "a" }, { id: "a" }] }), ["a", "b"]);
  let calls = 0;
  const ok = (async () => {
    calls++;
    return new Response(JSON.stringify({ models: [{ name: "llama3" }] }), { status: 200 });
  }) as typeof fetch;
  assert.deepEqual((await refreshModels(p.id, { fetchImpl: ok })).models, ["llama3"]);
  const again = await refreshModels(p.id, { fetchImpl: ok });
  assert.equal(again.cached, true);
  assert.equal(calls, 1);
  const bad = (async () => new Response("no", { status: 500 })) as typeof fetch;
  const r = await refreshModels(p.id, { fetchImpl: bad, force: true });
  assert.deepEqual(r.models, ["llama3"]);
  assert.match(r.error ?? "", /500/);
});

test("env, env file quoting, egress domains, driver fit", () => {
  const o = { id: "x", kind: "ollama" as const, label: "o", baseUrl: "http://gpu.lan:11434", createdAt: "" };
  assert.equal(providerEnv(o).OPENAI_BASE_URL, "http://gpu.lan:11434/v1");
  assert.deepEqual(providerEgressDomains(o), ["gpu.lan"]);
  assert.equal(providerFitsDriver(o, "opencode"), true);
  assert.equal(providerFitsDriver(o, "claude"), false);
  const a = { id: "y", kind: "anthropic" as const, label: "a", baseUrl: "https://api.anthropic.com", apiKey: "k", createdAt: "" };
  assert.equal(providerEnv(a, "m1").ANTHROPIC_MODEL, "m1");
  assert.equal(providerEnvFile({ A: "it's", "bad-key": "x" }), "export A='it'\\''s'\n");
});
