# Telegram Bot — Roadmap

Living list of next-up features. Status markers: `[ ]` planned · `[~]` in progress · `[x]` shipped.

## Immediate

### [x] Send files from bot to user

**Goal:** allow Claude (and `/notify`-style helpers) to deliver documents and photos back through Telegram, not just text.

- Extend `/notify` endpoint (`src/notify.ts`) to accept `{ chat_id, document?: string, photo?: string, caption?: string }` where `document`/`photo` is an absolute path inside the container.
- New helper script `/app/send-file-tg.sh` (mirror of `notify-tg.sh`): wraps `curl POST /notify` with `--document <path>` / `--photo <path>` / `--caption "..."`.
- Bot calls `bot.api.sendDocument(chat_id, new InputFile(path), { caption })` / `sendPhoto`.
- Document `send-file-tg.sh` in `prompts/telegram-mode.md`.
- Edge cases: file >50 MB (Telegram bot upload limit) → reject early with clear error.

### [ ] Deploy to Kubernetes via Helm chart

**Goal:** one-command deploy onto an existing K8s cluster.

- New chart at `.system/services/telegram-bot/deploy/helm/telegram-brain-bot/`:
  - `Chart.yaml`, `values.yaml`
  - `templates/deployment.yaml` (single replica — git lock requires it)
  - `templates/secret.yaml` (TELEGRAM_BOT_TOKEN, DEEPGRAM_API_KEY, ANTHROPIC_API_KEY, SSH deploy key)
  - `templates/pvc.yaml` ×3 — match docker-compose volumes (`brain-data`, `bot-db`, `bot-home`)
  - `templates/configmap.yaml` for `BRAIN_REPO_URL`, `GIT_USER_*`, `TG_ALLOWED_USER_IDS`
  - Optional `templates/networkpolicy.yaml` egress to `api.telegram.org`, `api.anthropic.com`, `api.deepgram.com`, `github.com:22`
- Bake image push into a `Makefile` target (`make image push helm-upgrade`).
- Document `helm install` in README.

### [ ] Voice reply (TTS)

**Goal:** Claude can reply with a voice message, not just text.

- Provider: Deepgram Aura (already have key) or ElevenLabs (better voice quality, separate billing).
- New module `src/tts.ts`: `synthesize(text: string): Promise<Buffer>` returning OGG/OPUS (Telegram's preferred voice format).
- Trigger options to decide:
  - (a) Claude opts in via tg-block field: `"reply_as": "voice"` — model decides per turn.
  - (b) User toggles via `/voice on` command stored in session.
  - (c) Auto when user sent voice in.
- Bot path: `bot.api.sendVoice(chat_id, new InputFile(buffer))`.
- Caveat: long replies = long audio. Cap at ~500 chars or split.
- Voice prosody hints in system prompt: tell Claude to write conversationally when speaking.

## Backlog

_(add as new ideas land — keep this file as the single source of truth for what's next on the bot)_
