# agent-sandbox — Style Reference

> Operations Slate. A calm cool-gray operations console (Linear / Vercel lineage) where run STATE
> is the loudest signal, one azure carries every action, and geometry is crisp panels and rows —
> not pills.

**Theme:** mixed (deep-slate dark default, cool-paper light mode)

The interface is a data-dense operational console, not a document. A cool-gray field stays out of the
way so status reads instantly. **Run state is functional colour** — working = azure pulse, needs-you =
amber (the only thing with a deadline), done = slate, error = red — always paired with a glyph + word
so meaning survives colourblindness. One azure (`#2f6fed`) carries every button and link. Elevation is
a single surface lift plus a hairline, never a drop shadow. Radii are small and systematic (6–12px);
the only round things are the live dot and avatars. Type is tuned tighter for scanning (14px UI base);
agent output is the single exception and steps up to 16px because it is read, not scanned. Monospace is
reserved for genuine machine text: identifiers, vitals, tool calls, log output, stamps.

## Tokens — Colors

| Name | Value (dark) | Value (light) | Token | Role |
|------|--------------|---------------|-------|------|
| Azure | `#2f6fed` | `#2563eb` | `--accent` | THE action. Every filled button and primary CTA. |
| Azure Text | `#6ea8ff` | `#1d4ed8` | `--accent-text` | Azure as text/icon/state (working), contrast-safe per theme, and focus ring. |
| Attention | `#eab308` | `#d97706` | `--attention` | Needs-you amber — the one state with a deadline. Fill for the waiting banner. |
| Attention Text | `#fbbf24` | `#b45309` | `--attention-text` | Needs-you as text/glyph (stamp, banner label). |
| OK | `#34d399` | `#059669` | `--ok` | Completed / healthy green (available to vitals & badges). |
| Foreground | `#eef2f8` | `#0b1220` | `--fg` | Primary text. |
| Ash | `#93a0b5` | `#5b6577` | `--muted-fg` | Secondary text, labels, machine metadata. ≥4.5:1 on the field. |
| Line | `#232c3f` | `#e2e8f0` | `--line` | Hairlines, dividers, input borders. Visible in both themes. |
| Line Strong | `#334155` | `#cbd5e1` | `--line-strong` | Hover borders, scrollbar thumb — one step firmer than a hairline. |
| Canvas | `#0b0f1a` | `#f6f8fb` | `--canvas` | Page field. |
| Surface | `#121826` | `#ffffff` | `--surface` | Panels, cards, composer, active rows. |
| Raised | `#1a2234` | `#ffffff` | `--raised` | Popover / hover lift. |
| Trace | `#070a12` | `#0b0f1a` | `--trace` | Terminal ground, darker than canvas. |
| Danger | `#f26d6d` | `#dc2626` | `--danger` | Destroy + non-zero exit. Functional, not expressive. |

State is the exception to "one accent": working/needs-you/done/error each carry a functional hue, but
**always** with a distinct glyph + word (see State Stamp) so colour is never the sole carrier.

## Tokens — Typography

### Archivo — the single face
- **Substitute:** Helvetica Now Display, Neue Haas Grotesk, Inter
- **Weights:** 400, 500, 600, 700
- **UI base:** 14px / 1.6 — console density; the interface scans, it does not read long-form
- **Tracking:** −0.03em at display sizes, −0.01em at headings, 0 at body
- **Role:** wordmark, display, headings, body, controls

### IBM Plex Mono — machine text only
- **Weights:** 400, 500
- **Role:** machine identifiers, vitals (tabular), tool calls, log output, stamps. Never for prose,
  never as a "technical" costume.

### Type Scale

| Role | Size | Line height | Tracking |
|------|------|-------------|----------|
| stamp | 10.5px | 1.2 | 0.08em, uppercase, mono |
| micro | 11px | 1.4 | 0 |
| meta | 13px | 1.5 | 0 |
| body | 14px | 1.6 | 0 |
| prose (agent output, read) | 16px | 1.65 | 0 |
| h3 | 18px | 1.35 | −0.01em |
| h2 | 22px | 1.25 | −0.01em |
| h1 | 28px | 1.15 | −0.02em |
| display | 38px | 1.05 | −0.03em |

