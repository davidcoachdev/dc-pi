/**
 * src/features/dc-ice/ice-validator.ts — Motor de Validación de Intent (ICE Gate).
 * Aplica formalmente las directivas de Kapil Viren Ahuja & Google Cloud AI SDLC.
 */

import type { IceIntent, IceValidationResult } from "./types.ts";

const CONJUNCTION_REGEX = /\b(and|y|e|as well as|además de|ademas de)\b/i;
const TECH_IN_GOAL_REGEX = /\b(Go|Golang|Node|Node\.js|Python|React|Vue|Angular|PostgreSQL|Postgres|MySQL|Redis|MongoDB|gRPC|GraphQL|Express|Envoy|FastAPI|Django|Flask|Spring Boot|Kafka|RabbitMQ)\b|\.(ts|js|go|py|rs|java|cpp|cs)\b/i;
const FAILURE_IN_CONSTRAINT_REGEX = /\b(coverage|test coverage|unit test|build fails?|lint(ing)?|sonar(qube)?|quality gate)\b/i;
const EXPERIMENT_OR_NOBODY_REGEX = /\b(nobody|nadie|no one|ninguno|just experimenting|solo experimentando|nada en particular|nobody in particular)\b/i;

export function validateIceIntent(raw: unknown): IceValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const remediation: string[] = [];

  if (!raw || typeof raw !== "object") {
    return {
      valid: false,
      errors: ["El Intent debe ser un objeto estructurado."],
      warnings: [],
      suggestedRemediation: ["Provee un objeto JSON con los campos 'goal', 'constraints', 'failureConditions' y 'manualBrake'."],
    };
  }

  const obj = raw as Record<string, any>;

  // 1. Validación del Goal
  const goal = typeof obj.goal === "string" ? obj.goal.trim() : "";
  if (!goal) {
    errors.push("El campo 'goal' es obligatorio y no puede estar vacío.");
    remediation.push("Escribe el objetivo principal en una sola oración concisa en lenguaje de negocio.");
  } else {
    // Verificar si hay múltiples oraciones
    const sentences = goal.split(/(?<=[.?!])\s+/).filter(Boolean);
    if (sentences.length > 1) {
      errors.push("El 'goal' debe ser exactamente una sola oración. Si requiere múltiples oraciones, divide en Intents separados.");
    }

    // Verificar conjunciones copulativas que unan múltiples metas
    if (CONJUNCTION_REGEX.test(goal)) {
      errors.push("El 'goal' no debe contener conjunciones copulativas ('and', 'y') que unan múltiples objetivos. Cada meta debe ser un Intent atómico.");
      remediation.push("Separa el objetivo en dos Intents independientes sin la conjunción.");
    }

    // Test de las 2 implementaciones: el Goal no debe atar tecnologías ni arquitecturas internas
    const techMatch = goal.match(TECH_IN_GOAL_REGEX);
    if (techMatch) {
      errors.push(`Violación del test de 2 implementaciones: El 'goal' pre-fija tecnologías o arquitecturas (${techMatch[0]}). Las herramientas y stacks pertenecen al 'Context' del harness, no al Goal del Intent.`);
      remediation.push(`Reformula el Goal enfocándote exclusivamente en el resultado para el usuario/negocio, moviendo '${techMatch[0]}' al Context.`);
    }
  }

  // 2. Validación de Constraints
  const constraints = Array.isArray(obj.constraints)
    ? obj.constraints.map((c) => String(c).trim()).filter(Boolean)
    : [];

  if (constraints.length < 3) {
    errors.push(`Se requieren al menos 3 constraints direccionales (ideal 3 a 5). Se recibieron ${constraints.length}.`);
    remediation.push("Define entre 3 y 5 cualidades obligatorias no funcionales (latencia SLO, concurrencia, accesibilidad, estándares de seguridad).");
  } else if (constraints.length > 7) {
    errors.push(`Sobre-especificación detectada: Máximo 7 constraints permitidas. Se recibieron ${constraints.length}. Superar 7 convierte el Intent en un spec monolítico SDD.`);
    remediation.push("Poda las restricciones a las 3-5 cualidades irreducibles del resultado; traslada patrones estándar de la organización al Context.");
  }

  // Detección de inversión: Failure Condition en slot de Constraint
  for (const c of constraints) {
    if (FAILURE_IN_CONSTRAINT_REGEX.test(c)) {
      warnings.push(`Inversión de roles detectada en Constraint: "${c}". Las métricas de cobertura y estados de compilación son comprobaciones post-output (Failure Conditions), no restricciones direccionales de diseño.`);
    }
  }

  // 3. Validación de Failure Conditions
  const failureConditions = Array.isArray(obj.failureConditions)
    ? obj.failureConditions.map((f) => String(f).trim()).filter(Boolean)
    : [];

  if (failureConditions.length < 3) {
    errors.push(`Se requieren al menos 3 failure conditions binarias post-output (ideal 3 a 5). Se recibieron ${failureConditions.length}.`);
    remediation.push("Define al menos 3 condiciones observables que disparen fallo automático (ej: 'Build fails', 'Unit test coverage drops below 90%', 'Lint reports errors', 'Secrets in code').");
  } else if (failureConditions.length > 7) {
    errors.push(`Máximo 7 failure conditions permitidas. Se recibieron ${failureConditions.length}.`);
  }

  // 4. Validación del Freno Manual (Manual Brake)
  const manualBrake = obj.manualBrake;
  if (!manualBrake || typeof manualBrake !== "object") {
    errors.push("El bloque 'manualBrake' es innegociable antes de autorizar gasto de tokens.");
    remediation.push("Añade 'manualBrake' con 'whoNeedsThis', 'costIfOneWeekDevs' y 'refusalOwner'.");
  } else {
    const whoNeedsThis = typeof manualBrake.whoNeedsThis === "string" ? manualBrake.whoNeedsThis.trim() : "";
    const refusalOwner = typeof manualBrake.refusalOwner === "string" ? manualBrake.refusalOwner.trim() : "";

    if (!whoNeedsThis) {
      errors.push("Freno Manual: El campo 'whoNeedsThis' es obligatorio.");
    } else if (EXPERIMENT_OR_NOBODY_REGEX.test(whoNeedsThis)) {
      errors.push("Freno Manual: Si la respuesta honesta a 'whoNeedsThis' es 'nadie' o 'un experimento', no debe autorizarse como código de producción. Trátalo como prototipo aislado sin pipeline productivo.");
    }

    if (!refusalOwner) {
      errors.push("Freno Manual: El campo 'refusalOwner' (dueño de la negativa / autoridad para decir NO) es obligatorio.");
      remediation.push("Nombra al rol o persona responsable con la potestad de rechazar o detener esta tarea.");
    }

    if (manualBrake.costIfOneWeekDevs === false) {
      warnings.push("Freno Manual: Si no se construiría costando 1 semana de desarrolladores senior, evalúa si es una feature innecesaria generada solo porque los tokens son baratos.");
    }
  }

  const valid = errors.length === 0;

  const result: IceValidationResult = {
    valid,
    errors,
    warnings,
  };

  if (valid) {
    result.intent = {
      goal,
      constraints,
      failureConditions,
      manualBrake: {
        whoNeedsThis: manualBrake.whoNeedsThis,
        costIfOneWeekDevs: manualBrake.costIfOneWeekDevs,
        refusalOwner: manualBrake.refusalOwner,
      },
    };
  }

  if (remediation.length > 0) {
    result.suggestedRemediation = remediation;
  }

  return result;
}
