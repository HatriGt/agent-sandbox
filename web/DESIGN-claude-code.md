# Claude Code / claude.ai web — chat UX spec

Reference captured **live** from `claude.ai` (logged-in, Opus) via CDP `getComputedStyle` on a real
rendered conversation (`/chat/…`, OData→OpenAPI thread with YAML code blocks) plus the composer on
`/new`. Values below are measured, not guessed. Where our dashboard deliberately keeps its own
visual language (Inter + blue accent), the deviation is called out under **Our stance**.

> Note on capture method: driving Claude's own tiptap composer programmatically from the sandboxed
> webview is unreliable (contenteditable input events are dropped; CDP `Input.*` is denied), so live
> generation could not be triggered end-to-end. All numbers here come from **DOM + computed-style
> inspection of already-rendered Claude content**, which is exact for typography/color/spacing. A
> human should eyeball live streaming cadence + tool cards on claude.ai to confirm the motion notes.

## 1. Design tokens (measured)

| Token | Light | Dark |
| --- | --- | --- |
| Canvas bg | `rgb(252,252,251)` warm off-white | warm charcoal (`--_gray-800` ramp) |
| Text primary | `rgb(11,11,11)` | `--_gray-20` (near-white, warm) |
| Text muted | `rgb(55,54,52)` / `rgb(120,118,110)` | `--_gray-200 / -350` |
| Radius base | **`8px`** (`--radius`) | same |
| User bubble bg | `rgba(11,11,11,0.05)` neutral fill | translucent light fill |
| Border/hairline | `rgba(11,11,11,0.1)` | `rgba(255,255,255,0.1)` |

- Fonts: UI/labels `anthropic-sans`; **assistant message container base is `anthropic-serif`**, but
  markdown block elements (`p`, `h*`, `li`) re-assert `anthropic-sans`. Mono is `anthropic-mono`.
- Color scheme is **warm neutral**, not cool zinc, and not pure black/white.

## 2. Conversation structure

- **Full-width columns, no avatars on the assistant.** The assistant turn is `.font-claude-response`
  — prose straight in the column, transparent bg, **no card, no bubble, no elevation**. Left inset is
  a small `--msg-text-inset ≈ 0.5rem` on block elements; right padding `pr-8` leaves room for the
  hover copy affordance.
- **User turn** = subtle **neutral grey bubble** (`bg-neutral`, `rounded-card` 12px, `px-lg py-md` =
  16/12px), right-grouped, `text-heading` sans 15px/20px. It is a quiet fill, NOT a saturated accent.
- Turn spacing is generous vertical rhythm; turns are separated by whitespace, not dividers.
- **Our stance:** we keep the agent as a full-width prose column (matches Claude) but had wrapped it
  in a card+avatar bubble — that is the main divergence to close. We keep our **blue** user bubble as
  the product's one filled voice (deliberate deviation from Claude's grey — documented here).

## 3. Assistant prose (measured)

- Container `.font-claude-response`, `leading-[1.65rem]`.
- Paragraph: `anthropic-sans`, **14px**, line-height **21px** (1.5) for the tight blocks; the message
  measure is comfortable (no artificial `max-width` clamp — it fills the reading column ~ 45–50rem).
- Prose reads at 14–15px, **not 16px**. Our `.prose-agent` was 16px → step down to 15px to match.
- Headings: sans, semibold, tight leading, modest size steps (h2 ≈ 1.2em).

## 4. Code & terminal (measured)

- **Code block** container: `role="group" aria-label="<lang> code"`, `bg-bg-000/50`,
  `border-0.5 border-border-400`, **`rounded-lg` (8px)**, `focus-visible:ring-2`.
- `pre`: padding **14px**, `anthropic-mono` **14px**, line-height 22.75px. Horizontal scroll via
  `overflow-x-auto`. Content is **span-per-token syntax highlighted** (yaml keys red `rgb(184,10,24)`,
  values teal `rgb(0,128,128)`).
- **Copy button**: floating **top-right**, `opacity-0 group-hover/copy:opacity-100` (hover/focus
  reveal), icon-only ghost, sticky. No persistent heavy header bar — language lives in the aria-label.
- **Inline code**: subtle bg (`…/0.05`), **maroon text `rgb(142,38,38)`** (light), 1px hairline
  border, radius 6.4px, padding `1px 4px`, mono 14.4px. (Ours was `bg-primary-foreground` w/ no
  distinct color — a bug that makes inline code near-invisible; fix to a tinted chip.)

## 5. Streaming / status-in-reply

- Progressive markdown reveal (`.progressive-markdown` vs settled `.standard-markdown`) — content is
  parsed and revealed as it streams; fully-arrived tables/code render correctly mid-stream.
- A subtle growing-edge tell (cursor) during generation; send affordance disables while generating.
- **Our stance:** we already do this well (`StreamingMarkdown` rAF reveal + blinking caret +
  `WorkingIndicator` dots). Keep. Ensure caret + working beat read against the no-bubble prose.

