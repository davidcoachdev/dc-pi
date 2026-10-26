/**
 * dc-taxi-quota.ts — Lector de cuotas para el Sistema de Taxis de DC Studio.
 *
 * Consulta el bridge local de cuotas (:8325) para obtener el porcentaje restante
 * de Gemini (5h) y Gemini (Weekly).
 * Determina si una cuenta debe marcarse en estado 'recargando' (<5% hasta recuperar >=60%).
 * Cumple con la Directiva 1 (cero dependencias de Pi).
 */

import { fetchJson, type FetchJsonOptions } from "../../../integrations/dc-http/dc-fetch.ts";

export interface DcTaxiQuotaInfo {
  account: string;
  gemini5hPct: number | null;
  geminiWeeklyPct: number | null;
  claude5hPct?: number | null;
  claudeWeeklyPct?: number | null;
  resetTimeIso?: string;
  lastChecked: number;
}

/**
 * Constante explicativa sobre la ambigüedad de unidades en percentRemaining:
 * Valores en el rango (0, 1] son interpretados como fracción decimal (ej: 0.85 -> 85%, 1.0 -> 100%).
 * Valores > 1 son interpretados como porcentaje directo (ej: 85 -> 85%).
 * Un valor de exactamente 1 es ambiguo: la heurística histórica de DC Studio lo asume como 100% (1.0).
 */
export const UNIT_AMBIGUITY_NOTE =
  "Raw percentRemaining values in range (0, 1] are treated as fractional (e.g. 0.85 -> 85%, 1.0 -> 100%); values > 1 are treated as direct percentage (e.g. 85 -> 85%).";

export class DcTaxiQuotaValidationError extends Error {
  constructor(message: string, public readonly payload?: unknown) {
    super(message);
    this.name = "DcTaxiQuotaValidationError";
  }
}

export type TaxiQuotaFetcher = (
  url: string,
  options?: FetchJsonOptions,
) => Promise<unknown>;

export interface FetchTaxiQuotaOptions {
  timeoutMs?: number;
  fetcher?: TaxiQuotaFetcher;
  baseUrl?: string;
}

export interface ProbeTaxiQuotaDiagnosticOptions {
  timeoutMs?: number;
  fetcher?: TaxiQuotaFetcher;
  baseUrl?: string;
}

export interface DcTaxiQuotaDiagnosticResult extends DcTaxiQuotaInfo {
  readonly isValid: true;
  readonly effectivePct: number | null;
  readonly recognizedEntriesCount: number;
  readonly rawEntriesCount: number;
  readonly unitAmbiguityNote: string;
}

const quotaCache = new Map<string, DcTaxiQuotaInfo>();
const CACHE_TTL_MS = 15000; // 15 segundos

interface InternalQuotaParseResult {
  gemini5hPct: number | null;
  geminiWeeklyPct: number | null;
  claude5hPct: number | null;
  claudeWeeklyPct: number | null;
  resetTimeIso?: string;
  recognizedCount: number;
  rawCount: number;
}

