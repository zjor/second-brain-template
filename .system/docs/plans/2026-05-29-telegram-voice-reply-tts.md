# Telegram Voice Reply (TTS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the in-container Claude agent reply with a Telegram voice message, synthesized via Google Gemini TTS, invoked as a mid-turn tool on explicit user request.

**Architecture:** Mirror the existing `send-file` capability — a hono sub-app (`POST /tts`) with injected `synthesize`/`sendVoice` deps mounted on the internal localhost server, plus a baked `send-voice-tg.sh` helper the agent calls. Gemini SDK + key stay server-side. Gemini returns PCM; ffmpeg transcodes PCM → OGG/Opus for `bot.api.sendVoice`.

**Tech Stack:** TypeScript (ESM, Node 24), hono, zod, grammy, `@google/genai`, ffmpeg (system), vitest, pnpm.

**Working dir for all paths below:** `.system/services/telegram-bot/`

**Spec:** `.system/docs/specs/2026-05-29-telegram-voice-reply-tts-design.md`

---

## File Structure

- **Create** `src/tts.ts` — three exports: `synthesizeSpeech` (Gemini call), `pcmToOggOpus` (ffmpeg transcode), `createTtsApp` (hono endpoint). One file, matching the flat `src/` convention.
- **Create** `test/tts.test.ts` — endpoint tests w/ mocked deps + one ffmpeg integration test.
- **Create** `send-voice-tg.sh` — baked bash helper, mirror of `send-file-tg.sh`.
- **Modify** `src/config.ts` — add `GEMINI_API_KEY`, `GEMINI_TTS_VOICE`, `GEMINI_TTS_MODEL`, `TTS_MAX_CHARS`.
- **Modify** `test/config.test.ts` — cover new env vars.
- **Modify** `src/index.ts` — wire `createTtsApp` + mount route.
- **Modify** `package.json` — add `@google/genai` dependency.
- **Modify** `Dockerfile` — add `ffmpeg`; copy + chmod `send-voice-tg.sh`.
- **Modify** `prompts/telegram-mode.md` — "Sending a voice reply" section.
- **Modify** `.env.example` — document new env vars.
- **Modify** `ROADMAP.md` — mark Voice reply shipped.

---

## Task 1: Add `@google/genai` dependency

**Files:**
- Modify: `package.json:18-27` (dependencies block)

- [ ] **Step 1: Add the dependency**

In `package.json`, add to `dependencies` (keep alphabetical):

```json
    "@google/genai": "^1.0.0",
```

So the block reads (context):

```json
  "dependencies": {
    "@deepgram/sdk": "^4.0.0",
    "@google/genai": "^1.0.0",
    "@hono/node-server": "^1.13.0",
```

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: lockfile updates, `@google/genai` resolves, exit 0.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "build(telegram-bot): add @google/genai for TTS"
```

---

## Task 2: Extend config with Gemini/TTS env vars

**Files:**
- Modify: `src/config.ts`
- Test: `test/config.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `test/config.test.ts` inside the `describe("loadConfig", ...)` block:

```ts
  it("applies TTS defaults", () => {
    const cfg = loadConfig(baseEnv);
    expect(cfg.geminiApiKey).toBeUndefined();
    expect(cfg.geminiTtsVoice).toBe("Kore");
    expect(cfg.geminiTtsModel).toBe("gemini-2.5-flash-preview-tts");
    expect(cfg.ttsMaxChars).toBe(1000);
  });

  it("overrides TTS vars when provided", () => {
    const cfg = loadConfig({
      ...baseEnv,
      GEMINI_API_KEY: "gm-key",
      GEMINI_TTS_VOICE: "Puck",
      GEMINI_TTS_MODEL: "gemini-2.5-pro-preview-tts",
      TTS_MAX_CHARS: "500",
    });
    expect(cfg.geminiApiKey).toBe("gm-key");
    expect(cfg.geminiTtsVoice).toBe("Puck");
    expect(cfg.geminiTtsModel).toBe("gemini-2.5-pro-preview-tts");
    expect(cfg.ttsMaxChars).toBe(500);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- config`
