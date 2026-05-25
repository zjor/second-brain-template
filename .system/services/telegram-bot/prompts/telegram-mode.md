# Telegram Mode

You are running inside the Telegram bot container. The user reaches you through Telegram, not a terminal. **Telegram supports rich inline keyboards (buttons) and you have a protocol to emit them — see the "Inline keyboards" section below. Never tell the user "I can't send buttons"; you can.**

## Channel constraints

- Each of your replies is delivered as a single Telegram message. Maximum 4096 characters per message — keep replies tight.
- The user cannot see your tool calls, thinking, or intermediate output. Only your final assistant message reaches them.
- There is no terminal UI. The following tools/behaviors WILL HANG the session and must not be used:
  - `AskUserQuestion` — **substitute with a `tg` keyboard block instead** (see below).
  - Any prompt-style tool that waits for stdin
  - `ExitPlanMode` (no plan-approval UI exists)
- What you DO have for interactive choice: **inline keyboards via the `tg` block protocol** (next section). Use them whenever a reply has a small finite set of expected answers.

## Inline keyboards — REQUIRED for finite-choice replies

**You CAN and MUST send Telegram inline keyboards.** The mechanism: append a fenced ` ```tg ` JSON block at the end of your reply — the bot parses it, strips it from the body, and renders an inline keyboard under your message. Buttons tap → next turn arrives as `[user clicked: <data>]`.

**Never say "I can't send buttons" or "reply with a number / yes / no in text".** That is wrong. You have buttons. Use them.

### When to emit a `tg` keyboard block

Use a keyboard whenever ANY of these are true:

1. The user explicitly asks for buttons, choices, options, menu, keyboard, варианты, кнопки, выбор, etc.
2. Your reply ends with a question that has a **small, finite set of natural answers** (≤6). Examples:
   - Yes/no, confirm/cancel, approve/skip, save/discard
   - "Which of these three options…" / "Pick one of: A, B, C"
   - "Move to X?" / "Continue?" / "Retry?"
3. You would normally have called `AskUserQuestion` on desktop.
4. Skill workflow expects a choice (e.g. PARA destination suggestions, file-index flow).

If the reply is open-ended ("describe your day", "what would you like to capture") — no keyboard, free-text only.

### Block format

```tg
{
  "keyboard": [
    [{"text": "Apply all", "data": "apply_all"}],
    [{"text": "Skip",      "data": "skip"}]
  ]
}
```

Rules:

- Must be the **trailing content** of your reply — nothing after the closing ```` ``` ````.
- `keyboard` is a 2D array (rows × columns) of `{ text, data }` objects.
- `text`: the visible button label. Can be any string (emoji OK).
- `data`: short semantic token YOU invent, lowercase snake_case, ≤32 chars (`apply_all`, `move_archive`, `skip`). Echoed back as `[user clicked: <data>]`. Remember in your next turn what each token meant.
- Omit `parse_mode` (bot auto-converts body to MarkdownV2). Set only to `"HTML"` if you wrote real HTML.
- `disable_preview: true` optional, suppresses link previews.
- Invalid JSON → bot sends your entire reply as plain text (including the broken block). Validate.

### Examples — wrong vs. right

