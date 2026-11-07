/**
 * test/dc-ice-context-meter.test.ts — Suite de pruebas para Monitor Estático/Dinámico y Límite Cognitivo.
 * Directivas: Google Cloud AI SDLC (Addy Osmani) & Triángulo de Hierro Agéntico (Kapil Viren Ahuja).
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeContextSplit,
  evaluateCognitiveLoad,
  type ContextSplitMetrics,
  type CognitiveLoadStatus,
} from "../src/features/dc-ice/core/dc-ice-context-meter.ts";

test("dc-ice context-meter: analiza correctamente el desglose estático vs dinámico de tokens", () => {
  const metrics: ContextSplitMetrics = analyzeContextSplit({
    systemPromptChars: 12000, // ~3000 tokens
    toolsSchemaChars: 20000,  // ~5000 tokens
    chatHistoryChars: 40000,  // ~10000 tokens
    skillsChars: 8000,        // ~2000 tokens
    contextWindowLimit: 200000,
  });

  assert.equal(metrics.staticTokens, 8000, "Tokens estáticos = systemPrompt + tools");
  assert.equal(metrics.dynamicTokens, 12000, "Tokens dinámicos = chatHistory + skills");
  assert.equal(metrics.totalTokens, 20000);
  assert.equal(metrics.staticRatioPercent, 40);
  assert.equal(metrics.dynamicRatioPercent, 60);
  assert.equal(metrics.contextRotAlert, false, "Bajo 60% de la ventana no debe emitir alerta de Context Rot");
});

test("dc-ice context-meter: dispara alerta de Context Rot cuando el contexto dinámico excede el 60% de la ventana útil", () => {
  const metrics = analyzeContextSplit({
    systemPromptChars: 8000,   // ~2000 tokens
    toolsSchemaChars: 8000,    // ~2000 tokens
    chatHistoryChars: 500000,  // ~125000 tokens (125k / 200k = 62.5%)
    contextWindowLimit: 200000,
  });

  assert.equal(metrics.contextRotAlert, true, "Debe alertar sobre Context Rot");
  assert.ok(metrics.recommendations.some((r) => r.includes("Context Rot") || r.includes("checkpoint") || r.includes("handoff")));
});

test("dc-ice context-meter: evaluateCognitiveLoad permite concurrencia normal dentro del umbral", () => {
  const status: CognitiveLoadStatus = evaluateCognitiveLoad({
    activeSubagents: 1,
    unreadInboxReports: 0,
    maxConcurrentAttention: 2,
  });

  assert.equal(status.ceilingReached, false);
  assert.equal(status.status, "optimal");
  assert.equal(status.warnings.length, 0);
});

test("dc-ice context-meter: evaluateCognitiveLoad advierte techo cognitivo cuando se acumulan tareas pendientes de revisión", () => {
  const status = evaluateCognitiveLoad({
    activeSubagents: 4,
    unreadInboxReports: 3,
    maxConcurrentAttention: 2,
  });

  assert.equal(status.ceilingReached, true);
  assert.equal(status.status, "cognitive_overload");
  assert.ok(
    status.warnings.some((w) => w.includes("techo cognitivo") || w.includes("Cognitive Overload") || w.includes("inbox")),
    `Esperaba advertencia de sobrecarga cognitiva, recibido: ${status.warnings.join(", ")}`,
  );
});
