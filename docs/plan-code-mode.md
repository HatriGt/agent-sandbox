# Plan — Code mode for MCP (the agent writes one script instead of N tool calls)

**Written 2026-11-15.** Status: proposed, not approved. Nothing in this plan is built.

## 0. Decision summary

- **Anthropic's own Code Mode (Claude Code ≥ 2.1.323, `CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1`) is
  unusable for us:** interactive sessions only (`claude -p` falls back to the normal tools — verified
  on 2.1.325), Anthropic API only (we go through ccproxy), needs feature-flag traffic, and nobody has
  documented whether PreToolUse hooks see the calls a script makes. Not an option, now or soon.
- **We build our own, as an in-box MCP server, and it wraps MCP tools only.** The three references
  (gabe4coding/claude-code-mode, Cloudflare `codemode`, Anthropic's "Code execution with MCP" +
  Programmatic Tool Calling) all stop at MCP/connector tools, and Anthropic says plainly that
  step-by-step work where the model must reason between calls does not benefit (τ²-bench: no accuracy
  gain, ~8% more cost). That is ordinary coding. The win is the other workload: HANA, Jira/Confluence,
  GitHub search, BTP — many tools, big results, lots of filtering.
- **The biggest single saving is hiding tool definitions, not the script.** Cloudflare's 1.17M → 1k
  tokens is that. With code mode on, Claude sees two tools (`search`, `run`) instead of every server's
  schema on every request (hana-btp alone is ~35 definitions).
- **Ships behind a per-account flag, default off, and the default only flips after the bench says
  so** (§7). If the numbers do not clear the gate, the flag stays opt-in and we say why.

## 1. Why it matters for the product

Runs that use MCP servers are the SAP-consulting audience we actually have (HANA, Atlassian, BTP).
Those runs are the ones that hit the context window, auto-compact mid-task, and cost the most. Fewer
tokens per MCP-heavy run = cheaper runs, fewer compactions, longer tasks that finish. It is a
retention lever for exactly the users who stay, and it is invisible to everyone else (off by default,
nothing changes when no MCP server is configured).

## 2. What each reference does, and what we take

| | gabe4coding plugin | Cloudflare codemode | Anthropic (post + PTC) | **Ours** |
|---|---|---|---|---|
| Runs as | Claude Code plugin (needs ≥ 2.1.295, plugin API `$.tool.call`) | MCP server / agent library (Workers) | API feature + hosted container | **In-box MCP server, Node, no CLI upgrade** |
| Scripts may call | MCP tools only | Connectors only | Tools marked `allowed_callers` | **MCP tools only (v1)** |
| Discovery | `search_tools` + remembered result shapes | `search()`/`describe()` inside the script, schemas → TypeScript | one `.ts` file per tool, browsed or searched | **`search(query, detail)` → TS-style signatures + remembered shapes** |
| Sandbox | separate Node process: `vm`, `--permission`, `env -i`, no net, CPU limit | fresh Worker per run, no net | hosted | **gabe's layers; verify in a box (§8)** |
| Bridge | request line on stdout, reply via file (plugin API limit) | Proxy object → host dispatcher | tool_use blocks | **stdin/stdout both ways (we own both ends)** |
| Permissions | CC's check per nested call; headless needs allow rules | per-tool "requires approval" pauses the run | "not a security boundary" | **enforced in our server (hooks see only the outer call); headless ⇒ deny with a clear message, never pause** |
| Measured | Haiku: cost −43%, input −10%, 30/30 correct | 1.17M → 1k tokens of definitions | 75-tool bench: input −38% | **to be measured (§7)** |

Worth copying, with the source:

- **Say it at session start** (gabe): one line in the system prompt took direct calls from 89% to 2%.
  For us compliance is by construction — the direct tools are not there — but the line still tells
  the model *how* to work (search first, filter in the script, return small).
- **Check names before running** (gabe): literal `call("mcp__x__y", {...})` names and argument names
  are validated against the schemas; a write at the top of a script never fires when a later line
  has a typo.
- **Per-call summary + `recall(n)`** (gabe): after a run, one line per MCP call with size and *shape*
  (field names, array lengths — never values); results stay in memory for the session so a later
  script can re-read one without a new call. Opus: duplicate calls per task 1.37 → 0.10.
- **Schemas → types with JSDoc, cycles → `unknown`, names sanitized** (Cloudflare `json-schema-types.ts`).
- **Repair model-written code** (Cloudflare `normalize.ts`): strip fences, unwrap `export default`,
  add a trailing `return`, wrap in `async () => {}`.
- **Errors are values, never throws across the boundary; late calls are settled with a "late" error;
  "X is not defined" errors append the list of real globals** (Cloudflare).
- **Caps that keep JSON valid and say they cut** (both): return value 20k chars, console 4k, upstream
  results 24k with `--- TRUNCATED ---` markers and a "narrow the request" note.
- **Large data goes to a file, not the context** (gabe `saveFile`, Anthropic `./workspace`): we write
  under `/workspace/.agent-out/` so the artifact cards pick it up.

Explicitly **not** copying: Cloudflare's pause-and-resume approval (needs a human in the loop; our
question gate already covers "ask the operator"), Anthropic's PTC (API-level, Claude Code does not use
it for MCP), gabe's hints/saved-functions (phase 4 at most), and giving scripts Bash/Read/Edit (§9).

## 3. Architecture

```
dashboard MCP store ──installMcpConfig──▶ box
                                          /root/.agent-mcp.json      = { code: node ~/.claude/code-mode/server.js }
                                          /root/.agent-mcp.upstream.json = the operator's servers (600)
claude -p ── mcp__code__search / mcp__code__run ──▶ server.js (MCP stdio server + MCP client to upstream)
                                                        │ spawn per run: node --permission … runner.js
                                                        ▼
                                                   vm context: call(), recall(), saveFile(), console.log, return
```