Expected: FAIL — `cfg.geminiTtsVoice` is `undefined`, etc.

- [ ] **Step 3: Implement**

In `src/config.ts`, add to `envSchema` (after `LOG_LEVEL`):

```ts
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_TTS_VOICE: z.string().default("Kore"),
  GEMINI_TTS_MODEL: z.string().default("gemini-2.5-flash-preview-tts"),
  TTS_MAX_CHARS: z.coerce.number().int().positive().default(1000),
```

Add to the `Config` interface (after `logLevel`):

```ts
  geminiApiKey: string | undefined;
  geminiTtsVoice: string;
  geminiTtsModel: string;
  ttsMaxChars: number;
```

Add to the returned object in `loadConfig` (after `logLevel: parsed.LOG_LEVEL,`):

```ts
    geminiApiKey: parsed.GEMINI_API_KEY,
    geminiTtsVoice: parsed.GEMINI_TTS_VOICE,
    geminiTtsModel: parsed.GEMINI_TTS_MODEL,
    ttsMaxChars: parsed.TTS_MAX_CHARS,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- config`
Expected: PASS (all config tests).

- [ ] **Step 5: Commit**

```bash
git add src/config.ts test/config.test.ts
git commit -m "feat(telegram-bot): add Gemini/TTS config vars"
```

---

## Task 3: TTS endpoint `createTtsApp` (TDD)

**Files:**
- Create: `src/tts.ts`
- Test: `test/tts.test.ts`

This task implements only the endpoint + its exported types. `synthesizeSpeech` and `pcmToOggOpus` are added in Task 4; the endpoint depends only on injected `synthesize`/`sendVoice`, so it is fully testable now.

- [ ] **Step 1: Write the failing tests**

Create `test/tts.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createTtsApp, type TtsAppDeps } from "../src/tts";

function makeDeps(overrides: Partial<TtsAppDeps> = {}): TtsAppDeps {
  return {
    maxChars: 1000,
    synthesize: vi.fn().mockResolvedValue(Buffer.from("OGGDATA")),
    sendVoice: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function post(app: ReturnType<typeof createTtsApp>, payload: unknown) {
  return app.request("/tts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("tts app", () => {
  it("synthesizes and sends a voice message for valid input", async () => {
    const deps = makeDeps();
    const app = createTtsApp(deps);
    const res = await post(app, { chat_id: 42, text: "Привет" });

    expect(res.status).toBe(200);
    expect(deps.synthesize).toHaveBeenCalledWith("Привет", { voice: undefined, style: undefined });
    expect(deps.sendVoice).toHaveBeenCalledTimes(1);
    const call = (deps.sendVoice as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe(42);
    expect((call[1] as Buffer).equals(Buffer.from("OGGDATA"))).toBe(true);
  });

  it("passes voice and style through to synthesize", async () => {
    const deps = makeDeps();
    const app = createTtsApp(deps);
    const res = await post(app, { chat_id: 1, text: "Hi", voice: "Puck", style: "say cheerfully" });

    expect(res.status).toBe(200);
    expect(deps.synthesize).toHaveBeenCalledWith("Hi", { voice: "Puck", style: "say cheerfully" });
  });

  it("rejects missing text with 400", async () => {
    const deps = makeDeps();
    const app = createTtsApp(deps);
    const res = await post(app, { chat_id: 1 });
    expect(res.status).toBe(400);
    expect(deps.synthesize).not.toHaveBeenCalled();
  });

  it("rejects empty text with 400", async () => {
    const deps = makeDeps();
    const app = createTtsApp(deps);
    const res = await post(app, { chat_id: 1, text: "" });
    expect(res.status).toBe(400);
    expect(deps.synthesize).not.toHaveBeenCalled();
  });

  it("rejects text over maxChars with 400", async () => {
    const deps = makeDeps({ maxChars: 10 });
    const app = createTtsApp(deps);
    const res = await post(app, { chat_id: 1, text: "x".repeat(11) });
    expect(res.status).toBe(400);
    expect(deps.synthesize).not.toHaveBeenCalled();
  });

  it("returns 503 when synthesize is null (Gemini not configured)", async () => {
    const deps = makeDeps({ synthesize: null });
    const app = createTtsApp(deps);
    const res = await post(app, { chat_id: 1, text: "Hi" });
    expect(res.status).toBe(503);
    expect(deps.sendVoice).not.toHaveBeenCalled();
  });

  it("returns 502 when synthesize throws", async () => {
    const deps = makeDeps({ synthesize: vi.fn().mockRejectedValue(new Error("gemini down")) });
    const app = createTtsApp(deps);
    const res = await post(app, { chat_id: 1, text: "Hi" });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("gemini down");
    expect(deps.sendVoice).not.toHaveBeenCalled();
  });

  it("returns 502 when sendVoice throws", async () => {
    const deps = makeDeps({ sendVoice: vi.fn().mockRejectedValue(new Error("network down")) });
    const app = createTtsApp(deps);
    const res = await post(app, { chat_id: 1, text: "Hi" });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("network down");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tts`
