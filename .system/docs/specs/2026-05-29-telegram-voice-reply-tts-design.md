---
created: 2026-05-29
status: active
tags: [telegram-bot, tts, gemini, voice]
---

# Telegram Bot — Voice Reply (TTS) Design

## Goal

Let the in-container Claude agent reply with a Telegram **voice message** (the
native waveform bubble), synthesized via **Google Gemini TTS**. Triggered as a
**tool mid-turn** — the agent decides to send voice when the user explicitly
asks for it. Not an end-of-turn behavior.

## Requirements

- TTS provider: **Google Gemini** (`@google/genai` SDK).
- Available **only inside the Telegram environment** — achieved by baking the
  helper into the image and documenting it in `prompts/telegram-mode.md` (the
  Telegram-only system prompt). Not a `.claude/` slash command (those are
  user-typed, not agent-invoked).
- The agent invokes it as a tool when the user explicitly asks for a voice
  reply («ответь голосом», "say it out loud"). Default stays text.
- API key via env. Tool baked in the Docker image. No persisted audio files —
  in-memory buffers only.

## Architecture

Mirrors the existing `send-file` capability one-to-one: a hono sub-app with
injected dependencies, mounted on the internal localhost server, plus a baked
bash helper the agent calls. Gemini SDK + API key stay server-side; the agent
only sees a bash tool.

Delivery format: a **true Telegram voice message** via `bot.api.sendVoice`,
which requires **OGG/Opus**. Gemini TTS returns raw **PCM** (24kHz, 16-bit,
mono), so an **ffmpeg transcode** step (PCM → OGG/Opus) is required —
ffmpeg is added to the runtime image.

### Single module: `src/tts.ts`

Kept as one file (not a sub-dir) to match the flat `src/` convention
(`notify.ts`, `send-file.ts`, `voice.ts` are each one file per capability).
Three named exports; layers separated by function, not by file:

1. **`synthesizeSpeech(text, { voice, style, apiKey, model }) → Promise<Buffer>`**
   - Calls `@google/genai` `ai.models.generateContent`:
     ```ts
     const ai = new GoogleGenAI({ apiKey });
     const resp = await ai.models.generateContent({
       model,
       contents: [{ parts: [{ text: style ? `${style}: ${text}` : text }] }],
       config: {
         responseModalities: ["AUDIO"],
         speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
       },
     });
     ```
   - Decodes base64 `resp.candidates[0].content.parts[0].inlineData.data` →
     raw PCM Buffer (s16le, 24kHz, mono).
   - Throws on empty/missing audio.

2. **`pcmToOggOpus(pcm) → Promise<Buffer>`**
   - Spawns ffmpeg, pipes PCM in via stdin, reads OGG/Opus from stdout — no
     temp file:
     ```
     ffmpeg -hide_banner -loglevel error \
       -f s16le -ar 24000 -ac 1 -i pipe:0 \
       -c:a libopus -b:a 32k -f ogg pipe:1
     ```
   - Rejects if ffmpeg exits non-zero (stderr captured into the error).

3. **`createTtsApp({ maxChars, synthesize, sendVoice }) → Hono`**
   - Mounts `POST /tts`.
   - zod body: `{ chat_id: number.int(), text: string.min(1).max(maxChars), voice?: string, style?: string }`.
   - Validation/error mapping mirrors `send-file.ts`:
     - bad body / `text` over `maxChars` → **400** (zod `.max`)
     - `synthesize` not available (Gemini key absent) → **503**
     - `synthesize` (Gemini or ffmpeg) throws → **502**
     - `sendVoice` throws → **502**
     - success → **200** `{ ok: true }`
   - `synthesize(text, { voice?, style? }) → Promise<Buffer>` and
     `sendVoice(chatId, buf) → Promise<void>` are injected → endpoint is unit-
     testable with mocks (no real Gemini/ffmpeg), exactly like `send-file`
     mocks `sendDocument`/`sendPhoto`.
   - The "Gemini key absent → 503" case: `index.ts` passes
     `synthesize: undefined` (or a thunk that throws a typed
     `GeminiNotConfigured` error) when `config.geminiApiKey` is unset; the
     endpoint maps that to 503. Chosen approach: pass `synthesize: null` and
     have the route return 503 when it is null.

### Wiring — `src/index.ts`