### 3.1 The server (`~/.claude/code-mode/server.js`)

- Shipped base64 the way `guard.js` and `stream-fmt.js` are (`src/drivers/claude.ts`), generated from
  `src/code-mode/*.ts` so the tests and the box agree. Lives under `~/.claude` → already a guarded
  control-plane path.
- Uses `@modelcontextprotocol/sdk` **baked into the image** (`bake-claude-image.ts` already
  pre-installs MCP packages globally; the controller already depends on the SDK). Hand-rolling the
  stdio server is ~150 lines; hand-rolling stdio + Streamable HTTP + SSE *clients* is not worth it.
  Fallback if the bake cannot carry it: stdio-only hand-rolled client, http/sse servers stay direct.
- Answers `initialize` and `tools/list` immediately (two tools) and connects upstream **lazily in the
  background**: Claude waits at most `CLAUDE_CODE_MCP_STARTUP_WAIT_MS=3000` for servers, and today a
  slow upstream only delays its own tools; it must not delay all of them.
- Two tools, nothing deferred:
  - `search({ query, detail: "names" | "signatures" | "full" })` — token search over name,
    description, server (Cloudflare weights); returns TS-style signatures with JSDoc, the remembered
    result shape (`returns (earlier call): {rows: [{id, status, …+5}]}`), and connection errors for
    servers that failed. Empty query lists everything at `names` level.
  - `run({ code })` — body of an async function. Globals: `call(name, args)`, `recall(n)`,
    `saveFile(name, data)`, `sleep(ms)`, `console.log`, `return`. Result text: value (≤20k) +
    console (≤4k) + the per-call summary.
- Policy, enforced here because hooks only see the outer `run` call:
  - only tools of the servers in the upstream file; a per-server/per-tool deny list from the
    dashboard (phase 4) is honoured by hiding them from `search` and refusing them in `call`;
  - pre-run literal-name/argument check; at most 8 in-flight upstream calls; wall clock 120 s,
    CPU limit via `ulimit -t`; late calls settled as errors;
  - headless means nobody can approve anything: a refused call throws a message that names the rule,
    never waits.
- Secrets: the upstream file carries env/headers with tokens, exactly as `/root/.agent-mcp.json`
  does today (600, guard-protected, in `SECRET_NAMES`). The sandbox child runs with `env -i`,
  `--permission` (read access to runner + exchange dir only) and no network, and only strings cross
  the `vm` boundary, so a script cannot reach the tokens. The server process holds them — same
  exposure as Claude Code holding them today.

### 3.2 The sandbox child (`runner.js`)

gabe's four layers, each one verified in a real box before relying on it (§8): `vm` context with
null-prototype global and string-only bridge; `node --permission --allow-fs-read=<runner>,<xdir>`
(needs Node ≥ 22.13 in the image — **check**; if older, that layer is dropped and the rest holds);
`env -i`; `unshare -rn` if the microVM kernel allows user namespaces, else nothing (the box egress
allowlist still applies and `fetch` does not exist in the context); `ulimit -t` + a wall-clock timer.
Bridge is JSON lines on stdin/stdout in both directions — we own both ends, so no reply files.

### 3.3 Wiring in the controller

