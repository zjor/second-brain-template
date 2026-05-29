import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config";

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

  it("applies TTS defaults", () => {
    const cfg = loadConfig(baseEnv);
    expect(cfg.geminiApiKey).toBeUndefined();
    expect(cfg.geminiTtsVoice).toBe("Kore");
    expect(cfg.geminiTtsModel).toBe("gemini-2.5-flash-preview-tts");
    expect(cfg.ttsMaxChars).toBe(1000);
  });

  it("overrides TTS vars when provided", () => {
    const cfg = loadConfig({
      ...baseEnv,
      GEMINI_API_KEY: "gm-key",
      GEMINI_TTS_VOICE: "Puck",
      GEMINI_TTS_MODEL: "gemini-2.5-pro-preview-tts",
      TTS_MAX_CHARS: "500",
    });
    expect(cfg.geminiApiKey).toBe("gm-key");
    expect(cfg.geminiTtsVoice).toBe("Puck");
    expect(cfg.geminiTtsModel).toBe("gemini-2.5-pro-preview-tts");
    expect(cfg.ttsMaxChars).toBe(500);
  });
});
