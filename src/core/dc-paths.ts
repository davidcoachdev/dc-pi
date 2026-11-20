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

  return {
    dir,
    fleetState,
    ledgerDb: path.join(dir, "ledger.db"),
    legacyHistory: path.join(getDcStudioDir(), "dc-taxis-history.json"),
    log: path.join(dir, "taxis.log"),
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

export function getDcAgentsPaths(): DcAgentsPaths {
  const dir = path.join(getDcStudioDir(), "agents");
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
  const legacyConfig = path.join(getDcStudioDir(), "dc-agents.json");
  try {
    if (!fs.existsSync(config) && fs.existsSync(legacyConfig)) {
      const content = fs.readFileSync(legacyConfig, "utf8");
      writeFileAtomicSync(config, content);
    }
  } catch { /* best-effort */ }

  return {
    dir,
    config,
    worktreesDir,
    receiptsDir,
    questionsDir,
    answersDir,
  };
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