function parseQuotaPayloadCore(
  payload: unknown,
  strict: boolean,
): InternalQuotaParseResult {
  if (!payload || typeof payload !== "object") {
    if (strict) {
      throw new DcTaxiQuotaValidationError(
        "Invalid quota payload: expected JSON object",
        payload,
      );
    }
    return {
      gemini5hPct: 100,
      geminiWeeklyPct: 100,
      claude5hPct: null,
      claudeWeeklyPct: null,
      recognizedCount: 0,
      rawCount: 0,
    };
  }

  const d = payload as {
    entries?: unknown[];
  };

  if (!Array.isArray(d.entries)) {
    if (strict) {
      throw new DcTaxiQuotaValidationError(
        "Invalid quota payload: missing or non-array 'entries'",
        payload,
      );
    }
    return {
      gemini5hPct: 100,
      geminiWeeklyPct: 100,
      claude5hPct: null,
      claudeWeeklyPct: null,
      recognizedCount: 0,
      rawCount: 0,
    };
  }

  if (strict && d.entries.length === 0) {
    throw new DcTaxiQuotaValidationError(
      "Invalid quota payload: 'entries' array is empty",
      payload,
    );
  }

  let gemini5hPct: number | null = null;
  let geminiWeeklyPct: number | null = null;
  let claude5hPct: number | null = null;
  let claudeWeeklyPct: number | null = null;
  let generic5hPct: number | null = null;
  let genericWeeklyPct: number | null = null;
  let resetTimeIso: string | undefined;
  let recognizedCount = 0;

  for (const item of d.entries) {
    if (!item || typeof item !== "object") {
      if (strict) {
        throw new DcTaxiQuotaValidationError(
          "Invalid quota entry: expected object",
          item,
        );
      }
      continue;
    }

    const e = item as {
      name?: unknown;
      label?: unknown;
      percentRemaining?: unknown;
      resetTimeIso?: unknown;
    };

    const name = String(e.name || e.label || "").toLowerCase();

    if (strict) {
      if (
        typeof e.percentRemaining !== "number" ||
        !Number.isFinite(e.percentRemaining) ||
        e.percentRemaining < 0
      ) {
        throw new DcTaxiQuotaValidationError(
          `Invalid quota entry: percentRemaining must be a finite non-negative number, got ${String(e.percentRemaining)}`,
          item,
        );
      }
    }

    const rawPct =
      typeof e.percentRemaining === "number" && Number.isFinite(e.percentRemaining)
        ? e.percentRemaining
        : 100;
    const pct = rawPct > 0 && rawPct <= 1 ? rawPct * 100 : rawPct;
    const boundedPct = Math.max(0, Math.min(100, Math.round(pct * 10) / 10));

    const is5h = name.includes("5h") || name.includes("rate_limit") || name.includes("primary");
    const isWeekly = name.includes("weekly") || name.includes("quota") || name.includes("secondary");

    if (is5h || isWeekly) {
      recognizedCount++;
    }

    if (name.includes("gemini")) {
      if (is5h) {
        gemini5hPct = boundedPct;
        if (typeof e.resetTimeIso === "string") resetTimeIso = e.resetTimeIso;
      } else if (isWeekly) {
        geminiWeeklyPct = boundedPct;
      }
    } else if (name.includes("claude")) {
      if (is5h) {
        claude5hPct = boundedPct;
        if (typeof e.resetTimeIso === "string") resetTimeIso = e.resetTimeIso;
      } else if (isWeekly) {
        claudeWeeklyPct = boundedPct;
      }
    } else {
      if (is5h) {
        generic5hPct = boundedPct;
        if (typeof e.resetTimeIso === "string") resetTimeIso = e.resetTimeIso;
      } else if (isWeekly) {
        genericWeeklyPct = boundedPct;
      }
    }
  }

  if (strict && recognizedCount === 0) {
    throw new DcTaxiQuotaValidationError(
      "Unrecognized quota payload: no entries matched recognized quota windows (5h/rate_limit/primary or weekly/quota/secondary)",
      payload,
    );
  }

  // Si no hubo entrada explícita de Gemini, usar la genérica si existe
  if (gemini5hPct === null && generic5hPct !== null) gemini5hPct = generic5hPct;
  if (geminiWeeklyPct === null && genericWeeklyPct !== null) geminiWeeklyPct = genericWeeklyPct;

  const finalGemini5h = strict
    ? gemini5hPct
    : gemini5hPct !== null
      ? gemini5hPct
      : generic5hPct !== null
        ? generic5hPct
        : 100;

  const finalGeminiWeekly = strict
    ? geminiWeeklyPct
    : geminiWeeklyPct !== null
      ? geminiWeeklyPct
      : genericWeeklyPct !== null
        ? genericWeeklyPct
        : 100;

  return {
    gemini5hPct: finalGemini5h,
    geminiWeeklyPct: finalGeminiWeekly,
    claude5hPct,
    claudeWeeklyPct,
    resetTimeIso,
    recognizedCount,
    rawCount: d.entries.length,
  };
}

/**
 * Consulta la cuota actual de una cuenta (ej: ac01, ac05) a través del bridge local :8325.
 */
