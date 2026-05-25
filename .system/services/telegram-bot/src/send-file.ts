import { Hono } from "hono";
import { z } from "zod";
import { realpathSync, readFileSync } from "node:fs";
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
