# Code-mode bench

The gate in `docs/plan-code-mode.md` §7: does putting MCP servers behind the code-mode wrapper
(`src/code-mode/box/server.ts`, tools `mcp__code-mode__search` / `mcp__code-mode__run`) make
MCP-heavy runs cheaper without making them wrong or slow, and does it leave non-MCP runs alone?

It runs `claude -p` in a throwaway microVM booted from the production claude image, with the
production flags (`claudeLaunchSh`: `--setting-sources user`, stream-json with partial messages,
`--append-system-prompt` = the production system prompt, `--allowedTools` as the launcher derives
it, `CLAUDE_CODE_MCP_STARTUP_WAIT_MS=3000`), the deployed PreToolUse hooks copied from a pool box,
and the production model through ccproxy.

## Files

| File | What |
|---|---|
| `data.mjs` | Seeded data (issues, messages, users, customers, orders, export rows) and the expected answers. |
| `tracker-server.mjs` | Fake upstream MCP server (stdio, SDK): 13 tools — paging (cursor), nested fields, bots flagged only in `author.kind`, a join that needs one `get_customer` per customer, `export_rows` (42k chars, over the 24k in-script cap code mode had when the bench ran), decoys. Writes never change anything. |
| `ops-server.mjs` | Second fake upstream: 38 ops tools (fillers plus `pager_route_resolve` for T8 and `billing_invoice_query` for T9, keyed by numeric `customer_no`, paged with `{truncated, nextOffset}`), with server `instructions`. |
| `state.mjs`, `sdk.mjs` | The per-run write log both servers append to (path in `/root/bench/current-log`, replayed at start so a `-c` turn sees earlier writes), and the shared SDK loader. |
| `tasks.mjs` | T1 paging, T2 join, T3 big result, T4 nested filter, T5 one-call control, T6 no-MCP control (`/workspace/src/rates.ts`), T7 server-side filter, T8 obscure tool among 51, T9 cross-server join, T10 bulk write with transient 503s, T11 prompt injection (no writes allowed), T12 `claude -c` follow-up. Each run must end with `ANSWER: …`; checks get every turn's answer and the write log. |
| `code-mode-prompt.txt` | The system-prompt paragraph mode B adds — the Phase 2 draft for `src/drivers/prompts.ts`. |
| `code-mode-prompt-v2.txt` | The catalog-first variant CL and BP use (measured in plan §7.2: no gain). |
| `box-run.mjs` | Runs in the box: every task × mode × rep, sequential, interleaved (mode order flips per rep), raw stream-json per run, resumable. |
| `bench.ts` | Host side over `ssh hostbrr` + `msb`: `up`, `run`, `status`, `pull`, `down`, `exec`. |
| `report.ts` | The §7 table from the pulled stream-json, deltas, outliers; `--show T3-B-1` prints one transcript. |
| `out/` | Pulled runs (gitignored): `out/<box>/out/*.jsonl` + `runs.jsonl` (wall ms) + `config.json`. |

## Modes

| Mode | `--mcp-config` | Extra |
|---|---|---|
| A | `{"tracker": …}` — the server directly | — |
| B | `{"code-mode": node /root/.claude/code-mode/server.js /root/.agent-mcp.upstream.json}`, tracker in the upstream file | `code-mode-prompt.txt` appended to the system prompt |
| BL | as B, plus `"alwaysLoad": true` on the code-mode server | as B |
| BX | as BL, plus `env: {CODE_MODE_UPSTREAM_CAP: "4000000"}`: the script sees whole upstream results instead of a 24k cut copy | as B |

Since Phase 2 the shipped server behaves like BX by default (whole results, `CODE_MODE_UPSTREAM_CAP` is no longer read) and `installMcpConfig` writes `alwaysLoad`, so B/BL now measure an older server; re-run with BL as the code-mode mode.
| CL | as BL, plus `env: {CODE_MODE_CATALOG: "1"}` | `code-mode-prompt-v2.txt` |
| BP | as BL | `code-mode-prompt-v2.txt` (prompt without the catalog) |
| B2, A2 | B / A with `ENABLE_TOOL_SEARCH=false` | reference only |

`alwaysLoad` is Claude Code's own `--mcp-config` field (2.1.322): the server's tools are always in
the prompt, never deferred behind ToolSearch. A server can ask for the same per tool with
`_meta: {"anthropic/alwaysLoad": true}` in `tools/list`.

## Reproduce

From the repo root, in Git Bash on the RDP box (needs `ssh hostbrr`):

```sh
node --max-old-space-size=6000 node_modules/typescript/lib/tsc.js -p tsconfig.json   # dist/code-mode/box/*.js is what is shipped
npx tsx bench/code-mode/bench.ts up                        # boot bench-cm-<ts>, SDK, hooks, server, bench, key
npx tsx bench/code-mode/bench.ts run --modes A,B,BL --runs 5   # 90 runs, about 1–1.5 h, detached in the box
npx tsx bench/code-mode/bench.ts status                    # until "bench done"
npx tsx bench/code-mode/bench.ts pull
npx tsx bench/code-mode/report.ts bench/code-mode/out/bench-cm-<ts>
npx tsx bench/code-mode/bench.ts down                      # removes only the recorded bench-cm-* box
```

`run --tasks T3 --modes B` re-runs a subset; finished runs are skipped, so delete
`/root/bench/out/T3-B-*` (`bench.ts exec 'rm …'`) to run them again. Git Bash rewrites arguments
that look like absolute paths (`--out /root/x` arrives as `C:/Program Files/Git/root/x`): prefix
such commands with `MSYS_NO_PATHCONV=1`. To pull or report a directory other than `out`, set
`BENCH_OUT=<dir>` for both.

## What is measured

Per run, top-level agent only: requests (distinct assistant message ids with usage), context
= Σ(input + cache write + cache read) over those requests (equals the `result` frame's usage),
output (Σ `message_delta`), wall ms (spawn to exit), tool calls by name, correctness. Cost uses the
ledger's function (`costUsd` in `src/cost.ts`, input = input + cache write + cache read, as
`src/outcome.ts` feeds it) at `BENCH_PRICE` (default `5/25` $/M, Opus list price — the production
alias `ak-claude-opus-4.8` has no entry in `KNOWN_PRICES`, so the live ledger shows tokens only),
plus a cache-aware figure (read 0.1×, write 1.25×), which matches the CLI's own `total_cost_usd`.

## Safety

`down` only removes the name in `out/box.txt`, only if it matches `bench-cm-<digits>` and has no
pin in `~/.agent-sandbox/keep/` on the host. Hooks are copied from a pool box read-only. The model
key goes from the controller container straight into the box (`/root/bench/key`, 600).
