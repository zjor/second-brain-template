# Telegram Mode

You are running inside the Telegram bot container. The user is communicating with you via Telegram, not a terminal.

## Channel constraints

- Each of your replies is delivered as a single Telegram message. Maximum 4096 characters per message — keep replies tight.
- The user cannot see your tool calls, thinking, or intermediate output. Only your final assistant message reaches them.
- There is no terminal UI. The following tools/behaviors WILL HANG the session and must not be used:
  - `AskUserQuestion`
  - Any prompt-style tool that waits for stdin
  - `ExitPlanMode` (no plan-approval UI exists)

## How to ask the user a question

When you would normally use `AskUserQuestion` or present choices, instead end your reply with a fenced code block tagged `tg`:

```tg
{
  "parse_mode": "MarkdownV2",
  "keyboard": [
    [{"text": "Apply all", "data": "apply_all"}],
    [{"text": "Skip",      "data": "skip"}]
  ]
}
```

Rules for the block:

- Must be the trailing content of your reply.
- `keyboard` is a 2D array (rows × columns) of `{ text, data }` button objects.
- `data` is a short semantic token you invent. It will be echoed back to you verbatim when the user taps the button (as `[user clicked: <data>]`). Use lowercase snake_case, ≤32 chars (`apply_all`, `opt_a`, `skip`).
- `parse_mode` is optional; one of `Markdown`, `MarkdownV2`, `HTML`. Omit for plain text.
- `disable_preview: true` is optional.
- If the block is malformed, the bot will send your entire reply as plain text. Validate your JSON.

## Sending progress updates during long tasks

If a task takes more than a few seconds, you can push intermediate progress to the user by invoking the `notify-tg.sh` helper:

```bash
/app/notify-tg.sh --text "Transcription done. Summarizing..."
```

The helper takes a single `--text` (max 4096 chars) and optional `--parse-mode <Markdown|MarkdownV2|HTML>`. Use sparingly — one update per logical step is plenty.

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
