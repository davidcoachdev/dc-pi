import { getFleetStatusSummary } from "../../dc-agents/core/dc-taxi-dispatcher.ts";
import { fetchAllTaxisQuotas } from "../../dc-agents/core/dc-taxi-quota.ts";
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
  en_taller: number;
  units: DcTaxiUnit[];
  summaryText: string;
}

/**
 * Formatea el texto de resumen para el estado contraído del desplegable de Taxis.
 * Ej: "1 ocupado · 4 libres", "2 ocupados · 3 libres · 1 recargando" o "1 ocupado · 3 libres · 1 taller"
 */
export function formatFleetSummaryText(
  libres: number,
  ocupados: number,
  recargando: number = 0,
  enTaller: number = 0,
): string {
  const ocText = `${ocupados} ocupado${ocupados === 1 ? "" : "s"}`;
  const libText = `${libres} libre${libres === 1 ? "" : "s"}`;
  const recText = recargando > 0 ? ` · ${recargando} recargando` : "";
  const tallerText = enTaller > 0 ? ` · ${enTaller} taller` : "";
  return `${ocText} · ${libText}${recText}${tallerText}`;
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
export const BACKGROUND_QUOTA_FETCH_INTERVAL_MS = 30_000;

let cachedFleetInfo: SidebarTaxiFleetInfo | null = null;
let lastFetchTime = 0;
let lastQuotaBackgroundFetch = 0;
let isQuotaBackgroundFetching = false;

/**
 * Invalida la caché en memoria del estado de la flota de taxis.
 */
export function clearSidebarTaxiFleetCache(): void {
  cachedFleetInfo = null;
  lastFetchTime = 0;
  lastQuotaBackgroundFetch = 0;
}

/**
 * Obtiene el estado actual de la flota de taxis formateado para el Sidebar.
 * Reutiliza una caché en memoria con TTL de 5 segundos para erradicar I/O sincrónico en renders.
 * Dispara en background un refresco periódico de cuotas para mantener el mapa de cuotas vivo sin bloquear la UI.
 */
export function getSidebarTaxiFleet(forceReload = false): SidebarTaxiFleetInfo {
  const now = Date.now();

  // Disparar background fetch no bloqueante de cuotas si expiró el intervalo
  if (!isQuotaBackgroundFetching && now - lastQuotaBackgroundFetch > BACKGROUND_QUOTA_FETCH_INTERVAL_MS) {
    lastQuotaBackgroundFetch = now;
    isQuotaBackgroundFetching = true;
    try {
      const summary = getFleetStatusSummary();
      const accounts = summary.units.map((u) => u.account);
      if (accounts.length > 0) {
        void fetchAllTaxisQuotas(accounts).finally(() => {
          isQuotaBackgroundFetching = false;
        });
      } else {
        isQuotaBackgroundFetching = false;
      }
    } catch {
      isQuotaBackgroundFetching = false;
    }
  }

  if (!forceReload && cachedFleetInfo !== null && now - lastFetchTime < CACHE_TTL_MS) {
    return cachedFleetInfo;
  }

  try {
    const summary = getFleetStatusSummary();
    const summaryText = formatFleetSummaryText(
      summary.libres,
      summary.ocupados,
      summary.recargando,
      summary.en_taller,
    );
    cachedFleetInfo = {
      total: summary.total,
      libres: summary.libres,
      ocupados: summary.ocupados,
      recargando: summary.recargando,
      en_taller: summary.en_taller,
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
      en_taller: 0,
      units: [],
      summaryText: "sin datos de flota",
    };
    lastFetchTime = now;
    return cachedFleetInfo;
  }
}
