/**
 * dc-taxi-dispatcher.ts — Central de Despacho de la Flota de Taxis (Libre / Ocupado / Recargando).
 *
 * Coordina el estado de las cuentas de IA entre todas las sesiones concurrentes de Pi.
 * Implementa auto-recuperación de zombis mediante verificación de PID en el OS,
 * sincronización dinámica de cuentas desde models.json (ac01..ac15, ac20...)
 * y estado 'recargando' para cuentas con <5% de cuota hasta recuperar >=60%.
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
import { discoverCpamAccounts } from "./dc-taxi-accounts.ts";
import { fetchAllTaxisQuotas, type DcTaxiQuotaInfo } from "./dc-taxi-quota.ts";

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
    return error.code === "EPERM";
  }
}

/**
 * Inicializa la flota por defecto descubriendo dinámicamente las cuentas de CPAM.
 */
export function createInitialFleetState(accounts?: string[]): DcTaxiFleetState {
  const activeAccounts = accounts && accounts.length > 0 ? accounts : discoverCpamAccounts();
  const fleet: Record<string, DcTaxiUnit> = {};
  for (const ac of activeAccounts) {
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
 * Carga el estado actual de la flota desde disco sincronizando cuentas dinámicamente.
 */
export function loadFleetState(
  fleetPath: string = FLEET_STATE_PATH,
  defaultAccounts?: string[],
): DcTaxiFleetState {
  if (!fs.existsSync(fleetPath)) {
    const discovered = defaultAccounts && defaultAccounts.length > 0 ? defaultAccounts : discoverCpamAccounts();
    return createInitialFleetState(discovered);
  }

  try {
    const raw = fs.readFileSync(fleetPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.fleet || Object.keys(parsed.fleet).length === 0) {
      const discovered = defaultAccounts && defaultAccounts.length > 0 ? defaultAccounts : discoverCpamAccounts();
      return createInitialFleetState(discovered);
    }

    const fleet: Record<string, DcTaxiUnit> = { ...parsed.fleet };

    // Solo sincronizar cuentas automáticas si no se pasaron cuentas explícitas
    if (!defaultAccounts || defaultAccounts.length === 0) {
      const discovered = discoverCpamAccounts();
      for (const ac of discovered) {
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
    const discovered = defaultAccounts && defaultAccounts.length > 0 ? defaultAccounts : discoverCpamAccounts();
    return createInitialFleetState(discovered);
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
    try {
      fs.writeFileSync(fleetPath, JSON.stringify(state, null, 2) + "\n", "utf8");
    } catch {
      /* defensive */
    }
  }
}

/**
 * Barre y recupera taxis zombis cuyo proceso murió o cuyo TTL expiró.
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
 * Aplica la política de cuota mínima:
 * Si una cuenta tiene < 5% en Gemini 5h, entra en 'recargando'.
 * No vuelve a 'libre' hasta tener al menos >= 60% de cuota.
 */
export function updateTaxiRechargingState(
  unit: DcTaxiUnit,
  quotaInfo?: DcTaxiQuotaInfo,
): void {
  if (!quotaInfo || quotaInfo.gemini5hPct === null) return;

  const pct = quotaInfo.gemini5hPct;

  // Si está ocupada por un pasajero real, no interrumpimos abruptamente salvo que esté libre
  if (unit.status === "libre" && pct < 5) {
    unit.status = "recargando";
    appendTaxiLog("WARN", "TAXI_RECHARGING_ENTERED", {
      account: unit.account,
      pct,
      resetTimeIso: quotaInfo.resetTimeIso,
    });
  } else if (unit.status === "recargando") {
    if (pct >= 60) {
      unit.status = "libre";
      appendTaxiLog("INFO", "TAXI_RECHARGING_RESTORED", {
        account: unit.account,
        pct,
      });
    }
  }
}

/**
 * Sincroniza el orquestador activo: registra la cuenta que está usando el padre
 * como 'ocupado' para que ningún subagente la colisione.
 */
export function syncOrchestratorTaxi(
  sessionId: string,
  modelId?: string,
  fleetPath: string = FLEET_STATE_PATH,
  pid: number = process.pid,
): void {
  if (!modelId || !modelId.includes("/")) return;

  const parts = modelId.split("/");
  // Buscar prefijo ac*
  let account = "";
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower.startsWith("ac")) {
      account = lower;
      break;
    }
  }

  if (!account) return;

  const state = loadFleetState(fleetPath);
  reapAbandonedTaxis(state);

  // Liberar cualquier taxi previo de esta misma sesión con passenger.type === "orchestrator"
  for (const unit of Object.values(state.fleet)) {
    if (unit.passenger && unit.passenger.sessionId === sessionId && unit.passenger.type === "orchestrator" && unit.account !== account) {
      unit.status = "libre";
      unit.passenger = null;
    }
  }

  const targetUnit = state.fleet[account];
  if (targetUnit) {
    targetUnit.status = "ocupado";
    targetUnit.passenger = {
      type: "orchestrator",
      sessionId,
      pid,
      model: modelId,
      taskLabel: "Sesión Principal (Orquestador)",
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
    };
    saveFleetState(state, fleetPath);

    appendTaxiLog("INFO", "TAXI_ORCHESTRATOR_SYNCED", {
      account,
      sessionId,
      pid,
      modelId,
    });
  }
}

/**
 * Solicita y arrienda un taxi libre para un pasajero.
 */
export function leaseTaxi(
  passengerData: Omit<DcTaxiPassenger, "startedAt" | "heartbeatAt">,
  preferredAccount?: string,
  fleetPath: string = FLEET_STATE_PATH,
  leaseTtlMs: number = DEFAULT_DC_AGENTS_CONFIG.accountPool.leaseTtlMs,
  allowedAccounts?: string[],
): { account: string; unit: DcTaxiUnit } | null {
  const state = loadFleetState(fleetPath, allowedAccounts);
  reapAbandonedTaxis(state, leaseTtlMs);

  const now = Date.now();
  const fullPassenger: DcTaxiPassenger = {
    ...passengerData,
    startedAt: now,
    heartbeatAt: now,
  };

  // 1. Intentar cuenta preferida si está estrictamente libre
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

  // 2. Buscar cualquier taxi libre disponible
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

  // 3. Flota agotada
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
  allowedAccounts?: string[],
): boolean {
  const state = loadFleetState(fleetPath, allowedAccounts);
  const unit = state.fleet[account];

  if (!unit || unit.status !== "ocupado") {
    return false;
  }

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
 * Envía un pulso de vida (heartbeat) para mantener el taxi arrendado.
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
export function getFleetStatusSummary(
  fleetPath: string = FLEET_STATE_PATH,
  allowedAccounts?: string[],
): {
  total: number;
  libres: number;
  ocupados: number;
  recargando: number;
  units: DcTaxiUnit[];
} {
  const state = loadFleetState(fleetPath, allowedAccounts);
  reapAbandonedTaxis(state);

  const units = Object.values(state.fleet);
  const total = units.length;
  const libres = units.filter((u) => u.status === "libre").length;
  const ocupados = units.filter((u) => u.status === "ocupado").length;
  const recargando = units.filter((u) => u.status === "recargando").length;

  return {
    total,
    libres,
    ocupados,
    recargando,
    units,
  };
}