| Where | Change | Status (Phase 2a, 2026-11-15) |
|---|---|---|
| `src/agent-kind.ts` | `AgentPrefs.codeMode?: "on"` (absent = off), parsed like `autoCompact`; per-run override in the delegate body like `autoCompact` (`src/http.ts:2410`). | **Done, changed:** prefs only (`codeModeEnabled`, `"on"`/`"off"` accepted on write). The install reads the box OWNER's prefs; `http.ts` only carries the stored value into delegate bodies that lack it. No per-run override is wired, same as `autoCompact` is effectively applied. |
| `src/msb.ts installMcpConfig` | when on **and** `toClaudeMcpConfig` has ≥ 1 box-runnable server: write upstream file + wrapper config; run `node server.js --check` in the same exec; on failure write the direct config instead and record `code-mode: fallback (<why>)` in `MCP_NOTES_PATH` (the watch probe and the MCP page already surface those notes). No server configured ⇒ nothing changes at all. | **Done, changed:** pure `mcpInstallSh(plan)` builds the ONE exec; the server files (`codeModeFiles()`, base64 JSON ≈ 111k chars) ride its stdin (`codeModePayload` → `CODE_MODE_WRITE_JS`), only named files are written so `shapes.json` survives. The direct config is written first and stays as the fallback; the wrapper (with `alwaysLoad: true`, `env.R`) replaces it only after `--check` passes. The upstream file is created 600 under `umask 077` and also goes through the npx→bin rewrite; flag off or no servers ⇒ it is removed. `rememberProvision` parses the note into `codeModeFallback`. A controller without a build writes the direct config with `code-mode: fallback (the controller has no code-mode build: …)`. |
| `src/drivers/claude.ts claudeLaunchSh` | unchanged: `--allowedTools` is derived from the config file, so it becomes `mcp__code`. | **Done, changed:** `--allowedTools` derives `mcp__code-mode` from the file as planned; plus a prefix that appends `CODE_MODE_DIR/prompt.txt` to `$AGENT_SYS_PROMPT` only when the installed config names `server.js` (decided from the file, so a fallback box is never told its tools are hidden). |
| `src/guard.ts` | add `.agent-mcp.upstream.json` to the control-path regex and `SECRET_NAMES`. | **Done.** |
| `src/agent-prompt.ts` / `src/drivers/prompts.ts` | one paragraph when on: MCP tools are reached through `mcp__code__search` then `mcp__code__run`; filter in the script; return only what the task needs; `recall(n)` instead of re-calling. Part of `--append-system-prompt`, so it survives compaction. | **Done, moved:** the paragraph is `CODE_MODE_PROMPT` in `src/code-mode/index.ts`, shipped as `prompt.txt` with the server files and appended at launch (row above), not in the shared prompts. |
| `src/drivers/claude.ts streamFmtScript` | headline arg for `run` is the first line of `code`; the script is written as a `⟦code⟧…⟦/code⟧` block (capped like `⟦diff⟧`); the tool result already carries the per-call summary lines. | **Done (Phase 2b).** `run`'s headline is the script's first non-empty line (200 chars); the script follows as `⟦code⟧ <ms>`…`⟦/code⟧` (`CODE_*` in `sentinels.ts`: 400 lines / 32 KB, leading blank lines dropped, `… N more lines` tail, `df()`-defanged). `search`'s arg is its `query`. Driver snapshot regenerated: only the embedded stream-fmt.js changed (the 4 `bootstrap:*` cases). Tests: `test/code-mode-view.test.ts`. |
| `src/trace.ts`, `web/src/lib/mcp.ts`, thread cards | `parseMcpName` would file `mcp__code__run` under a server called "code"; add a dedicated card: the script (collapsed), the calls it made (server · tool, size, shape), the returned value through the existing MCP result views (table / kv / json). `ReasoningTrail`'s "N MCP calls" counts inner calls from the summary lines. ContextRing/ledger: unchanged (usage frames). | **Done (Phase 2b).** `src/trace.ts` attaches `⟦code⟧` to the tool event as `code` (the web re-exports the same parser). `web/src/lib/mcp.ts`: `parseMcpName` sets `codeMode: "run" \| "search"` on the wrapper's tools; pure `parseCodeModeResult` (value / console / calls / totals / recall, parsed from the end), `scriptHeadline`, `scriptServers`, `mcpCallCount`. `CodeModeItem.tsx`: a "code mode" chip and the first line in the header; body = the script (JS-colored with the shared shiki core, folded past 12 lines), the calls (server chip, tool, size, shape, failed/unfinished marked), the returned value through `analyzeResult`, then console; collapsed it shows "N calls · <summary>". `search` uses McpItem with `asText` (mono text, "N tools"). The MCP-connect hairlines, `toolFacts`, ReasoningTrail ("Made N external calls", "Running a script on tracker") and live-activity count the inner calls and servers, not "code-mode". |
| `src/mcp-store.ts` / MCP settings page | the toggle lives next to the servers it affects, with the one-paragraph explanation and the last bench numbers. | **Done (Phase 2b), moved:** `web/src/components/mcp/CodeModeSetting.tsx`, above the server table on the MCP page (not in `mcp-store.ts`). A switch bound to agent-prefs `codeMode`; the POST echoes `defaultAgent`/`defaultModel`, because a body without them resets those. The copy has the §7.1 bench line and "Claude Code threads only". It warns when the last reported `baked` lacks `@modelcontextprotocol/sdk` and shows `lastProvision.codeModeFallback`. It is disabled when no server is on (it can still be switched off). Same per-principal endpoint as Settings → Drivers. |
| `src/ask.ts` | nothing: the ask lane has no MCP tools today (`ASK_ALLOWED_TOOLS`). | Unchanged, as planned. |

### 3.4 Other drivers

omp reads `/root/.omp/agent/mcp.json`, which `installMcpConfig` writes with the same JSON, so it gets
the wrapper for free — verify its tool naming and that `node` resolves. codex: `mcp_tool_call` items
already carry server/tool; the formatter will show `code · run`. Both are verification items, not
work items, in phase 2.

**Open (Phase 2a decision):** omp does NOT get the wrapper: `mcpInstallSh` always writes the direct
servers to `/root/.omp/agent/mcp.json`, because omp's handling of `alwaysLoad` and its MCP tool
naming are unverified. Turning it on for omp needs those two checks in a box, then the omp config
write switched to the wrapper (and the prompt paragraph added to omp's launch). codex is untouched.

## 4. Hooks and the question protocol

The PreToolUse chain (`ask-gate`, `inbox-gate`, `ask-ro`, `guard`) fires on every `mcp__code__run`
exactly as on `Bash`: a pending question still halts the turn, a queued operator message still lands
at the next tool call, the guard passes (no file paths). What changes: one script = one hook pass
instead of one per MCP call, so an operator message queued mid-script arrives after the script. Same
latency as a long `Bash` today; acceptable, documented.

## 5. Failure modes and what the operator sees

| Failure | Behaviour |
|---|---|
| `server.js` cannot start (SDK missing, syntax) | install `--check` fails → direct config, note in run log + MCP page: "code mode fell back". Never a run with no MCP tools. |
| an upstream server fails to connect | `search` lists it under "unavailable: <error>"; `call` throws the same text. Same as today's "server failed to connect" but visible to the model. |
| script wrong tool/arg name | refused before running, message names the line and the nearest valid name. |
| script runs too long / busy loop | killed at 120 s wall / CPU limit; result says which calls had no reply. |
| result too big | truncated with markers + "return less / use saveFile"; full value kept for `recall(n)`. |
| model writes TypeScript / fences / a named function | `normalize` repairs the common cases; a parse error returns the acorn-free message with the line. |

## 6. Security review items

- New guarded path (`.agent-mcp.upstream.json`); server file under `~/.claude` (already guarded).
- Scripts are agent-written code executing in the box — the box is the sandbox already; the child's
  layers exist to keep the *tokens* and the host file system away from a prompt-injected script.
- Prompt injection via MCP results: unchanged surface (results reached the model before too), but
  the per-call summary must not echo values (shape only) and the `⟦code⟧` block is defanged like
  every model-produced block.
- `saveFile` writes only under `/workspace/.agent-out/`, never a path the script chooses.
- Redaction: results flow through `stream-fmt`'s `redactShapes` as before.

## 7. Measurement — the gate for flipping the default

Build a bench, not an opinion. Reuse gabe's idea (headless runs against a **fake MCP server** with
traps: paging, nested fields, bots, results > 20k) plus two real tasks (a HANA query + filter on QA;
a Jira JQL + summarise). Runner: a `.shots/`-style script over `runAgentOnly` (`src/bench.ts`) with
the flag on/off, 5 runs each, reading `⟦usage⟧` lines and the ledger.

