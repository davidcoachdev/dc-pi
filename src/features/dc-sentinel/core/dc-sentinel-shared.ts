import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import { getDcStudioDir } from "../../../core/dc-paths.ts";
import { SentinelDatabase, sentinelNoteFingerprint } from "./dc-sentinel-db.ts";
import type { SentinelVerification } from "./dc-sentinel-types.ts";
import { sanitizeMemoryDefense } from "./dc-sentinel-defense.ts";

export interface SharedPublicationApproval {
  approved: boolean;
  revision: number;
  fingerprint: string;
  applicability: string;
}
export interface SharedSentinelNote {
  sourceRoot: string;
  sourceProject: string;
  sourceId: number;
  sourceRevision: number;
  fingerprint: string;
  title: string;
  content: string;
  type: string;
  applicability: string;
  verification: SentinelVerification;
  expiresAt?: string;
}

function safeText(text: string): string {
  const clean = sanitizeMemoryDefense(text);
  // Redacted local records are not implicitly approved for publication either.
  if (clean.redactedCount || clean.privateBlocksStripped || /\[.*(?:REDACTED|PRIVATE).*\]|<(?:private|secret)>/i.test(text)) {
    throw new Error("Private or sensitive publication rejected");
  }
  return clean.text;
}

/** Explicit snapshots only. No project scans, local scope mutations or cross-DB transaction claim. */
export class SentinelSharedCatalogue {
  private db: DatabaseSync;
  constructor(cataloguePath = path.join(getDcStudioDir(), "sentinel-shared.db")) {
    if (cataloguePath !== ":memory:") fs.mkdirSync(path.dirname(cataloguePath), { recursive: true });
    this.db = new DatabaseSync(cataloguePath);
    try {
      this.db.exec(`
        PRAGMA busy_timeout = 5000;
        CREATE TABLE IF NOT EXISTS publications (
          id INTEGER PRIMARY KEY, source_root TEXT NOT NULL, source_id INTEGER NOT NULL,
          payload TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL,
          UNIQUE(source_root, source_id)
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS publications_fts USING fts5(title, content, tokenize='trigram');
        CREATE TRIGGER IF NOT EXISTS publications_ai AFTER INSERT ON publications BEGIN
          INSERT INTO publications_fts(rowid,title,content) VALUES(new.id,new.title,new.content);
        END;
        CREATE TRIGGER IF NOT EXISTS publications_au AFTER UPDATE ON publications BEGIN
          DELETE FROM publications_fts WHERE rowid=old.id;
          INSERT INTO publications_fts(rowid,title,content) VALUES(new.id,new.title,new.content);
        END;
      `);
    } catch (error) { this.close(); throw error; }
  }
  close(): void { try { this.db.close(); } catch { /* best effort */ } }

  publish(source: SentinelDatabase, id: number, approval: SharedPublicationApproval): SharedSentinelNote {
    const note = source.getNoteById(id); // Never trust the panel's cached note object/scope.
    const proof = note?.verification;
    if (!approval.approved || !note || note.deletedAt || note.status !== "active" ||
        !note.proofCount || !proof || !note.project_path || !path.isAbsolute(note.project_path) ||
        path.normalize(note.project_path) !== note.project_path || source.getProjectRoot() !== note.project_path ||
        (note.expiresAt && (!Number.isFinite(Date.parse(note.expiresAt)) || Date.parse(note.expiresAt) <= Date.now())) ||
        proof.projectPath !== note.project_path || proof.revision !== note.revisionCount ||
        approval.revision !== note.revisionCount || proof.fingerprint !== sentinelNoteFingerprint(note) ||
        approval.fingerprint !== proof.fingerprint || proof.isError !== false ||
        !proof.turnId || !proof.callId || !proof.command.trim() ||
        !Number.isFinite(proof.startedAt) || !Number.isFinite(proof.endedAt) || proof.endedAt < proof.startedAt) {
      throw new Error("Approval or current revision evidence missing/invalid");
    }
    if (["sensitive", "security_note", "security_alert"].includes(note.type)) throw new Error("Sensitive publication rejected");
    if (!approval.applicability.trim()) throw new Error("Applicability required");
    safeText(JSON.stringify({ note, applicability: approval.applicability }));
    const publication: SharedSentinelNote = {
      sourceRoot: note.project_path, sourceProject: note.project, sourceId: id,
      sourceRevision: note.revisionCount!, fingerprint: proof.fingerprint,
      title: safeText(note.title), content: safeText(note.content), type: note.type,
      applicability: safeText(approval.applicability.trim()), verification: { ...proof }, expiresAt: note.expiresAt,
    };
    this.db.prepare(`INSERT INTO publications(source_root,source_id,payload,title,content) VALUES(?,?,?,?,?)
      ON CONFLICT(source_root,source_id) DO UPDATE SET payload=excluded.payload,title=excluded.title,content=excluded.content`)
      .run(publication.sourceRoot, id, JSON.stringify(publication), publication.title, publication.content);
    return publication; // Only after SQLite confirms success. Local DB is unchanged.
  }

  search(query: string, limit = 6): SharedSentinelNote[] {
    if (!query.trim()) return [];
    const count = Math.max(1, Math.min(20, Math.floor(limit) || 6));
    let rows: { payload: string }[] = [];
    try {
      rows = this.db.prepare(`SELECT p.payload FROM publications_fts f JOIN publications p ON p.id=f.rowid
        WHERE publications_fts MATCH ? ORDER BY rank LIMIT ?`).all(query, count) as typeof rows;
    } catch { /* LIKE handles literal or short queries */ }
    if (!rows.length) rows = this.db.prepare("SELECT payload FROM publications WHERE title LIKE ? OR content LIKE ? LIMIT ?")
      .all(`%${query}%`, `%${query}%`, count) as typeof rows;
    return rows.map(row => JSON.parse(row.payload) as SharedSentinelNote).filter(note => {
      if (!note.sourceRoot || !path.isAbsolute(note.sourceRoot) || !note.applicability ||
          ["sensitive", "security_note", "security_alert"].includes(note.type) ||
          (note.expiresAt && !(Date.parse(note.expiresAt) > Date.now()))) return false;
      try { safeText(JSON.stringify(note)); return true; } catch { return false; }
    });
  }
}
