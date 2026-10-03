import { getFleetStatusSummary } from "../../dc-agents/core/dc-taxi-dispatcher.ts";
import type {
  DcTaxiUnit,
  DcTaxiPassenger,
  DcTaxiStatus,
} from "../../dc-agents/core/dc-ephemeral-types.ts";

export interface SidebarTaxiFleetInfo {
  total: number;
  libres: number;
  ocupados: number;
  recargando: number;
  units: DcTaxiUnit[];
  summaryText: string;
}

/**
 * Formatea el texto de resumen para el estado contraído del desplegable de Taxis.
 * Ej: "1 ocupado · 4 libres" o "2 ocupados · 3 libres · 1 recargando"
 */
export function formatFleetSummaryText(libres: number, ocupados: number, recargando: number = 0): string {
  const ocText = `${ocupados} ocupado${ocupados === 1 ? "" : "s"}`;
  const libText = `${libres} libre${libres === 1 ? "" : "s"}`;
  const recText = recargando > 0 ? ` · ${recargando} recargando` : "";
  return `${ocText} · ${libText}${recText}`;
}

/**
 * Formatea el tiempo transcurrido de forma legible (ej. "45s", "3m 12s", "1h 15m").
 */
export function formatElapsedDuration(startedAt: number): string {
  if (!startedAt || startedAt <= 0) return "0s";
  const elapsedMs = Math.max(0, Date.now() - startedAt);
  const secs = Math.floor(elapsedMs / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

/**
 * Formatea el título o rol del pasajero activo en una unidad de taxi.
 */
export function formatPassengerRole(passenger: DcTaxiPassenger): string {
  if (passenger.type === "orchestrator") {
    return "orquestador";
  }
  if (passenger.agentName) {
    return passenger.agentName;
  }
  return passenger.type === "ephemeral_subagent" ? "efímero" : "subagente";
}

export const CACHE_TTL_MS = 5000;

let cachedFleetInfo: SidebarTaxiFleetInfo | null = null;
let lastFetchTime = 0;

/**
 * Invalida la caché en memoria del estado de la flota de taxis.
 */
export function clearSidebarTaxiFleetCache(): void {
  cachedFleetInfo = null;
  lastFetchTime = 0;
}

/**
 * Obtiene el estado actual de la flota de taxis formateado para el Sidebar.
 * Reutiliza una caché en memoria con TTL de 5 segundos para erradicar I/O sincrónico en renders.
 */
export function getSidebarTaxiFleet(forceReload = false): SidebarTaxiFleetInfo {
  const now = Date.now();
  if (!forceReload && cachedFleetInfo !== null && now - lastFetchTime < CACHE_TTL_MS) {
    return cachedFleetInfo;
  }

  try {
    const summary = getFleetStatusSummary();
    const summaryText = formatFleetSummaryText(summary.libres, summary.ocupados, summary.recargando);
    cachedFleetInfo = {
      total: summary.total,
      libres: summary.libres,
      ocupados: summary.ocupados,
      recargando: summary.recargando,
      units: summary.units,
      summaryText,
    };
    lastFetchTime = now;
    return cachedFleetInfo;
  } catch {
    cachedFleetInfo = {
      total: 0,
      libres: 0,
      ocupados: 0,
      recargando: 0,
      units: [],
      summaryText: "sin datos de flota",
    };
    lastFetchTime = now;
    return cachedFleetInfo;
  }
}