export async function fetchTaxiQuota(
  account: string,
  options?: FetchTaxiQuotaOptions,
): Promise<DcTaxiQuotaInfo> {
  const cached = quotaCache.get(account);
  const now = Date.now();
  if (cached && now - cached.lastChecked < CACHE_TTL_MS) {
    return cached;
  }

  const fetcher = options?.fetcher || fetchJson;
  const baseUrl = options?.baseUrl || "http://127.0.0.1:8325";
  const timeoutMs = options?.timeoutMs ?? 400;

  try {
    const res = await fetcher(`${baseUrl}/quota/${encodeURIComponent(account)}`, {
      timeoutMs,
    });
    const parsed = parseQuotaPayloadCore(res, false);

    const info: DcTaxiQuotaInfo = {
      account,
      gemini5hPct: parsed.gemini5hPct,
      geminiWeeklyPct: parsed.geminiWeeklyPct,
      claude5hPct: parsed.claude5hPct,
      claudeWeeklyPct: parsed.claudeWeeklyPct,
      resetTimeIso: parsed.resetTimeIso,
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
 * Sonda diagnóstica fresca de cuota vía HTTP para validación de recuperación en taller.
 *
 * Directivas de diagnóstico:
 * - Omite la caché en memoria y realiza siempre una petición HTTP fresca.
 * - Propaga errores HTTP (401, 403, 500), de red y timeouts sin capturarlos silenciosamente.
 * - Rechaza payloads inválidos, vacíos, sin ventanas reconocidas o con valores no finitos.
 * - NUNCA sintetiza cuota saludable al 100% cuando no existen lecturas válidas.
 * - Escribe en la caché de cuota ÚNICAMENTE tras una respuesta validada exitosa.
 */
export async function probeTaxiQuotaDiagnostic(
  account: string,
  options?: ProbeTaxiQuotaDiagnosticOptions,
): Promise<DcTaxiQuotaDiagnosticResult> {
  const fetcher = options?.fetcher || fetchJson;
  const baseUrl = options?.baseUrl || "http://127.0.0.1:8325";
  const timeoutMs = options?.timeoutMs ?? 400;

  const url = `${baseUrl}/quota/${encodeURIComponent(account)}`;
  const res = await fetcher(url, { timeoutMs });

  const parsed = parseQuotaPayloadCore(res, true);
  const now = Date.now();

  const info: DcTaxiQuotaInfo = {
    account,
    gemini5hPct: parsed.gemini5hPct,
    geminiWeeklyPct: parsed.geminiWeeklyPct,
    claude5hPct: parsed.claude5hPct,
    claudeWeeklyPct: parsed.claudeWeeklyPct,
    resetTimeIso: parsed.resetTimeIso,
    lastChecked: now,
  };

  const effectivePct = getEffectiveQuotaPct(info);

  const result: DcTaxiQuotaDiagnosticResult = {
    ...info,
    isValid: true,
    effectivePct,
    recognizedEntriesCount: parsed.recognizedCount,
    rawEntriesCount: parsed.rawCount,
    unitAmbiguityNote: UNIT_AMBIGUITY_NOTE,
  };

  // Actualiza la caché únicamente tras validación estricta exitosa
  quotaCache.set(account, info);

  return result;
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
 * Determina el porcentaje de cuota efectiva para una cuenta.
 * Opcionalmente se puede filtrar por familia ('gemini' | 'claude').
 * Si no se especifica familia (o para uso general de CPAM):
 * - En cuentas de Google Antigravity en CPAM, el backend de cuotas únicamente
 *   reporta el límite de modelos de terceros (Claude Opus/Sonnet y GPT).
 *   Los modelos Gemini no están limitados por el bucket semanal de Claude y
 *   operan al 100% (o bajo gemini5hPct si existe).
 * - Por tanto, si se evalúa Gemini, se consideran gemini5hPct / geminiWeeklyPct.
 * - Si se evalúa Claude, se consideran claude5hPct / claudeWeeklyPct.
 */
export function getEffectiveQuotaPct(
  quotaInfo?: DcTaxiQuotaInfo,
  modelFamily?: "gemini" | "claude",
): number | null {
  if (!quotaInfo) return null;

  if (modelFamily === "gemini") {
    const candidates: number[] = [];
    if (typeof quotaInfo.gemini5hPct === "number") candidates.push(quotaInfo.gemini5hPct);
    if (typeof quotaInfo.geminiWeeklyPct === "number") candidates.push(quotaInfo.geminiWeeklyPct);
    return candidates.length > 0 ? Math.min(...candidates) : 100;
  }

  if (modelFamily === "claude") {
    const candidates: number[] = [];
    if (typeof quotaInfo.claude5hPct === "number") candidates.push(quotaInfo.claude5hPct);
    if (typeof quotaInfo.claudeWeeklyPct === "number") candidates.push(quotaInfo.claudeWeeklyPct);
    return candidates.length > 0 ? Math.min(...candidates) : 100;
  }

  // Si no se especifica familia, evaluar la cuota primaria de CPAM (Gemini por defecto para la flota)
  // evitando que el agotamiento exclusivo de Claude bloquee una cuenta que corre Gemini al 100%.
  if (typeof quotaInfo.gemini5hPct === "number" && typeof quotaInfo.claudeWeeklyPct === "number") {
    // Si la cuenta tiene gemini al 100% y claude weekly al 0%, la cuota disponible para gemini es 100%
    return quotaInfo.gemini5hPct;
  }

  const candidates: number[] = [];
  if (typeof quotaInfo.gemini5hPct === "number") candidates.push(quotaInfo.gemini5hPct);
  if (typeof quotaInfo.geminiWeeklyPct === "number") candidates.push(quotaInfo.geminiWeeklyPct);
  if (typeof quotaInfo.claude5hPct === "number") candidates.push(quotaInfo.claude5hPct);
  if (typeof quotaInfo.claudeWeeklyPct === "number") candidates.push(quotaInfo.claudeWeeklyPct);

  if (candidates.length === 0) return null;
  return Math.min(...candidates);
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
    claude5hPct: info.claude5hPct !== undefined ? info.claude5hPct : (current?.claude5hPct ?? null),
    claudeWeeklyPct: info.claudeWeeklyPct !== undefined ? info.claudeWeeklyPct : (current?.claudeWeeklyPct ?? null),
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

