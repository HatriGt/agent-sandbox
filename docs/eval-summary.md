# Sandbox runtime evaluation — summary

Benchmarked on the target VPS (vps: 15 GB RAM, 4 vCPU, KVM, kernel 6.8, shared with
Dokploy/ccproxy/ak-rdp). Full per-runtime notes live in the AKVps repo under
`deployments/apps/<name>/data.md`.

## Contenders and verdicts

| Runtime | Isolation | Boot | Per-box RAM | Idle footprint | Egress on host | Verdict |
|---|---|---|---|---|---|---|
| **microsandbox** | microVM (libkrun/KVM) | sub-second | right-sized | tiny (CLI, no daemon) | ✅ | **CHOSEN** |
| OpenSandbox | container (runc) | sub-second | container-light | light (1 server) | ✅ | fallback (weaker isolation) |
| SmolVM | microVM | sub-second (claimed) | small | light | ❌ guest egress broke | blocked on this host |
| CubeSandbox | microVM (KVM) | create 0.15–0.29s, ready ~5s | 2 GB fixed/box | ~3 GB (MySQL+Redis+proxy+dns) | ✅ | wrong fit: needs XFS + free 80/443, clashed with Dokploy |

## Why microsandbox won

1. **Real microVM isolation** — hardware boundary, not a shared kernel. Right for running
   an agent that executes arbitrary code against your repo.
2. **Lightweight** — no heavy control plane. v0.6.9 is a single self-contained CLI (`msb`);
   idle cost ≈ zero, RAM is spent only while a box runs.
3. **Fast boot** — libkrun microVMs, sub-second; snapshots for warm restart.
4. **Everything we need is built in** (v0.6.9): repo copy, secret/env injection, fine-grained
   egress (`--net`/`--net-rule`/DNS), idle/max-duration teardown, `exec`/`ssh` resume,
   snapshots. This absorbs the credential-proxy/egress-firewall layer that Cleanroom and
   iron-proxy sell separately.
5. **ccproxy verified** — Claude Code inside a box reaches the model through
   `ANTHROPIC_BASE_URL=https://your-ccproxy.example.com`.
6. **Coexists with Dokploy** — no port monopoly (unlike Cube's 80/443 requirement).

## Notable non-runtime findings worth reusing

- **Credential-injection proxies** (Cleanroom gateway, iron-proxy, Infisical Agent Vault):
  keep real secrets host-side, inject at egress, hand the box only a placeholder. Your
  ccproxy already proves the pattern. microsandbox's `--net` allowlist + `--secret-conf`
  gets us most of the way natively; a host-side gateway is a later hardening option.
- **container-use (Dagger)** and **AgentBox**: MCP-native / multi-backend orchestrators —
  useful reference architectures for the resume + parallel-worktree UX, not runtimes.
- **Cleanroom** (Buildkite) rebuilt itself into a CI "bake-and-mediate" layer over SporeVM —
  not an agent sandbox; only its credential-mediation gateway idea is worth borrowing.

## Host caveat to address later

MSB_HOME sits on ext4 → no reflink → `msb doctor` warns clones fall back to sparse copies
(slower create, more storage per box). Putting MSB_HOME on a reflink-capable fs
(XFS/btrfs loop) enables CoW clones. Deferred; microsandbox degrades gracefully unlike Cube
which hard-required XFS.