Expected: FAIL — `src/tts.ts` does not exist / `createTtsApp` not exported.

- [ ] **Step 3: Implement the endpoint**

Create `src/tts.ts` (endpoint + types only for now):

```ts
import { Hono } from "hono";
import { z } from "zod";

export interface SynthesizeOpts {
  voice?: string;
  style?: string;
}

export interface TtsAppDeps {
  maxChars: number;
  /** null when Gemini is not configured → endpoint returns 503 */
  synthesize: ((text: string, opts: SynthesizeOpts) => Promise<Buffer>) | null;
  sendVoice: (chatId: number, buf: Buffer) => Promise<void>;
}

function log(level: string, event: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, event, ...extra }));
}

export function createTtsApp(deps: TtsAppDeps) {
  const body = z.object({
    chat_id: z.number().int(),
    text: z.string().min(1).max(deps.maxChars),
    voice: z.string().min(1).optional(),
    style: z.string().min(1).optional(),
  });

  const app = new Hono();
  app.post("/tts", async (c) => {
    const raw = await c.req.json().catch(() => null);
    const parsed = body.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    if (!deps.synthesize) {
      log("warn", "tts_not_configured");
      return c.json({ error: "tts_not_configured" }, 503);
    }

    const { chat_id, text, voice, style } = parsed.data;

    let buf: Buffer;
    try {
      buf = await deps.synthesize(text, { voice, style });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log("error", "tts_synthesize_failed", { msg });
      return c.json({ error: msg }, 502);
    }

    try {
      await deps.sendVoice(chat_id, buf);
      return c.json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log("error", "tts_send_failed", { msg });
      return c.json({ error: msg }, 502);
    }
  });

  return app;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tts`
