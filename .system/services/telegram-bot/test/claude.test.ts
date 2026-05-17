import { describe, it, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runClaude } from "../src/claude";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FAKE = resolve(__dirname, "fixtures/fake-claude.sh");

describe("runClaude", () => {
  it("returns the parsed body when no tg block is emitted", async () => {
    const out = await runClaude({
      binary: FAKE,
      brainCwd: process.cwd(),
      promptPath: "/dev/null",
      prompt: "hello",
      sessionId: null,
      env: { FAKE_CLAUDE_STDOUT: "Hi there", FAKE_CLAUDE_SID: "sid-new" },
    });
    expect(out.body).toBe("Hi there");
    expect(out.tg).toBeNull();
    expect(out.sessionId).toBe("sid-new");
  });

  it("parses a tg block emitted by Claude", async () => {
    const stdout = 'Reply\n\n```tg\n{"keyboard":[[{"text":"Y","data":"y"}]]}\n```';
    const out = await runClaude({
      binary: FAKE,
      brainCwd: process.cwd(),
      promptPath: "/dev/null",
      prompt: "hi",
      sessionId: "sid-existing",
      env: { FAKE_CLAUDE_STDOUT: stdout, FAKE_CLAUDE_SID: "sid-existing" },
    });
    expect(out.body).toBe("Reply");
    expect(out.tg?.keyboard).toEqual([[{ text: "Y", data: "y" }]]);
  });

  it("throws when the binary exits nonzero", async () => {
    await expect(
      runClaude({
        binary: FAKE,
        brainCwd: process.cwd(),
        promptPath: "/dev/null",
        prompt: "hi",
        sessionId: null,
        env: { FAKE_CLAUDE_EXIT: "1" },
      })
    ).rejects.toThrow(/exit code 1/);
  });
});