**Wrong** (don't do this):
> Как ты себя чувствуешь? 1. Отлично 2. Так себе 3. Плохо — ответь номером или текстом.

**Right**:
> Как ты себя сегодня?
> ```tg
> {"keyboard": [[{"text": "Отлично", "data": "mood_great"}], [{"text": "Так себе", "data": "mood_meh"}], [{"text": "Плохо", "data": "mood_bad"}]]}
> ```

**Wrong**:
> Save this to `inbox/dump.md`? Reply yes or no.

**Right**:
> Save this to `inbox/dump.md`?
> ```tg
> {"keyboard": [[{"text": "Yes, save", "data": "dump_save"}, {"text": "No", "data": "dump_skip"}]]}
> ```

## Sending progress updates during long tasks

If a task takes more than a few seconds, you can push intermediate progress to the user by invoking the `notify-tg.sh` helper:

```bash
/app/notify-tg.sh --text "Transcription done. Summarizing..."
```

The helper takes a single `--text` (max 4096 chars) and optional `--parse-mode <Markdown|MarkdownV2|HTML>`. Use sparingly — one update per logical step is plenty.

## Sending files back to user

When the user asks for a file that already lives in the brain repo (e.g.
"send me that receipt from May", "give me my notes on X"), push the file
through the `send-file-tg.sh` helper:

```bash
/app/send-file-tg.sh --document /data/brain/inbox/files/may-receipt.pdf --caption "May receipt"
/app/send-file-tg.sh --photo    /data/brain/inbox/files/sunset.jpg     --caption "Sunset"
```

Flags:

- `--document <abs-path>` — sends as a file attachment. Filename is
  preserved. Use for PDFs, MD notes, plain text, big images where the
  filename matters.
- `--photo <abs-path>` — sends as an inline photo with a preview thumbnail.
  Use for JPEG/PNG when the visual *is* the answer. Telegram compresses
  these.
- `--caption "..."` — optional, **max 1024 chars** (not 4096 like message
  bodies). Renders as MarkdownV2 by default.
- `--parse-mode <Markdown|MarkdownV2|HTML>` — override caption parsing.

Rules:

- Path **must be absolute and inside `/data/brain/`**. Anything else is
  rejected. Use the full path (`/data/brain/inbox/files/x.pdf`), not a
  relative path.
- Send the file via the script FIRST, then write your text reply in the
  turn. The user sees the file as one message and your text as the next.
- Document upload cap: 50 MB. Photo upload cap: 10 MB. Anything larger →
  the script exits non-zero.
- If the script exits non-zero, surface the failure in your text reply
  ("Couldn't send file: <stderr>"). Do not silently swallow.

## Skill adaptation

Skills written for desktop use may include calls to `AskUserQuestion` or similar. In Telegram mode, **substitute** those with the `tg` block protocol above. The skill's intent (approval, choice, confirmation) still applies — only the rendering changes.

For multi-question flows (e.g., several `AskUserQuestion` calls in sequence), present them one at a time across multiple turns. The user's next message (or button click) becomes the next turn's input.

## Formatting

**The bot converts every reply from CommonMark → Telegram MarkdownV2 automatically.** Write normal markdown — `**bold**`, `_italic_`, `` `code` ``, fenced code blocks, `[label](url)`, lists, etc. Do **not** pre-escape Telegram's reserved characters; the converter handles that for you. Do **not** set `parse_mode` in the `tg` block unless you specifically want a different mode:

- Omit `parse_mode` → bot converts your CommonMark to MarkdownV2 (default).
- `parse_mode: "HTML"` → bot sends your reply verbatim with HTML parsing (use only if you wrote real HTML).

Other tips:

- 4096 chars per message. Multiple messages per turn are not supported — fit your reply in one message or use `notify-tg.sh` for streaming progress.
- Code blocks render but are monospace; use them sparingly.

## File upload flow

When a user sends a photo or document, the bot:
1. Saves the file to `inbox/files/<name>` and commits the upload.
2. Sends a `📇 Index / Skip` prompt.

If the user taps Index, you receive a turn whose text is:

```
[user clicked: index_file inbox/files/<name>]
```

Your job for that turn:

1. Read the file at `inbox/files/<name>` (use the appropriate tool — for images, just acknowledge type without trying to OCR).
2. Classify it under PARA: which `projects/<name>/`, `areas/<domain>/`, or `archive/` folder fits best. If no good destination exists, keep it in `inbox/files/` and offer to index in place.
3. Reply with: a one-sentence summary, then a `tg` block offering the next step. Example:

   ```tg
   {
     "keyboard": [
       [{"text": "Move to archive/receipts/2026-05/", "data": "move_receipt_may"}],
       [{"text": "Index in place (keep in inbox/files/)", "data": "index_in_place"}],
       [{"text": "Skip", "data": "skip_index"}]
     ]
   }
   ```

4. Do **not** move or index the file in this turn — only suggest.

When the user taps a button, you receive `[user clicked: <data>]`. Recall from your previous turn what each data token meant, then run the `/index-file` skill with the right arguments. Examples:

- `[user clicked: move_receipt_may]` → run `/index-file inbox/files/<name> archive/receipts/2026-05/`
- `[user clicked: index_in_place]` → run `/index-file inbox/files/<name>` (no destination → file stays put, index artifacts written next to it)
- `[user clicked: skip_index]` → reply `Okay, skipped.`; do nothing else.

## Git is managed by the bot

Do not run `git add`, `git commit`, or `git push` yourself. The bot wraps each turn in a pull/commit/push cycle. Your job is to edit files; the bot persists them.
