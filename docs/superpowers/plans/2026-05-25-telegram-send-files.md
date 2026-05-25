# Telegram Bot — Send Files Back to User — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Claude send files from the brain repo back to the user through Telegram via a `POST /send-file` HTTP endpoint and a `/app/send-file-tg.sh` helper script.

**Architecture:** New Hono route `/send-file` factored as `createSendFileApp({ brainRoot, sendDocument, sendPhoto })`. Server-side path containment via `realpath`, kind-specific size caps, inline caption MarkdownV2 conversion. Helper script mirrors `notify-tg.sh` (POSTs to `127.0.0.1:${NOTIFY_PORT}`). Mounted into the existing Hono app alongside `/notify`; single `serve()` call.

**Tech Stack:** TypeScript, Node 24, Hono, grammy, Zod, telegramify-markdown, vitest.

**Spec:** `docs/superpowers/specs/2026-05-25-telegram-send-files-design.md`

**Working directory:** All commands run from `.system/services/telegram-bot/` unless noted.

---

## File Structure

**New files:**
- `.system/services/telegram-bot/src/send-file.ts` — `createSendFileApp` Hono factory + path/size/caption validation.
- `.system/services/telegram-bot/test/send-file.test.ts` — vitest unit tests with mocked grammy + tmpdir brainRoot.
- `.system/services/telegram-bot/send-file-tg.sh` — bash helper invoked by Claude.

**Modified files:**
- `.system/services/telegram-bot/src/index.ts` — wire `createSendFileApp` into the existing Hono server.
- `.system/services/telegram-bot/Dockerfile` — `COPY` + `chmod +x` the new helper.
- `.system/services/telegram-bot/prompts/telegram-mode.md` — new section "Sending files back to user".
- `.system/services/telegram-bot/ROADMAP.md` — mark feature `[x]`.

---

## Task 1: Module skeleton — happy path for `document`

**Files:**
- Create: `.system/services/telegram-bot/src/send-file.ts`
- Test: `.system/services/telegram-bot/test/send-file.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/send-file.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSendFileApp } from "../src/send-file";

function makeDeps(overrides: Partial<{
  sendDocument: ReturnType<typeof vi.fn>;
  sendPhoto: ReturnType<typeof vi.fn>;
  brainRoot: string;
}> = {}) {
  return {
    brainRoot: overrides.brainRoot ?? "/data/brain",
    sendDocument: overrides.sendDocument ?? vi.fn().mockResolvedValue(undefined),
    sendPhoto: overrides.sendPhoto ?? vi.fn().mockResolvedValue(undefined),
  };
}

describe("send-file app", () => {
  let brainRoot: string;

  beforeEach(() => {
    brainRoot = mkdtempSync(join(tmpdir(), "brain-"));
  });
  afterEach(() => {
    rmSync(brainRoot, { recursive: true, force: true });
  });

  it("sends a document for a valid in-brain path", async () => {
    const filePath = join(brainRoot, "inbox", "files", "report.pdf");
    mkdirSync(join(brainRoot, "inbox", "files"), { recursive: true });
    writeFileSync(filePath, Buffer.from("PDFDATA"));

    const deps = makeDeps({ brainRoot });
    const app = createSendFileApp(deps);
    const res = await app.request("/send-file", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: 42,
        path: filePath,
        kind: "document",
      }),
    });

    expect(res.status).toBe(200);
    expect(deps.sendDocument).toHaveBeenCalledTimes(1);
    const call = deps.sendDocument.mock.calls[0];
    expect(call[0]).toBe(42);                               // chat_id
    expect((call[1] as Buffer).equals(Buffer.from("PDFDATA"))).toBe(true);
    expect(call[2]).toBe("report.pdf");                     // filename
    expect(call[3]).toEqual({});                            // no caption → empty opts
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test -- send-file
```
Expected: FAIL with `Cannot find module '../src/send-file'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/send-file.ts`:

