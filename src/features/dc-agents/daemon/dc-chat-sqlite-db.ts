import * as fs from "node:fs";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getDcControlPaths } from "../../../core/dc-paths.ts";

export interface ChatThread {
  id: string; // ej: "issue-16"
  title: string;
  participant: string;
  repoNwo?: string;
  issueNumber?: number;
  unreadCount: number;
  updatedAt: number;
}

export interface ChatMessageRecord {
  id: string;
  threadId: string;
  sender: string; // ej: "davidcoachdev", "super_agent_86", "usuario_externo"
  senderRole: "owner" | "agent" | "third_party";
  incomingText: string;
  quotedText?: string;
  replyText?: string;
  status: "pending_review" | "approved" | "rejected" | "sent";
  isMalicious?: boolean;
  timestamp: number;
}

/**
 * Base de Datos Soberana en SQLite para el Messenger de Super-Agentes.
 * Ubicación: ~/.pi/agent/dc-studio/control/chat.db
 */
export class DcChatDatabase {
  private static instance?: DcChatDatabase;
  private db: DatabaseSync;
  private dbPath: string;

  constructor(customPath?: string) {
    if (customPath) {
      this.dbPath = customPath;
    } else {
      const paths = getDcControlPaths();
      this.dbPath = path.join(paths.dir, "chat.db");
    }

    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    }

    this.db = new DatabaseSync(this.dbPath);
    this.initSchema();
  }

  public static getInstance(): DcChatDatabase {
    if (!DcChatDatabase.instance) {
      DcChatDatabase.instance = new DcChatDatabase();
    }
    return DcChatDatabase.instance;
  }

  private initSchema(): void {
    try {
      this.db.exec("PRAGMA journal_mode = WAL;");
      this.db.exec("PRAGMA synchronous = NORMAL;");

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS chat_threads (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          participant TEXT NOT NULL,
          repo_nwo TEXT,
          issue_number INTEGER,
          unread_count INTEGER DEFAULT 0,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS chat_messages (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL,
          sender TEXT NOT NULL,
          sender_role TEXT NOT NULL,
          incoming_text TEXT NOT NULL,
          quoted_text TEXT,
          reply_text TEXT,
          status TEXT NOT NULL,
          is_malicious INTEGER DEFAULT 0,
          timestamp INTEGER NOT NULL,
          FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON chat_messages(thread_id, timestamp);
      `);
    } catch {
      /* defensive */
    }
  }

  public upsertThread(thread: Omit<ChatThread, "unreadCount"> & { unreadCount?: number }): void {
    const stmt = this.db.prepare(`
      INSERT INTO chat_threads (id, title, participant, repo_nwo, issue_number, unread_count, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        participant = excluded.participant,
        repo_nwo = excluded.repo_nwo,
        issue_number = excluded.issue_number,
        unread_count = excluded.unread_count,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      thread.id,
      thread.title,
      thread.participant,
      thread.repoNwo ?? null,
      thread.issueNumber ?? null,
      thread.unreadCount ?? 0,
      thread.updatedAt,
    );
  }

  public listThreads(): ChatThread[] {
    const stmt = this.db.prepare(`
      SELECT id, title, participant, repo_nwo as repoNwo, issue_number as issueNumber, unread_count as unreadCount, updated_at as updatedAt
      FROM chat_threads
      ORDER BY updated_at DESC
    `);
    return stmt.all() as unknown as ChatThread[];
  }

  public addMessage(msg: ChatMessageRecord): void {
    // 1. Asegurar o actualizar el hilo
    const existingThreadStmt = this.db.prepare(`SELECT id, unread_count FROM chat_threads WHERE id = ?`);
    const existing = existingThreadStmt.get(msg.threadId) as { id: string; unread_count: number } | undefined;
    const currentUnread = existing?.unread_count ?? 0;
    const increment = msg.status === "pending_review" ? 1 : 0;

    const upsertThreadStmt = this.db.prepare(`
      INSERT INTO chat_threads (id, title, participant, unread_count, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        unread_count = unread_count + ?,
        updated_at = ?
    `);

    upsertThreadStmt.run(
      msg.threadId,
      `Conversación ${msg.threadId}`,
      `@${msg.sender}`,
      increment,
      msg.timestamp,
      increment,
      msg.timestamp,
    );

    // 2. Insertar mensaje
    const stmt = this.db.prepare(`
      INSERT INTO chat_messages (
        id, thread_id, sender, sender_role, incoming_text, quoted_text, reply_text, status, is_malicious, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      msg.id,
      msg.threadId,
      msg.sender,
      msg.senderRole,
      msg.incomingText,
      msg.quotedText ?? null,
      msg.replyText ?? null,
      msg.status,
      msg.isMalicious ? 1 : 0,
      msg.timestamp,
    );
  }

  public updateMessageStatus(id: string, status: ChatMessageRecord["status"], replyText?: string): void {
    const stmt = this.db.prepare(`
      UPDATE chat_messages
      SET status = ?, reply_text = COALESCE(?, reply_text)
      WHERE id = ?
    `);
    stmt.run(status, replyText ?? null, id);
  }

  public getMessagesForThread(threadId: string, limit = 100): ChatMessageRecord[] {
    const stmt = this.db.prepare(`
      SELECT
        id, thread_id as threadId, sender, sender_role as senderRole,
        incoming_text as incomingText, quoted_text as quotedText,
        reply_text as replyText, status, is_malicious as isMalicious, timestamp
      FROM chat_messages
      WHERE thread_id = ?
      ORDER BY timestamp ASC
      LIMIT ?
    `);

    const rows = stmt.all(threadId, limit) as any[];
    return rows.map((r) => ({
      ...r,
      isMalicious: r.isMalicious === 1,
    }));
  }

  public markThreadRead(threadId: string): void {
    const stmt = this.db.prepare(`UPDATE chat_threads SET unread_count = 0 WHERE id = ?`);
    stmt.run(threadId);
  }

  public close(): void {
    try {
      this.db.close();
    } catch {}
  }
}

export const dcChatDatabase = DcChatDatabase.getInstance();
