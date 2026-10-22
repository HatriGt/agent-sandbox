// Unit checks for prose code refs. Run from web/ so tsx resolves the lib's relative imports:
//   cd web && npx tsx ../.shots/prose-refs-unit.ts
// Prints one line per case; exits 1 on the first failure count > 0.
import { findCodeRefs, leadingLineHint, trailingLineHint, refLabel } from "../web/src/lib/code-refs";
import { remarkCodeRefs } from "../web/src/lib/remark-code-refs";
import { unified } from "../web/node_modules/unified/index.js";
import remarkParse from "../web/node_modules/remark-parse/index.js";
import remarkGfm from "../web/node_modules/remark-gfm/index.js";

let failed = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`}`);
};
const labels = (text: string) => findCodeRefs(text).map((r) => `${r.start}-${r.end} ${refLabel(r.ref)}`);

// ---- findCodeRefs: each phrase form
check("token with dir", labels("see src/middleware/rateLimit.ts:12 for it"), ["4-34 src/middleware/rateLimit.ts:12"]);
check("token dir, no line", labels("open src/app.ts now"), ["5-15 src/app.ts"]);
check("token basename + line", labels("in rateLimit.ts:7."), ["3-17 rateLimit.ts:7"]);
check("token range", labels("x src/a.ts:3-5 y"), ["2-14 src/a.ts:3-5"]);
check("token range en dash", labels("x src/a.ts:3–5 y"), ["2-14 src/a.ts:3-5"]);
check("token #L form", labels("src/a.ts#L7-L9,"), ["0-14 src/a.ts:7-9"]);
check("token :L form", labels("see src/a.ts:12:4 col"), ["4-17 src/a.ts:12"]);
check("token in parens", labels("(see src/a.ts:12)"), ["5-16 src/a.ts:12"]);
check("token trailing punctuation", labels("src/a.ts:12; src/b.ts:1)] src/c.ts."), ["0-11 src/a.ts:12", "13-23 src/b.ts:1", "26-34 src/c.ts"]);
check("<path> line N", labels("rateLimit.ts line 7 explains"), ["0-19 rateLimit.ts:7"]);
check("<path> lines N-M", labels("src/a.ts lines 3-5"), ["0-18 src/a.ts:3-5"]);
check("<path> at line N", labels("see src/a.ts at line 9."), ["4-22 src/a.ts:9"]);
check("<path>, line N", labels("src/a.ts, line 9"), ["0-16 src/a.ts:9"]);
check("line N of <path>", labels("the guard is line 12 of src/http.ts."), ["13-35 src/http.ts:12"]);
check("lines N-M of <path>", labels("lines 3-5 of src/a.ts"), ["0-21 src/a.ts:3-5"]);
check("lines N to M in <path>", labels("lines 3 to 5 in src/a.ts"), ["0-24 src/a.ts:3-5"]);
check("Line N capitalised", labels("Line 2 of src/a.ts"), ["0-18 src/a.ts:2"]);
check("two refs, ascending", labels("src/a.ts:1 then line 4 of src/b.ts"), ["0-10 src/a.ts:1", "16-34 src/b.ts:4"]);
check("overlap: phrase beats inner token", labels("line 4 of src/b.ts and src/b.ts line 2"), ["0-18 src/b.ts:4", "23-38 src/b.ts:2"]);
check("sentence boundary is not <path> line N", labels("done in src/a.ts. Line 7 is next"), ["8-16 src/a.ts"]);
check("multiline text", labels("fixed\nsrc/a.ts:2\nok"), ["6-16 src/a.ts:2"]);

// ---- findCodeRefs: non-matches
check("e.g.", labels("e.g. the cap"), []);
check("Node.js", labels("use Node.js here"), []);
check("React.memo", labels("wrap in React.memo(Thing)"), []);
check("bare basename, no line", labels("foo.ts is fine"), []);
check("https URL", labels("PR: https://github.com/acme/orders-api/pull/482"), []);
check("www URL", labels("www.example.com/path/x.ts:3"), []);
check("version string", labels("v2.0.1 and 1.2.3 and 1.2.3:4"), []);
check("version:line is not a ref", labels("bump 3.14:2"), []);
check("line word alone", labels("line 5 of the file"), []);
check("empty", labels(""), []);