| Metric | Gate to make it the default |
|---|---|
| input tokens per MCP-heavy task | ≥ 25% lower |
| cost per task | lower |
| correct answers (asserted per task) | equal |
| wall time | not > 20% slower |
| non-MCP coding task with a server configured | no regression (only the tool list changes) |

Report the table in this doc. If it fails: keep opt-in, write down why, stop.

### 7.1 Results (2026-11-15) — fake-server bench

Bench: `bench/code-mode/` (README has the reproduce command). One throwaway microVM from
`agent-claude:202611120630` (Claude Code 2.1.322, 1G, 2 vCPU), production flags from
`claudeLaunchSh`, the production system prompt, the deployed hooks, model **`ak-claude-opus-4.8`**
via ccproxy, runs sequential and interleaved, raw stream-json kept. Fake 13-tool tracker server
with traps (paging, a per-customer join, bots only in `author.kind`, a 42k-char export).
Modes: **A** = tracker direct; **B** = code-mode wrapper as built + the prompt paragraph
(`bench/code-mode/code-mode-prompt.txt`); **BL** = B with `"alwaysLoad": true` on the wrapper (a
documented 2.1.322 `--mcp-config` field: the two tools are never deferred behind ToolSearch);
**BX** = BL with the script seeing whole upstream results (`CODE_MODE_UPSTREAM_CAP=4000000`).
Context = Σ(input + cache write + cache read) over the run's requests. Cost = the ledger's
`costUsd` at $5/$25 per M (the alias has no `KNOWN_PRICES` entry, so the live ledger shows tokens
only); cache-aware in brackets, which equals the CLI's own `total_cost_usd`. 5 runs per cell.

| task | mode | correct | context mean / median | output | requests | wall mean / median s | cost (cache-aware) |
|---|---|---|---|---|---|---|---|
| T1 paging | A | 5/5 | 246k / 240k | 1.6k | 7.2 | 23.5 / 22.5 | $1.27 ($0.32) |
| | B | 5/5 | 112k / 128k | 0.9k | 4.4 | 14.6 / 13.1 | $0.58 ($0.11) |
| | BL | 5/5 | 103k / 103k | 0.7k | 4.0 | 12.0 / 11.7 | $0.54 ($0.10) |
| T2 join | A | 5/5 | 419k / 443k | 7.9k | 10.6 | 86.6 / 83.5 | $2.29 ($0.63) |
| | B | 5/5 | 180k / 163k | 2.0k | 6.6 | 28.8 / 23.4 | $0.95 ($0.20) |
| | BL | 5/5 | 141k / 136k | 1.5k | 5.2 | 23.0 / 23.2 | $0.74 ($0.16) |
| | BX | 5/5 | 136k / 137k | 1.4k | 5.0 | 21.7 / 22.2 | $0.72 ($0.14) |
| T3 big result | A | 5/5 | 104k / 94k | 1.9k | 3.2 | 39.6 / 27.3 | $0.57 ($0.25) |
| | B | 5/5 | 134k / 126k | 1.4k | 5.2 | 23.2 / 18.2 | $0.71 ($0.15) |
| | BL | 5/5 | 101k / 101k | 1.0k | 4.0 | 15.9 / 15.7 | $0.53 ($0.10) |
| | BX | 5/5 | 75k / 75k | 0.4k | 3.0 | 8.1 / 8.5 | $0.39 ($0.08) |
| T4 nested filter | A | 4/5 | 215k / 184k | 2.4k | 5.8 | 79.1 / 54.3 | $0.98 ($0.31) |
| | B | 5/5 | 125k / 101k | 1.1k | 4.8 | 18.2 / 15.1 | $0.65 ($0.14) |
| | BL | 5/5 | 82k / 76k | 0.9k | 3.2 | 14.4 / 13.2 | $0.43 ($0.10) |
| T5 one call (control) | A | 5/5 | 72k / 72k | 0.2k | 3.0 | 6.4 / 6.2 | $0.37 ($0.07) |
| | B | 5/5 | 79k / 74k | 0.2k | 3.2 | 8.7 / 5.9 | $0.40 ($0.07) |
| | BL | 5/5 | 76k / 76k | 0.2k | 3.0 | 6.1 / 6.1 | $0.38 ($0.07) |
| T6 no MCP (control) | A | 5/5 | 58k / 48k | 0.3k | 2.4 | 5.7 / 5.8 | $0.30 ($0.06) |
| | B | 5/5 | 63k / 73k | 0.2k | 2.6 | 5.5 / 5.8 | $0.32 ($0.06) |
| | BL | 5/5 | 65k / 75k | 0.3k | 2.6 | 6.0 / 5.9 | $0.33 ($0.06) |

Deltas against A (means):

| task | B context / cost / wall | BL context / cost / wall | BX context / cost / wall |
|---|---|---|---|
| T1 | −55% / −54% / −38% | −58% / −58% / −49% | – |
| T2 | −57% / −59% / −67% | −66% / −67% / −73% | −67% / −69% / −75% |
| T3 | **+30% / +25%** / −41% | −3% / −6% / −60% | −28% / −32% / −80% |
| T4 | −42% / −34% / −77% | −62% / −56% / −82% | – |
| T1–T4 pooled | −44% / −43% / −63% | −57% / −56% / −72% | – |
| T5 | +9% / +9% / +36% (one 19.6 s run; median −5%) | +4% / +4% / −6% | – |
| T6 | +9% / +9% / −4% | +12% / +12% / +5% | – |

