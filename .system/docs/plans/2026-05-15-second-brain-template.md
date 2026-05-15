# Second Brain Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap an empty repo at `/Users/zjor/projects/second-brain-template` into a Claude-Code-ready PARA second-brain template that anyone can clone and start using via `/onboard`.

**Architecture:** Markdown-first template (PARA folders + inbox lanes), a small Poetry-managed Python tool for Deepgram transcription under `.system/tools/transcriber/`, and four slash commands under `.claude/commands/`. Configuration lives in `CLAUDE.md` (Claude instructions), `README.md` (humans), `.vscode/settings.json` (editor), and `.gitignore`.

**Tech Stack:** Markdown, Bash, Python ≥ 3.12, Poetry, `deepgram-sdk`, `python-dotenv`, Git, Claude Code.

**Note on verification:** Most files in this plan are markdown configuration, not testable code. "Verify" steps confirm file contents, run shell checks (`ls`, `git status`, `poetry check`), or walk through a command's logic. The Python tool is small enough that a smoke test (`--help` runs without error) is sufficient.

---

## Phase 1 — Skeleton

### Task 1.1: Create top-level folder structure

**Files:**
- Create: `inbox/`, `inbox/transcripts/`, `inbox/files/`
- Create: `projects/`, `areas/`, `archive/`
- Create: `.claude/commands/`, `.claude/skills/`
- Create: `.vscode/`, `.system/tools/transcriber/deepgram_transcriber/`

- [ ] **Step 1: Create all directories**

```bash
cd /Users/zjor/projects/second-brain-template
mkdir -p inbox/transcripts inbox/files
mkdir -p projects areas archive
mkdir -p .claude/commands .claude/skills
mkdir -p .vscode
mkdir -p .system/tools/transcriber/deepgram_transcriber
```

- [ ] **Step 2: Add .gitkeep to empty dirs that must persist**

```bash
touch inbox/transcripts/.gitkeep
touch inbox/files/.gitkeep
touch .claude/skills/.gitkeep
```

- [ ] **Step 3: Verify structure**

Run: `find . -type d -not -path './.git*' -not -path './.system/docs*' | sort`

Expected output (order may vary):
```
.
./.claude
./.claude/commands
./.claude/skills
./.system
./.system/tools
./.system/tools/transcriber
./.system/tools/transcriber/deepgram_transcriber
./.vscode
./archive
./areas
./inbox
./inbox/files
./inbox/transcripts
./projects
```

### Task 1.2: Write `.gitignore`

**Files:**
- Create: `.gitignore`

- [ ] **Step 1: Write `.gitignore`**

```
.env
.env.*
!.env.example
__pycache__/
*.pyc
.venv/
venv/
.DS_Store
.idea/
*.swp
```

- [ ] **Step 2: Verify**

Run: `cat .gitignore`
Expected: file matches above.

### Task 1.3: Write `.vscode/settings.json`

**Files:**
- Create: `.vscode/settings.json`

- [ ] **Step 1: Write the file**

```json
{
  "editor.wordWrap": "on",
  "files.exclude": {
    "**/__pycache__": true,
    "**/.venv": true,
    "**/*.pyc": true,
    "**/.DS_Store": true
  },
  "explorer.fileNesting.enabled": true,
  "explorer.fileNesting.patterns": {
    "*.md": "${capture}.index.md"
  },
  "[markdown]": {
    "editor.formatOnSave": false,
    "editor.wordWrap": "on"
  }
}
```

- [ ] **Step 2: Verify it parses as JSON**

Run: `python3 -c "import json; json.load(open('.vscode/settings.json'))" && echo OK`
Expected: `OK`

### Task 1.4: Write root `CLAUDE.md`

**Files:**
- Create: `CLAUDE.md`

- [ ] **Step 1: Write CLAUDE.md**

Content (exact):

````markdown
# Second Brain (PARA)

A personal knowledge management system following the PARA method. Edited in Cursor or VSCode with Claude Code.

## Your Role

You are a **thinking partner** and **system maintainer**. You help the user:
- Capture ideas, audio, and documents into the inbox
- Organize captured items into the right PARA folder
- Distill and refine notes in place
- Surface patterns and connections

## Structure

