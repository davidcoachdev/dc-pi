/**
 * dc-taxi-history.ts — Registro histórico de viajes de taxis (consumo de tokens, duración y costos).
 *
 * Persiste los últimos viajes en ~/.pi/agent/dc-studio/dc-taxis-history.json.
 * Cumple con la Directiva 1 (cero dependencias de Pi) y Directiva 2 (aislado en dc-studio/).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type {
  DcTaxiTripRecord,
  DcTaxiUnitMetrics,
  DcAgentUsageMetrics,
} from "./dc-ephemeral-types.ts";

const HISTORY_FILE_PATH = path.join(os.homedir(), ".pi", "agent", "dc-studio", "dc-taxis-history.json");
const MAX_HISTORY_RECORDS = 200;

function ensureHistoryDirectory(): void {
  const dir = path.dirname(HISTORY_FILE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Carga la lista histórica de viajes desde disco.
 */
export function loadTaxiTripHistory(
  limit: number = 50,
  historyPath: string = HISTORY_FILE_PATH,
): DcTaxiTripRecord[] {
  if (!fs.existsSync(historyPath)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(historyPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    // Ordenar de más reciente a más antiguo
    const sorted = parsed.sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0));
    return sorted.slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Registra un viaje terminado en el historial persistente.
 */
export function recordTaxiTrip(
  trip: DcTaxiTripRecord,
  historyPath: string = HISTORY_FILE_PATH,
): void {
  try {
    ensureHistoryDirectory();

    let history: DcTaxiTripRecord[] = [];
    if (fs.existsSync(historyPath)) {
      try {
        const raw = fs.readFileSync(historyPath, "utf8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) history = parsed;
      } catch {
        history = [];
      }
    }

    // Agregar al principio
    history.unshift(trip);

    // Bounded history
    if (history.length > MAX_HISTORY_RECORDS) {
      history = history.slice(0, MAX_HISTORY_RECORDS);
    }

    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2) + "\n", "utf8");
  } catch {
    /* silent defensive */
  }
}

export interface DcTaxiHistoryMetrics {
  totalTrips: number;
  completedTrips: number;
  failedTrips: number;
  cancelledTrips: number;
  timeoutTrips: number;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalReasoningTokens: number;
  totalDurationMs: number;
  totalEstimatedCost: number;
  successRate: number;
}

/**
 * Calcula métricas agregadas de consumo y salud del sistema de taxis.
 */
export function getTaxiHistoryMetrics(historyPath: string = HISTORY_FILE_PATH): DcTaxiHistoryMetrics {
  const trips = loadTaxiTripHistory(MAX_HISTORY_RECORDS, historyPath);

  let completedTrips = 0;
  let failedTrips = 0;
  let cancelledTrips = 0;
  let timeoutTrips = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalReasoningTokens = 0;
  let totalDurationMs = 0;
  let totalEstimatedCost = 0;

  for (const t of trips) {
    if (t.status === "completed") completedTrips++;
    else if (t.status === "failed") failedTrips++;
    else if (t.status === "cancelled") cancelledTrips++;
    else if (t.status === "timeout") timeoutTrips++;

    if (t.tokens) {
      totalInputTokens += t.tokens.input || 0;
      totalOutputTokens += t.tokens.output || 0;
      totalReasoningTokens += t.tokens.reasoning || 0;
    }

    totalDurationMs += t.durationMs || 0;
    totalEstimatedCost += t.costEstimated || 0;
  }

  const totalTrips = trips.length;
  const totalTokens = totalInputTokens + totalOutputTokens + totalReasoningTokens;
  const successRate = totalTrips > 0 ? (completedTrips / totalTrips) * 100 : 100;

  return {
    totalTrips,
    completedTrips,
    failedTrips,
    cancelledTrips,
    timeoutTrips,
    totalTokens,
    totalInputTokens,
    totalOutputTokens,
    totalReasoningTokens,
    totalDurationMs,
    totalEstimatedCost,
    successRate: Math.round(successRate * 10) / 10,
  };
}

/**
 * Obtiene métricas acumuladas para una unidad específica de Taxi (ej: ac05).
 */
