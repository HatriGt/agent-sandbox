import test from "node:test";
import assert from "node:assert/strict";
import { isSecretKey, mask, mergeSecrets, replaceFromJson, toEditableConfig, viewServers, type McpStore } from "../src/mcp-store.ts";

const store: McpStore = {
  servers: {
    hana: {
      name: "hana",
      type: "stdio",
      command: "hana-mcp-server",
      env: { HANA_HOST: "db.internal", HANA_PORT: "443", HANA_PASSWORD: "sup3r-secret-value" },
      enabled: true,
      addedAt: 10,
    },
    linear: { name: "linear", type: "http", url: "https://mcp.linear.app/mcp", headers: { Authorization: "Bearer abcdefgh" }, enabled: false, addedAt: 20 },
  },
};

test("only secret-looking keys are masked; plain config values show in full", () => {
  assert.equal(isSecretKey("HANA_PASSWORD"), true);
  assert.equal(isSecretKey("Authorization"), true);
  assert.equal(isSecretKey("HANA_HOST"), false);
  const view = viewServers(store).find((s) => s.name === "hana")!;
  assert.equal(view.env!.HANA_HOST, "db.internal");
  assert.equal(view.env!.HANA_PASSWORD, mask("sup3r-secret-value"));
});

test("the editable config is Claude/Cursor shaped, with disabled:true for off servers", () => {
  const cfg = toEditableConfig(store);
  assert.deepEqual(Object.keys(cfg.mcpServers), ["hana", "linear"]);
  assert.equal((cfg.mcpServers.linear as { disabled?: boolean }).disabled, true);
  assert.equal((cfg.mcpServers.hana as { disabled?: boolean }).disabled, undefined);
  assert.equal((cfg.mcpServers.hana as { env: Record<string, string> }).env.HANA_PASSWORD, mask("sup3r-secret-value"));
});

test("replacing from edited JSON keeps stored secrets the editor only saw masked, and respects renames/removals", () => {
  const cfg = toEditableConfig(store);
  const edited = JSON.parse(JSON.stringify(cfg)) as { mcpServers: Record<string, Record<string, unknown>> };
  (edited.mcpServers.hana.env as Record<string, string>).HANA_HOST = "db2.internal"; // plain edit
  delete edited.mcpServers.linear; // removal
  edited.mcpServers.newone = { command: "npx", args: ["-y", "x"], env: { X_TOKEN: "fresh" } };
  const next = replaceFromJson(store, JSON.stringify(edited), 99);
  assert.equal(next.servers.hana.env!.HANA_PASSWORD, "sup3r-secret-value", "masked secret survives");
  assert.equal(next.servers.hana.env!.HANA_HOST, "db2.internal");
  assert.equal(next.servers.hana.addedAt, 10, "identity kept");
  assert.equal(next.servers.linear, undefined);
  assert.equal(next.servers.newone.env!.X_TOKEN, "fresh");
  assert.equal(next.servers.newone.addedAt, 99);
});

test("mergeSecrets: blank or masked incoming → stored; anything else replaces", () => {
  const prev = { A: "keep-me-please", B: "old" };
  assert.deepEqual(mergeSecrets({ A: mask("keep-me-please"), B: "new", C: "c" }, prev), { A: "keep-me-please", B: "new", C: "c" });
  assert.deepEqual(mergeSecrets({ A: "" }, prev), { A: "keep-me-please" });
});
