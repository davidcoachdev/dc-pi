/**
 * dc-taxi-history.ts — Registro histórico de viajes de taxis (consumo de tokens, duración y costos).
 *
 * Persiste los últimos viajes en ~/.pi/agent/dc-studio/dc-taxis-history.json.
 * Cumple con la Directiva 1 (cero dependencias de Pi) y Directiva 2 (aislado en dc-studio/).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { DcTaxiTripRecord } from "./dc-ephemeral-types.ts";

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
