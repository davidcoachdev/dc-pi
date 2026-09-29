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
 * Consulta las observaciones de memoria persistente de Engram.
 * Estrategia de doble canal:
 * 1. Canal primario: API HTTP nativa del daemon oficial de Engram (:7437).
 *    Ofrece los datos sin locks, sin tocar el archivo SQLite y sin depender de binarios externos.
 * 2. Canal de contingencia: Fallback a SQLite local ~/.engram/engram.db.
 */
export function getProjectObservations(limit = 150, projectName?: string, cwd?: string): EngramObservation[] {
  const resolved = resolveEngramProjectName(projectName, cwd);

  // 1. Intentar consultar el daemon oficial HTTP de Engram (:7437)
  try {
    const url = resolved === "*"
      ? `http://127.0.0.1:7437/observations?limit=${limit}`
      : `http://127.0.0.1:7437/observations?project=${encodeURIComponent(resolved)}&limit=${limit}`;

    const httpOut = execFileSync(
      "curl",
      ["-s", "--max-time", "1", url],
      { encoding: "utf8", timeout: 1200, stdio: ["ignore", "pipe", "ignore"] },
    );

    if (httpOut && httpOut.trim().startsWith("[")) {
      const items = JSON.parse(httpOut.trim());
      if (Array.isArray(items)) {
        return items.map((it: any) => ({
          id: typeof it.id === "number" ? it.id : 0,
          type: String(it.type || "observation"),
          title: String(it.title || "(sin título)"),
          content: String(it.content || ""),
          scope: String(it.scope || "project"),
          created_at: String(it.created_at || ""),
        }));
      }
    }
  } catch {
    /* Fallback a SQLite */
  }

  // 2. Fallback a SQLite local ~/.engram/engram.db
  try {
    const dbPath = path.join(os.homedir(), ".engram", "engram.db");
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
  const resolved = resolveEngramProjectName(projectName, cwd);

  // 1. Intentar consultar el daemon HTTP de Engram
  try {
    const httpOut = execFileSync(
      "curl",
      ["-s", "--max-time", "1", `http://127.0.0.1:7437/sync/status?project=${encodeURIComponent(resolved)}`],
      { encoding: "utf8", timeout: 1000, stdio: ["ignore", "pipe", "ignore"] },
    );
    if (httpOut && httpOut.trim().startsWith("{")) {
      const parsed = JSON.parse(httpOut.trim());
      if (typeof parsed.enabled === "boolean") {
        return parsed.enabled;
      }
    }
  } catch {
    /* Fallback a SQLite */
  }

  // 2. Fallback a SQLite local
  try {
    const dbPath = path.join(os.homedir(), ".engram", "engram.db");
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
