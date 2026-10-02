/**
 * dc-taxi-dispatcher.ts — Central de Despacho de la Flota de Taxis (Libre / Ocupado).
 *
 * Coordina el estado de las cuentas de IA entre todas las sesiones concurrentes de Pi.
 * Implementa auto-recuperación de zombis mediante verificación de PID en el OS.
 * Cumple con la Directiva 1 (cero dependencias de Pi) y Directiva 2 (aislado en dc-studio/).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type {
  DcTaxiFleetState,
  DcTaxiPassenger,
  DcTaxiUnit,
} from "./dc-ephemeral-types.ts";
import { DEFAULT_DC_AGENTS_CONFIG } from "./dc-ephemeral-types.ts";
import { appendTaxiLog } from "./dc-taxi-logger.ts";

const FLEET_STATE_PATH = path.join(os.homedir(), ".pi", "agent", "dc-studio", "dc-taxis.json");

function ensureDirectory(targetPath: string): void {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Comprueba si un proceso sigue vivo en el sistema operativo sin enviarle una señal destructiva.
 */
export function isProcessAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;
    // EPERM significa que el proceso existe pero pertenece a otro usuario (sigue vivo)
    return error.code === "EPERM";
  }
}

/**
 * Inicializa la flota por defecto si no existe archivo de estado previo.
 */
export function createInitialFleetState(accounts: string[] = DEFAULT_DC_AGENTS_CONFIG.accountPool.accounts): DcTaxiFleetState {
  const fleet: Record<string, DcTaxiUnit> = {};
  for (const ac of accounts) {
    fleet[ac] = {
      account: ac,
      status: "libre",
      passenger: null,
    };
  }
  return {
    fleet,
    lastUpdated: Date.now(),
  };
}

/**
 * Carga el estado actual de la flota desde disco.
 */
export function loadFleetState(
  fleetPath: string = FLEET_STATE_PATH,
  defaultAccounts?: string[],
): DcTaxiFleetState {
  const fallbackAccounts = defaultAccounts || DEFAULT_DC_AGENTS_CONFIG.accountPool.accounts;

  if (!fs.existsSync(fleetPath)) {
    return createInitialFleetState(fallbackAccounts);
  }

  try {
    const raw = fs.readFileSync(fleetPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.fleet || Object.keys(parsed.fleet).length === 0) {
      return createInitialFleetState(fallbackAccounts);
    }

    const fleet: Record<string, DcTaxiUnit> = { ...parsed.fleet };

    // Si se pasaron cuentas default explícitas, asegurar que existan
    if (defaultAccounts && defaultAccounts.length > 0) {
      for (const ac of defaultAccounts) {
        if (!fleet[ac]) {
          fleet[ac] = { account: ac, status: "libre", passenger: null };
        }
      }
    }

    return {
      fleet,
      lastUpdated: typeof parsed.lastUpdated === "number" ? parsed.lastUpdated : Date.now(),
    };
  } catch {
    return createInitialFleetState(fallbackAccounts);
  }
}

/**
 * Guarda el estado de la flota de forma segura con escritura atómica.
 */