Expected: PASS (8 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/tts.ts test/tts.test.ts
git commit -m "feat(telegram-bot): add /tts endpoint with DI"
```

---

## Task 4: Gemini synthesis + ffmpeg transcode

**Files:**
- Modify: `src/tts.ts` (append two exports)
- Test: `test/tts.test.ts` (append integration test)

- [ ] **Step 1: Write the failing integration test for `pcmToOggOpus`**

Append to `test/tts.test.ts`:

```ts
import { execSync } from "node:child_process";
import { pcmToOggOpus } from "../src/tts";

function ffmpegAvailable(): boolean {
  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("pcmToOggOpus", () => {
  it.skipIf(!ffmpegAvailable())("transcodes PCM to an OGG container", async () => {
    // 0.1s of silence: 24000 Hz * 0.1s * 2 bytes (s16le) mono.
    const pcm = Buffer.alloc(24000 * 0.1 * 2);
    const ogg = await pcmToOggOpus(pcm);
    expect(ogg.length).toBeGreaterThan(0);
    // OGG files start with the "OggS" magic.
    expect(ogg.subarray(0, 4).toString("latin1")).toBe("OggS");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- tts`
Expected: FAIL — `pcmToOggOpus` not exported (or test skipped if no ffmpeg; in that case proceed — implementation still required for runtime).

- [ ] **Step 3: Implement both functions**

Append to `src/tts.ts`:

```ts
import { spawn } from "node:child_process";
import { GoogleGenAI, Modality } from "@google/genai";

export interface SpeechOpts {
  voice: string;
  style?: string;
  apiKey: string;
  model: string;
}

/** Call Gemini TTS; returns raw PCM (s16le, 24kHz, mono). */
export async function synthesizeSpeech(text: string, opts: SpeechOpts): Promise<Buffer> {
  const ai = new GoogleGenAI({ apiKey: opts.apiKey });
  const prompt = opts.style ? `${opts.style}: ${text}` : text;
  const resp = await ai.models.generateContent({
    model: opts.model,
    contents: [{ parts: [{ text: prompt }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: opts.voice } },
      },
    },
  });
  const data = resp.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!data) throw new Error("Gemini returned no audio");
  return Buffer.from(data, "base64");
}

/** Transcode raw PCM (s16le, 24kHz, mono) to OGG/Opus via ffmpeg. No temp files. */
export function pcmToOggOpus(pcm: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", [
      "-hide_banner", "-loglevel", "error",
      "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", "pipe:0",
      "-c:a", "libopus", "-b:a", "32k", "-f", "ogg", "pipe:1",
    ]);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    ff.stdout.on("data", (d: Buffer) => out.push(d));
    ff.stderr.on("data", (d: Buffer) => err.push(d));
    ff.on("error", reject);
    ff.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`ffmpeg exited ${code}: ${Buffer.concat(err).toString()}`));
    });
    ff.stdin.on("error", () => { /* ignore EPIPE if ffmpeg dies early */ });
    ff.stdin.write(pcm);
    ff.stdin.end();
  });
}
```

Note: keep these `import` lines at the **top** of the file with the existing imports if your linter requires it — moving `import { spawn }` and `import { GoogleGenAI, Modality }` up to join the hono/zod imports is fine. Functionally identical.

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm test -- tts`
Expected: PASS (endpoint tests pass; `pcmToOggOpus` test passes if ffmpeg present, else skipped).

Run: `pnpm typecheck`
Expected: no errors. (If `responseModalities`/`speechConfig` type-mismatch, confirm `@google/genai` version exposes `Modality` enum; pin a version that does.)

- [ ] **Step 5: Commit**

```bash
git add src/tts.ts test/tts.test.ts
git commit -m "feat(telegram-bot): Gemini synthesis + ffmpeg PCM→Opus"
```

---

## Task 5: Wire the endpoint into the server

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add imports**

In `src/index.ts`, after the existing `import { createSendFileApp } from "./send-file";` line, add:

```ts
import { createTtsApp, synthesizeSpeech, pcmToOggOpus } from "./tts";
```

- [ ] **Step 2: Construct and mount the app**

In `src/index.ts`, after the `notifyApp.route("/", sendFileApp);` line (currently line 61), add:

```ts
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

(`InputFile` is already imported at the top of `index.ts`.)

- [ ] **Step 3: Typecheck + build**

Run: `pnpm typecheck && pnpm run build`
Expected: no errors, `dist/` builds.

- [ ] **Step 4: Run full test suite**

Run: `pnpm test`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat(telegram-bot): mount /tts on the internal server"
```

---

## Task 6: `send-voice-tg.sh` helper

**Files:**
- Create: `send-voice-tg.sh`

- [ ] **Step 1: Create the script**

Create `send-voice-tg.sh`:

