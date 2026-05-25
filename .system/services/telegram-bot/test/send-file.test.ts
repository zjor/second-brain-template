import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSendFileApp } from "../src/send-file";

function makeDeps(overrides: Partial<{
  sendDocument: ReturnType<typeof vi.fn>;
  sendPhoto: ReturnType<typeof vi.fn>;
  brainRoot: string;
}> = {}) {
  return {
    brainRoot: overrides.brainRoot ?? "/data/brain",
    sendDocument: overrides.sendDocument ?? vi.fn().mockResolvedValue(undefined),
    sendPhoto: overrides.sendPhoto ?? vi.fn().mockResolvedValue(undefined),
  };
}

describe("send-file app", () => {
  let brainRoot: string;

  beforeEach(() => {
    brainRoot = mkdtempSync(join(tmpdir(), "brain-"));
  });
  afterEach(() => {
    rmSync(brainRoot, { recursive: true, force: true });
  });

  it("sends a document for a valid in-brain path", async () => {
    const filePath = join(brainRoot, "inbox", "files", "report.pdf");
    mkdirSync(join(brainRoot, "inbox", "files"), { recursive: true });
    writeFileSync(filePath, Buffer.from("PDFDATA"));

    const deps = makeDeps({ brainRoot });
    const app = createSendFileApp(deps);
    const res = await app.request("/send-file", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: 42,
        path: filePath,
        kind: "document",
      }),
    });

    expect(res.status).toBe(200);
    expect(deps.sendDocument).toHaveBeenCalledTimes(1);
    const call = deps.sendDocument.mock.calls[0];
    expect(call[0]).toBe(42);                               // chat_id
    expect((call[1] as Buffer).equals(Buffer.from("PDFDATA"))).toBe(true);
    expect(call[2]).toBe("report.pdf");                     // filename
    expect(call[3]).toEqual({});                            // no caption → empty opts
  });
});
