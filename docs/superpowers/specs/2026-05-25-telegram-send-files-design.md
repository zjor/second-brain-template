---
created: 2026-05-25
status: active
tags: [telegram-bot, design]
---

# Telegram Bot — Send Files Back to User

## Goal

Allow Claude (running inside the Telegram bot container) to deliver files from
the brain repo back to the user through Telegram. Use case: user asks
"send me that receipt from May", Claude finds the file under
`inbox/files/` or `archive/` and pushes it.

Out of scope (separate roadmap items): generated artifacts created on the fly,
voice/TTS replies, photos as the primary reply medium (file is always a
side-channel push; the text reply remains the main message).

## Trigger Model

**Push via helper script**, mirroring the existing `notify-tg.sh` pattern.

Claude invokes `/app/send-file-tg.sh` mid-turn via Bash. The script POSTs to
the bot's localhost-only HTTP server, which calls `bot.api.sendDocument` or
`bot.api.sendPhoto`. The file arrives as a separate Telegram message; Claude
still writes a text reply in the same turn.

Rejected alternatives:
- Declarative `tg`-block field — would couple file send to reply lifecycle and
  limit to one file per turn.
- Hybrid — two code paths for one feature; not justified for the current scope.

## HTTP Routes

Single Hono server bound to `127.0.0.1:${NOTIFY_PORT}` (default 8080):

| Method | Path         | Handler module      | Behavior                                   |
|--------|--------------|---------------------|--------------------------------------------|
| POST   | `/notify`    | `src/notify.ts`     | Text message via `bot.api.sendMessage`     |
| POST   | `/send-file` | `src/send-file.ts`  | File via `sendDocument` or `sendPhoto`     |

Each factory declares its full absolute path internally (mirrors the
existing `notify.ts` style — `app.post("/notify", ...)` inside the
factory, not `app.post("/", ...)` mounted under a prefix). Composition in
`src/index.ts`:

```ts
const notifyApp   = createNotifyApp({ ... });    // owns POST /notify
const sendFileApp = createSendFileApp({ ... });  // owns POST /send-file
notifyApp.route("/", sendFileApp);               // merge at root
serve({ fetch: notifyApp.fetch, hostname: "127.0.0.1", port: config.notifyPort });
```

Single `serve()`, single port, no collision (paths are disjoint).

## Components

### New files

#### `.system/services/telegram-bot/src/send-file.ts`

Hono route factory `createSendFileApp(deps)`.

Route: `POST /send-file`

Zod schema:
```ts
{
  chat_id: number (int),
  path: string (non-empty),
  kind: "document" | "photo",
  caption?: string (max 1024 chars),
  parse_mode?: "Markdown" | "MarkdownV2" | "HTML"
}
```

Dependencies (injected for testability):
```ts
interface SendFileDeps {
  brainRoot: string; // "/data/brain" in prod
  sendDocument: (chatId: number, buf: Buffer, filename: string,
    opts: { caption?: string; parse_mode?: "MarkdownV2" | "HTML" }) => Promise<void>;
  sendPhoto: (chatId: number, buf: Buffer, filename: string,
    opts: { caption?: string; parse_mode?: "MarkdownV2" | "HTML" }) => Promise<void>;
}
```

Flow inside the route:
1. Zod parse → 400 on bad shape.
2. `realpathSync(path)` → 404 on ENOENT / bad symlink.
3. Containment check: resolved path must start with `brainRoot + "/"`.
   Reject with 403 otherwise (blocks `/data/brain-evil` and symlink escapes).
4. `statSync(resolved).isFile()` → 404 if directory, socket, etc.
5. Size cap by kind:
   - `kind: "document"` → 50 MB.
   - `kind: "photo"` → 10 MB.
   - Over → 413.
6. `readFileSync(resolved)` into Buffer (atomic snapshot vs concurrent
   git pull).
7. Caption parse_mode handling: default and "Markdown" / "MarkdownV2"
   converted via `telegramify-markdown` (escape mode → MarkdownV2);
   "HTML" passed through. Inline a small helper inside `send-file.ts`
   (≈6 lines) — do **not** extract a shared module or change `notify.ts`
   behavior in this work. `notify.ts` passthrough stays as-is.
8. Call `sendDocument` or `sendPhoto` per `kind`, with
   `basename(resolved)` as filename.
9. 200 `{ok: true}` on success; 502 + log `send_file_failed` on Telegram
   error.

#### `.system/services/telegram-bot/send-file-tg.sh`

Bash helper, mirrors `notify-tg.sh` structure.

```
send-file-tg.sh --document <abs-path> [--caption "..."] [--parse-mode MarkdownV2|HTML]
send-file-tg.sh --photo    <abs-path> [--caption "..."] [--parse-mode MarkdownV2|HTML]
```

