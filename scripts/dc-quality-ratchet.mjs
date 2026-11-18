#!/usr/bin/env node
/**
 * DC Studio Architecture Quality Ratchet
 *
 * Audita estáticamente el código fuente de src/ contra las 10 directivas
 * obligatorias de arquitectura de DC Studio (dc-pi), adaptando el patrón
 * de "Quality Ratchet" de Google Artemis para prevenir regresiones en CI.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const SRC_DIR = path.join(ROOT_DIR, "src");

// Archivos excluidos de reglas específicas por ser la capa de integración base
const ALLOWED_NOTIFY_CALLERS = new Set([
  path.normalize("src/integrations/dc-notify/dc-notifier.ts"),
  path.normalize("src/integrations/dc-notify/dc-core-patches.ts"),
]);

// Baseline de deuda técnica heredada (ratchet: bloquea nuevas violaciones, permite reducir pero nunca aumentar)
const LEGACY_NOTIFY_BASELINE = new Map([
  [path.normalize("src/features/dc-ice/dc-ice-extension.ts"), 5],
]);

/**
 * Escanea recursivamente todos los archivos .ts de un directorio
 */
function getTsFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      if (file !== "node_modules" && file !== ".test-build" && file !== "dist") {
        results = results.concat(getTsFiles(fullPath));
      }
    } else if (file.endsWith(".ts") && !file.endsWith(".d.ts")) {
      results.push(fullPath);
    }
  }
  return results;
}

function auditFile(filePath) {
  const relativePath = path.normalize(path.relative(ROOT_DIR, filePath));
  const posixRelPath = relativePath.replace(/\\/g, "/");
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  const violations = [];
  const advisories = [];

  const featureMatch = posixRelPath.match(/^src\/features\/([^/]+)\//);
  const ownFeature = featureMatch ? featureMatch[1] : null;

  // Regla 1: Directiva 4 - Prohibido llamar directamente a ctx.ui.notify o ctx.ui?.notify
  if (!ALLOWED_NOTIFY_CALLERS.has(relativePath)) {
    const fileNotifyHits = [];
    lines.forEach((line, index) => {
      // Ignorar comentarios
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;

      if (/\bctx\.ui(?:\?\.)?\.?notify(?:\?\.)?\s*\(/.test(line) && !line.includes("// ratchet-ignore")) {
        fileNotifyHits.push({
          rule: "Directiva 4 (dcNotifier unificado)",
          line: index + 1,
          detail: "Llamada directa a 'ctx.ui.notify' / 'ctx.ui?.notify'. Usar 'dcNotifier.notify(ctx, ...)' en su lugar.",
        });
      }
    });

    const allowedLegacyCount = LEGACY_NOTIFY_BASELINE.get(relativePath) ?? 0;
    if (fileNotifyHits.length > allowedLegacyCount) {
      violations.push(...fileNotifyHits);
    } else if (fileNotifyHits.length > 0) {
      advisories.push(...fileNotifyHits);
    }
  }

  // Regla 2: Directiva 2 - Blast radius cero en persistencia
  // Detecta intentos de escribir o resolver config vieja tipo ~/.pi/agent/dc-<feature>.json
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;

    if (
      line.match(/["']\.pi\/agent\/dc-[^s]/) &&
      !line.includes("resolveDcConfigPath") &&
      !line.includes("oldPath") &&
      !line.includes("legacy") &&
      !line.includes("// ratchet-ignore")
    ) {
      violations.push({
        rule: "Directiva 2 (Persistencia aislada)",
        line: index + 1,
        detail: "Ruta de config sin migrar o monolítica fuera de ~/.pi/agent/dc-studio/.",
      });
    }
  });

  // Regla 3: Directiva 6 & 7 - Timers con ciclo de vida seguro (.unref y clearInterval)
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;

    if (/\bsetInterval\s*\(/.test(line) && !line.includes("// ratchet-ignore")) {
      const windowLines = lines.slice(index, Math.min(lines.length, index + 30)).join("\n");
      const hasUnref = windowLines.includes(".unref");
      const hasClearInterval = content.includes("clearInterval");
      if (!hasUnref || !hasClearInterval) {
        violations.push({
          rule: "Directiva 6 & 7 (Ciclo de vida de timers)",
          line: index + 1,
          detail: "Uso de 'setInterval' sin '.unref()' cercano o sin 'clearInterval' de limpieza en el módulo.",
        });
      }
    }
  });

  // Regla 4 (Advisory): Directiva 1 - Acoplamiento cruzado entre features
  if (ownFeature) {
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;

      const importMatch = line.match(/(?:from|import\s*\()\s*["']([^"']+)["']/);
      if (importMatch && importMatch[1].startsWith(".")) {
        const resolvedTarget = path.posix.normalize(path.posix.join(path.posix.dirname(posixRelPath), importMatch[1]));
        const targetFeatureMatch = resolvedTarget.match(/^src\/features\/([^/]+)\//);
        if (targetFeatureMatch && targetFeatureMatch[1] !== ownFeature && !line.includes("// ratchet-ignore")) {
          advisories.push({
            rule: "Directiva 1 (Acoplamiento entre features)",
            line: index + 1,
            detail: `${ownFeature} importa desde ${targetFeatureMatch[1]} (${importMatch[1]})`,
          });
        }
      }
    });
  }

  return { violations, advisories, crossFeatureCount: advisories.filter((a) => a.rule.startsWith("Directiva 1")).length, legacyNotifyCount: advisories.filter((a) => a.rule.startsWith("Directiva 4")).length };
}

function main() {
  console.log("🛡️  Ejecutando DC Studio Architecture Quality Ratchet...\n");

  const files = getTsFiles(SRC_DIR);
  let totalViolations = 0;
  let totalCrossFeatureAdvisories = 0;
  let totalLegacyNotifyAdvisories = 0;
  const report = [];

  for (const file of files) {
    const relativePath = path.relative(ROOT_DIR, file);
    const { violations: fileViolations, crossFeatureCount, legacyNotifyCount } = auditFile(file);
    totalCrossFeatureAdvisories += crossFeatureCount;
    totalLegacyNotifyAdvisories += legacyNotifyCount;

    if (fileViolations.length > 0) {
      totalViolations += fileViolations.length;
      report.push({ file: relativePath, violations: fileViolations });
    }
  }

  // Resumen
  if (totalViolations === 0) {
    console.log(`✅ Quality Ratchet superado: 0 violaciones bloqueantes detectadas en ${files.length} archivos TypeScript.`);
    console.log("   - Directiva 2: Persistencia aislada en dc-studio/ verificada (0 rutas legacy sueltas).");
    console.log(
      `   - Directiva 4: Cero nuevas llamadas a ctx.ui(.?).notify (${totalLegacyNotifyAdvisories} en baseline heredado).`,
    );
    console.log("   - Directiva 6 & 7: Todos los setInterval cuentan con .unref() y clearInterval.");
    console.log(`   - Directiva 1 (Advisory): ${totalCrossFeatureAdvisories} importación(es) cruzada(s) entre features monitoreadas.`);
    process.exit(0);
  } else {
    console.error(`❌ Quality Ratchet falló: ${totalViolations} violaciones de directivas encontradas:\n`);
    for (const item of report) {
      console.error(`📄 ${item.file}:`);
      for (const v of item.violations) {
        console.error(`   Línea ${v.line} [${v.rule}]: ${v.detail}`);
      }
      console.error("");
    }
    process.exit(1);
  }
}

main();
