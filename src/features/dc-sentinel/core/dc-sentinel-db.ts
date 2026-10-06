import { DatabaseSync } from "node:sqlite";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { getDcStudioDir } from "../../../core/dc-paths.ts";
import type {
  MemoryChipItem,
  SentinelActor,
  SentinelNote,
  SentinelNoteType,
  SentinelProcedure,
  SentinelRelation,
  SentinelStats,
  SmartFrame,
  SENTINEL_TYPE_GLYPHS,
} from "./dc-sentinel-types.ts";

/**
 * Normaliza un texto para cálculo de hash de deduplicación:
 * minúsculas, espacios colapsados y sin puntuación extrema.
 */
export function normalizeTextForHash(text: string): string {
  if (!text) return "";
  const cleaned = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return crypto.createHash("sha256").update(cleaned).digest("hex").slice(0, 32);
}

/**
 * Resuelve la ruta canónica del archivo SQLite de Sentinel.
 * Si el proyecto actual tiene una carpeta `dc-sentinela/`, usa `dc-sentinela/.cache/sentinel.db`.
 * De lo contrario, usa `~/.pi/agent/dc-studio/sentinel-<proyecto>.db` (Blast Radius Cero).
 */
export function resolveSentinelDbPath(project: string = "default", projectRoot?: string): string {
  const safeProjectName = project.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase() || "default";

  if (projectRoot) {
    const projectSentinelDir = path.join(projectRoot, "dc-sentinela");
    if (fs.existsSync(projectSentinelDir)) {
      const cacheDir = path.join(projectSentinelDir, ".cache");
      fs.mkdirSync(cacheDir, { recursive: true });
      return path.join(cacheDir, "sentinel.db");
    }
  }

  const dcStudioDir = getDcStudioDir();
  return path.join(dcStudioDir, `sentinel-${safeProjectName}.db`);
}

/**
 * Motor local soberano de base de datos de DC Sentinel basado en `node:sqlite`.
 * Cero dependencias externas, WAL mode, FTS5 trigrams y Smart Frames inmutables.
 */
export class SentinelDatabase {
  private db: DatabaseSync;
  private dbPath: string;
  private currentProject: string;

  constructor(project: string = "default", projectRoot?: string, inMemory: boolean = false) {
    this.currentProject = project;
    if (inMemory) {
      this.dbPath = ":memory:";
      this.db = new DatabaseSync(":memory:");
    } else {
      this.dbPath = resolveSentinelDbPath(project, projectRoot);
      const parentDir = path.dirname(this.dbPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      this.db = new DatabaseSync(this.dbPath);
    }

    this.initializeSchema();
  }

  getDbPath(): string {
    return this.dbPath;
  }

  close(): void {
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
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS schema_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS frames (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        frame_seq INTEGER,
        session_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        actor TEXT NOT NULL,
        event_type TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata_json TEXT,
        checksum TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_frames_session ON frames(session_id);
      CREATE INDEX IF NOT EXISTS idx_frames_turn ON frames(turn_id);
      CREATE INDEX IF NOT EXISTS idx_frames_created ON frames(created_at);

      CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'project',
        type TEXT NOT NULL,
        glyph TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        topic_key TEXT,
        normalized_hash TEXT,
        revision_count INTEGER NOT NULL DEFAULT 1,
        duplicate_count INTEGER NOT NULL DEFAULT 1,
        last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
        concepts_json TEXT,
        files_json TEXT,
        blast_radius_json TEXT,
        proof_count INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'active',
        pinned INTEGER NOT NULL DEFAULT 0,
        expires_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        deleted_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_notes_project ON notes(project);
      CREATE INDEX IF NOT EXISTS idx_notes_type ON notes(type);
      CREATE INDEX IF NOT EXISTS idx_notes_topic ON notes(topic_key, project);
      CREATE INDEX IF NOT EXISTS idx_notes_hash ON notes(normalized_hash, project);
      CREATE INDEX IF NOT EXISTS idx_notes_deleted ON notes(deleted_at);

      CREATE TABLE IF NOT EXISTS procedures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project TEXT NOT NULL,
        name TEXT NOT NULL,
        title TEXT NOT NULL,
        trigger_pattern TEXT NOT NULL,
        symptoms TEXT,
        preconditions TEXT,
        steps_json TEXT NOT NULL,
        verification_cmd TEXT,
        success_rate REAL NOT NULL DEFAULT 1.0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_proc_project ON procedures(project);
      CREATE INDEX IF NOT EXISTS idx_proc_name ON procedures(name);

      CREATE TABLE IF NOT EXISTS links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id INTEGER NOT NULL,
        target_id INTEGER NOT NULL,
        relation TEXT NOT NULL DEFAULT 'related_to',
        reason TEXT,
        confidence REAL DEFAULT 1.0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (source_id) REFERENCES notes(id) ON DELETE CASCADE,
        FOREIGN KEY (target_id) REFERENCES notes(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_id);
      CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_id);
    `);

    // Inicializar tabla virtual FTS5 trigram con triggers automáticos
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
        title, content, type, topic_key,
        tokenize='trigram',
        content='notes',
        content_rowid='id'
      );

      CREATE TRIGGER IF NOT EXISTS notes_fts_ai AFTER INSERT ON notes
      WHEN new.deleted_at IS NULL BEGIN
        INSERT INTO notes_fts(rowid, title, content, type, topic_key)
        VALUES (new.id, new.title, new.content, new.type, new.topic_key);
      END;

      CREATE TRIGGER IF NOT EXISTS notes_fts_ad AFTER DELETE ON notes
      WHEN old.deleted_at IS NULL BEGIN
        INSERT INTO notes_fts(notes_fts, rowid, title, content, type, topic_key)
        VALUES ('delete', old.id, old.title, old.content, old.type, old.topic_key);
      END;

      CREATE TRIGGER IF NOT EXISTS notes_fts_au AFTER UPDATE ON notes BEGIN
        INSERT INTO notes_fts(notes_fts, rowid, title, content, type, topic_key)
        SELECT 'delete', old.id, old.title, old.content, old.type, old.topic_key
        WHERE old.deleted_at IS NULL;

        INSERT INTO notes_fts(rowid, title, content, type, topic_key)
        SELECT new.id, new.title, new.content, new.type, new.topic_key
        WHERE new.deleted_at IS NULL;
      END;
    `);
  }