```ts
import { createTtsApp } from "./tts";
import { synthesizeSpeech, pcmToOggOpus } from "./tts";

const ttsApp = createTtsApp({
  maxChars: config.ttsMaxChars,
  synthesize: config.geminiApiKey
    ? (text, { voice, style }) =>
        synthesizeSpeech(text, {
          voice: voice ?? config.geminiTtsVoice,
          style,
          apiKey: config.geminiApiKey!,
          model: config.geminiTtsModel,
        }).then(pcmToOggOpus)
    : null,
  sendVoice: async (chatId, buf) => {
    await bot.api.sendVoice(chatId, new InputFile(buf, "voice.ogg"));
  },
});
notifyApp.route("/", ttsApp);
```

### Config — `src/config.ts`

Add to the zod env schema and `Config`:

| Env | Type | Default | Notes |
|-----|------|---------|-------|
| `GEMINI_API_KEY` | optional string | — | endpoint 503s if absent; bot still boots |
| `GEMINI_TTS_VOICE` | string | `"Kore"` | default prebuilt voice |
| `GEMINI_TTS_MODEL` | string | `"gemini-2.5-flash-preview-tts"` | flash default |
| `TTS_MAX_CHARS` | coerce number int positive | `1000` | hard cap, over → 400 |

### Bash helper — `send-voice-tg.sh`

Mirror of `send-file-tg.sh`:
- Flags: `--text <str>` (required), `--voice <name>` (optional),
  `--style <str>` (optional).
- Reads `NOTIFY_CHAT_ID` / `NOTIFY_PORT` env (set by the bot container).
- Builds JSON payload (python3 with sed fallback, same as `send-file-tg.sh`).
- `POST http://127.0.0.1:${port}/tts`.
- Exit 0 on HTTP 200, non-zero otherwise; server error body echoed to stderr.

### Docker / deps

- `package.json`: add dependency `@google/genai`.
- `Dockerfile` runtime stage:
  - add `ffmpeg` to the `apt-get install` list.
  - `COPY --chown=bot:bot send-voice-tg.sh ./send-voice-tg.sh` and add it to
    the `chmod +x` line.

### Deploy (Helm) — `deploy/chart/`

- `GEMINI_API_KEY` → secret (alongside `TELEGRAM_BOT_TOKEN` etc.).
- `GEMINI_TTS_VOICE`, `GEMINI_TTS_MODEL`, `TTS_MAX_CHARS` → configmap/values
  with the defaults above. Surface in `values.yaml`.
- Update `create-secrets.sh` to include `GEMINI_API_KEY`.

### Prompt — `prompts/telegram-mode.md`

New section "Sending a voice reply":
- Use **only when the user explicitly asks** for voice («ответь голосом»,
  "say it out loud", "voice please"). Default reply is text.
- Call the helper first, then write the text reply (which doubles as a
  transcript):
  ```bash
  /app/send-voice-tg.sh --text "Короткий ответ голосом."
  /app/send-voice-tg.sh --text "Warm hello" --voice Puck --style "say cheerfully"
  ```
- Keep spoken text concise — hard cap ~1000 chars; longer → the script exits
  non-zero.
- On non-zero exit, fall back to a plain text reply and surface the failure
  ("Couldn't send voice: <stderr>"). Do not silently swallow.

## Testing — `test/tts.test.ts`

Endpoint-level, mocked `synthesize` + `sendVoice` (pattern from
`test/send-file.test.ts`):
- valid body → 200, `sendVoice` called once with `(chat_id, Buffer)`
- `voice` / `style` passed through to `synthesize`
- missing `text` → 400
- `text` over `maxChars` → 400, `synthesize` not called
- `synthesize` throws → 502
- `sendVoice` throws → 502
- `synthesize: null` (key absent) → 503, `sendVoice` not called

`pcmToOggOpus` (thin ffmpeg wrapper): one integration test that feeds a short
silent PCM buffer and asserts the output starts with the OGG magic (`OggS`);
skipped when ffmpeg is not on PATH so CI without ffmpeg stays green.

## Out of scope (YAGNI)

- Auto voice-reply when the user sent a voice message in (roadmap option c) —
  explicit-request-only for now.
- Multiple TTS providers, streaming synthesis, audio caching — would justify a
  `src/tts/` sub-dir later; not now.
- Long-text chunking/splitting — over-cap is rejected, agent shortens.
