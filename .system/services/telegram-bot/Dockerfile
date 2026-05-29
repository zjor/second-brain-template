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
    git openssh-client ca-certificates curl python3 ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Create non-root user. Claude Code refuses --dangerously-skip-permissions when
# running as root, and we need that flag for headless operation.
RUN useradd -m -s /bin/bash bot

COPY --from=builder --chown=bot:bot /app/node_modules ./node_modules
COPY --from=builder --chown=bot:bot /app/dist ./dist
COPY --chown=bot:bot package.json ./
COPY --chown=bot:bot prompts ./prompts
COPY --chown=bot:bot notify-tg.sh ./notify-tg.sh
COPY --chown=bot:bot send-file-tg.sh ./send-file-tg.sh
COPY --chown=bot:bot send-voice-tg.sh ./send-voice-tg.sh
RUN chmod +x /app/notify-tg.sh /app/send-file-tg.sh /app/send-voice-tg.sh

# Volumes mounted by docker-compose:
#   /data/brain     — the brain repo
#   /data/db        — SQLite directory
#   /home/bot       — entire bot home (.claude/, .claude.json, .ssh/, …)
RUN mkdir -p /data/brain /data/db /home/bot/.claude /home/bot/.ssh \
    && chmod 700 /home/bot/.ssh \
    && chown -R bot:bot /data/brain /data/db /home/bot /app

# Pre-trust GitHub host key (as bot, so it goes to /home/bot/.ssh)
RUN su bot -c "ssh-keyscan -t ed25519 github.com >> /home/bot/.ssh/known_hosts 2>/dev/null || true"

USER bot

ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "dist/index.js"]
