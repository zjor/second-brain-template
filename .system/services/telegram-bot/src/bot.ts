import { Bot, type Context } from "grammy";
import type { Config } from "./config";
import type { SessionStore } from "./session";
import type { GitRepo } from "./git";
import { runClaude } from "./claude";
import { tgBlockToReplyMarkup } from "./protocol";
import { transcribeVoice } from "./voice";

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
  }

  // Text messages (not commands).
  bot.on("message:text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) return; // handled by command handlers
    log("info", "message_received", {
      kind: "text",
      from: ctx.from?.id,
      chat: ctx.chat?.id,
      text_len: ctx.message.text.length,
    });
    await handleUserTurn(ctx, ctx.message.text);
  });

  // Voice messages.
  bot.on("message:voice", async (ctx) => {
    log("info", "message_received", {
      kind: "voice",
      from: ctx.from?.id,
      chat: ctx.chat?.id,
      voice_duration: ctx.message.voice.duration,
      voice_size: ctx.message.voice.file_size,
    });
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
    log("info", "voice_transcribed", {
      len: transcript.length,
      transcript_preview: preview(transcript, 120),
    });
    await ctx.reply(`✍️ ${transcript}`);
    await handleUserTurn(ctx, transcript);
  });

  // Callback queries from inline keyboards.
  bot.on("callback_query:data", async (ctx) => {
    log("info", "message_received", {
      kind: "callback",
      from: ctx.from?.id,
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
    await handleUserTurn(ctx, `[user clicked: ${intent}]`);
  });

  return bot;
}
