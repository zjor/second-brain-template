import { describe, it, expect, vi } from "vitest";
import { createTtsApp, type TtsAppDeps } from "../src/tts";

function makeDeps(overrides: Partial<TtsAppDeps> = {}): TtsAppDeps {
  return {
    maxChars: 1000,
    synthesize: vi.fn().mockResolvedValue(Buffer.from("OGGDATA")),
    sendVoice: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function post(app: ReturnType<typeof createTtsApp>, payload: unknown) {
  return app.request("/tts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("tts app", () => {
  it("synthesizes and sends a voice message for valid input", async () => {
    const deps = makeDeps();
    const app = createTtsApp(deps);
    const res = await post(app, { chat_id: 42, text: "Привет" });

    expect(res.status).toBe(200);
    expect(deps.synthesize).toHaveBeenCalledWith("Привет", { voice: undefined, style: undefined });
    expect(deps.sendVoice).toHaveBeenCalledTimes(1);
    const call = (deps.sendVoice as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe(42);
    expect((call[1] as Buffer).equals(Buffer.from("OGGDATA"))).toBe(true);
  });

  it("passes voice and style through to synthesize", async () => {
    const deps = makeDeps();
    const app = createTtsApp(deps);
    const res = await post(app, { chat_id: 1, text: "Hi", voice: "Puck", style: "say cheerfully" });

    expect(res.status).toBe(200);
    expect(deps.synthesize).toHaveBeenCalledWith("Hi", { voice: "Puck", style: "say cheerfully" });
  });

  it("rejects missing text with 400", async () => {
    const deps = makeDeps();
    const app = createTtsApp(deps);
    const res = await post(app, { chat_id: 1 });
    expect(res.status).toBe(400);
    expect(deps.synthesize).not.toHaveBeenCalled();
  });

  it("rejects empty text with 400", async () => {
    const deps = makeDeps();
    const app = createTtsApp(deps);
    const res = await post(app, { chat_id: 1, text: "" });
    expect(res.status).toBe(400);
    expect(deps.synthesize).not.toHaveBeenCalled();
  });

  it("rejects text over maxChars with 400", async () => {
    const deps = makeDeps({ maxChars: 10 });
    const app = createTtsApp(deps);
    const res = await post(app, { chat_id: 1, text: "x".repeat(11) });
    expect(res.status).toBe(400);
    expect(deps.synthesize).not.toHaveBeenCalled();
  });

  it("returns 503 when synthesize is null (Gemini not configured)", async () => {
    const deps = makeDeps({ synthesize: null });
    const app = createTtsApp(deps);
    const res = await post(app, { chat_id: 1, text: "Hi" });
    expect(res.status).toBe(503);
    expect(deps.sendVoice).not.toHaveBeenCalled();
  });

  it("returns 502 when synthesize throws", async () => {
    const deps = makeDeps({ synthesize: vi.fn().mockRejectedValue(new Error("gemini down")) });
    const app = createTtsApp(deps);
    const res = await post(app, { chat_id: 1, text: "Hi" });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("gemini down");
    expect(deps.sendVoice).not.toHaveBeenCalled();
  });

  it("returns 502 when sendVoice throws", async () => {
    const deps = makeDeps({ sendVoice: vi.fn().mockRejectedValue(new Error("network down")) });
    const app = createTtsApp(deps);
    const res = await post(app, { chat_id: 1, text: "Hi" });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("network down");
  });
});