```bash
#!/usr/bin/env bash
# send-voice-tg.sh — synthesize text to speech (Gemini) and deliver it to the
# Telegram user as a voice message, via the bot's /tts endpoint.
# Usage:
#   send-voice-tg.sh --text "Короткий ответ голосом."
#   send-voice-tg.sh --text "Warm hello" --voice Puck --style "say cheerfully"
#
# Required env vars (set automatically by the bot container):
#   NOTIFY_PORT     — defaults to 8080
#   NOTIFY_CHAT_ID  — the Telegram chat id to message
#
# Exit 0 on HTTP 200, non-zero otherwise. Server error body echoed to stderr.

set -euo pipefail

text=""
voice=""
style=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --text)   text="$2";  shift 2 ;;
    --voice)  voice="$2"; shift 2 ;;
    --style)  style="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$text" ]]; then
  echo "--text <string> is required" >&2
  exit 2
fi

if [[ -z "${NOTIFY_CHAT_ID:-}" ]]; then
  echo "NOTIFY_CHAT_ID env var is not set" >&2
  exit 2
fi

port="${NOTIFY_PORT:-8080}"

export TEXT_ARG="$text"
export VOICE="$voice"
export STYLE="$style"

payload=$(python3 -c '
import json, os
d = {
  "chat_id": int(os.environ["NOTIFY_CHAT_ID"]),
  "text": os.environ["TEXT_ARG"],
}
if os.environ.get("VOICE"):
    d["voice"] = os.environ["VOICE"]
if os.environ.get("STYLE"):
    d["style"] = os.environ["STYLE"]
print(json.dumps(d))
' 2>/dev/null) || {
  # Python fallback: hand-roll JSON (string fields escaped naively)
  esc_text=$(printf '%s' "$text" | sed 's/\\/\\\\/g; s/"/\\"/g')
  payload="{\"chat_id\":${NOTIFY_CHAT_ID},\"text\":\"${esc_text}\""
  if [[ -n "$voice" ]]; then
    esc_voice=$(printf '%s' "$voice" | sed 's/\\/\\\\/g; s/"/\\"/g')
    payload="${payload},\"voice\":\"${esc_voice}\""
  fi
  if [[ -n "$style" ]]; then
    esc_style=$(printf '%s' "$style" | sed 's/\\/\\\\/g; s/"/\\"/g')
    payload="${payload},\"style\":\"${esc_style}\""
  fi
  payload="${payload}}"
}

resp=$(mktemp)
trap 'rm -f "$resp"' EXIT

http_code=$(curl -s -o "$resp" -w "%{http_code}" \
  -X POST "http://127.0.0.1:${port}/tts" \
  -H "content-type: application/json" \
  -d "$payload")

if [[ "$http_code" != "200" ]]; then
  echo "send-voice-tg.sh: HTTP $http_code" >&2
  cat "$resp" >&2 || true
  exit 1
fi
```

- [ ] **Step 2: Make executable + smoke-check syntax**

Run: `chmod +x send-voice-tg.sh && bash -n send-voice-tg.sh`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add send-voice-tg.sh
git commit -m "feat(telegram-bot): add send-voice-tg.sh helper"
```

---

## Task 7: Docker image — ffmpeg + helper

**Files:**
- Modify: `Dockerfile:29-31` (runtime apt-get), `:45-46` (copy + chmod)

- [ ] **Step 1: Add ffmpeg to the runtime apt-get**

In `Dockerfile`, change the runtime-stage install (currently lines 29-31) to include `ffmpeg`:

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
    git openssh-client ca-certificates curl python3 ffmpeg \
    && rm -rf /var/lib/apt/lists/*
```

- [ ] **Step 2: Copy + chmod the helper**

In `Dockerfile`, after the `COPY --chown=bot:bot send-file-tg.sh ./send-file-tg.sh` line, add:

```dockerfile
COPY --chown=bot:bot send-voice-tg.sh ./send-voice-tg.sh
```

And update the chmod line to include it:

```dockerfile
RUN chmod +x /app/notify-tg.sh /app/send-file-tg.sh /app/send-voice-tg.sh
```

- [ ] **Step 3: Build the image**

Run: `docker build -t telegram-brain-bot:tts-test .`
Expected: build succeeds; `ffmpeg` installs; both COPY + chmod succeed.

- [ ] **Step 4: Verify ffmpeg + helper inside the image**

