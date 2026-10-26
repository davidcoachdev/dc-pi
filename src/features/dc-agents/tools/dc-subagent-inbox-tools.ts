import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { subagentInboxManager } from "../core/dc-subagent-inbox.ts";

/**
 * Registra las herramientas de inspección y gestión del buzón pasivo de subagentes en Pi.
 * Permite al orquestador (o al usuario vía comando) consultar los reportes acumulados
 * sin necesidad de esperar a que Pi sea interrumpido automáticamente.
 */
export function registerSubagentInboxTools(pi: ExtensionAPI): void {
  // Herramienta dc_subagent_inbox_list
  pi.registerTool({
    name: "dc_subagent_inbox_list",
    label: "Listar Buzón de Subagentes",
    description: "Lista los reportes de tareas finalizadas o fallidas de subagentes en background en el buzón estructurado.",
    parameters: {
      type: "object",
      properties: {
        onlyUnread: {
          type: "boolean",
          description: "Si es true, devuelve solo reportes no leídos aún por el orquestador.",
        },
      },
    },
    execute: async (_toolCallId: string, params: { onlyUnread?: boolean }) => {
      const reports = subagentInboxManager.list(Boolean(params?.onlyUnread));
      if (reports.length === 0) {
        return {
          content: [{ type: "text", text: "El buzón de subagentes está vacío (no hay tareas pendientes)." }],
          details: { count: 0, reports: [] },
        };
      }

      const lines = reports.map((r, i) => {
        const readStatus = r.read ? "✓" : "● NO LEÍDO";
        const badge = r.status === "completed" ? "✅" : "❌";
        return `${i + 1}. [${r.taskId}] ${badge} ${r.agent} (${readStatus}) - ${r.label || "Sin etiqueta"}\n   Estado: ${r.status} | Recibido: ${new Date(r.receivedAt).toLocaleTimeString()}`;
      });

      return {
        content: [{ type: "text", text: `### 📬 Buzón de Subagentes (${reports.length} reportes):\n\n${lines.join("\n\n")}` }],
        details: { count: reports.length, reports },
      };
    },
  });

  // Herramienta dc_subagent_inbox_get
  pi.registerTool({
    name: "dc_subagent_inbox_get",
    label: "Consultar Tarea en Buzón",
    description: "Obtiene el contenido completo del reporte de un subagente y lo marca como leído.",
    parameters: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "ID de la tarea del subagente.",
        },
      },
      required: ["taskId"],
    },
    execute: async (_toolCallId: string, params: { taskId?: unknown }) => {
      const taskId = String(params?.taskId || "");
      const report = subagentInboxManager.get(taskId);
      if (!report) {
        return {
          content: [{ type: "text", text: `No se encontró ningún reporte en el buzón para la tarea "${taskId}".` }],
          details: undefined,
          isError: true,
        };
      }

      subagentInboxManager.markRead(taskId);

      return {
        content: [
          {
            type: "text",
            text: [
              `### 📄 Reporte de Tarea: ${report.taskId} (${report.agent})`,
              `- **Estado:** ${report.status}`,
              `- **Etiqueta:** ${report.label || "N/A"}`,
              `- **Hora:** ${new Date(report.receivedAt).toISOString()}`,
              "",
              "**Contenido del Informe:**",
              report.outcomeText,
            ].join("\n"),
          },
        ],
        details: report,
      };
    },
  });

  // Comando de barra /inbox
  pi.registerCommand("inbox", {
    description: "DC Studio: consultar el buzón pasivo de reportes de subagentes en background",
    handler: async (_args: string | undefined, ctx: ExtensionContext) => {
      const reports = subagentInboxManager.list();
      if (reports.length === 0) {
        ctx.ui.notify("📬 El buzón de subagentes está vacío.", "info");
        return;
      }
      const unreadCount = reports.filter((r) => !r.read).length;
      ctx.ui.notify(`📬 Buzón: ${reports.length} reportes (${unreadCount} nuevos sin leer).`, unreadCount > 0 ? "warning" : "info");
    },
  });
}
