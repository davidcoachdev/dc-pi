import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Resuelve dinámicamente el directorio raíz del agente Pi (`PI_CODING_AGENT_DIR` o `~/.pi/agent`).
 * Respeta sobreescrituras de entorno en tiempo de ejecución (tests herméticos).
 */
export function getPiCodingAgentDir(): string {
  const custom = process.env.PI_CODING_AGENT_DIR?.trim();
  if (custom) {
    return custom;
  }
  const home = process.env.HOME?.trim() || os.homedir();
  return path.join(home, ".pi", "agent");
}

/**
 * Resuelve dinámicamente la ruta al archivo settings.json de Pi
 * (`<PI_CODING_AGENT_DIR>/settings.json`, por defecto `~/.pi/agent/settings.json`).
 */
export function resolveSettingsFilePath(): string {
  return path.join(getPiCodingAgentDir(), "settings.json");
}

/**
 * Garantiza que exista el directorio indicado (o su directorio padre cuando `isFilePath` es true).
 */
export function ensureDirectory(filePathOrDir: string, isFilePath: boolean = true): string {
  const dir = isFilePath ? path.dirname(filePathOrDir) : filePathOrDir;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Garantiza que exista el directorio padre de `filePath`.
 */
export function ensureParentDirectory(filePath: string): string {
  return ensureDirectory(filePath, true);
}

/**
 * Escritura atómica mediante archivo temporal en el mismo directorio + renameSync,
 * limpiando el archivo temporal si ocurre cualquier fallo.
 */
export function writeFileAtomicSync(targetPath: string, content: string): void {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  try {
    fs.writeFileSync(tempPath, content, "utf8");
    fs.renameSync(tempPath, targetPath);
  } catch (err) {
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch {
      /* ignore cleanup error */
    }
    throw err;
  }
}

/**
 * Directorio raíz para toda la configuración persistente del ecosistema DC Studio.
 * Ubicación: <PI_CODING_AGENT_DIR>/dc-studio/ (por defecto ~/.pi/agent/dc-studio/)
 */
export function getDcStudioDir(): string {
  const dir = path.join(getPiCodingAgentDir(), "dc-studio");
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch {
    /* best-effort */
  }
  return dir;
}

/**
 * Resuelve la ruta a un archivo de configuración de una feature dentro de <PI_CODING_AGENT_DIR>/dc-studio/.
 * Si existe un archivo legado suelto en <PI_CODING_AGENT_DIR>/dc-<name>.json y el nuevo no existe,
 * realiza una migración transparente copiando el contenido de forma atómica al nuevo destino.
 */
export function resolveDcConfigPath(featureName: string): string {
  const newPath = path.join(getDcStudioDir(), `${featureName}.json`);
  const legacyPath = path.join(getPiCodingAgentDir(), `dc-${featureName}.json`);

  try {
    if (!fs.existsSync(newPath) && fs.existsSync(legacyPath)) {
      const data = fs.readFileSync(legacyPath, "utf8");
      writeFileAtomicSync(newPath, data);
    }
  } catch {
    /* fallback */
  }

  return newPath;
}

/**
 * Rutas organizadas y estructuradas por subsistema dentro de DC Studio.
 * Aplica el principio de separación de responsabilidades y migración transparente.
 */
export interface DcTaxisPaths {
  dir: string;
  fleetState: string;
  ledgerDb: string;
  legacyHistory: string;
  log: string;
  workshopLog: string;
}

export function getDcTaxisPaths(): DcTaxisPaths {
  const dir = path.join(getDcStudioDir(), "taxis");
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch { /* best-effort */ }

  const fleetState = path.join(dir, "fleet.json");
  const legacyFleet = path.join(getDcStudioDir(), "dc-taxis.json");
  try {
    if (!fs.existsSync(fleetState) && fs.existsSync(legacyFleet)) {
      const content = fs.readFileSync(legacyFleet, "utf8");
      writeFileAtomicSync(fleetState, content);
    }
  } catch { /* best-effort */ }

  const log = path.join(dir, "taxis.log");
  const legacyLog = path.join(getDcStudioDir(), "dc-taxis.log");
  try {
    if (!fs.existsSync(log) && fs.existsSync(legacyLog)) {
      const content = fs.readFileSync(legacyLog, "utf8");
      writeFileAtomicSync(log, content);
    }
  } catch { /* best-effort */ }

  return {
    dir,
    fleetState,
    ledgerDb: path.join(dir, "ledger.db"),
    legacyHistory: path.join(getDcStudioDir(), "dc-taxis-history.json"),
    log,
    workshopLog: path.join(dir, "workshop.log"),
  };
}

export interface DcSentinelPaths {
  dir: string;
  config: string;
  catalogueDb: string;
  sessionsDir: string;
}

export function getDcSentinelPaths(): DcSentinelPaths {
  const dir = path.join(getDcStudioDir(), "sentinel");
  const sessionsDir = path.join(dir, "sessions");
  try {
    if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });
  } catch { /* best-effort */ }

  const config = path.join(dir, "config.json");
  const legacyConfig = path.join(getDcStudioDir(), "sentinel.json");
  try {
    if (!fs.existsSync(config) && fs.existsSync(legacyConfig)) {
      const content = fs.readFileSync(legacyConfig, "utf8");
      writeFileAtomicSync(config, content);
    }
  } catch { /* best-effort */ }

  return {
    dir,
    config,
    catalogueDb: path.join(dir, "catalogue.db"),
    sessionsDir,
  };
}

