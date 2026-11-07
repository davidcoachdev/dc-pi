/**
 * test/dc-ice-double-blind.test.ts — Suite de pruebas para Doble Agente Ciego (Builder vs. Validator)
 * Directiva: Kapil Viren Ahuja (IDSD / Compartmentalized Anti-Reward Hacking).
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  prepareBlindExecutionPack,
  evaluateDoubleBlindRun,
  type DoubleBlindConfig,
} from "../src/features/dc-ice/core/dc-ice-double-blind.ts";
import type { IceIntent } from "../src/features/dc-ice/types.ts";

test("dc-ice double-blind: prepareBlindExecutionPack aísla y oculta failure conditions y evals al builder", () => {
  const intent: IceIntent = {
    goal: "Implement token bucket rate limiter.",
    constraints: [
      "Limit to 100 requests per minute per IP.",
      "Thread-safe atomic counters.",
      "Zero external database dependencies (in-memory).",
    ],
    failureConditions: [
      "Burst of 101 requests succeeds.",
      "Race condition under 50 concurrent threads.",
      "Memory leak exceeding 10MB after 10,000 iterations.",
    ],
    manualBrake: {
      whoNeedsThis: "API Gateway team protecting ingress from abusive traffic.",
      costIfOneWeekDevs: true,
      refusalOwner: "Principal SRE",
    },
  };

  const pack = prepareBlindExecutionPack({
    intent,
    evalScript: "npm test test/rate-limiter.test.ts",
    testFiles: ["test/rate-limiter.test.ts"],
  });

  // Builder solo ve el Goal y Constraints
  assert.equal(pack.builderPayload.goal, intent.goal);
  assert.deepEqual(pack.builderPayload.constraints, intent.constraints);
  assert.equal((pack.builderPayload as any).failureConditions, undefined, "El builder NO debe tener acceso a las Failure Conditions");
  assert.equal((pack.builderPayload as any).evalScript, undefined, "El builder NO debe tener acceso al script de evals");

  // El contexto del builder no debe listar las rutas de los archivos de prueba
  assert.ok(
    !pack.builderPayload.instructionPrompt.includes("Burst of 101 requests succeeds"),
    "La instrucción del builder no debe fugar las condiciones de fallo exactas",
  );
  assert.ok(
    !pack.builderPayload.instructionPrompt.includes("test/rate-limiter.test.ts"),
    "La instrucción del builder no debe fugar los archivos de test ocultos",
  );

  // Validator sí tiene las Failure Conditions y el script de comprobación
  assert.deepEqual(pack.validatorPayload.failureConditions, intent.failureConditions);
  assert.equal(pack.validatorPayload.evalScript, "npm test test/rate-limiter.test.ts");
});

test("dc-ice double-blind: evaluateDoubleBlindRun otorga veredicto PASS si el validador sale con código 0", () => {
  const verdict = evaluateDoubleBlindRun({
    builderOutcome: {
      success: true,
      modifiedFiles: ["src/rate-limiter.ts"],
      diffStat: "1 file changed, 45 insertions(+)",
    },
    validatorOutcome: {
      exitCode: 0,
      stdout: "✔ rate limiter blocks 101st request\n✔ 50 concurrent workers pass\nTests: 2 passed",
      stderr: "",
    },
    intent: {
      goal: "Implement rate limiter.",
      constraints: ["100 req/min."],
      failureConditions: ["Burst succeeds."],
      manualBrake: { whoNeedsThis: "SRE", costIfOneWeekDevs: true, refusalOwner: "Lead" },
    },
  });

  assert.equal(verdict.passed, true);
  assert.equal(verdict.rewardHackingSuspected, false);
  assert.ok(verdict.summary.includes("✅ VEREDICTO CIEGO: APROBADO"));
});

test("dc-ice double-blind: detecta sospecha de Reward Hacking si el builder intentó modificar archivos de test del validador", () => {
  const verdict = evaluateDoubleBlindRun({
    builderOutcome: {
      success: true,
      modifiedFiles: ["src/rate-limiter.ts", "test/rate-limiter.test.ts"], // ¡El builder tocó el test!
      diffStat: "2 files changed, 50 insertions(+), 10 deletions(-)",
    },
    validatorOutcome: {
      exitCode: 0,
      stdout: "Tests: 2 passed",
      stderr: "",
    },
    hiddenTestFiles: ["test/rate-limiter.test.ts"],
    intent: {
      goal: "Implement rate limiter.",
      constraints: ["100 req/min."],
      failureConditions: ["Burst succeeds."],
      manualBrake: { whoNeedsThis: "SRE", costIfOneWeekDevs: true, refusalOwner: "Lead" },
    },
  });

  assert.equal(verdict.passed, false, "Debe RECHAZAR la entrega si el builder alteró los tests ocultos");
  assert.equal(verdict.rewardHackingSuspected, true);
  assert.ok(
    verdict.reasons.some((r) => r.includes("Reward Hacking") || r.includes("test")),
    `Esperaba advertencia de Reward Hacking, recibido: ${verdict.reasons.join(", ")}`,
  );
});

test("dc-ice double-blind: devuelve retroalimentación abstracta al builder sin revelar el código del test ante fallo", () => {
  const verdict = evaluateDoubleBlindRun({
    builderOutcome: {
      success: true,
      modifiedFiles: ["src/rate-limiter.ts"],
      diffStat: "1 file changed, 30 insertions(+)",
    },
    validatorOutcome: {
      exitCode: 1,
      stdout: "✖ fail at test/rate-limiter.test.ts:25: expected 429, got 200",
      stderr: "AssertionError: 200 == 429",
    },
    intent: {
      goal: "Implement rate limiter.",
      constraints: ["100 req/min."],
      failureConditions: ["Burst of 101 requests succeeds."],
      manualBrake: { whoNeedsThis: "SRE", costIfOneWeekDevs: true, refusalOwner: "Lead" },
    },
  });

  assert.equal(verdict.passed, false);
  // La retroalimentación para el builder debe resumir qué restricción no se satisfizo, sin volcar el stack trace que incite a hardcodear
  assert.ok(verdict.feedbackForBuilder);
  assert.ok(verdict.feedbackForBuilder.includes("revisa las Constraints"));
  assert.ok(!verdict.feedbackForBuilder.includes("test/rate-limiter.test.ts:25"), "No debe filtrar líneas exactas del test interno");
});
