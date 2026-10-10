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
import {
  fetchAllTaxisQuotas,
  getCachedTaxiQuota,
  type DcTaxiQuotaInfo,
} from "./dc-taxi-quota.ts";

const FLEET_STATE_PATH = path.join(os.homedir(), ".pi", "agent", "dc-studio", "dc-taxis.json");
const LOCK_STALE_MS = 10_000;
const LOCK_MAX_WAIT_MS = 15_000;

// Reentrancia dentro del mismo proceso: ruta resuelta -> profundidad de anidamiento
const activeFleetLocks = new Map<string, number>();

function sleepSync(ms: number): void {
  try {
    const sab = new SharedArrayBuffer(4);
    const ia = new Int32Array(sab);
    Atomics.wait(ia, 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      /* fallback busy spin */
    }
  }
}

/**
 * Adquiere un lockfile exclusivo atómicamente con reintentos y backoff sincrónico.
 * Soporta romper stale locks (>10s o PID muerto) y reentrancia en el mismo proceso.
 */
function acquireFleetLock(lockPath: string): () => void {
  const resolved = path.resolve(lockPath);
  const currentDepth = activeFleetLocks.get(resolved) ?? 0;

  if (currentDepth > 0) {
    // Reentrancia dentro del mismo proceso
    activeFleetLocks.set(resolved, currentDepth + 1);
    return () => {
      const depth = activeFleetLocks.get(resolved) ?? 1;
      if (depth <= 1) {
        activeFleetLocks.delete(resolved);
        try {
          fs.unlinkSync(lockPath);
        } catch {
          /* defensive */
        }
      } else {
        activeFleetLocks.set(resolved, depth - 1);
      }
    };
  }

  ensureDirectory(lockPath);
  const startTime = Date.now();

  while (true) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      try {
        const payload = JSON.stringify({ pid: process.pid, createdAt: Date.now() });
        fs.writeSync(fd, payload, 0, "utf8");
      } finally {
        fs.closeSync(fd);
      }

      activeFleetLocks.set(resolved, 1);

      let released = false;
      return () => {
        if (released) return;
        released = true;
        const depth = activeFleetLocks.get(resolved) ?? 1;
        if (depth <= 1) {
          activeFleetLocks.delete(resolved);
          try {
            fs.unlinkSync(lockPath);
          } catch {
            /* defensive */
          }
        } else {
          activeFleetLocks.set(resolved, depth - 1);
        }
      };
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      if (error.code !== "EEXIST") {
        throw err;
      }

      // El archivo lock ya existe. Comprobar si está stale o el PID murió
      let isStale = false;
      try {
        const raw = fs.readFileSync(lockPath, "utf8");
        const parsed = JSON.parse(raw);
        const age = Date.now() - (typeof parsed.createdAt === "number" ? parsed.createdAt : 0);
        const pidDead = typeof parsed.pid === "number" && !isProcessAlive(parsed.pid);
        if (age > LOCK_STALE_MS || pidDead) {
          isStale = true;
        }
      } catch {
        // Si el archivo está incompleto o corrupto, comprobar mtime
        try {
          const stat = fs.statSync(lockPath);
          if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
            isStale = true;
          }
        } catch {
          // El lockfile ya no existe (otro proceso lo liberó concurrentemente)
          continue;
        }
      }

      if (isStale) {
        try {
          fs.unlinkSync(lockPath);
          // Reintentar de inmediato la adquisición
          continue;
        } catch {
          /* otro proceso pudo haberlo eliminado concurrentemente */
        }
      }

      if (Date.now() - startTime > LOCK_MAX_WAIT_MS) {
        throw new Error(`Timeout waiting for fleet lock: ${lockPath}`);
      }

      // Backoff sincrónico de 10 a 30ms
      const backoffMs = Math.floor(Math.random() * 21) + 10;
      sleepSync(backoffMs);
    }
  }
}

/**
 * Ejecuta una operación atómica bajo el file lock exclusivo de la flota.
 * Garantiza la liberación del lock en el bloque finally.
 */
export function withFleetLock<T>(fleetPath: string, fn: () => T): T {
  const lockPath = `${fleetPath}.lock`;
  const unlock = acquireFleetLock(lockPath);
  try {
    return fn();
  } finally {
    unlock();
  }
}

