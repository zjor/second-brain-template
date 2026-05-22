import { existsSync } from "node:fs";
import { join, parse } from "node:path";

const MAX_BASENAME = 80;

export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function sanitizeFilename(name: string): string {
  const { name: stem, ext } = parse(name);
  const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, "").toLowerCase();
  const safeStem = slugify(stem) || "file";
  const trimmed = safeStem.slice(0, MAX_BASENAME);
  return safeExt ? `${trimmed}${safeExt}` : trimmed;
}

export function generatePhotoFilename(
  caption: string | undefined,
  now: Date = new Date(),
  ext = ".jpg"
): string {
  const date = now.toISOString().slice(0, 10);
  const hhmm = now.toISOString().slice(11, 16).replace(":", "");
  const slug = caption ? slugify(caption) : "";
  const stem = slug ? `${date}-${slug}` : `${date}-photo-${hhmm}`;
  return `${stem}${ext}`;
}

export function ensureUniqueFilename(dir: string, name: string): string {
  if (!existsSync(join(dir, name))) return name;
  const { name: stem, ext } = parse(name);
  for (let i = 2; i < 1000; i++) {
    const candidate = `${stem}-${i}${ext}`;
    if (!existsSync(join(dir, candidate))) return candidate;
  }
  throw new Error(`Could not find unique filename for ${name} in ${dir}`);
}

export function extFromMime(mime: string | undefined): string {
  if (!mime) return "";
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/heic": ".heic",
    "application/pdf": ".pdf",
    "text/plain": ".txt",
    "text/markdown": ".md",
  };
  return map[mime.toLowerCase()] ?? "";
}