- `--document` and `--photo` are mutually exclusive; exactly one required.
- Caption optional.
- Reads `NOTIFY_CHAT_ID`, `NOTIFY_PORT` from env (same env the bot sets when
  spawning Claude — see `claude.ts:55-57`).
- Builds payload with python3 (with bash fallback for JSON-escaping caption),
  POSTs to `http://127.0.0.1:${NOTIFY_PORT}/send-file`.
- Exit 0 on HTTP 200, 1 otherwise. Server error body echoed to stderr.

#### `.system/services/telegram-bot/test/send-file.test.ts`

Vitest unit tests with mocked `sendDocument` / `sendPhoto` and a `tmpdir`
sandbox passed as `brainRoot`. Cases:

1. happy path — document.
2. happy path — photo.
3. bad shape (missing `path`) → 400.
4. path outside `brainRoot` → 403, no API call.
5. symlink whose target escapes `brainRoot` → 403.
6. nonexistent path → 404.
7. directory path → 404.
8. document > 50 MB → 413.
9. photo > 10 MB → 413.
10. caption > 1024 chars → 400.
11. Telegram API throws → 502; assert error logged.

No live Telegram integration test (matches `notify.ts` policy). Manual smoke
post-deploy.

### Modified files

#### `src/index.ts`

After creating `notifyApp`, create `sendFileApp` and mount its routes onto
the same Hono instance via `notifyApp.route("/", sendFileApp)`. Single
`serve()` call still owns the port.

```ts
const sendFileApp = createSendFileApp({
  brainRoot: BRAIN_CWD, // "/data/brain"
  sendDocument: (chatId, buf, name, opts) =>
    bot.api.sendDocument(chatId, new InputFile(buf, name), opts),
  sendPhoto: (chatId, buf, name, opts) =>
    bot.api.sendPhoto(chatId, new InputFile(buf, name), opts),
});
notifyApp.route("/", sendFileApp);
```

Keep server bound to `127.0.0.1` — endpoint is in-container only, same as
`/notify`. No allowlist check inside the route.

#### `Dockerfile`

Add `COPY send-file-tg.sh /app/send-file-tg.sh` + `chmod +x` alongside
existing `notify-tg.sh`.

#### `prompts/telegram-mode.md`

Insert new section "Sending files back to user" after "Sending progress
updates during long tasks". Content:

- When to use: user asks for a file already in the brain repo.
- Helper: `/app/send-file-tg.sh`.
- Flags + two examples (`--document` for arbitrary file with filename
  preserved, `--photo` for inline-rendered JPEG/PNG).
- Path rule: absolute paths inside `/data/brain` only.
- Caption limit: 1024 chars (NOT 4096 like text body).
- Pattern: call script first, then write text reply that references the
  file. User sees file message followed by text message.
- Failure: if script exits non-zero, surface failure in text reply
  ("Couldn't send file: <stderr>"), don't silently swallow.

#### `ROADMAP.md`

Mark "Send files from bot to user" as `[x]`.

## Data Flow

```
Claude turn:
  Bash: /app/send-file-tg.sh --document /data/brain/inbox/files/may-receipt.pdf --caption "May receipt"
    ↓
  send-file-tg.sh: builds JSON, POST http://127.0.0.1:${NOTIFY_PORT}/send-file
    ↓
  src/send-file.ts:
    Zod parse → realpath → containment → isFile → size cap → readFileSync → sendDocument
    ↓
  Telegram: delivers document message
    ↓
  Claude continues turn, emits text reply via stdout
    ↓
  handleUserTurn() in bot.ts delivers text reply as second message
```

## Errors

| Condition | HTTP | Script exit |
|-----------|------|-------------|
| Bad JSON / Zod fail / caption > 1024 | 400 | 1 |
| Path outside brainRoot / symlink escape | 403 | 1 |
| File missing / not a regular file | 404 | 1 |
| Size cap exceeded | 413 | 1 |
| Telegram API error | 502 | 1 |
| Success | 200 | 0 |

Server logs `send_file_failed` JSON-line with `path`, `kind`, `msg` on any
non-200.

## Security

- Endpoint binds to `127.0.0.1` only (existing `serve()` config in
  `index.ts:50-54`).
- `realpath` + prefix check defeats `../` traversal, symlink escapes, and
  prefix tricks like `/data/brain-evil/secret`.
- Path scope: `/data/brain` only. Blocks `/app`, `/etc`, `/home`, `/tmp`,
  bot SQLite DB at `/data/db`, SSH key in `/home`.
- No auth needed on the route — caller is already inside the container.

## Testing Strategy

- Unit tests cover validation + happy paths against mocked grammy API
  (see `test/send-file.test.ts` cases above).
- Manual smoke after deploy: ask the bot via Telegram for a known file
  (e.g. "send me a recent inbox file"); verify file arrives and
  caption renders.
- No live Telegram test in CI (no token; matches existing policy).

## Open Items

None. All decisions captured above.
