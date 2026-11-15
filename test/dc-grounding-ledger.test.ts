import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DC_GROUNDING_LEDGER_LIMIT,
  GroundingLedger,
  NO_EVIDENCE_REASON,
  auditReportGrounding,
  clearGroundingLedger,
  groundingLedger,
} from "../src/features/dc-agents/core/dc-grounding-ledger.ts";
import {
  subagentInboxManager,
  installSubagentInboxInterceptor,
  uninstallSubagentInboxInterceptor,
  type BackgroundTaskReport,
} from "../src/features/dc-agents/core/dc-subagent-inbox.ts";
import { dcNotifier } from "../src/integrations/dc-notify/dc-notifier.ts";
import { registerDcGroundingTools } from "../src/features/dc-agents/tools/dc-grounding-tools.ts";

test("dc-grounding-ledger: registra claims con id y timestamp", () => {
  const ledger = new GroundingLedger();

  const claim = ledger.recordClaim({
    taskId: "task-1",
    category: "VERIFIED_FACT",
    claim: "El build terminó con exit code 0",
    evidence: "exit code 0",
  });

  assert.match(claim.id, /^claim-/);
  assert.equal(claim.taskId, "task-1");
  assert.equal(claim.category, "VERIFIED_FACT");
  assert.equal(claim.evidence, "exit code 0");
  assert.ok(claim.timestamp > 0);
  assert.deepEqual(ledger.getClaims("task-1"), [claim]);
  assert.equal(ledger.getClaims("other-task").length, 0);
});

test("dc-grounding-ledger: aplica límite FIFO por capacidad", () => {
  const ledger = new GroundingLedger(3);

  for (let index = 0; index < 5; index += 1) {
    ledger.recordClaim({
      category: "UNKNOWN",
      claim: `claim-${index}`,
    });
  }

  const claims = ledger.getClaims();
  assert.equal(claims.length, 3);
  assert.deepEqual(claims.map((claim) => claim.claim), ["claim-2", "claim-3", "claim-4"]);
});

test("dc-grounding-ledger: el ledger global respeta el tope de 300 entradas", () => {
  groundingLedger.clear();

  for (let index = 0; index <= DC_GROUNDING_LEDGER_LIMIT; index += 1) {
    groundingLedger.recordClaim({
      category: "SUPPORTED_INFERENCE",
      claim: `inferencia-${index}`,
    });
  }

  const claims = groundingLedger.getClaims();
  assert.equal(DC_GROUNDING_LEDGER_LIMIT, 300);
  assert.equal(claims.length, 300);
  assert.equal(claims[0]?.claim, "inferencia-1");
  assert.equal(claims.at(-1)?.claim, "inferencia-300");

  groundingLedger.clear();
  assert.equal(groundingLedger.getClaims().length, 0);
});

test("dc-grounding-ledger: parsea etiquetas explícitas con corchetes y negrita", () => {
  const ledger = new GroundingLedger();
  const result = ledger.auditReportGrounding([
    "[Verified Fact] npx tsc --noEmit terminó correctamente",
    "- **Supported Inference:** El build es seguro porque los tipos compilan",
    "**[Unknown / Unverifiable]** El rendimiento en producción",
    "### [Human Decision Required] Elegir estrategia de persistencia",
  ].join("\n"), "task-tags");

  assert.equal(result.totalClaims, 4);
  assert.deepEqual(result.counts, {
    VERIFIED_FACT: 1,
    SUPPORTED_INFERENCE: 1,
    UNKNOWN: 1,
    HUMAN_DECISION_REQUIRED: 1,
  });
  assert.deepEqual(
    result.claims.map((claim) => claim.category),
    ["VERIFIED_FACT", "SUPPORTED_INFERENCE", "UNKNOWN", "HUMAN_DECISION_REQUIRED"],
  );
  assert.ok(result.claims.every((claim) => claim.taskId === "task-tags"));
});

test("dc-grounding-ledger: reporte vacío o con hand-waving queda FLAGGED", () => {
  const ledger = new GroundingLedger();

  const empty = ledger.auditReportGrounding("");
  assert.equal(empty.status, "FLAGGED");
  assert.ok(empty.reasons.includes(NO_EVIDENCE_REASON));

  const handWaving = ledger.auditReportGrounding(
    "Todo completed con éxito, confío en que funciona perfectamente.",
  );
  assert.equal(handWaving.status, "FLAGGED");
  assert.ok(handWaving.reasons.includes(NO_EVIDENCE_REASON));
});

test("dc-grounding-ledger: UNKNOWN presentado como prueba se marca FLAGGED", () => {
  const ledger = new GroundingLedger();
  const result = ledger.auditReportGrounding([
    "Completed: la integración está lista.",
    "[Unknown / Unverifiable] La API funciona en producción.",
  ].join("\n"));

  assert.equal(result.status, "FLAGGED");
  assert.ok(result.reasons.includes(NO_EVIDENCE_REASON));
  assert.ok(result.reasons.some((reason) => reason.includes("UNKNOWN")));
});

test("dc-grounding-ledger: evidencia de ejecución y path:line produce VERIFIED", () => {
  const ledger = new GroundingLedger();
  const result = ledger.auditReportGrounding([
    "Implementación completed.",
    "[Verified Fact] Ejecuté npm run build",
    "exit code 0",
    "[Verified Fact] Revisé src/features/dc-agents/core/dc-grounding-ledger.ts:42",
    "[Supported Inference] El parser cubre los casos porque la evidencia lo confirma",
  ].join("\n"), "task-verified");

  assert.equal(result.status, "VERIFIED");
  assert.ok(result.counts.VERIFIED_FACT >= 2);
  assert.ok(result.claims.some((claim) => claim.evidence?.includes("exit code 0")));
  assert.ok(result.claims.some((claim) => claim.evidence?.includes("dc-grounding-ledger.ts:42")));
});

