import { describe, it, expect, vi, beforeEach } from "vitest";

const transcribeFile = vi.fn();

vi.mock("@deepgram/sdk", () => ({
  createClient: vi.fn(() => ({
    listen: { prerecorded: { transcribeFile } },
  })),
}));

import { transcribeVoice } from "../src/voice";

beforeEach(() => {
  transcribeFile.mockReset();
});

describe("transcribeVoice", () => {
  it("returns transcript text on success", async () => {
    transcribeFile.mockResolvedValue({
      result: {
        results: { channels: [{ alternatives: [{ transcript: "Hello world" }] }] },
      },
      error: null,
    });
    const text = await transcribeVoice(Buffer.from("fake audio"), "key");
    expect(text).toBe("Hello world");
  });

  it("throws when Deepgram returns an error", async () => {
    transcribeFile.mockResolvedValue({
      result: null,
      error: { message: "bad audio" },
    });
    await expect(transcribeVoice(Buffer.from(""), "key")).rejects.toThrow(/bad audio/);
  });

  it("throws when transcript is empty", async () => {
    transcribeFile.mockResolvedValue({
      result: { results: { channels: [{ alternatives: [{ transcript: "" }] }] } },
      error: null,
    });
    await expect(transcribeVoice(Buffer.from(""), "key")).rejects.toThrow(/empty/i);
  });
});
