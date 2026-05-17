import { describe, it, expect } from "vitest";
import { parseClaudeOutput, type TgBlock } from "../src/protocol";

describe("parseClaudeOutput", () => {
  it("returns the full text as body when no tg block is present", () => {
    const stdout = "Just a plain reply.\nNo block here.";
    const { body, tg } = parseClaudeOutput(stdout);
    expect(body).toBe("Just a plain reply.\nNo block here.");
    expect(tg).toBeNull();
  });

  it("extracts and parses a trailing tg block, stripping it from body", () => {
    const stdout = [
      "Found 3 candidates.",
      "Apply?",
      "",
      "```tg",
      `{"keyboard": [[{"text": "Yes", "data": "yes"}]]}`,
      "```",
    ].join("\n");
    const { body, tg } = parseClaudeOutput(stdout);
    expect(body).toBe("Found 3 candidates.\nApply?");
    expect(tg).not.toBeNull();
    expect(tg!.keyboard).toEqual([[{ text: "Yes", data: "yes" }]]);
  });

  it("returns full stdout as body if the tg block JSON is malformed", () => {
    const stdout = "Reply text.\n\n```tg\n{not valid json\n```";
    const { body, tg } = parseClaudeOutput(stdout);
    expect(body).toBe(stdout);
    expect(tg).toBeNull();
  });

  it("ignores a tg block that is not at the trailing position", () => {
    const stdout = "```tg\n{}\n```\n\nMore prose after.";
    const { body, tg } = parseClaudeOutput(stdout);
    expect(body).toBe(stdout);
    expect(tg).toBeNull();
  });

  it("handles tg block with optional parse_mode and disable_preview", () => {
    const stdout = [
      "Hello.",
      "",
      "```tg",
      `{"parse_mode": "MarkdownV2", "disable_preview": true, "keyboard": []}`,
      "```",
    ].join("\n");
    const { tg } = parseClaudeOutput(stdout);
    expect(tg).toEqual({
      parse_mode: "MarkdownV2",
      disable_preview: true,
      keyboard: [],
    });
  });
});