## 6. Composer (measured)

- Textarea `.tiptap.ProseMirror`, `anthropic-sans` **15px**, generous padding, rounded container.
- Placeholder "How can I help you today?"; **Enter sends**, Shift+Enter newline; send button disabled
  while empty and while generating; attach button on the left.
- **Our stance:** our `SendBar` (prompt-kit `PromptInput`) already matches: autosize, Enter-to-send,
  disabled-empty, rounded-2xl, action button right. Keep; align radius/size only.

## 7. What we replicate (implementation checklist)

1. Assistant = **full-width prose, no card/avatar bubble** (small role label kept, subtle).
2. Prose size **15px/1.65** (down from 16px), consistent with `--text-prose`; comfortable measure.
3. **Inline code** → tinted chip with a distinct accent color (fix invisible bg bug).
4. **Code block** → 8px radius, 14px mono, **hover copy button** (was absent), lighter card.
5. Terminal/tool panels: keep our strong terminal treatment (better than Claude's for shell), just
   align radius to 8px and keep hover-reveal affordances.
6. Keep our streaming reveal + working indicator + tool grouping (already at/above parity).
7. Warm-neutral is Claude's; we intentionally keep our zinc+blue system (documented deviation).

## 8. Reference screenshot — Claude Code shell/system turn (authoritative, 2026-08)

A real Claude Code conversation turn was supplied as the ground truth: a shell/system task showing
`df -h`-style output on a Debian container, followed by a prose "Summary" section. Measured/observed
patterns from it, and how we match them:

- **Turn layout:** assistant reply is **full-width prose** — no card, no bubble, no avatar. Matches
  our `SayItem` (full column, small quiet `agent` label above). ✔
- **Typography:** body prose is a sans face at ~15px with generous line spacing (~1.6); the
  **"Summary" heading** is bold, one modest step up from body. Comfortable measure filling the
  column. Our `.prose-agent` (15px/1.65, h2≈1.2em semibold) matches. ✔
- **`df -h` / ASCII output renders as a MONOSPACE PREFORMATTED BLOCK, not a GFM table.** The
  box-drawing/columnar output is a plain fenced block (no language) on a **subtly tinted neutral
  panel** (distinct from the canvas), whitespace preserved, horizontal scroll for long lines, one
  hover copy affordance. It is **not** syntax-coloured — plaintext stays uncoloured.
  - Our pipeline: `isCodeBlock` routes any multi-line/`language-*` content to `CodeBlockCode`; a
    no-language fence resolves to `text` in Shiki → **no** highlight, matching the reference's plain
    mono. `whitespace-pre` on the `<pre>` preserves column alignment of ASCII tables. ✔
- **Code-block surface:** the reference panel is a faint neutral fill, NOT the page white. Our old
  `bg-card` equalled the pure-white light canvas, so fenced/ASCII blocks were white-on-white (only a
  hairline). Fixed to **`bg-muted/40`** on the wrapper, and Shiki's baked-in `<pre>` background is
  forced transparent (`[&>pre]:!bg-transparent`) so highlighted and plain blocks share one neutral
  surface in both themes. ✔ (this is the primary gap the screenshot exposed)
- **Tables vs. fences:** genuine GFM tables (`| a | b |`) still render as real tables via
  `.prose-agent table`; only monospace/columnar shell output stays preformatted. Matches the
  screenshot (its tabular `df -h` output is preformatted mono, because that is how the tool emitted
  it — not a markdown table).
- **Colour:** the reference canvas is warm off-white with dark text; we keep our cool-zinc system
  (documented deviation below), but ensured the code panel now reads as a distinct surface in both
  light and dark, and prose text/borders stay legible in both.

### Deliberate deviations we KEEP where they don't conflict with the reference
- Shell **tool** output (Bash/Shell trace events) still renders in our **dark terminal panels**
  (`--trace`), richer than Claude's light treatment — our shell-heavy runs benefit and this is a
  documented product deviation. Markdown-embedded ASCII/preformatted **prose** (the screenshot case)
  now matches the reference light-neutral panel. If a run emits the `df -h` output as a fenced block
  in the agent's *say*, it renders exactly like the reference; if it comes through as a Bash tool
  result, it renders in our terminal panel by design.

## 9. Deliberate deviations from Claude (kept on purpose)

- **Inter + Hedvig Letters Serif** instead of anthropic-sans/serif (product brand).
- **Blue user bubble** instead of Claude's grey neutral fill (our single filled voice).
- **Cool zinc** neutrals instead of Claude's warm neutrals (existing pixel-match reference).
- Richer **terminal panels** and **tool-group pills** than Claude — our data model (shell-heavy agent
  runs) benefits from it; Claude's chat is lighter-weight on tools.
