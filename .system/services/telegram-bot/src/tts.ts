import { spawn } from "node:child_process";
import { GoogleGenAI, Modality } from "@google/genai";
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

export interface SpeechOpts {
  voice: string;
  style?: string;
  apiKey: string;
  model: string;
}

/** Call Gemini TTS; returns raw PCM (s16le, 24kHz, mono). */
export async function synthesizeSpeech(text: string, opts: SpeechOpts): Promise<Buffer> {
  const ai = new GoogleGenAI({ apiKey: opts.apiKey });
  const prompt = opts.style ? `${opts.style}: ${text}` : text;
  const resp = await ai.models.generateContent({
    model: opts.model,
    contents: [{ parts: [{ text: prompt }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: opts.voice } },
      },
    },
  });
  const data = resp.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!data) throw new Error("Gemini returned no audio");
  return Buffer.from(data, "base64");
}

/** Transcode raw PCM (s16le, 24kHz, mono) to OGG/Opus via ffmpeg. No temp files. */
export function pcmToOggOpus(pcm: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", [
      "-hide_banner", "-loglevel", "error",
      "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", "pipe:0",
      "-c:a", "libopus", "-b:a", "32k", "-f", "ogg", "pipe:1",
    ]);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    ff.stdout.on("data", (d: Buffer) => out.push(d));
    ff.stderr.on("data", (d: Buffer) => err.push(d));
    ff.on("error", reject);
    ff.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`ffmpeg exited ${code}: ${Buffer.concat(err).toString()}`));
    });
    ff.stdin.on("error", () => { /* ignore EPIPE if ffmpeg dies early */ });
    ff.stdin.write(pcm);
    ff.stdin.end();
  });
}