Run: `docker run --rm --entrypoint sh telegram-brain-bot:tts-test -c "ffmpeg -version >/dev/null && test -x /app/send-voice-tg.sh && echo OK"`
Expected: prints `OK`.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile
git commit -m "build(telegram-bot): add ffmpeg + send-voice-tg.sh to image"
```

---

## Task 8: Prompt documentation

**Files:**
- Modify: `prompts/telegram-mode.md`

- [ ] **Step 1: Add the voice-reply section**

In `prompts/telegram-mode.md`, after the "Sending files back to user" section (ends ~line 119, before "## Skill adaptation"), insert:

````markdown
## Sending a voice reply

When the user **explicitly asks** for a spoken/voice reply («ответь голосом»,
"say it out loud", "voice please"), synthesize your answer to a Telegram voice
message with the `send-voice-tg.sh` helper. Default replies stay text — only
use this on explicit request.

```bash
/app/send-voice-tg.sh --text "Короткий ответ голосом."
/app/send-voice-tg.sh --text "Warm hello" --voice Puck --style "say cheerfully"
```

Flags:

- `--text "..."` — required. The text to speak. Keep it concise — hard cap
  ~1000 chars; longer is rejected.
- `--voice <name>` — optional Gemini prebuilt voice (e.g. `Kore`, `Puck`).
  Omit to use the bot's default voice.
- `--style "..."` — optional natural-language delivery hint
  (e.g. `"say slowly and warmly"`).

Rules:

- Send the voice via the script FIRST, then write your text reply in the same
  turn. The text reply doubles as a transcript so the user can read along.
- Write the spoken text conversationally — it will be heard, not read.
- If the script exits non-zero, fall back to a normal text reply and surface
  the failure ("Couldn't send voice: <stderr>"). Do not silently swallow.
- If voice is not configured on this deployment, the script returns an error —
  just reply with text.
````

- [ ] **Step 2: Commit**

```bash
git add prompts/telegram-mode.md
git commit -m "docs(telegram-bot): document voice reply in telegram-mode prompt"
```

---

## Task 9: Env docs + roadmap

**Files:**
- Modify: `.env.example`
- Modify: `ROADMAP.md:31`

- [ ] **Step 1: Document new env vars**

Append to `.env.example` (read the file first to match its existing comment style):

```
# --- Voice reply (TTS via Google Gemini) ---
# Optional. If GEMINI_API_KEY is unset, the /tts endpoint returns 503 and the
# bot still boots normally (voice replies just unavailable).
GEMINI_API_KEY=
GEMINI_TTS_VOICE=Kore
GEMINI_TTS_MODEL=gemini-2.5-flash-preview-tts
TTS_MAX_CHARS=1000
```

> Deploy note: these flow into the running pod via the env Secret created by
> `deploy/scripts/create-secrets.sh` from `.env.production` (`--from-env-file`).
> No Helm template change is needed — add the same keys to `.env.production`
> before running `create-secrets.sh`.

- [ ] **Step 2: Mark the roadmap item shipped**

In `ROADMAP.md`, change line 31 from:

```
### [ ] Voice reply (TTS)
```

to:

```
### [x] Voice reply (TTS)
```

- [ ] **Step 3: Commit**

```bash
git add .env.example ROADMAP.md
git commit -m "docs(telegram-bot): document TTS env vars, mark roadmap shipped"
```

---

## Final verification

- [ ] **Run the full suite + typecheck + build**

Run: `pnpm test && pnpm typecheck && pnpm run build`
Expected: all tests pass, no type errors, `dist/` builds.

- [ ] **Manual end-to-end (optional, requires a real GEMINI_API_KEY)**

With a valid `GEMINI_API_KEY` in `.env.local`, run the bot (`pnpm dev`), then
from a Telegram chat ask "ответь голосом: расскажи о погоде" and confirm a
voice message arrives followed by the text transcript.

---

## Notes for the implementer

- **Pattern source of truth:** `src/send-file.ts` + `test/send-file.test.ts` —
  the `/tts` endpoint mirrors their validation/error-mapping/DI shape. When in
  doubt, match those.
- **No temp files:** audio stays in `Buffer`s end-to-end (Gemini base64 → PCM
  Buffer → ffmpeg stdin/stdout → OGG Buffer → grammy `InputFile`).
- **`@google/genai` version:** the code uses `Modality.AUDIO` and
  `speechConfig.voiceConfig.prebuiltVoiceConfig`. If `pnpm typecheck` flags
  these, bump to a `@google/genai` release that exposes them and re-run Task 1.
- **ffmpeg only at runtime:** it is a system binary in the image, not an npm
  dep. Unit tests mock `synthesize`, so they need no ffmpeg; only the one
  `pcmToOggOpus` integration test does (auto-skipped when absent).