```
/
├── inbox/                  # Capture zone (3 lanes)
│   ├── transcripts/        # Output of /transcribe
│   ├── files/              # Documents awaiting /index-file
│   └── dump.md             # Chat-captured impulses (append-only)
├── projects/               # Active work with a defined end state
├── areas/                  # Ongoing life domains (no end state)
│   └── user.md             # User profile (populated by /onboard)
├── archive/                # Completed or dormant items
├── .claude/                # Claude Code commands and skills
└── .system/                # Tools, docs, specs
    └── tools/transcriber/  # Deepgram transcription (Poetry)
```

## Inbox: three lanes

- **`inbox/transcripts/`** — `/transcribe` writes here. Filenames: `YYYY-MM-DD-<suffix>.txt`.
- **`inbox/files/`** — drop documents/PDFs/screenshots here. Process with `/index-file`.
- **`inbox/dump.md`** — chat-captured stream. Append-only. See Dump rule below.

## Dump rule (phrase-triggered capture)

When the user writes a capture phrase in chat — **remember**, **capture this**, **note**, **save this**, **jot down**, **add to dump**, **don't forget** — append the item to `inbox/dump.md`.

Format inside `inbox/dump.md`:

```markdown
## 2026-05-15
- try the new ramen place on Vinohrady #buy #food
- look into Rust embedded HAL libraries #learn #project:ion
```

Rules:
- One date heading per day. Append under existing heading if it exists.
- Append-only. Never edit or remove past entries.
- Tag with Claude's best guess: `#idea`, `#buy`, `#learn`, `#task`, `#question`, `#tool`, `#person`, or `#project:<name>` if it relates to a known project from `areas/user.md`.
- If the phrase is ambiguous (user is thinking out loud, not capturing), ask once: *"Capture to dump.md?"* — write only after confirmation.

## File placement decision tree

When organizing captured content or creating new files:

- **Actionable, has a defined end state** → `projects/<project-name>/`
- **Ongoing life domain, no end state** → `areas/<domain>/`
- **Completed or dormant** → `archive/`
- **Unsure** → leave in `inbox/` and ask the user

## Conventions

- Filenames: `kebab-case.md`, lowercase, no spaces
- Dates: `YYYY-MM-DD`
- Always use real system date (`date +%Y-%m-%d`), not the date from the system prompt
- Frontmatter on new files:

```yaml
---
created: YYYY-MM-DD
status: active | incubating | paused | complete | archived
tags: []
---
```

- Languages: Russian and English are both fine (the user may switch)

## Don'ts

- Don't reorganize folders without explicit permission
- Don't delete files without confirmation
- Don't create deep folder hierarchies pre-emptively — let structure emerge from real content
- Don't write to `inbox/transcripts/` or `inbox/files/` manually — those lanes are for `/transcribe` and user-dropped files

## Commands

- `/onboard` — set up the user profile (run once after cloning)
- `/transcribe <audio>` — transcribe an audio file via Deepgram into `inbox/transcripts/`
- `/index-file [filepath] [destination]` — read a file, summarize it, file it where it belongs
- `/sync` — pull from remote, merge local changes via a temp branch, push
````

- [ ] **Step 2: Verify file exists and is non-empty**

Run: `wc -l CLAUDE.md`
Expected: ~80–100 lines.

### Task 1.5: Write `index.md` for each top folder

**Files:**
- Create: `inbox/index.md`, `projects/index.md`, `areas/index.md`, `archive/index.md`

- [ ] **Step 1: Write `inbox/index.md`**

```markdown
# Inbox

Capture zone — anything new lands here first, gets organized later.

- `transcripts/` — voice memos transcribed by `/transcribe`
- `files/` — documents, PDFs, screenshots waiting for `/index-file`
- `dump.md` — chat-captured impulses (append-only)

When you process the inbox, move items to `projects/`, `areas/`, or `archive/`.
```

- [ ] **Step 2: Write `projects/index.md`**

```markdown
# Projects

Active work with a defined end state. Each project is a folder.

Examples: a product launch, a course you're taking, a renovation, a paper to write.

When a project ships or is abandoned, move it to `archive/`.
```

- [ ] **Step 3: Write `areas/index.md`**

```markdown
# Areas

Ongoing life domains. No end state — you tend them indefinitely.

Examples: health, family, finance, education, relationships, career.

`user.md` lives here — it holds your profile, populated by `/onboard`.
```

