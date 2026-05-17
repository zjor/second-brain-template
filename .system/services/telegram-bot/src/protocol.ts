import { z } from "zod";

const tgButtonSchema = z.object({
  text: z.string().min(1),
  data: z.string().min(1).max(64),
});

const tgBlockSchema = z.object({
  parse_mode: z.enum(["Markdown", "MarkdownV2", "HTML"]).optional(),
  disable_preview: z.boolean().optional(),
  keyboard: z.array(z.array(tgButtonSchema)).default([]),
});

export type TgBlock = z.infer<typeof tgBlockSchema>;

export interface ParsedClaudeOutput {
  body: string;
  tg: TgBlock | null;
}

// Matches a trailing ```tg ... ``` block, optionally preceded by whitespace.
// The block must be the LAST non-whitespace content of stdout.
const TG_BLOCK_RE = /\n?```tg\s*\n([\s\S]*?)\n```\s*$/;

export function parseClaudeOutput(stdout: string): ParsedClaudeOutput {
  const match = stdout.match(TG_BLOCK_RE);
  if (!match) return { body: stdout, tg: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return { body: stdout, tg: null };
  }

  const result = tgBlockSchema.safeParse(parsed);
  if (!result.success) return { body: stdout, tg: null };

  const body = stdout.slice(0, match.index).replace(/\s+$/, "");
  return { body, tg: result.data };
}

export interface InlineKeyboardMarkup {
  inline_keyboard: { text: string; callback_data: string }[][];
}

export function tgBlockToReplyMarkup(tg: TgBlock): InlineKeyboardMarkup | undefined {
  if (!tg.keyboard.length) return undefined;
  return {
    inline_keyboard: tg.keyboard.map((row) =>
      row.map((btn) => ({ text: btn.text, callback_data: btn.data }))
    ),
  };
}
