# Telegram Brain Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a VPS-deployable Telegram bot that exposes the Second Brain repo via Claude Code, supporting text/voice capture, the existing skills pipeline, interactive Q&A with inline-keyboard approvals, and per-message git sync.

**Architecture:** Single Node.js/TypeScript service in a Docker container. The bot owns Telegram I/O and spawns `claude -p --resume` per turn with a Telegram-mode system prompt injected via `--append-system-prompt`. Each user message acquires a git lock, pulls, runs Claude, commits+pushes if dirty, releases. Claude's reply optionally ends with a fenced ` ```tg ` JSON block carrying an inline keyboard; the bot parses, strips, and renders it. Proactive notifications go through a localhost Hono `/notify` endpoint that Claude calls via a bash tool.

**Tech Stack:** Node 24 LTS, TypeScript 5, grammy (Telegram), Hono + @hono/node-server (HTTP), better-sqlite3 (sessions), @deepgram/sdk (voice), proper-lockfile (git mutex), zod (validation), vitest (tests). Docker for deployment.

**Plan reference:** [2026-05-17-telegram-brain-bot-design.md](../specs/2026-05-17-telegram-brain-bot-design.md)

---

## File Structure

All under `.system/services/telegram-bot/` in the brain repo:

```
.system/services/telegram-bot/
├── README.md                       Build & deploy instructions
├── Dockerfile
├── docker-compose.yml
├── .env.example                    Template; real .env is gitignored
├── .dockerignore
├── .gitignore                      Local ignore (node_modules, dist, .env, *.log)
├── package.json
├── package-lock.json
├── tsconfig.json
├── vitest.config.ts
├── notify-tg.sh                    Outbound helper, callable by Claude
├── src/
│   ├── index.ts                    Entrypoint: validate config, boot
│   ├── config.ts                   Env loading & zod validation
│   ├── protocol.ts                 tg-block parser, keyboard schema
│   ├── session.ts                  SQLite session/callback store
│   ├── git.ts                      lock, pull, dirty check, commit, push
│   ├── voice.ts                    Deepgram transcription
│   ├── claude.ts                   CLI spawn & stdout parsing
│   ├── notify.ts                   Hono /notify endpoint
│   └── bot.ts                      grammy wiring, handlers
├── prompts/
│   └── telegram-mode.md            Injected via --append-system-prompt
└── test/
    ├── protocol.test.ts
    ├── session.test.ts
    ├── config.test.ts
    ├── git.test.ts
    ├── voice.test.ts
    ├── claude.test.ts
    ├── notify.test.ts
    └── fixtures/
        ├── fake-claude.sh          Test double for claude binary
        └── sample-voice.ogg        For voice integration test
```

Also a tiny edit to the brain repo's root `.gitignore`.

---

## Task 1: Project scaffolding

**Files:**
- Create: `.system/services/telegram-bot/package.json`
- Create: `.system/services/telegram-bot/tsconfig.json`
- Create: `.system/services/telegram-bot/vitest.config.ts`
- Create: `.system/services/telegram-bot/.gitignore`
- Create: `.system/services/telegram-bot/.dockerignore`
- Create: `.system/services/telegram-bot/.env.example`
- Modify: `.gitignore` (brain repo root)

- [ ] **Step 1: Create the directory and `package.json`**

Run from brain repo root:
```bash
mkdir -p .system/services/telegram-bot/{src,test/fixtures,prompts}
cd .system/services/telegram-bot
```

Write `package.json`:
```json
{
  "name": "telegram-brain-bot",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "scripts": {
    "build": "tsc",
    "dev": "node --env-file=.env --import tsx src/index.ts",
    "start": "node --env-file=.env dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@deepgram/sdk": "^4.0.0",
    "@hono/node-server": "^1.13.0",
    "better-sqlite3": "^11.5.0",
    "grammy": "^1.31.0",
    "hono": "^4.6.0",
    "proper-lockfile": "^4.1.2",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^22.7.0",
    "@types/proper-lockfile": "^4.1.4",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": false
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    testTimeout: 10_000,
  },
});
```

- [ ] **Step 4: Create `.gitignore` (in bot dir)**

```
node_modules/
dist/
.env
*.log
coverage/
```

- [ ] **Step 5: Create `.dockerignore`**

```
node_modules
dist
.env
*.log
coverage
test
.git
```

- [ ] **Step 6: Create `.env.example`**

```
# Required
TELEGRAM_BOT_TOKEN=
TG_ALLOWED_USER_IDS=
DEEPGRAM_API_KEY=
ANTHROPIC_API_KEY=
BRAIN_REPO_URL=git@github.com:USER/REPO.git

# Optional (defaults shown)
SESSION_TTL_MINUTES=30
NOTIFY_PORT=8080
GIT_USER_NAME=Telegram Brain Bot
GIT_USER_EMAIL=bot@localhost
LOG_LEVEL=info
```

- [ ] **Step 7: Append bot artifacts to brain repo root `.gitignore`**

Append to `/Users/zjor/projects/second-brain-template/.gitignore`:
```
# telegram-bot build artifacts
.system/services/telegram-bot/node_modules/
.system/services/telegram-bot/dist/
.system/services/telegram-bot/.env
.system/services/telegram-bot/coverage/
.system/services/telegram-bot/*.log
```

- [ ] **Step 8: Install deps and verify**

Run from `.system/services/telegram-bot/`:
```bash
npm install
npm run typecheck
```

