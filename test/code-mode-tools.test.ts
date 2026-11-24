import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deniedBy,
  isWriteTool,
  literalCalls,
  literalKeys,
  maskComments,
  nearest,
  normalizeCode,
  precheck,
  renderCatalog,
  renderIndex,
  renderTool,
  schemaToType,
  searchTools,
  selectTools,
  splitName,
  tokens,
  type ToolDef,
} from "../src/code-mode/box/tools.ts";

const tool = (server: string, name: string, description: string, inputSchema: unknown = { type: "object", properties: {} }): ToolDef => ({
  server,
  name,
  full: `mcp__${server}__${name}`,
  description,
  inputSchema,
});

// --- schema → type -----------------------------------------------------------------------------

test("schemaToType: primitives, optional fields, enums, arrays and quoted keys", () => {
  const s = {
    type: "object",
    properties: {
      database: { type: "string" },
      limit: { type: "integer" },
      status: { enum: ["open", "closed"] },
      tags: { type: "array", items: { type: "string" } },
      "x-mode": { type: ["string", "null"] },
      either: { anyOf: [{ type: "string" }, { type: "number" }] },
    },
    required: ["database"],
  };
  assert.equal(
    schemaToType(s),
    '{ database: string; limit?: number; status?: "open" | "closed"; tags?: string[]; "x-mode"?: string | null; either?: string | number }'
  );
});

test("schemaToType: $ref resolves against the root, a cycle becomes unknown", () => {
  const s = {
    type: "object",
    properties: { root: { $ref: "#/$defs/node" } },
    $defs: { node: { type: "object", properties: { name: { type: "string" }, children: { type: "array", items: { $ref: "#/$defs/node" } } } } },
  };
  assert.equal(schemaToType(s), "{ root?: { name?: string; children?: unknown[] } }");
  assert.equal(schemaToType({ $ref: "#/definitions/missing" }), "unknown");
});

test("schemaToType: additionalProperties becomes an index signature; depth is capped", () => {
  assert.equal(schemaToType({ type: "object", additionalProperties: { type: "number" } }), "{ [key: string]: number }");
  assert.equal(schemaToType({ type: "object", properties: { a: { type: "string" } }, additionalProperties: true }), "{ a?: string; [key: string]: unknown }");
  assert.equal(schemaToType({ type: "object" }), "Record<string, unknown>");
  let deep: Record<string, unknown> = { type: "string" };
  for (let i = 0; i < 8; i++) deep = { type: "object", properties: { x: deep } };
  assert.match(schemaToType(deep), /x\?: object/);
  assert.equal(schemaToType({ type: "array", items: { anyOf: [{ type: "string" }, { type: "number" }] } }), "(string | number)[]");
});

test("renderTool: signatures, full docs with @param, and a remembered shape", () => {
  const t = tool("hana", "hana_list_tables", "List tables in a schema. Pages with limit/offset.", {
    type: "object",
    properties: { database: { type: "string", description: "Which database" }, limit: { type: "integer" } },
    required: ["database"],
  });
  assert.equal(renderTool(t, "signatures"), "### mcp__hana__hana_list_tables\nList tables in a schema.\nargs: { database: string; limit?: number }");
  const full = renderTool(t, "full", "{rows: [3 × {id, name}]}");
  assert.match(full, /@param database - Which database/);
  assert.match(full, /returns \(earlier call\): \{rows: \[3 × \{id, name\}\]\}/);
  assert.equal(renderTool(t, "names"), "mcp__hana__hana_list_tables — List tables in a schema.");
});

// --- search ------------------------------------------------------------------------------------

const catalog = [
  tool("jira", "searchJiraIssuesUsingJql", "Search Jira issues with a JQL query."),
  tool("jira", "getJiraIssue", "Get one Jira issue by key."),
  tool("hana", "hana_list_tables", "List tables. Results mention jira only in passing."),
  tool("hana", "hana_execute_query", "Run a SQL query against HANA."),
  tool("btp", "Apps_list", "List Cloud Foundry apps."),
];

test("search: words split on camelCase and snake_case", () => {
  assert.deepEqual(tokens("searchJiraIssuesUsingJQL hana_list-tables"), ["search", "jira", "issues", "using", "jql", "hana", "list", "tables"]);
});

test("search: name beats server beats description", () => {
  const r = searchTools(catalog, "jira").map((t) => t.full);
  assert.deepEqual(r.slice(0, 2), ["mcp__jira__getJiraIssue", "mcp__jira__searchJiraIssuesUsingJql"]);
  assert.equal(r[2], "mcp__hana__hana_list_tables");
});

