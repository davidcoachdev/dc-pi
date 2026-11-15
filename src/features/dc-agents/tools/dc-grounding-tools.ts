/**
 * dc-grounding-tools.ts — Herramienta de auditoría de grounding para el orquestador.
 *
 * Permite inspeccionar las afirmaciones y auditorías de un subagente antes de
 * confiar ciegamente en un reporte marcado como completado.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  auditReportGrounding,
  auditStoredClaims,
  groundingLedger,
  type GroundingAuditResult,
} from "../core/dc-grounding-ledger.ts";
import { subagentInboxManager } from "../core/dc-subagent-inbox.ts";

interface GroundingAuditParams {
  taskId?: unknown;
  reportText?: unknown;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function auditFromInboxOrLedger(taskId: string): GroundingAuditResult | undefined {
  const report = subagentInboxManager.get(taskId);
  if (report) {
    if (!report.groundingAudit) {
      report.groundingAudit = auditReportGrounding(report.outcomeText, taskId);
    }
    return report.groundingAudit;
  }

  if (groundingLedger.getClaims(taskId).length === 0) {
    return undefined;
  }
  return auditStoredClaims(taskId);
}

/**
 * Registra `dc_grounding_audit` en la ExtensionAPI de Pi.
 */
export function registerDcGroundingTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "dc_grounding_audit",
    label: "Auditar Grounding de Reportes",
    description:
      "Audita las afirmaciones de un reporte de subagente o de un texto directo, "
      + "clasificándolas como hecho verificado, inferencia soportada, desconocido o "
      + "decisión humana requerida. Devuelve el estado VERIFIED, SUSPECT o FLAGGED.",
    parameters: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "ID de la tarea cuyo reporte o claims registrados se auditarán.",
        },
        reportText: {
          type: "string",
          description: "Texto de reporte a parsear directamente, sin consultar el buzón.",
        },
      },
    },
    execute: async (_toolCallId: string, params: GroundingAuditParams) => {
      const taskId = optionalString(params?.taskId);
      const reportText = optionalString(params?.reportText);

      let audit: GroundingAuditResult | undefined;
      if (reportText) {
        audit = auditReportGrounding(reportText, taskId);
      } else if (taskId) {
        audit = auditFromInboxOrLedger(taskId);
        if (!audit) {
          return {
            content: [{
              type: "text",
              text: `No se encontró reporte ni afirmaciones registradas para "${taskId}".`,
            }],
            details: undefined,
            isError: true,
          };
        }
      } else {
        audit = auditStoredClaims();
      }

      return {
        content: [{ type: "text", text: JSON.stringify(audit, null, 2) }],
        details: audit,
      };
    },
  });
}