- [ ] **Step 4: Write `archive/index.md`**

```markdown
# Archive

Completed or dormant items. Things you've finished, paused, or quit.

Don't delete from `projects/` or `areas/` — move here instead.
```

- [ ] **Step 5: Verify all four files**

Run: `ls -1 */index.md`
Expected:
```
archive/index.md
areas/index.md
inbox/index.md
projects/index.md
```

### Task 1.6: Seed `areas/user.md` and `inbox/dump.md`

**Files:**
- Create: `areas/user.md`, `inbox/dump.md`

- [ ] **Step 1: Write `areas/user.md` template**

```markdown
---
created: 2026-05-15
status: active
onboarded: false
---

# User Profile

This file is populated by running `/onboard`.

## Identity

_to be filled by /onboard_

## Active projects

_to be filled by /onboard_

## Active areas

_to be filled by /onboard_

## Use cases for this second brain

_to be filled by /onboard_
```

Note: the `created` date must be replaced with today's real date by whoever clones the template — `/onboard` will overwrite this anyway.

- [ ] **Step 2: Write `inbox/dump.md` stub**

```markdown
# Dump

Chat-captured impulses. Append-only. New entries land under a date heading.

Triggered when you say: "remember", "capture this", "note", "save this", "jot down", "add to dump", "don't forget".

---
```

- [ ] **Step 3: Verify**

Run: `wc -l areas/user.md inbox/dump.md`
Expected: both non-empty.

### Task 1.7: Initial git commit for Phase 1

- [ ] **Step 1: Stage skeleton**

```bash
git add .gitignore .vscode CLAUDE.md inbox projects areas archive .claude .system/tools/transcriber/deepgram_transcriber/.gitkeep 2>/dev/null
git status --short
```

Note: `.gitkeep` for `deepgram_transcriber/` only if you placed one — otherwise that directory will be created in Phase 3 with its real files. If `git add` complains about that path, drop it.

- [ ] **Step 2: Commit**

```bash
git commit -m "phase 1: skeleton — PARA folders, CLAUDE.md, .vscode, .gitignore"
```

- [ ] **Step 3: Verify**

Run: `git log --oneline | head -3`
Expected: one new commit with the Phase 1 message at the top.

---

## Phase 2 — README

### Task 2.1: Write `README.md`

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README.md**

Content (exact):

````markdown
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

| Command          | What it does                                                              |
| ---------------- | ------------------------------------------------------------------------- |
| `/onboard`       | One-time setup: collects identity, projects, areas, and use cases         |
| `/transcribe`    | Transcribes an audio file via Deepgram into `inbox/transcripts/`          |
| `/index-file`    | Reads a file, summarizes it, optionally moves it out of `inbox/files/`    |
| `/sync`          | Pulls remote changes; merges your local work via a temp branch; pushes   |

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
````

- [ ] **Step 2: Verify**

Run: `grep -c '^## ' README.md`
Expected: at least 6 (sections: Quick start, Structure, Information flow, Commands, Prerequisites, Setup, License).

### Task 2.2: Commit Phase 2

- [ ] **Step 1: Commit**

```bash
git add README.md
git commit -m "phase 2: README with quick start, C.O.D.E. flow, command table, prereqs"
```

- [ ] **Step 2: Verify**

Run: `git log --oneline | head -3`
Expected: two commits now (Phase 1 + Phase 2).

---

## Phase 3 — Commands and Python tool

### Task 3.1: Port the Poetry transcriber tool

**Files:**
- Create: `.system/tools/transcriber/pyproject.toml`
- Create: `.system/tools/transcriber/.env.example`
- Create: `.system/tools/transcriber/README.md`
- Create: `.system/tools/transcriber/deepgram_transcriber/__init__.py`
- Create: `.system/tools/transcriber/deepgram_transcriber/cli.py`

- [ ] **Step 1: Write `pyproject.toml`**

```toml
[tool.poetry]
name = "transcriber"
version = "0.1.0"
description = "Deepgram nova-3 transcription with speaker diarization for the second brain inbox"
authors = ["you <you@example.com>"]
package-mode = false

[tool.poetry.dependencies]
python = "^3.12"
deepgram-sdk = "^3.0"
python-dotenv = "^1.0"

[tool.poetry.scripts]
deepgram-transcribe = "deepgram_transcriber.cli:main"

[build-system]
requires = ["poetry-core"]
build-backend = "poetry.core.masonry.api"
```

