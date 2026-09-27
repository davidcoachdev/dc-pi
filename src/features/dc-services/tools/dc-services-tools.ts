import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DcServicesManager } from "../core/dc-services-manager.ts";

export function registerDcServicesTools(pi: ExtensionAPI): void {
  // 1. List configured services
  pi.registerTool({
    name: "dc_services_list",
    label: "DC Services List",
    description: "Lista todos los servicios de desarrollo configurados en .pi/services.json o .pi/workspace-services.json.",
    parameters: {
      type: "object",
      properties: {},
    } as any,
    async execute(_id, _params, _signal, _onUpdate, ctx): Promise<any> {
      try {
        const manager = new DcServicesManager(ctx?.cwd ?? process.cwd());
        const services = manager.listConfiguredServices();
        const keys = Object.keys(services);

        if (keys.length === 0) {
          return {
            content: [{
              type: "text",
              text: "No hay servicios configurados en el proyecto. Creá un archivo `.pi/services.json` con la clave `services` para definir tus procesos (ej: front, api, docker).",
            }],
            details: { count: 0, services: {} },
          };
        }

        const statuses = manager.getAllStatuses();
        const formatted = statuses.map((s, i) =>
          `### [${i + 1}] ${s.name} (${s.state.toUpperCase()}${s.pid ? ` · PID ${s.pid}` : ""})\n- Comando: \`${s.command}\`\n${s.description ? `- Descripción: ${s.description}\n` : ""}- Logs: \`${s.logPath}\``
        ).join("\n\n");

        return {
          content: [{
            type: "text",
            text: `Servicios configurados (${keys.length}):\n\n${formatted}`,
          }],
          details: { count: keys.length, statuses },
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error en dc_services_list: ${err.message}` }],
          details: { error: err.message },
          isError: true,
        };
      }
    },
  });

  // 2. Start service
  pi.registerTool({
    name: "dc_service_start",
    label: "DC Service Start",
    description: "Inicia un servicio de desarrollo en segundo plano (background) redirigiendo logs a disco sin bloquear la sesión.",
    parameters: {
      type: "object",
      properties: {
        service: { type: "string", description: "Nombre del servicio configurado (ej: 'front', 'api')" },
      },
      required: ["service"],
    } as any,
    async execute(_id, params: any, _signal, _onUpdate, ctx): Promise<any> {
      try {
        const manager = new DcServicesManager(ctx?.cwd ?? process.cwd());
        const status = await manager.startService(params.service);

        const text = status.state === "running"
          ? `Servicio "${status.name}" iniciado correctamente en segundo plano (PID: ${status.pid}).\nLogs disponibles en: \`${status.logPath}\``
          : `El servicio "${status.name}" intentó iniciar pero se encuentra detenido o falló. Consultá dc_service_logs para ver el error.`;

        return {
          content: [{ type: "text", text }],
          details: status,
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error al iniciar servicio: ${err.message}` }],
          details: { error: err.message },
          isError: true,
        };
      }
    },
  });

  // 3. Stop service
  pi.registerTool({
    name: "dc_service_stop",
    label: "DC Service Stop",
    description: "Detiene un servicio de desarrollo en ejecución de forma segura (SIGTERM con fallback a SIGKILL).",
    parameters: {
      type: "object",
      properties: {
        service: { type: "string", description: "Nombre del servicio a detener" },
        timeoutMs: { type: "number", description: "Tiempo de espera antes de forzar cierre (default: 5000ms)" },
      },
      required: ["service"],
    } as any,
    async execute(_id, params: any, _signal, _onUpdate, ctx): Promise<any> {
      try {
        const manager = new DcServicesManager(ctx?.cwd ?? process.cwd());
        const status = await manager.stopService(params.service, params.timeoutMs);

        return {
          content: [{
            type: "text",
            text: `Servicio "${status.name}" detenido (Estado: ${status.state.toUpperCase()}).`,
          }],
          details: status,
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error al detener servicio: ${err.message}` }],
          details: { error: err.message },
          isError: true,
        };
      }
    },
  });

  // 4. Restart service
  pi.registerTool({
    name: "dc_service_restart",
    label: "DC Service Restart",
    description: "Reinicia un servicio de desarrollo (detiene el proceso anterior y lanza uno nuevo).",
    parameters: {
      type: "object",
      properties: {
        service: { type: "string", description: "Nombre del servicio a reiniciar" },
      },
      required: ["service"],
    } as any,
    async execute(_id, params: any, _signal, _onUpdate, ctx): Promise<any> {
      try {
        const manager = new DcServicesManager(ctx?.cwd ?? process.cwd());
        const status = await manager.restartService(params.service);

        return {
          content: [{
            type: "text",
            text: `Servicio "${status.name}" reiniciado con éxito (Nuevo PID: ${status.pid}).`,
          }],
          details: status,
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error al reiniciar servicio: ${err.message}` }],
          details: { error: err.message },
          isError: true,
        };
      }
    },
  });

  // 5. Service status
  pi.registerTool({
    name: "dc_service_status",
    label: "DC Service Status",
    description: "Consulta el estado en tiempo real (running/stopped, PID, uptime) de un servicio específico o de todos los servicios.",
    parameters: {
      type: "object",
      properties: {
        service: { type: "string", description: "Nombre opcional del servicio. Si se omite, muestra el estado de todos." },
      },
    } as any,
    async execute(_id, params: any, _signal, _onUpdate, ctx): Promise<any> {
      try {
        const manager = new DcServicesManager(ctx?.cwd ?? process.cwd());

        if (params?.service) {
          const s = manager.getServiceStatus(params.service);
          const uptime = s.uptimeSeconds !== undefined ? ` | Uptime: ${s.uptimeSeconds}s` : "";
          return {
            content: [{
              type: "text",
              text: `Estado de ${s.name}: **${s.state.toUpperCase()}**${s.pid ? ` (PID: ${s.pid}${uptime})` : ""}\nComando: \`${s.command}\`\nLogs: \`${s.logPath}\``,
            }],
            details: s,
          };
        }

        const statuses = manager.getAllStatuses();
        if (statuses.length === 0) {
          return {
            content: [{ type: "text", text: "No hay servicios configurados en el proyecto." }],
            details: { statuses: [] },
          };
        }

        const summary = statuses.map((s) => {
          const uptime = s.uptimeSeconds !== undefined ? ` | Uptime: ${s.uptimeSeconds}s` : "";
          return `- **${s.name}**: ${s.state.toUpperCase()}${s.pid ? ` (PID: ${s.pid}${uptime})` : ""} — \`${s.command}\``;
        }).join("\n");

        return {
          content: [{
            type: "text",
            text: `Estado de los servicios del proyecto:\n\n${summary}`,
          }],
          details: { statuses },
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error en dc_service_status: ${err.message}` }],
          details: { error: err.message },
          isError: true,
        };
      }
    },
  });

  // 6. Service logs
  pi.registerTool({
    name: "dc_service_logs",
    label: "DC Service Logs",
    description: "Lee las últimas líneas de salida (stdout/stderr) del archivo de log de un servicio en background.",
    parameters: {
      type: "object",
      properties: {
        service: { type: "string", description: "Nombre del servicio del cual leer logs" },
        lines: { type: "number", description: "Cantidad máxima de líneas a retornar (default: 80, máx: 2000)" },
      },
      required: ["service"],
    } as any,
    async execute(_id, params: any, _signal, _onUpdate, ctx): Promise<any> {
      try {
        const manager = new DcServicesManager(ctx?.cwd ?? process.cwd());
        const logsResult = manager.getLogs({
          service: params.service,
          lines: params.lines ?? 80,
        });

        return {
          content: [{
            type: "text",
            text: `Logs recientes de "${logsResult.service}" (${logsResult.lines.length} líneas de ${logsResult.totalLines}):\n\n\`\`\`text\n${logsResult.lines.join("\n")}\n\`\`\``,
          }],
          details: logsResult,
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error al leer logs: ${err.message}` }],
          details: { error: err.message },
          isError: true,
        };
      }
    },
  });
}
