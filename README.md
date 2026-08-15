# agent-sandbox

Delegate a coding task from Cursor chat to an isolated microVM on your VPS, run an
autonomous agent (Claude Code) inside it, and stream the result back — with resume,
follow-ups, and safe credential handling.

Runtime: **[microsandbox](https://github.com/microsandbox/microsandbox)** (`msb`, libkrun/KVM microVMs).
Orchestration: a small **TypeScript MCP server** that Cursor connects to and that drives
`msb` locally on the VPS.

## Why microsandbox

We benchmarked microsandbox, OpenSandbox, SmolVM, and CubeSandbox on the target VPS
(see `docs/eval-summary.md`). microsandbox won for this use case: real microVM isolation
(hardware boundary), sub-second boot, right-sized RAM, and — critically for v0.6.9 — a
**self-contained CLI** with the whole delegate wishlist built in:

| Need | microsandbox v0.6.9 feature |
|---|---|
| Ship repo + local changes | `--copy-dir SRC:DST`, `-v/--volume`, `msb cp` |
| Inject git/npm creds | `-e KEY=val`, `--secret-conf` (keyring/env secrets) |
| Egress control (creds-proxy-grade) | `--net public/private/host`, `--no-net`, `--net-rule allow@<target>`, DNS controls |
| Run Claude Code + MCP | any OCI image; Claude Code CLI + MCP servers run in-box |
| Use ccproxy for the model | `-e ANTHROPIC_BASE_URL=https://your-ccproxy.example.com` (verified) |
| Auto-teardown | `--idle-timeout`, `--max-duration` |
| Resume / continue | `msb exec`, `msb ssh` into a running box |
| Checkpoints / fast restore | `msb snapshot`, `msb run --from-snapshot` |
| Status / preview | `-p HOST:GUEST` port forward |

The egress/secret features mean we get the credential-injection-proxy pattern (that
Cleanroom and iron-proxy sell as separate products) natively.

## Architecture

```
Cursor chat  ──MCP (remote, over SSH/HTTP)──►  Orchestrator (this repo, on VPS)
                                                   │  shells out to `msb`
                                                   ▼
                                          microsandbox microVM (libkrun/KVM)
                                             • repo (incl. local changes) copied in
                                             • git/npm creds injected (short-lived)
                                             • Claude Code runs the task
                                             • model calls → ccproxy
                                             • MCP servers run in-box
                                                   │
                                          status/logs stream back to chat
                                                   │
                                          resume / continue / follow-ups
                                                   ▼
                                          download results → tear down box
```

The orchestrator runs **on the VPS** (chosen over Mac-side) so `msb` calls are local and
there is no long-running daemon to manage — v0.6.9 has no HTTP server, it's pure CLI.

## Layout

```
src/          TypeScript MCP orchestrator (delegate / status / resume / continue tools)
scripts/      Bash delegate core that wraps msb (create box, ship repo, inject creds, run agent)
docs/         Architecture, eval summary, credential strategy, runbook
```

## Status

Scaffold. See `docs/plan.md` for the build phases and `docs/eval-summary.md` for why
microsandbox was chosen.

## Deployment

Tracked in the AKVps deployments repo at `deployments/apps/agent-sandbox/` (pointer +
docs), mirroring how ccproxy / indiastreamz are managed.

## License

MIT.
