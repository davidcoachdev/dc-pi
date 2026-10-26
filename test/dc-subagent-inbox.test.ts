import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCanonicalFailureReport } from "../src/features/dc-agents/core/dc-subagent-failure-formatter.ts";
import {
  subagentInboxManager,
  installSubagentInboxInterceptor,
  uninstallSubagentInboxInterceptor,
  type BackgroundTaskReport,
} from "../src/features/dc-agents/core/dc-subagent-inbox.ts";

test("dc-subagent-failure-formatter: genera reporte estructurado canónico", () => {
  const report = formatCanonicalFailureReport({
    taskTitleOrSummary: "Auditoría de dependencias en repo externo",
    error: new Error("ETIMEDOUT: connect to api.github.com:443 timed out"),
    rootCause: "El runner excedió el tiempo límite de red de 30 segundos sin conectividad.",
    falsifiedPremises: [
      "El proxy o socket de red estaba disponible de forma irrestricta en el subproceso.",
    ],
    recoverySteps: [
      "Reintentar con timeout extendido o proxy local.",
      "Aislar la descarga y usar archivos de fixture locales.",
    ],
    diagnostics: { host: "api.github.com", port: 443 },
  });

  assert.equal(report.summary, "Auditoría de dependencias en repo externo");
  assert.match(report.rawError!, /ETIMEDOUT/);
  assert.match(report.formattedMarkdown, /### ❌ Informe Canónico de Fallo/);
  assert.match(report.formattedMarkdown, /\*\*1\. Error Observado:\*\*/);
  assert.match(report.formattedMarkdown, /\*\*2\. Causa Raíz Detectada:\*\*/);
  assert.match(report.formattedMarkdown, /\*\*3\. Premisas Falsadas:\*\*/);
  assert.match(report.formattedMarkdown, /\*\*4\. Pasos Sugeridos de Recuperación:\*\*/);
  assert.match(report.formattedMarkdown, /\*\*5\. Diagnósticos de Contexto:\*\*/);
});

test("dc-subagent-inbox: gestiona el ciclo de vida de depósitos y lectura", () => {
  subagentInboxManager.clear();

  const mockReport: BackgroundTaskReport = {
    id: "rep-1",
    taskId: "task-abc-123",
    agent: "dc-tech-analyst",
    label: "Analizar arquitectura de plugins",
    status: "completed",
    outcomeText: "Análisis completado con éxito: 14 plugins encontrados.",
    receivedAt: Date.now(),
    read: false,
  };

  subagentInboxManager.deposit(mockReport);

  const listAll = subagentInboxManager.list();
  assert.equal(listAll.length, 1);
  assert.equal(listAll[0]?.taskId, "task-abc-123");
  assert.equal(listAll[0]?.read, false);

  const unreadBefore = subagentInboxManager.list(true);
  assert.equal(unreadBefore.length, 1);

  const fetched = subagentInboxManager.get("task-abc-123");
  assert.ok(fetched);
  assert.equal(fetched?.agent, "dc-tech-analyst");

  const marked = subagentInboxManager.markRead("task-abc-123");
  assert.equal(marked, true);

  const unreadAfter = subagentInboxManager.list(true);
  assert.equal(unreadAfter.length, 0);
});

test("dc-subagent-inbox: intercepta gentle-agents.wake suprimiendo triggerTurn: true", async () => {
  const agentSessionModule = await import("@earendil-works/pi-coding-agent");
  const proto = agentSessionModule.AgentSession.prototype;

  let underlyingExecuted = false;
  let receivedOptions: any = undefined;
  let receivedMessage: any = undefined;

  // Asegurar desinstalación previa para estado limpio
  uninstallSubagentInboxInterceptor();

  // Asignar implementación base
  proto.sendCustomMessage = async function (msg: any, opts: any): Promise<void> {
    underlyingExecuted = true;
    receivedMessage = msg;
    receivedOptions = opts;
  };

  // Instalar el interceptor sobre esta base
  installSubagentInboxInterceptor();

  // 1. Probar que gentle-agents.wake con triggerTurn: true no llega a la base
  underlyingExecuted = false;
  await proto.sendCustomMessage.call(
    {} as any,
    { customType: "gentle-agents.wake", content: "Review output", display: false, details: undefined },
    { triggerTurn: true, deliverAs: "steer" },
  );

  assert.equal(underlyingExecuted, false, "El wake agresivo con triggerTurn: true debe ser suprimido");

  // 2. Probar que gentle-agents.result degrada triggerTurn: true a triggerTurn: false
  subagentInboxManager.clear();
  underlyingExecuted = false;

  await proto.sendCustomMessage.call(
    {} as any,
    {
      customType: "gentle-agents.result",
      content: "Tarea en background terminada",
      display: true,
      details: {
        gentleAgents: {
          taskId: "task-bg-999",
          agent: "dc-odd-worker",
          label: "Indexar repositorio",
          status: "completed",
        },
      },
    },
    { triggerTurn: true },
  );

  assert.equal(underlyingExecuted, true, "El resultado sí debe enviarse a la base");
  assert.equal(receivedOptions?.triggerTurn, false, "triggerTurn debe ser degradado a false");
  assert.equal(receivedMessage?.customType, "gentle-agents.result");

  const deposited = subagentInboxManager.get("task-bg-999");
  assert.ok(deposited, "El reporte debe guardarse en el buzón pasivo");
  assert.equal(deposited?.agent, "dc-odd-worker");
  assert.equal(deposited?.status, "completed");

  uninstallSubagentInboxInterceptor();
});
