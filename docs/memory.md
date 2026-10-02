# Memory across runs (v2)

A box is thrown away with its run. Memory is what survives: typed notes the agent writes as it
works, filed per operator and per repo, handed to the next run as `MEMORY.md`. No embeddings, no
graph, no second LLM call — the agent in the box does the extraction, the controller only parses.

Code: `src/memory-store.ts` (model, grammar, retrieval, export/import), `src/memory-harvest.ts`
(incremental harvest), `src/drivers/memory-tool.ts` (the in-box `memory` command),
`src/drivers/sentinels.ts` (the shared grammar), `installMemory` in `src/msb.ts`, routes and the
fleet-tick harvest in `src/http.ts`.

## Model

One encrypted `user_blobs` row per owner (kind `memory`): `{ enabled, global: Note[], repos: { "<owner/name>": Note[] } }`.

```ts
MemoryNote = {
  id, kind, scope, status, text, why?, repo?, source, at, pinned?,
  supersedes?, until?,   // replaced-by history: the old note carries `until`
  uses?, lastUsed?,      // playbooks: bumped when a task matches (promote-to-skill signal)
  area?, paths?, links?, // knowledge base: the page a repo note belongs to, the code it describes, related areas
  stale?,                // { at, box, paths } — anchored code changed since; cleared by reaffirm/replace/verify
}
```

| kind | what | scope | status on arrival |
|---|---|---|---|
| preference | how the operator wants things in general | operator | kept |
| rule | standing "when X, do Y" | operator | kept |
| fact | repo / environment knowledge | repo* | kept |
| decision | answered question or a settled choice, with `why` | repo* | kept |
| lesson | a correction or an abandoned approach, with `why` | repo* | pending |
| playbook | title line + the exact steps that worked | repo* | pending |

\* repo when the box has exactly one repo, otherwise operator.

- **pending** notes are already in `MEMORY.md` (default is keep). The thread toasts them; the
  operator keeps, edits or forgets. Nobody acting within 10 minutes → the harvest tick keeps them.
- **Caps** per kind and list (operator: preference 40, rule 40; per repo: fact 30, decision 30,
  lesson 30, playbook 15). Eviction is the oldest unpinned note *of that kind*. Superseded notes
  don't count (their history is capped separately at 60 per list).
- **Superseded** notes (`until` set) leave `MEMORY.md`, `MEMORY-all.md` and the caps but stay in the
  store, so the page can show them under "Earlier".
- **Migration**: v1 notes (no kind) load as kept facts in the scope of the list they sat in.
- Texts ≤ 400 chars (playbook ≤ 1200), `why` ≤ 300.

## Grammar

```
<!-- remember: <kind> | <text> [| area: <part/subpart>] [| paths: a, b] [| links: <area>, …] [| why: <text>] [| replaces: "<old note text>"] -->
```

One note per line; a block may hold several; several blocks are fine; allowed anywhere in the run.
A line without a kind is a `fact` (the v1 grammar). A playbook continues on indented lines (its
steps). `replaces:` is matched by normalised text (case, whitespace, punctuation) against the
active notes of the same scope — exact first, then containment for quotes of 12+ chars — and
supersedes the match (within the note's area first). The operator's own turns (`⟦you⟧…⟦/you⟧`)
are never parsed. Answered questions are not saved on their own — a choice worth keeping is the
agent's to record as a `decision`. Every text is tidied on the way in (`tidyNoteText`: lead-ins
dropped, sentence case, full stop).

## Knowledge base (memory v3)

A repo's memory reads as a knowledge base of **areas** — pages for the parts of the app
(`billing/invoicing`, `auth`, `orders/refunds`; `areaKey` normalises to ≤ 2 lowercase segments).
The kind **`domain`** holds how the product works: an entity and what it means, a flow's steps, a
business rule or invariant, which service owns what and who consumes it. Any repo-scoped kind may
carry `area:`, `paths:` (the repo-relative files/globs that implement it — the Swimm-style coupling)
and `links:` (related areas — the graph). Preferences and rules never carry them.

It keeps itself current without a second LLM pass:

- **Reaffirm** — writing a note that already exists (typically `replaces:` quoting itself) refreshes
  `at`/`source`, merges new paths/links and clears `stale`; nothing is duplicated and nothing is
  shown in the thread.