export interface DcSidebarPaths {
  dir: string;
  state: string;
  body: string;
  face: string;
  prompt: string;
}

export function getDcSidebarPaths(): DcSidebarPaths {
  const dir = path.join(getDcStudioDir(), "sidebar");
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch { /* best-effort */ }

  const state = path.join(dir, "sidebar.json");
  const legacyState = path.join(getDcStudioDir(), "sidebar.json");
  try {
    if (!fs.existsSync(state) && fs.existsSync(legacyState)) {
      const content = fs.readFileSync(legacyState, "utf8");
      writeFileAtomicSync(state, content);
    }
  } catch { /* best-effort */ }

  return {
    dir,
    state,
    body: path.join(dir, "body.json"),
    face: path.join(dir, "face.json"),
    prompt: path.join(dir, "prompt.json"),
  };
}

export interface DcAgentsPaths {
  dir: string;
  config: string;
  worktreesDir: string;
  receiptsDir: string;
  questionsDir: string;
  answersDir: string;
}

function migrateLegacyJsonFiles(legacyDir: string, targetDir: string): void {
  try {
    if (!fs.existsSync(legacyDir) || !fs.statSync(legacyDir).isDirectory()) return;
    for (const entry of fs.readdirSync(legacyDir)) {
      if (!entry.endsWith(".json")) continue;
      const src = path.join(legacyDir, entry);
      const dst = path.join(targetDir, entry);
      if (!fs.existsSync(dst) && fs.statSync(src).isFile()) {
        writeFileAtomicSync(dst, fs.readFileSync(src, "utf8"));
      }
    }
  } catch {
    /* best-effort */
  }
}

export function getDcAgentsPaths(): DcAgentsPaths {
  const dcStudioDir = getDcStudioDir();
  const dir = path.join(dcStudioDir, "agents");
  const worktreesDir = path.join(dir, "worktrees");
  const receiptsDir = path.join(dir, "receipts");
  const questionsDir = path.join(dir, "questions");
  const answersDir = path.join(dir, "answers");
  try {
    if (!fs.existsSync(worktreesDir)) fs.mkdirSync(worktreesDir, { recursive: true });
    if (!fs.existsSync(receiptsDir)) fs.mkdirSync(receiptsDir, { recursive: true });
    if (!fs.existsSync(questionsDir)) fs.mkdirSync(questionsDir, { recursive: true });
    if (!fs.existsSync(answersDir)) fs.mkdirSync(answersDir, { recursive: true });
  } catch { /* best-effort */ }

  const config = path.join(dir, "config.json");
  const legacyConfig = path.join(dcStudioDir, "dc-agents.json");
  try {
    if (!fs.existsSync(config) && fs.existsSync(legacyConfig)) {
      const content = fs.readFileSync(legacyConfig, "utf8");
      writeFileAtomicSync(config, content);
    }
  } catch { /* best-effort */ }

  migrateLegacyJsonFiles(path.join(dcStudioDir, "questions"), questionsDir);
  migrateLegacyJsonFiles(path.join(dcStudioDir, "answers"), answersDir);

  return {
    dir,
    config,
    worktreesDir,
    receiptsDir,
    questionsDir,
    answersDir,
  };
}

/**
 * Resuelve un worktree existente en la ruta canónica `dc-studio/agents/worktrees/...`,
 * con fallback de solo lectura a la ruta legada `dc-studio/worktrees/...` si aún existe en disco.
 */
export function resolveExistingAgentWorktreePath(...segments: string[]): string | undefined {
  const canonical = path.join(getDcAgentsPaths().worktreesDir, ...segments);
  if (fs.existsSync(canonical)) {
    return canonical;
  }
  const legacy = path.join(getDcStudioDir(), "worktrees", ...segments);
  if (fs.existsSync(legacy)) {
    return legacy;
  }
  return undefined;
}

export interface DcTtsPaths {
  dir: string;
  config: string;
  pid: string;
  log: string;
}

export function getDcTtsPaths(): DcTtsPaths {
  const dir = path.join(getDcStudioDir(), "tts");
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch { /* best-effort */ }

  return {
    dir,
    config: path.join(dir, "config.json"),
    pid: path.join(dir, "daemon.pid"),
    log: path.join(dir, "daemon.log"),
  };
}

export interface DcControlPaths {
  dir: string;
  socket: string;
  pid: string;
  daemonEntry: string;
}

/**
 * Rutas canónicas para el subsistema dc-control (supervisor multisesión).
 * Ubicación centralizada en: ~/.pi/agent/dc-studio/control/
 */
export function getDcControlPaths(): DcControlPaths {
  const dir = path.join(getDcStudioDir(), "control");
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch { /* best-effort */ }

  const socket = process.env.DC_SUPERVISOR_SOCKET || path.join(dir, "supervisor.sock");
  const pid = process.env.DC_SUPERVISOR_PID || path.join(dir, "supervisor.pid");
  const daemonEntry = path.join(dir, "daemon-entry.js");

  return {
    dir,
    socket,
    pid,
    daemonEntry,
  };
}