Agent output (`.prose-agent`) is the single place type steps UP — 16px at 1.65, `max-width: 72ch` —
because it is read rather than scanned.

## Tokens — Spacing & Shapes

**Base unit:** 4px · **Density:** dense (operational console)

### Border Radius — crisp panels, no pills

| Element | Value | Token |
|---------|-------|-------|
| buttons, chips, inputs, rows | `8px` | `--radius-md` |
| badges | `4px` | (rounded) |
| cards, panels | `10px` | `--radius-lg` |
| composer, tool/log blocks | `12px` | `--radius-xl` |
| bubbles | `12px` | `--radius-bubble` |
| live dot, avatars **only** | `9999px` | `--radius-pill` |

Geometry is crisp: small, systematic radii. The only round things are the live indicator dot and
message avatars. Focus rings are `--radius-sm` (6px), matching the console shape — no pill ring.

### Layout

- Conversation column: `max-width: 768px`, centred — the ChatGPT measure.
- Sandboxes section: `max-width: 1100px`.
- Sidebar: `clamp(17rem, 23vw, 20rem)`.
- Section gap: `48px`. Card padding: `20px 24px`. Element gap: `12px`.

## Components

### Action (primary)
Azure fill, white text, `8px` radius, `h-9 px-3.5`, weight 500. Hover mixes 12% white into the fill
(not a brightness filter). The only filled-accent element on screen at a time where possible.

### Action (secondary)
Transparent fill, `1px` line border, foreground text, same geometry. Hover fills with a surface lift
and firms the border to `--line-strong`.

### Icon Button
`8px` radius, 32–36px (44px touch), ash icon, hover shifts surface. Used for send, theme, back, destroy.

### Composer
`12px` radius, surface fill, line border, focus border azure. Textarea grows by CSS. Controls sit
inside on the bottom row. Hint text sits *below* the composer in ash at 13px. ChatGPT composer
geometry, on the console's crisp radius.

### Message — user
Right-aligned, `22px` radius with a `6px` bottom-right tail, surface-shift fill (not azure — azure
is for actions), max-width `70%`.

### Message — agent
**No bubble.** Full column width, prose at 18px/1.6, a small ash label above. This is the ChatGPT
treatment and it is correct: the agent's output is prose and deserves the measure.

### Tool Call
One mono row, `14px` radius on hover, output folded behind a disclosure. Result preview in ash.

### State Stamp
Mono, 11px, uppercase, tracked. Glyph + word, never colour alone:
`● working` (ink) · `❚❚ needs you` (azure) · `■ exit 0` (ash) · `○ idle` (ash).

### Sandbox Card (Sandboxes section)
`20px` radius, surface fill, pebble border, no shadow. Header row: state stamp + machine id.
Body: what it is doing. Footer: vitals in mono + pill actions (Open, Answer, Destroy).

## Do's and Don'ts

### Do
- Use `#023e8a` for actions, active selection, focus, and the one state that needs a human.
- Make every button a full pill and every panel `20px`+ rounded.
- Set agent prose at 18px with 1.6 leading, capped at a ~70ch measure.
- Express elevation as a surface colour shift (canvas → surface), never as a shadow.
- Keep monospace for machine text: ids, vitals, tool calls, logs, stamps.
- Give the agent's output the full column with no bubble; bubble only the human's turns.

### Don't
- Don't add a second accent hue. States use glyph + label + weight.
- Don't use `#023e8a` as a surface on light — it is an action and a state colour.
- Don't put `#023e8a` text on dark surfaces; use Azure Lift, which is the same hue made legible.
- Don't apply box-shadows to cards, bubbles, or the composer.
- Don't set prose below 15px, or agent output below 18px.
- Don't square any control. No sharp-cornered buttons, inputs, or cards.
