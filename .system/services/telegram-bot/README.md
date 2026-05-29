# Telegram Brain Bot

A Dockerized Node service that exposes the Second Brain repo via Telegram. Send text or voice; the bot pulls the repo, spawns Claude Code, replies, commits & pushes any changes.

- Single Node 24 / TypeScript service in a multi-stage Docker image
- One container, runs as non-root user `bot` (uid 1001)
- Talks to Telegram via long-polling (no public webhook needed)
- Per-message git lock → pull → claude → commit → push
- Voice via Deepgram nova-3
- Inline keyboards via a ` ```tg ` JSON block protocol Claude emits at the end of replies

Source layout, [design doc](../../docs/specs/2026-05-17-telegram-brain-bot-design.md), and the [implementation plan](../../docs/plans/2026-05-17-telegram-brain-bot.md) live alongside.

---

## Prerequisites

On the host (your laptop or VPS):

- Docker (≥ 24) with `docker compose` plugin
- An SSH key that has **write** access to the brain repo (deploy key works fine)
- The four secrets below

On your side:

| Secret | Where to get it | Notes |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Telegram → `@BotFather` → `/newbot` | One per bot |
| `TG_ALLOWED_USER_IDS` | Telegram → `@userinfobot` | Your numeric user id. Comma-separated for multi-user |
| `DEEPGRAM_API_KEY` | https://console.deepgram.com/ | Free trial is plenty for personal use |
| Claude auth | One of two options — see [Claude authentication](#claude-authentication) |  |

---

## First-time setup

From this directory (`.system/services/telegram-bot/`):

### 1. Create env files

Two env files live alongside docker-compose:

- `.env.local` — read by `docker compose` and `pnpm dev`/`start`.
- `.env.production` — read by `deploy/scripts/create-secrets.sh` for Kubernetes deploys.

```bash
cp .env.example .env.local
cp .env.example .env.production
$EDITOR .env.local
$EDITOR .env.production
```

Fill in the four required vars in each. Leave `ANTHROPIC_API_KEY` commented out if you'll use OAuth (see below). Both files are gitignored.

### 2. Generate a dedicated SSH deploy key

```bash
ssh-keygen -t ed25519 -C "telegram-brain-bot@$(hostname)" -f ssh-deploy-key -N ""
chmod 600 ssh-deploy-key
```

Two files appear: `ssh-deploy-key` (private, bind-mounted into the container) and `ssh-deploy-key.pub` (paste into GitHub).

### 3. Add the public key as a GitHub deploy key

`cat ssh-deploy-key.pub` → copy → https://github.com/<owner>/<repo>/settings/keys/new → paste, title `telegram-brain-bot`, ✅ **Allow write access**, **Add key**.

### 4. Build the image

```bash
docker compose build
```

Produces `telegram-brain-bot:latest`. ~734 MB; includes Node 24, Claude Code CLI, git, openssh.

### 5. Authenticate Claude

Pick one path:

#### Option A — OAuth (uses your Claude Pro/Max subscription)

```bash
docker compose run --rm -it --entrypoint="" telegram-brain-bot claude
```

Claude Code launches in an empty container, sees no credentials, prints an OAuth URL. Open it in a browser, sign in with the account that has Pro/Max, click Authorize. Paste the auth code back into the terminal. Type `/exit`.

Tokens land in `/home/bot/.claude/.credentials.json` inside the persistent `bot-home` Docker volume.

Leave `ANTHROPIC_API_KEY` commented out in both `.env.local` and `.env.production`.

#### Option B — API key (pay-as-you-go billed to your Anthropic Console)

Create a key at https://console.anthropic.com/ → API Keys → uncomment and paste into `.env.local` (and `.env.production` if deploying):

```
ANTHROPIC_API_KEY=sk-ant-...
```

No login step needed.

### 6. Boot

```bash
docker compose up -d
docker compose logs -f
```

You should see (JSON lines):

```
config_loaded     allowed=1
cloning_brain     repoUrl=...        ← first boot only
notify_listening  port=8080
bot_started       username=<botname>_bot
```

### 7. Verify

In Telegram, message your bot (`@<botname>_bot`):

```
/start
```

Expect: *"Brain bot ready. Send text or voice. /reset clears the session."*

You're live.

---

## Branch convention

The bot's `git clone` uses the brain repo's **default branch** (usually `master` / `main`) and `git pull --rebase` against the upstream of whatever branch is checked out. If you develop new bot features on a branch first:

```bash
# tell the in-container brain to track your branch
docker exec telegram-brain-bot sh -c "cd /data/brain && git fetch && git checkout feature/your-branch"
```

After this, every `git pull` and `git push` happens against `feature/your-branch`. Switch back to `master` once you've merged.

---

## Claude authentication

| | OAuth (Pro/Max) | API key |
|---|---|---|
| Setup | Interactive `claude /login` once | Single env var |
| Billing | Subscription quota | Per-token, drawn from Console balance |
| Token rotation | Auto-refresh | Manual rotation in Console |
| Multi-bot reuse | Tied to your Anthropic account | Same key works in N containers |
| Where stored | `/home/bot/.claude/.credentials.json` (volume) | `.env` |

**Tip:** if you set both, the API key wins. Leave `ANTHROPIC_API_KEY` commented out for OAuth.

---

## Operating

```bash
docker compose logs -f                # tail JSON logs
docker compose logs --tail 50         # last 50 lines, no follow
docker compose restart                # restart without rebuilding
docker compose up -d --build          # rebuild after source changes
docker compose down                   # stop, keep volumes
docker compose down -v                # stop, drop ALL volumes (brain, db, home)
docker exec -it telegram-brain-bot bash  # shell into the running container

