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

## Specs and plans

When using the superpowers skills (`brainstorming`, `writing-plans`, etc.):
- Specs go to `docs/specs/YYYY-MM-DD-<topic>-design.md`
- Plans go to `docs/plans/YYYY-MM-DD-<topic>.md`

Do **not** use `docs/superpowers/specs/` or `docs/superpowers/plans/` — the
default paths from those skills. The `superpowers/` namespace is a
skill-runtime detail, not a project structure concern.
