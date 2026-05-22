import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ensureUniqueFilename,
  extFromMime,
  generatePhotoFilename,
  sanitizeFilename,
  slugify,
} from "../src/upload";

describe("slugify", () => {
  it("lowercases, replaces spaces with dashes, strips punctuation", () => {
    expect(slugify("Hello World!")).toBe("hello-world");
  });

  it("handles diacritics", () => {
    expect(slugify("Café résumé")).toBe("cafe-resume");
  });

  it("collapses repeated separators and trims", () => {
    expect(slugify("  --foo___bar...baz--  ")).toBe("foo-bar-baz");
  });

  it("returns empty string when input has no slug-worthy chars", () => {
    expect(slugify("!!!")).toBe("");
    expect(slugify("   ")).toBe("");
  });

  it("clips to 40 chars", () => {
    const long = "a".repeat(60);
    expect(slugify(long).length).toBe(40);
  });
});

describe("sanitizeFilename", () => {
  it("keeps extension, slugifies stem", () => {
    expect(sanitizeFilename("My Report.pdf")).toBe("my-report.pdf");
  });

  it("lowercases extension", () => {
    expect(sanitizeFilename("Photo.JPG")).toBe("photo.jpg");
  });

  it("falls back to 'file' for empty stem", () => {
    expect(sanitizeFilename("!!!.txt")).toBe("file.txt");
  });

  it("handles names without extension", () => {
    expect(sanitizeFilename("Some Doc")).toBe("some-doc");
  });

  it("drops path components and keeps only the filename", () => {
    expect(sanitizeFilename("evil/../etc/passwd")).toBe("passwd");
  });
});

describe("generatePhotoFilename", () => {
  const fixed = new Date("2026-05-22T15:30:45Z");

  it("uses caption slug + date when caption present", () => {
    expect(generatePhotoFilename("Receipt from Albert", fixed)).toBe(
      "2026-05-22-receipt-from-albert.jpg"
    );
  });

  it("falls back to date + HHMM when no caption", () => {
    expect(generatePhotoFilename(undefined, fixed)).toBe(
      "2026-05-22-photo-1530.jpg"
    );
  });

  it("handles whitespace-only caption as no-caption", () => {
    expect(generatePhotoFilename("   ", fixed)).toBe(
      "2026-05-22-photo-1530.jpg"
    );
  });

  it("respects custom extension", () => {
    expect(generatePhotoFilename("hi", fixed, ".png")).toBe(
      "2026-05-22-hi.png"
    );
  });
});

describe("ensureUniqueFilename", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "upload-test-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns name unchanged when no collision", () => {
    expect(ensureUniqueFilename(dir, "foo.txt")).toBe("foo.txt");
  });

  it("appends -2 on first collision", () => {
    writeFileSync(join(dir, "foo.txt"), "");
    expect(ensureUniqueFilename(dir, "foo.txt")).toBe("foo-2.txt");
  });

  it("skips taken suffixes", () => {
    writeFileSync(join(dir, "foo.txt"), "");
    writeFileSync(join(dir, "foo-2.txt"), "");
    writeFileSync(join(dir, "foo-3.txt"), "");
    expect(ensureUniqueFilename(dir, "foo.txt")).toBe("foo-4.txt");
  });

  it("works for extensionless names", () => {
    writeFileSync(join(dir, "notes"), "");
    expect(ensureUniqueFilename(dir, "notes")).toBe("notes-2");
  });
});

describe("extFromMime", () => {
  it("maps common image types", () => {
    expect(extFromMime("image/jpeg")).toBe(".jpg");
    expect(extFromMime("image/png")).toBe(".png");
  });

  it("maps pdf", () => {
    expect(extFromMime("application/pdf")).toBe(".pdf");
  });

  it("returns empty string for unknown", () => {
    expect(extFromMime("application/octet-stream")).toBe("");
    expect(extFromMime(undefined)).toBe("");
  });
});