```ts
import { Hono } from "hono";
import { z } from "zod";
import { realpathSync, statSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import telegramifyMarkdown from "telegramify-markdown";

const sendFileBody = z.object({
  chat_id: z.number().int(),
  path: z.string().min(1),
  kind: z.enum(["document", "photo"]),
  caption: z.string().max(1024).optional(),
  parse_mode: z.enum(["Markdown", "MarkdownV2", "HTML"]).optional(),
});

export interface SendFileDeps {
  brainRoot: string;
  sendDocument: (
    chatId: number,
    buf: Buffer,
    filename: string,
    opts: { caption?: string; parse_mode?: "MarkdownV2" | "HTML" }
  ) => Promise<void>;
  sendPhoto: (
    chatId: number,
    buf: Buffer,
    filename: string,
    opts: { caption?: string; parse_mode?: "MarkdownV2" | "HTML" }
  ) => Promise<void>;
}

function log(level: string, event: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, event, ...extra }));
}

function renderCaption(
  caption: string | undefined,
  parseMode: "Markdown" | "MarkdownV2" | "HTML" | undefined
): { caption?: string; parse_mode?: "MarkdownV2" | "HTML" } {
  if (caption === undefined) return {};
  if (parseMode === "HTML") return { caption, parse_mode: "HTML" };
  return { caption: telegramifyMarkdown(caption, "escape"), parse_mode: "MarkdownV2" };
}

export function createSendFileApp(deps: SendFileDeps) {
  const app = new Hono();
  app.post("/send-file", async (c) => {
    const raw = await c.req.json().catch(() => null);
    const parsed = sendFileBody.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const { chat_id, path, kind, caption, parse_mode } = parsed.data;

    const buf = readFileSync(realpathSync(path));
    const filename = basename(realpathSync(path));
    const opts = renderCaption(caption, parse_mode);

    try {
      if (kind === "document") {
        await deps.sendDocument(chat_id, buf, filename, opts);
      } else {
        await deps.sendPhoto(chat_id, buf, filename, opts);
      }
      return c.json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log("error", "send_file_failed", { path, kind, msg });
      return c.json({ error: msg }, 502);
    }
  });
  return app;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test -- send-file
```
Expected: PASS — 1 test.

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add .system/services/telegram-bot/src/send-file.ts .system/services/telegram-bot/test/send-file.test.ts
git commit -m "feat(telegram-bot): /send-file route skeleton with document happy path"
```

---

## Task 2: Photo support

**Files:**
- Modify: `.system/services/telegram-bot/test/send-file.test.ts` (already covered by Task 1 module switch — add a photo case)

- [ ] **Step 1: Write the failing test**

Append inside the `describe` block of `test/send-file.test.ts`:

```ts
  it("sends a photo for a valid in-brain path", async () => {
    const filePath = join(brainRoot, "sunset.jpg");
    writeFileSync(filePath, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));

    const deps = makeDeps({ brainRoot });
    const app = createSendFileApp(deps);
    const res = await app.request("/send-file", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: 7,
        path: filePath,
        kind: "photo",
      }),
    });

    expect(res.status).toBe(200);
    expect(deps.sendPhoto).toHaveBeenCalledTimes(1);
    expect(deps.sendDocument).not.toHaveBeenCalled();
    const call = deps.sendPhoto.mock.calls[0];
    expect(call[0]).toBe(7);
    expect((call[1] as Buffer).length).toBe(4);
    expect(call[2]).toBe("sunset.jpg");
    expect(call[3]).toEqual({});  // no caption → empty opts
  });
