---
created: 2026-05-15
status: draft
---

# Second Brain Template — Design

A GitHub-clonable starter for personal knowledge management. Users clone, open in Claude Code, run `/onboard`, and start capturing.

## Goals

- Minimal, opinionated structure (PARA + inbox + archive)
- Out-of-the-box commands for the core capture/organize/distill loop
- Quick onboarding that personalizes Claude to the user
- No external services required for the basics; Deepgram only for `/transcribe`

## Non-goals

- Shipping pre-filled content or example projects
- Supporting non–Claude-Code workflows
- A `journal/` skeleton (users add it if they want it)

## Folder layout

```
second-brain-template/
├── README.md                        # User-facing intro
├── CLAUDE.md                        # Claude project instructions
├── .gitignore
├── .vscode/settings.json
├── .claude/
│   ├── commands/
│   │   ├── sync.md
│   │   ├── transcribe.md
│   │   ├── index-file.md
│   │   └── onboard.md
│   └── skills/.gitkeep
├── .system/
│   ├── docs/specs/                  # this file lives here
│   └── tools/transcriber/           # Poetry project (Deepgram nova-3, RU)
├── inbox/
│   ├── index.md
│   ├── transcripts/                 # /transcribe outputs land here
│   ├── files/                       # drop zone for files awaiting /index-file
│   └── dump.md                      # chat-captured ideas (append-only)
├── projects/index.md
├── areas/
│   ├── index.md
│   └── user.md                      # populated by /onboard
└── archive/index.md
```

Each `index.md` is 3–6 lines: what the folder is for + one example. Top-level folders are otherwise empty.

## Information flow — C.O.D.E.

- **Capture** → `inbox/` has three lanes:
  - `inbox/transcripts/` — output of `/transcribe`
  - `inbox/files/` — documents/PDFs the user drops in, awaiting `/index-file`
  - `inbox/dump.md` — chat-captured impulses (see Dump rule below)
- **Organize** → move from `inbox/*` to `projects/` (end-state), `areas/` (ongoing domain), or `archive/` (done/dormant).
- **Distill** → refine summaries in place; promote raw captures to structured notes.
- **Express** → produce outputs (writing, shipped code, decisions, plans).

### Dump rule (phrase-triggered capture)

CLAUDE.md instructs Claude: when the user writes capture phrases in chat — *"remember"*, *"capture this"*, *"note"*, *"save this"*, *"jot down"*, *"add to dump"*, or *"don't forget"* — append the item to `inbox/dump.md` with today's date and Claude-proposed tags.

Format inside `inbox/dump.md`:

```markdown
## 2026-05-15
- try the new ramen place on Vinohrady #buy #food
- look into Rust embedded HAL libraries #learn #project:ion
```

Rules:
- One date heading per day (append under existing heading if it exists)
- Bullets are append-only — never edit or remove past entries
- Tags are Claude's best guess at category: `#idea`, `#buy`, `#learn`, `#task`, `#question`, `#tool`, `#person`, or `#project:<name>` if it relates to a known project from `areas/user.md`
- If the phrase is ambiguous (e.g., the user is just thinking out loud), Claude asks once: *"Capture to dump.md?"* — and writes only after confirmation

## CLAUDE.md content

Short file (~100 lines) covering:
- PARA semantics (projects / areas / archive)
- Inbox-first capture rule, with the three-lane inbox (`transcripts/`, `files/`, `dump.md`)
- **Dump rule** — phrase triggers and dump.md format (see Dump rule above)
- Naming conventions (kebab-case, lowercase, dates as `YYYY-MM-DD`)
- Frontmatter convention (`created`, `status`, `tags`)
- File-placement decision tree (actionable with end-state → `projects/`; ongoing domain → `areas/`; done/dormant → `archive/`)
- Don'ts (no reorganizing without permission, no deletion without confirmation, no pre-emptive deep hierarchies)

## Commands

### `/sync` — feature-branch merge

