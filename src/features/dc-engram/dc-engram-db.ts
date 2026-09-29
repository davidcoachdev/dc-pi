import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
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
 * Resuelve de forma determinista y canónica el nombre de proyecto en Engram.
 * Prioridad de resolución alineada con el daemon oficial de Engram:
 * 1. Parámetro explícito `projectName` si se provee.
 * 2. Variable de entorno `ENGRAM_PROJECT`.
 * 3. Archivo `.git/engram-project-identity.json` en la raíz del repositorio.
 * 4. Archivo `.engram/config.json` en el árbol de directorios.
 * 5. Directorio raíz del repositorio Git (.git).
 * 6. Fallback al basename del directorio de trabajo actual.
 */
export function resolveEngramProjectName(projectName?: string, cwd?: string): string {
  if (projectName && projectName.trim()) {
    return projectName.trim();
  }
  if (process.env.ENGRAM_PROJECT && process.env.ENGRAM_PROJECT.trim()) {
    return process.env.ENGRAM_PROJECT.trim();
  }

  const targetDir = cwd || process.cwd();

  try {
    let dir = targetDir;
    while (dir && dir !== path.dirname(dir)) {
      const gitIdentity = path.join(dir, ".git", "engram-project-identity.json");
      if (fs.existsSync(gitIdentity)) {
        try {
          const raw = fs.readFileSync(gitIdentity, "utf8");
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed.project === "string" && parsed.project.trim()) {
            return parsed.project.trim();
          }
        } catch {}
      }

      const engramConfig = path.join(dir, ".engram", "config.json");
      if (fs.existsSync(engramConfig)) {
        try {
          const raw = fs.readFileSync(engramConfig, "utf8");
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed.project === "string" && parsed.project.trim()) {
            return parsed.project.trim();
          }
        } catch {}
      }

      if (fs.existsSync(path.join(dir, ".git"))) {
        return path.basename(dir);
      }

      dir = path.dirname(dir);
    }
  } catch {}

  return path.basename(targetDir);
}

/**
 * Consulta las observaciones de memoria persistente de Engram desde ~/.engram/engram.db
 * filtrando por proyecto utilizando el binario sqlite3.
 */
export function getProjectObservations(limit = 150, projectName?: string, cwd?: string): EngramObservation[] {
  try {
    const dbPath = path.join(os.homedir(), ".engram", "engram.db");
    const resolved = resolveEngramProjectName(projectName, cwd);
    const proj = resolved.replace(/'/g, "''");
    const query = proj === "*"
      ? `SELECT id, type, title, content, scope, created_at FROM observations WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT ${limit};`
      : `SELECT id, type, title, content, scope, created_at FROM observations WHERE deleted_at IS NULL AND project = '${proj}' ORDER BY created_at DESC LIMIT ${limit};`;

    const out = execFileSync(
      "sqlite3",
      [
        dbPath,
        "-json",
        query,
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
export function isProjectEnrolled(projectName?: string, cwd?: string): boolean {
  try {
    const dbPath = path.join(os.homedir(), ".engram", "engram.db");
    const resolved = resolveEngramProjectName(projectName, cwd);
    const proj = resolved.replace(/'/g, "''");
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