Expected: install succeeds, `typecheck` passes (no source yet, so it's a no-op; `tsc --noEmit` exits 0 when `include` is empty).

If `tsc` complains about no input files, add a placeholder `src/index.ts`:
```ts
export {};
```

Then re-run `npm run typecheck`. Expected: PASS.

- [ ] **Step 9: Commit**

```bash
cd /Users/zjor/projects/second-brain-template
git add .gitignore .system/services/telegram-bot/
git commit -m "feat(telegram-bot): scaffold project (package.json, tsconfig, vitest)"
```

---

## Task 2: Protocol parser — tg-block extraction

**Files:**
- Create: `.system/services/telegram-bot/src/protocol.ts`
- Create: `.system/services/telegram-bot/test/protocol.test.ts`

The parser splits stdout into `{ body, tg }` where `tg` is the parsed JSON from the trailing ` ```tg ` fenced block, or `null` if absent or malformed.

- [ ] **Step 1: Write failing test `test/protocol.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { parseClaudeOutput, type TgBlock } from "../src/protocol.js";

describe("parseClaudeOutput", () => {
  it("returns the full text as body when no tg block is present", () => {
    const stdout = "Just a plain reply.\nNo block here.";
    const { body, tg } = parseClaudeOutput(stdout);
    expect(body).toBe("Just a plain reply.\nNo block here.");
    expect(tg).toBeNull();
  });

  it("extracts and parses a trailing tg block, stripping it from body", () => {
    const stdout = [
      "Found 3 candidates.",
      "Apply?",
      "",
      "```tg",
      `{"keyboard": [[{"text": "Yes", "data": "yes"}]]}`,
      "```",
    ].join("\n");
    const { body, tg } = parseClaudeOutput(stdout);
    expect(body).toBe("Found 3 candidates.\nApply?");
    expect(tg).not.toBeNull();
    expect(tg!.keyboard).toEqual([[{ text: "Yes", data: "yes" }]]);
  });

  it("returns full stdout as body if the tg block JSON is malformed", () => {
    const stdout = "Reply text.\n\n```tg\n{not valid json\n```";
    const { body, tg } = parseClaudeOutput(stdout);
    expect(body).toBe(stdout);
    expect(tg).toBeNull();
  });

  it("ignores a tg block that is not at the trailing position", () => {
    const stdout = "```tg\n{}\n```\n\nMore prose after.";
    const { body, tg } = parseClaudeOutput(stdout);
    expect(body).toBe(stdout);
    expect(tg).toBeNull();
  });

  it("handles tg block with optional parse_mode and disable_preview", () => {
    const stdout = [
      "Hello.",
      "",
      "```tg",
      `{"parse_mode": "MarkdownV2", "disable_preview": true, "keyboard": []}`,
      "```",
    ].join("\n");
    const { tg } = parseClaudeOutput(stdout);
    expect(tg).toEqual({
      parse_mode: "MarkdownV2",
      disable_preview: true,
      keyboard: [],
    });
  });
});
```

- [ ] **Step 2: Run test and verify it fails**

```bash
npm test -- protocol
```

Expected: FAIL — `parseClaudeOutput` does not exist.

- [ ] **Step 3: Implement `src/protocol.ts`**

```ts
import { z } from "zod";

const tgButtonSchema = z.object({
  text: z.string().min(1),
  data: z.string().min(1).max(64),
});

const tgBlockSchema = z.object({
  parse_mode: z.enum(["Markdown", "MarkdownV2", "HTML"]).optional(),
  disable_preview: z.boolean().optional(),
  keyboard: z.array(z.array(tgButtonSchema)).default([]),
});

export type TgBlock = z.infer<typeof tgBlockSchema>;

export interface ParsedClaudeOutput {
  body: string;
  tg: TgBlock | null;
}

// Matches a trailing ```tg ... ``` block, optionally preceded by whitespace.
// The block must be the LAST non-whitespace content of stdout.
const TG_BLOCK_RE = /\n?```tg\s*\n([\s\S]*?)\n```\s*$/;

export function parseClaudeOutput(stdout: string): ParsedClaudeOutput {
  const match = stdout.match(TG_BLOCK_RE);
  if (!match) return { body: stdout, tg: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return { body: stdout, tg: null };
  }

  const result = tgBlockSchema.safeParse(parsed);
  if (!result.success) return { body: stdout, tg: null };

  const body = stdout.slice(0, match.index).replace(/\s+$/, "");
  return { body, tg: result.data };
}
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
npm test -- protocol
```

Expected: all 5 cases PASS.

- [ ] **Step 5: Commit**

```bash
git add .system/services/telegram-bot/src/protocol.ts \
        .system/services/telegram-bot/test/protocol.test.ts
git commit -m "feat(telegram-bot): tg-block parser with zod validation"
```

---

## Task 3: Protocol — keyboard → Telegram payload

**Files:**
- Modify: `.system/services/telegram-bot/src/protocol.ts`
- Modify: `.system/services/telegram-bot/test/protocol.test.ts`

Convert a `TgBlock.keyboard` into the `InlineKeyboardMarkup` shape grammy expects.

- [ ] **Step 1: Add failing tests to `test/protocol.test.ts`**

Append:
```ts
import { tgBlockToReplyMarkup } from "../src/protocol.js";

describe("tgBlockToReplyMarkup", () => {
  it("returns undefined when keyboard is empty", () => {
    expect(tgBlockToReplyMarkup({ keyboard: [] })).toBeUndefined();
  });

  it("maps a single-row keyboard to inline_keyboard with callback_data", () => {
    const markup = tgBlockToReplyMarkup({
      keyboard: [[{ text: "Yes", data: "yes" }, { text: "No", data: "no" }]],
    });
    expect(markup).toEqual({
      inline_keyboard: [[
        { text: "Yes", callback_data: "yes" },
        { text: "No", callback_data: "no" },
      ]],
    });
  });

  it("preserves row structure across multiple rows", () => {
    const markup = tgBlockToReplyMarkup({
      keyboard: [
        [{ text: "A", data: "a" }],
        [{ text: "B", data: "b" }, { text: "C", data: "c" }],
      ],
    });
    expect(markup?.inline_keyboard).toHaveLength(2);
    expect(markup?.inline_keyboard?.[1]).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run and verify failure**

```bash
npm test -- protocol
```

Expected: FAIL — `tgBlockToReplyMarkup` is undefined.

- [ ] **Step 3: Add the function to `src/protocol.ts`**

Append:
```ts
export interface InlineKeyboardMarkup {
  inline_keyboard: { text: string; callback_data: string }[][];
}

export function tgBlockToReplyMarkup(tg: TgBlock): InlineKeyboardMarkup | undefined {
  if (!tg.keyboard.length) return undefined;
  return {
    inline_keyboard: tg.keyboard.map((row) =>
      row.map((btn) => ({ text: btn.text, callback_data: btn.data }))
    ),
  };
}
```

- [ ] **Step 4: Run tests, verify PASS**

```bash
npm test -- protocol
```

- [ ] **Step 5: Commit**

```bash
git add .system/services/telegram-bot/src/protocol.ts \
        .system/services/telegram-bot/test/protocol.test.ts
git commit -m "feat(telegram-bot): keyboard-to-Telegram payload conversion"
```

---

## Task 4: Config loader

**Files:**
- Create: `.system/services/telegram-bot/src/config.ts`
- Create: `.system/services/telegram-bot/test/config.test.ts`

Loads env vars, validates with zod, normalizes `TG_ALLOWED_USER_IDS` from comma-separated string to `Set<number>`.

- [ ] **Step 1: Write failing tests**

`test/config.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

const baseEnv = {
  TELEGRAM_BOT_TOKEN: "123:abc",
  TG_ALLOWED_USER_IDS: "111,222",
  DEEPGRAM_API_KEY: "dg-key",
  ANTHROPIC_API_KEY: "sk-ant",
  BRAIN_REPO_URL: "git@github.com:x/y.git",
};

describe("loadConfig", () => {
  it("parses all required vars and a comma-separated allowlist", () => {
    const cfg = loadConfig(baseEnv);
    expect(cfg.telegramBotToken).toBe("123:abc");
    expect(cfg.deepgramApiKey).toBe("dg-key");
    expect(cfg.allowedUserIds.has(111)).toBe(true);
    expect(cfg.allowedUserIds.has(222)).toBe(true);
    expect(cfg.allowedUserIds.has(333)).toBe(false);
  });

  it("applies default values for optional vars", () => {
    const cfg = loadConfig(baseEnv);
    expect(cfg.sessionTtlMinutes).toBe(30);
    expect(cfg.notifyPort).toBe(8080);
    expect(cfg.gitUserName).toBe("Telegram Brain Bot");
    expect(cfg.gitUserEmail).toBe("bot@localhost");
  });

  it("overrides defaults when provided", () => {
    const cfg = loadConfig({ ...baseEnv, SESSION_TTL_MINUTES: "60", NOTIFY_PORT: "9000" });
    expect(cfg.sessionTtlMinutes).toBe(60);
    expect(cfg.notifyPort).toBe(9000);
  });

  it("throws when a required var is missing", () => {
    const { TELEGRAM_BOT_TOKEN, ...env } = baseEnv;
    expect(() => loadConfig(env)).toThrow(/TELEGRAM_BOT_TOKEN/);
  });

  it("throws when allowlist contains non-numeric ids", () => {
    expect(() => loadConfig({ ...baseEnv, TG_ALLOWED_USER_IDS: "111,abc" })).toThrow();
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```bash
npm test -- config
```

- [ ] **Step 3: Implement `src/config.ts`**

```ts
import { z } from "zod";

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TG_ALLOWED_USER_IDS: z.string().min(1),
  DEEPGRAM_API_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  BRAIN_REPO_URL: z.string().min(1),
  SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  NOTIFY_PORT: z.coerce.number().int().positive().default(8080),
  GIT_USER_NAME: z.string().default("Telegram Brain Bot"),
  GIT_USER_EMAIL: z.string().default("bot@localhost"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export interface Config {
  telegramBotToken: string;
  allowedUserIds: Set<number>;
  deepgramApiKey: string;
  anthropicApiKey: string;
  brainRepoUrl: string;
  sessionTtlMinutes: number;
  notifyPort: number;
  gitUserName: string;
  gitUserEmail: string;
  logLevel: "debug" | "info" | "warn" | "error";
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = envSchema.parse(env);
  const ids = parsed.TG_ALLOWED_USER_IDS.split(",").map((s) => s.trim()).filter(Boolean);
  const numericIds = ids.map((s) => {
    const n = Number(s);
    if (!Number.isInteger(n)) {
      throw new Error(`TG_ALLOWED_USER_IDS contains non-numeric value: "${s}"`);
    }
    return n;
  });
  return {
    telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
    allowedUserIds: new Set(numericIds),
    deepgramApiKey: parsed.DEEPGRAM_API_KEY,
    anthropicApiKey: parsed.ANTHROPIC_API_KEY,
    brainRepoUrl: parsed.BRAIN_REPO_URL,
    sessionTtlMinutes: parsed.SESSION_TTL_MINUTES,
    notifyPort: parsed.NOTIFY_PORT,
    gitUserName: parsed.GIT_USER_NAME,
    gitUserEmail: parsed.GIT_USER_EMAIL,
    logLevel: parsed.LOG_LEVEL,
  };
}
```

- [ ] **Step 4: Run tests, verify PASS**

```bash
npm test -- config
```

- [ ] **Step 5: Commit**

```bash
git add .system/services/telegram-bot/src/config.ts \
        .system/services/telegram-bot/test/config.test.ts
git commit -m "feat(telegram-bot): zod-validated env config loader"
```

---

## Task 5: Session store (SQLite)

**Files:**
- Create: `.system/services/telegram-bot/src/session.ts`
- Create: `.system/services/telegram-bot/test/session.test.ts`

Two tables: `sessions` (per-user resume pointer + TTL) and `callbacks` (long-intent mapping, populated lazily). For now we implement only `sessions`; `callbacks` ships as DDL and helpers but is otherwise unused (per design "Open Questions").

- [ ] **Step 1: Write failing tests**

`test/session.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { SessionStore } from "../src/session.js";

let store: SessionStore;

beforeEach(() => {
  store = new SessionStore(":memory:", 30);
});

describe("SessionStore", () => {
  it("returns null for a user with no session", () => {
    expect(store.get(123)).toBeNull();
  });

  it("creates and retrieves a session", () => {
    store.upsert(123, "sid-abc", 456);
    const s = store.get(123);
    expect(s).not.toBeNull();
    expect(s!.claudeSessionId).toBe("sid-abc");
    expect(s!.chatId).toBe(456);
  });

  it("updates last_active_at on touch", () => {
    store.upsert(123, "sid-abc", 456);
    const before = store.get(123)!.lastActiveAt;
    // Wait 5ms to ensure timestamp diff
    const wait = Date.now() + 5;
    while (Date.now() < wait) {}
    store.touch(123);
    const after = store.get(123)!.lastActiveAt;
    expect(after).toBeGreaterThan(before);
  });

  it("treats sessions older than TTL as expired (returns null)", () => {
    store = new SessionStore(":memory:", 0);  // TTL 0 minutes = always expired
    store.upsert(123, "sid-abc", 456);
    // Bypass: directly stale the row via the test-only helper
    store.testForceLastActiveAt(123, Date.now() - 60_000);
    expect(store.get(123)).toBeNull();
  });

  it("reset() drops the row", () => {
    store.upsert(123, "sid-abc", 456);
    store.reset(123);
    expect(store.get(123)).toBeNull();
  });

  it("stores and retrieves a callback intent", () => {
    store.putCallback(99, "tok123", "apply propagation set 1,2,3");
    expect(store.getCallback(99, "tok123")).toBe("apply propagation set 1,2,3");
  });

  it("deleteCallback removes a one-shot entry", () => {
    store.putCallback(99, "tok123", "do thing");
    store.deleteCallback(99, "tok123");
    expect(store.getCallback(99, "tok123")).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```bash
npm test -- session
```

- [ ] **Step 3: Implement `src/session.ts`**

```ts
import Database from "better-sqlite3";

export interface Session {
  tgUserId: number;
  claudeSessionId: string;
  chatId: number;
  lastActiveAt: number;
}

export class SessionStore {
  private db: Database.Database;
  private ttlMs: number;

  constructor(dbPath: string, ttlMinutes: number) {
    this.db = new Database(dbPath);
    this.ttlMs = ttlMinutes * 60_000;
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        tg_user_id        INTEGER PRIMARY KEY,
        claude_session_id TEXT NOT NULL,
        chat_id           INTEGER NOT NULL,
        last_active_at    INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS callbacks (
        message_id  INTEGER NOT NULL,
        token       TEXT NOT NULL,
        intent      TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        PRIMARY KEY (message_id, token)
      );
    `);
  }

  get(tgUserId: number): Session | null {
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE tg_user_id = ?")
      .get(tgUserId) as
      | { tg_user_id: number; claude_session_id: string; chat_id: number; last_active_at: number }
      | undefined;
    if (!row) return null;
    if (Date.now() - row.last_active_at > this.ttlMs) return null;
    return {
      tgUserId: row.tg_user_id,
      claudeSessionId: row.claude_session_id,
      chatId: row.chat_id,
      lastActiveAt: row.last_active_at,
    };
  }

  upsert(tgUserId: number, claudeSessionId: string, chatId: number): void {
    this.db
      .prepare(
        `INSERT INTO sessions (tg_user_id, claude_session_id, chat_id, last_active_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(tg_user_id) DO UPDATE SET
           claude_session_id = excluded.claude_session_id,
           chat_id           = excluded.chat_id,
           last_active_at    = excluded.last_active_at`
      )
      .run(tgUserId, claudeSessionId, chatId, Date.now());
  }

  touch(tgUserId: number): void {
    this.db
      .prepare("UPDATE sessions SET last_active_at = ? WHERE tg_user_id = ?")
      .run(Date.now(), tgUserId);
  }

  reset(tgUserId: number): void {
    this.db.prepare("DELETE FROM sessions WHERE tg_user_id = ?").run(tgUserId);
  }

  putCallback(messageId: number, token: string, intent: string): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO callbacks (message_id, token, intent, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(messageId, token, intent, Date.now());
  }

  getCallback(messageId: number, token: string): string | null {
    const row = this.db
      .prepare("SELECT intent FROM callbacks WHERE message_id = ? AND token = ?")
      .get(messageId, token) as { intent: string } | undefined;
    return row ? row.intent : null;
  }

  deleteCallback(messageId: number, token: string): void {
    this.db
      .prepare("DELETE FROM callbacks WHERE message_id = ? AND token = ?")
      .run(messageId, token);
  }

  close(): void {
    this.db.close();
  }

  // Test-only: force a session's lastActiveAt for TTL testing.
  testForceLastActiveAt(tgUserId: number, ts: number): void {
    this.db
      .prepare("UPDATE sessions SET last_active_at = ? WHERE tg_user_id = ?")
      .run(ts, tgUserId);
  }
}
```

- [ ] **Step 4: Run tests, verify PASS**

```bash
npm test -- session
```

- [ ] **Step 5: Commit**

```bash
git add .system/services/telegram-bot/src/session.ts \
        .system/services/telegram-bot/test/session.test.ts
git commit -m "feat(telegram-bot): SQLite session + callback store"
```

---

## Task 6: Git operations wrapper

**Files:**
- Create: `.system/services/telegram-bot/src/git.ts`
- Create: `.system/services/telegram-bot/test/git.test.ts`

Wraps git operations against the brain repo. Tests use a temporary git repo (no network — `pull` is tested separately as a fail-soft path).

- [ ] **Step 1: Write failing tests**

`test/git.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { GitRepo } from "../src/git.js";

function exec(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

let repoDir: string;
let git: GitRepo;

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "tg-bot-git-"));
  exec(repoDir, "init", "-q");
  exec(repoDir, "config", "user.name", "Test");
  exec(repoDir, "config", "user.email", "t@t");
  writeFileSync(join(repoDir, "seed.txt"), "seed\n");
  exec(repoDir, "add", ".");
  exec(repoDir, "commit", "-q", "-m", "seed");
  git = new GitRepo(repoDir, "Test Bot", "bot@test");
});

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

describe("GitRepo", () => {
  it("isDirty returns false for a clean working tree", async () => {
    expect(await git.isDirty()).toBe(false);
  });

  it("isDirty returns true after a file is added", async () => {
    writeFileSync(join(repoDir, "new.txt"), "hello\n");
    expect(await git.isDirty()).toBe(true);
  });

  it("commit creates a commit with the given message", async () => {
    writeFileSync(join(repoDir, "a.txt"), "a\n");
    await git.commit("tg: add a");
    const log = exec(repoDir, "log", "-1", "--pretty=%s");
    expect(log.trim()).toBe("tg: add a");
  });

  it("withLock serializes concurrent operations", async () => {
    const order: string[] = [];
    await Promise.all([
      git.withLock(async () => {
        await new Promise((r) => setTimeout(r, 20));
        order.push("first");
      }),
      git.withLock(async () => {
        order.push("second");
      }),
    ]);
    expect(order).toEqual(["first", "second"]);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```bash
npm test -- git
```

- [ ] **Step 3: Implement `src/git.ts`**

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import lockfile from "proper-lockfile";

const exec = promisify(execFile);

export class GitRepo {
  constructor(
    private readonly cwd: string,
    private readonly userName: string,
    private readonly userEmail: string,
  ) {}

  private async git(...args: string[]): Promise<{ stdout: string; stderr: string }> {
    return exec("git", args, {
      cwd: this.cwd,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: this.userName,
        GIT_AUTHOR_EMAIL: this.userEmail,
        GIT_COMMITTER_NAME: this.userName,
        GIT_COMMITTER_EMAIL: this.userEmail,
      },
    });
  }

  async isDirty(): Promise<boolean> {
    const { stdout } = await this.git("status", "--porcelain");
    return stdout.trim().length > 0;
  }

  async pull(): Promise<void> {
    await this.git("pull", "--rebase", "--autostash");
  }

  async commit(message: string): Promise<void> {
    await this.git("add", "-A");
    await this.git("commit", "-m", message);
  }

  async push(): Promise<void> {
    await this.git("push");
  }

  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const lockDir = join(this.cwd, ".git");
    if (!existsSync(lockDir)) mkdirSync(lockDir, { recursive: true });
    const release = await lockfile.lock(lockDir, {
      lockfilePath: join(lockDir, "bot.lock"),
      retries: { retries: 30, factor: 1.2, minTimeout: 100, maxTimeout: 1000 },
      stale: 5 * 60 * 1000,
    });
    try {
      return await fn();
    } finally {
      await release();
    }
  }
}

export class GitConflictError extends Error {
  constructor(public readonly stderr: string) {
    super("git pull --rebase failed (conflict)");
    this.name = "GitConflictError";
  }
}
```

- [ ] **Step 4: Run tests, verify PASS**

```bash
npm test -- git
```

- [ ] **Step 5: Commit**

```bash
git add .system/services/telegram-bot/src/git.ts \
        .system/services/telegram-bot/test/git.test.ts
git commit -m "feat(telegram-bot): git ops wrapper with proper-lockfile mutex"
```

---

## Task 7: Voice transcription via Deepgram

**Files:**
- Create: `.system/services/telegram-bot/src/voice.ts`
- Create: `.system/services/telegram-bot/test/voice.test.ts`

Wraps Deepgram's `transcribeFile` method. Mock the SDK in tests — we don't make network calls.

- [ ] **Step 1: Write failing tests**

`test/voice.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const transcribeFile = vi.fn();

vi.mock("@deepgram/sdk", () => ({
  createClient: vi.fn(() => ({
    listen: { prerecorded: { transcribeFile } },
  })),
}));

import { transcribeVoice } from "../src/voice.js";

beforeEach(() => {
  transcribeFile.mockReset();
});

describe("transcribeVoice", () => {
  it("returns transcript text on success", async () => {
    transcribeFile.mockResolvedValue({
      result: {
        results: { channels: [{ alternatives: [{ transcript: "Hello world" }] }] },
      },
      error: null,
    });
    const text = await transcribeVoice(Buffer.from("fake audio"), "key");
    expect(text).toBe("Hello world");
  });

  it("throws when Deepgram returns an error", async () => {
    transcribeFile.mockResolvedValue({
      result: null,
      error: { message: "bad audio" },
    });
    await expect(transcribeVoice(Buffer.from(""), "key")).rejects.toThrow(/bad audio/);
  });

  it("throws when transcript is empty", async () => {
    transcribeFile.mockResolvedValue({
      result: { results: { channels: [{ alternatives: [{ transcript: "" }] }] } },
      error: null,
    });
    await expect(transcribeVoice(Buffer.from(""), "key")).rejects.toThrow(/empty/i);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```bash
npm test -- voice
```

- [ ] **Step 3: Implement `src/voice.ts`**

```ts
import { createClient } from "@deepgram/sdk";

export async function transcribeVoice(audio: Buffer, apiKey: string): Promise<string> {
  const dg = createClient(apiKey);
  const { result, error } = await dg.listen.prerecorded.transcribeFile(audio, {
    model: "nova-3",
    language: "ru",
    detect_language: true,
    smart_format: true,
  });
  if (error) {
    throw new Error(`Deepgram error: ${error.message ?? JSON.stringify(error)}`);
  }
  const transcript = result?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
  if (!transcript.trim()) throw new Error("Deepgram returned empty transcript");
  return transcript;
}
```

- [ ] **Step 4: Run tests, verify PASS**

```bash
npm test -- voice
```

- [ ] **Step 5: Commit**

```bash
git add .system/services/telegram-bot/src/voice.ts \
        .system/services/telegram-bot/test/voice.test.ts
git commit -m "feat(telegram-bot): Deepgram voice transcription wrapper"
```

---

## Task 8: Claude CLI spawn

**Files:**
- Create: `.system/services/telegram-bot/src/claude.ts`
- Create: `.system/services/telegram-bot/test/claude.test.ts`
- Create: `.system/services/telegram-bot/test/fixtures/fake-claude.sh`

Spawns `claude -p --resume <sid> --append-system-prompt <path> <prompt>` and parses stdout via `protocol.parseClaudeOutput`. The session ID for a NEW session is `null` (no `--resume` flag) — Claude generates one; we read it from `--output-format json` metadata.

Reality check: the Claude Code CLI `--output-format json` flag prints a JSON envelope including session_id. We rely on that to capture the new session ID from a first turn.

- [ ] **Step 1: Create fake claude binary `test/fixtures/fake-claude.sh`**

```bash
#!/usr/bin/env bash
# Test double for the `claude` CLI. Echoes a canned JSON envelope.
# Behavior controlled by env vars:
#   FAKE_CLAUDE_STDOUT  — the assistant message text (default: "OK")
#   FAKE_CLAUDE_SID     — the session id to report (default: "sid-test")
#   FAKE_CLAUDE_EXIT    — exit code (default: 0)

stdout="${FAKE_CLAUDE_STDOUT:-OK}"
sid="${FAKE_CLAUDE_SID:-sid-test}"
exit_code="${FAKE_CLAUDE_EXIT:-0}"

# Escape the stdout for JSON
esc=$(printf '%s' "$stdout" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')

printf '{"session_id":"%s","result":%s}\n' "$sid" "$esc"
exit "$exit_code"
```

Make executable:
```bash
chmod +x .system/services/telegram-bot/test/fixtures/fake-claude.sh
```

- [ ] **Step 2: Write failing tests**

`test/claude.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { runClaude } from "../src/claude.js";

const FAKE = resolve(__dirname, "fixtures/fake-claude.sh");

describe("runClaude", () => {
  it("returns the parsed body when no tg block is emitted", async () => {
    const out = await runClaude({
      binary: FAKE,
      brainCwd: process.cwd(),
      promptPath: "/dev/null",
      prompt: "hello",
      sessionId: null,
      env: { FAKE_CLAUDE_STDOUT: "Hi there", FAKE_CLAUDE_SID: "sid-new" },
    });
    expect(out.body).toBe("Hi there");
    expect(out.tg).toBeNull();
    expect(out.sessionId).toBe("sid-new");
  });

  it("parses a tg block emitted by Claude", async () => {
    const stdout = 'Reply\n\n```tg\n{"keyboard":[[{"text":"Y","data":"y"}]]}\n```';
    const out = await runClaude({
      binary: FAKE,
      brainCwd: process.cwd(),
      promptPath: "/dev/null",
      prompt: "hi",
      sessionId: "sid-existing",
      env: { FAKE_CLAUDE_STDOUT: stdout, FAKE_CLAUDE_SID: "sid-existing" },
    });
    expect(out.body).toBe("Reply");
    expect(out.tg?.keyboard).toEqual([[{ text: "Y", data: "y" }]]);
  });

  it("throws when the binary exits nonzero", async () => {
    await expect(
      runClaude({
        binary: FAKE,
        brainCwd: process.cwd(),
        promptPath: "/dev/null",
        prompt: "hi",
        sessionId: null,
        env: { FAKE_CLAUDE_EXIT: "1" },
      })
    ).rejects.toThrow(/exit code 1/);
  });
});
```

- [ ] **Step 3: Run, verify FAIL**

```bash
npm test -- claude
```

- [ ] **Step 4: Implement `src/claude.ts`**

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseClaudeOutput, type ParsedClaudeOutput } from "./protocol.js";

const exec = promisify(execFile);

export interface RunClaudeOptions {
  binary?: string;
  brainCwd: string;
  promptPath: string;
  prompt: string;
  sessionId: string | null;
  env?: Record<string, string>;
}

export interface ClaudeRunResult extends ParsedClaudeOutput {
  sessionId: string;
}

export async function runClaude(opts: RunClaudeOptions): Promise<ClaudeRunResult> {
  const binary = opts.binary ?? "claude";
  const args = [
    "-p",
    "--output-format", "json",
    "--append-system-prompt", opts.promptPath,
  ];
  if (opts.sessionId) {
    args.push("--resume", opts.sessionId);
  }
  args.push(opts.prompt);

  let stdout: string;
  try {
    const r = await exec(binary, args, {
      cwd: opts.brainCwd,
      env: {
        ...process.env,
        TG_MODE: "1",
        ...(opts.env ?? {}),
      },
      maxBuffer: 16 * 1024 * 1024,
    });
    stdout = r.stdout;
  } catch (e: unknown) {
    const err = e as { code?: number; stderr?: string };
    throw new Error(
      `claude exit code ${err.code ?? "?"}: ${err.stderr ?? (e as Error).message}`
    );
  }

  let envelope: { session_id?: string; result?: string };
  try {
    envelope = JSON.parse(stdout);
  } catch {
    throw new Error(`claude returned non-JSON output: ${stdout.slice(0, 200)}`);
  }
  if (!envelope.session_id || typeof envelope.result !== "string") {
    throw new Error(`claude envelope missing session_id or result`);
  }

  const parsed = parseClaudeOutput(envelope.result);
  return { ...parsed, sessionId: envelope.session_id };
}
```

- [ ] **Step 5: Run tests, verify PASS**

```bash
npm test -- claude
```

- [ ] **Step 6: Commit**

```bash
git add .system/services/telegram-bot/src/claude.ts \
        .system/services/telegram-bot/test/claude.test.ts \
        .system/services/telegram-bot/test/fixtures/fake-claude.sh
git commit -m "feat(telegram-bot): Claude CLI spawn with session/protocol parsing"
```

---

## Task 9: Notify HTTP endpoint (Hono)

**Files:**
- Create: `.system/services/telegram-bot/src/notify.ts`
- Create: `.system/services/telegram-bot/test/notify.test.ts`

Hono app with one route: `POST /notify`. Body validated by zod. On success, calls a `sendMessage` callback (injected) — keeping the route decoupled from grammy for testability.

- [ ] **Step 1: Write failing tests**

`test/notify.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { createNotifyApp } from "../src/notify.js";

describe("notify app", () => {
  it("forwards a valid payload to sendMessage", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const app = createNotifyApp({ sendMessage: send });
    const res = await app.request("/notify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: 42, text: "hello", parse_mode: "MarkdownV2" }),
    });
    expect(res.status).toBe(200);
    expect(send).toHaveBeenCalledWith(42, "hello", { parse_mode: "MarkdownV2" });
  });

  it("rejects when chat_id is missing", async () => {
    const app = createNotifyApp({ sendMessage: vi.fn() });
    const res = await app.request("/notify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 500 if sendMessage throws", async () => {
    const send = vi.fn().mockRejectedValue(new Error("network"));
    const app = createNotifyApp({ sendMessage: send });
    const res = await app.request("/notify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: 1, text: "x" }),
    });
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```bash
npm test -- notify
```

- [ ] **Step 3: Implement `src/notify.ts`**

```ts
import { Hono } from "hono";
import { z } from "zod";

const notifyBody = z.object({
  chat_id: z.number().int(),
  text: z.string().min(1).max(4096),
  parse_mode: z.enum(["Markdown", "MarkdownV2", "HTML"]).optional(),
});

export interface NotifyDeps {
  sendMessage: (
    chatId: number,
    text: string,
    opts: { parse_mode?: "Markdown" | "MarkdownV2" | "HTML" },
  ) => Promise<void>;
}

export function createNotifyApp(deps: NotifyDeps) {
  const app = new Hono();
  app.post("/notify", async (c) => {
    const raw = await c.req.json().catch(() => null);
    const parsed = notifyBody.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    try {
      await deps.sendMessage(parsed.data.chat_id, parsed.data.text, {
        parse_mode: parsed.data.parse_mode,
      });
      return c.json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(JSON.stringify({ level: "error", event: "notify_send_failed", msg }));
      return c.json({ error: msg }, 500);
    }
  });
  return app;
}
```

- [ ] **Step 4: Run tests, verify PASS**

```bash
npm test -- notify
```

- [ ] **Step 5: Commit**

```bash
git add .system/services/telegram-bot/src/notify.ts \
        .system/services/telegram-bot/test/notify.test.ts
git commit -m "feat(telegram-bot): Hono /notify endpoint with zod validation"
```

---

## Task 10: Bot wiring (grammy)

**Files:**
- Create: `.system/services/telegram-bot/src/bot.ts`

The orchestrator. Wires grammy handlers to the modules built above. No standalone tests — integration coverage comes from the smoke test in Task 16.

- [ ] **Step 1: Implement `src/bot.ts`**

```ts
import { Bot, type Context } from "grammy";
import type { Config } from "./config.js";
import type { SessionStore } from "./session.js";
import type { GitRepo } from "./git.js";
import { runClaude } from "./claude.js";
import { tgBlockToReplyMarkup } from "./protocol.js";
import { transcribeVoice } from "./voice.js";

interface BotDeps {
  config: Config;
  sessions: SessionStore;
  git: GitRepo;
  brainCwd: string;
  promptPath: string;
}

function log(level: string, event: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, event, ...extra }));
}

function isAllowed(ctx: Context, allowed: Set<number>): boolean {
  return !!ctx.from && allowed.has(ctx.from.id);
}

async function downloadVoice(bot: Bot, fileId: string): Promise<Buffer> {
  const file = await bot.api.getFile(fileId);
  if (!file.file_path) throw new Error("Telegram getFile returned no file_path");
  const url = `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Voice download failed: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function commitMessage(input: string): string {
  const cleaned = input.replace(/\s+/g, " ").trim().slice(0, 60);
  return cleaned ? `tg: ${cleaned}` : `tg: claude turn ${new Date().toISOString()}`;
}

export function createBot(deps: BotDeps): Bot {
  const { config, sessions, git, brainCwd, promptPath } = deps;
  const bot = new Bot(config.telegramBotToken);

  // Allowlist middleware (silently drop).
  bot.use(async (ctx, next) => {
    if (!isAllowed(ctx, config.allowedUserIds)) {
      log("info", "allowlist_drop", { from: ctx.from?.id });
      return;
    }
    await next();
  });

  // Bot-level commands.
  bot.command("start", (ctx) =>
    ctx.reply("Brain bot ready. Send text or voice. /reset clears the session.")
  );

  bot.command("reset", (ctx) => {
    if (ctx.from) {
      sessions.reset(ctx.from.id);
      log("info", "session_reset", { from: ctx.from.id });
    }
    return ctx.reply("Session cleared.");
  });

  async function handleUserTurn(ctx: Context, text: string): Promise<void> {
    if (!ctx.from || !ctx.chat) return;
    await git.withLock(async () => {
      try {
        await git.pull();
      } catch (e) {
        log("error", "git_pull_failed", { msg: (e as Error).message });
        await ctx.reply("Sync conflict — please resolve on desktop and try again.");
        return;
      }

      const existing = sessions.get(ctx.from!.id);
      let result;
      try {
        result = await runClaude({
          brainCwd,
          promptPath,
          prompt: text,
          sessionId: existing?.claudeSessionId ?? null,
        });
      } catch (e) {
        log("error", "claude_failed", { msg: (e as Error).message });
        await ctx.reply("Internal error processing your message. Check docker logs.");
        return;
      }

      sessions.upsert(ctx.from!.id, result.sessionId, ctx.chat!.id);

      const replyMarkup = result.tg ? tgBlockToReplyMarkup(result.tg) : undefined;
      const parseMode = result.tg?.parse_mode;
      const body = result.body || "(empty)";
      try {
        await ctx.reply(body, {
          parse_mode: parseMode,
          link_preview_options: result.tg?.disable_preview
            ? { is_disabled: true }
            : undefined,
          reply_markup: replyMarkup,
        });
      } catch (e) {
        // Fallback: retry without parse_mode if formatting choked.
        log("warn", "telegram_send_retry", { msg: (e as Error).message });
        await ctx.reply(body, { reply_markup: replyMarkup });
      }

      if (await git.isDirty()) {
        await git.commit(commitMessage(text));
        try {
          await git.push();
          log("info", "git_pushed");
        } catch (e) {
          log("error", "git_push_failed", { msg: (e as Error).message });
        }
      }
    });
  }

  // Text messages (not commands).
  bot.on("message:text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) return;  // handled by command handlers
    await handleUserTurn(ctx, ctx.message.text);
  });

  // Voice messages.
  bot.on("message:voice", async (ctx) => {
    let transcript: string;
    try {
      const audio = await downloadVoice(bot, ctx.message.voice.file_id);
      transcript = await transcribeVoice(audio, config.deepgramApiKey);
    } catch (e) {
      log("error", "voice_failed", { msg: (e as Error).message });
      await ctx.reply(
        `Voice transcription failed: ${(e as Error).message}. file_id: ${ctx.message.voice.file_id}`
      );
      return;
    }
    await ctx.reply(`Heard: ${transcript}`);
    await handleUserTurn(ctx, transcript);
  });

  // Callback queries from inline keyboards.
  bot.on("callback_query:data", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (ctx.callbackQuery.message) {
      try {
        await ctx.editMessageReplyMarkup({ reply_markup: undefined });
      } catch {
        // ignore — message may be too old to edit
      }
    }
    const data = ctx.callbackQuery.data;
    const messageId = ctx.callbackQuery.message?.message_id;
    let intent = data;
    if (messageId) {
      const long = sessions.getCallback(messageId, data);
      if (long) {
        intent = long;
        sessions.deleteCallback(messageId, data);
      }
    }
    await handleUserTurn(ctx, `[user clicked: ${intent}]`);
  });

  return bot;
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add .system/services/telegram-bot/src/bot.ts
git commit -m "feat(telegram-bot): grammy bot wiring with text/voice/callback handlers"
```

---

## Task 11: Entrypoint

**Files:**
- Modify: `.system/services/telegram-bot/src/index.ts`

Replaces the placeholder. Boot sequence: load config → ensure brain repo cloned → init session store → start Hono server → start grammy long-polling. Graceful shutdown on SIGINT/SIGTERM.

- [ ] **Step 1: Replace `src/index.ts` contents**

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { SessionStore } from "./session.js";
import { GitRepo } from "./git.js";
import { createBot } from "./bot.js";
import { createNotifyApp } from "./notify.js";

const exec = promisify(execFile);

const BRAIN_CWD = "/data/brain";
const DB_PATH = "/data/db/bot.db";
const PROMPT_PATH = `${BRAIN_CWD}/.system/services/telegram-bot/prompts/telegram-mode.md`;

function log(level: string, event: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, event, ...extra }));
}

async function ensureBrainCloned(repoUrl: string): Promise<void> {
  if (existsSync(`${BRAIN_CWD}/.git`)) return;
  log("info", "cloning_brain", { repoUrl });
  await exec("git", ["clone", repoUrl, BRAIN_CWD]);
}

async function main(): Promise<void> {
  const config = loadConfig();
  log("info", "config_loaded", { allowed: config.allowedUserIds.size });

  await ensureBrainCloned(config.brainRepoUrl);

  const sessions = new SessionStore(DB_PATH, config.sessionTtlMinutes);
  const git = new GitRepo(BRAIN_CWD, config.gitUserName, config.gitUserEmail);

  const bot = createBot({
    config,
    sessions,
    git,
    brainCwd: BRAIN_CWD,
    promptPath: PROMPT_PATH,
  });

  const notifyApp = createNotifyApp({
    sendMessage: async (chatId, text, opts) => {
      await bot.api.sendMessage(chatId, text, opts);
    },
  });

  const server = serve({
    fetch: notifyApp.fetch,
    hostname: "127.0.0.1",
    port: config.notifyPort,
  });
  log("info", "notify_listening", { port: config.notifyPort });

  // Start grammy long-polling. bot.start() returns when the bot is stopped.
  void bot.start({
    onStart: (me) => log("info", "bot_started", { username: me.username }),
  });

  const shutdown = async (sig: string) => {
    log("info", "shutdown", { sig });
    await bot.stop();
    server.close();
    sessions.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((e) => {
  log("error", "fatal", { msg: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
```

- [ ] **Step 2: Typecheck and build**

```bash
npm run typecheck
npm run build
```

Expected: both PASS. `dist/index.js` is produced.

- [ ] **Step 3: Commit**

```bash
git add .system/services/telegram-bot/src/index.ts
git commit -m "feat(telegram-bot): entrypoint with boot sequence and graceful shutdown"
```

---

## Task 12: Telegram-mode system prompt

**Files:**
- Create: `.system/services/telegram-bot/prompts/telegram-mode.md`

The system prompt fragment injected via `--append-system-prompt` on every Claude spawn. This is what teaches Claude the protocol.

- [ ] **Step 1: Write the prompt file**

```markdown
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
.system/services/telegram-bot/notify-tg.sh --text "Transcription done. Summarizing..."
```

The helper takes a single `--text` (max 4096 chars) and optional `--parse-mode <Markdown|MarkdownV2|HTML>`. Use sparingly — one update per logical step is plenty.

## Skill adaptation

Skills written for desktop use may include calls to `AskUserQuestion` or similar. In Telegram mode, **substitute** those with the `tg` block protocol above. The skill's intent (approval, choice, confirmation) still applies — only the rendering changes.

For multi-question flows (e.g., several `AskUserQuestion` calls in sequence), present them one at a time across multiple turns. The user's next message (or button click) becomes the next turn's input.

## Formatting tips

- Telegram's MarkdownV2 escapes `_ * [ ] ( ) ~ > # + - = | { } . !`. If you use MarkdownV2, escape these in any literal text. If unsure, omit `parse_mode` and send plain text.
- Long lists are fine; you have 4096 chars per message. Multiple messages per turn are not supported — fit your reply in one message or use `notify-tg.sh` for streaming progress.
- Code blocks render but are monospace; use them sparingly.

## Git is managed by the bot

Do not run `git add`, `git commit`, or `git push` yourself. The bot wraps each turn in a pull/commit/push cycle. Your job is to edit files; the bot persists them.
```

- [ ] **Step 2: Commit**

```bash
git add .system/services/telegram-bot/prompts/telegram-mode.md
git commit -m "feat(telegram-bot): telegram-mode system prompt"
```

---

## Task 13: notify-tg.sh outbound helper

**Files:**
- Create: `.system/services/telegram-bot/notify-tg.sh`

A small bash wrapper around `curl` that POSTs to the bot's localhost `/notify` endpoint. Lives in the brain repo so Claude can invoke it via its built-in bash tool.

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
# notify-tg.sh — push a message to the Telegram user via the bot's /notify endpoint.
# Usage:
#   notify-tg.sh --text "Hello"
#   notify-tg.sh --text "Done" --parse-mode MarkdownV2
#
# Required env vars (set automatically by the bot container):
#   NOTIFY_PORT  — defaults to 8080
#   NOTIFY_CHAT_ID — the Telegram chat id to message
#
# Exit 0 on HTTP 200, 1 otherwise.

set -euo pipefail

text=""
parse_mode=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --text)        text="$2"; shift 2 ;;
    --parse-mode)  parse_mode="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$text" ]]; then
  echo "--text is required" >&2
  exit 2
fi

if [[ -z "${NOTIFY_CHAT_ID:-}" ]]; then
  echo "NOTIFY_CHAT_ID env var is not set" >&2
  exit 2
fi

port="${NOTIFY_PORT:-8080}"

payload=$(python3 -c '
import json, os, sys
d = {"chat_id": int(os.environ["NOTIFY_CHAT_ID"]), "text": os.environ["TEXT"]}
if os.environ.get("PARSE_MODE"):
    d["parse_mode"] = os.environ["PARSE_MODE"]
print(json.dumps(d))
' 2>/dev/null) || {
  # Python fallback: hand-roll JSON (text is escaped naively)
  esc_text=$(printf '%s' "$text" | sed 's/\\/\\\\/g; s/"/\\"/g')
  if [[ -n "$parse_mode" ]]; then
    payload="{\"chat_id\":${NOTIFY_CHAT_ID},\"text\":\"${esc_text}\",\"parse_mode\":\"${parse_mode}\"}"
  else
    payload="{\"chat_id\":${NOTIFY_CHAT_ID},\"text\":\"${esc_text}\"}"
  fi
}

# Re-export for python heredoc above
export TEXT="$text"
export PARSE_MODE="$parse_mode"

http_code=$(curl -s -o /tmp/notify-resp -w "%{http_code}" \
  -X POST "http://127.0.0.1:${port}/notify" \
  -H "content-type: application/json" \
  -d "$payload")

if [[ "$http_code" != "200" ]]; then
  echo "notify-tg.sh: HTTP $http_code" >&2
  cat /tmp/notify-resp >&2 || true
  exit 1
fi
```

- [ ] **Step 2: Make executable**

```bash
chmod +x .system/services/telegram-bot/notify-tg.sh
```

- [ ] **Step 3: Manual sanity check (no live test required)**

```bash
.system/services/telegram-bot/notify-tg.sh --text "" 2>&1 || echo "expected exit 2"
```

Expected: prints `--text is required` and exits 2.

- [ ] **Step 4: Commit**

```bash
git add .system/services/telegram-bot/notify-tg.sh
git commit -m "feat(telegram-bot): notify-tg.sh outbound helper for Claude"
```

---

## Task 14: Bot wiring — pass chat_id env to Claude

The `notify-tg.sh` helper reads `NOTIFY_CHAT_ID` from env. We need to ensure the bot passes the current chat id to Claude's environment when spawning.

**Files:**
- Modify: `.system/services/telegram-bot/src/claude.ts` (extend `RunClaudeOptions`)
- Modify: `.system/services/telegram-bot/src/bot.ts` (pass chat_id)

- [ ] **Step 1: Update `runClaude` signature to accept `chatId`**

In `src/claude.ts`, change the options interface and env construction:

```ts
export interface RunClaudeOptions {
  binary?: string;
  brainCwd: string;
  promptPath: string;
  prompt: string;
  sessionId: string | null;
  chatId?: number;
  notifyPort?: number;
  env?: Record<string, string>;
}
```

Inside `runClaude`, extend the env:

```ts
env: {
  ...process.env,
  TG_MODE: "1",
  ...(opts.chatId !== undefined ? { NOTIFY_CHAT_ID: String(opts.chatId) } : {}),
  ...(opts.notifyPort !== undefined ? { NOTIFY_PORT: String(opts.notifyPort) } : {}),
  ...(opts.env ?? {}),
},
```

- [ ] **Step 2: Update `src/bot.ts` `handleUserTurn` to pass chat id**

In the `runClaude({ ... })` call inside `handleUserTurn`, add:

```ts
chatId: ctx.chat!.id,
notifyPort: config.notifyPort,
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run existing tests, verify they still PASS**

```bash
npm test
```

- [ ] **Step 5: Commit**

```bash
git add .system/services/telegram-bot/src/claude.ts \
        .system/services/telegram-bot/src/bot.ts
git commit -m "feat(telegram-bot): pass chat_id env to Claude for notify-tg.sh"
```

---

## Task 15: Dockerfile

**Files:**
- Create: `.system/services/telegram-bot/Dockerfile`

Multi-stage: build TS in a builder image, copy `dist/` and runtime deps to a slim runtime image. Install Claude Code CLI in the runtime stage.

- [ ] **Step 1: Write `Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.7

# ---- Builder ----
FROM node:24-slim AS builder
WORKDIR /app

# Build-time deps for better-sqlite3
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Prune dev deps for a smaller runtime copy
RUN npm prune --omit=dev

# ---- Runtime ----
FROM node:24-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    git openssh-client ca-certificates curl python3 \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI (refer to the official install method).
# As of 2026-05, the recommended path is the npm package.
RUN npm install -g @anthropic-ai/claude-code

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

# Volumes are mounted by docker-compose:
#   /data/brain   — the brain repo
#   /data/db      — SQLite directory
#   /root/.claude — Claude session histories
RUN mkdir -p /data/brain /data/db /root/.claude /root/.ssh \
    && chmod 700 /root/.ssh

# Pre-trust GitHub host key so first git clone doesn't prompt
RUN ssh-keyscan -t ed25519 github.com >> /root/.ssh/known_hosts 2>/dev/null || true

ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: Build the image locally**

```bash
cd .system/services/telegram-bot
docker build -t telegram-brain-bot:dev .
```

Expected: image builds successfully. If `better-sqlite3` native compile fails, ensure the builder stage has `python3 make g++` (already in the Dockerfile above).

- [ ] **Step 3: Commit**

```bash
git add .system/services/telegram-bot/Dockerfile
git commit -m "feat(telegram-bot): Dockerfile (multi-stage Node 24 with claude CLI)"
```

---

## Task 16: docker-compose.yml

**Files:**
- Create: `.system/services/telegram-bot/docker-compose.yml`

- [ ] **Step 1: Write `docker-compose.yml`**

```yaml
services:
  telegram-brain-bot:
    build: .
    image: telegram-brain-bot:latest
    container_name: telegram-brain-bot
    restart: unless-stopped
    env_file:
      - .env
    volumes:
      - brain-data:/data/brain
      - bot-db:/data/db
      - claude-config:/root/.claude
      - ./ssh-deploy-key:/root/.ssh/id_ed25519:ro
    # /notify is bound to 127.0.0.1 inside the container; not exposed to host.
    networks:
      - bot-net

volumes:
  brain-data:
  bot-db:
  claude-config:

networks:
  bot-net:
    driver: bridge
```

Operator notes (also captured in README):
- `ssh-deploy-key` is a file path next to `docker-compose.yml` containing the private SSH key with push access to the brain repo. Set permissions to `600` on the host before `docker compose up`.
- `.env` must exist next to `docker-compose.yml` with all required vars (see `.env.example`).

- [ ] **Step 2: Validate compose syntax**

```bash
cd .system/services/telegram-bot
docker compose config > /dev/null
```

Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add .system/services/telegram-bot/docker-compose.yml
git commit -m "feat(telegram-bot): docker-compose with named volumes and SSH key mount"
```

---

## Task 17: README and smoke test

**Files:**
- Create: `.system/services/telegram-bot/README.md`

Document the deploy steps so future-you (or someone else) can reproduce it.

- [ ] **Step 1: Write the README**

````markdown
# Telegram Brain Bot

A Dockerized Node service that exposes the Second Brain repo via Telegram. Send text or voice messages; the bot pulls the repo, spawns Claude Code, and commits & pushes any changes.

See [design doc](../../docs/specs/2026-05-17-telegram-brain-bot-design.md).

## Architecture in one paragraph

The bot is the sole consumer of Telegram updates. For each user message, it acquires a git lock, pulls, spawns `claude -p --resume <sid> --append-system-prompt prompts/telegram-mode.md` from the brain repo's root, parses stdout for an optional trailing ` ```tg ` JSON block, sends the body (with inline keyboard if present), then commits + pushes any working-tree changes. Sessions are stored in SQLite (per-Telegram-user → Claude session id). Proactive notifications from Claude during long tasks go through a localhost Hono `/notify` endpoint, invoked from `notify-tg.sh`.

## Local development

```bash
# Install deps
npm install

# Copy and fill in env vars
cp .env.example .env
$EDITOR .env

# Run tests
npm test

# Run the bot against your own brain repo (without Docker)
# (You'll need claude CLI installed locally, and the repo at /data/brain
#  or a symlink. Easiest: just deploy via Docker.)
```

## Deploy on a VPS

1. SSH to the VPS. Install Docker and Docker Compose.
2. Clone the brain repo:
   ```
   git clone <brain-repo-url> /opt/brain
   cd /opt/brain/.system/services/telegram-bot
   ```
3. Create `.env` from `.env.example` and fill in:
   - `TELEGRAM_BOT_TOKEN` — from @BotFather
   - `TG_ALLOWED_USER_IDS` — your numeric Telegram user id (get it from @userinfobot)
   - `DEEPGRAM_API_KEY`
   - `ANTHROPIC_API_KEY`
   - `BRAIN_REPO_URL` — SSH URL of the brain repo
4. Place an SSH private key with push access to the brain repo at `ssh-deploy-key` next to `docker-compose.yml`. Set perms:
   ```
   chmod 600 ssh-deploy-key
   ```
5. Add the public key to the brain repo's GitHub deploy keys (with write access).
6. Build and start:
   ```
   docker compose up -d --build
   docker compose logs -f
   ```
7. Open Telegram, message the bot. First-time boot will clone the brain repo into the `brain-data` volume; subsequent messages reuse it.

## Operating

- Logs: `docker compose logs -f`
- Restart: `docker compose restart`
- Rebuild after code changes: `docker compose up -d --build`
- Wipe sessions only: `docker compose down && docker volume rm telegram-bot_bot-db && docker compose up -d`

## Smoke test

After deploy:

1. From your allowlisted Telegram account, send `/start`. Expect: "Brain bot ready..." reply.
2. Send `Hello, what do you know about me?`. Expect: a reply summarizing personal facts (drawn from `areas/user.md`).
3. Check the brain repo on GitHub — there should be no new commit (Q&A doesn't write).
4. Send a voice message: "Idea: build a CLI that wraps Stripe webhooks for local testing." Expect: a reply confirming capture, and a new commit on the brain repo with the captured idea.
5. Send `/reset`. Expect: "Session cleared." Next message starts fresh.

If any step fails, check `docker compose logs telegram-brain-bot` — all errors are logged as structured JSON.

## Files

- `src/index.ts` — boot
- `src/bot.ts` — grammy wiring (text, voice, callbacks, commands)
- `src/claude.ts` — CLI spawn + protocol parsing
- `src/git.ts` — lock, pull, commit, push
- `src/voice.ts` — Deepgram
- `src/session.ts` — SQLite store
- `src/notify.ts` — Hono /notify endpoint
- `src/protocol.ts` — tg-block parser & keyboard payload conversion
- `src/config.ts` — zod env validation
- `prompts/telegram-mode.md` — system prompt fragment injected into Claude
- `notify-tg.sh` — outbound helper Claude calls for progress updates
````

- [ ] **Step 2: Commit**

```bash
git add .system/services/telegram-bot/README.md
git commit -m "docs(telegram-bot): README with deploy steps and smoke test"
```

---

## Task 18: End-to-end manual verification

This task is not automated — it confirms the assembled system works end-to-end. Do this on a real VPS (or a local Docker daemon with a real Telegram bot token).

- [ ] **Step 1: Provision env**

On the VPS or local Docker host:
```bash
git clone <brain-repo-url> /opt/brain
cd /opt/brain/.system/services/telegram-bot
cp .env.example .env
# Fill TELEGRAM_BOT_TOKEN, TG_ALLOWED_USER_IDS, DEEPGRAM_API_KEY,
# ANTHROPIC_API_KEY, BRAIN_REPO_URL.
# Drop SSH private key as ./ssh-deploy-key (chmod 600).
```

- [ ] **Step 2: Build and boot**

```bash
docker compose up -d --build
docker compose logs -f
```

Expected log lines (JSON):
- `config_loaded`
- `cloning_brain` (first boot only) or skipped
- `notify_listening` `{port:8080}`
- `bot_started` `{username:"..."}`

- [ ] **Step 3: Smoke test 1 — `/start`**

In Telegram (from an allowlisted account):
1. Send `/start`
2. Expected reply: "Brain bot ready. Send text or voice. /reset clears the session."
3. No new commit should appear in the brain repo.

- [ ] **Step 4: Smoke test 2 — text Q&A**

1. Send `What's in inbox/braindump-log.md?`
2. Expected: Claude reads the file and replies with a summary.
3. Verify no new commit appeared on GitHub.

- [ ] **Step 5: Smoke test 3 — voice capture**

1. Send a voice message: "Idea: build a Telegram brain bot test note."
2. Expected:
   - Bot replies first with `Heard: Idea: build a Telegram brain bot test note.`
   - Then Claude's reply confirming capture.
   - A new commit on the brain repo's `master` branch with message starting `tg: Idea: build a Telegram brain bot test note...`

- [ ] **Step 6: Smoke test 4 — inline keyboard round-trip**

1. Send: `Show me a small interactive choice in the tg-block format with two buttons: Yes and No.`
2. Expected: a reply with two inline keyboard buttons.
3. Tap "Yes".
4. Expected: keyboard disappears from the original message; bot sends a follow-up reply acknowledging the click (text varies by Claude's interpretation).

- [ ] **Step 7: Smoke test 5 — `/reset`**

1. Send `/reset`
2. Expected reply: "Session cleared."
3. Next message starts a fresh Claude session (visible in `docker logs` as a new session_id).

- [ ] **Step 8: If all five smoke tests pass, mark deployment as production-ready**

If any test fails, capture the JSON log line and the user-visible reply, and debug from there. Common failure modes:
- SSH key not authorized → `git push` fails. Check `docker compose logs` for `git_push_failed`.
- Claude CLI not on PATH in the runtime image → `claude exit code 127`. Re-check the Dockerfile install step.
- Deepgram nova-3 model name changed → update `src/voice.ts`.

---

## Self-Review

**Spec coverage check:**

| Spec section | Covered by task |
|---|---|
| Architecture overview | Tasks 10, 11, 15, 16 |
| Bot service responsibilities (§Components/1) | Tasks 9 (notify), 10 (handlers), 11 (boot) |
| Telegram-mode system prompt (§2) | Task 12 |
| Telegram output protocol (§3) | Tasks 2, 3 (parser), 12 (taught to Claude) |
| Session model (§4) | Task 5 |
| Voice pipeline (§5) | Task 7 |
| Git sync (§6) | Task 6 |
| Auth (§7) | Task 10 (allowlist middleware in `createBot`) |
| Container (§8) | Tasks 15, 16 |
| Repository layout (§9) | Task 1 (skeleton) plus all subsequent tasks populating it |
| Dependencies (§10) | Task 1 |
| Error handling | Task 10 (try/catch in handlers, log + user-facing replies) |
| Testing | Tasks 2-9 (unit tests per module) + Task 18 (manual smoke) |
| Decision: long-polling | Task 11 (`bot.start()`) |
| Decision: TypeScript, Node 24 | Task 1 (tsconfig, package.json engines) |
| Decision: grammy/Hono/better-sqlite3/Deepgram | Task 1 deps + relevant impl tasks |
| Decision: desktop CLAUDE.md untouched | Implicit — only `prompts/telegram-mode.md` is added; CLAUDE.md is not modified |
| Decision: per-message commit | Task 10 (`if (await git.isDirty()) await git.commit(...)`) |
| Decision: `/reset` handled by bot | Task 10 (`bot.command("reset", ...)`) |
| Decision: `bot.db` outside the brain repo | Task 1 + 16 (volume mount at `/data/db`) |

**Placeholder scan:** No `TBD`, `TODO`, "implement later", "add error handling", or unspecified steps. Every step contains either exact code, an exact command, or a concrete file path.

**Type consistency:** Verified across tasks:
- `Config` shape (Task 4) matches consumers in Tasks 5, 6, 10, 11.
- `TgBlock`, `ParsedClaudeOutput`, `InlineKeyboardMarkup` (Tasks 2-3) match consumers in Task 10.
- `Session` shape (Task 5) matches consumer in Task 10.
- `RunClaudeOptions` (Task 8, extended in Task 14) matches caller in Task 10.
- `NotifyDeps.sendMessage` signature (Task 9) matches the implementation in Task 11.

**Architecture gap check:**
- Spec mentions optional callback intent table — addressed in Task 5 (table created), Task 10 (lookup on callback_query). The "Claude generates short tokens, no map lookup needed in MVP" simplification is preserved: `sessions.getCallback()` returns null for unmapped tokens, and the click handler defaults to using `data` verbatim.
- Spec mentions structured logging to stderr → docker logs. Each module logs structured JSON via the `log()` helper (Tasks 10, 11) or `console.error` (Task 9 for notify failures).

No unaddressed spec items found.
