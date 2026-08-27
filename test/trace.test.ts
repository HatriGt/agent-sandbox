/**
 * The dashboard's trace parser. It lives in web/src (it renders in the browser) but it is pure and
 * dependency-free, so it is covered here rather than dragging a second test runner into the repo.
 *
 * Its input is real: the lines below are the shape `stream-fmt.js` actually appends to
 * /workspace/.agent.log, copied from live runs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTrace, resultSummary, clean, producedFiles } from "../web/src/lib/trace.ts";
import { normalizeBlocks } from "../web/src/lib/markdown-normalize.ts";
import { doneLabel, isFailedExit } from "../web/src/lib/format.ts";

const REAL_LOG = [
  "● session started (model ak-claude-opus-4.8)",
  "I'll write these one at a time. Starting with a.md on filesystem isolation.",
  "→ Write: /workspace/a.md",
  "  File created successfully at: /workspace/a.md (file state is current in your context)",
  "a.md done. Now b.md on network isolation and egress control.",
  "→ Write: /workspace/b.md",
  "  File created successfully at: /workspace/b.md",
].join("\n");

test("parses a real log into speech, tool calls, and lifecycle events", () => {
  const ev = parseTrace(REAL_LOG);
  assert.deepEqual(
    ev.map((e) => e.kind),
    ["lifecycle", "say", "tool", "say", "tool"]
  );

  assert.deepEqual(ev[0], { kind: "lifecycle", label: "session started", detail: "model ak-claude-opus-4.8" });

  assert.equal(ev[1].kind, "say");
  if (ev[1].kind === "say") assert.match(ev[1].text, /filesystem isolation/);

  // A tool call carries its argument and absorbs the indented result that follows it.
  assert.equal(ev[2].kind, "tool");
  if (ev[2].kind === "tool") {
    assert.equal(ev[2].name, "Write");
    assert.equal(ev[2].arg, "/workspace/a.md");
    assert.match(ev[2].result!, /File created successfully/);
  }
});

test("consecutive prose lines coalesce into one turn, not one per line", () => {
  const ev = parseTrace("First line.\nSecond line.\nThird line.");
  assert.equal(ev.length, 1);
  assert.equal(ev[0].kind, "say");
  if (ev[0].kind === "say") assert.equal(ev[0].text, "First line.\nSecond line.\nThird line.");
});

test("multi-line tool output stays attached to its call", () => {
  const ev = parseTrace(["→ Bash: npm test", "  120 passing", "  0 failing"].join("\n"));
  assert.equal(ev.length, 1);
  if (ev[0].kind === "tool") assert.equal(ev[0].result, "120 passing\n0 failing");
});

test("tool output keeps its OWN indentation (only the formatter's 2-space prefix is stripped)", () => {
  // The formatter prefixes every result line with two spaces. A result that is itself indented —
  // a diff, JSON, a tree — must keep that structure; flattening all leading whitespace turned
  // readable output into an unreadable left-justified blob.
  const ev = parseTrace(["→ Bash: ls -R", "  src/", "      app.ts", "      util.ts"].join("\n"));
  assert.equal(ev.length, 1);
  if (ev[0].kind === "tool") assert.equal(ev[0].result, "src/\n    app.ts\n    util.ts");
});

test("a blank line inside a result block stays part of the result", () => {
  // Command output with paragraph breaks (e.g. two-file cat) should not split into a truncated
  // result plus stray prose.
  const ev = parseTrace(["→ Bash: cat a b", "  hello", "  ", "  world"].join("\n"));
  assert.equal(ev.length, 1);
  if (ev[0].kind === "tool") assert.equal(ev[0].result, "hello\n\nworld");
});

test("a markdown table stays in ONE say block, not split across bubbles", () => {
  // The df -h failure: a GFM table followed by a heading must arrive as a single prose block so the
  // renderer sees valid table structure. Splitting rows across bubbles renders it as inline text.
  const log = [
    "Here is the disk usage:",
    "",
    "| Filesystem | Size | Used |",
    "|------------|------|------|",
    "| overlay | 3.9G | 469M |",
    "| tmpfs | 256M | 0 |",
    "",
    "## Summary",
    "",
    "Disk looks healthy.",
  ].join("\n");
  const ev = parseTrace(log);
  const says = ev.filter((e) => e.kind === "say");
  assert.equal(says.length, 1, "table + heading + prose is one say, not many");
  if (says[0].kind === "say") {
    assert.match(says[0].text, /\| overlay \| 3\.9G \| 469M \|/);
    assert.match(says[0].text, /## Summary/);
    // The blank line separating the table from the heading must survive.
    assert.match(says[0].text, /\| tmpfs \| 256M \| 0 \|\n\n## Summary/);
  }
});

test("normalizeBlocks inserts the blank line a jammed heading-after-table needs", () => {
  // marked recognises the table only when a blank line follows its last row. The model routinely
  // streams the heading on the very next line; without normalization the table degrades to a paragraph.
  const md = ["| overlay | 3.9G | 469M |", "## Summary", "Disk looks healthy."].join("\n");
  const out = normalizeBlocks(md);
  assert.match(out, /469M \|\n\n## Summary/, "blank line inserted before the heading");
  assert.match(out, /## Summary\n\nDisk looks healthy\./, "blank line inserted after the heading");
});

test("normalizeBlocks separates a table jammed directly under prose", () => {
  const md = ["Here is the disk usage:", "| Filesystem | Size |", "|------------|------|", "| overlay | 3.9G |"].join("\n");
  const out = normalizeBlocks(md);
  assert.match(out, /disk usage:\n\n\| Filesystem \| Size \|/, "blank line inserted before the table");
});

test("normalizeBlocks leaves fenced code untouched (no boundary rewrites inside a fence)", () => {
  // A '#' comment or a '|' pipe inside a code fence must NOT be treated as a heading/table boundary.
  const md = ["```sh", "# not a heading", "echo a | grep b", "```"].join("\n");
  const out = normalizeBlocks(md);
  assert.equal(out, md, "fence content is preserved verbatim");
});

test("a ⟦you⟧ follow-up parses as a `you` event at its chronological position", () => {
  // The resume path stamps the user's follow-up into the log BEFORE the agent's next output. The
  // parser must place the `you` event between the previous agent turn and the response it triggered —
  // the order bug was rendering the user message after the response instead of before it.
  const log = [
    "Even numbers: 2, 4, 6, 8, 10.",
    "⟦you⟧",
    "now show odd numbers",
    "⟦/you⟧",
    "Odd numbers: 1, 3, 5, 7, 9.",
  ].join("\n");
  const ev = parseTrace(log);
  assert.deepEqual(
    ev.map((e) => e.kind),
    ["say", "you", "say"]
  );
  if (ev[1].kind === "you") assert.equal(ev[1].text, "now show odd numbers");
  // The response must come AFTER the user turn, never before it.
  if (ev[2].kind === "say") assert.match(ev[2].text, /Odd numbers/);
});

test("a multi-line ⟦you⟧ follow-up keeps its lines and does not absorb the agent reply", () => {
  const log = ["⟦you⟧", "line one", "line two", "⟦/you⟧", "Agent reply here."].join("\n");
  const ev = parseTrace(log);
  assert.equal(ev.length, 2);
  if (ev[0].kind === "you") assert.equal(ev[0].text, "line one\nline two");
  if (ev[1].kind === "say") assert.equal(ev[1].text, "Agent reply here.");
});

test("an unclosed ⟦you⟧ block (log tail cut) still emits the user turn, not silence", () => {
  const ev = parseTrace(["Some agent text.", "⟦you⟧", "the follow-up"].join("\n"));
  const you = ev.find((e) => e.kind === "you");
  assert.ok(you, "the user turn survives even without a close marker");
  if (you && you.kind === "you") assert.equal(you.text, "the follow-up");
});

test("a clean exit shows no code badge; a non-zero exit does", () => {
  // exit 0 read like an error to the user, so success is labelled "done" with no code. A real
  // failure keeps its code and is flagged as failed (rendered red by StateStamp).
  assert.equal(doneLabel(0), "done");
  assert.equal(isFailedExit(0), false);
  assert.equal(doneLabel(1), "exit 1");
  assert.equal(isFailedExit(1), true);
  assert.equal(doneLabel(137), "exit 137");
  assert.equal(isFailedExit(137), true);
  // Unknown exit is treated as not-clean: keep a badge so a lost code is visible, not hidden.
  assert.equal(doneLabel(undefined), "exit ?");
  assert.equal(isFailedExit(undefined), false);
});

test("an indented line that is NOT after a tool call stays prose", () => {
  // Agent prose is sometimes indented (lists, quotes). Swallowing it as tool output would silently
  // hide what the agent said.
  const ev = parseTrace("Here is the plan:\n  - step one\n  - step two");
  assert.equal(ev.length, 1);
  assert.equal(ev[0].kind, "say");
});

test("a lifecycle marker with no parenthetical still parses", () => {
  const ev = parseTrace("● run complete");
  assert.deepEqual(ev, [{ kind: "lifecycle", label: "run complete" }]);
});

test("tool call with no argument is still a tool call", () => {
  const ev = parseTrace("→ Read");
  assert.deepEqual(ev, [{ kind: "tool", name: "Read", arg: undefined }]);
});

test("empty and whitespace-only logs produce nothing, not an empty bubble", () => {
  assert.deepEqual(parseTrace(""), []);
  assert.deepEqual(parseTrace("\n\n   \n"), []);
  assert.deepEqual(parseTrace(undefined as unknown as string), []);
});

test("clean strips ANSI colour, OSC sequences, and carriage-return rewrites", () => {
  const esc = "\u001b"; // explicit escape, not an invisible literal byte
  assert.equal(clean(`${esc}[32mgreen${esc}[0m`), "green");
  assert.equal(clean(`${esc}]0;titleafter`), "after");
  // A spinner rewriting its line leaves only the final segment.
  assert.equal(clean("loading...\rdone"), "done");
});

test("ANSI in the middle of a log does not break event parsing", () => {
  const esc = "\u001b"; // explicit escape, not an invisible literal byte
  const ev = parseTrace(`${esc}[36m→ Write: /workspace/x.ts${esc}[0m`);
  assert.equal(ev.length, 1);
  if (ev[0].kind === "tool") assert.equal(ev[0].arg, "/workspace/x.ts");
});

test("resultSummary takes the first meaningful line and truncates", () => {
  assert.equal(resultSummary("\n\nfirst real line\nsecond"), "first real line");
  assert.equal(resultSummary(undefined), undefined);
  assert.equal(resultSummary("x".repeat(200))!.length, 100);
  assert.match(resultSummary("x".repeat(200))!, /…$/);
});

test("a repeated closing summary renders once, not twice", () => {
  // The in-box formatter emits assistant text as it streams and re-emits the final result at the
  // end, so the last block legitimately arrives twice. Showing both looks like a rendering bug.
  const summary = "All four essays are written in /workspace.";
  const ev = parseTrace([summary, "", summary].join("\n"));
  assert.equal(ev.filter((e) => e.kind === "say").length, 1);
});

test("distinct consecutive prose is NOT deduped", () => {
  const ev = parseTrace(["→ Write: /a.md", "first summary", "→ Write: /b.md", "second summary"].join("\n"));
  const says = ev.filter((e) => e.kind === "say");
  assert.equal(says.length, 2);
});

test("a summary repeated INSIDE one block is collapsed", async () => {
  // The real failure: the formatter re-emits the final result with no tool call between, so both
  // copies coalesce into a single say and block-level dedupe cannot see them.
  const { dedupeParagraphs } = await import("../web/src/lib/trace.ts");
  const para = "All four essays are written in /workspace: isolation.md, egress.md, secrets.md, audit.md.";
  const other = "Finished the audit essay covering layers, trails, observability and accountability.";
  const out = dedupeParagraphs([other, para, other, para].join("\n\n"));
  assert.equal(out, [other, para].join("\n\n"));
});

test("short repeated lines are NOT collapsed", async () => {
  // "done." legitimately recurs once per file; collapsing it would delete real progress reporting.
  const { dedupeParagraphs } = await import("../web/src/lib/trace.ts");
  const out = dedupeParagraphs(["done.", "next file.", "done."].join("\n\n"));
  assert.equal(out.match(/done\./g)!.length, 2);
});

test("parseTrace applies paragraph dedupe end to end", () => {
  const para = "All four essays are written in /workspace and each is about 500 words long.";
  const ev = parseTrace([para, "", para].join("\n"));
  const says = ev.filter((e) => e.kind === "say");
  assert.equal(says.length, 1);
  if (says[0].kind === "say") assert.equal(says[0].text, para);
});

test("dedupe survives a repeat that straddles paragraph boundaries", () => {
  // The shape that actually shipped: the tail of copy 1 and the head of copy 2 share a paragraph,
  // so a paragraph-level pass finds no matching pair. This is why the dedupe works per line.
  const a = "Finished /workspace/audit.md. The essay covers layers, trails, and accountability.";
  const b = "All four essays are written in /workspace and each is about 500 words long.";
  const log = [a, "", b, a, "", b].join("\n");
  const ev = parseTrace(log);
  const text = ev.map((e) => (e.kind === "say" ? e.text : "")).join("\n");
  assert.equal(text.split(a).length - 1, 1, "first line should appear once");
  assert.equal(text.split(b).length - 1, 1, "second line should appear once");
});

test("producedFiles derives Write/Edit targets under /workspace, deduped in order", () => {
  const log = [
    "● session started (model ak-claude-opus-4.8)",
    "Writing the report.",
    "→ Write: /workspace/report.md",
    "  File created successfully at: /workspace/report.md",
    "→ Edit: /workspace/report.md",
    "  Applied 1 edit",
    "→ Write: /workspace/out/data.json",
    "  File created successfully at: /workspace/out/data.json",
    "done.",
  ].join("\n");
  const files = producedFiles(parseTrace(log));
  assert.deepEqual(files, [
    { relPath: "report.md", name: "report.md" },
    { relPath: "out/data.json", name: "data.json" },
  ]);
});

test("producedFiles ignores Read/Grep and files outside /workspace", () => {
  const log = [
    "→ Read: /workspace/report.md",
    "→ Grep: pattern",
    "→ Write: /etc/passwd",
    "→ Write: /tmp/scratch.txt",
  ].join("\n");
  assert.deepEqual(producedFiles(parseTrace(log)), []);
});

test("producedFiles drops a traversal arg defensively", () => {
  const log = "→ Write: /workspace/../secret.txt";
  assert.deepEqual(producedFiles(parseTrace(log)), []);
});

/**
 * The formatter re-emits the run's final `result` verbatim after having already streamed the same
 * text, so a markdown summary lands in the log TWICE with no tool call between the copies. Line-level
 * dedupe alone cannot clean that up — it drops the long prose lines but keeps every line under its
 * length threshold, so the second copy survives as a wreck: a stray `## Summary`, a header-only
 * 0-row table, and a repeated fenced block. Observed live on the deployed dashboard.
 */
