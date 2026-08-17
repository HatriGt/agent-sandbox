#!/usr/bin/env bash
# One-shot setup for the agent-sandbox HTTP controller deploy.
# Idempotent: safe to re-run. Does NOT deploy — it prepares the key, .env, and build so you can
# create the Dokploy/Compose app afterwards.
#
# Usage:
#   VPS_SSH_ALIAS=my-vps ./setup.sh          # ssh alias/user@host you already use for the VPS
# Requires: node, npm, ssh, scp, openssl on this machine; msb already installed on the VPS host.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

VPS="${VPS_SSH_ALIAS:-}"
if [[ -z "$VPS" ]]; then
  echo "Set VPS_SSH_ALIAS to your VPS ssh target (alias or user@host). e.g.:"
  echo "  VPS_SSH_ALIAS=myvps ./setup.sh"
  exit 1
fi

echo "==> 1/5 Checking the VPS has msb ..."
ssh -o BatchMode=yes "$VPS" 'command -v /root/.local/bin/msb >/dev/null || { echo "msb not found at /root/.local/bin/msb on the VPS"; exit 1; }'
echo "    ok"

echo "==> 2/5 Ensuring a dedicated SSH key on the VPS (agent-sandbox-key) ..."
ssh -o BatchMode=yes "$VPS" '
  test -f /root/agent-sandbox-key || ssh-keygen -t ed25519 -f /root/agent-sandbox-key -N "" -C agent-sandbox
  grep -q "agent-sandbox" /root/.ssh/authorized_keys 2>/dev/null || cat /root/agent-sandbox-key.pub >> /root/.ssh/authorized_keys
'
echo "    ok (key authorized to reach the host itself)"

echo "==> 3/5 Pulling the private key into ./deploy (gitignored) ..."
mkdir -p deploy
scp -o BatchMode=yes "$VPS:/root/agent-sandbox-key" deploy/id_ed25519
chmod 600 deploy/id_ed25519
echo "    ok"

echo "==> 4/5 Scaffolding .env (if missing) ..."
if [[ ! -f .env ]]; then
  cp .env.example .env
  TOKEN="$(openssl rand -hex 32)"
  # Fill the deploy-critical values; leave the rest for you to edit.
  perl -0pi -e "s/^MCP_HTTP_TOKEN=.*/MCP_HTTP_TOKEN=$TOKEN/m" .env
  perl -0pi -e 's{^VPS_SSH=.*}{VPS_SSH=root\@host.docker.internal}m' .env
  perl -0pi -e 's{^# SSH_EXTRA_OPTS=.*}{SSH_EXTRA_OPTS=-i /root/.ssh/id_ed25519 -o StrictHostKeyChecking=accept-new}m' .env
  echo "    created .env with a generated MCP_HTTP_TOKEN + container SSH settings."
  echo "    >>> Now edit .env: set ASB_DOMAIN, ANTHROPIC_* (your ccproxy), GH_TOKEN, git identity."
else
  echo "    .env already exists — leaving it untouched."
fi

echo "==> 5/5 Installing deps + building ..."
npm ci >/dev/null 2>&1 || npm install >/dev/null 2>&1
npm run build >/dev/null
echo "    ok"

cat <<'DONE'

Setup complete. Next:
  1. Edit .env  -> ASB_DOMAIN, ANTHROPIC_BASE_URL/MODEL, GH_TOKEN, GIT_AUTHOR_*.
  2. Point DNS: ASB_DOMAIN -> your VPS.
  3. Create a Dokploy Compose app from this repo (path ./compose.yaml) and deploy,
     OR run locally on the VPS:  docker compose up -d --build
  4. Add to Cursor (~/.cursor/mcp.json):
       "agent-sandbox-remote": {
         "url": "https://<ASB_DOMAIN>/mcp",
         "headers": { "Authorization": "Bearer <MCP_HTTP_TOKEN from .env>" }
       }
DONE
