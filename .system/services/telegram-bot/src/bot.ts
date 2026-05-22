import { Bot, type Context, InlineKeyboard } from "grammy";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config";
import type { SessionStore } from "./session";
import type { GitRepo } from "./git";
import { runClaude } from "./claude";
import { tgBlockToReplyMarkup } from "./protocol";
import { transcribeVoice } from "./voice";
import {
  ensureUniqueFilename,
  extFromMime,
  generatePhotoFilename,
  sanitizeFilename,
} from "./upload";
import telegramifyMarkdown from "telegramify-markdown";

function renderForTelegram(
  body: string,
  parseMode: "Markdown" | "MarkdownV2" | "HTML" | undefined
): { text: string; parse_mode: "MarkdownV2" | "HTML" | undefined } {
  // HTML: trust Claude — pass through.
  if (parseMode === "HTML") return { text: body, parse_mode: "HTML" };
  // Default + legacy "Markdown" + explicit "MarkdownV2": convert via telegramify-markdown.
  return { text: telegramifyMarkdown(body, "escape"), parse_mode: "MarkdownV2" };
}

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

function startTypingHeartbeat(bot: Bot, chatId: number): () => void {
  let stopped = false;
  const beat = () => {
    if (stopped) return;
    bot.api.sendChatAction(chatId, "typing").catch(() => {});
  };
  beat();
  const id = setInterval(beat, 4000);
  return () => {
    stopped = true;
    clearInterval(id);
  };
}

