import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export interface DcAgentsSyncResult {
  synced: string[];
  skipped: string[];
  errors: string[];
}

/**
 * Busca la raíz del paquete dc-pi subiendo en el árbol de directorios.
 */
export function findDcPackageRoot(startDir: string = path.dirname(fileURLToPath(import.meta.url))): string {
  let curr = startDir;
  for (let i = 0; i < 6; i++) {
    const pkgPath = path.join(curr, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        if (pkg.name === "dc-pi") return curr;
      } catch {
        /* continue */
      }
    }
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  return path.resolve(startDir, "../../../..");
}

/**
 * Resuelve la ruta al directorio de agentes empaquetados en dc-pi.
 */
export function getDcBundledAgentsDir(): string {
  return path.join(findDcPackageRoot(), "agents");
}

/**
 * Resuelve la ruta al directorio global de agentes del usuario en Pi (~/.pi/agent/agents/).
 */
export function getPiTargetAgentsDir(): string {
  return path.join(os.homedir(), ".pi", "agent", "agents");
}

/**
 * Sincroniza de forma idempotente los subagentes empaquetados en dc-pi
 * hacia el directorio global de agentes de Pi.
 * Si un archivo no existe o su contenido difiere, lo copia/restaura.
 */
export function syncDcAgents(
  sourceDir: string = getDcBundledAgentsDir(),
  targetDir: string = getPiTargetAgentsDir(),
): DcAgentsSyncResult {
  const result: DcAgentsSyncResult = {
    synced: [],
    skipped: [],
    errors: [],
  };

  try {
    if (!fs.existsSync(sourceDir)) {
      result.errors.push(`Directorio fuente no encontrado: ${sourceDir}`);
      return result;
    }

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const files = fs.readdirSync(sourceDir).filter((file) => file.endsWith(".md"));

    for (const file of files) {
      const srcPath = path.join(sourceDir, file);
      const destPath = path.join(targetDir, file);

      try {
        const srcContent = fs.readFileSync(srcPath, "utf8");

        let needsWrite = true;
        if (fs.existsSync(destPath)) {
          const destContent = fs.readFileSync(destPath, "utf8");
          if (destContent === srcContent) {
            needsWrite = false;
          }
        }

        if (needsWrite) {
          fs.writeFileSync(destPath, srcContent, "utf8");
          result.synced.push(file);
        } else {
          result.skipped.push(file);
        }
      } catch (err) {
        result.errors.push(`Error al sincronizar ${file}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    result.errors.push(`Fallo general en syncDcAgents: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}