function ensureDirectory(targetPath: string): void {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Comprueba si un proceso sigue vivo en el sistema operativo sin enviarle una señal destructiva.
 * En Linux inspecciona /proc/<pid>/stat para descartar procesos en estado Zombie ('Z') o Dead ('X').
 */
export function isProcessAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;
    return error.code === "EPERM";
  }

  // En Linux, comprobar si el kernel lo mantiene como Zombie ('Z')
  if (process.platform === "linux") {
    try {
      const statPath = `/proc/${pid}/stat`;
      if (fs.existsSync(statPath)) {
        const statRaw = fs.readFileSync(statPath, "utf8");
        const lastParen = statRaw.lastIndexOf(")");
        if (lastParen >= 0 && lastParen + 2 < statRaw.length) {
          const stateChar = statRaw.charAt(lastParen + 2);
          if (stateChar === "Z" || stateChar === "X") {
            return false;
          }
        }
      }
    } catch {
      return false;
    }
  }

  return true;
}

export interface ActivePiProcessInfo {
  pid: number;
  cwd: string;
  modelId?: string;
  sessionId?: string;
}

/**
 * Escanea activamente el sistema operativo (/proc en Linux) en busca de procesos de Pi interactivos.
 * Detecta qué modelo y sesión está usando cada terminal abierta, incluso si arrancó en otra ventana.
 */
