# transcriber

Deepgram nova-3 transcription with speaker diarization. Defaults to Russian (`--language ru`).

## Setup

```bash
poetry install
cp .env.example .env
# edit .env, set DEEPGRAM_API_KEY=...
```

## Usage

```bash
poetry run python -m deepgram_transcriber.cli input.m4a                 # stdout
poetry run python -m deepgram_transcriber.cli input.m4a -o out.txt      # to file
poetry run python -m deepgram_transcriber.cli input.m4a --language en   # different language
```

Used by the `/transcribe` slash command — see `.claude/commands/transcribe.md`.

## Troubleshooting

If `poetry install` fails with PEP 668 / "externally-managed-environment" errors, your Poetry is picking a Homebrew Python that won't allow pip installs. Force Poetry to use a Python 3.12 from python.org:

```bash
poetry env use /Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12
poetry install
```
