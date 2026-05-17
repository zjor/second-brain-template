# syntax=docker/dockerfile:1.7

# ---- Builder ----
FROM node:24-slim AS builder
WORKDIR /app

# Build-time deps for better-sqlite3 native compile
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Enable pnpm via corepack
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
RUN pnpm run build

# Drop dev deps for a smaller runtime copy
RUN pnpm prune --prod

# ---- Runtime ----
FROM node:24-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    git openssh-client ca-certificates curl python3 \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

# Volumes are mounted by docker-compose:
#   /data/brain   — the brain repo
#   /data/db      — SQLite directory
#   /root/.claude — Claude session histories
RUN mkdir -p /data/brain /data/db /root/.claude /root/.ssh \
    && chmod 700 /root/.ssh

# Pre-trust GitHub host key so first git clone doesn't prompt
RUN ssh-keyscan -t ed25519 github.com >> /root/.ssh/known_hosts 2>/dev/null || true

ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "dist/index.js"]
