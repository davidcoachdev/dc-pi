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

function getAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || path.join(process.env.HOME || os.homedir(), ".pi", "agent");
}

function getDefaultModelsJsonPath(): string {
  return path.join(getAgentDir(), "models.json");
}

function getDefaultModelsStorePath(): string {
  return path.join(getAgentDir(), "models-store.json");
}

/**
 * Descubre dinámicamente todos los prefijos de cuentas de CPAM presentes en la configuración de Pi.
 */
export function discoverCpamAccounts(
  modelsJsonPath: string = getDefaultModelsJsonPath(),
  modelsStorePath: string = getDefaultModelsStorePath(),
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
    for (let i = 1; i <= 50; i++) {
      accounts.add(`ac${String(i).padStart(2, "0")}`);
    }
  }

  // Ordenar alfanumérico natural (ac01, ac02, ..., ac10, ac11, ...)
  return Array.from(accounts).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
}

/** Cuentas VIP reservadas exclusivamente para el orquestador bajo selección manual (cc1..cc4, nan-01..nan-06, uc01...) */
export const DEFAULT_VIP_ACCOUNTS: readonly string[] = [
  "cc1",
  "cc2",
  "cc3",
  "cc4",
  "nan-01",
  "nan-02",
  "nan-03",
  "nan-04",
  "nan-05",
  "nan-06",
  "uc01",
];

export const VIP_ACCOUNTS: readonly string[] = DEFAULT_VIP_ACCOUNTS;

const VIP_ACCOUNT_PATTERN = /^(?:cc[-_]?\d+|uc[-_]?\d+|nan(?:[-_]?\d+)?)$/i;

export function isVipAccount(account?: string): boolean {
  if (!account) return false;
  const lower = account.trim().toLowerCase();
  if (!lower) return false;
  if (VIP_ACCOUNT_PATTERN.test(lower)) return true;
  return VIP_ACCOUNTS.includes(lower);
}

/**
 * Descubre dinámicamente cuentas VIP disponibles en models.json o retorna la lista estándar.
 */
export function discoverVipAccounts(
  modelsJsonPath: string = getDefaultModelsJsonPath(),
): string[] {
  const vips = new Set<string>(DEFAULT_VIP_ACCOUNTS);

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
            if (prefix && isVipAccount(prefix)) {
              vips.add(prefix);
            }
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  return Array.from(vips).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
}