// ---- hint helpers
check("trailingLineHint lines N-M of", trailingLineHint("see lines 3-5 of "), { line: 3, endLine: 5 });
check("trailingLineHint line N in", trailingLineHint("line 9 in"), { line: 9 });
check("trailingLineHint none", trailingLineHint("outline 9 of "), null);
check("leadingLineHint line N", leadingLineHint(" line 42 explains"), { line: 42 });
check("leadingLineHint , at lines N to M", leadingLineHint(", at lines 3 to 5."), { line: 3, endLine: 5 });
check("leadingLineHint none", leadingLineHint(" lines up"), null);
check("leadingLineHint lineN glued", leadingLineHint(" line 42nd"), null);

// ---- remarkCodeRefs on real mdast
type N = { type: string; value?: string; url?: string; data?: { hProperties?: Record<string, string> }; children?: N[] };
const parse = (md: string) => unified().use(remarkParse).use(remarkGfm).use(remarkCodeRefs).runSync(unified().use(remarkParse).use(remarkGfm).parse(md)) as unknown as N;
const flat = (n: N): string[] => {
  if (n.type === "text") return [`text(${JSON.stringify(n.value)})`];
  if (n.type === "link") return [`link(${n.url}${n.data?.hProperties && "data-prose-ref" in n.data.hProperties ? " prose" : ""}:${n.children?.map((c) => c.value).join("")})`];
  if (n.type === "inlineCode") {
    const h = n.data?.hProperties ?? {};
    return [`code(${n.value}${h["data-line"] ? ` ${h["data-line"]}${h["data-end-line"] ? `-${h["data-end-line"]}` : ""}` : ""})`];
  }
  return (n.children ?? []).flatMap(flat);
};
const md = (s: string) => flat(parse(s));

check("mdast: token in paragraph", md("Fixed in src/a.ts:12 today."), ['text("Fixed in ")', "link(src/a.ts:12 prose:src/a.ts:12)", 'text(" today.")']);
check("mdast: phrase keeps its words", md("see line 4 of src/b.ts"), ['text("see ")', "link(src/b.ts:4 prose:line 4 of src/b.ts)"]);
check("mdast: typed link untouched, no prose flag", md("[x](src/a.ts:1)"), ["link(src/a.ts:1:x)"]);
check("mdast: text inside a typed link is not scanned", md("[see src/a.ts:1](https://e.com)"), ["link(https://e.com:see src/a.ts:1)"]);
check("mdast: www autolink untouched", md("see www.example.com/x.ts:3 now"), ['text("see ")', "link(http://www.example.com/x.ts:3:www.example.com/x.ts:3)", 'text(" now")']);
check("mdast: autolinked URL untouched", md("PR https://github.com/acme/x/pull/4 ok"), ['text("PR ")', "link(https://github.com/acme/x/pull/4:https://github.com/acme/x/pull/4)", 'text(" ok")']);
check("mdast: inline code untouched", md("in `src/a.ts:12` ok"), ['text("in ")', "code(src/a.ts:12)", 'text(" ok")']);
check("mdast: fenced code untouched", md("```\nsrc/a.ts:12\n```"), []);
check("mdast: sibling hint, lines N-M of `path`", md("lines 3-5 of `web/src/x.tsx` do it"), ['text("lines 3-5 of ")', "code(web/src/x.tsx 3-5)", 'text(" do it")']);
check("mdast: sibling hint, `path` line N", md("`foo.ts` line 42 explains"), ["code(foo.ts 42)", 'text(" line 42 explains")']);
check("mdast: sibling hint, `path`, at line N", md("`foo.ts`, at line 42"), ["code(foo.ts 42)", 'text(", at line 42")']);
check("mdast: no hint on non-path code", md("`limit` line 42"), ["code(limit)", 'text(" line 42")']);
check("mdast: hint and token in one paragraph", md("`a.ts` line 1 and src/b.ts:2"), ["code(a.ts 1)", 'text(" line 1 and ")', "link(src/b.ts:2 prose:src/b.ts:2)"]);
check("mdast: inside emphasis and list", md("- see **src/a.ts:3** now"), ['text("see ")', "link(src/a.ts:3 prose:src/a.ts:3)", 'text(" now")']);
check("mdast: table cell", md("| a |\n| - |\n| src/a.ts:3 |"), ['text("a")', "link(src/a.ts:3 prose:src/a.ts:3)"]);

console.log(failed ? `${failed} FAILED` : "all passed");
process.exit(failed ? 1 : 0);
