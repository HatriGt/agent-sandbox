// Code mode, the §13 round: the per-server decision, the knowledge an owner's runs accumulate, the
// prompt and configs for a split install, the install note read back, and the digest's mcp block.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideCodeMode, WRAP_MIN_TOOLS } from "../src/code-mode/decide.ts";
import { emptyKnowledge, knowledgeFile, knowledgeGrew, mergeKnowledge, parseKnowledge } from "../src/code-mode/knowledge.ts";
import { CODE_MODE_PROMPT, codeModeFiles, codeModeMixedConfig, codeModePromptFor, codeModeUpstreamConfig, codeModeWrapperEntry } from "../src/code-mode/index.ts";
import { mcpModeFromNotes } from "../src/msb.ts";
import { buildDigest, type DigestInput } from "../src/digest.ts";
import type { TraceEvent } from "../src/trace.ts";

const servers = {
  jira: { type: "http", url: "https://mcp.atlassian.com/v1/mcp" },
  hana: { type: "stdio", command: "npx", args: ["-y", "hana-mcp-server"] },
  chrome: { type: "stdio", command: "npx", args: ["-y", "chrome-devtools-mcp@latest"] },
  tiny: { type: "stdio", command: "node", args: ["/opt/tiny.mjs"] },
};

test("decide: off → every server direct; on → every server behind the script, a per-server override still wins", () => {
  const off = decideCodeMode({ setting: "off", servers, toolCounts: {} });
  assert.deepEqual(off.wrapped, []);
  assert.deepEqual(off.direct, ["chrome", "hana", "jira", "tiny"]);
  assert.equal(off.why.jira, "code mode is off");
  const on = decideCodeMode({ setting: "on", servers: { ...servers, chrome: { ...servers.chrome, codeMode: "direct" as const } }, toolCounts: {} });
  assert.deepEqual(on.wrapped, ["hana", "jira", "tiny"]);
  assert.deepEqual(on.direct, ["chrome"]);
  assert.equal(on.why.chrome, "set to direct");
  assert.equal(on.why.hana, "code mode is always on");
});

test("decide: auto wraps big and unknown servers, keeps small and step-by-step ones direct, and an override beats the rule", () => {
  const d = decideCodeMode({ setting: "auto", servers, toolCounts: { jira: 42, tiny: 3 } });
  assert.deepEqual(d.wrapped, ["hana", "jira"]);
  assert.deepEqual(d.direct, ["chrome", "tiny"]);
  assert.equal(d.why.jira, "42 tools");
  assert.equal(d.why.tiny, "3 tools");
  assert.equal(d.why.chrome, "works one step at a time");
  assert.match(d.why.hana, /not known yet/);
  assert.equal(decideCodeMode({ setting: "auto", servers: { tiny: servers.tiny }, toolCounts: { tiny: WRAP_MIN_TOOLS } }).wrapped[0], "tiny", "the threshold is inclusive");
  const forced = decideCodeMode({ setting: "auto", servers: { tiny: { ...servers.tiny, codeMode: "wrap" as const }, chrome: { ...servers.chrome, codeMode: "wrap" as const } }, toolCounts: { tiny: 1 } });
  assert.deepEqual(forced.wrapped, ["chrome", "tiny"]);
  assert.equal(forced.why.tiny, "set to code mode");
  assert.equal(decideCodeMode({ setting: "auto", servers: { one: { ...servers.tiny } }, toolCounts: { one: 1 } }).why.one, "1 tool");
});