- [ ] **Step 2: Write `.env.example`**

```
DEEPGRAM_API_KEY=your_deepgram_api_key_here
```

- [ ] **Step 3: Write `.system/tools/transcriber/README.md`**

```markdown
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
poetry run deepgram-transcribe input.m4a                 # stdout
poetry run deepgram-transcribe input.m4a -o out.txt      # to file
poetry run deepgram-transcribe input.m4a --language en   # different language
```

Used by the `/transcribe` slash command — see `.claude/commands/transcribe.md`.
```

- [ ] **Step 4: Write `deepgram_transcriber/__init__.py`**

Empty file:

```python
```

(Yes, empty — it just marks the package.)

- [ ] **Step 5: Write `deepgram_transcriber/cli.py`**

```python
import argparse
import os
import sys
from pathlib import Path

from deepgram import DeepgramClient, FileSource, PrerecordedOptions
from dotenv import load_dotenv

_PROJECT_ROOT = Path(__file__).parent.parent
load_dotenv(_PROJECT_ROOT / ".env")


def transcribe(audio_path: Path, language: str = "ru") -> str:
    api_key = os.environ.get("DEEPGRAM_API_KEY")
    if not api_key:
        print("Error: DEEPGRAM_API_KEY environment variable not set", file=sys.stderr)
        sys.exit(1)

    client = DeepgramClient(api_key)

    with open(audio_path, "rb") as f:
        buffer_data = f.read()

    payload: FileSource = {"buffer": buffer_data}

    options = PrerecordedOptions(
        model="nova-3",
        language=language,
        diarize=True,
        punctuate=True,
        utterances=True,
    )

    response = client.listen.rest.v("1").transcribe_file(payload, options, timeout=300)

    utterances = response.results.utterances
    if not utterances:
        return response.results.channels[0].alternatives[0].transcript

    lines = []
    current_speaker = None
    current_parts = []

    for utt in utterances:
        if utt.speaker == current_speaker:
            current_parts.append(utt.transcript)
        else:
            if current_speaker is not None:
                lines.append(f"[Speaker {current_speaker}]: {' '.join(current_parts)}")
            current_speaker = utt.speaker
            current_parts = [utt.transcript]

    if current_speaker is not None:
        lines.append(f"[Speaker {current_speaker}]: {' '.join(current_parts)}")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="Transcribe audio with speaker diarization using Deepgram nova-3"
    )
    parser.add_argument("input", type=Path, help="Input audio file (m4a, mp3, wav, etc.)")
    parser.add_argument("-o", "--output", type=Path, help="Output file (default: stdout)")
    parser.add_argument(
        "--language", default="ru", help="BCP-47 language code (default: ru)"
    )
    args = parser.parse_args()

    if not args.input.exists():
        print(f"Error: {args.input} not found", file=sys.stderr)
        sys.exit(1)

    text = transcribe(args.input, language=args.language)

    if args.output:
        args.output.write_text(text)
        print(f"Saved to {args.output}", file=sys.stderr)
    else:
        print(text)


if __name__ == "__main__":
    main()
```

- [ ] **Step 6: Smoke-test the tool installs and `--help` runs**

```bash
cd .system/tools/transcriber
poetry install
poetry run deepgram-transcribe --help
cd ../../..
```

Expected output from `--help`:
```
usage: deepgram-transcribe [-h] [-o OUTPUT] [--language LANGUAGE] input

