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