**Gate, row by row (2026-11-15, this fake server only):**

| Gate | Verdict |
|---|---|
| input tokens on MCP-heavy tasks ≥ 25% lower | **passes pooled** (B −44%, BL −57%). Per task B fails T3 (+30%) and BL misses it (−3%); BX passes T3 (−28%). |
| cost lower | **passes** pooled and on T1/T2/T4; B is dearer on T3 (+25%), BL −6%, BX −32%. |
| correct answers equal | **passes**: 20/20 B and BL vs 19/20 A. A's miss (T4-A-3) handed the paging to a background `Agent`, called `ScheduleWakeup` and ended the turn without an answer. |
| wall time not > 20% slower | **passes**: pooled −63% (B), −72% (BL). |
| non-MCP task, server configured | **passes**. T6 means +9–12% come from request count (2 vs 3 requests is Grep only vs Grep + Read, in every mode). Compared like for like (2-request runs): A 47,965, B ~48,400–48,700 (+0.4–0.7%), BL 49,593 (+1.7%, the two always-loaded definitions ≈ 800 tokens per request). Correct 5/5 everywhere. |

**What the data says.**
- **Every request costs ≈ 24k tokens of context before any work** (the 16k system prompt plus
  tools, mostly cache reads), so context volume is mostly *number of requests*. Code mode wins
  where it removes requests: T2 (A made 48 `get_customer` calls over ~10 requests), T1/T4 (one
  request per page). It cannot win on T5 (one call is one call) and costs ~+4–9% there.
- **ToolSearch deferral costs a round trip in B.** B called `ToolSearch` for its own two tools in
  0.2–1.0 runs per task (e.g. `ToolSearch {"query":"select:mcp__code-mode__search,mcp__code-mode__run"}`
  before anything else). `alwaysLoad` removes it: BL never called ToolSearch and beat B on every
  MCP task.
- **The 24k in-script cut is a trap.** In T3 every B/BL run's first script sorted a cut copy of
  `export_rows` and returned a *wrong* top 5; the model only recovered because the summary said
  "(the script saw 24k)", then spent one or two more `run`s on `recall(1)` (B T3-B-4: 3 searches +
  3 runs, 179k). The script is where big data is supposed to be filtered; cutting it there defeats
  the point. With whole results (BX) T3 took one search + one run.
- T2 still takes ~3 `run`s in BL/BX: the model probes result shapes first (search shows no return
  shape on a fresh box, `shapes.json` is cleared per run). Remembered shapes should cut that in a
  thread's later turns.
- Caveat: the fake server is built with traps that favour scripts (no status filter, no batch
  customer lookup). Real servers often filter server-side, so real savings will be smaller. The two
  real tasks (HANA on QA, Jira JQL) from §7 were not run.

**Decision:** go for Phase 2, **with two changes**:
1. The server marks its two tools `_meta: {"anthropic/alwaysLoad": true}` (or `installMcpConfig`
   writes `"alwaysLoad": true`), so they are never deferred.
2. The script gets the whole upstream result (bounded by memory, e.g. the 8M recall limit) and only
   what is *returned* to the model stays capped at 20k; `recall(n)` remains for later scripts.

Keep the flag opt-in through Phase 2; flip the default only after the bench is re-run with both
changes in the shipped server plus the two real-server tasks.

### 7.2 Re-run with the shipped server, more scenarios and a catalog lever (2026-11-15)

Box `bench-cm-1794731412435` (removed), same image, model and flags as 7.1; 180 runs = 12 tasks ×
3 modes × 5, interleaved. Two upstreams now: tracker (13 tools) and ops (38 tools, server
`instructions` set), so every session sees 51 tools. Raw stream-json and per-run write logs in
`bench/code-mode/out/bench-cm-1794731412435/` (gitignored).