Transcribe audio with speaker diarization using Deepgram nova-3
...
```

If `poetry install` fails with a Python version error, confirm the local Python is ≥ 3.12 (`python3 --version`). If `--help` fails with an import error, the package layout is wrong — re-check that `deepgram_transcriber/cli.py` and `__init__.py` both exist.

### Task 3.2: Write `/transcribe` command

**Files:**
- Create: `.claude/commands/transcribe.md`

- [ ] **Step 1: Write `.claude/commands/transcribe.md`**

````markdown
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
   cd .system/tools/transcriber && poetry run deepgram-transcribe <absolute-path-to-audio> -o <repo-root>/inbox/transcripts/<YYYY-MM-DD>-<suffix>.txt
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
````

- [ ] **Step 2: Verify frontmatter**

Run: `head -7 .claude/commands/transcribe.md`
Expected: starts with `---`, contains `name: transcribe`, `description:`, `argument-hint:`, `allowed-tools:`, closing `---`.

### Task 3.3: Write `/index-file` command

**Files:**
- Create: `.claude/commands/index-file.md`

- [ ] **Step 1: Write `.claude/commands/index-file.md`**

````markdown
---
name: index-file
description: Indexes a file by optionally moving it from inbox/files/ to a destination, reading its content, generating a summary in .index/<filename>.md, and appending a snippet to CLAUDE.md in the destination folder.
argument-hint: [filepath] [destination]
allowed-tools: Bash, Read, Write, Glob, Edit
---

Index a file: read it, generate a summary, create index artifacts in the file's folder.

## Arguments

`$ARGUMENTS` may contain:
- nothing — ask the user which file to index
- `<filepath>` — index the specified file in place (unless it's in `inbox/`)
- `<filepath> <destination>` — move the file to destination, then index it there

---

## Step 1: Resolve the target file

If no filepath was provided, ask the user:
> Which file would you like to index?

---

## Step 2: Check for inbox

Check whether any component of the file's current path is a folder named `inbox` (case-insensitive).

- **If yes (inbox file):** ask the user for the destination folder (unless already provided as the second argument).
  - Move the file to the destination folder before proceeding.
  - All further steps operate on the file at its new location.
- **If no:** proceed with the file in its current location. No moving needed.

---

## Step 3: Read and understand the file

Read the file content. Identify:
- What kind of document it is (report, article, code, notes, invoice, etc.)
- Its main topic and key points
- Any important metadata (date, author, subject, etc.)

---

## Step 4: Create `.index/` directory if needed

In the folder where the file now lives, check for a `.index/` subdirectory. Create it if absent.

---

## Step 5: Write the summary to `.index/<filename>.md`

Create (or overwrite) `.index/<original-filename>.md` with this structure:

```markdown
# <Original Filename>

**Type:** <document type>
**Date indexed:** <today's date>

## Summary

<3–6 sentence summary capturing main content, purpose, key points>

## Key Points

- <bullet 1>
- <bullet 2>
- ...
```

Use today's real date from `date +%Y-%m-%d`, not the system prompt date.

---

## Step 6: Update `CLAUDE.md` in the file's folder

Check if `CLAUDE.md` exists in the file's folder.
- If not, create it with header `# Folder Index`.

Append this entry (do not duplicate if the file was already indexed — replace existing entry with the same filename):

```markdown
## <original-filename>

<One to two sentence description of what the file is and why it matters.>
```

---

## Step 7: Confirm to the user

Report:
- File location (original → new, if moved)
- Path to the summary in `.index/`
- Whether `CLAUDE.md` was created or updated
````

- [ ] **Step 2: Verify frontmatter**

Run: `head -7 .claude/commands/index-file.md`
Expected: starts with `---`, contains `name: index-file`.

### Task 3.4: Write `/sync` command

**Files:**
- Create: `.claude/commands/sync.md`

- [ ] **Step 1: Write `.claude/commands/sync.md`**

````markdown
---
name: sync
description: Sync with the remote — pull, merge local changes via a temp branch, push. Resolves conflicts inline.
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git add:*), Bash(git commit:*), Bash(git checkout:*), Bash(git branch:*), Bash(git pull:*), Bash(git push:*), Bash(git merge:*), Bash(date:*), Read, Edit
---

Pull from the remote, merge local work via a temporary branch, push to master.

## Steps

1. **Check working tree state**

   ```bash
   git status --porcelain
   ```

   - If empty → no local changes; jump to step 5.
   - If non-empty → mark `DIRTY=true` and continue.

2. **Create a sync branch and commit local work**

   ```bash
   BRANCH="sync-$(date +%Y%m%d-%H%M%S)"
   git checkout -b "$BRANCH"
   git add -A
   ```

   Look at `git diff --cached --stat` and write a one-line summary of what changed (e.g., *"sync: add 3 transcripts, update areas/user.md"*). Use that as the commit message:

   ```bash
   git commit -m "<your one-line summary>"
   git checkout master
   ```

