// A tiny upstream MCP server for the code-mode integration test: a list big enough to be cut, a
// lookup with a required argument, a tool that reports an error and one that reports the env it
// was started with (to prove the upstream, not the script, holds the secrets).
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const items = Array.from({ length: 400 }, (_, i) => ({
  id: `IT-${1000 + i}`,
  title: `Item number ${i} with a reasonably long title to make the list large`,
  status: i % 3 === 0 ? "open" : "closed",
  owner: { email: `user${i}@example.com` },
}));

const tools = [
  {
    name: "list_items",
    description: "List tracker items. Returns every item unless filtered.",
    inputSchema: {
      type: "object",
      properties: { status: { type: "string", enum: ["open", "closed"] }, limit: { type: "integer" } },
      additionalProperties: false,
    },
  },
  {
    name: "get_item",
    description: "Get one tracker item by id.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "Item id, e.g. IT-1000" } }, required: ["id"], additionalProperties: false },
  },
  { name: "fail_tool", description: "Always fails.", inputSchema: { type: "object", properties: {} } },
  { name: "secret_probe", description: "Says whether the upstream received its token.", inputSchema: { type: "object", properties: {} } },
];

const server = new Server({ name: "tracker", version: "1" }, { capabilities: { tools: {} }, instructions: "Statuses are lower case: open or closed." });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const a = req.params.arguments ?? {};
  switch (req.params.name) {
    case "list_items": {
      const rows = items.filter((r) => !a.status || r.status === a.status).slice(0, a.limit ?? items.length);
      return { content: [{ type: "text", text: JSON.stringify({ items: rows }) }], structuredContent: { items: rows, next_cursor: null } };
    }
    case "get_item": {
      const row = items.find((r) => r.id === a.id);
      return row ? { content: [{ type: "text", text: JSON.stringify(row) }] } : { content: [{ type: "text", text: `no item ${a.id}` }], isError: true };
    }
    case "fail_tool":
      return { content: [{ type: "text", text: "boom: the tracker is down" }], isError: true };
    case "secret_probe":
      return { content: [{ type: "text", text: process.env.TRACKER_TOKEN === "s3cret-token" ? "token present" : "token missing" }] };
  }
  return { content: [{ type: "text", text: "unknown tool" }], isError: true };
});
await server.connect(new StdioServerTransport());
