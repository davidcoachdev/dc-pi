/**
 * src/features/dc-ice/core/dc-ice-double-blind.ts — Motor de Evaluación Doble Ciega (Builder vs Validator).
 * Directiva: Kapil Viren Ahuja (IDSD / Compartmentalized Anti-Reward Hacking).
 */

import type { IceIntent } from "../types.ts";

export interface DoubleBlindConfig {
  intent: IceIntent;
  evalScript?: string;
  testFiles?: string[];
  contextFiles?: string[];
}

export interface BuilderExecutionPayload {
  goal: string;
  constraints: string[];
  contextFiles: string[];
  instructionPrompt: string;
}

export interface ValidatorExecutionPayload {
  failureConditions: string[];
  evalScript: string;
  testFiles: string[];
  instructionPrompt: string;
}

export interface BlindExecutionPack {
  builderPayload: BuilderExecutionPayload;
  validatorPayload: ValidatorExecutionPayload;
}

export interface BuilderRunOutcome {
  success: boolean;
  modifiedFiles: string[];
  diffStat: string;
  error?: string;
}

export interface ValidatorRunOutcome {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface DoubleBlindVerdict {
  passed: boolean;
  rewardHackingSuspected: boolean;
  reasons: string[];
  summary: string;
  feedbackForBuilder?: string;
}

/**
 * Prepara los paquetes aislados para el Constructor y el Validador.
 * Garantiza por diseño que el Constructor no reciba ni las Failure Conditions
 * ni las rutas de los archivos de prueba del evaluador.
 */
export function prepareBlindExecutionPack(config: DoubleBlindConfig): BlindExecutionPack {
  const { intent, evalScript = "npm test", testFiles = [], contextFiles = [] } = config;

  const builderPrompt = [
    `# DIRECTIVA IDSD: OBJETIVO DE CONSTRUCCIÓN A CIEGAS`,
    `\n## Goal`,
    intent.goal,
    `\n## Constraints Obligatorias de Negocio / SLO`,
    ...intent.constraints.map((c) => `- ${c}`),
    `\n## Directivas de Seguridad y Calidad:`,
    `- Implementa el comportamiento general respetando estrictamente todas las restricciones anteriores.`,
    `- Se auditará mediante un validador independiente a ciegas en un entorno aislado.`,
    `- Solo debes modificar código de producción en el workspace.`,
  ].join("\n");

  const validatorPrompt = [
    `# DIRECTIVA IDSD: AUDITORÍA A CIEGAS (VALIDATOR)`,
    `\n## Failure Conditions a Verificar`,
    ...intent.failureConditions.map((f) => `- ${f}`),
    `\n## Comando de Evaluación Determinista`,
    `\`${evalScript}\``,
  ].join("\n");

  return {
    builderPayload: {
      goal: intent.goal,
      constraints: [...intent.constraints],
      contextFiles: [...contextFiles],
      instructionPrompt: builderPrompt,
    },
    validatorPayload: {
      failureConditions: [...intent.failureConditions],
      evalScript,
      testFiles: [...testFiles],
      instructionPrompt: validatorPrompt,
    },
  };
}

/**
 * Evalúa los resultados combinados de la ejecución del Builder y del Validator.
 * Protege contra Reward Hacking (ej: modificar tests para pasar forzadamente).
 */
export function evaluateDoubleBlindRun(params: {
  builderOutcome: BuilderRunOutcome;
  validatorOutcome: ValidatorRunOutcome;
  intent: IceIntent;
  hiddenTestFiles?: string[];
}): DoubleBlindVerdict {
  const { builderOutcome, validatorOutcome, intent, hiddenTestFiles = [] } = params;
  const reasons: string[] = [];

  // 1. Detección de Reward Hacking: ¿El builder tocó archivos que pertenecían al validador?
  let rewardHackingSuspected = false;
  if (hiddenTestFiles.length > 0 && builderOutcome.modifiedFiles) {
    const tampered = builderOutcome.modifiedFiles.filter((f) =>
      hiddenTestFiles.some((hf) => f === hf || f.endsWith(hf) || hf.endsWith(f)),
    );
    if (tampered.length > 0) {
      rewardHackingSuspected = true;
      reasons.push(
        `Detección de Reward Hacking: El constructor modificó archivos de test reservados del evaluador (${tampered.join(", ")}). La validación a ciegas prohíbe alterar las pruebas.`,
      );
    }
  }

  // 2. Comprobación del constructor
  if (!builderOutcome.success) {
    reasons.push(`El constructor reportó error durante su ejecución: ${builderOutcome.error || "Fallo desconocido"}`);
  }

  // 3. Comprobación del validador (exit code gate)
  if (validatorOutcome.exitCode !== 0) {
    reasons.push(`El validador determinista falló con código de salida ${validatorOutcome.exitCode}.`);
  }

  const passed = reasons.length === 0 && !rewardHackingSuspected;

  let feedbackForBuilder: string | undefined;
  if (!passed) {
    // Sanitizar salida para no filtrar el stack trace interno o aserciones exactas que inviten a hardcodear
    feedbackForBuilder = [
      `La solución no superó la auditoría de calidad a ciegas.`,
      `Por favor revisa las Constraints del Intent y asegúrate de que el caso general funcione sin supuestos asumidos.`,
      `El validador encontró inconsistencias con las restricciones esperadas del sistema.`,
    ].join(" ");
  }

  const summary = passed
    ? `✅ VEREDICTO CIEGO: APROBADO (Tests deterministas exitosos en salida del builder)`
    : `❌ VEREDICTO CIEGO: RECHAZADO (${reasons.join(" | ")})`;

  return {
    passed,
    rewardHackingSuspected,
    reasons,
    summary,
    feedbackForBuilder,
  };
}