```
1. Check `git status --porcelain` for uncommitted work.
2. If dirty:
     branch="sync-$(date +%Y%m%d-%H%M%S)"
     git checkout -b "$branch"
     git add -A
     git commit -m "sync: <Claude-generated summary of changes>"
     git checkout master
3. git pull origin master
4. If dirty: git merge --no-ff "$branch"
     - On conflict: Claude opens the conflicted files, resolves them, re-runs the merge commit.
5. git push origin master
6. If dirty: git branch -d "$branch"
```

The command's `.md` instructs Claude to summarize changes in the commit message rather than using a generic "sync" string.

### `/transcribe` — Deepgram via Poetry tool

Ported from existing `deepgram-transcribe` command. Calls `poetry run deepgram-transcribe <abs-path>` from `.system/tools/transcriber/`. Default destination: `inbox/transcripts/`. Output filename: `YYYY-MM-DD-<suffix>.txt`. Suffix is asked if not provided.

Tool dependencies:
- Python ≥ 3.12, Poetry
- `deepgram-sdk` (in `pyproject.toml`)
- `DEEPGRAM_API_KEY` in `.system/tools/transcriber/.env` — user creates this; gitignored

### `/index-file` — port from existing

Direct port. Reads the file, generates `.index/<filename>.md` summary, appends a snippet to `CLAUDE.md` in the same folder. The existing command already detects when a file is inside an `inbox/` folder and prompts for a destination; that behavior covers `inbox/files/` without modification.

### `/onboard` — interactive questionnaire

Sequential questions, one section at a time. Stages:

1. **Identity** — name, role (1-line), location/timezone, primary languages
2. **Active projects** — 3–5 projects in motion. For each: name + 1-line goal + rough timeline if known.
3. **Active areas** — life domains currently being tended (health, family, finance, education, relationships, …). Free list.
4. **Use cases** — open question: "What do you want this second brain to do for you?" (capture-and-forget, idea synthesis, decision support, content production, learning, …)

After each section, write to `areas/user.md`. At end:

```yaml
---
created: <YYYY-MM-DD>
onboarded: true
onboarded_at: <YYYY-MM-DD>
status: active
---
```

Re-running `/onboard` after `onboarded: true` is set:
- Claude lists sections (Identity / Projects / Areas / Use cases)
- User picks one to update; only that section re-runs
- `onboarded_at` updated to today

## README content (user-facing)

Sections in order:
1. **What this is** — 2-sentence pitch
2. **Quick start** — clone → open in Claude Code → run `/onboard`
3. **Structure** — tree diagram with one-line annotations
4. **Information flow (C.O.D.E.)** — same as Information flow section above, compressed
5. **Commands** — table of `/sync`, `/transcribe`, `/index-file`, `/onboard` with 1-line descriptions
6. **Prerequisites** — Git, Claude Code, Python ≥ 3.12, Poetry, Deepgram API key (only for `/transcribe`)
7. **Setup** — `cd .system/tools/transcriber && poetry install`; create `.env` with `DEEPGRAM_API_KEY=...`

No fluff, no marketing copy.

## .vscode/settings.json

Minimal:
- `"editor.wordWrap": "on"` for markdown
- `"files.exclude"` hides `__pycache__`, `.venv`, `*.pyc`
- File nesting for `index.md` next to folder contents

## .gitignore

```
.env
__pycache__/
*.pyc
.venv/
.DS_Store
```

## Build sequence

Four phases, each independently committable:

1. **Skeleton** — folders, `.gitignore`, `.vscode/settings.json`, root `CLAUDE.md`, `index.md` stubs
2. **README** — written using the structure above
3. **Commands** — port `index-file` and the transcriber Poetry tool; write `/sync` and `/transcribe`
4. **Onboarding** — `/onboard` command + `areas/user.md` template (frontmatter only, `onboarded: false`)

Each phase ends with a working repo. After Phase 4 the template is ready to be pushed to GitHub.

## Open questions

None blocking. The Phase 3 commit message generation in `/sync` is left to Claude's judgment at run-time (the command's `.md` will instruct it to summarize what changed).