```

- [ ] **Step 2: Run test to verify it passes (kind switch already in Task 1 code)**

```bash
pnpm test -- send-file
```
Expected: PASS — 2 tests. (Task 1's implementation already branches on `kind`.)

- [ ] **Step 3: Commit**

```bash
git add .system/services/telegram-bot/test/send-file.test.ts
git commit -m "test(telegram-bot): cover photo kind in /send-file"
```

---

## Task 3: Path containment + existence validation

**Files:**
- Modify: `.system/services/telegram-bot/src/send-file.ts`
- Modify: `.system/services/telegram-bot/test/send-file.test.ts`

- [ ] **Step 1: Write the failing tests**

Append inside the `describe` block:

```ts
  it("rejects path outside brainRoot with 403", async () => {
    const outside = mkdtempSync(join(tmpdir(), "outside-"));
    const filePath = join(outside, "secret.txt");
    writeFileSync(filePath, "shh");

    const deps = makeDeps({ brainRoot });
    const app = createSendFileApp(deps);
    const res = await app.request("/send-file", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: 1, path: filePath, kind: "document" }),
    });

    expect(res.status).toBe(403);
    expect(deps.sendDocument).not.toHaveBeenCalled();
    rmSync(outside, { recursive: true, force: true });
  });

  it("rejects a symlink that escapes brainRoot with 403", async () => {
    const outside = mkdtempSync(join(tmpdir(), "outside-"));
    const target = join(outside, "real.txt");
    writeFileSync(target, "shh");

    const link = join(brainRoot, "link.txt");
    const { symlinkSync } = await import("node:fs");
    symlinkSync(target, link);

    const deps = makeDeps({ brainRoot });
    const app = createSendFileApp(deps);
    const res = await app.request("/send-file", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: 1, path: link, kind: "document" }),
    });

    expect(res.status).toBe(403);
    expect(deps.sendDocument).not.toHaveBeenCalled();
    rmSync(outside, { recursive: true, force: true });
  });

  it("rejects path that does not exist with 404", async () => {
    const deps = makeDeps({ brainRoot });
    const app = createSendFileApp(deps);
    const res = await app.request("/send-file", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: 1,
        path: join(brainRoot, "nope.txt"),
        kind: "document",
      }),
    });
    expect(res.status).toBe(404);
    expect(deps.sendDocument).not.toHaveBeenCalled();
  });

  it("rejects a directory path with 404", async () => {
    mkdirSync(join(brainRoot, "adir"));
    const deps = makeDeps({ brainRoot });
    const app = createSendFileApp(deps);
    const res = await app.request("/send-file", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: 1,
        path: join(brainRoot, "adir"),
        kind: "document",
      }),
    });
    expect(res.status).toBe(404);
    expect(deps.sendDocument).not.toHaveBeenCalled();
  });

  it("rejects payload missing required fields with 400", async () => {
    const deps = makeDeps({ brainRoot });
    const app = createSendFileApp(deps);
    const res = await app.request("/send-file", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: 1, kind: "document" }), // missing path
    });
    expect(res.status).toBe(400);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- send-file
```
Expected: FAIL — current handler throws on missing files / never checks containment.

- [ ] **Step 3: Add a `validateBrainPath` helper and call it in the handler**

Replace the body of the `app.post("/send-file", ...)` handler in `src/send-file.ts` so that path resolution happens before reading the file. Final file:

```ts
import { Hono } from "hono";
import { z } from "zod";
import { realpathSync, statSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import telegramifyMarkdown from "telegramify-markdown";

const sendFileBody = z.object({
  chat_id: z.number().int(),
  path: z.string().min(1),
  kind: z.enum(["document", "photo"]),
  caption: z.string().max(1024).optional(),
  parse_mode: z.enum(["Markdown", "MarkdownV2", "HTML"]).optional(),
});

export interface SendFileDeps {
  brainRoot: string;
  sendDocument: (
    chatId: number,
    buf: Buffer,
    filename: string,
    opts: { caption?: string; parse_mode?: "MarkdownV2" | "HTML" }
  ) => Promise<void>;
  sendPhoto: (
    chatId: number,
    buf: Buffer,
    filename: string,
    opts: { caption?: string; parse_mode?: "MarkdownV2" | "HTML" }
  ) => Promise<void>;
}

function log(level: string, event: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, event, ...extra }));
}

function renderCaption(
  caption: string | undefined,
  parseMode: "Markdown" | "MarkdownV2" | "HTML" | undefined
): { caption?: string; parse_mode?: "MarkdownV2" | "HTML" } {
  if (caption === undefined) return {};
  if (parseMode === "HTML") return { caption, parse_mode: "HTML" };
  return { caption: telegramifyMarkdown(caption, "escape"), parse_mode: "MarkdownV2" };
}

type ResolveResult =
  | { ok: true; resolved: string; size: number }
  | { ok: false; status: 403 | 404 };

