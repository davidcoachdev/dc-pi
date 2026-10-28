import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateSubagentQueryRouting, type SubagentQuery } from "../src/features/dc-agents/core/dc-subagent-handshake.ts";

test("dc-subagent-handshake: enruta consultas técnicas autónomamente al padre sin molestar al usuario", () => {
  const technicalQuery: SubagentQuery = {
    taskId: "task-01",
    requestId: "req-1",
    message: "¿Dónde se encuentra la definición del tipo DcTaxiQuotaInfo en el proyecto?",
    kind: "technical_context",
    timestamp: Date.now(),
  };

  const decision = evaluateSubagentQueryRouting(technicalQuery);
  assert.equal(decision.destination, "parent_auto_reply");
  assert.match(decision.reason, /respondida directamente por el orquestador padre/);
  assert.ok(decision.suggestedReply);
});

test("dc-subagent-handshake: eleva al usuario ante decisiones de producto o consentimiento destructivo", () => {
  const consentQuery: SubagentQuery = {
    taskId: "task-02",
    requestId: "req-2",
    message: "Se requiere autorizar borrado de la base de datos de producción",
    kind: "user_consent",
    timestamp: Date.now(),
  };

  const decision = evaluateSubagentQueryRouting(consentQuery);
  assert.equal(decision.destination, "bubble_to_user");
  assert.match(decision.reason, /decisión de producto o consentimiento explícito/);
});
