/**
 * src/features/dc-ice/core/dc-ice-carry-debt.ts — Auditor de Carry Debt e Inventario No Solicitado.
 * Directiva: Kapil Viren Ahuja (Deferred Ledger / Carry Debt) & Directivas Universales DC Studio.
 */

export interface CarryDebtFinding {
  rule: "premature-abstraction" | "locked-config-mutation" | "zero-omission-violation" | "unsolicited-bloat";
  severity: "high" | "medium" | "low";
  file: string;
  snippet: string;
  message: string;
  recommendation: string;
}

export interface CarryDebtOptions {
  constraints?: string[];
  allowConfigChanges?: boolean;
}

export interface CarryDebtReport {
  hasCarryDebt: boolean;
  score: number; // 0 a 100
  findings: CarryDebtFinding[];
  summary: string;
}

const PREMATURE_ABSTRACTION_REGEX =
  /\b(class|interface|type)\s+([A-Za-z0-9_]*(Factory|Singleton|Manager|Provider|Registry|Wrapper|Adapter|HandlerBridge)[A-Za-z0-9_]*)/;

const ELISION_COMMENT_REGEX =
  /(?:\/\/\s*(TODO:|TODO|implement|placeholder)|\/\*[\s\S]*?(rest\s+unchanged|code\s+unchanged|rest\s+of\s+code)[\s\S]*?\*\/|\/\/\s*(rest\s+unchanged|code\s+unchanged|rest\s+of\s+code))/i;

const LOCKED_CONFIG_FILES = [
  "tsconfig.json",
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "bun.lockb",
  "yarn.lock",
  "Dockerfile",
  "docker-compose",
  ".eslintrc",
  "eslint.config",
  ".prettierrc",
  ".env",
];

/**
 * Audita las líneas agregadas de un git diff en busca de deuda de arrastre (Carry Debt):
 * sobreingeniería prematura, stubs omitidos y mutaciones de configuración no solicitadas.
 */
export function auditCarryDebt(gitDiff: string, options: CarryDebtOptions = {}): CarryDebtReport {
  const findings: CarryDebtFinding[] = [];
  const lines = gitDiff.split(/\r?\n/);

  let currentFile = "unknown";
  const { allowConfigChanges = false } = options;

  for (const line of lines) {
    // Rastrear archivo actual en el diff
    if (line.startsWith("diff --git a/")) {
      const match = line.match(/^diff --git a\/(.+?) b\/(.+?)$/);
      if (match) {
        currentFile = match[2];

        // Verificar si el archivo tocado es de configuración bloqueada
        if (!allowConfigChanges) {
          const isLockedConfig = LOCKED_CONFIG_FILES.some((cfg) =>
            currentFile.toLowerCase().includes(cfg.toLowerCase()),
          );
          if (isLockedConfig) {
            findings.push({
              rule: "locked-config-mutation",
              severity: "high",
              file: currentFile,
              snippet: line,
              message: `Modificación de archivo de configuración bloqueado ('${currentFile}').`,
              recommendation:
                "Prohibido alterar configs de build, linters, docker o lockfiles como solución lateral. Mantenlos estrictamente bloqueados.",
            });
          }
        }
      }
      continue;
    }

    // Solo inspeccionamos líneas añadidas, ignorando las líneas meta de git (+++)
    if (line.startsWith("+") && !line.startsWith("+++")) {
      const addedText = line.substring(1).trim();

      // 1. Detectar abstracciones prematuras (Factories, Managers, Providers en código nuevo)
      const absMatch = addedText.match(PREMATURE_ABSTRACTION_REGEX);
      if (absMatch) {
        findings.push({
          rule: "premature-abstraction",
          severity: "medium",
          file: currentFile,
          snippet: addedText,
          message: `Patrón de sobreingeniería detectado ('${absMatch[2]}'). Abstracción prematura que genera Carry Debt.`,
          recommendation:
            "Aplica KISS/YAGNI y la Regla de Tres. No crees fábricas o managers a menos que la lógica ya se repita en 3 o más lugares independientes.",
        });
      }

      // 2. Detectar comentarios elisivos o placeholders (TODO, rest unchanged)
      const elisionMatch = addedText.match(ELISION_COMMENT_REGEX);
      if (elisionMatch) {
        findings.push({
          rule: "zero-omission-violation",
          severity: "high",
          file: currentFile,
          snippet: addedText,
          message: `Comentario elisivo o incompleto detectado: "${elisionMatch[0]}". Viola la directiva de integridad Zero-Omission.`,
          recommendation:
            "Entrega código 100% completo, ejecutable y en producción. Nunca dejes TODOs o comentarios elisivos en lugar de código funcional.",
        });
      }
    }
  }

  // Deduplicar hallazgos idénticos en el mismo archivo
  const uniqueFindings: CarryDebtFinding[] = [];
  const seen = new Set<string>();
  for (const f of findings) {
    const key = `${f.rule}:${f.file}:${f.snippet}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueFindings.push(f);
    }
  }

  const hasCarryDebt = uniqueFindings.length > 0;
  const score = Math.max(0, 100 - uniqueFindings.length * 15);

  const summary = hasCarryDebt
    ? `⚠️ Se detectaron ${uniqueFindings.length} patrones de Carry Debt / Inventario No Solicitado en el diff.`
    : `✅ Diff limpio de Carry Debt. Sin sobreingeniería prematura ni violaciones de integridad.`;

  return {
    hasCarryDebt,
    score,
    findings: uniqueFindings,
    summary,
  };
}
