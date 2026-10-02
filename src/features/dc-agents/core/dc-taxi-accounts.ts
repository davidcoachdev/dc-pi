/**
 * dc-taxi-accounts.ts — Descubrimiento dinámico de cuentas de CPAM para la Flota de Taxis.
 *
 * Lee las cuentas reales desde models.json (y fallback a models-store.json / auth.json).
 * Extrae todos los prefijos únicos ac01..ac15, ac20, etc. sin hardcodear límites estáticos.
 * Cumple con la Directiva 1 de DC Studio (cero dependencias de Pi).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const MODELS_JSON_PATH = path.join(os.homedir(), ".pi", "agent", "models.json");
const MODELS_STORE_PATH = path.join(os.homedir(), ".pi", "agent", "models-store.json");

/**
 * Descubre dinámicamente todos los prefijos de cuentas de CPAM presentes en la configuración de Pi.
 */
export function discoverCpamAccounts(
  modelsJsonPath: string = MODELS_JSON_PATH,
  modelsStorePath: string = MODELS_STORE_PATH,
): string[] {
  const accounts = new Set<string>();

  // 1. Leer models.json
  if (fs.existsSync(modelsJsonPath)) {
    try {
      const raw = fs.readFileSync(modelsJsonPath, "utf8");
      const data = JSON.parse(raw);
      const cpamModels = data?.providers?.cpam?.models;
      if (Array.isArray(cpamModels)) {
        for (const m of cpamModels) {
          const id = String(m?.id || "").trim();
          if (id.includes("/")) {
            const prefix = id.split("/")[0]?.toLowerCase();
            if (prefix && prefix.startsWith("ac")) {
              accounts.add(prefix);
            }
          }
        }
      }
    } catch {
      /* ignore parse error */
    }
  }

  // 2. Leer models-store.json como fallback complementario
  if (fs.existsSync(modelsStorePath)) {
    try {
      const raw = fs.readFileSync(modelsStorePath, "utf8");
      const data = JSON.parse(raw);
      const cpamModels = data?.cpam?.models;
      if (Array.isArray(cpamModels)) {
        for (const m of cpamModels) {
          const id = String(m?.id || "").trim();
          if (id.includes("/")) {
            const prefix = id.split("/")[0]?.toLowerCase();
            if (prefix && prefix.startsWith("ac")) {
              accounts.add(prefix);
            }
          }
        }
      }
    } catch {
      /* ignore parse error */
    }
  }

  // 3. Fallback defensivo si no había archivo
  if (accounts.size === 0) {
    for (let i = 1; i <= 15; i++) {
      accounts.add(`ac${String(i).padStart(2, "0")}`);
    }
  }

  // Ordenar alfanumérico natural (ac01, ac02, ..., ac10, ac11, ...)
  return Array.from(accounts).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
}
