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
import { randomUUID } from "node:crypto";
import type {
  DcTaxiFleetState,
  DcTaxiPassenger,
  DcTaxiUnit,
} from "./dc-ephemeral-types.ts";
import { DEFAULT_DC_AGENTS_CONFIG } from "./dc-ephemeral-types.ts";
import { appendTaxiLog } from "./dc-taxi-logger.ts";
import { discoverCpamAccounts, discoverVipAccounts, isVipAccount } from "./dc-taxi-accounts.ts";
import {
  fetchAllTaxisQuotas,
  getCachedTaxiQuota,
  getEffectiveQuotaPct,
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
    cycleDispatched: [],
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
          fleet[ac] = { account: ac, status: "libre", passenger: null, tier: "standard" };
        }
      }
      const vips = discoverVipAccounts();
      for (const vip of vips) {
        if (!fleet[vip]) {
          fleet[vip] = { account: vip, status: "libre", passenger: null, tier: "vip" };
        } else if (!fleet[vip].tier) {
          fleet[vip].tier = "vip";
        }
      }
    }

    const cycleDispatched = Array.isArray(parsed.cycleDispatched)
      ? parsed.cycleDispatched.filter((x: unknown) => typeof x === "string")
      : [];

    return {
      fleet,
      lastUpdated: typeof parsed.lastUpdated === "number" ? parsed.lastUpdated : Date.now(),
      cycleDispatched,
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
    // Inmunidad del Orquestador: jamás desalojará un 'orchestrator' vivo
    if (passenger.type === "orchestrator") {
      if (isProcessAlive(passenger.pid)) {
        continue;
      }
    }

    const isPidDead = !isProcessAlive(passenger.pid);
    if (!isPidDead && now - (passenger.heartbeatAt || passenger.startedAt) > leaseTtlMs) {
      passenger.leaseHealth = "uncertain";
    }
    // A stale heartbeat is not termination evidence: the recorded PID may be
    // the still-live parent of a worker whose dispatch outcome is unknown.
    if (isPidDead) {
      const reason = `PID ${passenger.pid} no existe en OS`;
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
 * Si una cuenta tiene < 5% en su cuota efectiva (Gemini o Claude, 5h o Weekly), entra en 'recargando'.
 * No vuelve a 'libre' hasta tener al menos >= 60% de cuota.
 */
export function updateTaxiRechargingState(
  unit: DcTaxiUnit,
  quotaInfo?: DcTaxiQuotaInfo,
): void {
  const pct = getEffectiveQuotaPct(quotaInfo);
  if (pct === null) return;

  // Si está ocupada por un pasajero real, no interrumpimos abruptamente salvo que esté libre
  if (unit.status === "libre" && pct < 5) {
    unit.status = "recargando";
    appendTaxiLog("WARN", "TAXI_RECHARGING_ENTERED", {
      account: unit.account,
      pct,
      resetTimeIso: quotaInfo?.resetTimeIso,
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
  explicitOptions?: boolean | { isExplicitSelection?: boolean },
): { account: string; modelId: string; changed: boolean } | null {
  return acquireOrchestratorTaxi(
    sessionId,
    modelId,
    fleetPath,
    pid,
    undefined,
    "gemini-3.8-flash-high",
    "cpam",
    undefined,
    explicitOptions,
  );
}

/**
 * Selecciona una unidad estándar libre siguiendo un ciclo de rotación estricto sin repetición.
 * - Solo participan unidades estándar (no VIP) con status === "libre" (se excluyen en_taller, ocupado, recargando).
 * - Mantiene state.cycleDispatched con las cuentas ya asignadas en el ciclo actual.
 * - Si todas las unidades libres disponibles ya fueron despachadas en esta ronda,
 *   reinicia atómicamente el ciclo (state.cycleDispatched = []) para que todas las libres
 *   vuelvan a estar disponibles.
 * - Registra la unidad seleccionada en state.cycleDispatched.
 */
export function selectNextCycleTaxi(
  state: DcTaxiFleetState,
  quotaGetter: (account: string) => DcTaxiQuotaInfo | undefined = getCachedTaxiQuota,
  excludedAccounts?: string[],
): DcTaxiUnit | null {
  const isExcluded = (ac: string) => Array.isArray(excludedAccounts) && excludedAccounts.includes(ac);

  // 1. Filtrar estrictamente unidades estándar con status "libre"
  const freeStandardUnits = Object.values(state.fleet).filter((u) => {
    if (u.status !== "libre" || isExcluded(u.account)) return false;
    const isVip = u.tier === "vip" || isVipAccount(u.account);
    return !isVip;
  });

  if (freeStandardUnits.length === 0) {
    return null;
  }

  if (!Array.isArray(state.cycleDispatched)) {
    state.cycleDispatched = [];
  }

  // 2. Determinar unidades libres que aún NO se han despachado en el ciclo actual
  let eligibleInCycle = freeStandardUnits.filter((u) => !state.cycleDispatched!.includes(u.account));

  // 3. Si ya se despacharon todas las unidades libres disponibles en el ciclo, auto-reset
  if (eligibleInCycle.length === 0) {
    state.cycleDispatched = [];
    eligibleInCycle = freeStandardUnits;
  }

  // 4. De las elegibles, ordenar y priorizar por cuota óptima (dentro del 10% del máximo)
  const unitsWithQuota = eligibleInCycle.map((u) => {
    const quota = getEffectiveQuotaPct(quotaGetter(u.account)) ?? 100;
    return { unit: u, quota };
  });

  const maxQuota = Math.max(...unitsWithQuota.map((u) => u.quota));
  const topCandidates = unitsWithQuota.filter((u) => u.quota >= maxQuota - 10);

  // Selección pseudoaleatoria uniforme entre los mejores candidatos libres de la ronda
  const selectedIdx = Math.floor(Math.random() * topCandidates.length);
  const selected = topCandidates[selectedIdx] ?? unitsWithQuota[0]!;
  const selectedUnit = selected.unit;

  // 5. Registrar en el ciclo actual
  if (!state.cycleDispatched.includes(selectedUnit.account)) {
    state.cycleDispatched.push(selectedUnit.account);
  }

  return selectedUnit;
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
  excludedAccounts?: string[],
  explicitOptions?: boolean | { isExplicitSelection?: boolean },
): { account: string; modelId: string; changed: boolean } | null {
  return withFleetLock(fleetPath, () => {
    const state = loadFleetState(fleetPath, allowedAccounts);
    reapAbandonedTaxis(state);

    const isExplicit = typeof explicitOptions === "boolean"
      ? explicitOptions
      : Boolean(explicitOptions?.isExplicitSelection);

    let currentAccount = "";
    let accountIndex = -1;
    let parts: string[] = [];

    if (modelId && modelId.includes("/")) {
      parts = modelId.split("/");
      for (let i = 0; i < parts.length; i++) {
        const lower = parts[i].toLowerCase();
        if (
          lower.startsWith("ac") ||
          lower.startsWith("cc") ||
          lower.startsWith("nan-") ||
          lower.startsWith("nan_") ||
          isVipAccount(lower)
        ) {
          currentAccount = lower;
          accountIndex = i;
          break;
        }
      }
    }

    const isExcluded = (ac: string) => Array.isArray(excludedAccounts) && excludedAccounts.includes(ac);

    // Evaluar unidades en 'recargando' o 'libre' con cuotas cacheadas
    for (const unit of Object.values(state.fleet)) {
      if (unit.status === "recargando" || unit.status === "libre") {
        const quota = getCachedTaxiQuota(unit.account);
        updateTaxiRechargingState(unit, quota);
      }
    }

    // Identificar si la sesión ya posee una reserva legítima activa de orquestador
    let existingReservationUnit: DcTaxiUnit | undefined;
    for (const unit of Object.values(state.fleet)) {
      if (
        unit.status === "ocupado" &&
        unit.passenger &&
        unit.passenger.type === "orchestrator" &&
        unit.passenger.sessionId === sessionId &&
        unit.passenger.pid === pid &&
        !isExcluded(unit.account)
      ) {
        existingReservationUnit = unit;
        break;
      }
    }

    // Helper para liberar únicamente cuando una nueva reserva ha sido efectivamente confirmada
    const releasePriorReservation = (newAccount: string) => {
      for (const unit of Object.values(state.fleet)) {
        if (
          unit.passenger &&
          unit.passenger.type === "orchestrator" &&
          unit.passenger.sessionId === sessionId &&
          unit.passenger.pid === pid &&
          unit.account !== newAccount &&
          !isExcluded(unit.account)
        ) {
          unit.passenger = null;
          unit.status = "libre";
          const quota = getCachedTaxiQuota(unit.account);
          updateTaxiRechargingState(unit, quota);
        }
      }
    };

    // Caso 1: Si esta sesión ya tiene un taxi ocupado y no se solicita cambio explícito de cuenta,
    // o la cuenta solicitada coincide con la actual: preservarlo en bookkeeping rutinario.
    if (existingReservationUnit) {
      if (!currentAccount || currentAccount === existingReservationUnit.account) {
        existingReservationUnit.passenger!.heartbeatAt = Date.now();
        saveFleetState(state, fleetPath);
        return {
          account: existingReservationUnit.account,
          modelId: existingReservationUnit.passenger!.model || modelId || `${fallbackProvider}/${existingReservationUnit.account}/${fallbackBaseModel}`,
          changed: false,
        };
      }
    }

    const isCurrentAccountVip = isVipAccount(currentAccount);
    const isAuthorizedVip = isCurrentAccountVip && isExplicit;

    // Caso VIP Explícito:
    // "Explicit manual cc4 selection may acquire only cc4; busy/unavailable cc4 must not assign any substitute or release existing legitimate reservation."
    if (isAuthorizedVip) {
      const preferredUnit = state.fleet[currentAccount];
      if (preferredUnit && preferredUnit.status === "libre" && !isExcluded(currentAccount)) {
        releasePriorReservation(currentAccount);

        preferredUnit.status = "ocupado";
        preferredUnit.passenger = {
          type: "orchestrator",
          sessionId,
          pid,
          model: modelId!,
          taskLabel: "Sesión Principal (Orquestador)",
          plate: `DC-HOST-${pid}-${randomUUID()}`,
          startedAt: Date.now(),
          heartbeatAt: Date.now(),
        };
        saveFleetState(state, fleetPath);

        appendTaxiLog("INFO", "TAXI_ORCHESTRATOR_ACQUIRED_VIP", {
          account: currentAccount,
          sessionId,
          pid,
          modelId,
          changed: Boolean(existingReservationUnit && existingReservationUnit.account !== currentAccount),
        });

        return {
          account: currentAccount,
          modelId: modelId!,
          changed: Boolean(existingReservationUnit && existingReservationUnit.account !== currentAccount),
        };
      }

      // VIP solicitado no disponible (ocupado, taller, recarga o excluido):
      // NUNCA asignar sustituto ni liberar la reserva existente del orquestador.
      appendTaxiLog("WARN", "TAXI_ORCHESTRATOR_VIP_UNAVAILABLE", {
        account: currentAccount,
        status: preferredUnit?.status,
        sessionId,
        pid,
      });
      return null;
    }

    // Caso Estándar Preferido: si se especifica cuenta ac* estándar y está libre
    if (currentAccount && !isCurrentAccountVip && state.fleet[currentAccount] && !isExcluded(currentAccount)) {
      const preferredUnit = state.fleet[currentAccount];
      if (preferredUnit.status === "libre") {
        releasePriorReservation(currentAccount);

        preferredUnit.status = "ocupado";
        preferredUnit.passenger = {
          type: "orchestrator",
          sessionId,
          pid,
          model: modelId!,
          taskLabel: "Sesión Principal (Orquestador)",
          plate: `DC-HOST-${pid}-${randomUUID()}`,
          startedAt: Date.now(),
          heartbeatAt: Date.now(),
        };

        if (!state.cycleDispatched) state.cycleDispatched = [];
        if (!state.cycleDispatched.includes(currentAccount)) {
          state.cycleDispatched.push(currentAccount);
        }

        saveFleetState(state, fleetPath);

        appendTaxiLog("INFO", "TAXI_ORCHESTRATOR_ACQUIRED", {
          account: currentAccount,
          sessionId,
          pid,
          modelId,
          changed: Boolean(existingReservationUnit && existingReservationUnit.account !== currentAccount),
        });

        return {
          account: currentAccount,
          modelId: modelId!,
          changed: Boolean(existingReservationUnit && existingReservationUnit.account !== currentAccount),
        };
      }
    }

    // Caso 2: Balanceo de carga automático según ciclo de rotación sin repetición.
    // AISLAMIENTO VIP ESTRICTO: NUNCA asignar cuentas VIP en balanceo automático, ni al arrancar con modelo heredado cc*.
    const selectedUnit = selectNextCycleTaxi(state, (ac) => getCachedTaxiQuota(ac), excludedAccounts);

    if (selectedUnit) {
      const ac = selectedUnit.account;
      const unit = selectedUnit;

      releasePriorReservation(ac);

      unit.status = "ocupado";

      // Fallback a modelo estándar de Gemini válido (evitar acXX/gpt... si el modelo previo era VIP o GPT):
      let newModelId: string;
      const isOriginalModelGemini = parts.length > 0 && parts[parts.length - 1].toLowerCase().includes("gemini");
      if (currentAccount && !isCurrentAccountVip && accountIndex >= 0 && parts.length > 0 && isOriginalModelGemini) {
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
        plate: `DC-HOST-${pid}-${randomUUID()}`,
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
        loadBalanced: true,
      });

      return { account: ac, modelId: newModelId, changed: true };
    }

    // Caso 3: Flota llena
    return null;
  });
}

// Flag para autorizar explícitamente liberaciones originadas desde releaseOrchestratorTaxi
let isExplicitOrchestratorReleaseActive = false;

/**
 * Libera cualquier taxi ocupado por este orquestador al salir o cerrar sesión.
 */
export function releaseOrchestratorTaxi(
  sessionId?: string,
  pid: number = process.pid,
  fleetPath: string = FLEET_STATE_PATH,
  allowedAccounts?: string[],
): void {
  isExplicitOrchestratorReleaseActive = true;
  try {
    withFleetLock(fleetPath, () => {
      const state = loadFleetState(fleetPath, allowedAccounts);
      let changed = false;

      for (const unit of Object.values(state.fleet)) {
        if (unit.passenger && unit.passenger.type === "orchestrator") {
          const matchesSession = sessionId ? unit.passenger.sessionId === sessionId : true;
          const matchesPid = pid !== undefined ? unit.passenger.pid === pid : true;
          if (matchesSession && matchesPid) {
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
      }

      if (changed) {
        saveFleetState(state, fleetPath);
      }
    });
  } finally {
    isExplicitOrchestratorReleaseActive = false;
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
    const plate = passengerData.plate || `DC-${randomUUID().slice(0, 6).toUpperCase()}`;
    const fullPassenger: DcTaxiPassenger = {
      ...passengerData,
      plate,
      startedAt: now,
      heartbeatAt: now,
    };

    // 1. Intentar cuenta preferida si está estrictamente libre
    // Si la cuenta preferida es VIP, solo se admite si el pasajero lo solicitó explícitamente y está autorizado
    if (preferredAccount && state.fleet[preferredAccount] && state.fleet[preferredAccount].status === "libre") {
      const preferredIsVip = state.fleet[preferredAccount].tier === "vip" || isVipAccount(preferredAccount);
      // Los subagentes nunca pueden arrendar cuentas VIP
      if (!preferredIsVip) {
        const unit = state.fleet[preferredAccount];
        unit.status = "ocupado";
        unit.passenger = fullPassenger;

        if (!state.cycleDispatched) state.cycleDispatched = [];
        if (!state.cycleDispatched.includes(preferredAccount)) {
          state.cycleDispatched.push(preferredAccount);
        }

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
    }

    // 2. Buscar entre los taxis libres disponibles siguiendo el ciclo de rotación sin repetición.
    // AISLAMIENTO VIP: Subagentes y pasajeros comunes NUNCA pueden arrendar taxis VIP (tier === 'vip' o cc*).
    const selectedUnit = selectNextCycleTaxi(state, quotaGetter);
    if (selectedUnit) {
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
        quotaPct: getEffectiveQuotaPct(quotaGetter(selectedUnit.account)) ?? 100,
        loadBalanced: true,
        cycleRotated: true,
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

export interface ReleaseTaxiOptions {
  pid?: number;
  fromOrchestratorRelease?: boolean;
  plate?: string;
  expectedPlate?: string;
}

/**
 * Libera un taxi y lo marca como libre en la flota compartida.
 * Si el pasajero es de tipo 'orchestrator', cuenta con inmunidad estricta y solo se libera
 * si proviene explícitamente de releaseOrchestratorTaxi o si sessionId y pid coinciden exactamente.
 */
export function releaseTaxi(
  account: string,
  sessionId?: string,
  fleetPath: string = FLEET_STATE_PATH,
  allowedAccounts?: string[],
  quotaGetter: (account: string) => DcTaxiQuotaInfo | undefined = getCachedTaxiQuota,
  options?: ReleaseTaxiOptions,
): boolean {
  return withFleetLock(fleetPath, () => {
    const state = loadFleetState(fleetPath, allowedAccounts);
    const unit = state.fleet[account];

    if (!unit || unit.status !== "ocupado") {
      return false;
    }

    // Inmunidad del Orquestador
    if (unit.passenger && unit.passenger.type === "orchestrator") {
      const isFromOrch = Boolean(options?.fromOrchestratorRelease || isExplicitOrchestratorReleaseActive);
      const matchesSessionAndPid = Boolean(
        sessionId &&
        unit.passenger.sessionId === sessionId &&
        (options?.pid ?? process.pid) === unit.passenger.pid
      );

      if (!isFromOrch && !matchesSessionAndPid) {
        appendTaxiLog("WARN", "TAXI_ORCHESTRATOR_IMMUNITY_PROTECTED", {
          account,
          orchestratorSessionId: unit.passenger.sessionId,
          orchestratorPid: unit.passenger.pid,
          attemptedSessionId: sessionId,
          attemptedPid: options?.pid ?? process.pid,
        });
        return false;
      }
    }

    const expectedPlate = options?.plate ?? options?.expectedPlate;
    if (expectedPlate && unit.passenger && unit.passenger.plate && unit.passenger.plate !== expectedPlate) {
      appendTaxiLog("WARN", "TAXI_RELEASE_PLATE_MISMATCH", {
        account,
        expectedPlate: unit.passenger.plate,
        attemptedPlate: expectedPlate,
      });
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

export interface TaxiIdentityOptions {
  plate?: string;
  sessionId?: string;
  pid?: number;
}

/**
 * Envía un pulso de vida (heartbeat) para mantener el taxi arrendado.
 * Protegido atómicamente con withFleetLock para evitar sobrescrituras de estado.
 */
export function heartbeatTaxi(
  account: string,
  fleetPath: string = FLEET_STATE_PATH,
  identity?: TaxiIdentityOptions,
): boolean {
  return withFleetLock(fleetPath, () => {
    const state = loadFleetState(fleetPath);
    const unit = state.fleet[account];

    if (!unit || unit.status !== "ocupado" || !unit.passenger) {
      return false;
    }

    if (identity?.plate && unit.passenger.plate && unit.passenger.plate !== identity.plate) {
      appendTaxiLog("WARN", "TAXI_HEARTBEAT_OWNERSHIP_MISMATCH", {
        account,
        expectedPlate: unit.passenger.plate,
        attemptedPlate: identity.plate,
      });
      return false;
    }

    if (identity?.sessionId && unit.passenger.sessionId && unit.passenger.sessionId !== identity.sessionId) {
      appendTaxiLog("WARN", "TAXI_HEARTBEAT_OWNERSHIP_MISMATCH", {
        account,
        expectedSession: unit.passenger.sessionId,
        attemptedSession: identity.sessionId,
      });
      return false;
    }

    if (identity?.pid !== undefined && unit.passenger.pid !== identity.pid) {
      return false;
    }

    unit.passenger.heartbeatAt = Date.now();
    saveFleetState(state, fleetPath);
    return true;
  });
}

/**
 * Actualiza atómicamente el consumo de tokens y costo en el pasajero del taxi activo.
 * Protegido con withFleetLock para garantizar concurrencia segura.
 */
export function updateTaxiPassengerUsage(
  account: string,
  tokens: number,
  cost?: number,
  fleetPath: string = FLEET_STATE_PATH,
  identity?: TaxiIdentityOptions,
): boolean {
  return withFleetLock(fleetPath, () => {
    const state = loadFleetState(fleetPath);
    const unit = state.fleet[account];

    if (!unit || unit.status !== "ocupado" || !unit.passenger) {
      return false;
    }

    if (identity?.plate && unit.passenger.plate && unit.passenger.plate !== identity.plate) {
      appendTaxiLog("WARN", "TAXI_USAGE_UPDATE_OWNERSHIP_MISMATCH", {
        account,
        expectedPlate: unit.passenger.plate,
        attemptedPlate: identity.plate,
      });
      return false;
    }

    if (identity?.sessionId && unit.passenger.sessionId && unit.passenger.sessionId !== identity.sessionId) {
      appendTaxiLog("WARN", "TAXI_USAGE_UPDATE_OWNERSHIP_MISMATCH", {
        account,
        expectedSession: unit.passenger.sessionId,
        attemptedSession: identity.sessionId,
      });
      return false;
    }

    if (identity?.pid !== undefined && unit.passenger.pid !== identity.pid) {
      return false;
    }

    unit.passenger.tokens = tokens;
    if (cost !== undefined) {
      unit.passenger.cost = cost;
    }
    saveFleetState(state, fleetPath);
    return true;
  });
}

export type DcTaxiPassengerInput = Omit<DcTaxiPassenger, "startedAt" | "heartbeatAt"> & {
  startedAt?: number;
  heartbeatAt?: number;
};

/**
 * Arrienda N unidades libres reales sin especificar una lista cableada de cuentas.
 * Ignora absolutamente las unidades con status 'en_taller' o 'recargando'.
 */
export function leaseAvailableTaxis(
  count: number,
  passengerFactory: (idx: number) => DcTaxiPassengerInput,
  fleetPath: string = FLEET_STATE_PATH,
  leaseTtlMs: number = DEFAULT_DC_AGENTS_CONFIG.accountPool.leaseTtlMs,
  allowedAccounts?: string[],
  quotaGetter: (account: string) => DcTaxiQuotaInfo | undefined = getCachedTaxiQuota,
): DcTaxiUnit[] {
  if (count <= 0) return [];
  return withFleetLock(fleetPath, () => {
    const state = loadFleetState(fleetPath, allowedAccounts);
    reapAbandonedTaxis(state, leaseTtlMs, Date.now(), quotaGetter);

    // Evaluar unidades en 'recargando' y 'libre'
    for (const unit of Object.values(state.fleet)) {
      if (unit.status === "recargando" || unit.status === "libre") {
        const quota = quotaGetter(unit.account);
        updateTaxiRechargingState(unit, quota);
      }
    }

    // Seleccionar count unidades siguiendo el ciclo de rotación sin repetición
    const leasedUnits: DcTaxiUnit[] = [];
    const now = Date.now();

    for (let i = 0; i < count; i++) {
      const unit = selectNextCycleTaxi(state, quotaGetter);
      if (!unit) break;

      const passengerData = passengerFactory(i);
      const plate = passengerData.plate || `DC-${randomUUID().slice(0, 6).toUpperCase()}`;
      const fullPassenger: DcTaxiPassenger = {
        ...passengerData,
        plate,
        startedAt: passengerData.startedAt || now,
        heartbeatAt: passengerData.heartbeatAt || now,
      };

      unit.status = "ocupado";
      unit.passenger = fullPassenger;
      leasedUnits.push(unit);

      appendTaxiLog("INFO", "TAXI_LEASED", {
        account: unit.account,
        type: fullPassenger.type,
        sessionId: fullPassenger.sessionId,
        pid: fullPassenger.pid,
        model: fullPassenger.model,
        preferred: false,
        quotaPct: quotaGetter(unit.account)?.gemini5hPct ?? null,
      });
    }

    if (leasedUnits.length < count) {
      appendTaxiLog("WARN", "TAXI_FLEET_EXHAUSTED", {
        requestedCount: count,
        allocatedCount: leasedUnits.length,
      });
    }

    if (leasedUnits.length > 0) {
      saveFleetState(state, fleetPath);
    }

    return leasedUnits;
  });
}

let lastWorkshopSince = 0;

/**
 * Envía una unidad de taxi al taller por avería o fallo de autenticación fatal (ej: HTTP 400/401/403).
 * Garantiza que workshopSince sea estrictamente monótono para evitar colisiones de generación
 * en eventos sucesivos dentro del mismo milisegundo.
 */
export function sendTaxiToWorkshop(
  account: string,
  reason: string,
  fleetPath: string = FLEET_STATE_PATH,
  allowedAccounts?: string[],
): boolean {
  return withFleetLock(fleetPath, () => {
    const state = loadFleetState(fleetPath, allowedAccounts);
    const unit = state.fleet[account];
    if (!unit) {
      return false;
    }

    const now = Date.now();
    const maxExisting = Object.values(state.fleet).reduce(
      (max, u) => Math.max(max, u.workshopSince ?? 0),
      lastWorkshopSince,
    );
    const workshopSince = now <= maxExisting ? maxExisting + 1 : now;
    lastWorkshopSince = workshopSince;

    unit.status = "en_taller";
    unit.passenger = null;
    unit.workshopReason = reason;
    unit.workshopSince = workshopSince;

    saveFleetState(state, fleetPath);

    appendTaxiLog("WARN", "TAXI_WORKSHOP_ENTERED", {
      account,
      reason,
      workshopSince: unit.workshopSince,
    });

    return true;
  });
}

export interface RepairTaxiOptions {
  expectedWorkshopSince?: number;
}

/**
 * Repara una unidad de taxi en taller y la devuelve al estado libre (o recargando si cuota < 5%).
 * Protegido contra colisiones de generación (expectedWorkshopSince) y rechaza reparación
 * si la unidad posee una reserva activa.
 */
export function repairTaxiFromWorkshop(
  account: string,
  fleetPath: string = FLEET_STATE_PATH,
  allowedAccounts?: string[],
  quotaGetter: (account: string) => DcTaxiQuotaInfo | undefined = getCachedTaxiQuota,
  options?: RepairTaxiOptions,
): boolean {
  return withFleetLock(fleetPath, () => {
    const state = loadFleetState(fleetPath, allowedAccounts);
    const unit = state.fleet[account];
    if (!unit || unit.status !== "en_taller") {
      return false;
    }

    if (
      typeof options?.expectedWorkshopSince === "number" &&
      unit.workshopSince !== options.expectedWorkshopSince
    ) {
      appendTaxiLog("WARN", "TAXI_WORKSHOP_GENERATION_MISMATCH", {
        account,
        expectedWorkshopSince: options.expectedWorkshopSince,
        actualWorkshopSince: unit.workshopSince,
      });
      return false;
    }

    if (unit.passenger !== null) {
      appendTaxiLog("WARN", "TAXI_WORKSHOP_REPAIR_ACTIVE_LEASE", {
        account,
        plate: unit.passenger.plate,
        sessionId: unit.passenger.sessionId,
      });
      return false;
    }

    unit.status = "libre";
    delete unit.workshopReason;
    delete unit.workshopSince;

    const quota = quotaGetter(account);
    updateTaxiRechargingState(unit, quota);

    saveFleetState(state, fleetPath);

    appendTaxiLog("INFO", "TAXI_WORKSHOP_REPAIRED", {
      account,
    });

    return true;
  });
}

/**
 * Devuelve un resumen estadístico de la flota para TUI y auditoría.
 * Si se detectan procesos zombis o transiciones de cuota, persiste atómicamente el estado limpio.
 */
export function getFleetStatusSummary(
  fleetPath: string = FLEET_STATE_PATH,
  allowedAccounts?: string[],
): {
  total: number;
  libres: number;
  ocupados: number;
  recargando: number;
  en_taller: number;
  units: DcTaxiUnit[];
} {
  return withFleetLock(fleetPath, () => {
    const state = loadFleetState(fleetPath, allowedAccounts);
    const previousHealth = Object.values(state.fleet).map((unit) => unit.passenger?.leaseHealth);
    const reaped = reapAbandonedTaxis(state);

    let stateChanged = reaped > 0 || Object.values(state.fleet).some(
      (unit, index) => unit.passenger?.leaseHealth !== previousHealth[index],
    );
    for (const unit of Object.values(state.fleet)) {
      if (unit.status === "recargando" || unit.status === "libre") {
        const prevStatus = unit.status;
        const quota = getCachedTaxiQuota(unit.account);
        updateTaxiRechargingState(unit, quota);
        if (unit.status !== prevStatus) {
          stateChanged = true;
        }
      }
    }

    if (stateChanged) {
      saveFleetState(state, fleetPath);
    }

    const units = Object.values(state.fleet);
    const total = units.length;
    const libres = units.filter((u) => u.status === "libre").length;
    const ocupados = units.filter((u) => u.status === "ocupado").length;
    const recargando = units.filter((u) => u.status === "recargando").length;
    const en_taller = units.filter((u) => u.status === "en_taller").length;

    return {
      total,
      libres,
      ocupados,
      recargando,
      en_taller,
      units,
    };
  });
}