export function getUnitTaxiMetrics(account: string, historyPath: string = HISTORY_FILE_PATH): DcTaxiUnitMetrics {
  const trips = loadTaxiTripHistory(MAX_HISTORY_RECORDS, historyPath).filter(
    (t) => t.account.toLowerCase() === account.toLowerCase(),
  );

  let completedTrips = 0;
  let failedTrips = 0;
  let cancelledTrips = 0;
  let timeoutTrips = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalReasoningTokens = 0;
  let totalDurationMs = 0;
  let lastError: string | undefined;
  let lastUsedAt: number | undefined;

  for (const t of trips) {
    if (t.status === "completed") completedTrips++;
    else if (t.status === "failed") {
      failedTrips++;
      if (!lastError && t.error) lastError = t.error;
    } else if (t.status === "cancelled") cancelledTrips++;
    else if (t.status === "timeout") {
      timeoutTrips++;
      if (!lastError) lastError = "Timeout de ejecución alcanzado";
    }

    if (t.tokens) {
      totalInputTokens += t.tokens.input || 0;
      totalOutputTokens += t.tokens.output || 0;
      totalReasoningTokens += t.tokens.reasoning || 0;
    }

    totalDurationMs += t.durationMs || 0;
    if (!lastUsedAt || (t.endedAt && t.endedAt > lastUsedAt)) {
      lastUsedAt = t.endedAt;
    }
  }

  const totalTrips = trips.length;
  const totalTokens = totalInputTokens + totalOutputTokens + totalReasoningTokens;
  const successRate = totalTrips > 0 ? (completedTrips / totalTrips) * 100 : 100;
  const avgDurationMs = totalTrips > 0 ? Math.round(totalDurationMs / totalTrips) : 0;

  return {
    account,
    totalTrips,
    completedTrips,
    failedTrips,
    cancelledTrips,
    timeoutTrips,
    totalTokens,
    totalInputTokens,
    totalOutputTokens,
    totalReasoningTokens,
    totalDurationMs,
    avgDurationMs,
    successRate: Math.round(successRate * 10) / 10,
    lastError,
    lastUsedAt,
  };
}

/**
 * Obtiene un mapa con las métricas de todas las unidades de taxi que han realizado viajes.
 */
export function getFleetUnitMetricsMap(historyPath: string = HISTORY_FILE_PATH): Map<string, DcTaxiUnitMetrics> {
  const trips = loadTaxiTripHistory(MAX_HISTORY_RECORDS, historyPath);
  const accounts = new Set(trips.map((t) => t.account));
  const map = new Map<string, DcTaxiUnitMetrics>();

  for (const ac of accounts) {
    map.set(ac, getUnitTaxiMetrics(ac, historyPath));
  }

  return map;
}

/**
 * Genera el ranking de subagentes más utilizados con su tasa de fallos y errores recientes.
 */
export function getAgentUsageRanking(historyPath: string = HISTORY_FILE_PATH): DcAgentUsageMetrics[] {
  const trips = loadTaxiTripHistory(MAX_HISTORY_RECORDS, historyPath);
  const groups = new Map<string, DcTaxiTripRecord[]>();

  for (const t of trips) {
    const name = t.agentName || t.taskLabel || t.passengerType;
    if (!groups.has(name)) {
      groups.set(name, []);
    }
    groups.get(name)!.push(t);
  }

  const result: DcAgentUsageMetrics[] = [];

  for (const [agentName, agentTrips] of groups.entries()) {
    let completedTrips = 0;
    let failedTrips = 0;
    let totalTokens = 0;
    let totalDurationMs = 0;
    let lastError: string | undefined;
    let lastUsedAt: number | undefined;

    for (const t of agentTrips) {
      if (t.status === "completed") completedTrips++;
      else if (t.status === "failed" || t.status === "timeout") {
        failedTrips++;
        if (!lastError && t.error) lastError = t.error;
      }

      if (t.tokens) {
        totalTokens += (t.tokens.input || 0) + (t.tokens.output || 0) + (t.tokens.reasoning || 0);
      }
      totalDurationMs += t.durationMs || 0;
      if (!lastUsedAt || (t.endedAt && t.endedAt > lastUsedAt)) {
        lastUsedAt = t.endedAt;
      }
    }

    const totalTrips = agentTrips.length;
    const failureRate = totalTrips > 0 ? (failedTrips / totalTrips) * 100 : 0;
    const successRate = totalTrips > 0 ? (completedTrips / totalTrips) * 100 : 100;

    result.push({
      agentName,
      totalTrips,
      completedTrips,
      failedTrips,
      failureRate: Math.round(failureRate * 10) / 10,
      successRate: Math.round(successRate * 10) / 10,
      totalTokens,
      totalDurationMs,
      lastUsedAt,
      lastError,
    });
  }

  // Ordenar por cantidad de viajes (los más demandados primero)
  return result.sort((a, b) => b.totalTrips - a.totalTrips);
}
