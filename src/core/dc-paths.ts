import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Directorio raíz para toda la configuración persistente del ecosistema DC Studio.
 * Ubicación: ~/.pi/agent/dc-studio/
 */
export function getDcStudioDir(): string {
  const dir = path.join(os.homedir(), ".pi", "agent", "dc-studio");
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
 * Resuelve la ruta a un archivo de configuración de una feature dentro de ~/.pi/agent/dc-studio/.
 * Si existe un archivo legado suelto en ~/.pi/agent/dc-<name>.json y el nuevo no existe,
 * realiza una migración transparente copiando el contenido al nuevo destino.
 */
export function resolveDcConfigPath(featureName: string): string {
  const newPath = path.join(getDcStudioDir(), `${featureName}.json`);
  const legacyPath = path.join(os.homedir(), ".pi", "agent", `dc-${featureName}.json`);

  try {
    if (!fs.existsSync(newPath) && fs.existsSync(legacyPath)) {
      const data = fs.readFileSync(legacyPath, "utf8");
      fs.writeFileSync(newPath, data, "utf8");
    }
  } catch {
    /* fallback */
  }

  return newPath;
}
