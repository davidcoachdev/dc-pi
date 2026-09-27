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
 * Resuelve la ruta al archivo subagents.json en el repo dc-pi.
 */
export function getDcBundledSubagentsJson(): string {
  return path.join(findDcPackageRoot(), "subagents.json");
}

/**
 * Resuelve la ruta al archivo global subagents.json de Pi (~/.pi/agent/subagents.json).
 */
export function getPiTargetSubagentsJson(): string {
  return path.join(os.homedir(), ".pi", "agent", "subagents.json");
}

/**
 * Resuelve la ruta al directorio de skills empaquetadas en dc-pi.
 */
export function getDcBundledSkillsDir(): string {
  return path.join(findDcPackageRoot(), "skills");
}

/**
 * Resuelve la ruta al directorio global de skills del usuario en Pi (~/.pi/agent/skills/).
 */
export function getPiTargetSkillsDir(): string {
  return path.join(os.homedir(), ".pi", "agent", "skills");
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

    // Sincronizar subagents.json si existe
    const bundledSubagentsJson = getDcBundledSubagentsJson();
    const targetSubagentsJson = getPiTargetSubagentsJson();
    if (fs.existsSync(bundledSubagentsJson)) {
      try {
        const raw = JSON.parse(fs.readFileSync(bundledSubagentsJson, "utf8"));
        if (raw.default_model === "inherit") {
          delete raw.default_model;
        }
        const srcContent = JSON.stringify(raw, null, 2) + "\n";
        let needsWrite = true;
        if (fs.existsSync(targetSubagentsJson)) {
          const destContent = fs.readFileSync(targetSubagentsJson, "utf8");
          if (destContent === srcContent) {
            needsWrite = false;
          }
        }

        if (needsWrite) {
          fs.writeFileSync(targetSubagentsJson, srcContent, "utf8");
          result.synced.push("subagents.json");
        } else {
          result.skipped.push("subagents.json");
        }
      } catch (err) {
        result.errors.push(`Error al sincronizar subagents.json: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    result.errors.push(`Fallo general en syncDcAgents: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}

/**
 * Sincroniza de forma recursiva e idempotente las skills empaquetadas en dc-pi
 * hacia el directorio global de skills de Pi (~/.pi/agent/skills/).
 * Cada skill es un directorio que contiene SKILL.md y archivos accesorios.
 */
export function syncDcSkills(
  sourceDir: string = getDcBundledSkillsDir(),
  targetDir: string = getPiTargetSkillsDir(),
): DcAgentsSyncResult {
  const result: DcAgentsSyncResult = {
    synced: [],
    skipped: [],
    errors: [],
  };

  try {
    if (!fs.existsSync(sourceDir)) {
      result.errors.push(`Directorio de skills fuente no encontrado: ${sourceDir}`);
      return result;
    }

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
    const skillDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

    for (const skillName of skillDirs) {
      const srcSkillPath = path.join(sourceDir, skillName);
      const destSkillPath = path.join(targetDir, skillName);

      try {
        let skillHadUpdates = false;

        if (!fs.existsSync(destSkillPath)) {
          fs.mkdirSync(destSkillPath, { recursive: true });
        }

        const skillFiles = fs.readdirSync(srcSkillPath);

        for (const file of skillFiles) {
          const srcFilePath = path.join(srcSkillPath, file);
          const destFilePath = path.join(destSkillPath, file);

          const stat = fs.statSync(srcFilePath);
          if (stat.isFile()) {
            const srcContent = fs.readFileSync(srcFilePath, "utf8");
            let needsWrite = true;
            if (fs.existsSync(destFilePath)) {
              const destContent = fs.readFileSync(destFilePath, "utf8");
              if (destContent === srcContent) {
                needsWrite = false;
              }
            }

            if (needsWrite) {
              fs.writeFileSync(destFilePath, srcContent, "utf8");
              skillHadUpdates = true;
            }
          }
        }

        if (skillHadUpdates) {
          result.synced.push(skillName);
        } else {
          result.skipped.push(skillName);
        }
      } catch (err) {
        result.errors.push(`Error al sincronizar skill ${skillName}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    result.errors.push(`Fallo general en syncDcSkills: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}
