/**
 * Mid-stream markdown stabilisation (web/src/lib/markdown-stream.ts). The reveal shows
 * `text.slice(0, n)`; every frame must render the stable document the text is becoming, never a
 * half-typed construct. Pure, so covered here under node:test.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { OPEN_FENCE_SUFFIX, closeInline, splitOpenFence, stabilizeMarkdown } from "../web/src/lib/markdown-stream.ts";

// ---------------------------------------------------------------- existing behaviour

test("fence: a half-typed marker on the last line is held", () => {
  assert.equal(stabilizeMarkdown("para\n``"), "para");
  assert.equal(stabilizeMarkdown("para\n`"), "para");
});

test("fence: an open fence is virtually closed and tagged __open", () => {
  const out = stabilizeMarkdown("para\n```ts\nconst x = 1;");
  assert.equal(out, `para\n\`\`\`ts${OPEN_FENCE_SUFFIX}\nconst x = 1;\n\`\`\``);
  assert.deepEqual(splitOpenFence(`ts${OPEN_FENCE_SUFFIX}`), { language: "ts", open: true });
  assert.deepEqual(splitOpenFence("ts"), { language: "ts", open: false });
});

test("fence: a closed fence is untouched, even when its body holds markup", () => {
  const src = "```md\n**not bold\n```\n";
  assert.equal(stabilizeMarkdown(src), src);
});

test("table: header row without a delimiter is held", () => {
  assert.equal(stabilizeMarkdown("intro\n\n| a | b |"), "intro\n");
  assert.equal(stabilizeMarkdown("intro\n\n| a | b |\n| --"), "intro\n");
  const full = "intro\n\n| a | b |\n| --- | --- |\n| 1 | 2 |";
  assert.equal(stabilizeMarkdown(full), full);
});

test("code span: a half-typed span is held up to the backtick", () => {
  assert.equal(stabilizeMarkdown("quota at `:5"), "quota at");
  assert.equal(stabilizeMarkdown("quota at `:59` resets"), "quota at `:59` resets");
});

// ---------------------------------------------------------------- new: inline emphasis

test("emphasis: unclosed ** / * / _ / ~~ are virtually closed", () => {
  assert.equal(stabilizeMarkdown("keeps **six 10-second buc"), "keeps **six 10-second buc**");
  assert.equal(stabilizeMarkdown("an *emphasised wor"), "an *emphasised wor*");
  assert.equal(stabilizeMarkdown("an _emphasised wor"), "an _emphasised wor_");
  assert.equal(stabilizeMarkdown("it was ~~remo"), "it was ~~remo~~");
});

test("emphasis: nested runs close innermost first", () => {
  assert.equal(stabilizeMarkdown("**bold and *both"), "**bold and *both***");
});

test("emphasis: closed runs are untouched; a lone opener is held", () => {
  assert.equal(stabilizeMarkdown("**bold** and *em* done"), "**bold** and *em* done");
  assert.equal(stabilizeMarkdown("text **"), "text");
  assert.equal(stabilizeMarkdown("text **bold** **"), "text **bold**");
  assert.equal(stabilizeMarkdown("**"), "");
});

test("emphasis: snake_case, arithmetic and list bullets are not markup", () => {
  assert.equal(closeInline("use snake_case_names here"), "use snake_case_names here");
  assert.equal(closeInline("2 * 3 = 6"), "2 * 3 = 6");
  assert.equal(closeInline("* a bullet with *em"), "* a bullet with *em*");
});

test("emphasis: markup inside a code span is ignored", () => {
  assert.equal(closeInline("run `a * b` then **bo"), "run `a * b` then **bo**");
  assert.equal(closeInline("run `**raw**` plain"), "run `**raw**` plain");
});

test("emphasis: a heading on the last line is closed in place", () => {
  assert.equal(stabilizeMarkdown("## **Sliding"), "## **Sliding**");
});

// ---------------------------------------------------------------- new: links

test("link: an unclosed link renders its text plainly until the url closes", () => {
  assert.equal(stabilizeMarkdown("see [the do"), "see the do");
  assert.equal(stabilizeMarkdown("see [the docs]"), "see the docs");
  assert.equal(stabilizeMarkdown("see [the docs](https://exa"), "see the docs");
  assert.equal(stabilizeMarkdown("see [the docs](https://example.com) now"), "see [the docs](https://example.com) now");
});

test("link: a half-typed image is held entirely; a task box is not a link", () => {
  assert.equal(stabilizeMarkdown("shot ![alt](https://x"), "shot");
  assert.equal(stabilizeMarkdown("- [ ] write tests\n- [x] ship it"), "- [ ] write tests\n- [x] ship it");
});

// ---------------------------------------------------------------- new: empty block markers

test("markers: a heading or list marker with nothing typed yet is held", () => {
  assert.equal(stabilizeMarkdown("para\n\n#"), "para\n");
  assert.equal(stabilizeMarkdown("para\n\n## "), "para\n");
  assert.equal(stabilizeMarkdown("para\n\n- "), "para\n");
  assert.equal(stabilizeMarkdown("para\n\n1. "), "para\n");
  assert.equal(stabilizeMarkdown("para\n\n> "), "para\n");
  assert.equal(stabilizeMarkdown("para\n\n- [ ]"), "para\n");
  // Typed content keeps the marker.
  assert.equal(stabilizeMarkdown("para\n\n## Sli"), "para\n\n## Sli");
  assert.equal(stabilizeMarkdown("para\n\n- fir"), "para\n\n- fir");
});

// ---------------------------------------------------------------- new: trailing table edge

test("table: a trailing lone | is held", () => {
  const table = "| a | b |\n| --- | --- |\n| 1 | 2 |";
  assert.equal(stabilizeMarkdown(`${table}\n|`), table);
  assert.equal(stabilizeMarkdown(`${table}\n| `), table);
  // A row in progress keeps rendering as a row.
  assert.equal(stabilizeMarkdown(`${table}\n| 3 | 4`), `${table}\n| 3 | 4`);
});

test("stable: a settled document passes through unchanged", () => {
  const doc = [
    "## Done",
    "",
    "The limiter keeps **six** buckets per key; see [the PR](https://github.com/acme/x/pull/1).",
    "",
    "| Scenario | Before | After |",
    "| --- | --- | --- |",
    "| burst | 200 | 100 |",
    "",
    "1. **Fail-open** — chosen.",
    "2. The `Retry-After` header is 10s.",
  ].join("\n");
  assert.equal(stabilizeMarkdown(doc), doc);
});