test("search: up to two words must all match; longer queries need 60%", () => {
  assert.deepEqual(searchTools(catalog, "list tables").map((t) => t.full), ["mcp__hana__hana_list_tables"]);
  assert.deepEqual(searchTools(catalog, "list nothingmatches"), []);
  // 3 of 4 words hit (75% ≥ 60%), so a sentence-like query still finds the tool.
  assert.ok(searchTools(catalog, "run sql query zebra").some((t) => t.full === "mcp__hana__hana_execute_query"));
  assert.deepEqual(searchTools(catalog, "run zebra yak gnu"), []);
});

test("search: an empty query lists everything; at most 30 results", () => {
  assert.equal(searchTools(catalog, "").length, catalog.length);
  const many = Array.from({ length: 50 }, (_, i) => tool("s", `list_${i}`, "list"));
  assert.equal(searchTools(many, "list").length, 30);
});

// --- normalise ---------------------------------------------------------------------------------

const code = (s: string) => {
  const r = normalizeCode(s);
  assert.ok("code" in r, JSON.stringify(r));
  return r.code;
};

test("catalog: signatures while they fit, then names, then bare names, then a count; notes first", () => {
  const tools = Array.from({ length: 40 }, (_, i) =>
    tool(i % 2 ? "b" : "a", `tool_${String(i).padStart(2, "0")}`, `Does thing ${i}. More text.`, { type: "object", properties: { id: { type: "string" } }, required: ["id"] })
  );
  const notes = new Map([["a", "Always pass id."]]);
  const sig = renderCatalog(tools, notes, 100_000);
  assert.match(sig, /^a says: Always pass id\.\n/);
  assert.match(sig, /^mcp__a__tool_00\(\{ id: string \}\) — Does thing 0\.$/m);
  assert.equal(sig.split("\n").length, 41);
  const named = renderCatalog(tools, notes, 1_700);
  assert.match(named, /^mcp__a__tool_00 — Does thing 0\.$/m);
  assert.match(named, /\(argument types: search\)$/);
  const bare = renderCatalog(tools, notes, 600);
  assert.match(bare, /^mcp__a__: tool_00, tool_02, /m);
  const cut = renderCatalog(tools, notes, 300);
  assert.match(cut, /…and \d+ more tools: find them with search$/);
  assert.ok(cut.length <= 400);
  // Sorted: the same tools in another order give the same text (the prompt cache depends on it).
  assert.equal(renderCatalog([...tools].reverse(), notes, 100_000), sig);
});

