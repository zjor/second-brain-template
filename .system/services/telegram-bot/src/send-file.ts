import { Hono } from "hono";
import { z } from "zod";
import { realpathSync, statSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import telegramifyMarkdown from "telegramify-markdown";

const sendFileBody = z.object({
  chat_id: z.number().int(),
  path: z.string().min(1),
  kind: z.enum(["document", "photo"]),
  caption: z.string().max(1024).optional(),
  parse_mode: z.enum(["Markdown", "MarkdownV2", "HTML"]).optional(),
});

const MAX_BYTES: Record<"document" | "photo", number> = {
  document: 50 * 1024 * 1024,
  photo:    10 * 1024 * 1024,
};

export interface SendFileDeps {
  brainRoot: string;
  sendDocument: (
    chatId: number,
    buf: Buffer,
    filename: string,
    opts: { caption?: string; parse_mode?: "MarkdownV2" | "HTML" }
  ) => Promise<void>;
  sendPhoto: (
    chatId: number,
    buf: Buffer,
    filename: string,
    opts: { caption?: string; parse_mode?: "MarkdownV2" | "HTML" }
  ) => Promise<void>;
}

function log(level: string, event: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, event, ...extra }));
}

function renderCaption(
  caption: string | undefined,
  parseMode: "Markdown" | "MarkdownV2" | "HTML" | undefined
): { caption?: string; parse_mode?: "MarkdownV2" | "HTML" } {
  if (caption === undefined) return {};
  if (parseMode === "HTML") return { caption, parse_mode: "HTML" };
  return { caption: telegramifyMarkdown(caption, "escape"), parse_mode: "MarkdownV2" };
}

type ResolveResult =
  | { ok: true; resolved: string; size: number }
  | { ok: false; status: 403 | 404 };

/**
 * Validate that `rawPath` resolves to a regular file inside the brain repo.
 * @param resolvedBrainRoot must already be realpath'd by the caller (no symlinks, no trailing slash)
 */
function resolveBrainPath(rawPath: string, resolvedBrainRoot: string): ResolveResult {
  let resolved: string;
  try {
    resolved = realpathSync(rawPath);
  } catch {
    return { ok: false, status: 404 };
  }
  // realpathSync strips trailing slashes, so resolvedBrainRoot never ends with "/"
  const prefix = resolvedBrainRoot + "/";
  if (!(resolved + "/").startsWith(prefix)) {
    return { ok: false, status: 403 };
  }
  let stat;
  try {
    stat = statSync(resolved);
  } catch {
    return { ok: false, status: 404 };
  }
  if (!stat.isFile()) return { ok: false, status: 404 };
  return { ok: true, resolved, size: stat.size };
}

export function createSendFileApp(deps: SendFileDeps) {
  // Resolve once at construction: brainRoot may contain symlinks (e.g. /var → /private/var on darwin).
  const resolvedBrainRoot = realpathSync(deps.brainRoot);
  const app = new Hono();
  app.post("/send-file", async (c) => {
    const raw = await c.req.json().catch(() => null);
    const parsed = sendFileBody.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const { chat_id, path, kind, caption, parse_mode } = parsed.data;

    const r = resolveBrainPath(path, resolvedBrainRoot);
    if (!r.ok) {
      log("warn", "send_file_rejected", { path, kind, status: r.status });
      return c.json({ error: r.status === 403 ? "forbidden" : "not_found" }, r.status);
    }

    if (r.size > MAX_BYTES[kind]) {
      log("warn", "send_file_too_large", { path, kind, size: r.size });
      return c.json({ error: "file_too_large", size: r.size, max: MAX_BYTES[kind] }, 413);
    }

    const buf = readFileSync(r.resolved);
    const filename = basename(r.resolved);
    const opts = renderCaption(caption, parse_mode);

    try {
      if (kind === "document") {
        await deps.sendDocument(chat_id, buf, filename, opts);
      } else {
        await deps.sendPhoto(chat_id, buf, filename, opts);
      }
      return c.json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log("error", "send_file_failed", { path, kind, msg });
      return c.json({ error: msg }, 502);
    }
  });
  return app;
}
