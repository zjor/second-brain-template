---
created: 2026-05-17
status: draft
---

# Telegram Brain Bot — Design

A VPS-deployed Telegram bot that exposes the user's Second Brain (PARA repo) as a 24/7 conversational interface. Supports voice and text capture, the existing `/transcribe` → `/summarize` → `/propagate` pipeline, interactive Q&A, and remote skill execution — all through Telegram, while preserving the desktop Cursor + Claude Code workflow.

## Goals

- Send Telegram messages (text or voice) and have them processed by Claude Code with full access to the brain's skills and history.
- Reuse the existing `.claude/` configuration and skills verbatim — no parallel codebase.
- Preserve session continuity across messages for genuine Q&A.
- Allow interactive approval flows (e.g., `/propagate`) over Telegram via inline buttons.
- Keep desktop and VPS edits coherent through git, without manual intervention per message.
- Single-tenant: Telegram user allowlist of one (or a small number).

## Non-goals

- Multi-tenant SaaS for multiple users with isolation.
- Real-time streaming output to Telegram (each turn is one final reply, plus optional proactive notifications).
- Replacing the desktop workflow — desktop remains primary; the bot is an alternate input/output surface.
- Telegram MCP server inside the container.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ Docker container (VPS)                                       │
│                                                              │
│   ┌─────────────────────────────────────┐                    │
│   │ Bot service (Node 24 LTS, TS)       │◀───── Telegram ────┤
│   │   - grammy long-polling loop        │     (inbound)      │
│   │   - Hono HTTP server (/notify)      │                    │
│   │   - better-sqlite3 session store    │                    │
│   │   - proper-lockfile git mutex       │                    │
│   │   - @deepgram/sdk voice pipeline    │                    │
│   │   - spawns claude CLI per turn      │                    │
│   └────────┬────────────────────────────┘                    │
│            │ subprocess                                      │
│            ▼                                                 │
│   ┌─────────────────────────────────────┐                    │
│   │ claude -p --resume <sid>            │                    │
│   │   TG_MODE=1                         │                    │
│   │   --append-system-prompt            │                    │
│   │     /data/brain/.system/services/   │                    │
│   │       telegram-bot/prompts/         │                    │
│   │       telegram-mode.md              │                    │
│   │                                     │                    │
│   │ Inside:                             │                    │
│   │   - brain repo (/data/brain)        │                    │
│   │   - .claude/ skills (from repo)     │                    │
│   │   - ~/.claude/ session store        │                    │
│   │   - notify-tg.sh outbound tool      │────── Telegram ────┤
│   └─────────────────────────────────────┘     (outbound)     │
└──────────────────────────────────────────────────────────────┘
```

**Single Telegram consumer.** The bot service is the only process calling `getUpdates`. Claude never speaks Telegram directly. Outbound proactive notifications go through the bot's `/notify` HTTP endpoint, called by Claude via the `notify-tg.sh` tool.

## Components

### 1. Bot service

Single Node.js process (Node 24 LTS, TypeScript), runs as the container entrypoint. Responsibilities:

- Long-poll `getUpdates` from Telegram via [grammy](https://grammy.dev).
- Enforce Telegram user allowlist; silently drop messages from other users.
- Handle bot-level commands (`/reset`, `/start`) directly — these never reach Claude.
- For each inbound user message (text or voice):
  - Acquire git lock via [`proper-lockfile`](https://www.npmjs.com/package/proper-lockfile) on `/data/brain/.git/bot.lock`.
  - `git -C /data/brain pull --rebase` (fail-soft if conflict — see Error handling).
  - For voice messages: download OGG via Telegram file API, transcribe with `@deepgram/sdk` (nova-3, Russian), feed text to Claude.
  - Look up or create session for `tg_user_id`.
  - Spawn `claude -p --resume <sid> --append-system-prompt /data/brain/.system/services/telegram-bot/prompts/telegram-mode.md <text>` with `TG_MODE=1` env var, cwd = `/data/brain`.
  - Parse stdout: strip trailing ` ```tg ` block if present, send body as Telegram message with `reply_markup` from the parsed keyboard spec.
  - `git -C /data/brain add -A && git commit -m "..." && git push` if working tree dirty.
  - Release lock.