3. **Pull the latest from remote**

   ```bash
   git pull origin master
   ```

4. **Merge the sync branch into master**

   ```bash
   git merge --no-ff "$BRANCH"
   ```

   - If conflicts → read the conflicted files, resolve them by understanding both sides (don't blindly pick `--ours` or `--theirs`), then:

     ```bash
     git add <resolved-files>
     git commit --no-edit
     ```

5. **Push**

   ```bash
   git push origin master
   ```

6. **Cleanup**

   - If `DIRTY=true`:
     ```bash
     git branch -d "$BRANCH"
     ```

7. **Report**

   Tell the user:
   - Whether there were local changes
   - The commit message used (if any)
   - Whether conflicts were resolved
   - That the push succeeded

## Safety

- Never run `git push --force` here.
- Never delete `master`.
- If anything fails mid-flow, stop and report — don't auto-recover with destructive operations.
````

- [ ] **Step 2: Verify frontmatter**

Run: `head -5 .claude/commands/sync.md`
Expected: `---`, `name: sync`, `description:`, `allowed-tools:`, `---`.

### Task 3.5: Commit Phase 3

- [ ] **Step 1: Stage and commit**

```bash
git add .system/tools/transcriber .claude/commands/transcribe.md .claude/commands/index-file.md .claude/commands/sync.md
git status --short
git commit -m "phase 3: commands (/sync /transcribe /index-file) and Poetry transcriber tool"
```

- [ ] **Step 2: Verify**

Run: `git log --oneline | head -4`
Expected: three commits total (Phase 1, 2, 3).

---

## Phase 4 — Onboarding

### Task 4.1: Write `/onboard` command

**Files:**
- Create: `.claude/commands/onboard.md`

- [ ] **Step 1: Write `.claude/commands/onboard.md`**

````markdown
---
name: onboard
description: One-time interactive setup. Collects identity, active projects, life areas, and use cases, then writes a personalized profile to areas/user.md.
allowed-tools: Bash(date:*), Read, Write, Edit, AskUserQuestion
---

Walk the user through a four-section onboarding and write the result to `areas/user.md`.

## Pre-flight

1. Read `areas/user.md`. Look at the frontmatter for the `onboarded` field.
2. If `onboarded: true`:
   - Tell the user: *"You're already onboarded. Which section would you like to update?"*
   - Offer: Identity / Active projects / Active areas / Use cases / All (full re-run).
   - Run only the chosen section(s).
3. If `onboarded: false` or missing: run the full flow.

## Section 1 — Identity

Ask, one question at a time:

- **Name** — what should I call you?
- **Role** — one line: what do you do? (e.g., *"founder of a hardware startup"*, *"medical student in Berlin"*)
- **Location and timezone** — city + timezone (e.g., *"Prague, Europe/Prague"*)
- **Primary languages** — which languages do you work in? (e.g., *"English, Russian"*)

## Section 2 — Active projects

Ask: *"List 3–5 projects you're actively working on. For each one, give me a short name and a one-line goal. Add a rough timeline if you have one."*

Wait for the answer. Re-ask if fewer than 1 or unclear.

Format as:

```markdown
- **project-name** — one-line goal. _Timeline: Q3 2026_
```

## Section 3 — Active areas

Ask: *"Which life areas are you actively tending right now? Health, family, finance, education, relationships, career, hobbies — anything ongoing. List as many as apply."*

Format as a comma-separated list or bullet list, whichever fits the answer.

## Section 4 — Use cases

Ask: *"What do you want this second brain to do for you? Examples: capture and forget, idea synthesis, decision support, content production, learning, project planning. Pick what resonates or describe in your own words."*

Free-text answer is fine.

## Write the profile

Get today's date: `date +%Y-%m-%d`.

Overwrite `areas/user.md` with:

```markdown
---
created: <YYYY-MM-DD>
status: active
onboarded: true
onboarded_at: <YYYY-MM-DD>
---

# User Profile

## Identity

- **Name:** <name>
- **Role:** <role>
- **Location:** <city, timezone>
- **Languages:** <languages>

## Active projects

- **<project-1>** — <goal>. _Timeline: <timeline or "ongoing">_
- **<project-2>** — ...
- ...

## Active areas

- <area-1>
- <area-2>
- ...

## Use cases for this second brain

<free-text answer, lightly formatted into paragraphs or bullets>
```

If this is a section update (not a full run), preserve the other sections and update `onboarded_at` to today.

## Confirm

Tell the user:
- That the profile was written to `areas/user.md`
- A one-line summary of what was captured
- Suggest next step: *"Try `/transcribe` if you have an audio file in `inbox/`, or just start chatting — say 'remember this:' to capture ideas."*
````

- [ ] **Step 2: Verify**

Run: `head -5 .claude/commands/onboard.md`
Expected: frontmatter present with `name: onboard`.

### Task 4.2: Commit Phase 4

- [ ] **Step 1: Stage and commit**

```bash
git add .claude/commands/onboard.md
git commit -m "phase 4: /onboard command writes areas/user.md profile"
```

- [ ] **Step 2: Verify**

Run: `git log --oneline | head -5`
Expected: four phase commits.

---

## Phase 5 — Final polish and push (optional)

### Task 5.1: End-to-end sanity check

- [ ] **Step 1: Walk the file tree**

```bash
find . -type f -not -path './.git*' -not -path './.system/tools/transcriber/.venv*' -not -path './.system/tools/transcriber/poetry.lock' | sort
```

Expected file list (poetry.lock will appear after `poetry install`, that's fine):
```
./.claude/commands/index-file.md
./.claude/commands/onboard.md
./.claude/commands/sync.md
./.claude/commands/transcribe.md
./.claude/skills/.gitkeep
./.gitignore
./.system/docs/plans/2026-05-15-second-brain-template.md
./.system/docs/specs/2026-05-15-second-brain-template-design.md
./.system/tools/transcriber/.env.example
./.system/tools/transcriber/README.md
./.system/tools/transcriber/deepgram_transcriber/__init__.py
./.system/tools/transcriber/deepgram_transcriber/cli.py
./.system/tools/transcriber/pyproject.toml
./.vscode/settings.json
./CLAUDE.md
./README.md
./archive/index.md
./areas/index.md
./areas/user.md
./inbox/dump.md
./inbox/files/.gitkeep
./inbox/index.md
./inbox/transcripts/.gitkeep
./projects/index.md
```

- [ ] **Step 2: Confirm `.env` is gitignored**

```bash
cd .system/tools/transcriber
touch .env
git check-ignore -v .env
rm .env
cd ../../..
```

Expected: `git check-ignore` returns the matching `.gitignore` rule.

- [ ] **Step 3: Confirm Poetry tool runs end-to-end (still no API call)**

```bash
.system/tools/transcriber/.venv/bin/python -c "from deepgram_transcriber.cli import main; print('import OK')" 2>/dev/null || \
  (cd .system/tools/transcriber && poetry run python -c "from deepgram_transcriber.cli import main; print('import OK')")
```

Expected: `import OK`

### Task 5.2: Push to GitHub (only when user confirms)

This step requires user authorization — **do not auto-execute**. Ask the user:

> *"Skeleton is ready. Want me to create the GitHub repo and push? I'll use `gh repo create`."*

If yes:

- [ ] **Step 1: Create remote and push**

```bash
gh repo create second-brain-template --public --source=. --remote=origin --push
```

- [ ] **Step 2: Verify**

```bash
gh repo view --web
```

Expected: browser opens the new repo.

---

## Self-review summary

- **Spec coverage:** Each design section maps to one of Phases 1–4. Inbox three-lane structure → Task 1.1. Dump rule → Task 1.4 (CLAUDE.md). C.O.D.E. flow → README in Task 2.1. `/sync`, `/transcribe`, `/index-file`, `/onboard` → Tasks 3.4, 3.2, 3.3, 4.1. Poetry tool → Task 3.1.
- **Placeholder scan:** No "TBD" or "implement later" remains. The `areas/user.md` initial seed has explicit `_to be filled by /onboard_` placeholders — those are intentional and replaced by `/onboard`.
- **Type/name consistency:** Command names (`sync`, `transcribe`, `index-file`, `onboard`) match across CLAUDE.md, README.md, and the command files themselves. The Poetry script name `deepgram-transcribe` is referenced consistently from `/transcribe`.
- **Build sequence:** Each phase commits independently and leaves a working repo.
