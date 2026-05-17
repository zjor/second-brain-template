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