- For each `callback_query` (button click):
  - Acknowledge with `answerCallbackQuery`.
  - Edit the original message to strip the keyboard (one-shot UX).
  - Feed `[user clicked: <data>]` as next turn to Claude via the same spawn flow.
- HTTP endpoint `POST /notify` on `localhost:8080` served by [Hono](https://hono.dev), accepting `{chat_id, text, parse_mode?}` — relays to Telegram. Used by Claude's `notify-tg.sh` for mid-task progress.

### 2. Telegram-mode system prompt

A file `telegram-mode.md` lives at `.system/services/telegram-bot/prompts/telegram-mode.md` inside the brain repo. The bot passes it via `--append-system-prompt` on every spawn. Because the brain repo is mounted at `/data/brain`, the absolute path in the container is `/data/brain/.system/services/telegram-bot/prompts/telegram-mode.md`.

Contents:

- Describe the communication channel (Telegram, max 4096 chars per message).
- Forbid `AskUserQuestion`, terminal prompts, or any interactive UI tool.
- Define the output protocol (prose body + optional fenced ` ```tg ` JSON block).
- Document keyboard schema and the rule for short callback tokens.
- Document the `notify-tg.sh` tool for proactive notifications.

The desktop `CLAUDE.md` remains untouched. Mode-specific instructions only enter Claude's context when the bot spawns the CLI with `--append-system-prompt`. Desktop sessions behave exactly as they do today.

### 3. Telegram output protocol

Each Claude turn produces stdout of the form:

````
<markdown body>

```tg
{
  "parse_mode": "MarkdownV2",
  "keyboard": [
    [{"text": "Apply all", "data": "apply_all"}],
    [{"text": "Skip",      "data": "skip"}]
  ],
  "disable_preview": true
}
```
````

Rules:

- The `tg` fenced block is optional; absence means "send the whole stdout as plain markdown."
- The block must be the trailing element of stdout; the bot strips it before sending the body.
- `data` strings are short semantic tokens (≤32 chars) that Claude invents. They are echoed back verbatim on click.
- If Claude needs to encode an intent longer than 64 bytes, it still uses a short token; the bot generates a `token_urlsafe(6)` replacement and stores the full intent in the SQLite callback map for that message.

**Outbound notifications use the same JSON shape, minus keyboard:**

```bash
notify-tg.sh --json '{"text": "Transcription done. Summarizing...", "parse_mode": "MarkdownV2"}'
```

The bot's `/notify` endpoint accepts this and posts to the appropriate chat.

### 4. Session model

State (in SQLite at `/data/bot.db`):

| Table | Columns |
|---|---|
| `sessions` | `tg_user_id PRIMARY KEY`, `claude_session_id`, `chat_id`, `last_active_at` |
| `callbacks` | `message_id`, `token`, `intent`, `created_at` (composite PK, optional — only populated when long-intent encoding is needed) |

Rules:

- One active session per Telegram user.
- Session TTL: 30 minutes idle → next message starts a new Claude session (no `--resume`). Old sessions on disk under `~/.claude/projects/...` are not garbage-collected by the bot; Claude Code manages those.
- Explicit `/reset` command (handled by the bot, not Claude) drops the row and starts fresh.
- Callback entries are deleted on click (one-shot) or after a 1-hour TTL sweep.

Claude Code itself persists turn-by-turn conversation history on disk under `~/.claude/projects/<repo-hash>/`. The bot stores only the lightweight resume pointer. Loss of `bot.db` means the next message starts a new session; brain content and session history on disk are unaffected.

### 5. Voice pipeline

1. Telegram sends `message.voice` with a `file_id`.
2. Bot calls `getFile` → downloads the OGG/OPUS payload to a tmp path under `/tmp/voice-<update_id>.ogg`.
3. Bot streams the file to Deepgram via `@deepgram/sdk` (nova-3 model, Russian primary language with detect-language fallback).
4. Transcribed text is passed to Claude as the user's turn for this Telegram message.
5. Tmp file is deleted after transcription (or on bot restart — `/tmp` is ephemeral in the container).

Deepgram accepts OGG/OPUS natively, so **no ffmpeg dependency**. If we ever discover an edge case (corrupted upload, format mismatch), we'll add ffmpeg conversion as a fallback.

The transcript file itself is **not** auto-saved to `inbox/transcripts/`. Saving the transcript and routing the content (e.g., to `braindump-log.md`) is Claude's job, governed by the existing skills, not the bot.

### 6. Git sync

Per-message sync: every inbound user message triggers pull-process-commit-push, in one locked operation. No batching, no debouncing.

- Mutex via `proper-lockfile` on `/data/brain/.git/bot.lock` for the duration of one operation. Prevents interleaving across concurrent Telegram messages (rare with a single user but cheap to protect against). Offers no protection against simultaneous local Cursor edits — those rely on normal git semantics.
- Before agent invocation: `git -C /data/brain pull --rebase`.
- After agent invocation: if `git status --porcelain` is non-empty, `git add -A && git commit -m "<auto>" && git push`. Commit message convention:
  - `tg: <first 60 chars of user input>` for capture/processing.
  - `tg: claude turn <ISO timestamp>` if input is not meaningful as a commit message (e.g., a button click or a follow-up).
- If `git pull` rebase fails (genuine conflict from a parallel desktop push), the bot replies to the user: "Sync conflict — please resolve on desktop and try again." It does NOT attempt automatic conflict resolution.

### 7. Auth

- Allowlist: env var `TG_ALLOWED_USER_IDS` (comma-separated Telegram numeric IDs). Bot drops any message from a non-allowlisted `from.id`.
- No additional tokens, passwords, or session bootstrap. Telegram's account ownership is the trust anchor.

### 8. Container

Single Dockerfile, single service, orchestrated via `docker-compose.yml`.

- Base image: `node:24-slim` (Node 24 LTS).
- Installed system packages: `git`, `openssh-client` (for push over SSH), `ca-certificates`. **No ffmpeg, no sqlite3 system package** (we use `better-sqlite3` which bundles its own SQLite).
- Claude Code CLI installed via the official install method (per Anthropic's docs).
- Bot source built from `.system/services/telegram-bot/` and copied to `/app`. `node_modules` installed at image build time.
- Mounted volumes (named volumes, declared in `docker-compose.yml`):
  - `brain-data` → `/data/brain` — git clone of the Second Brain repo (read-write). On first boot, bot clones `BRAIN_REPO_URL` here if empty.
  - `bot-db` → `/data/db` — holds `bot.db` (SQLite). Persists across container restarts. **Not committed to git** — lives in a separate volume outside the brain repo.
  - `claude-config` → `/root/.claude` — so Claude session histories persist across container restarts.
- Required env vars (loaded from `.env` next to `docker-compose.yml`):
  - `TELEGRAM_BOT_TOKEN`
  - `TG_ALLOWED_USER_IDS` (comma-separated numeric IDs)
  - `DEEPGRAM_API_KEY`
  - `ANTHROPIC_API_KEY`
  - `BRAIN_REPO_URL` (e.g., `git@github.com:zjor/second-brain.git`)
  - SSH deploy key mounted as a file at `/root/.ssh/id_ed25519` (read-only mount, not an env var).
- Entrypoint: `node dist/index.js`. On first boot, if `/data/brain/.git` does not exist, clones `BRAIN_REPO_URL` via SSH.

No Redis, no separate database service, no MCP servers, no reverse proxy. The `/notify` HTTP endpoint is bound to `127.0.0.1:8080` inside the container — unreachable from outside.

### 9. Repository layout

All bot code, configuration, prompts, and deployment artifacts live in one folder inside the brain repo:

```
.system/services/telegram-bot/
├── README.md                       # how to build and deploy
├── Dockerfile
├── docker-compose.yml
├── .env.example                    # template; real .env is gitignored
├── .dockerignore
├── package.json
├── package-lock.json
├── tsconfig.json
├── src/
│   ├── index.ts                    # entrypoint
│   ├── bot.ts                      # grammy wiring, command handlers
│   ├── claude.ts                   # CLI spawn, stdout/tg-block parsing
│   ├── git.ts                      # lock, pull, commit, push
│   ├── voice.ts                    # Deepgram transcription
│   ├── session.ts                  # SQLite session + callback store
│   ├── notify.ts                   # Hono /notify endpoint
│   ├── protocol.ts                 # tg-block parser, keyboard schema
│   └── config.ts                   # env var loading + validation
├── prompts/
│   └── telegram-mode.md            # the system prompt injected per spawn
└── test/
    ├── protocol.test.ts            # tg-block parser unit tests
    └── keyboard.test.ts            # keyboard → Telegram payload tests
```

**Why this layout:**
- One folder, one deployable artifact. `docker-compose up` from this directory does everything.
- The prompt is co-located with the code that injects it — they evolve together.
- The brain repo's `.gitignore` excludes `.system/services/telegram-bot/{node_modules,dist,.env}`.
- Future deployable services (e.g., a Discord bridge) get sibling folders under `.system/services/`.

### 10. Dependencies

Pinned via `package.json`. Minimal direct deps:

| Package | Purpose |
|---|---|
| `grammy` | Telegram bot framework |
| `hono` + `@hono/node-server` | HTTP server for `/notify` |
| `better-sqlite3` | Synchronous SQLite client for session store |
| `@deepgram/sdk` | Voice transcription |
| `proper-lockfile` | Cross-platform git mutex |
| `zod` | Runtime validation of the `tg` block JSON and `/notify` payloads |

Dev deps: `typescript`, `tsx` (for local dev), `vitest` (test runner), `@types/node`, `@types/better-sqlite3`.

Env loading uses Node 24's native `--env-file` flag — no `dotenv` dependency.

## Information flow examples

### Voice → capture

```
1. User sends a 12-second voice message.
2. Bot: downloads OGG, Deepgram nova-3 → "Idea: build a CLI that wraps Stripe webhooks for local testing."
3. Bot: acquires git lock, pulls, spawns:
   claude -p --resume <sid> \
     --append-system-prompt /data/brain/.system/services/telegram-bot/prompts/telegram-mode.md \
     "Idea: build a CLI that wraps Stripe webhooks for local testing."
4. Claude: matches conventions in CLAUDE.md (idea-capture workflow), checks braindump-log.md, appends entry.
5. Claude stdout: "Added to inbox/braindump-log.md with tag #tool."
6. Bot: sends that as Telegram reply, commits + pushes, releases lock.
```

### Voice → full pipeline with approval gate

```
1. User: voice message: "Process the latest journal entry."
2. Bot: transcribes, spawns Claude with the text.
3. Claude: runs /summarize internally, finds 3 propagation candidates.
4. Claude stdout:
     "Found 3 propagations:
      1. projects/ion.md
      2. areas/health.md
      3. resources/programming/zig.md
      Apply?

      ```tg
      {"keyboard": [
        [{"text": "Apply all", "data": "apply_all"}],
        [{"text": "Just 1,2",  "data": "apply_1_2"}],
        [{"text": "Skip",      "data": "skip"}]
      ]}
      ```"
5. Bot: strips block, sends message with inline keyboard.
6. User taps "Just 1,2".
7. Bot: answerCallbackQuery, edits keyboard off, spawns:
   claude -p --resume <sid> ... "[user clicked: apply_1_2]"
8. Claude: applies propagations 1 and 2, replies "Done."
9. Bot: sends reply, commits + pushes.
```

### Q&A

```
1. User text: "What were my 2025 resolutions?"
2. Bot: pulls, spawns claude -p --resume <sid> with the text.
3. Claude: reads areas/planning/2025/resolution-25.md, summarizes.
4. Bot: sends Claude's reply. No git changes; no commit.
```

## Error handling

All errors are logged to stderr with structured JSON (timestamp, level, event, context). `docker logs telegram-brain-bot` is the operator's window into the system. There is no separate alerting channel.

- **Git pull conflict**: reply to user with "Sync conflict — please resolve on desktop and try again." Do not attempt auto-resolution. Log the conflict details to stderr.
- **Voice transcription failure**: reply with the error and the Telegram `file_id` so the user can retry. Log the Deepgram error.
- **Claude CLI nonzero exit**: reply with "Internal error processing your message. Check `docker logs` for details." Log the full stdout, stderr, and exit code to stderr.
- **Stdout exceeds 4096 chars**: bot splits at paragraph boundaries; the trailing `tg` block (if any) is attached only to the last message segment.
- **Malformed `tg` block JSON**: bot treats the whole stdout as plain text (including the block markers) and sends it. Log the parsing failure (zod error) to stderr.
- **Allowlist miss**: silently drop. No reply (avoids amplifying bot discovery). Log at INFO level with the rejected user_id.

## Testing

- Unit tests for the protocol parser: prose-only, prose + valid block, prose + malformed block, only block.
- Unit tests for keyboard schema validation and Telegram payload construction.
- Integration test with a mock Telegram server: full round-trip for a text message and a button click, including session resume.
- Manual end-to-end: send a voice memo, verify the brain repo on GitHub shows the expected commit.

## Decisions

Resolved during design:

- **Transport**: long-polling (no public TLS endpoint needed for MVP).
- **Bot language**: Node 24 LTS with TypeScript.
- **Telegram framework**: grammy.
- **HTTP server**: Hono on `@hono/node-server`.
- **SQLite client**: `better-sqlite3` (synchronous, no separate DB process).
- **Voice**: `@deepgram/sdk` (nova-3, Russian), no ffmpeg.
- **Desktop `CLAUDE.md`**: untouched. Telegram mode is injected only via `--append-system-prompt` in the bot.
- **Operator alerts**: stderr → `docker logs`. No separate alerting channel.
- **Git sync**: per-message pull-commit-push under a lock.
- **`/reset` and `/start`**: handled by the bot directly, do not reach Claude.
- **`bot.db`**: lives in a dedicated Docker volume outside the brain repo; never committed.

## Open questions

Deferred to the implementation plan, not blocking design approval:

- **Session TTL value**: 30 minutes idle is my default. Final value pinned during implementation; trivially changeable via config.
- **Multi-segment message ordering**: when stdout exceeds 4096 chars and we split, do we send sequentially (and risk the keyboard arriving before the user finishes reading) or with brief delays? Implementation-time choice.
- **SSH deploy key vs PAT**: SSH for git push is the default. If the VPS environment makes SSH agent forwarding awkward, fall back to a fine-scoped HTTPS PAT. Deferred.
- **Long-intent callback packing**: the `callbacks` table is specced but unused at MVP (Claude's short tokens fit in 64 bytes for the use cases we have). Wire it up only when a real case exceeds the limit.

## Out of scope for v1

- Multi-user support with per-user brain repos.
- Per-message budget controls / rate limiting.
- A web dashboard for session inspection.
- Streaming responses (each turn emits one final message + optional `/notify` pushes).
- Migrating the desktop workflow to use this bot as a proxy.
