# Telegram Brain Bot

A Dockerized Node service that exposes the Second Brain repo via Telegram. Send text or voice messages; the bot pulls the repo, spawns Claude Code, and commits & pushes any changes.

See [design doc](../../docs/specs/2026-05-17-telegram-brain-bot-design.md).

## Architecture in one paragraph

The bot is the sole consumer of Telegram updates. For each user message, it acquires a git lock, pulls, spawns `claude -p --resume <sid> --append-system-prompt prompts/telegram-mode.md` from the brain repo's root, parses stdout for an optional trailing ` ```tg ` JSON block, sends the body (with inline keyboard if present), then commits + pushes any working-tree changes. Sessions are stored in SQLite (per-Telegram-user → Claude session id). Proactive notifications from Claude during long tasks go through a localhost Hono `/notify` endpoint, invoked from `notify-tg.sh`.

## Local development

```bash
# Install deps (pnpm)
pnpm install

# Copy and fill in env vars
cp .env.example .env
$EDITOR .env

# Run tests
pnpm test

# Build the bundle
pnpm run build
```

Local end-to-end runs without Docker are possible but awkward (the entrypoint hard-codes `/data/brain`, `/data/db`). Easiest is to deploy via Docker.

## Deploy on a VPS

1. SSH to the VPS. Install Docker and Docker Compose.
2. Clone the brain repo:
   ```
   git clone <brain-repo-url> /opt/brain
   cd /opt/brain/.system/services/telegram-bot
   ```
3. Create `.env` from `.env.example` and fill in:
   - `TELEGRAM_BOT_TOKEN` — from @BotFather
   - `TG_ALLOWED_USER_IDS` — your numeric Telegram user id (get it from @userinfobot)
   - `DEEPGRAM_API_KEY`
   - `ANTHROPIC_API_KEY`
   - `BRAIN_REPO_URL` — SSH URL of the brain repo
4. Place an SSH private key with push access to the brain repo at `ssh-deploy-key` next to `docker-compose.yml`. Set perms:
   ```
   chmod 600 ssh-deploy-key
   ```
5. Add the public key to the brain repo's GitHub deploy keys (with write access).
6. Build and start:
   ```
   docker compose up -d --build
   docker compose logs -f
   ```
7. Open Telegram, message the bot. First-time boot will clone the brain repo into the `brain-data` volume; subsequent messages reuse it.

## Operating

- Logs: `docker compose logs -f`
- Restart: `docker compose restart`
- Rebuild after code changes: `docker compose up -d --build`
- Wipe sessions only: `docker compose down && docker volume rm telegram-bot_bot-db && docker compose up -d`

## Smoke test

After deploy:

1. From your allowlisted Telegram account, send `/start`. Expect: "Brain bot ready..." reply.
2. Send `Hello, what do you know about me?`. Expect: a reply summarizing personal facts (drawn from `areas/user.md`).
3. Check the brain repo on GitHub — there should be no new commit (Q&A doesn't write).
4. Send a voice message: "Idea: build a CLI that wraps Stripe webhooks for local testing." Expect: a reply confirming capture, and a new commit on the brain repo with the captured idea.
5. Send `/reset`. Expect: "Session cleared." Next message starts fresh.

If any step fails, check `docker compose logs telegram-brain-bot` — all errors are logged as structured JSON.

## Files

- `src/index.ts` — boot
- `src/bot.ts` — grammy wiring (text, voice, callbacks, commands)
- `src/claude.ts` — CLI spawn + protocol parsing
- `src/git.ts` — lock, pull, commit, push
- `src/voice.ts` — Deepgram
- `src/session.ts` — SQLite store
- `src/notify.ts` — Hono /notify endpoint
- `src/protocol.ts` — tg-block parser & keyboard payload conversion
- `src/config.ts` — zod env validation
- `prompts/telegram-mode.md` — system prompt fragment injected into Claude
- `notify-tg.sh` — outbound helper Claude calls for progress updates
