# agent-sandbox HTTP MCP controller.
# Runs the Streamable HTTP entry (dist/http.js). It does NOT run msb itself — msb lives on the
# VPS host (needs KVM/microVMs), so this container SSHes to the host to drive msb. Hence it only
# needs node + an ssh client (git is used host-side for clones, but kept here for parity/tests).
FROM node:20-slim

RUN apt-get update -qq \
  && apt-get install -y -qq --no-install-recommends openssh-client git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install ALL deps (incl. dev) to compile TypeScript inside the image — no host build needed.
COPY package.json package-lock.json* tsconfig.json ./
RUN npm ci

# Compile src -> dist inside the image, then drop dev deps to slim the runtime.
COPY src ./src
RUN npm run build && npm prune --omit=dev

# HTTP entry binds 127.0.0.1 inside the container; Traefik reaches it over the compose network,
# so we bind 0.0.0.0 in-container via HOST override at runtime (see compose: MCP_HTTP_HOST).
EXPOSE 8787

CMD ["node", "dist/http.js"]
