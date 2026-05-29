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

### [x] Deploy to Kubernetes via Helm chart

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

### [x] Voice reply (TTS)

**Goal:** Claude can reply with a voice message, not just text.

Shipped: agent-invoked tool (`send-voice-tg.sh`), explicit-request-only.

- Provider: Google Gemini TTS (`gemini-2.5-flash-preview-tts`) via `@google/genai`.
- `src/tts.ts`: `synthesizeSpeech` (Gemini → PCM) + `pcmToOggOpus` (ffmpeg → OGG/Opus) + `createTtsApp` (`POST /tts`).
- Bot path: `bot.api.sendVoice(chat_id, new InputFile(buffer))`.
- Cap: `TTS_MAX_CHARS` (default 1000), over → 400 → text fallback.
- Voice/style optional per call (`--voice`, `--style`); env default `GEMINI_TTS_VOICE`.
- Spec: `.system/docs/specs/2026-05-29-telegram-voice-reply-tts-design.md`.

## Backlog

### [ ] Access logging middleware for the hono server

**Goal:** see endpoint calls (not just error events) in the pod logs.

- Endpoints currently log only on failure; successful `/notify` `/send-file` `/tts` calls are silent.
- Add `hono/logger` middleware in `src/index.ts` (`notifyApp.use("*", logger())`), or a small JSON success `log()` per route to match the existing structured-log format.

### [ ] Persistent, configurable voice preference

**Goal:** user picks a voice once; it sticks across turns/sessions.

- Today voice is per-call (`--voice`) or a single env default — no per-user state.
- Add a `/voice` command + inline keyboard to choose a Gemini prebuilt voice.
- Persist the choice per user in the SQLite session store (`src/session.ts`), survive session TTL expiry.
- TTS uses the stored voice when `--voice` omitted; explicit flag still overrides.

### [ ] (future) TTS hardening

- ffmpeg timeout guard in `pcmToOggOpus` (kill + reject on hang).
- Shared `log()` helper (dedupe across `notify.ts`/`send-file.ts`/`tts.ts`).
