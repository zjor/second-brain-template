import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { GitRepo } from "../src/git";

function exec(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

let repoDir: string;
let git: GitRepo;

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "tg-bot-git-"));
  exec(repoDir, "init", "-q");
  exec(repoDir, "config", "user.name", "Test");
  exec(repoDir, "config", "user.email", "t@t");
  writeFileSync(join(repoDir, "seed.txt"), "seed\n");
  exec(repoDir, "add", ".");
  exec(repoDir, "commit", "-q", "-m", "seed");
  git = new GitRepo(repoDir, "Test Bot", "bot@test");
});

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

describe("GitRepo", () => {
  it("isDirty returns false for a clean working tree", async () => {
    expect(await git.isDirty()).toBe(false);
  });

  it("isDirty returns true after a file is added", async () => {
    writeFileSync(join(repoDir, "new.txt"), "hello\n");
    expect(await git.isDirty()).toBe(true);
  });

  it("commit creates a commit with the given message", async () => {
    writeFileSync(join(repoDir, "a.txt"), "a\n");
    await git.commit("tg: add a");
    const log = exec(repoDir, "log", "-1", "--pretty=%s");
    expect(log.trim()).toBe("tg: add a");
  });

  it("withLock serializes concurrent operations", async () => {
    const order: string[] = [];
    await Promise.all([
      git.withLock(async () => {
        await new Promise((r) => setTimeout(r, 20));
        order.push("first");
      }),
      git.withLock(async () => {
        order.push("second");
      }),
    ]);
    expect(order).toEqual(["first", "second"]);
  });
});
