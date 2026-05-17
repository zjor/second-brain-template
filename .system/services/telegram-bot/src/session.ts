import Database from "better-sqlite3";

export interface Session {
  tgUserId: number;
  claudeSessionId: string;
  chatId: number;
  lastActiveAt: number;
}

export class SessionStore {
  private db: Database.Database;
  private ttlMs: number;

  constructor(dbPath: string, ttlMinutes: number) {
    this.db = new Database(dbPath);
    this.ttlMs = ttlMinutes * 60_000;
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        tg_user_id        INTEGER PRIMARY KEY,
        claude_session_id TEXT NOT NULL,
        chat_id           INTEGER NOT NULL,
        last_active_at    INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS callbacks (
        message_id  INTEGER NOT NULL,
        token       TEXT NOT NULL,
        intent      TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        PRIMARY KEY (message_id, token)
      );
    `);
  }

  get(tgUserId: number): Session | null {
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE tg_user_id = ?")
      .get(tgUserId) as
      | { tg_user_id: number; claude_session_id: string; chat_id: number; last_active_at: number }
      | undefined;
    if (!row) return null;
    if (Date.now() - row.last_active_at > this.ttlMs) return null;
    return {
      tgUserId: row.tg_user_id,
      claudeSessionId: row.claude_session_id,
      chatId: row.chat_id,
      lastActiveAt: row.last_active_at,
    };
  }

  upsert(tgUserId: number, claudeSessionId: string, chatId: number): void {
    this.db
      .prepare(
        `INSERT INTO sessions (tg_user_id, claude_session_id, chat_id, last_active_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(tg_user_id) DO UPDATE SET
           claude_session_id = excluded.claude_session_id,
           chat_id           = excluded.chat_id,
           last_active_at    = excluded.last_active_at`
      )
      .run(tgUserId, claudeSessionId, chatId, Date.now());
  }

  touch(tgUserId: number): void {
    this.db
      .prepare("UPDATE sessions SET last_active_at = ? WHERE tg_user_id = ?")
      .run(Date.now(), tgUserId);
  }

  reset(tgUserId: number): void {
    this.db.prepare("DELETE FROM sessions WHERE tg_user_id = ?").run(tgUserId);
  }

  putCallback(messageId: number, token: string, intent: string): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO callbacks (message_id, token, intent, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(messageId, token, intent, Date.now());
  }

  getCallback(messageId: number, token: string): string | null {
    const row = this.db
      .prepare("SELECT intent FROM callbacks WHERE message_id = ? AND token = ?")
      .get(messageId, token) as { intent: string } | undefined;
    return row ? row.intent : null;
  }

  deleteCallback(messageId: number, token: string): void {
    this.db
      .prepare("DELETE FROM callbacks WHERE message_id = ? AND token = ?")
      .run(messageId, token);
  }

  close(): void {
    this.db.close();
  }

  // Test-only: force a session's lastActiveAt for TTL testing.
  testForceLastActiveAt(tgUserId: number, ts: number): void {
    this.db
      .prepare("UPDATE sessions SET last_active_at = ? WHERE tg_user_id = ?")
      .run(ts, tgUserId);
  }
}
