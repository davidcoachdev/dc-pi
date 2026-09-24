import { execFileSync } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";

export interface EngramObservation {
  id: number;
  type: string;
  title: string;
  content: string;
  scope: string;
  created_at: string;
}

/**
 * Consulta las observaciones de memoria persistente de Engram desde ~/.engram/engram.db
 * filtrando estrictamente por proyecto utilizando el binario sqlite3.
 */
export function getProjectObservations(limit = 150, projectName?: string): EngramObservation[] {
  try {
    const dbPath = path.join(os.homedir(), ".engram", "engram.db");
    const proj = (projectName || path.basename(process.cwd())).replace(/'/g, "''");
    const out = execFileSync(
      "sqlite3",
      [
        dbPath,
        "-json",
        `SELECT id, type, title, content, scope, created_at FROM observations WHERE deleted_at IS NULL AND project = '${proj}' ORDER BY created_at DESC LIMIT ${limit};`,
      ],
      { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] },
    );
    if (!out || !out.trim()) return [];
    return JSON.parse(out.trim()) as EngramObservation[];
  } catch {
    return [];
  }
}

/**
 * Verifica si un proyecto está enrolado para sincronización en la nube en sync_enrolled_projects.
 */
export function isProjectEnrolled(projectName?: string): boolean {
  try {
    const dbPath = path.join(os.homedir(), ".engram", "engram.db");
    const proj = (projectName || path.basename(process.cwd())).replace(/'/g, "''");
    const count = execFileSync(
      "sqlite3",
      [dbPath, `SELECT count(*) FROM sync_enrolled_projects WHERE project = '${proj}';`],
      { encoding: "utf8", timeout: 1000, stdio: ["ignore", "pipe", "ignore"] },
    );
    return parseInt(count.trim(), 10) > 0;
  } catch {
    return false;
  }
}
