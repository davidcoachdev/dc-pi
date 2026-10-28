export interface CanonicalFailureInput {
  taskTitleOrSummary: string;
  error: unknown;
  rootCause?: string;
  falsifiedPremises?: string[];
  recoverySteps?: string[];
  diagnostics?: Record<string, unknown>;
}

export interface CanonicalFailureReport {
  summary: string;
  rootCause: string;
  falsifiedPremises: string[];
  recoverySteps: string[];
  rawError?: string;
  formattedMarkdown: string;
}

/**
 * Genera el informe canónico y estructurado ante fallos de células o subagentes.
 * Cumple estrictamente con las Directivas de Ingeniería de DC Studio:
 * 1. Resumen conciso del error.
 * 2. Causa raíz comprobable (evidencia observable).
 * 3. Premisas falsadas explícitas.
 * 4. Pasos de recuperación orientados a la acción.
 */
export function formatCanonicalFailureReport(input: CanonicalFailureInput): CanonicalFailureReport {
  const rawError = input.error instanceof Error
    ? input.error.message
    : typeof input.error === "string"
    ? input.error
    : JSON.stringify(input.error || "Unknown error");

  const summary = input.taskTitleOrSummary.trim();
  const rootCause = (input.rootCause || rawError).trim();
  const falsifiedPremises = input.falsifiedPremises && input.falsifiedPremises.length > 0
    ? input.falsifiedPremises
    : ["La tarea o herramienta se completaría sin excepciones en el tiempo límite."];
  const recoverySteps = input.recoverySteps && input.recoverySteps.length > 0
    ? input.recoverySteps
    : [
        "Verificar los logs del proceso hijo mediante subagent_result o el monitor de tareas.",
        "Reintentar la operación con un alcance más acotado o herramientas aisladas.",
      ];

  const mdLines: string[] = [
    `### ❌ Informe Canónico de Fallo: ${summary}`,
    "",
    `**1. Error Observado:**`,
    `\`\`\``,
    rawError,
    `\`\`\``,
    "",
    `**2. Causa Raíz Detectada:**`,
    rootCause,
    "",
    `**3. Premisas Falsadas:**`,
    ...falsifiedPremises.map((p) => `- ❗ ${p}`),
    "",
    `**4. Pasos Sugeridos de Recuperación:**`,
    ...recoverySteps.map((s, idx) => `${idx + 1}. ${s}`),
  ];

  if (input.diagnostics && Object.keys(input.diagnostics).length > 0) {
    mdLines.push("");
    mdLines.push(`**5. Diagnósticos de Contexto:**`);
    mdLines.push("```json");
    mdLines.push(JSON.stringify(input.diagnostics, null, 2));
    mdLines.push("```");
  }

  return {
    summary,
    rootCause,
    falsifiedPremises,
    recoverySteps,
    rawError,
    formattedMarkdown: mdLines.join("\n"),
  };
}
