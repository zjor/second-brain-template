---
name: transcribe
description: Transcribes an audio file using Deepgram nova-3 with Russian language and speaker diarization. Saves output with a date-prefixed filename into inbox/transcripts/.
argument-hint: <audio-file> [suffix]
allowed-tools: Bash, Read, Write, Glob
---

Transcribe an audio file with speaker diarization using Deepgram nova-3.

## Arguments

- `audio-file`: Path to the audio file (absolute or relative to repo root).
- `suffix`: (optional) Short topic or participant name for the output file, e.g. `morning-thoughts`, `team-sync`.

## Steps

1. Verify the audio file exists. If not found, report and stop.
2. If `suffix` was not provided, ask: *"What should the output file be named? (e.g. `morning-thoughts`, `team-sync`)"* — wait for the answer before continuing.
3. Convert `suffix` to lowercase, replace spaces with dashes (kebab-case).
4. Get today's date in `YYYY-MM-DD` format by running `date +%Y-%m-%d`. **Do not** rely on `currentDate` in the system prompt — it can be stale.
5. Ensure `inbox/transcripts/` exists. Create it if not.
6. Run the transcription:
   ```bash
   cd .system/tools/transcriber && poetry run python -m deepgram_transcriber.cli <absolute-path-to-audio> -o <repo-root>/inbox/transcripts/<YYYY-MM-DD>-<suffix>.txt
   ```
7. Confirm to the user with the saved path.

## Output format

Each speaker turn appears as `[Speaker N]: <utterance>` on its own line. For solo voice memos there is still only one speaker but the format is consistent.

## Setup (one-time per clone)

```bash
cd .system/tools/transcriber
poetry install
cp .env.example .env
# edit .env, set DEEPGRAM_API_KEY=...
```

Requires `DEEPGRAM_API_KEY` in `.system/tools/transcriber/.env` (gitignored).