async function downloadTelegramFile(bot: Bot, fileId: string): Promise<Buffer> {
  const file = await bot.api.getFile(fileId);
  if (!file.file_path) throw new Error("Telegram getFile returned no file_path");
  const url = `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`File download failed: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function commitMessage(input: string): string {
  const cleaned = input.replace(/\s+/g, " ").trim().slice(0, 60);
  return cleaned ? `tg: ${cleaned}` : `tg: claude turn ${new Date().toISOString()}`;
}

function preview(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
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

  // Per-user FIFO queue: serializes message handling for the same user.
  const userQueues = new Map<number, Promise<unknown>>();
  function enqueueUserWork<T>(userId: number, work: () => Promise<T>): Promise<T> {
    const tail = userQueues.get(userId) ?? Promise.resolve();
    const next = tail.then(work, work);
    userQueues.set(
      userId,
      next.catch(() => {})
    );
    return next as Promise<T>;
  }

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
    const stopTyping = startTypingHeartbeat(bot, ctx.chat.id);
    try {
    try {
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
      const startedAt = Date.now();
      log("info", "claude_invoke", {
        from: ctx.from!.id,
        chat_id: ctx.chat!.id,
        session_id: existing?.claudeSessionId ?? "new",
        prompt_len: text.length,
        prompt_preview: preview(text, 80),
      });
      try {
        result = await runClaude({
          brainCwd,
          promptPath,
          prompt: text,
          sessionId: existing?.claudeSessionId ?? null,
          chatId: ctx.chat!.id,
          notifyPort: config.notifyPort,
        });
      } catch (e) {
        log("error", "claude_failed", {
          from: ctx.from!.id,
          duration_ms: Date.now() - startedAt,
          msg: (e as Error).message,
        });
        await ctx.reply("Internal error processing your message. Check docker logs.");
        return;
      }
      log("info", "claude_response", {
        from: ctx.from!.id,
        session_id: result.sessionId,
        duration_ms: Date.now() - startedAt,
        body_len: result.body.length,
        body_preview: preview(result.body, 120),
        has_tg_block: result.tg !== null,
      });

      sessions.upsert(ctx.from!.id, result.sessionId, ctx.chat!.id);

      const replyMarkup = result.tg ? tgBlockToReplyMarkup(result.tg) : undefined;
      const body = result.body || "(empty)";
      const rendered = renderForTelegram(body, result.tg?.parse_mode);
      try {
        await ctx.reply(rendered.text, {
          parse_mode: rendered.parse_mode,
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
        const msg = commitMessage(text);
        await git.commit(msg);
        log("info", "git_committed", { msg });
        try {
          await git.push();
          log("info", "git_pushed");
        } catch (e) {
          log("error", "git_push_failed", { msg: (e as Error).message });
        }
      }
      });
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (err.code === "ELOCKED") {
        log("warn", "git_lock_timeout", { from: ctx.from!.id });
        await ctx.reply("Still working on a previous message — try again in a moment.");
      } else {
        log("error", "turn_failed", { msg: err.message ?? String(e) });
        await ctx.reply("Internal error. Check docker logs.");
      }
    }
    } finally {
      stopTyping();
    }
  }

  // Text messages (not commands).
  bot.on("message:text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) return; // handled by command handlers
    if (!ctx.from) return;
    log("info", "message_received", {
      kind: "text",
      from: ctx.from.id,
      chat: ctx.chat?.id,
      text_len: ctx.message.text.length,
    });
    await enqueueUserWork(ctx.from.id, () => handleUserTurn(ctx, ctx.message.text));
  });

  // Voice messages.
  bot.on("message:voice", async (ctx) => {
    if (!ctx.from) return;
    log("info", "message_received", {
      kind: "voice",
      from: ctx.from.id,
      chat: ctx.chat?.id,
      voice_duration: ctx.message.voice.duration,
      voice_size: ctx.message.voice.file_size,
    });
    await enqueueUserWork(ctx.from.id, async () => {
      let transcript: string;
      const stopTyping = ctx.chat ? startTypingHeartbeat(bot, ctx.chat.id) : () => {};
      try {
        const audio = await downloadTelegramFile(bot, ctx.message.voice.file_id);
        transcript = await transcribeVoice(audio, config.deepgramApiKey);
      } catch (e) {
        log("error", "voice_failed", { msg: (e as Error).message });
        await ctx.reply(
          `Voice transcription failed: ${(e as Error).message}. file_id: ${ctx.message.voice.file_id}`
        );
        return;
      } finally {
        stopTyping();
      }
      log("info", "voice_transcribed", {
        len: transcript.length,
        transcript_preview: preview(transcript, 120),
      });
      await ctx.reply(`✍️ ${transcript}`);
      await handleUserTurn(ctx, transcript);
    });
  });

  async function saveUpload(
    ctx: Context,
    kind: "document" | "photo",
    fileBuf: Buffer,
    filename: string
  ): Promise<void> {
    if (!ctx.from || !ctx.chat) return;
    const relPath = `inbox/files/${filename}`;
    const absDir = join(brainCwd, "inbox", "files");
    const absPath = join(absDir, filename);

    await git.withLock(async () => {
      try {
        await git.pull();
      } catch (e) {
        log("error", "git_pull_failed", { msg: (e as Error).message });
        await ctx.reply("Sync conflict — please resolve on desktop and try again.");
        return;
      }
      mkdirSync(absDir, { recursive: true });
      writeFileSync(absPath, fileBuf);
      log("info", "file_saved", {
        from: ctx.from!.id,
        kind,
        path: relPath,
        bytes: fileBuf.length,
      });

      if (await git.isDirty()) {
        const msg = `tg: upload ${filename}`.slice(0, 72);
        await git.commit(msg);
        log("info", "git_committed", { msg });
        try {
          await git.push();
          log("info", "git_pushed");
        } catch (e) {
          log("error", "git_push_failed", { msg: (e as Error).message });
        }
      }

      const keyboard = new InlineKeyboard()
        .text("📇 Index", "idx")
        .text("Skip", "skp");
      const rendered = renderForTelegram(
        `📥 Saved \`${relPath}\`\nIndex this file?`,
        undefined
      );
      const sent = await ctx.reply(rendered.text, {
        parse_mode: rendered.parse_mode,
        reply_markup: keyboard,
      });
      sessions.putCallback(sent.message_id, "idx", `index_file ${relPath}`);
      sessions.putCallback(sent.message_id, "skp", "skip_index");
    });
  }

  // Document uploads (any file).
  bot.on("message:document", async (ctx) => {
    if (!ctx.from) return;
    const doc = ctx.message.document;
    log("info", "message_received", {
      kind: "document",
      from: ctx.from.id,
      chat: ctx.chat?.id,
      file_name: doc.file_name,
      mime_type: doc.mime_type,
      file_size: doc.file_size,
    });
    await enqueueUserWork(ctx.from.id, async () => {
      const stopTyping = ctx.chat ? startTypingHeartbeat(bot, ctx.chat.id) : () => {};
      let buf: Buffer;
      try {
        buf = await downloadTelegramFile(bot, doc.file_id);
      } catch (e) {
        log("error", "file_download_failed", { msg: (e as Error).message });
        stopTyping();
        await ctx.reply(`Download failed: ${(e as Error).message}`);
        return;
      }
      const base = doc.file_name
        ? sanitizeFilename(doc.file_name)
        : `${new Date().toISOString().slice(0, 10)}-doc${extFromMime(doc.mime_type)}`;
      const absDir = join(brainCwd, "inbox", "files");
      mkdirSync(absDir, { recursive: true });
      const filename = ensureUniqueFilename(absDir, base);
      try {
        await saveUpload(ctx, "document", buf, filename);
      } finally {
        stopTyping();
      }
    });
  });

  // Photo uploads (compressed image messages).
  bot.on("message:photo", async (ctx) => {
    if (!ctx.from) return;
    const photos = ctx.message.photo;
    const largest = photos[photos.length - 1];
    log("info", "message_received", {
      kind: "photo",
      from: ctx.from.id,
      chat: ctx.chat?.id,
      caption: ctx.message.caption,
      file_size: largest.file_size,
      width: largest.width,
      height: largest.height,
    });
    await enqueueUserWork(ctx.from.id, async () => {
      const stopTyping = ctx.chat ? startTypingHeartbeat(bot, ctx.chat.id) : () => {};
      let buf: Buffer;
      try {
        buf = await downloadTelegramFile(bot, largest.file_id);
      } catch (e) {
        log("error", "file_download_failed", { msg: (e as Error).message });
        stopTyping();
        await ctx.reply(`Download failed: ${(e as Error).message}`);
        return;
      }
      const base = generatePhotoFilename(ctx.message.caption);
      const absDir = join(brainCwd, "inbox", "files");
      mkdirSync(absDir, { recursive: true });
      const filename = ensureUniqueFilename(absDir, base);
      try {
        await saveUpload(ctx, "photo", buf, filename);
      } finally {
        stopTyping();
      }
    });
  });

  // Callback queries from inline keyboards.
  bot.on("callback_query:data", async (ctx) => {
    if (!ctx.from) return;
    log("info", "message_received", {
      kind: "callback",
      from: ctx.from.id,
      data: ctx.callbackQuery.data,
    });
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
    if (intent === "skip_index") {
      await ctx.reply("Skipped.");
      return;
    }
    await enqueueUserWork(ctx.from.id, () =>
      handleUserTurn(ctx, `[user clicked: ${intent}]`)
    );
  });

  return bot;
}
