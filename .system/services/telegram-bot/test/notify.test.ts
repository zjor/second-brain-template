import { describe, it, expect, vi } from "vitest";
import { createNotifyApp } from "../src/notify";

describe("notify app", () => {
  it("forwards a valid payload to sendMessage", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const app = createNotifyApp({ sendMessage: send });
    const res = await app.request("/notify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: 42, text: "hello", parse_mode: "MarkdownV2" }),
    });
    expect(res.status).toBe(200);
    expect(send).toHaveBeenCalledWith(42, "hello", { parse_mode: "MarkdownV2" });
  });

  it("rejects when chat_id is missing", async () => {
    const app = createNotifyApp({ sendMessage: vi.fn() });
    const res = await app.request("/notify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 500 if sendMessage throws", async () => {
    const send = vi.fn().mockRejectedValue(new Error("network"));
    const app = createNotifyApp({ sendMessage: send });
    const res = await app.request("/notify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: 1, text: "x" }),
    });
    expect(res.status).toBe(500);
  });
});
