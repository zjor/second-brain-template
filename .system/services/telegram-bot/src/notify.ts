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