export function saveFleetState(state: DcTaxiFleetState, fleetPath: string = FLEET_STATE_PATH): void {
  try {
    ensureDirectory(fleetPath);
    state.lastUpdated = Date.now();
    const tempPath = `${fleetPath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(state, null, 2) + "\n", "utf8");
    fs.renameSync(tempPath, fleetPath);
  } catch {
    /* fallback directo si rename falla */
    try {
      fs.writeFileSync(fleetPath, JSON.stringify(state, null, 2) + "\n", "utf8");
    } catch {
      /* defensive */
    }
  }
}

/**
 * Barre y recupera taxis zombis cuyo proceso murió o cuyo TTL expiró.
 * Devuelve la cantidad de taxis recuperados.
 */
export function reapAbandonedTaxis(
  state: DcTaxiFleetState,
  leaseTtlMs: number = DEFAULT_DC_AGENTS_CONFIG.accountPool.leaseTtlMs,
  now: number = Date.now(),
): number {
  let reapedCount = 0;

  for (const [account, unit] of Object.entries(state.fleet)) {
    if (unit.status !== "ocupado" || !unit.passenger) continue;

    const passenger = unit.passenger;
    const isPidDead = !isProcessAlive(passenger.pid);
    const isTtlExpired = now - (passenger.heartbeatAt || passenger.startedAt) > leaseTtlMs;

    if (isPidDead || isTtlExpired) {
      const reason = isPidDead ? `PID ${passenger.pid} no existe en OS` : `TTL expirado (${Math.round((now - passenger.heartbeatAt) / 1000)}s)`;
      appendTaxiLog("WARN", "TAXI_ZOMBIE_REAPED", {
        account,
        reason,
        passengerType: passenger.type,
        sessionId: passenger.sessionId,
        pid: passenger.pid,
      });

      unit.status = "libre";
      unit.passenger = null;
      reapedCount++;
    }
  }

  return reapedCount;
}

/**
 * Solicita y arrienda un taxi libre para un pasajero (orquestador o subagente).
 */
export function leaseTaxi(
  passengerData: Omit<DcTaxiPassenger, "startedAt" | "heartbeatAt">,
  preferredAccount?: string,
  fleetPath: string = FLEET_STATE_PATH,
  leaseTtlMs: number = DEFAULT_DC_AGENTS_CONFIG.accountPool.leaseTtlMs,
): { account: string; unit: DcTaxiUnit } | null {
  const state = loadFleetState(fleetPath);

  // 1. Limpieza preventiva de zombis antes de buscar
  reapAbandonedTaxis(state, leaseTtlMs);

  const now = Date.now();
  const fullPassenger: DcTaxiPassenger = {
    ...passengerData,
    startedAt: now,
    heartbeatAt: now,
  };

  // 2. Intentar cuenta preferida si está libre
  if (preferredAccount && state.fleet[preferredAccount] && state.fleet[preferredAccount].status === "libre") {
    const unit = state.fleet[preferredAccount];
    unit.status = "ocupado";
    unit.passenger = fullPassenger;
    saveFleetState(state, fleetPath);

    appendTaxiLog("INFO", "TAXI_LEASED", {
      account: preferredAccount,
      type: fullPassenger.type,
      sessionId: fullPassenger.sessionId,
      pid: fullPassenger.pid,
      model: fullPassenger.model,
      preferred: true,
    });

    return { account: preferredAccount, unit };
  }

  // 3. Buscar cualquier taxi libre disponible
  for (const [account, unit] of Object.entries(state.fleet)) {
    if (unit.status === "libre") {
      unit.status = "ocupado";
      unit.passenger = fullPassenger;
      saveFleetState(state, fleetPath);

      appendTaxiLog("INFO", "TAXI_LEASED", {
        account,
        type: fullPassenger.type,
        sessionId: fullPassenger.sessionId,
        pid: fullPassenger.pid,
        model: fullPassenger.model,
        preferred: false,
      });

      return { account, unit };
    }
  }

  // 4. Flota agotada
  appendTaxiLog("WARN", "TAXI_FLEET_EXHAUSTED", {
    requestedBy: fullPassenger.type,
    sessionId: fullPassenger.sessionId,
    preferredAccount,
  });

  saveFleetState(state, fleetPath);
  return null;
}

/**
 * Libera un taxi y lo marca como libre en la flota compartida.
 */
export function releaseTaxi(
  account: string,
  sessionId?: string,
  fleetPath: string = FLEET_STATE_PATH,
): boolean {
  const state = loadFleetState(fleetPath);
  const unit = state.fleet[account];

  if (!unit || unit.status !== "ocupado") {
    return false;
  }

  // Si se pasa sessionId, validar pertenencia para evitar liberaciones cruzadas espurias
  if (sessionId && unit.passenger && unit.passenger.sessionId !== sessionId) {
    appendTaxiLog("WARN", "TAXI_RELEASE_SESSION_MISMATCH", {
      account,
      expectedSession: unit.passenger.sessionId,
      actualSession: sessionId,
    });
    return false;
  }

  const previousPassenger = unit.passenger;
  unit.status = "libre";
  unit.passenger = null;
  saveFleetState(state, fleetPath);

  appendTaxiLog("INFO", "TAXI_RELEASED", {
    account,
    releasedBySession: sessionId,
    passengerType: previousPassenger?.type,
    pid: previousPassenger?.pid,
  });

  return true;
}

/**
 * Envía un pulso de vida (heartbeat) para mantener el taxi arrendado y no ser reapeado.
 */
export function heartbeatTaxi(
  account: string,
  fleetPath: string = FLEET_STATE_PATH,
): boolean {
  const state = loadFleetState(fleetPath);
  const unit = state.fleet[account];

  if (!unit || unit.status !== "ocupado" || !unit.passenger) {
    return false;
  }

  unit.passenger.heartbeatAt = Date.now();
  saveFleetState(state, fleetPath);
  return true;
}

/**
 * Devuelve un resumen estadístico de la flota para TUI y auditoría.
 */
export function getFleetStatusSummary(fleetPath: string = FLEET_STATE_PATH): {
  total: number;
  libres: number;
  ocupados: number;
  units: DcTaxiUnit[];
} {
  const state = loadFleetState(fleetPath);
  reapAbandonedTaxis(state);

  const units = Object.values(state.fleet);
  const total = units.length;
  const libres = units.filter((u) => u.status === "libre").length;
  const ocupados = units.filter((u) => u.status === "ocupado").length;

  return {
    total,
    libres,
    ocupados,
    units,
  };
}