test("catalog: the summary shrinks before the argument types are dropped", () => {
  const long = "Resolve where a service's paging route lands at a given instant, with the responder and rotation.";
  const tools = Array.from({ length: 10 }, (_, i) => tool("ops", `t${i}`, long, { type: "object", properties: { at: { type: "string" } } }));
  const full = renderCatalog(tools, new Map(), 100_000);
  assert.match(full, /^mcp__ops__t0\(\{ at\?: string \}\) — Resolve where .* rotation\.$/m);
  const short = renderCatalog(tools, new Map(), full.length - 200);
  assert.match(short, /^mcp__ops__t0\(\{ at\?: string \}\) — Resolve where a service's paging route.*…$/m);
  assert.ok(short.length <= full.length - 200);
});

test("search: a limit of Infinity returns every match, for the 'N of M shown' line", () => {
  const many = Array.from({ length: 45 }, (_, i) => tool("s", `get_thing_${i}`, "Gets a thing."));
  assert.equal(searchTools(many, "thing").length, 30);
  assert.equal(searchTools(many, "thing", Infinity).length, 45);
});

test("normalize: a fence is stripped and a trailing expression is returned", () => {
  assert.equal(code("```js\nconst a = 1\na + 1\n```"), "const a = 1\nreturn (a + 1\n);");
  assert.equal(code("return 5"), "return 5");
});

test("normalize: export default and a lone function are called", () => {
  assert.equal(code("export default async function main() { return 1 }"), "return await (async function main() { return 1 })();");
  assert.equal(code("async () => { return 2 }"), "return await (async () => { return 2 })();");
});

test("normalize: a multi-line trailing expression and a function declared then called", () => {
  assert.equal(code("const r = [1, 2]\nr.map((x) => {\n  return x * 2\n})"), "const r = [1, 2]\nreturn (r.map((x) => {\n  return x * 2\n})\n);");
  assert.equal(code("async function main() { return 3 }\nmain()"), "async function main() { return 3 }\nreturn (main()\n);");
  // A script that ends in a statement keeps its own shape.
  assert.equal(code("for (const x of [1]) {\n  console.log(x)\n}"), "for (const x of [1]) {\n  console.log(x)\n}");
});

test("normalize: a syntax error names the line", () => {
  const r = normalizeCode("const a = 1\nconst b = (\nreturn a");
  assert.ok("error" in r);
  assert.match(r.error, /SyntaxError/);
  assert.match(r.error, /line \d/);
  assert.ok("error" in normalizeCode("   "));
});

// --- pre-run check -----------------------------------------------------------------------------

const ctx = {
  servers: ["jira", "hana", "down"],
  tools: new Map([
    ["jira", [tool("jira", "getJiraIssue", "", { type: "object", properties: { issueKey: { type: "string" }, fields: { type: "array" } }, required: ["issueKey"] })]],
    ["hana", [tool("hana", "hana_execute_query", "", { type: "object", properties: { sql: { type: "string" } }, additionalProperties: true })]],
  ]),
  deny: ["mcp__hana__*_drop*"],
};

test("precheck: an unknown tool refuses the whole run with its line and the nearest name", () => {
  const r = precheck('const a = await call("mcp__jira__getJiraIssue", { issueKey: "A-1" })\nconst b = await call("mcp__jira__getJiraIsue", { issueKey: "A-2" })', ctx);
  assert.match(r!, /mcp__jira__getJiraIsue does not exist/);
  assert.match(r!, /Nearest: mcp__jira__getJiraIssue/);
  assert.match(r!, /line 2:/);
  assert.match(precheck('await call("getJiraIssue", {})', ctx)!, /Nearest: mcp__jira__getJiraIssue/);
});

test("precheck: an unknown argument key or a missing required key refuses", () => {
  assert.match(precheck('await call("mcp__jira__getJiraIssue", { issuekey: "A-1" })', ctx)!, /no argument "issuekey".*nearest: issueKey/);
  assert.match(precheck('await call("mcp__jira__getJiraIssue", { fields: ["x"] })', ctx)!, /needs "issueKey"/);
  assert.match(precheck('await call("mcp__jira__getJiraIssue")', ctx)!, /needs "issueKey"/);
  // Open schemas (additionalProperties) accept any key.
  assert.equal(precheck('await call("mcp__hana__hana_execute_query", { sql: "x", anything: 1 })', ctx), undefined);
});

test("precheck: variables, spreads, computed keys and unconnected servers are left to run time", () => {
  assert.equal(precheck("const n = 'mcp__jira__nope'; await call(n, {})", ctx), undefined);
  assert.equal(precheck('await call("mcp__jira__" + t, {})', ctx), undefined);
  assert.equal(precheck('await call("mcp__jira__getJiraIssue", args)', ctx), undefined);
  assert.equal(precheck('await call("mcp__jira__getJiraIssue", { ...base, typo: 1 })', ctx), undefined);
  assert.equal(precheck('await call("mcp__jira__getJiraIssue", { [k]: 1 })', ctx), undefined);
  assert.equal(precheck('await call("mcp__down__anything", { x: 1 })', ctx), undefined);
  // A commented-out call and a method named call are not checked.
  assert.equal(precheck('// await call("mcp__jira__nope", {})\nfoo.call("mcp__jira__nope")', ctx), undefined);
});

test("precheck: nested values, strings with commas and shorthand keys parse as keys", () => {
  assert.deepEqual(literalKeys(' issueKey, fields: ["a,b", { c: 1 }], "quoted-key": f(1, 2) '), ["issueKey", "fields", "quoted-key"]);
  assert.equal(precheck('const issueKey = "A"; await call("mcp__jira__getJiraIssue", { issueKey, fields: [{ x: "}" }] })', ctx), undefined);
});

test("precheck: a denied tool is refused before anything runs", () => {
  assert.match(precheck('await call("mcp__hana__hana_drop_table", {})', ctx)!, /denied by the rule "mcp__hana__\*_drop\*"/);
});

test("precheck helpers: comments masked without touching strings; names split by the longest server", () => {
  assert.equal(maskComments('a // c\n"// not" /* x */ b'), 'a     \n"// not"         b');
  assert.deepEqual(splitName("mcp__a__b__tool", ["a", "a__b"]), { server: "a__b", tool: "tool" });
  assert.equal(splitName("mcp__zzz__t", ["a"]), undefined);
  assert.deepEqual(literalCalls('x\nawait call(`mcp__a__b`, {})\ncall(`mcp__${s}__t`)').map((c) => [c.name, c.line]), [["mcp__a__b", 2]]);
  assert.equal(nearest("mcp__jira__getIssue", ["mcp__jira__getJiraIssue", "mcp__hana__x"]), "mcp__jira__getJiraIssue");
});

// --- policy ------------------------------------------------------------------------------------

test("policy: exact names, server wildcards and inner wildcards; nothing else is a pattern", () => {
  const deny = ["mcp__jira__createJiraIssue", "mcp__btp__*", "mcp__*__delete_*"];
  assert.equal(deniedBy("mcp__jira__createJiraIssue", deny), "mcp__jira__createJiraIssue");
  assert.equal(deniedBy("mcp__jira__createJiraIssues", deny), undefined);
  assert.equal(deniedBy("mcp__btp__Apps_list", deny), "mcp__btp__*");
  assert.equal(deniedBy("mcp__hana__delete_rows", deny), "mcp__*__delete_*");
  assert.equal(deniedBy("mcp__hana__list", deny), undefined);
  assert.equal(deniedBy("mcp__aXb__t", ["mcp__a.b__t"]), undefined);
});

// --- approval, exact names, the index ----------------------------------------------------------

test("isWriteTool: the server's annotation decides, else the words of the name; execute/query/run read", () => {
  assert.equal(isWriteTool(tool("cf", "Apps_create", "")), true);
  assert.equal(isWriteTool(tool("cf", "CF_AppAction", "")), true);
  assert.equal(isWriteTool(tool("jira", "transitionJiraIssue", "")), true);
  assert.equal(isWriteTool(tool("hana", "hana_execute_query", "")), false);
  assert.equal(isWriteTool(tool("cf", "Apps_list", "")), false);
  assert.equal(isWriteTool({ ...tool("x", "delete_all", ""), readOnly: true }), false, "readOnlyHint wins over the name");
  assert.equal(isWriteTool({ ...tool("x", "poke", ""), destructive: true }), true, "destructiveHint wins over the name");
});

test("search: readers rank above writers unless the query asks for a change", () => {
  const cat = [tool("cf", "Apps_create", "Create an app."), tool("cf", "Apps_list", "List apps."), tool("cf", "Apps_delete", "Delete an app."), tool("cf", "Apps_get", "Get an app.")];
  assert.deepEqual(searchTools(cat, "apps").map((t) => t.name), ["Apps_get", "Apps_list", "Apps_create", "Apps_delete"]);
  assert.equal(searchTools(cat, "delete an app")[0].name, "Apps_delete");
});

test("selectTools: select:a,b and bare full names return exactly those; words are not a selection", () => {
  const cat = [tool("cf", "Apps_list", ""), tool("cf", "Apps_get", ""), tool("hana", "hana_list_tables", "")];
  assert.deepEqual(selectTools(cat, "select:mcp__cf__Apps_get,mcp__hana__hana_list_tables")!.hits.map((t) => t.full), ["mcp__cf__Apps_get", "mcp__hana__hana_list_tables"]);
  assert.deepEqual(selectTools(cat, "mcp__cf__Apps_list mcp__cf__nope"), { hits: [cat[0]], missing: ["mcp__cf__nope"] });
  assert.deepEqual(selectTools(cat, "select: Apps_get")!.hits, [cat[1]], "a unique bare name works too");
  assert.equal(selectTools(cat, "list apps"), undefined);
  assert.equal(selectTools(cat, ""), undefined);
});

test("renderIndex: one line per server, readers first, within the budget; a big server loses its tail", () => {
  const cat = [tool("cf", "Apps_delete", ""), tool("cf", "Apps_list", ""), tool("cf", "Apps_get", ""), tool("hana", "hana_list_tables", "")];
  assert.equal(renderIndex(cat, 1000), "mcp__cf__: Apps_get, Apps_list, Apps_delete\nmcp__hana__: hana_list_tables");
  const big = [...Array.from({ length: 60 }, (_, i) => tool("s", `tool_number_${i}`, "")), tool("t", "one", "")];
  const text = renderIndex(big, 400);
  assert.ok(text.length <= 400, `${text.length} chars`);
  assert.match(text, /^mcp__s__: tool_number_0, .*, \+\d+ more$/m);
  assert.match(text, /^mcp__t__: one$/m, "the small server keeps its whole line");
});