test("knowledge: parse drops what is malformed, merge keeps the newest and caps, grew says when a harvest is worth saving", () => {
  assert.deepEqual(parseKnowledge(undefined), { shapes: {}, toolCounts: {}, snippets: {} });
  assert.deepEqual(parseKnowledge("not json"), { shapes: {}, toolCounts: {}, snippets: {} });
  const k = parseKnowledge(JSON.stringify({ shapes: { mcp__a__t: "{id}", bad: 5, "../x": "{}" }, toolCounts: { a: 12, b: "7", c: -1, d: 2.5 }, updatedAt: 5 }));
  assert.deepEqual(k, { shapes: { mcp__a__t: "{id}" }, toolCounts: { a: 12 }, snippets: {}, updatedAt: 5 });
  const merged = mergeKnowledge({ shapes: { x: "1", y: "1" }, toolCounts: { a: 1 }, snippets: {} }, { shapes: { x: "2", z: "1" }, toolCounts: { b: 2 }, snippets: {} }, 99);
  assert.deepEqual(merged, { shapes: { y: "1", x: "2", z: "1" }, toolCounts: { a: 1, b: 2 }, snippets: {}, updatedAt: 99 });
  const many = { shapes: Object.fromEntries(Array.from({ length: 600 }, (_, i) => [`s${i}`, "{}"])), toolCounts: {}, snippets: {} };
  const capped = mergeKnowledge(emptyKnowledge(), many, 1);
  assert.equal(Object.keys(capped.shapes).length, 500);
  assert.ok("s599" in capped.shapes && !("s0" in capped.shapes), "the oldest entries go first");
  assert.equal(knowledgeGrew(merged, { shapes: { x: "2" }, toolCounts: { b: 2 }, snippets: {} }), false);
  assert.equal(knowledgeGrew(merged, { shapes: {}, toolCounts: { b: 3 }, snippets: {} }), true);
  assert.equal(knowledgeFile(merged), JSON.stringify({ shapes: merged.shapes, toolCounts: merged.toolCounts }) + "\n", "the shipped file carries no timestamp");
});

test("prompt: the bench paragraph, then the servers behind the script and the ones that stay direct", () => {
  assert.equal(codeModePromptFor(["jira"]), `${CODE_MODE_PROMPT} Servers behind code mode: jira.`);
  const p = codeModePromptFor(["hana", "jira"], ["chrome"]);
  assert.ok(p.startsWith(CODE_MODE_PROMPT));
  assert.ok(p.includes("Servers behind code mode: hana, jira."));
  assert.ok(p.includes("The server chrome is direct instead: its mcp__<server>__<tool> tools are in this session as usual and are not reachable from a script."));
  assert.ok(codeModePromptFor(["a"], ["b", "c"]).includes("The servers b, c are direct instead: their"));
});

test("configs: the mixed one is the wrapper plus the direct servers, the upstream one only the wrapped servers with the deny list", () => {
  const conf = { mcpServers: servers, codeMode: { deny: ["mcp__jira__*delete*"] } };
  const mixed = codeModeMixedConfig(conf, ["hana", "jira"]);
  assert.deepEqual(Object.keys(mixed.mcpServers), ["code-mode", "chrome", "tiny"]);
  assert.deepEqual(mixed.mcpServers["code-mode"], codeModeWrapperEntry());
  assert.deepEqual(mixed.mcpServers.chrome, servers.chrome, "a direct server is passed through untouched");
  assert.deepEqual(codeModeUpstreamConfig(conf, ["hana", "jira"]), { mcpServers: { hana: servers.hana, jira: servers.jira }, codeMode: conf.codeMode });
  assert.deepEqual(codeModeUpstreamConfig({ mcpServers: servers }, ["jira", "nope"]), { mcpServers: { jira: servers.jira } });
});

test("files: the prompt and the knowledge ride with the server modules (from the built controller only)", () => {
  let files: ReturnType<typeof codeModeFiles>;
  try {
    files = codeModeFiles({ prompt: "P", knowledge: { shapes: { a: "{}" }, toolCounts: { s: 2 }, snippets: {} } });
  } catch {
    return; // under tsx there is no dist/code-mode/box; installMcpConfig notes the fallback
  }
  assert.equal(files.find((f) => f.name === "prompt.txt")?.contents, "P\n");
  assert.equal(files.find((f) => f.name === "knowledge.json")?.contents, '{"shapes":{"a":"{}"},"toolCounts":{"s":2}}\n');
});

test("notes: the install's code-mode line reads back as the split, a fallback as direct with its reason", () => {
  assert.deepEqual(mcpModeFromNotes(undefined), { mode: "direct", wrapped: [], direct: [] });
  assert.deepEqual(mcpModeFromNotes(["mcp-drop:x"]), { mode: "direct", wrapped: [], direct: [] });
  assert.deepEqual(mcpModeFromNotes(["code-mode: on (wrapped: hana, jira)"]), { mode: "script", wrapped: ["hana", "jira"], direct: [] });
  assert.deepEqual(mcpModeFromNotes(["mcp-skip:'x' free=1k", "code-mode: on (wrapped: jira; direct: chrome, tiny)"]), { mode: "mixed", wrapped: ["jira"], direct: ["chrome", "tiny"] });
  assert.deepEqual(mcpModeFromNotes(["code-mode: fallback (sdk: missing)"]), { mode: "direct", wrapped: [], direct: [], fallback: "sdk: missing" });
});