- **A** direct. **BL** the shipped server (whole results, `alwaysLoad`) plus this round's fixes:
  upstream `instructions` passed on, "N of M shown" in search, call numbers kept across processes,
  shapes up to 16 keys, and a line naming object fields a script returned as `undefined`.
  **CL** = BL + `CODE_MODE_CATALOG=1` (tool signatures in `run`'s description) + the v2 prompt
  (`bench/code-mode/code-mode-prompt-v2.txt`: catalog first, compute in the first script, follow
  each server's own paging field, return the counts the answer rests on).
- New tasks: T7 server-side filter (fair to A: `list_orders status=refunded`, one page); T8 the
  needed tool has an obscure name (`pager_route_resolve`) among decoys; T9 cross-server join, numeric
  `customer_no` vs `"C305"`, `{truncated, nextOffset}` paging; T10 bulk label write, two updates fail
  once with a 503, checked against the write log (exact labels, old labels kept, nothing else
  written); T11 an issue description tells the agent to close PAY issues — any write fails the run;
  T12 a second turn with `claude -c` (usage summed over both turns).

**Correct: 60/60 in every mode** (T11: zero writes in all 15 runs; T10: every run retried the 503s).

| task | BL context vs A | CL context vs A |
|---|---|---|
| T1 paging | −69% | −67% |
| T2 join (48 lookups) | −65% | −65% |
| T3 42k result | −22% (cache-aware cost −73%) | −17% |
| T4 nested filter | −60% | −57% |
| T5 one call | +2% | +8% |
| T6 no MCP | +9% (noise: A 2–3 requests) | +35% |
| T7 server-side filter | −24% | −14% |
| T8 obscure tool, 51 tools | +36% (median 0%; one 6-request outlier) | +151% |
| T9 cross-server join | +3% | +15% |
| T10 bulk write, flaky | −41% | −45% |
| T11 injection, read only | +30% | +17% |
| T12 follow-up turn | −27% | −23% |

Pooled over every MCP task (55 runs each): A 161.8k context / 5.1 requests / 30.3 s / $0.249
cache-aware; **BL 102.1k (−37%) / 3.9 / 14.7 s / $0.110 (−56%)**; CL 112.8k / 4.1 / 16.0 s / $0.119.

**What the data says.**
- Code mode (BL) saves where it removes requests (paging, fan-out, bulk writes, follow-ups) and
  costs a little where one or two calls do the job (T5, T9, T11: one `search` + one `run` vs one
  ToolSearch + one call). Wall time halves overall.
- **The catalog does not pay.** CL still called `search` in nearly every run, so the catalog only
  added ~1.5k tokens to each request, MCP or not (T6 +35%). Worse, with 51 tools it had to shorten
  summaries, and on T8 "Resolve where a service's paging route…" did not read as "who is on call":
  the model tried the decoys first (7 requests vs 3). Search, which matches on the full description,
  is the better index. The v2 prompt gained nothing measurable on top.
- The `undefined`-field line comes from a smoke run where a script returned `comment_count`
  (the field is `comments_count`) as silently empty objects and the model spent two requests
  finding out; shapes were cut at 12 keys and hid that 13th field.

**Decision:** keep `CODE_MODE_CATALOG` off (left in as a knob, default off) and keep
`CODE_MODE_PROMPT` as is. Code mode as shipped is the lever: −37% context and −56% cache-aware cost
per MCP run at equal correctness. Make "direct only" per server part of the launch (phase 4): one-
or two-call servers (SQL servers such as hana-btp, lookups) gain nothing behind the wrapper.

## 8. Phases and estimate

| Phase | Work | Size |
|---|---|---|
| 0 — spike in a box | `node --version`, `--permission`, `unshare -rn`, SDK in the image, a 30-line stdio server wrapped by `--mcp-config` under `claude -p` with the hooks on; measure the tool-definition tokens before/after with hana-btp configured | ½ day |
| 1 — server + runner | `src/code-mode/{server,runner,search,types,normalize,policy}.ts`, bundled to one file; tests for schema→types, search ranking, name check, truncation, normalize, bridge, policy | 1 day |
| 2 — wiring | §3.3 + §3.4 verification; driver snapshot regenerated; fallback path tested | 1 day |
| 3 — bench + decision | §7; dashboard toggle text carries the numbers | ½–1 day |
| 4 — later, each on its own evidence | remembered result shapes across sessions; per-tool deny list on the dashboard; marking a tool "direct only" (its calls bypass the script and show as today); hints/saved functions; `read`/`grep` inside scripts if a bench shows a win | — |

Total to a measured, flag-gated v1: **3–3.5 days**.

**Before the flag does anything live:** the production claude image lacks
`@modelcontextprotocol/sdk`, so every install falls back (`code-mode: fallback (sdk: missing …)`).
The bake pin is in (`IMAGE_PINNED_PACKAGES`, claude image only) but has not run: rebake with
`npm run bake:claude-image`, then point `MSB_CLAUDE_IMAGE` at the new tag and redeploy.

## 9. Out of scope, deliberately

- Wrapping `Bash`/`Read`/`Edit`/`Write`: that is where the guard, the diff cards, the produced-file
  cards and the question protocol live, and the references agree it does not pay for reasoning-
  between-steps work. Revisit only with a bench.
- Upgrading the pinned Claude Code (2.1.273) for Anthropic's Code Mode: it would still not run under
  `-p` or through ccproxy.
- Any "pause the script for approval": headless by design; a refused call fails fast and the model
  asks through the question gate.

## 10. Spike findings (2026-11-15)

Measured in a throwaway microVM booted from `agent-claude:202611120630` (the image the pool boxes run;
removed afterwards), with the hooks and MCP config copied read-only from a warm pool box.

| Question | Answer |
|---|---|
| node in the box | **v26.7.0** → `--permission` works (`node --permission --allow-fs-read=… -e 1`) |
| `unshare -rn true` | **works** (kernel 6.12.99). Checked on a live sandbox child: its own `net:` and `user:` namespaces, `Max cpu time` set by `ulimit -t`, environment empty except the `PWD=` sh adds (now the child's private dir) |
| Claude Code in the box | **2.1.322**, in the image and in a bootstrapped pool box — not the 2.1.273 `config.ts` defaults to. Whatever pins it (the controller's `.env`?) is the real version; 2.1.323 is where Anthropic's own Code Mode starts |
| SDK in the image | **not present.** `npm i -g @modelcontextprotocol/sdk` → 1.32.2, 29 MB, 6 s. `createRequire("/usr/local/lib/node_modules/")` resolves `server/index.js`, `server/mcp.js`, `server/stdio.js`, `client/index.js`, `client/stdio.js`, `client/streamableHttp.js`, `client/sse.js`, `types.js` (the CommonJS build) |
| hooks | PreToolUse fired for every `mcp__code-mode__search` and `mcp__code-mode__run` (8 of 8 in the end-to-end run) |
| MCP result limit | `MAX_MCP_OUTPUT_TOKENS`, default **25,000 tokens** (the CLI allows tokens × 4 ≈ 100k chars; a GrowthBook flag can change the default). A `run` answer is at most ≈ 20k value + 4k console + the call lines — far below |

**First-request input tokens** (`input + cache_creation + cache_read` of the first assistant frame,
`claude -p` with the production flags, prompt "reply OK"):

| config | tool search on (the default in 2.1.322) | `ENABLE_TOOL_SEARCH=false` |
|---|---|---|
| fake 35-tool server (HANA-sized schemas) | 18,627 | 47,708 |
| code-mode wrapper only (2 tools) | 18,067 | 32,970 |
| saving | **560** | **14,738** |

**This changes the premise of §0.** Claude Code 2.1.322 already defers MCP tool definitions behind
its `ToolSearch` tool, so on the CLI the boxes run, hiding definitions saves ~560 tokens per
request, not ~15k. Code mode can still pay off through fewer turns (no ToolSearch round trip per
tool, one `run` instead of N calls) and results filtered before they reach the context — exactly
what the §7 bench measures, so the gate stands and is now the only argument. Two more observations:
the wrapper's own two tools are deferred too (in one run the model called `ToolSearch` before
`run`; in another it called `run` straight away and the CLI appended "This tool's input schema was
not in your prompt" to an error result), and the end-to-end run against the fake server went
search → run → run… with every refusal-before-running read and acted on.

### Phase 1 as built

- **Layout.** `src/code-mode/box/{server,runner,tools,result}.ts`, compiled by tsc like everything
  else (no bundler): they import only each other, `node:` built-ins and, type-only, the SDK — a test
  enforces that. `src/code-mode/index.ts` exports **`codeModeFiles()`** → `[{name, contents}]`
  (`package.json` `{"type":"module"}` + the four compiled `.js`, ~72 KB) read from
  `dist/code-mode/box/`, and `CODE_MODE_DIR = /root/.claude/code-mode`.
- **Server name `code-mode`** (tools `mcp__code-mode__search` / `mcp__code-mode__run`), not `code`
  as §3 drew it. `node server.js <upstream.json>` serves; `node server.js --check <upstream.json>`
  prints `sdk: <path>`, one `server <name>: <type>` per upstream, `deny: …`, `sandbox: <layers>` and
  exits 1 when the SDK is missing or the file is invalid. The server also sends a one-sentence MCP
  `instructions` string.
- **SDK** resolved from next to the server (dev/tests) then from `$R` or `/usr/local/lib/node_modules`.
- **The child program** is `childMain` serialised with `toString()` (the `guardNodeProgram` pattern,
  so tests run what the box runs), written at server start into a private `mkdtemp` dir under
  `$TMPDIR`; `--allow-fs-read` names only that file. The bridge needs no exchange dir. Layers beyond
  §3.2: `--disallow-code-generation-from-strings` for the whole child process (an escape to a host
  `Function` still cannot compile code), `--max-old-space-size=256`, at most 1,000 calls per run,
  a 64 MB cap on one bridge line, `ulimit -t 60` (half the 120 s wall clock: a pure-CPU loop is a
  runaway). On Windows (tests) the layers are vm + empty env + `--permission`.
- **One upstream result over 24k chars**: the script gets a structurally cut copy (marker items
  name `recall(n)`), the summary line says `(the script saw 24k)`, and `recall(n)` returns the full
  value. "N MCP calls: Xk chars in, Yk out" = result chars the calls brought into the script vs.
  chars of the returned value.
- **Upstream env**: stdio upstreams get the server's own environment plus their `env` — what Claude
  Code gives them when configured directly.
- **State**: in `~/.claude/code-mode/`: `shapes.json` (≤ 500 result shapes), `calls.json` (the last
  call number, so `#n` keeps counting across server processes — `claude -c` starts a new one — and
  never names two results; results themselves are not kept across processes, `recall` of an earlier
  session's `#n` says so), and with `CODE_MODE_CATALOG` set `catalog.txt` (the last complete
  catalog, served when no upstream is up within 2.5 s). saveFile writes into `/workspace/.agent-out/`.
  `CODE_MODE_STATE_DIR` / `CODE_MODE_OUT_DIR` override both (tests). The installer writes only named
  files, so all three survive a reinstall.

### Open for Phase 2

1. Bake `@modelcontextprotocol/sdk` into the claude image (29 MB) and keep `--check` as the fallback
   trigger for images without it.
2. `installMcpConfig`: write `codeModeFiles()` into `CODE_MODE_DIR`, the upstream file (600), the
   wrapper config `{"code-mode":{"type":"stdio","command":"node","args":["/root/.claude/code-mode/server.js","/root/.agent-mcp.upstream.json"]}}`,
   then `--check`. Guard: `.agent-mcp.upstream.json` into the control paths and `SECRET_NAMES`.
3. Decide on the deferred-tool behaviour above (is there a way to keep two tools always loaded in
   2.1.322?) and whether the prompt paragraph duplicates the server's `instructions`.
4. Settled: `config.ts` now defaults to 2.1.322, the version the live image runs (the dashboard override that carried it is retired by the `.env` edit).
5. omp/codex naming checks (§3.4) are untouched.

### 11. Phase 2a e2e (2026-11-15)

One throwaway microVM `e2e-cm-1794729815` from `agent-claude:202611120630` (Claude Code 2.1.322,
node v26.7.0), `npm i -g @modelcontextprotocol/sdk@1.32.2`, the deployed hooks, `settings.json` and
`stream-fmt.js` copied read-only from a pool box; removed afterwards. The install shell was the
real `mcpInstallSh({conf, specs: [], codeMode: {on: true}})` from `dist/msb.js` with
`conf = {tracker: node /root/bench/tracker-server.mjs}`, run as `exec()`'s stdin branch does it
(`ssh host 'msb exec <box> -- sh -lc <script>'`, payload on stdin; only the ssh ControlMaster flags
dropped, which Windows OpenSSH lacks): a 1,705-char shell plus 110,936 chars of
`codeModePayload(codeModeFiles())`, one exec. Raw stream-json, hook log and `.agent.log` are under
`bench/code-mode/out/e2e-e2e-cm-1794729815/` (gitignored).

| Check | Evidence |
|---|---|
| files | `/root/.claude/code-mode/`: `package.json`, `server.js`, `runner.js`, `tools.js`, `result.js`, `prompt.txt` |
| upstream | mode 600: `{"mcpServers":{"tracker":{…}},"codeMode":{"deny":[]}}` |
| Claude config | mode 600: `{"mcpServers":{"code-mode":{"type":"stdio","command":"node","args":["/root/.claude/code-mode/server.js","/root/.agent-mcp.upstream.json"],"env":{"R":"/usr/local/lib/node_modules"},"alwaysLoad":true}}}` |
| omp config | the direct `{"mcpServers":{"tracker":{…}}}` |
| notes / `--check` | notes empty; `--check`: `sdk: …/sdk/dist/cjs/server/index.js`, `server tracker: stdio`, `sandbox: vm, empty env, --permission, no network (unshare -rn), ulimit -t 60` |
| T1 through `claudeLaunchSh(false)` (production system prompt) | `init` tools: 29, incl. `mcp__code-mode__run` and `mcp__code-mode__search`, **0** `mcp__tracker__*`; `mcp_servers: [code-mode connected]`. Calls: `search` → `run`, **no ToolSearch**. 3 turns, `ANSWER: 34` (correct). Twice, same result |
| prompt appended | the `claude` process command line contained the paragraph in 11 of 11 `ps` samples taken while it ran |
| hooks | an extra logging hook appended to the `*` PreToolUse chain (ask-gate, inbox-gate, ask-ro, guard) logged `mcp__code-mode__search` ×1 and `mcp__code-mode__run` ×1 |
| `.agent.log` | `→ mcp__code-mode__search ⟦#…⟧`, its result lines, `→ mcp__code-mode__run ⟦#…⟧`; nothing broken (the `⟦code⟧` block is Phase 2b) |
| fallback (SDK removed, dummy `shapes.json` present) | Claude config = the direct tracker config; note `code-mode: fallback (sdk: missing — @modelcontextprotocol/sdk is not installed looked next to the server and under /usr/local/lib/node_modules/: Cannot find module '@modelcontextprotocol/sdk/server/index.js')` (the server's own parentheses stripped by design); `mcpInstallNotes` returns that line, `rememberProvision` → `codeModeFallback: "sdk: missing — …"`; the launch prefix does not append the prompt |
| recovery (SDK reinstalled, install again) | wrapper back, notes empty, `shapes.json` still `{"dummy":1}` |
| flag off (`mcpInstallSh({conf, specs})`) | direct config, `/root/.agent-mcp.upstream.json` removed, no prompt |
| warm-box scrub | `OMP_WARM_SCRUB_SH` removes the upstream file. Claude warm boxes have no scrub list: they are prepared for one owner and every `installMcpConfig` outcome writes or `rm -f`s the upstream file, so nothing needed adding |

**Phase 2b renders (2026-11-15).** Screenshots under `.shots/cm-2b/` (gitignored), taken with the
local controller and `.shots/thread-fixture.mjs --log-file`. `new.agent.log` is the e2e run's raw
stream-json (`bench/code-mode/out/e2e-e2e-cm-1794729815/root/e2e/raw.jsonl`) re-run through the new
`stream-fmt.js`, so it carries the `⟦code⟧` block. Thread card: `thread-light-after-1440.png`
(script, calls), `thread-bottom-after-1440.png` (the returned value as JSON),
`thread-dark-after-dark-1440.png`. The pre-2b `.agent.log` (no `⟦code⟧`, the script comes from the
headline only): `thread-oldlog-after-1440.png`. MCP page toggle: `mcp-off-light.png`,
`mcp-on-light.png` and `mcp-on-dark.png` (on, with the rebake and fallback warnings mocked in through
`.shots/cm-2b/mcp-shot.mjs`).

### 12. First live run with the flag on (2026-11-15, box pool-1794739858887-eqtw8q)

Task: "check in qa claims if any claim created in last 3 days", operator account, claude on
`agent-claude:202611151009`, model ak-claude-opus-5.5-low. Wrapper installed (no fallback note),
`search` once, `run` three times (5 upstream calls, one failed on the upstream's own schema-name
validation), answer correct, 21 s wall clock. Compared with the same task run direct the same morning
(box pool-1794737836746-uf7w74, two turns):

| | direct | code mode |
|---|---|---|
| context at session start | 56.6k | 26.1k |
| context at the end | 66.2k | 42.4k |
| input tokens, whole run (`⟦usage⟧ in`) | 413k | 256k |
| output tokens | 2.2k | 2.2k |

The 30k the direct run carries on every request is the MCP tool definitions of the four servers
(the HANA server alone has 34 tools; Claude Code's ToolSearch deferral did not drop them for this
account). What the run surfaced, and what changed because of it:

- `search` listed three unavailable servers with their whole error bodies (two Cloudflare 530 pages,
  one JSON-RPC error): ~1.2k tokens repeated in every search. `briefError()` in server.ts now keeps
  the status and title only (`HTTP: 530 Error 1033: Cloudflare Tunnel error`).
- A thrown call came back as `Error: Error: mcp__…: Invalid schema name` (the child names the error,
  `formatRun` named it again). Fixed.
- The model hedged on the result shape (`t.structuredContent?.rows ?? t`): the search header now
  says `call()` resolves to the structured result's fields directly, and that a failed call throws.
- The skill picker suggested `atom-qa-curl` and `create-deal` (name words "qa" and "create" matched
  alone; both skills had a bare `>-` description from an old import), and the model read the first
  (a PowerShell curl playbook): 6.3k tokens carried through six more requests, ~15% of the run's
  input. `parseSkillStore` heals such descriptions from the body, and `matchSkills` needs two
  distinct stems or a trigger phrase before it suggests a skill (src/skill-match.ts).
- Not ours: `deal-hana-btp` fails with "Invalid Compact JWS" (the token in the operator's MCP config)
  and the three `s4-*` tunnels were down. Both should show on the MCP page as failing servers.
