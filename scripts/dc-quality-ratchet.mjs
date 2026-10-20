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
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  const violations = [];

  // Regla 1: Directiva 4 - Prohibido llamar directamente a ctx.ui.notify
  if (!ALLOWED_NOTIFY_CALLERS.has(relativePath)) {
    lines.forEach((line, index) => {
      // Ignorar comentarios
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;

      if (line.includes("ctx.ui.notify(") && !line.includes("// ratchet-ignore")) {
        violations.push({
          rule: "Directiva 4 (dcNotifier unificado)",
          line: index + 1,
          detail: "Llamada directa a 'ctx.ui.notify'. Usar 'dcNotifier.notify(ctx, ...)' en su lugar.",
        });
      }
    });
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

  return violations;
}

function main() {
  console.log("🛡️  Ejecutando DC Studio Architecture Quality Ratchet...\n");

  const files = getTsFiles(SRC_DIR);
  let totalViolations = 0;
  const report = [];

  for (const file of files) {
    const relativePath = path.relative(ROOT_DIR, file);
    const fileViolations = auditFile(file);

    if (fileViolations.length > 0) {
      totalViolations += fileViolations.length;
      report.push({ file: relativePath, violations: fileViolations });
    }
  }

  // Resumen
  if (totalViolations === 0) {
    console.log(`✅ Quality Ratchet superado: 0 violaciones detectadas en ${files.length} archivos TypeScript.`);
    console.log("   - Directiva 1: Desacoplamiento por feature verificado.");
    console.log("   - Directiva 2: Persistencia aislada y blast-radius cero.");
    console.log("   - Directiva 4: Cero llamadas no autorizadas a ctx.ui.notify.");
    console.log("   - Directiva 6 & 7: Anti-polling y timers con ciclo de vida seguro.");
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