function resolveBrainPath(rawPath: string, brainRoot: string): ResolveResult {
  let resolved: string;
  try {
    resolved = realpathSync(rawPath);
  } catch {
    return { ok: false, status: 404 };
  }
  const prefix = brainRoot.endsWith("/") ? brainRoot : brainRoot + "/";
  if (!(resolved + "/").startsWith(prefix)) {
    return { ok: false, status: 403 };
  }
  let stat;
  try {
    stat = statSync(resolved);
  } catch {
    return { ok: false, status: 404 };
  }
  if (!stat.isFile()) return { ok: false, status: 404 };
  return { ok: true, resolved, size: stat.size };
}

export function createSendFileApp(deps: SendFileDeps) {
  const app = new Hono();
  app.post("/send-file", async (c) => {
    const raw = await c.req.json().catch(() => null);
    const parsed = sendFileBody.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const { chat_id, path, kind, caption, parse_mode } = parsed.data;

    const r = resolveBrainPath(path, deps.brainRoot);
    if (!r.ok) {
      log("warn", "send_file_rejected", { path, kind, status: r.status });
      return c.json({ error: r.status === 403 ? "forbidden" : "not_found" }, r.status);
    }

    const buf = readFileSync(r.resolved);
    const filename = basename(r.resolved);
    const opts = renderCaption(caption, parse_mode);

    try {
      if (kind === "document") {
        await deps.sendDocument(chat_id, buf, filename, opts);
      } else {
        await deps.sendPhoto(chat_id, buf, filename, opts);
      }
      return c.json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log("error", "send_file_failed", { path, kind, msg });
      return c.json({ error: msg }, 502);
    }
  });
  return app;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test -- send-file
```
Expected: PASS — 7 tests so far (2 happy + 5 new).

- [ ] **Step 5: Commit**

```bash
git add .system/services/telegram-bot/src/send-file.ts .system/services/telegram-bot/test/send-file.test.ts
git commit -m "feat(telegram-bot): path containment + existence checks for /send-file"
```

---

## Task 4: Kind-specific size caps

**Files:**
- Modify: `.system/services/telegram-bot/src/send-file.ts`
- Modify: `.system/services/telegram-bot/test/send-file.test.ts`

- [ ] **Step 1: Write the failing tests**

Append inside the `describe` block:

```ts
  it("rejects document larger than 50 MB with 413", async () => {
    const filePath = join(brainRoot, "big.bin");
    // 50 MB + 1 byte. Use a sparse-ish allocation: Buffer.alloc(1) won't catch
    // size; we lie about size using truncate.
    const { openSync, ftruncateSync, closeSync } = await import("node:fs");
    const fd = openSync(filePath, "w");
    ftruncateSync(fd, 50 * 1024 * 1024 + 1);
    closeSync(fd);

    const deps = makeDeps({ brainRoot });
    const app = createSendFileApp(deps);
    const res = await app.request("/send-file", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: 1, path: filePath, kind: "document" }),
    });
    expect(res.status).toBe(413);
    expect(deps.sendDocument).not.toHaveBeenCalled();
  });

  it("rejects photo larger than 10 MB with 413", async () => {
    const filePath = join(brainRoot, "big.jpg");
    const { openSync, ftruncateSync, closeSync } = await import("node:fs");
    const fd = openSync(filePath, "w");
    ftruncateSync(fd, 10 * 1024 * 1024 + 1);
    closeSync(fd);

    const deps = makeDeps({ brainRoot });
    const app = createSendFileApp(deps);
    const res = await app.request("/send-file", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: 1, path: filePath, kind: "photo" }),
    });
    expect(res.status).toBe(413);
    expect(deps.sendPhoto).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- send-file
```
Expected: FAIL — size cap not enforced; handler returns 200.

- [ ] **Step 3: Add size cap check in handler**

In `src/send-file.ts`, add a constant block near the top (after imports):

```ts
const MAX_BYTES: Record<"document" | "photo", number> = {
  document: 50 * 1024 * 1024,
  photo:    10 * 1024 * 1024,
};
```

In the handler, after the `resolveBrainPath` block and before `readFileSync`, add:

```ts
    if (r.size > MAX_BYTES[kind]) {
      log("warn", "send_file_too_large", { path, kind, size: r.size });
      return c.json({ error: "file_too_large", size: r.size, max: MAX_BYTES[kind] }, 413);
    }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test -- send-file
