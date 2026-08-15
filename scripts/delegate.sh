#!/usr/bin/env bash
# delegate.sh — ship a repo into a microsandbox microVM and run Claude Code on a task.
#
# SKELETON: the msb flag values here are the intended shape. They get finalized in Phase 1
# (docs/plan.md) once the loop is proven live on the VPS. Do not treat as verified yet.
#
# Usage:
#   delegate.sh --repo <path> --task "<text>" [--name <box>] [--image <oci>] \
#               [--idle-timeout 10m] [--max-duration 1h]
#
# Env expected (injected by the orchestrator, kept host-side, never committed):
#   ANTHROPIC_BASE_URL   ccproxy endpoint (e.g. https://your-ccproxy.example.com)
#   ANTHROPIC_AUTH_*     whatever ccproxy expects for auth
#   GIT_TOKEN            short-lived git credential (optional)
#   NPM_TOKEN            short-lived npm credential (optional)
set -euo pipefail

MSB="${MSB:-/root/.local/bin/msb}"
IMAGE="${IMAGE:-ubuntu:24.04}"
IDLE_TIMEOUT="10m"
MAX_DURATION="1h"
BOX_NAME=""
REPO=""
TASK=""

usage() { sed -n '2,20p' "$0"; exit "${1:-0}"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="$2"; shift 2;;
    --task) TASK="$2"; shift 2;;
    --name) BOX_NAME="$2"; shift 2;;
    --image) IMAGE="$2"; shift 2;;
    --idle-timeout) IDLE_TIMEOUT="$2"; shift 2;;
    --max-duration) MAX_DURATION="$2"; shift 2;;
    -h|--help) usage 0;;
    *) echo "unknown arg: $1" >&2; usage 1;;
  esac
done

[[ -n "$REPO" && -n "$TASK" ]] || { echo "ERROR: --repo and --task are required" >&2; usage 1; }
[[ -d "$REPO" ]] || { echo "ERROR: repo path not found: $REPO" >&2; exit 1; }
BOX_NAME="${BOX_NAME:-delegate-$(date +%s)}"

echo "[delegate] box=$BOX_NAME image=$IMAGE repo=$REPO"

# --- Phase 1 intended shape (to be verified live) -------------------------------------
# Create a detached box with the repo copied in, creds + ccproxy env injected,
# egress allowed to what the task needs, and auto-teardown timers set.
#
# "$MSB" run -d --name "$BOX_NAME" \
#   --copy-dir "$REPO:/workspace" -w /workspace \
#   --net public \
#   --idle-timeout "$IDLE_TIMEOUT" --max-duration "$MAX_DURATION" \
#   -e ANTHROPIC_BASE_URL="${ANTHROPIC_BASE_URL:-}" \
#   ${GIT_TOKEN:+-e GIT_TOKEN="$GIT_TOKEN"} \
#   ${NPM_TOKEN:+-e NPM_TOKEN="$NPM_TOKEN"} \
#   "$IMAGE" -- sleep infinity
#
# Install the agent + run the task inside the box:
# "$MSB" exec "$BOX_NAME" -- bash -lc '
#   command -v claude >/dev/null || npm i -g @anthropic-ai/claude-code
#   cd /workspace && claude -p "'"$TASK"'"
# '
#
# Capture results:
# "$MSB" cp "$BOX_NAME:/workspace/RESULT.md" "./out/$BOX_NAME-RESULT.md" 2>/dev/null || true
# --------------------------------------------------------------------------------------

echo "[delegate] SKELETON — msb invocation is commented out pending Phase 1 verification."
echo "[delegate] task was: $TASK"
