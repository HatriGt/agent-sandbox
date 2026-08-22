# agent-sandbox — Style Reference

> Azure on parchment. A single deep-blue accent breaking a monochrome ink system, pill-shaped
> actions, and a ChatGPT-shaped conversation that happens to be driving a real machine.

**Theme:** mixed (parchment canvas default, deep-ink dark mode)

The interface reads as an editorial console: a near-monochrome ink-on-parchment system where one
deep azure (`#023e8a`) carries every action and every moment that needs a person. Type is a single
grotesk at generous size and leading — 18px body at 1.6, display weights at 700 with tight tracking
— so a machine's prose output reads like prose. Every action is a full pill; every surface is
generously rounded; elevation is expressed by surface colour shift, never shadow. Monospace is
reserved for what is genuinely machine text: identifiers, vitals, tool calls, log output.

## Tokens — Colors

| Name | Value | Token | Role |
|------|-------|-------|------|
| Azure | `#023e8a` | `--azure` | THE accent. Primary actions, the state that needs a human, active selection, focus. Never decoration. |
| Azure Lift | `#5b93e8` | `--azure-lift` | The same hue lifted for legibility as text/iconography on dark surfaces, where `#023e8a` is too dark to read. |
| Deep Ink | `#000d10` | `--ink` | Primary text on light, filled dark actions, the structural near-black. |
| Cool Ash | `#8e8e95` | `--ash` | Secondary text, labels, machine metadata. The only neutral that recedes on purpose. |
| Pebble | `#d5d3d4` | `--pebble` | Hairlines, dividers, input borders. Visible only at edges. |
| Parchment | `#fbfaf8` | `--canvas` | Page canvas (light). Warm white, not clinical. |
| Pure White | `#ffffff` | `--surface` | Cards, composer, raised surfaces on the light canvas. |
| Midnight Hull | `#0f0f1c` | `--canvas-dark` | Page canvas (dark). |
| Charcoal Deck | `#151623` | `--surface-dark` | Raised surfaces on dark: composer, cards, active rows. |
| Signal Red | `#b4232a` | `--danger` | Destroy only. Functional, not expressive. |

Monochrome plus one accent. Do not introduce a second hue for state; states differentiate by
label, weight, and glyph — see State Stamp.

## Tokens — Typography

### Archivo — the single face
- **Substitute:** Helvetica Now Display, Neue Haas Grotesk, Inter
- **Weights:** 400, 500, 600, 700
- **Body:** 18px / 1.6 — the leading is a signature; agent output is prose and must breathe
- **Tracking:** −0.03em at display sizes, −0.01em at headings, 0 at body
- **Role:** wordmark, display, headings, body, controls

### IBM Plex Mono — machine text only
- **Weights:** 400, 500
- **Role:** machine identifiers, vitals (tabular), tool calls, log output, stamps. Never for prose,
  never as a "technical" costume.

### Type Scale

| Role | Size | Line height | Tracking |
|------|------|-------------|----------|
| stamp | 11px | 1 | 0.1em, uppercase, mono |
| meta | 13px | 1.45 | 0 |
| body | 15px | 1.6 | 0 |
| prose | 18px | 1.6 | 0 |
| heading | 24px | 1.2 | −0.01em |
| display | 40px | 1.05 | −0.03em |
| hero | 56px | 1.0 | −0.03em |

## Tokens — Spacing & Shapes

**Base unit:** 4px · **Density:** spacious

### Border Radius

| Element | Value |
|---------|-------|
| buttons, chips, pills | `9999px` |
| composer | `28px` |
| cards, panels | `20px` |
| inputs, rows | `14px` |
| bubbles | `22px` (with a `6px` tail corner on the sender side) |
| tool/log blocks | `14px` |

No square corners anywhere in chrome. The only hard edge permitted is a hairline rule.

### Layout

- Conversation column: `max-width: 768px`, centred — the ChatGPT measure.
- Sandboxes section: `max-width: 1100px`.
- Sidebar: `clamp(17rem, 22vw, 20rem)`.
- Section gap: `48px`. Card padding: `20px 24px`. Element gap: `12px`.

## Components

### Pill Action (primary)
`#023e8a` fill, white text, `9999px` radius, `10px 18px`, weight 500. The only filled-accent
element on screen at a time where possible.

### Pill Action (secondary)
Transparent fill, `1px` pebble border, ink text, same geometry. Hover fills with surface shift.

### Circular Icon Button
`9999px`, 36px (44px touch), ash icon, hover shifts surface. Used for send, theme, back, destroy.

### Composer
`28px` radius, surface fill, pebble border, focus border azure. Textarea grows by CSS. Controls sit
inside on the bottom row; the send button is a circular azure pill. Hint text sits *below* the
composer in ash at 13px. This is the ChatGPT composer geometry and it is deliberate.

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
