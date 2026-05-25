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

  it("sends a photo for a valid in-brain path", async () => {
    const filePath = join(brainRoot, "sunset.jpg");
    writeFileSync(filePath, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));

    const deps = makeDeps({ brainRoot });
    const app = createSendFileApp(deps);
    const res = await app.request("/send-file", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: 7,
        path: filePath,
        kind: "photo",
      }),
    });

    expect(res.status).toBe(200);
    expect(deps.sendPhoto).toHaveBeenCalledTimes(1);
    expect(deps.sendDocument).not.toHaveBeenCalled();
    const call = deps.sendPhoto.mock.calls[0];
    expect(call[0]).toBe(7);
    expect((call[1] as Buffer).length).toBe(4);
    expect(call[2]).toBe("sunset.jpg");
    expect(call[3]).toEqual({});  // no caption → empty opts
  });

  it("rejects path outside brainRoot with 403", async () => {
    const outside = mkdtempSync(join(tmpdir(), "outside-"));
    const filePath = join(outside, "secret.txt");
    writeFileSync(filePath, "shh");

    const deps = makeDeps({ brainRoot });
    const app = createSendFileApp(deps);
    const res = await app.request("/send-file", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: 1, path: filePath, kind: "document" }),
    });

    expect(res.status).toBe(403);
    expect(deps.sendDocument).not.toHaveBeenCalled();
    rmSync(outside, { recursive: true, force: true });
  });

  it("rejects a symlink that escapes brainRoot with 403", async () => {
    const outside = mkdtempSync(join(tmpdir(), "outside-"));
    const target = join(outside, "real.txt");
    writeFileSync(target, "shh");

    const link = join(brainRoot, "link.txt");
    const { symlinkSync } = await import("node:fs");
    symlinkSync(target, link);

    const deps = makeDeps({ brainRoot });
    const app = createSendFileApp(deps);
    const res = await app.request("/send-file", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: 1, path: link, kind: "document" }),
    });

    expect(res.status).toBe(403);
    expect(deps.sendDocument).not.toHaveBeenCalled();
    rmSync(outside, { recursive: true, force: true });
  });

  it("rejects path that does not exist with 404", async () => {
    const deps = makeDeps({ brainRoot });
    const app = createSendFileApp(deps);
    const res = await app.request("/send-file", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: 1,
        path: join(brainRoot, "nope.txt"),
        kind: "document",
      }),
    });
    expect(res.status).toBe(404);
    expect(deps.sendDocument).not.toHaveBeenCalled();
  });

  it("rejects a directory path with 404", async () => {
    mkdirSync(join(brainRoot, "adir"));
    const deps = makeDeps({ brainRoot });
    const app = createSendFileApp(deps);
    const res = await app.request("/send-file", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: 1,
        path: join(brainRoot, "adir"),
        kind: "document",
      }),
    });
    expect(res.status).toBe(404);
    expect(deps.sendDocument).not.toHaveBeenCalled();
  });

  it("rejects a sibling directory that shares brainRoot's prefix with 403", async () => {
    // brainRoot looks like "/tmp/brain-AAA"; create a peer "/tmp/brain-AAA-evil/secret.txt".
    // The naive prefix check `resolved.startsWith(brainRoot)` would falsely admit this;
    // the correct check appends "/" to both sides.
    const { mkdirSync: mk } = await import("node:fs");
    const evilDir = brainRoot + "-evil";
    mk(evilDir, { recursive: true });
    const filePath = join(evilDir, "secret.txt");
    writeFileSync(filePath, "shh");

    const deps = makeDeps({ brainRoot });
    const app = createSendFileApp(deps);
    const res = await app.request("/send-file", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: 1, path: filePath, kind: "document" }),
    });

    expect(res.status).toBe(403);
    expect(deps.sendDocument).not.toHaveBeenCalled();
    rmSync(evilDir, { recursive: true, force: true });
  });

  it("rejects payload missing required fields with 400", async () => {
    const deps = makeDeps({ brainRoot });
    const app = createSendFileApp(deps);
    const res = await app.request("/send-file", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: 1, kind: "document" }), // missing path
    });
    expect(res.status).toBe(400);
  });

  it("rejects document larger than 50 MB with 413", async () => {
    const filePath = join(brainRoot, "big.bin");
    // 50 MB + 1 byte. Use a sparse-ish allocation: Buffer.alloc(1) won't catch
    // size; we lie about size using truncate.
    const { openSync, ftruncateSync, closeSync } = await import("node:fs");
    const fd = openSync(filePath, "w");
    ftruncateSync(fd, 50 * 1024 * 1024 + 1);
    closeSync(fd);

    const deps = makeDeps({ brainRoot });
    const app = createSendFileApp(deps);
    const res = await app.request("/send-file", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: 1, path: filePath, kind: "document" }),
    });
    expect(res.status).toBe(413);
    expect(deps.sendDocument).not.toHaveBeenCalled();
  });

  it("rejects photo larger than 10 MB with 413", async () => {
    const filePath = join(brainRoot, "big.jpg");
    const { openSync, ftruncateSync, closeSync } = await import("node:fs");
    const fd = openSync(filePath, "w");
    ftruncateSync(fd, 10 * 1024 * 1024 + 1);
    closeSync(fd);

    const deps = makeDeps({ brainRoot });
    const app = createSendFileApp(deps);
    const res = await app.request("/send-file", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: 1, path: filePath, kind: "photo" }),
    });
    expect(res.status).toBe(413);
    expect(deps.sendPhoto).not.toHaveBeenCalled();
  });
});
