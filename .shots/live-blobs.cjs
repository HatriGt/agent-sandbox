// Runs INSIDE the agent-sandbox container: which owners hold agent-prefs / mcp-knowledge blobs.
const D = require("better-sqlite3");
const db = new D("/app/data/asb.sqlite", { readonly: true });
const cols = db.prepare("pragma table_info(user_blobs)").all().map((c) => c.name);
console.log("columns:", cols.join(","));
const rows = db.prepare("select * from user_blobs where kind in ('agent-prefs','mcp-knowledge')").all();
for (const r of rows) console.log(JSON.stringify({ ...r, data: undefined, blob: undefined, len: (r.data ?? r.blob ?? "").length }));