```
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add .system/services/telegram-bot/src/send-file.ts .system/services/telegram-bot/test/send-file.test.ts
git commit -m "feat(telegram-bot): enforce 50MB/10MB caps in /send-file by kind"
```

---

## Task 5: Caption length + parse_mode conversion

**Files:**
- Modify: `.system/services/telegram-bot/test/send-file.test.ts`

`renderCaption` and the 1024 schema cap are already implemented in Task 1 + Task 3. This task locks the behavior in tests.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe` block:

```ts
  it("rejects caption longer than 1024 chars with 400", async () => {
    const filePath = join(brainRoot, "x.pdf");
    writeFileSync(filePath, "x");

    const deps = makeDeps({ brainRoot });
    const app = createSendFileApp(deps);
    const res = await app.request("/send-file", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: 1,
        path: filePath,
        kind: "document",
        caption: "x".repeat(1025),
      }),
    });
    expect(res.status).toBe(400);
    expect(deps.sendDocument).not.toHaveBeenCalled();
  });

  it("converts default-mode caption to MarkdownV2 via telegramify-markdown", async () => {
    const filePath = join(brainRoot, "y.pdf");
    writeFileSync(filePath, "y");

    const deps = makeDeps({ brainRoot });
    const app = createSendFileApp(deps);
    const res = await app.request("/send-file", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: 1,
        path: filePath,
        kind: "document",
        caption: "Hello *world* (test)",
      }),
    });
    expect(res.status).toBe(200);
    const opts = deps.sendDocument.mock.calls[0][3] as { caption: string; parse_mode: string };
    expect(opts.parse_mode).toBe("MarkdownV2");
    // telegramify-markdown escapes parentheses for MarkdownV2.
    expect(opts.caption).toContain("\\(");
    expect(opts.caption).toContain("\\)");
  });

  it("passes HTML caption through unchanged with parse_mode HTML", async () => {
    const filePath = join(brainRoot, "z.pdf");
    writeFileSync(filePath, "z");

    const deps = makeDeps({ brainRoot });
    const app = createSendFileApp(deps);
    const html = "<b>bold</b> &amp; safe";
    const res = await app.request("/send-file", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: 1,
        path: filePath,
        kind: "document",
        caption: html,
        parse_mode: "HTML",
      }),
    });
    expect(res.status).toBe(200);
    expect(deps.sendDocument.mock.calls[0][3]).toEqual({
      caption: html,
      parse_mode: "HTML",
    });
  });
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
pnpm test -- send-file
```
Expected: PASS — 12 tests. (No source changes needed; Task 1's `renderCaption` and Task 3's Zod `caption: max(1024)` already cover this.)

- [ ] **Step 3: Commit**

```bash
git add .system/services/telegram-bot/test/send-file.test.ts
git commit -m "test(telegram-bot): lock caption length + parse_mode behavior in /send-file"
```

---

## Task 6: Telegram API error → 502

**Files:**
- Modify: `.system/services/telegram-bot/test/send-file.test.ts`

`try`/`catch` is already in Task 1. This task asserts the surface contract.

- [ ] **Step 1: Write the failing test**

Append:

```ts
  it("returns 502 if the Telegram API call throws", async () => {
    const filePath = join(brainRoot, "fail.pdf");
    writeFileSync(filePath, "x");

    const deps = makeDeps({
      brainRoot,
      sendDocument: vi.fn().mockRejectedValue(new Error("network down")),
    });
    const app = createSendFileApp(deps);
    const res = await app.request("/send-file", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: 1, path: filePath, kind: "document" }),
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("network down");
  });