export function discoverActivePiProcesses(): ActivePiProcessInfo[] {
  if (process.platform !== "linux") return [];

  const found: ActivePiProcessInfo[] = [];
  const procDir = "/proc";

  try {
    const entries = fs.readdirSync(procDir);
    for (const entry of entries) {
      if (!/^\d+$/.test(entry)) continue;
      const pid = parseInt(entry, 10);
      if (isNaN(pid) || pid <= 0) continue;

      try {
        const cmdlinePath = path.join(procDir, entry, "cmdline");
        if (!fs.existsSync(cmdlinePath)) continue;

        const cmdRaw = fs.readFileSync(cmdlinePath, "utf8");
        const cmd = cmdRaw.replace(/\0/g, " ");

        // Debe ser un proceso pi interactivo, nunca un subproceso RPC ni hijo de esta sesión
        const isRpcOrSubprocess =
          cmd.includes("--mode rpc") ||
          cmd.includes("--session-dir") ||
          cmd.includes("--append-system-prompt") ||
          cmd.includes("subagent");

        const isPi =
          (cmd.includes("bin/pi") || cmd.trim().startsWith("pi ") || cmd.trim() === "pi" || cmd.includes("cli.js")) &&
          !isRpcOrSubprocess;

        if (!isPi) continue;

        // Descartar si es un proceso hijo directo de esta sesión
        try {
          const statContent = fs.readFileSync(path.join(procDir, entry, "stat"), "utf8");
          const parts = statContent.split(" ");
          const ppid = parseInt(parts[3], 10);
          if (ppid === process.pid) continue;
        } catch {
          /* ignore stat read error */
        }

        const cwdPath = path.join(procDir, entry, "cwd");
        let cwd = "";
        try {
          cwd = fs.readlinkSync(cwdPath);
        } catch {
          continue;
        }

        // Leer la sesión más reciente para ese CWD
        const safeName = "--" + cwd.replace(/^\//, "").replace(/\/$/, "").replace(/\//g, "-") + "--";
        const sessionDir = path.join(os.homedir(), ".pi", "agent", "sessions", safeName);

        let modelId: string | undefined;
        let sessionId: string | undefined;

        if (fs.existsSync(sessionDir)) {
          try {
            const files = fs.readdirSync(sessionDir)
              .filter((f) => f.endsWith(".jsonl"))
              .map((f) => ({ name: f, time: fs.statSync(path.join(sessionDir, f)).mtimeMs }))
              .sort((a, b) => b.time - a.time);

            if (files.length > 0) {
              const latestFile = files[0].name;
              const fullJsonlPath = path.join(sessionDir, latestFile);
              sessionId = latestFile.split("_").pop()?.replace(".jsonl", "");

              const content = fs.readFileSync(fullJsonlPath, "utf8");
              const lines = content.split("\n");
              for (let i = lines.length - 1; i >= 0; i--) {
                const line = lines[i].trim();
                if (!line) continue;
                try {
                  const parsed = JSON.parse(line);
                  const msg = parsed?.message;
                  if (msg && typeof msg === "object") {
                    const m = msg.model;
                    const p = msg.provider;
                    if (m) {
                      modelId = p ? `${p}/${m}` : String(m);
                      break;
                    }
                  }
                } catch {
                  /* continue scanning back */
                }
              }
            }
          } catch {
            /* ignore directory read error */
          }
        }

        found.push({ pid, cwd, modelId, sessionId });
      } catch {
        /* skip process */
      }
    }
  } catch {
    /* ignore readdir /proc error */
  }

  return found;
}

/**
 * Sincroniza la flota con todos los procesos de Pi vivos en el sistema operativo.
 * Solo renueva heartbeats de pasajeros legítimos ya registrados; NUNCA inventa
 * ni auto-adquiere taxis como 'orchestrator' para procesos desconocidos en el OS.
 */
export function syncActivePiSessionsFromOs(state: DcTaxiFleetState): number {
  const activeProcesses = discoverActivePiProcesses();
  let synced = 0;

  for (const proc of activeProcesses) {
    for (const unit of Object.values(state.fleet)) {
      if (unit.passenger && unit.passenger.pid === proc.pid) {
        unit.passenger.heartbeatAt = Date.now();
        synced++;
        break;
      }
    }
  }

  return synced;
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
  let tempPath: string | undefined;
  try {
    ensureDirectory(fleetPath);
    state.lastUpdated = Date.now();
    tempPath = `${fleetPath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(state, null, 2) + "\n", "utf8");
    fs.renameSync(tempPath, fleetPath);
    tempPath = undefined;
  } catch {
    if (tempPath) {
      try {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      } catch {
        /* defensive */
      }
    }
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
  quotaGetter: (account: string) => DcTaxiQuotaInfo | undefined = getCachedTaxiQuota,
): number {
  let reapedCount = 0;

  for (const [account, unit] of Object.entries(state.fleet)) {
    if (unit.status !== "ocupado" || !unit.passenger) continue;

    const passenger = unit.passenger;
    const isPidDead = !isProcessAlive(passenger.pid);
    // Un orquestador interactivo en una terminal viva NUNCA expira por TTL.
    // Solo se libera si su proceso en el sistema operativo murió realmente (isPidDead).
    // El TTL de inactividad solo aplica a subagentes o procesos efímeros desatendidos.
    const isTtlExpired =
      passenger.type !== "orchestrator" &&
      now - (passenger.heartbeatAt || passenger.startedAt) > leaseTtlMs;

    if (isPidDead || isTtlExpired) {
      const reason = isPidDead ? `PID ${passenger.pid} no existe en OS` : `TTL expirado (${Math.round((now - (passenger.heartbeatAt || passenger.startedAt)) / 1000)}s)`;
      appendTaxiLog("WARN", "TAXI_ZOMBIE_REAPED", {
        account,
        reason,
        passengerType: passenger.type,
        sessionId: passenger.sessionId,
        pid: passenger.pid,
      });

      unit.passenger = null;
      unit.status = "libre";
      const quota = quotaGetter(account);
      updateTaxiRechargingState(unit, quota);
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
  acquireOrchestratorTaxi(sessionId, modelId, fleetPath, pid);
}

/**
 * Adquiere un taxi para la sesión principal del orquestador.
 * Si la cuenta configurada por defecto está ocupada por otra sesión activa viva,
 * busca el primer taxi LIBRE y devuelve la nueva cuenta/modelo asignados para que
 * esta terminal tenga su propio carril independiente.
 */
export function acquireOrchestratorTaxi(
  sessionId: string,
  modelId?: string,
  fleetPath: string = FLEET_STATE_PATH,
  pid: number = process.pid,
  allowedAccounts?: string[],
  fallbackBaseModel: string = "gemini-3.8-flash-high",
  fallbackProvider: string = "cpam",
): { account: string; modelId: string; changed: boolean } | null {
  return withFleetLock(fleetPath, () => {
    const state = loadFleetState(fleetPath, allowedAccounts);
    reapAbandonedTaxis(state);

    let currentAccount = "";
    let accountIndex = -1;
    let parts: string[] = [];

    if (modelId && modelId.includes("/")) {
      parts = modelId.split("/");
      for (let i = 0; i < parts.length; i++) {
        const lower = parts[i].toLowerCase();
        if (lower.startsWith("ac")) {
          currentAccount = lower;
          accountIndex = i;
          break;
        }
      }
    }

    // Liberar cualquier taxi previo de esta misma sesión y PID que ya no use
    for (const unit of Object.values(state.fleet)) {
      if (
        unit.passenger &&
        unit.passenger.type === "orchestrator" &&
        (unit.passenger.sessionId === sessionId || unit.passenger.pid === pid) &&
        unit.account !== currentAccount
      ) {
        unit.passenger = null;
        unit.status = "libre";
        const quota = getCachedTaxiQuota(unit.account);
        updateTaxiRechargingState(unit, quota);
      }
    }

    // Evaluar unidades en 'recargando' o 'libre' con cuotas cacheadas
    for (const unit of Object.values(state.fleet)) {
      if (unit.status === "recargando" || unit.status === "libre") {
        const quota = getCachedTaxiQuota(unit.account);
        updateTaxiRechargingState(unit, quota);
      }
    }

    // Caso 1: La cuenta preferida es de CPAM ac* y está libre o ya pertenece a este mismo proceso
    if (currentAccount && state.fleet[currentAccount]) {
      const preferredUnit = state.fleet[currentAccount];
      const isMine =
        preferredUnit?.passenger?.pid === pid ||
        preferredUnit?.passenger?.sessionId === sessionId;
      const isFree = preferredUnit?.status === "libre";

      if (isFree || isMine) {
        preferredUnit.status = "ocupado";
        preferredUnit.passenger = {
          type: "orchestrator",
          sessionId,
          pid,
          model: modelId!,
          taskLabel: "Sesión Principal (Orquestador)",
          startedAt: preferredUnit.passenger?.startedAt || Date.now(),
          heartbeatAt: Date.now(),
        };
        saveFleetState(state, fleetPath);

        appendTaxiLog("INFO", "TAXI_ORCHESTRATOR_ACQUIRED", {
          account: currentAccount,
          sessionId,
          pid,
          modelId,
          changed: false,
        });

        return { account: currentAccount, modelId: modelId!, changed: false };
      }
    }

    // Caso 2: Si el modelo no era de CPAM (ej: Kimi, OpenCode) O si su cuenta ac* está ocupada:
    // ¡Tomar el primer Taxi LIBRE de la flota de CPAM!
    for (const [ac, unit] of Object.entries(state.fleet)) {
      if (unit.status === "libre") {
        unit.status = "ocupado";

        let newModelId: string;
        if (currentAccount && accountIndex >= 0 && parts.length > 0) {
          const newParts = [...parts];
          newParts[accountIndex] = ac;
          newModelId = newParts.join("/");
        } else {
          newModelId = `${fallbackProvider}/${ac}/${fallbackBaseModel}`;
        }

        unit.passenger = {
          type: "orchestrator",
          sessionId,
          pid,
          model: newModelId,
          taskLabel: "Sesión Principal (Orquestador)",
          startedAt: Date.now(),
          heartbeatAt: Date.now(),
        };
        saveFleetState(state, fleetPath);

        appendTaxiLog("INFO", "TAXI_ORCHESTRATOR_AUTO_REASSIGNED", {
          preferredAccount: currentAccount || "none (fallback)",
          reassignedAccount: ac,
          sessionId,
          pid,
          originalModelId: modelId || "none",
          newModelId,
        });

        return { account: ac, modelId: newModelId, changed: true };
      }
    }

    // Caso 3: Flota llena
    return null;
  });
}

/**
 * Libera cualquier taxi ocupado por este orquestador al salir o cerrar sesión.
 */
export function releaseOrchestratorTaxi(
  sessionId?: string,
  pid: number = process.pid,
  fleetPath: string = FLEET_STATE_PATH,
  allowedAccounts?: string[],
): void {
  withFleetLock(fleetPath, () => {
    const state = loadFleetState(fleetPath, allowedAccounts);
    let changed = false;

    for (const unit of Object.values(state.fleet)) {
      if (
        unit.passenger &&
        unit.passenger.type === "orchestrator" &&
        ((sessionId && unit.passenger.sessionId === sessionId) || unit.passenger.pid === pid)
      ) {
        unit.passenger = null;
        unit.status = "libre";
        const quota = getCachedTaxiQuota(unit.account);
        updateTaxiRechargingState(unit, quota);
        changed = true;
        appendTaxiLog("INFO", "TAXI_ORCHESTRATOR_RELEASED", {
          account: unit.account,
          sessionId,
          pid,
        });
      }
    }

    if (changed) {
      saveFleetState(state, fleetPath);
    }
  });
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
  quotaGetter: (account: string) => DcTaxiQuotaInfo | undefined = getCachedTaxiQuota,
): { account: string; unit: DcTaxiUnit } | null {
  return withFleetLock(fleetPath, () => {
    const state = loadFleetState(fleetPath, allowedAccounts);
    reapAbandonedTaxis(state, leaseTtlMs, Date.now(), quotaGetter);

    // Evaluar unidades en 'recargando' (si recuperaron >=60% se reactivan a 'libre') y 'libre' (<5% a 'recargando')
    for (const unit of Object.values(state.fleet)) {
      if (unit.status === "recargando" || unit.status === "libre") {
        const quota = quotaGetter(unit.account);
        updateTaxiRechargingState(unit, quota);
      }
    }

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

    // 2. Buscar el mejor taxi libre disponible ordenado por mayor cuota restante (algoritmo inteligente)
    const freeUnits = Object.values(state.fleet).filter((u) => u.status === "libre");
    if (freeUnits.length > 0) {
      freeUnits.sort((a, b) => {
        const qA = quotaGetter(a.account)?.gemini5hPct ?? 100;
        const qB = quotaGetter(b.account)?.gemini5hPct ?? 100;
        if (qB !== qA) {
          return qB - qA; // Descendente: priorizar unidades con más cuota
        }
        return a.account.localeCompare(b.account, undefined, { numeric: true });
      });

      const selectedUnit = freeUnits[0];
      selectedUnit.status = "ocupado";
      selectedUnit.passenger = fullPassenger;
      saveFleetState(state, fleetPath);

      appendTaxiLog("INFO", "TAXI_LEASED", {
        account: selectedUnit.account,
        type: fullPassenger.type,
        sessionId: fullPassenger.sessionId,
        pid: fullPassenger.pid,
        model: fullPassenger.model,
        preferred: false,
        quotaPct: quotaGetter(selectedUnit.account)?.gemini5hPct ?? null,
      });

      return { account: selectedUnit.account, unit: selectedUnit };
    }

    // 3. Flota agotada
    appendTaxiLog("WARN", "TAXI_FLEET_EXHAUSTED", {
      requestedBy: fullPassenger.type,
      sessionId: fullPassenger.sessionId,
      preferredAccount,
    });

    saveFleetState(state, fleetPath);
    return null;
  });
}

/**
 * Libera un taxi y lo marca como libre en la flota compartida.
 */
export function releaseTaxi(
  account: string,
  sessionId?: string,
  fleetPath: string = FLEET_STATE_PATH,
  allowedAccounts?: string[],
  quotaGetter: (account: string) => DcTaxiQuotaInfo | undefined = getCachedTaxiQuota,
): boolean {
  return withFleetLock(fleetPath, () => {
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
    unit.passenger = null;
    unit.status = "libre";

    const quota = quotaGetter(account);
    updateTaxiRechargingState(unit, quota);

    saveFleetState(state, fleetPath);

    appendTaxiLog("INFO", "TAXI_RELEASED", {
      account,
      releasedBySession: sessionId,
      passengerType: previousPassenger?.type,
      pid: previousPassenger?.pid,
    });

    return true;
  });
}

/**
 * Busca activamente en /proc el PID real del subproceso hijo generado por este proceso.
 */
export function findDirectChildPid(parentPid: number = process.pid): number | undefined {
  if (process.platform !== "linux") return undefined;
  try {
    const entries = fs.readdirSync("/proc");
    for (const entry of entries) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const statRaw = fs.readFileSync(path.join("/proc", entry, "stat"), "utf8");
        const lastParen = statRaw.lastIndexOf(")");
        if (lastParen >= 0) {
          const rest = statRaw.slice(lastParen + 2).trim();
          const tokens = rest.split(" ");
          const ppid = parseInt(tokens[1], 10);
          if (ppid === parentPid) {
            const childPid = parseInt(entry, 10);
            if (!isNaN(childPid) && childPid > 0) {
              return childPid;
            }
          }
        }
      } catch {
        /* skip entry */
      }
    }
  } catch {
    /* skip /proc */
  }
  return undefined;
}

/**
 * Actualiza el PID del pasajero de un taxi arrendado (por ejemplo, para reflejar el PID real del subproceso hijo).
 */
export function updateTaxiPassengerPid(
  account: string,
  realPid: number,
  fleetPath: string = FLEET_STATE_PATH,
): boolean {
  if (!realPid || realPid <= 0) return false;
  return withFleetLock(fleetPath, () => {
    const state = loadFleetState(fleetPath);
    const unit = state.fleet[account];
    if (unit && unit.status === "ocupado" && unit.passenger) {
      unit.passenger.pid = realPid;
      saveFleetState(state, fleetPath);
      return true;
    }
    return false;
  });
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

  for (const unit of Object.values(state.fleet)) {
    if (unit.status === "recargando" || unit.status === "libre") {
      const quota = getCachedTaxiQuota(unit.account);
      updateTaxiRechargingState(unit, quota);
    }
  }

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