  // ==========================================================================
  // Smart Frames (Memvid Append-Only & Time-Travel)
  // ==========================================================================

  recordFrame(frame: SmartFrame): SmartFrame {
    const rawContent = `${frame.actor}|${frame.title}|${frame.content}`;
    const checksum = crypto.createHash("sha256").update(rawContent).digest("hex").slice(0, 16);
    const metadataStr = frame.metadata ? JSON.stringify(frame.metadata) : null;

    const countRow = this.db.prepare("SELECT COUNT(*) as cnt FROM frames").get() as { cnt: number };
    const nextSeq = (countRow?.cnt ?? 0) + 1;

    const stmt = this.db.prepare(`
      INSERT INTO frames (
        frame_seq, session_id, turn_id, actor, event_type, title, content, metadata_json, checksum, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    const result = stmt.run(
      nextSeq,
      frame.sessionId,
      frame.turnId,
      frame.actor,
      frame.eventType,
      frame.title,
      frame.content,
      metadataStr,
      checksum,
    );

    return {
      ...frame,
      id: Number(result.lastInsertRowid),
      frameSeq: nextSeq,
      checksum,
      createdAt: new Date().toISOString(),
    };
  }

  listFrames(options: { sessionId?: string; limit?: number; offset?: number } = {}): SmartFrame[] {
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;

    let rows: any[];
    if (options.sessionId) {
      rows = this.db
        .prepare(`
          SELECT * FROM frames
          WHERE session_id = ?
          ORDER BY frame_seq ASC
          LIMIT ? OFFSET ?
        `)
        .all(options.sessionId, limit, offset);
    } else {
      rows = this.db
        .prepare(`
          SELECT * FROM frames
          ORDER BY frame_seq ASC
          LIMIT ? OFFSET ?
        `)
        .all(limit, offset);
    }

    return rows.map((r) => ({
      id: r.id,
      frameSeq: r.frame_seq,
      sessionId: r.session_id,
      turnId: r.turn_id,
      actor: r.actor as SentinelActor,
      eventType: r.event_type,
      title: r.title,
      content: r.content,
      metadata: r.metadata_json ? JSON.parse(r.metadata_json) : undefined,
      checksum: r.checksum,
      createdAt: r.created_at,
    }));
  }

  // ==========================================================================
  // Notas Atómicas (Zettelkasten + Engram Topic Keys + Deduplicación)
  // ==========================================================================

  saveNote(note: Omit<SentinelNote, "id">): SentinelNote {
    const project = note.project || this.currentProject;
    const normHash = note.normalizedHash || normalizeTextForHash(`${note.title} ${note.content}`);

    // 1. Detección de duplicado exacto por normalized_hash
    const dupStmt = this.db.prepare(`
      SELECT * FROM notes
      WHERE project = ? AND normalized_hash = ? AND deleted_at IS NULL
      LIMIT 1
    `);
    const existingDup = dupStmt.get(project, normHash) as any;

    if (existingDup) {
      const updatedCount = (existingDup.duplicate_count || 1) + 1;
      this.db
        .prepare(`
          UPDATE notes
          SET duplicate_count = ?, last_seen_at = datetime('now')
          WHERE id = ?
        `)
        .run(updatedCount, existingDup.id);

      return this.mapNoteRow({
        ...existingDup,
        duplicate_count: updatedCount,
        last_seen_at: new Date().toISOString(),
      });
    }

    // 2. Detección de actualización evolutiva por topic_key
    if (note.topicKey && note.topicKey.trim().length > 0) {
      const topicStmt = this.db.prepare(`
        SELECT * FROM notes
        WHERE project = ? AND topic_key = ? AND deleted_at IS NULL
        LIMIT 1
      `);
      const existingTopic = topicStmt.get(project, note.topicKey.trim()) as any;

      if (existingTopic) {
        const nextRev = (existingTopic.revision_count || 1) + 1;
        const conceptsJson = note.concepts ? JSON.stringify(note.concepts) : existingTopic.concepts_json;
        const filesJson = note.filesAffected ? JSON.stringify(note.filesAffected) : existingTopic.files_json;
        const blastRadiusJson = note.blastRadius ? JSON.stringify(note.blastRadius) : existingTopic.blast_radius_json;

        this.db
          .prepare(`
            UPDATE notes
            SET title = ?, content = ?, type = ?, glyph = ?,
                revision_count = ?, normalized_hash = ?,
                concepts_json = ?, files_json = ?, blast_radius_json = ?,
                updated_at = datetime('now'), last_seen_at = datetime('now')
            WHERE id = ?
          `)
          .run(
            note.title,
            note.content,
            note.type,
            note.glyph,
            nextRev,
            normHash,
            conceptsJson,
            filesJson,
            blastRadiusJson,
            existingTopic.id,
          );

        return this.mapNoteRow({
          ...existingTopic,
          title: note.title,
          content: note.content,
          type: note.type,
          glyph: note.glyph,
          revision_count: nextRev,
          normalized_hash: normHash,
          concepts_json: conceptsJson,
          files_json: filesJson,
          blast_radius_json: blastRadiusJson,
          updated_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
        });
      }
    }

    // 3. Inserción de nueva nota atómica
    const conceptsJson = note.concepts ? JSON.stringify(note.concepts) : null;
    const filesJson = note.filesAffected ? JSON.stringify(note.filesAffected) : null;
    const blastRadiusJson = note.blastRadius ? JSON.stringify(note.blastRadius) : null;

    const stmt = this.db.prepare(`
      INSERT INTO notes (
        project, scope, type, glyph, title, content, topic_key, normalized_hash,
        revision_count, duplicate_count, last_seen_at, concepts_json, files_json,
        blast_radius_json, proof_count, status, pinned, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, datetime('now'), ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `);

    const result = stmt.run(
      project,
      note.scope || "project",
      note.type,
      note.glyph,
      note.title,
      note.content,
      note.topicKey || null,
      normHash,
      conceptsJson,
      filesJson,
      blastRadiusJson,
      note.proofCount ?? 1,
      note.status || "active",
      note.pinned ? 1 : 0,
      note.expiresAt || null,
    );

    const insertedId = Number(result.lastInsertRowid);
    return this.getNoteById(insertedId)!;
  }

  getNoteById(id: number): SentinelNote | null {
    const row = this.db.prepare("SELECT * FROM notes WHERE id = ?").get(id) as any;
    if (!row) return null;
    return this.mapNoteRow(row);
  }

  searchNotes(
    query: string,
    options: {
      project?: string;
      type?: SentinelNoteType;
      scope?: string;
      limit?: number;
      includeDeleted?: boolean;
    } = {},
  ): SentinelNote[] {
    const limit = options.limit ?? 20;
    const project = options.project || this.currentProject;

    if (!query || query.trim().length === 0) {
      return this.listNotes({ project, type: options.type, limit, scope: options.scope });
    }

    const cleanQuery = query.trim();

    // 1. Intentar con FTS5 trigram
    try {
      let sql = `
        SELECT n.* FROM notes_fts f
        JOIN notes n ON n.id = f.rowid
        WHERE notes_fts MATCH ?
      `;
      const params: any[] = [cleanQuery];

      if (!options.includeDeleted) {
        sql += " AND n.deleted_at IS NULL";
      }

      if (options.scope !== "global") {
        sql += " AND (n.project = ? OR n.scope = 'global')";
        params.push(project);
      }

      if (options.type) {
        sql += " AND n.type = ?";
        params.push(options.type);
      }

      sql += " ORDER BY rank LIMIT ?";
      params.push(limit);

      const rows = this.db.prepare(sql).all(...params) as any[];
      if (rows.length > 0) {
        return rows.map((r) => this.mapNoteRow(r));
      }
    } catch {
      /* fallback a LIKE */
    }

    // 2. Fallback a LIKE sobre título y contenido
    let fallbackSql = `
      SELECT * FROM notes
      WHERE (title LIKE ? OR content LIKE ? OR topic_key LIKE ?)
    `;
    const likeParam = `%${cleanQuery}%`;
    const fallbackParams: any[] = [likeParam, likeParam, likeParam];

    if (!options.includeDeleted) {
      fallbackSql += " AND deleted_at IS NULL";
    }

    if (options.scope !== "global") {
      fallbackSql += " AND (project = ? OR scope = 'global')";
      fallbackParams.push(project);
    }

    if (options.type) {
      fallbackSql += " AND type = ?";
      fallbackParams.push(options.type);
    }

    fallbackSql += " ORDER BY updated_at DESC LIMIT ?";
    fallbackParams.push(limit);

    const fallbackRows = this.db.prepare(fallbackSql).all(...fallbackParams) as any[];
    return fallbackRows.map((r) => this.mapNoteRow(r));
  }

  listNotes(
    options: {
      project?: string;
      type?: SentinelNoteType;
      scope?: string;
      limit?: number;
      offset?: number;
      includeDeleted?: boolean;
    } = {},
  ): SentinelNote[] {
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;
    const project = options.project || this.currentProject;

    let sql = "SELECT * FROM notes WHERE 1=1";
    const params: any[] = [];

    if (!options.includeDeleted) {
      sql += " AND deleted_at IS NULL";
    }

    if (options.scope !== "global") {
      sql += " AND (project = ? OR scope = 'global')";
      params.push(project);
    }

    if (options.type) {
      sql += " AND type = ?";
      params.push(options.type);
    }

    sql += " ORDER BY pinned DESC, updated_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((r) => this.mapNoteRow(r));
  }

  softDeleteNote(id: number): boolean {
    const res = this.db
      .prepare("UPDATE notes SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL")
      .run(id);
    return res.changes > 0;
  }

  restoreNote(id: number): boolean {
    const res = this.db
      .prepare("UPDATE notes SET deleted_at = NULL, updated_at = datetime('now') WHERE id = ? AND deleted_at IS NOT NULL")
      .run(id);
    return res.changes > 0;
  }

  pinNote(id: number, pinned: boolean): boolean {
    const res = this.db
      .prepare("UPDATE notes SET pinned = ?, updated_at = datetime('now') WHERE id = ?")
      .run(pinned ? 1 : 0, id);
    return res.changes > 0;
  }

  // ==========================================================================
  // Procedimientos / Runbooks Ejecutables (ReMe + Tencent Auto-Skills)
  // ==========================================================================

  saveProcedure(proc: SentinelProcedure): SentinelProcedure {
    const project = proc.project || this.currentProject;
    const stepsJson = JSON.stringify(proc.steps || []);

    const existing = this.db
      .prepare("SELECT * FROM procedures WHERE project = ? AND name = ? LIMIT 1")
      .get(project, proc.name) as any;

    if (existing) {
      this.db
        .prepare(`
          UPDATE procedures
          SET title = ?, trigger_pattern = ?, symptoms = ?, preconditions = ?,
              steps_json = ?, verification_cmd = ?, success_rate = ?, updated_at = datetime('now')
          WHERE id = ?
        `)
        .run(
          proc.title,
          proc.triggerPattern,
          proc.symptoms || null,
          proc.preconditions || null,
          stepsJson,
          proc.verificationCmd || null,
          proc.successRate ?? existing.success_rate ?? 1.0,
          existing.id,
        );

      return {
        ...proc,
        id: existing.id,
        updatedAt: new Date().toISOString(),
      };
    }

    const stmt = this.db.prepare(`
      INSERT INTO procedures (
        project, name, title, trigger_pattern, symptoms, preconditions,
        steps_json, verification_cmd, success_rate, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `);

    const result = stmt.run(
      project,
      proc.name,
      proc.title,
      proc.triggerPattern,
      proc.symptoms || null,
      proc.preconditions || null,
      stepsJson,
      proc.verificationCmd || null,
      proc.successRate ?? 1.0,
    );

    return {
      ...proc,
      id: Number(result.lastInsertRowid),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  listProcedures(project?: string): SentinelProcedure[] {
    const p = project || this.currentProject;
    const rows = this.db
      .prepare("SELECT * FROM procedures WHERE project = ? ORDER BY updated_at DESC")
      .all(p) as any[];

    return rows.map((r) => ({
      id: r.id,
      project: r.project,
      name: r.name,
      title: r.title,
      triggerPattern: r.trigger_pattern,
      symptoms: r.symptoms || "",
      preconditions: r.preconditions || "",
      steps: r.steps_json ? JSON.parse(r.steps_json) : [],
      verificationCmd: r.verification_cmd || undefined,
      successRate: r.success_rate,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  // ==========================================================================
  // Enlaces y Relaciones Semánticas
  // ==========================================================================

  saveRelation(relation: SentinelRelation): SentinelRelation {
    const stmt = this.db.prepare(`
      INSERT INTO links (source_id, target_id, relation, reason, confidence, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `);

    const res = stmt.run(
      relation.sourceId,
      relation.targetId,
      relation.relation,
      relation.reason || null,
      relation.confidence ?? 1.0,
    );

    return {
      ...relation,
      id: Number(res.lastInsertRowid),
      createdAt: new Date().toISOString(),
    };
  }

  listRelationsForNote(noteId: number): SentinelRelation[] {
    const rows = this.db
      .prepare(`
        SELECT * FROM links
        WHERE source_id = ? OR target_id = ?
        ORDER BY created_at DESC
      `)
      .all(noteId, noteId) as any[];

    return rows.map((r) => ({
      id: r.id,
      sourceId: r.source_id,
      targetId: r.target_id,
      relation: r.relation,
      reason: r.reason || undefined,
      confidence: r.confidence,
      createdAt: r.created_at,
    }));
  }

  // ==========================================================================
  // Estadísticas del Centinela
  // ==========================================================================

  getStats(project?: string): SentinelStats {
    const p = project || this.currentProject;

    const framesRow = this.db.prepare("SELECT COUNT(*) as cnt FROM frames").get() as { cnt: number };
    const notesRow = this.db
      .prepare("SELECT COUNT(*) as cnt FROM notes WHERE (project = ? OR scope = 'global') AND deleted_at IS NULL")
      .get(p) as { cnt: number };
    const procRow = this.db
      .prepare("SELECT COUNT(*) as cnt FROM procedures WHERE project = ?")
      .get(p) as { cnt: number };
    const linksRow = this.db.prepare("SELECT COUNT(*) as cnt FROM links").get() as { cnt: number };

    const projectsRows = this.db
      .prepare("SELECT DISTINCT project FROM notes WHERE project IS NOT NULL AND deleted_at IS NULL")
      .all() as { project: string }[];

    return {
      framesCount: framesRow?.cnt ?? 0,
      notesCount: notesRow?.cnt ?? 0,
      proceduresCount: procRow?.cnt ?? 0,
      relationsCount: linksRow?.cnt ?? 0,
      activeProjects: projectsRows.map((r) => r.project),
      dbPath: this.dbPath,
    };
  }

  private mapNoteRow(r: any): SentinelNote {
    return {
      id: r.id,
      project: r.project,
      scope: r.scope,
      type: r.type as SentinelNoteType,
      glyph: r.glyph,
      title: r.title,
      content: r.content,
      topicKey: r.topic_key || undefined,
      normalizedHash: r.normalized_hash || undefined,
      revisionCount: r.revision_count,
      duplicateCount: r.duplicate_count,
      lastSeenAt: r.last_seen_at,
      concepts: r.concepts_json ? JSON.parse(r.concepts_json) : undefined,
      filesAffected: r.files_json ? JSON.parse(r.files_json) : undefined,
      blastRadius: r.blast_radius_json ? JSON.parse(r.blast_radius_json) : undefined,
      proofCount: r.proof_count,
      status: r.status,
      pinned: Boolean(r.pinned),
      expiresAt: r.expires_at || undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      deletedAt: r.deleted_at || null,
    };
  }
}