test("dc-grounding-ledger: evidencia sin etiquetas explícitas también verifica", () => {
  const ledger = new GroundingLedger();
  const result = ledger.auditReportGrounding([
    "Build completed.",
    "Tests: 83 pass",
    "exit code 0",
    "src/features/dc-agents/core/dc-grounding-ledger.ts:42",
  ].join("\n"));

  assert.equal(result.status, "VERIFIED");
  assert.ok(result.counts.VERIFIED_FACT > 0);
  assert.ok(result.claims.every((claim) => claim.category === "VERIFIED_FACT"));
});

test("dc-grounding-ledger: hechos verificados sin ejecución quedan SUSPECT", () => {
  const ledger = new GroundingLedger();
  const result = ledger.auditReportGrounding(
    "[Verified Fact] Leí el archivo y parece correcto.",
  );

  assert.equal(result.status, "SUSPECT");
  assert.equal(result.counts.VERIFIED_FACT, 1);
});

test("dc-grounding-ledger: integra auditoría al depositar reportes en el inbox", () => {
  subagentInboxManager.clear();
  clearGroundingLedger();

  let delivered: BackgroundTaskReport | undefined;
  const unsubscribe = subagentInboxManager.subscribe((report) => {
    delivered = report;
  });

  try {
    const report: BackgroundTaskReport = {
      id: "rep-grounding-1",
      taskId: "task-inbox-flagged",
      agent: "dc-odd-worker",
      label: "Implementar feature",
      status: "completed",
      outcomeText: "Todo listo, completed y funcionando.",
      receivedAt: Date.now(),
      read: false,
    };

    assert.equal(subagentInboxManager.deposit(report), true);

    const stored = subagentInboxManager.get(report.taskId);
    assert.ok(stored?.groundingAudit);
    assert.equal(stored?.groundingAudit?.status, "FLAGGED");
    assert.equal(delivered?.groundingAudit?.status, "FLAGGED");
    assert.equal(stored?.outcomeText, report.outcomeText);
  } finally {
    unsubscribe();
    subagentInboxManager.clear();
    clearGroundingLedger();
  }
});

test("dc-grounding-ledger: inbox VERIFIED conserva reporte y auditoría", () => {
  subagentInboxManager.clear();
  clearGroundingLedger();

  try {
    const report: BackgroundTaskReport = {
      id: "rep-grounding-2",
      taskId: "task-inbox-verified",
      agent: "dc-odd-worker",
      status: "completed",
      outcomeText: [
        "Build completed.",
        "exit code 0",
        "src/features/dc-agents/core/dc-grounding-ledger.ts:42",
      ].join("\n"),
      receivedAt: Date.now(),
      read: false,
    };

    subagentInboxManager.deposit(report);
    const stored = subagentInboxManager.get(report.taskId);

    assert.equal(stored?.groundingAudit?.status, "VERIFIED");
    assert.equal(stored?.outcomeText, report.outcomeText);
  } finally {
    subagentInboxManager.clear();
    clearGroundingLedger();
  }
});

test("dc-grounding-ledger: interceptor usa el badge UNGROUNDED para FLAGGED", async () => {
  const agentSessionModule = await import("@earendil-works/pi-coding-agent");
  const proto = agentSessionModule.AgentSession.prototype as any;
  const originalSend = proto.sendCustomMessage;
  const originalNotifyHerdr = dcNotifier.notifyHerdr;

  let notifiedTitle = "";
  uninstallSubagentInboxInterceptor();
  proto.sendCustomMessage = async function (): Promise<void> {};
  installSubagentInboxInterceptor();
  dcNotifier.notifyHerdr = (title: string): boolean => {
    notifiedTitle = title;
    return true;
  };

  try {
    subagentInboxManager.clear();
    clearGroundingLedger();

    await proto.sendCustomMessage.call(
      {},
      {
        customType: "gentle-agents.result",
        content: "Completed sin evidencia.",
        details: {
          gentleAgents: {
            taskId: "task-ungrounded",
            agent: "dc-worker",
            status: "completed",
          },
        },
      },
      {},
    );

    assert.match(notifiedTitle, /\[UNGROUNDED\]/);
    assert.equal(
      subagentInboxManager.get("task-ungrounded")?.groundingAudit?.status,
      "FLAGGED",
    );
  } finally {
    dcNotifier.notifyHerdr = originalNotifyHerdr;
    uninstallSubagentInboxInterceptor();
    proto.sendCustomMessage = originalSend;
    subagentInboxManager.clear();
    clearGroundingLedger();
  }
});

test("dc-grounding-tools: registra dc_grounding_audit y audita reportText", async () => {
  const registered: any[] = [];
  registerDcGroundingTools({
    registerTool(tool: any) {
      registered.push(tool);
    },
  } as any);

  const tool = registered.find((entry) => entry.name === "dc_grounding_audit");
  assert.ok(tool);

  const response = await tool.execute("call-1", {
    reportText: "Completed, todo funciona sin evidencia.",
  });
  const audit = JSON.parse(response.content[0].text);

  assert.equal(audit.status, "FLAGGED");
  assert.equal(audit.totalClaims, 0);
  assert.ok(Array.isArray(audit.reasons));

  clearGroundingLedger();
});
