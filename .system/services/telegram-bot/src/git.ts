import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import lockfile from "proper-lockfile";

const exec = promisify(execFile);

export class GitRepo {
  constructor(
    private readonly cwd: string,
    private readonly userName: string,
    private readonly userEmail: string,
  ) {}

  private async git(...args: string[]): Promise<{ stdout: string; stderr: string }> {
    return exec("git", args, {
      cwd: this.cwd,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: this.userName,
        GIT_AUTHOR_EMAIL: this.userEmail,
        GIT_COMMITTER_NAME: this.userName,
        GIT_COMMITTER_EMAIL: this.userEmail,
      },
    });
  }

  async isDirty(): Promise<boolean> {
    const { stdout } = await this.git("status", "--porcelain");
    return stdout.trim().length > 0;
  }

  async pull(): Promise<void> {
    await this.git("pull", "--rebase", "--autostash");
  }

  async commit(message: string): Promise<void> {
    await this.git("add", "-A");
    await this.git("commit", "-m", message);
  }

  async push(): Promise<void> {
    await this.git("push");
  }

  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const lockDir = join(this.cwd, ".git");
    if (!existsSync(lockDir)) mkdirSync(lockDir, { recursive: true });
    const release = await lockfile.lock(lockDir, {
      lockfilePath: join(lockDir, "bot.lock"),
      retries: { retries: 30, factor: 1.2, minTimeout: 100, maxTimeout: 1000 },
      stale: 5 * 60 * 1000,
    });
    try {
      return await fn();
    } finally {
      await release();
    }
  }
}

export class GitConflictError extends Error {
  constructor(public readonly stderr: string) {
    super("git pull --rebase failed (conflict)");
    this.name = "GitConflictError";
  }
}