const base = (over: Partial<DigestInput> = {}): DigestInput => ({ box: "b", task: "t", runState: "done", exitCode: 0, events: [], files: [], ...over });
const run = (result: string): TraceEvent => ({ kind: "tool", name: "mcp__code-mode__run", arg: "const r = await call(…)", result });

test("digest: the mcp block carries the split and counts the run's scripts and their upstream calls", () => {
  assert.equal(buildDigest(base()).provenance?.mcp, undefined, "a direct run with no script records nothing, as before");
  const events = [run('{"n": 3}\n--- 4 MCP calls: 12k chars in, 1k out ---\n#1 mcp__jira__search 9k'), run("Error: the script did not compile — x"), run("[]\n--- 1 MCP call: 2k chars in, 0k out ---")];
  const d = buildDigest(base({ events, mcpMode: { mode: "mixed", wrapped: ["jira"], direct: ["chrome"] } }));
  assert.deepEqual(d.provenance?.mcp, { mode: "mixed", wrapped: ["jira"], direct: ["chrome"], scripts: 3, calls: 5 });
  const direct = buildDigest(base({ mcpMode: { mode: "direct", wrapped: [], direct: [], fallback: "sdk: missing" } }));
  assert.deepEqual(direct.provenance?.mcp, { mode: "direct", fallback: "sdk: missing" });
  const inferred = buildDigest(base({ events: [run("1\n--- 2 MCP calls: 1k chars in, 0k out ---")] }));
  assert.deepEqual(inferred.provenance?.mcp, { mode: "script", scripts: 1, calls: 2 }, "an older box without notes still shows the scripts it ran");
});

test("knowledge: saved scripts parse, merge newest-wins with the higher run count, cap at 40, and ride in the shipped file", () => {
  const snip = { description: "d", code: "return 1", calls: ["mcp__a__t"], savedAt: 5, runs: 2 };
  const k = parseKnowledge(JSON.stringify({ snippets: { good: snip, "bad name!": snip, nocode: { description: "x" }, loose: { code: "return 2", calls: [5, "mcp__b__u"] } } }));
  assert.deepEqual(Object.keys(k.snippets), ["good", "loose"]);
  assert.deepEqual(k.snippets.good, snip);
  assert.deepEqual(k.snippets.loose, { description: "", code: "return 2", calls: ["mcp__b__u"], savedAt: 0, runs: 0 });
  const merged = mergeKnowledge(
    { shapes: {}, toolCounts: {}, snippets: { a: { ...snip, runs: 7 }, b: snip } },
    { shapes: {}, toolCounts: {}, snippets: { a: { ...snip, code: "return 3", runs: 1 } } },
    1
  );
  assert.deepEqual(Object.keys(merged.snippets), ["b", "a"], "the box's copy comes last (newest)");
  assert.equal(merged.snippets.a.code, "return 3");
  assert.equal(merged.snippets.a.runs, 7, "a run count never goes down");
  const many = { shapes: {}, toolCounts: {}, snippets: Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`s${i}`, snip])) };
  assert.equal(Object.keys(mergeKnowledge(emptyKnowledge(), many, 1).snippets).length, 40);
  assert.equal(knowledgeGrew(merged, { shapes: {}, toolCounts: {}, snippets: { a: merged.snippets.a } }), false);
  assert.equal(knowledgeGrew(merged, { shapes: {}, toolCounts: {}, snippets: { a: { ...merged.snippets.a, runs: 8 } } }), true);
  assert.equal(knowledgeFile(merged), JSON.stringify({ shapes: {}, toolCounts: {}, snippets: merged.snippets }) + "\n");
  assert.equal(knowledgeFile(emptyKnowledge()), '{"shapes":{},"toolCounts":{}}\n', "no snippets key when there are none");
});
