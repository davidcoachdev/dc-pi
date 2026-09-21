import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const DEFAULT_DC_USER_FILE = path.join(os.homedir(), ".pi/agent/dc-user.json");

export interface DcUserData {
  name?: string;
}

/**
 * Resuelve la ruta efectiva del archivo de configuración del usuario.
 * Prioridad: argumento explícito > DC_USER_CONFIG_PATH env > ~/.pi/agent/dc-user.json.
 */
export function resolveUserFilePath(customPath?: string): string {
  if (customPath && customPath.trim().length > 0) {
    return customPath.trim();
  }
  if (process.env.DC_USER_CONFIG_PATH && process.env.DC_USER_CONFIG_PATH.trim().length > 0) {
    return process.env.DC_USER_CONFIG_PATH.trim();
  }
  return DEFAULT_DC_USER_FILE;
}

/**
 * Obtiene el nombre del usuario guardado en la configuración.
 * Retorna string vacío si el archivo no existe, no es legible o tiene formato inválido.
 */
export function getUserName(filePath?: string): string {
  try {
    const target = resolveUserFilePath(filePath);
    if (!fs.existsSync(target)) return "";
    const content = fs.readFileSync(target, "utf8");
    const parsed = JSON.parse(content) as DcUserData;
    return typeof parsed.name === "string" ? parsed.name.trim() : "";
  } catch {
    return "";
  }
}

/**
 * Alias compatible con la versión original de dc-user.
 */
export const userName = getUserName;

/**
 * Guarda el nombre del usuario en el archivo de configuración.
 * Crea los directorios padre de forma recursiva si no existen.
 */
export function saveUserName(name: string, filePath?: string): boolean {
  try {
    const target = resolveUserFilePath(filePath);
    const dir = path.dirname(target);
    fs.mkdirSync(dir, { recursive: true });
    const payload: DcUserData = { name: name.trim() };
    fs.writeFileSync(target, JSON.stringify(payload, null, 2), "utf8");
    return true;
  } catch {
    return false;
  }
}