```

- [ ] **Step 2: Run test to verify it passes**

```bash
pnpm test -- send-file
```
Expected: PASS — 13 tests.

- [ ] **Step 3: Commit**

```bash
git add .system/services/telegram-bot/test/send-file.test.ts
git commit -m "test(telegram-bot): assert 502 on Telegram send failure"
```

---

## Task 7: Mount `/send-file` in the Hono server

**Files:**
- Modify: `.system/services/telegram-bot/src/index.ts`

- [ ] **Step 1: Edit `src/index.ts`**

Add the `createSendFileApp` import alongside `createNotifyApp`:

```ts
import { createNotifyApp } from "./notify";
import { createSendFileApp } from "./send-file";
import { InputFile } from "grammy";
```

Replace the block that constructs `notifyApp` and calls `serve(...)`:

```ts
  const notifyApp = createNotifyApp({
    sendMessage: async (chatId, text, opts) => {
      await bot.api.sendMessage(chatId, text, opts);
    },
  });

  const sendFileApp = createSendFileApp({
    brainRoot: BRAIN_CWD,
    sendDocument: async (chatId, buf, name, opts) => {
      await bot.api.sendDocument(chatId, new InputFile(buf, name), opts);
    },
    sendPhoto: async (chatId, buf, name, opts) => {
      await bot.api.sendPhoto(chatId, new InputFile(buf, name), opts);
    },
  });
  notifyApp.route("/", sendFileApp);

  const server = serve({
    fetch: notifyApp.fetch,
    hostname: "127.0.0.1",
    port: config.notifyPort,
  });
  log("info", "notify_listening", { port: config.notifyPort });
```

- [ ] **Step 2: Typecheck + run all tests**

```bash
pnpm typecheck && pnpm test
```
Expected: typecheck clean; all existing + new tests pass.

- [ ] **Step 3: Build**

```bash
pnpm build
```
Expected: `dist/index.js` produced without errors.

- [ ] **Step 4: Commit**

```bash
git add .system/services/telegram-bot/src/index.ts
git commit -m "feat(telegram-bot): mount /send-file route in Hono server"
```

---

## Task 8: `send-file-tg.sh` helper script

**Files:**
- Create: `.system/services/telegram-bot/send-file-tg.sh`

- [ ] **Step 1: Create the helper**

Create `.system/services/telegram-bot/send-file-tg.sh`:

```bash
#!/usr/bin/env bash
# send-file-tg.sh — push a file to the Telegram user via the bot's /send-file endpoint.
# Usage:
#   send-file-tg.sh --document /data/brain/inbox/files/x.pdf
#   send-file-tg.sh --photo    /data/brain/inbox/files/sunset.jpg --caption "Sunset"
#   send-file-tg.sh --document /data/brain/notes/x.md --caption "Notes" --parse-mode MarkdownV2
#
# Required env vars (set automatically by the bot container):
#   NOTIFY_PORT     — defaults to 8080
#   NOTIFY_CHAT_ID  — the Telegram chat id to message
#
# Exit 0 on HTTP 200, 1 otherwise. Server error body echoed to stderr.

set -euo pipefail

kind=""
path=""
caption=""
parse_mode=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --document)    kind="document"; path="$2"; shift 2 ;;
    --photo)       kind="photo";    path="$2"; shift 2 ;;
    --caption)     caption="$2"; shift 2 ;;
    --parse-mode)  parse_mode="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$kind" || -z "$path" ]]; then
  echo "exactly one of --document <path> or --photo <path> is required" >&2
  exit 2
fi

if [[ -z "${NOTIFY_CHAT_ID:-}" ]]; then
  echo "NOTIFY_CHAT_ID env var is not set" >&2
  exit 2
fi

port="${NOTIFY_PORT:-8080}"

export PATH_ARG="$path"
export KIND="$kind"
export CAPTION="$caption"
export PARSE_MODE="$parse_mode"

payload=$(python3 -c '
import json, os
d = {
  "chat_id": int(os.environ["NOTIFY_CHAT_ID"]),
  "path": os.environ["PATH_ARG"],
  "kind": os.environ["KIND"],
}
if os.environ.get("CAPTION"):
    d["caption"] = os.environ["CAPTION"]
if os.environ.get("PARSE_MODE"):
    d["parse_mode"] = os.environ["PARSE_MODE"]
print(json.dumps(d))
' 2>/dev/null) || {
  echo "send-file-tg.sh: failed to build JSON payload (python3 missing?)" >&2
  exit 2
}

http_code=$(curl -s -o /tmp/send-file-resp -w "%{http_code}" \
  -X POST "http://127.0.0.1:${port}/send-file" \
  -H "content-type: application/json" \
  -d "$payload")

if [[ "$http_code" != "200" ]]; then
  echo "send-file-tg.sh: HTTP $http_code" >&2
  cat /tmp/send-file-resp >&2 || true
  exit 1
