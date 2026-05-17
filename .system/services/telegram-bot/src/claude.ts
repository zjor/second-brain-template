import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseClaudeOutput, type ParsedClaudeOutput } from "./protocol";

const exec = promisify(execFile);

function log(level: string, event: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, event, ...extra }));
}

export interface RunClaudeOptions {
  binary?: string;
  brainCwd: string;
  promptPath: string;
  prompt: string;
  sessionId: string | null;
  chatId?: number;
  notifyPort?: number;
  env?: Record<string, string>;
}

export interface ClaudeRunResult extends ParsedClaudeOutput {
  sessionId: string;
}

export async function runClaude(opts: RunClaudeOptions): Promise<ClaudeRunResult> {
  const binary = opts.binary ?? "claude";
  const args = [
    "-p",
    "--output-format", "json",
    "--append-system-prompt", opts.promptPath,
  ];
  if (opts.sessionId) {
    args.push("--resume", opts.sessionId);
  }
  args.push(opts.prompt);

  // argv without the trailing prompt body (which is logged separately by the caller as prompt_preview)
  const argvForLog = args.slice(0, -1);
  log("info", "claude_spawn", {
    binary,
    args: argvForLog,
    cwd: opts.brainCwd,
    resumed: !!opts.sessionId,
  });

  const startedAt = Date.now();
  let stdout: string;
  try {
    const r = await exec(binary, args, {
      cwd: opts.brainCwd,
      env: {
        ...process.env,
        TG_MODE: "1",
        ...(opts.chatId !== undefined ? { NOTIFY_CHAT_ID: String(opts.chatId) } : {}),
        ...(opts.notifyPort !== undefined ? { NOTIFY_PORT: String(opts.notifyPort) } : {}),
        ...(opts.env ?? {}),
      },
      maxBuffer: 16 * 1024 * 1024,
    });
    stdout = r.stdout;
    log("info", "claude_exit", {
      duration_ms: Date.now() - startedAt,
      stdout_len: stdout.length,
    });
  } catch (e: unknown) {
    const err = e as { code?: number; stderr?: string };
    const stderrPreview = (err.stderr ?? "").slice(0, 500);
    log("error", "claude_exit", {
      duration_ms: Date.now() - startedAt,
      code: err.code ?? null,
      stderr_preview: stderrPreview,
    });
    throw new Error(
      `claude exit code ${err.code ?? "?"}: ${err.stderr ?? (e as Error).message}`
    );
  }

  let envelope: { session_id?: string; result?: string };
  try {
    envelope = JSON.parse(stdout);
  } catch {
    throw new Error(`claude returned non-JSON output: ${stdout.slice(0, 200)}`);
  }
  if (!envelope.session_id || typeof envelope.result !== "string") {
    throw new Error(`claude envelope missing session_id or result`);
  }

  const parsed = parseClaudeOutput(envelope.result);
  return { ...parsed, sessionId: envelope.session_id };
}