# wipe just the bot's session DB (forces fresh Claude sessions for all users)
docker compose down && docker volume rm telegram-bot_bot-db && docker compose up -d
```

### Volumes

| Name | Mount | What's in it |
|---|---|---|
| `telegram-bot_brain-data` | `/data/brain` | Cloned brain repo |
| `telegram-bot_bot-db` | `/data/db` | SQLite session store (`bot.db`) |
| `telegram-bot_bot-home` | `/home/bot` | Claude Code config, OAuth credentials, SSH known_hosts |

### Log events

Every user turn produces a structured trace. Useful events to grep for:

| Event | Meaning |
|---|---|
| `message_received` | Incoming Telegram message (text / voice / callback) |
| `claude_invoke` | About to spawn Claude — includes `prompt_preview`, `session_id` |
| `claude_spawn` | argv (minus the prompt body) |
| `claude_exit` | Process exited — `duration_ms`, `stdout_len` |
| `claude_response` | Parsed reply — `body_preview`, `has_tg_block` |
| `git_committed` | Working tree had changes, committed |
| `git_pushed` | Push succeeded |
| `git_push_failed` | Push failed (SSH? network?) — bot keeps running |
| `git_pull_failed` | Pull failed (conflict?) — user got sync-conflict reply |
| `voice_transcribed` | Deepgram returned a transcript |
| `voice_failed` | Voice download or transcription failed |
| `allowlist_drop` | A non-allowlisted user messaged the bot |
| `notify_send_failed` | Claude called `/notify` but `sendMessage` failed |

---

## Smoke test

After boot, from your allowlisted account:

1. `/start` → "Brain bot ready..."
2. **Read-only Q&A** — `What's in CLAUDE.md?` → reply summarising the file, **no new commit on GitHub**.
3. **Capture flow** — `Capture this: try the new ramen place on Vinohrady` → Claude appends to `inbox/dump.md`, bot replies, and a `tg: …` commit shows up on the repo.
4. **Voice** — record a short voice message: *"Idea: build a CLI that wraps Stripe webhooks for local testing."* → bot replies `✍️ <transcript>` first, then Claude's reply, then a commit lands.
5. **Inline keyboard** — `Show me a two-button yes/no choice using the tg-block protocol.` → reply has two buttons; tapping one removes the keyboard and triggers a follow-up turn.
6. **Notify helper** — `Run .system/services/telegram-bot/notify-tg.sh --text "ping" and report the exit code.` → you receive "ping" as a separate Telegram message *before* Claude's final reply lands.
7. `/reset` → "Session cleared." Next message starts a fresh `session_id` in the logs.

### Quick endpoint check (no Claude needed)

Verify the bot can deliver outbound messages without spawning Claude:

```bash
docker exec telegram-brain-bot curl -s -X POST http://127.0.0.1:8080/notify \
  -H "content-type: application/json" \
  -d '{"chat_id": <YOUR_USER_ID>, "text": "🧪 direct hit"}'
```

Expect `{"ok":true}` and a Telegram message arrives.

---

## Troubleshooting

### `claude exit code 1: Claude configuration file not found at: /root/.claude.json`

The OAuth login was done in a transient container that didn't share the same home dir as the bot. Make sure:

- Your `docker-compose.yml` mounts `bot-home:/home/bot` (the whole home dir, not just `.claude/`)
- You ran `claude /login` via `docker compose run --rm` from this directory

If you see the error after a config reset, restore the auto-backup:

```bash
docker exec -it telegram-brain-bot sh -c \
  "cp /home/bot/.claude/backups/.claude.json.backup.* /home/bot/.claude.json"
docker compose restart
```

### `--dangerously-skip-permissions cannot be used with root/sudo privileges`

The container must run as a non-root user. Check `Dockerfile` includes `USER bot` (or whatever non-root user you set). If you customised the image, ensure `useradd` is run *before* `USER`.

### `Sync conflict — please resolve on desktop and try again.`

The bot tried `git pull --rebase --autostash` and hit a conflict. Resolve on your desktop:

```bash
cd /path/to/your/local/clone
git pull
# resolve conflicts, commit
git push
```

The bot pulls again on the next user message.

### Claude says "I don't have access to that file" but the file exists

The in-container brain repo may be on a different branch than the file you expect. Check:

```bash
docker exec telegram-brain-bot sh -c "cd /data/brain && git branch --show-current && git log -1 --oneline"
```

Switch branches as shown in [Branch convention](#branch-convention).

### Telegram bot is silent — no logs even on `/start`

Your user id isn't in `TG_ALLOWED_USER_IDS`. The bot drops unauthorized updates with an `allowlist_drop` log line — check for that. Update `.env` and `docker compose restart`.

---

## Architecture in one paragraph

The bot is the sole consumer of Telegram updates. For each user message it acquires a file-lock on the brain repo's `.git/`, pulls, spawns `claude -p --resume <sid> --append-system-prompt prompts/telegram-mode.md --dangerously-skip-permissions` from `/data/brain`, parses stdout for an optional trailing ` ```tg ` JSON block, sends the body (with inline keyboard if present), then commits + pushes any working-tree changes. Sessions are stored in SQLite (per-Telegram-user → Claude session id, with a configurable TTL). Proactive notifications from Claude during long tasks go through a localhost Hono `/notify` endpoint that the bot exposes on `127.0.0.1:8080` inside the container, invoked from `notify-tg.sh` (in the brain repo, so Claude's Bash tool can reach it).

---

## Files

| Path | Role |
|---|---|
| `src/index.ts` | Boot sequence — config, clone, sessions, server, bot |
| `src/bot.ts` | grammy wiring — allowlist, /start, /reset, text, voice, callbacks |
| `src/claude.ts` | `runClaude()` — CLI spawn + JSON envelope parsing |
| `src/git.ts` | `GitRepo` — isDirty/pull/commit/push/withLock |
| `src/voice.ts` | Deepgram transcription |
| `src/session.ts` | SQLite store for sessions + callback intents |
| `src/notify.ts` | Hono `POST /notify` endpoint |
| `src/protocol.ts` | tg-block parser + Telegram inline-keyboard payload conversion |
| `src/config.ts` | zod-validated env loader |
| `prompts/telegram-mode.md` | System prompt fragment injected into Claude |
| `notify-tg.sh` | Outbound helper Claude invokes via its Bash tool |
| `Dockerfile` | Multi-stage build (builder + runtime) |
| `docker-compose.yml` | Service definition + 3 named volumes |
| `.env.example` | Template; copy to `.env.local` and `.env.production` and fill in |

---

## Development

```bash
pnpm install           # install deps
pnpm test              # 33 vitest cases across 7 suites
pnpm run typecheck     # tsc --noEmit
pnpm run build         # tsup → dist/index.js (bundled ESM)
```

Local execution without Docker is awkward — the entrypoint hard-codes `/data/brain` and `/data/db`. For iterative development, edit source, run `docker compose up -d --build`, then `docker compose logs -f`.

## Deploy to Kubernetes (Helm)

A Helm chart lives at `deploy/chart/` and three operator scripts live at
`deploy/scripts/`. The secret-creation script reads `.env.production`
(separate from `.env.local` used by docker-compose). Same
`ssh-deploy-key` file is reused.

```bash
cd .system/services/telegram-bot
./deploy/scripts/docker-build-and-push.sh    # per code change
./deploy/scripts/create-secrets.sh           # once + when secrets change
./deploy/scripts/deploy-with-helm.sh         # per release
```

Notes:
- Namespace: `app-second-brain-bot`.
- Storage class: `local-path`. Three PVCs (`-brain-data`, `-bot-db`, `-bot-home`).
- Single replica — git lock requires a single writer; the chart hardcodes it.
- `/healthz` on the loopback Hono port is used by k8s exec probes (`curl -fs`).
- See `.system/docs/specs/2026-05-26-telegram-bot-helm-design.md` for the full design.

## K8S Operations

Follow logs
```bash
kubectl logs -f deployment/telegram-brain-bot -n app-second-brain-bot
```
