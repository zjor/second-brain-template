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
