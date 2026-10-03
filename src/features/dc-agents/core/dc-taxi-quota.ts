/**
 * dc-taxi-quota.ts — Lector de cuotas para el Sistema de Taxis de DC Studio.
 *
 * Consulta el bridge local de cuotas (:8325) para obtener el porcentaje restante
 * de Gemini (5h) y Gemini (Weekly).
 * Determina si una cuenta debe marcarse en estado 'recargando' (<5% hasta recuperar >=60%).
 * Cumple con la Directiva 1 (cero dependencias de Pi).
 */

import { fetchJson } from "../../../integrations/dc-http/dc-fetch.ts";

export interface DcTaxiQuotaInfo {
  account: string;
  gemini5hPct: number | null;
  geminiWeeklyPct: number | null;
  resetTimeIso?: string;
  lastChecked: number;
}

const quotaCache = new Map<string, DcTaxiQuotaInfo>();
const CACHE_TTL_MS = 15000; // 15 segundos

/**
 * Consulta la cuota actual de una cuenta (ej: ac01, ac05) a través del bridge local :8325.
 */
export async function fetchTaxiQuota(account: string): Promise<DcTaxiQuotaInfo> {
  const cached = quotaCache.get(account);
  const now = Date.now();
  if (cached && now - cached.lastChecked < CACHE_TTL_MS) {
    return cached;
  }

  try {
    const res = await fetchJson(`http://127.0.0.1:8325/quota/${encodeURIComponent(account)}`, {
      timeoutMs: 400,
    });
    const d = res as {
      entries?: Array<{
        name?: string;
        label?: string;
        percentRemaining?: number;
        resetTimeIso?: string;
      }>;
    };

    let gemini5hPct: number | null = null;
    let geminiWeeklyPct: number | null = null;
    let resetTimeIso: string | undefined;

    if (Array.isArray(d?.entries)) {
      for (const e of d.entries) {
        const name = (e.name || e.label || "").toLowerCase();
        const rawPct = e.percentRemaining ?? 100;
        const pct = rawPct > 0 && rawPct <= 1 ? rawPct * 100 : rawPct;
        const boundedPct = Math.max(0, Math.min(100, Math.round(pct * 10) / 10));

        if (name.includes("5h") || name.includes("rate_limit")) {
          gemini5hPct = boundedPct;
          if (e.resetTimeIso) resetTimeIso = e.resetTimeIso;
        } else if (name.includes("weekly") || name.includes("quota")) {
          geminiWeeklyPct = boundedPct;
        }
      }
    }

    const info: DcTaxiQuotaInfo = {
      account,
      gemini5hPct: gemini5hPct !== null ? gemini5hPct : 100,
      geminiWeeklyPct: geminiWeeklyPct !== null ? geminiWeeklyPct : 100,
      resetTimeIso,
      lastChecked: now,
    };

    quotaCache.set(account, info);
    return info;
  } catch {
    const fallback: DcTaxiQuotaInfo = {
      account,
      gemini5hPct: null,
      geminiWeeklyPct: null,
      lastChecked: now,
    };
    quotaCache.set(account, fallback);
    return fallback;
  }
}

/**
 * Consulta en paralelo las cuotas para una lista de cuentas.
 */
export async function fetchAllTaxisQuotas(accounts: string[]): Promise<Map<string, DcTaxiQuotaInfo>> {
  const results = await Promise.allSettled(accounts.map((ac) => fetchTaxiQuota(ac)));
  const map = new Map<string, DcTaxiQuotaInfo>();

  accounts.forEach((ac, idx) => {
    const res = results[idx];
    if (res && res.status === "fulfilled") {
      map.set(ac, res.value);
    } else {
      map.set(ac, { account: ac, gemini5hPct: null, geminiWeeklyPct: null, lastChecked: Date.now() });
    }
  });

  return map;
}

/**
 * Obtiene la cuota almacenada en caché para una cuenta (sincrónico, sin bloqueo de I/O).
 * Retorna undefined si la cuenta no ha sido consultada o no está en caché.
 */
export function getCachedTaxiQuota(account: string): DcTaxiQuotaInfo | undefined {
  return quotaCache.get(account);
}

/**
 * Permite registrar o actualizar manualmente la información de cuota en caché.
 * Muy útil para inyección síncrona en pruebas y sincronizaciones reactivas.
 */
export function setCachedTaxiQuota(
  account: string,
  info: Partial<DcTaxiQuotaInfo> & { gemini5hPct?: number | null },
): void {
  const current = quotaCache.get(account);
  quotaCache.set(account, {
    account,
    gemini5hPct: info.gemini5hPct !== undefined ? info.gemini5hPct : (current?.gemini5hPct ?? 100),
    geminiWeeklyPct: info.geminiWeeklyPct !== undefined ? info.geminiWeeklyPct : (current?.geminiWeeklyPct ?? 100),
    resetTimeIso: info.resetTimeIso ?? current?.resetTimeIso,
    lastChecked: info.lastChecked ?? Date.now(),
  });
}

/**
 * Limpia la caché en memoria de cuotas de taxis (para aislamiento en pruebas unitarias).
 */
export function clearTaxiQuotaCache(): void {
  quotaCache.clear();
}

