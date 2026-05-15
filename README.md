# Second Brain Template

A Claude-Code-native template for personal knowledge management using the PARA method.

Clone, open in Claude Code, run `/onboard`, start capturing.

## Quick start

```bash
git clone <your-fork-url> my-brain
cd my-brain
# open in Cursor or VSCode with Claude Code installed
# in Claude Code:
/onboard
```

## Structure

```
.
├── inbox/                # Capture zone
│   ├── transcripts/      # Voice memo transcriptions
│   ├── files/            # Documents/PDFs to process
│   └── dump.md           # Chat-captured impulses
├── projects/             # Active work with end states
├── areas/                # Ongoing life domains
│   └── user.md           # Your profile (filled by /onboard)
├── archive/              # Done or dormant
├── .claude/commands/     # Slash commands
└── .system/tools/        # Helper tools (Python)
```

## Information flow — C.O.D.E.

- **Capture** — drop into `inbox/`. Audio via `/transcribe`, files via `/index-file`, ideas via chat ("remember…", "capture…").
- **Organize** — move from `inbox/` to `projects/` (has end-state), `areas/` (ongoing), or `archive/` (done).
- **Distill** — refine and summarize notes in place.
- **Express** — ship the output (writing, decisions, code, completed projects).

## Commands

| Command         | What it does                                                              |
| --------------- | ------------------------------------------------------------------------- |
| `/onboard`      | One-time setup: collects identity, projects, areas, and use cases         |
| `/transcribe`   | Transcribes an audio file via Deepgram into `inbox/transcripts/`          |
| `/index-file`   | Reads a file, summarizes it, optionally moves it out of `inbox/files/`    |
| `/sync`         | Pulls remote changes; merges your local work via a temp branch; pushes    |

## Prerequisites

- Git
- [Claude Code](https://claude.com/claude-code)
- Python ≥ 3.12 and [Poetry](https://python-poetry.org/) — only needed for `/transcribe`
- A [Deepgram](https://deepgram.com/) API key — only needed for `/transcribe`

## Setup

For `/transcribe` only:

```bash
cd .system/tools/transcriber
poetry install
cp .env.example .env
# edit .env and set DEEPGRAM_API_KEY=...
```

Everything else works out of the box.

## License

MIT — do whatever you want.