test("an exactly repeated markdown summary collapses to one clean copy", async () => {
  const { dedupeParagraphs } = await import("../web/src/lib/trace.ts");
  const summary = [
    "## Summary",
    "",
    "This sandbox is a lightweight, containerized Linux environment running Debian 13 on a 6.12 kernel.",
    "",
    "| Check | Command | Finding |",
    "|-------|---------|---------|",
    "| Kernel | `uname -a` | Linux 6.12.99 SMP x86_64 running inside a krun-backed microVM guest |",
    "",
    "```bash",
    "uname -a",
    "df -h",
    "```",
  ].join("\n");

  const out = dedupeParagraphs(`${summary}\n${summary}`);

  assert.equal(out, summary);
  // The exact artefacts seen in the live DOM must be gone, not merely reduced.
  assert.equal(out.match(/## Summary/g)!.length, 1);
  assert.equal(out.match(/```bash/g)!.length, 1);
  assert.equal(out.match(/\|-------\|/g)!.length, 1);
});

test("dropRepeatedTail leaves text whose ending is not a repeat", async () => {
  const { dropRepeatedTail } = await import("../web/src/lib/trace.ts");
  const text =
    "First a genuinely distinct paragraph of prose about isolation and egress controls in the box.\n\nAnd then a different closing paragraph that shares no suffix with the one written above it.";
  assert.equal(dropRepeatedTail(text), text);
});

test("dropRepeatedTail does not eat a short recurring refrain", async () => {
  const { dropRepeatedTail } = await import("../web/src/lib/trace.ts");
  const text = "done.\ndone.";
  assert.equal(dropRepeatedTail(text), text);
});

/**
 * Mid-stream slices cut through markdown. Two cuts render WRONG rather than merely incomplete: a
 * fence still being typed reads as a paragraph of backticks (so the block flickers prose→panel), and
 * an unclosed fence has no end (so everything below it reflows when the close finally lands).
 */
test("a half-typed fence marker is withheld until it is a real fence", async () => {
  const { stabilizeMarkdown } = await import("../web/src/lib/markdown-stream.ts");
  assert.equal(stabilizeMarkdown("intro\n``"), "intro");
  assert.equal(stabilizeMarkdown("intro\n`"), "intro");
  // Three backticks IS a fence — it must survive, virtually closed.
  assert.equal(stabilizeMarkdown("intro\n```"), "intro\n```\n```");
});

test("an open fence is virtually closed so the panel has an end", async () => {
  const { stabilizeMarkdown } = await import("../web/src/lib/markdown-stream.ts");
  assert.equal(stabilizeMarkdown("```bash\nuname -a"), "```bash\nuname -a\n```");
});

test("an already-closed fence is left exactly as it is", async () => {
  const { stabilizeMarkdown } = await import("../web/src/lib/markdown-stream.ts");
  const done = "```bash\nuname -a\n```\n\nafter";
  assert.equal(stabilizeMarkdown(done), done);
});

test("a tilde fence is not closed by a backtick fence inside it", async () => {
  const { stabilizeMarkdown } = await import("../web/src/lib/markdown-stream.ts");
  // The ``` here is CONTENT of the ~~~ block; closing on it would truncate the block early.
  assert.equal(stabilizeMarkdown("~~~md\n```\n"), "~~~md\n```\n\n~~~");
});

test("stabilizing prose with no fences changes nothing", async () => {
  const { stabilizeMarkdown } = await import("../web/src/lib/markdown-stream.ts");
  const t = "| Check | Command |\n|---|---|\n| a |";
  assert.equal(stabilizeMarkdown(t), t);
});

// --- parallel tool use: each result must land on its own call -----------------------------------
// The formatter stamps the tail of Claude's `tool_use.id` as ⟦#id⟧ on the call line and on the first
// line of that call's result. Without it every result piled onto the most recent call.
const PARALLEL_LOG = [
  "● session started (model ak-claude-opus-4.8)",
  "Running both at once.",
  "→ Bash: for i in $(seq 1 3); do echo \"row $i\" done ⟦#01aaaaaa⟧",
  "→ Bash: ls /definitely/not/here ⟦#02bbbbbb⟧",
  "  ⟦#01aaaaaa⟧ row 1",
  "  row 2",
  "  row 3",
  "  ⟦#02bbbbbb⟧ ⟦err⟧ Exit code 2",
  "  ls: cannot access '/definitely/not/here': No such file or directory",
].join("\n");

test("parallel tool calls each keep their own result", () => {
  const tools = parseTrace(PARALLEL_LOG).filter((e) => e.kind === "tool");
  assert.equal(tools.length, 2);
  if (tools[0].kind !== "tool" || tools[1].kind !== "tool") return;
  // The correlation token is stripped from the displayed arg.
  assert.equal(tools[0].arg, 'for i in $(seq 1 3); do echo "row $i" done');
  assert.equal(tools[1].arg, "ls /definitely/not/here");
  assert.equal(tools[0].result, "row 1\nrow 2\nrow 3");
  assert.match(tools[1].result ?? "", /^Exit code 2\nls: cannot access/);
  assert.ok(!(tools[0].result ?? "").includes("⟦"));
});

test("the failure flag lands only on the tool that actually failed", () => {
  const tools = parseTrace(PARALLEL_LOG).filter((e) => e.kind === "tool");
  if (tools[0].kind !== "tool" || tools[1].kind !== "tool") return;
  assert.equal(tools[0].failed, undefined);
  assert.equal(tools[1].failed, true);
});

test("a result stamped out of order still finds its own call", () => {
  const log = [
    "→ Bash: echo a ⟦#aaa11111⟧",
    "→ Bash: echo b ⟦#bbb22222⟧",
    "  ⟦#bbb22222⟧ b",
    "  ⟦#aaa11111⟧ a",
  ].join("\n");
  const tools = parseTrace(log).filter((e) => e.kind === "tool");
  if (tools[0].kind !== "tool" || tools[1].kind !== "tool") return;
  assert.equal(tools[0].result, "a");
  assert.equal(tools[1].result, "b");
});

test("an old-format log with no correlation ids parses exactly as before", () => {
  const old = [
    "→ Write: /workspace/a.md",
    "  File created successfully at: /workspace/a.md",
    "→ Bash: ls /nope",
    "  ⟦err⟧ Exit code 2",
    "  ls: cannot access '/nope'",
  ].join("\n");
  const tools = parseTrace(old).filter((e) => e.kind === "tool");
  assert.equal(tools.length, 2);
  if (tools[0].kind !== "tool" || tools[1].kind !== "tool") return;
  assert.equal(tools[0].result, "File created successfully at: /workspace/a.md");
  assert.equal(tools[0].failed, undefined);
  assert.equal(tools[1].result, "Exit code 2\nls: cannot access '/nope'");
  assert.equal(tools[1].failed, true);
});

// --- long tool output ---------------------------------------------------------------------------
// The formatter used to cap a result at 20 lines and drop the tail at source, so the parser was
// never exercised on real-sized output. It must carry hundreds of lines onto the right call rather
// than spilling them into prose, and must not eat the truncation disclosure when one is present.
test("a long result is carried whole onto its own tool call", () => {
  const body = Array.from({ length: 300 }, (_, i) => `line ${i + 1}`);
  const log = [
    "→ Bash: seq 300 ⟦#long0001⟧",
    `  ⟦#long0001⟧ ${body[0]}`,
    ...body.slice(1).map((l) => `  ${l}`),
  ].join("\n");
  const tools = parseTrace(log).filter((e) => e.kind === "tool");
  assert.equal(tools.length, 1);
  if (tools[0].kind !== "tool") return;
  assert.equal(tools[0].result, body.join("\n"));
});

test("a truncated result keeps the disclosure as the last line of the output", () => {
  const log = ["→ Bash: seq 100000", "  line 1", "  line 2", "  … 99998 more lines"].join("\n");
  const tools = parseTrace(log).filter((e) => e.kind === "tool");
  if (tools[0].kind !== "tool") return;
  assert.match(tools[0].result ?? "", /… 99998 more lines$/);
});

// --- decapitated logs ---------------------------------------------------------------------------
// Any bound on the reader's tail can still slice through a tool_result. The block then arrives with
// no `→ Tool:` line above it. Before this, every one of those lines fell through to prose and the
// run rendered as a wall of left-justified text with no collapsible card — the exact "unreadable
// blob" report. The content must be kept, but kept AS tool output, and the missing call disclosed.
test("a log starting mid-result adopts the orphan into one tool card, not prose", () => {
  const body = Array.from({ length: 58 }, (_, i) => `LINE-${i + 3}`);
  const log = [...body.map((l) => `  ${l}`), "The command printed 60 lines."].join("\n");
  const ev = parseTrace(log);
  const tools = ev.filter((e) => e.kind === "tool");
  assert.equal(tools.length, 1);
  if (tools[0].kind !== "tool") return;
  // Nothing swallowed: every surviving output line is in the card.
  assert.equal(tools[0].result, body.join("\n"));
  // And it says plainly that the call line is not in view rather than inventing one.
  assert.match(tools[0].arg ?? "", /above the start of this log/);
  // The agent's closing sentence is still prose, not absorbed into the card.
  assert.ok(ev.some((e) => e.kind === "say" && e.text.includes("printed 60 lines")));
});

test("adoption only applies at the very top — indented prose mid-log is still prose", () => {
  const log = ["Here is the plan:", "    indented note", "done."].join("\n");
  const ev = parseTrace(log);
  assert.equal(ev.filter((e) => e.kind === "tool").length, 0);
  assert.ok(ev.some((e) => e.kind === "say" && e.text.includes("indented note")));
});

test("an intact log gains no placeholder tool", () => {
  const log = ["● session started (model m)", "→ Bash: seq 3", "  1", "  2", "  3"].join("\n");
  const tools = parseTrace(log).filter((e) => e.kind === "tool");
  assert.equal(tools.length, 1);
  if (tools[0].kind !== "tool") return;
  assert.equal(tools[0].name, "Bash");
});

test("a decapitated block still carrying its ⟦#id⟧ is adopted, id stripped", () => {
  const log = ["  ⟦#abc12345⟧ LINE-3", "  LINE-4"].join("\n");
  const tools = parseTrace(log).filter((e) => e.kind === "tool");
  assert.equal(tools.length, 1);
  if (tools[0].kind !== "tool") return;
  assert.equal(tools[0].result, "LINE-3\nLINE-4");
});

test("parallel long results do not bleed into each other", () => {
  const a = Array.from({ length: 60 }, (_, i) => `a${i + 1}`);
  const b = Array.from({ length: 45 }, (_, i) => `b${i + 1}`);
  const log = [
    "→ Bash: seq a ⟦#pa000001⟧",
    "→ Bash: seq b ⟦#pb000002⟧",
    `  ⟦#pa000001⟧ ${a[0]}`,
    ...a.slice(1).map((l) => `  ${l}`),
    `  ⟦#pb000002⟧ ${b[0]}`,
    ...b.slice(1).map((l) => `  ${l}`),
  ].join("\n");
  const tools = parseTrace(log).filter((e) => e.kind === "tool");
  assert.equal(tools.length, 2);
  if (tools[0].kind !== "tool" || tools[1].kind !== "tool") return;
  assert.equal(tools[0].result, a.join("\n"));
  assert.equal(tools[1].result, b.join("\n"));
});

test("an answered question is kept in the transcript as an ask event before the you answer", () => {
  const ev = parseTrace(["● session started (model m)", "⟦ask⟧", "Which fix?", "", "Options:", "- Mock the clock", "- Widen the tolerance", "⟦/ask⟧", "⟦you⟧", "Mock the clock", "⟦/you⟧", "Working on it."].join("\n"));
  const ask = ev.find((e) => e.kind === "ask");
  assert.ok(ask && ask.kind === "ask" && /Mock the clock/.test(ask.text));
  const i = ev.findIndex((e) => e.kind === "ask");
  assert.equal(ev[i + 1].kind, "you");
});
