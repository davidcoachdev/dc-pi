/**
 * dc-taxi-logger.ts — Auditoría y logging para el Sistema de Taxis de DC Studio.
 *
 * Registra eventos de leasing, release, zombis recuperados y errores para trazabilidad.
 * Cumple con la Directiva 1 (cero dependencias de Pi) y Directiva 2 (aislado en dc-studio/).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const LOG_FILE_PATH = path.join(os.homedir(), ".pi", "agent", "dc-studio", "dc-taxis.log");
const MAX_LOG_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

function ensureLogDirectory(): void {
  const dir = path.dirname(LOG_FILE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Agrega una entrada estructurada al log de auditoría de taxis.
 */
export function appendTaxiLog(
  level: "INFO" | "WARN" | "ERROR",
  event: string,
  details?: Record<string, unknown>,
  logPath: string = LOG_FILE_PATH,
): void {
  try {
    ensureLogDirectory();

    // Rotar / truncar defensivamente y de forma atómica si excede 2MB
    if (fs.existsSync(logPath)) {
      try {
        const stats = fs.statSync(logPath);
        if (stats.size > MAX_LOG_SIZE_BYTES) {
          const content = fs.readFileSync(logPath, "utf8");
          const lines = content.split("\n");
          // Conservar las últimas 1000 líneas más recientes
          const pruned = lines.slice(-1000).join("\n") + "\n";
          const tmpPath = `${logPath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
          fs.writeFileSync(tmpPath, pruned, "utf8");
          fs.renameSync(tmpPath, logPath);
        }
      } catch {
        /* ignore size check errors */
      }
    }

    const timestamp = new Date().toISOString();
    const payload = details ? ` | ${JSON.stringify(details)}` : "";
    const logLine = `[${timestamp}] [${level}] ${event}${payload}\n`;

    fs.appendFileSync(logPath, logLine, "utf8");
  } catch {
    /* logging nunca debe crashear la aplicación */
  }
}

/**
 * Lee las líneas más recientes del log de taxis para visualización en TUI.
 */
export function readRecentTaxiLogs(limit: number = 80, logPath: string = LOG_FILE_PATH): string[] {
  if (!fs.existsSync(logPath)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(logPath, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    return lines.slice(-limit).reverse();
  } catch {
    return [];
  }
}
