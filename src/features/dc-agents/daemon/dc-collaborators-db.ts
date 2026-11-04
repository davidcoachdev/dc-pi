import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import { getDcStudioDir } from "../../../core/dc-paths.ts";

export type CollaboratorStatus = "ALLOW" | "BLOCK" | "PENDING";
export type CollaboratorRole = "OWNER" | "MAINTAINER" | "CONTRIBUTOR" | "EXTERNAL";

export interface CollaboratorRecord {
  login: string;
  status: CollaboratorStatus;
  role: CollaboratorRole;
  addedAt: number;
  updatedAt: number;
  notes?: string;
}

export interface AuditLogRecord {
  id?: number;
  timestamp: number;
  level: "INFO" | "WARN" | "ERROR" | "SECURITY";
  category: "WEBHOOK" | "WORKTREE" | "DISPATCH" | "SECURITY" | "TESTS" | "CONFLICT";
  actor: string;
  message: string;
  metadata?: string; // JSON string
}

export class CollaboratorsDatabase {
  private db: DatabaseSync;
  private dbPath: string;

  constructor(dbPathOrInMemory?: string) {
    if (dbPathOrInMemory === ":memory:") {
      this.dbPath = ":memory:";
      this.db = new DatabaseSync(":memory:");
    } else {
      const studioDir = getDcStudioDir();
      this.dbPath = dbPathOrInMemory || path.join(studioDir, "dc-collaborators.db");
      const parentDir = path.dirname(this.dbPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      this.db = new DatabaseSync(this.dbPath);
    }

    this.initializeSchema();
    this.seedDefaults();
  }

  public getDbPath(): string {
    return this.dbPath;
  }

  public close(): void {
    try {
      this.db.close();
    } catch {
      /* best-effort */
    }
  }

  private initializeSchema(): void {
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS collaborators (
        login TEXT PRIMARY KEY,
        status TEXT NOT NULL, -- ALLOW, BLOCK, PENDING
        role TEXT NOT NULL DEFAULT 'CONTRIBUTOR', -- OWNER, MAINTAINER, CONTRIBUTOR, EXTERNAL
        added_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        notes TEXT
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        level TEXT NOT NULL,
        category TEXT NOT NULL,
        actor TEXT NOT NULL,
        message TEXT NOT NULL,
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs (timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_collab_status ON collaborators (status);
    `);
  }

  private seedDefaults(): void {
    // Si la tabla está vacía, sembrar al propietario davidcoachdev por defecto
    const countStmt = this.db.prepare("SELECT COUNT(*) as count FROM collaborators");
    const res = countStmt.get() as { count: number };
    if (res.count === 0) {
      const now = Date.now();
      const insert = this.db.prepare(`
        INSERT INTO collaborators (login, status, role, added_at, updated_at, notes)
        VALUES (?, 'ALLOW', 'OWNER', ?, ?, 'Propietario del repositorio')
      `);
      insert.run("davidcoachdev", now, now);

      this.log({
        level: "SECURITY",
        category: "SECURITY",
        actor: "system",
        message: "Inicializada base de datos soberana de colaboradores con davidcoachdev (OWNER)",
      });
    }
  }

  public getCollaborator(login: string): CollaboratorRecord | undefined {
    const clean = login.replace(/^@/, "").toLowerCase().trim();
    const stmt = this.db.prepare(`
      SELECT login, status, role, added_at as addedAt, updated_at as updatedAt, notes
      FROM collaborators WHERE login = ?
    `);
    const row = stmt.get(clean) as any;
    if (!row) return undefined;
    return {
      login: row.login,
      status: row.status as CollaboratorStatus,
      role: row.role as CollaboratorRole,
      addedAt: Number(row.addedAt),
      updatedAt: Number(row.updatedAt),
      notes: row.notes,
    };
  }

  public setCollaborator(
    login: string,
    status: CollaboratorStatus,
    role: CollaboratorRole = "CONTRIBUTOR",
    notes?: string,
  ): void {
    const clean = login.replace(/^@/, "").toLowerCase().trim();
    const now = Date.now();
    const existing = this.getCollaborator(clean);

    if (existing) {
      const stmt = this.db.prepare(`
        UPDATE collaborators
        SET status = ?, role = ?, updated_at = ?, notes = coalesce(?, notes)
        WHERE login = ?
      `);
      stmt.run(status, role, now, notes ?? null, clean);
    } else {
      const stmt = this.db.prepare(`
        INSERT INTO collaborators (login, status, role, added_at, updated_at, notes)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      stmt.run(clean, status, role, now, now, notes ?? null);
    }

    this.log({
      level: "SECURITY",
      category: "SECURITY",
      actor: "user",
      message: `Colaborador @${clean} actualizado a estado ${status} (Rol: ${role})`,
    });
  }

  public toggleCollaboratorStatus(login: string): CollaboratorStatus {
    const current = this.getCollaborator(login);
    if (!current) {
      this.setCollaborator(login, "ALLOW");
      return "ALLOW";
    }

    // Toggle: ALLOW -> BLOCK -> PENDING -> ALLOW
    let next: CollaboratorStatus = "ALLOW";
    if (current.status === "ALLOW") next = "BLOCK";
    else if (current.status === "BLOCK") next = "PENDING";
    else next = "ALLOW";

    this.setCollaborator(login, next, current.role, current.notes);
    return next;
  }

  public listCollaborators(): CollaboratorRecord[] {
    const stmt = this.db.prepare(`
      SELECT login, status, role, added_at as addedAt, updated_at as updatedAt, notes
      FROM collaborators ORDER BY added_at ASC
    `);
    const rows = stmt.all() as any[];
    return rows.map((r) => ({
      login: r.login,
      status: r.status as CollaboratorStatus,
      role: r.role as CollaboratorRole,
      addedAt: Number(r.addedAt),
      updatedAt: Number(r.updatedAt),
      notes: r.notes,
    }));
  }

  public log(entry: Omit<AuditLogRecord, "timestamp">): void {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO audit_logs (timestamp, level, category, actor, message, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      now,
      entry.level,
      entry.category,
      entry.actor,
      entry.message,
      entry.metadata ?? null,
    );
  }

  public getRecentLogs(limit: number = 100): AuditLogRecord[] {
    const stmt = this.db.prepare(`
      SELECT id, timestamp, level, category, actor, message, metadata
      FROM audit_logs ORDER BY timestamp DESC LIMIT ?
    `);
    const rows = stmt.all(limit) as any[];
    return rows.map((r) => ({
      id: r.id,
      timestamp: Number(r.timestamp),
      level: r.level,
      category: r.category,
      actor: r.actor,
      message: r.message,
      metadata: r.metadata,
    }));
  }
}

let activeCollabDb: CollaboratorsDatabase | undefined;

export function getCollaboratorsDatabase(): CollaboratorsDatabase {
  if (!activeCollabDb) {
    activeCollabDb = new CollaboratorsDatabase();
  }
  return activeCollabDb;
}
