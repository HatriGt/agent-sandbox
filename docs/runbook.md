# Runbook

Live, verified commands go here as we prove each phase on the VPS. Empty until Phase 1.

## Host facts (vps)
- microsandbox: `msb` v0.6.9 at `/root/.local/bin/msb`, MSB_HOME `/root/.microsandbox`.
- `msb doctor`: KVM ready (svm, /dev/kvm r/w, libkrunfw loaded). Reflink unavailable on
  ext4 → clones fall back to sparse copies (slower create, more storage).
- ccproxy public endpoint: `https://your-ccproxy.example.com` (verified reachable from boxes).

## Phase 1 — TODO
Record the exact, working `msb run/exec/cp` sequence here once proven.

## Phase 4 — credential strategy — TODO
Record the final secret-injection + egress-allowlist approach here.
