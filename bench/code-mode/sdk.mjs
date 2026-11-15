// The MCP SDK for the bench's fake servers, resolved like the code-mode server resolves it: next to
// this file, then the global node_modules root ($R or /usr/local/lib/node_modules).
import { createRequire } from "node:module";

export function loadSdk() {
  for (const base of [import.meta.url, `${(process.env.R || "/usr/local/lib/node_modules").replace(/\/+$/, "")}/`]) {
    try {
      const req = createRequire(base);
      return {
        Server: req("@modelcontextprotocol/sdk/server/index.js").Server,
        StdioServerTransport: req("@modelcontextprotocol/sdk/server/stdio.js").StdioServerTransport,
        types: req("@modelcontextprotocol/sdk/types.js"),
      };
    } catch {
      // try the next root
    }
  }
  throw new Error("@modelcontextprotocol/sdk is not installed");
}
