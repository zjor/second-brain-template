import { Hono } from "hono";
import { z } from "zod";

export interface SynthesizeOpts {
  voice?: string;
  style?: string;
}

export interface TtsAppDeps {
  maxChars: number;
  /** null when Gemini is not configured → endpoint returns 503 */
  synthesize: ((text: string, opts: SynthesizeOpts) => Promise<Buffer>) | null;
  sendVoice: (chatId: number, buf: Buffer) => Promise<void>;
}

function log(level: string, event: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, event, ...extra }));
}

export function createTtsApp(deps: TtsAppDeps) {
  const body = z.object({
    chat_id: z.number().int(),
    text: z.string().min(1).max(deps.maxChars),
    voice: z.string().min(1).optional(),
    style: z.string().min(1).optional(),
  });

  const app = new Hono();
  app.post("/tts", async (c) => {
    const raw = await c.req.json().catch(() => null);
    const parsed = body.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    if (!deps.synthesize) {
      log("warn", "tts_not_configured");
      return c.json({ error: "tts_not_configured" }, 503);
    }

    const { chat_id, text, voice, style } = parsed.data;

    let buf: Buffer;
    try {
      buf = await deps.synthesize(text, { voice, style });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log("error", "tts_synthesize_failed", { msg });
      return c.json({ error: msg }, 502);
    }

    try {
      await deps.sendVoice(chat_id, buf);
      return c.json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log("error", "tts_send_failed", { msg });
      return c.json({ error: msg }, 502);
    }
  });

  return app;
}