fi
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x .system/services/telegram-bot/send-file-tg.sh
```

- [ ] **Step 3: Smoke test the arg parser locally (no server required)**

```bash
NOTIFY_CHAT_ID=1 NOTIFY_PORT=1 .system/services/telegram-bot/send-file-tg.sh --document /tmp/nope 2>&1 | head -5 || true
```
Expected: `send-file-tg.sh: HTTP 000` (or curl connection refused). The script reaches the curl call, proving arg parsing works. We don't need an exit-0 here.

```bash
.system/services/telegram-bot/send-file-tg.sh 2>&1 | head -1
```
Expected: `exactly one of --document <path> or --photo <path> is required`.

- [ ] **Step 4: Commit**

```bash
git add .system/services/telegram-bot/send-file-tg.sh
git commit -m "feat(telegram-bot): send-file-tg.sh outbound helper for Claude"
```

---

## Task 9: Dockerfile — copy the helper

**Files:**
- Modify: `.system/services/telegram-bot/Dockerfile`

- [ ] **Step 1: Edit `Dockerfile`**

In `.system/services/telegram-bot/Dockerfile`, locate lines 44-45:

```dockerfile
COPY --chown=bot:bot notify-tg.sh ./notify-tg.sh
RUN chmod +x /app/notify-tg.sh
```

Replace with:

```dockerfile
COPY --chown=bot:bot notify-tg.sh ./notify-tg.sh
COPY --chown=bot:bot send-file-tg.sh ./send-file-tg.sh
RUN chmod +x /app/notify-tg.sh /app/send-file-tg.sh
```

- [ ] **Step 2: Build the image locally to confirm**

```bash
cd .system/services/telegram-bot && docker build -t telegram-brain-bot:test .
```
Expected: build succeeds; the image contains `/app/send-file-tg.sh`. Verify:

```bash
docker run --rm telegram-brain-bot:test ls -l /app/send-file-tg.sh
```
Expected output line includes `-rwx` permission bits.

- [ ] **Step 3: Commit**

```bash
git add .system/services/telegram-bot/Dockerfile
git commit -m "build(telegram-bot): bake send-file-tg.sh into image"
```

---

## Task 10: Prompt update — `telegram-mode.md`

**Files:**
- Modify: `.system/services/telegram-bot/prompts/telegram-mode.md`

- [ ] **Step 1: Insert a new section**

In `prompts/telegram-mode.md`, locate the end of the "Sending progress updates during long tasks" section (after the line about "one update per logical step is plenty.") and insert this new section directly before `## Skill adaptation`:

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add .system/services/telegram-bot/prompts/telegram-mode.md
git commit -m "docs(telegram-bot): teach Claude to use send-file-tg.sh"
```

---

## Task 11: ROADMAP — mark feature shipped

**Files:**
- Modify: `.system/services/telegram-bot/ROADMAP.md`

- [ ] **Step 1: Edit ROADMAP**

In `.system/services/telegram-bot/ROADMAP.md`, change line 7 from:

```markdown
### [ ] Send files from bot to user
```

to:

```markdown
### [x] Send files from bot to user
```

- [ ] **Step 2: Commit**

```bash
git add .system/services/telegram-bot/ROADMAP.md
git commit -m "docs(telegram-bot): mark send-files feature shipped in roadmap"
```

---

## Final Verification

- [ ] **Run the full test suite**

```bash
cd .system/services/telegram-bot && pnpm test
```
Expected: all tests pass (existing + 13 new `send-file` cases).

- [ ] **Typecheck**

```bash
pnpm typecheck
```
Expected: no errors.

- [ ] **Build**

```bash
pnpm build
```
Expected: `dist/index.js` regenerated cleanly.

- [ ] **Manual smoke test (post-deploy, optional)**

After deploying the new image:
1. Drop a small PDF into `inbox/files/` via the bot (existing upload flow).
2. In the bot chat, message: "Send me back the PDF you just got."
3. Expect: a Telegram message with the PDF attached, followed by Claude's text reply.

If the file does not arrive, check container logs for `send_file_failed` /
`send_file_rejected` entries.