- **Revise** — a same-kind note in the same area whose stems overlap an existing one by
  ≥ `MEMORY_LIMITS.revisionOverlap` (0.6, `textOverlap`) supersedes it as a *pending* note
  (`why: "Revises: …"`); the toast reads "Updated · area"; Forget restores the old note.
- **Drift** — at a run's finish edge, `markStaleByPaths` flags active notes whose `paths` cover a
  file the run changed (`listChanges`), unless that run wrote the note. MEMORY.md marks the line
  `⚠ unverified since <date> (changed: …)` and asks the next run in that area to reaffirm or replace
  it; the page shows "Unverified since … · Still true" (`POST { id, verified: true }`).

References: CodeWiki/OpenWiki (one page per module with an always-present index, patched
incrementally), Swimm (docs coupled to code paths, flagged when the code moves), Graphiti (facts with
validity windows — our `supersedes`/`until`).

## Harvest

`MemoryHarvester.harvest(box, owner, log, repos)` parses the (already redacted) log, skips note keys
this box produced before (a per-box `Set`, dropped at teardown — kept across resumes so a forgotten
note is never resurrected from the old log), stores the rest and auto-keeps stale proposals.

- **Live**: the fleet sweep in `src/http.ts` calls it for running boxes whose `lastOutputAt` moved, at
  most every 5 s per box. Repo scope during the run comes from the same origin-remote probe
  `installMemory` uses, cached per box.
- **Finish**: `archiveFinishedRun` does a forced last pass with the answered questions and stamps
  the digest/outcome with `remembered` and `rememberedKinds`.
- A box's notes from the last 15 minutes ride its `WatchSnapshot.memoryNew` (both statuses) for the
  toasts; a change in ids or statuses fires an SSE `state` frame.

## The `memory` tool (in the box)

Installed by the bootstrap at `/usr/local/bin/memory` (POSIX sh):

- `memory search <words…>` — notes in `~/.claude/MEMORY.md` and `~/.claude/MEMORY-all.md` containing
  every word (case-insensitive).
- `memory add <kind> <text…> [--area <slug>] [--paths <a,b>] [--links <a,b>] [--why <t>] [--replaces <old text>]`
  — validates the kind (a `domain` note needs `--area`) and appends the sentinel line to
  `/workspace/.agent.log` (⟦ defanged like the follow-up echo), so it goes through the same harvest
  as a line written in prose.
- `memory areas` — the knowledge-base index (from `MEMORY-all.md`'s `## Areas`).
- `memory area <slug>` — one area's page: its notes, then the notes of each linked area.
- `memory help`.

## Retrieval

`installMemory(cfg, box, task?)` writes before every turn, into `~/.claude` and `~/.omp`:

- `MEMORY.md` — **Core** (preferences, rules, pinned notes) + **Knowledge base — <repo>**: the area
  index always (`- area · n notes (kinds) · paths … · links … · k unverified`, ≤ 40 rows) and full
  pages for the areas the task is about (`scoreArea`: capped note scores + the area's name in the
  task + a path the task names; top 3, ≤ 25 notes each; no match → the most recently updated area)
  + **For this task**: the notes filed under no area, scored against the task with `scoreSkill`
  (`src/skill-match.ts`; a playbook's title is its name), top 25 at or above the threshold — or,
  when nothing matches, **Recent**: the newest 25. Ends with a pointer to `memory search`.
- `MEMORY-all.md` — every active note the box may see, tagged `[kind · area]` with `{paths}`
  `{links}` and the drift marker, plus the `## Areas` index, for `memory search` / `memory area`.

Matched playbooks get `uses++`/`lastUsed`, and on the first turn the one-liner "A playbook exists
for this: <title> — see MEMORY.md" rides the same env as the skill hint.

## API

- `GET /memory-notes.json` → `{ enabled, notes }` (superseded included).
- `POST /memory-notes.json` with `{ enabled }` | `{ id, text?, why?, pinned?, status?: "kept" }` |
  `{ add: { kind, text, why?, repo? } }` → same shape; 400 `{ error }` on bad input.
- `DELETE /memory-notes.json?id=` → same shape.
- `POST /memory-promote.json { id }` → `{ skill: { name }, enabled, notes }`; 409 when the skill name exists.
- `GET /memory-export.md` (`## operator` / `## <owner/name>` headings, `- [kind] text` lines);
  `POST /memory-import.json { markdown }` → same shape as GET.
- Audit actions: `memory.keep|edit|forget|add|promote|import`.

Not in scope: embeddings, graph memory, LLM-side consolidation, per-agent memory.
