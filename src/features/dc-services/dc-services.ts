import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import { registerDcServicesTools } from "./tools/dc-services-tools.ts";
import { DcServicesManager } from "./core/dc-services-manager.ts";

/**
 * Extensión dc-services para Pi y DC Studio.
 * - Gestiona servicios y procesos de desarrollo en segundo plano definidos en .pi/services.json.
 * - Registra herramientas completas: dc_services_list, dc_service_start, dc_service_stop,
 *   dc_service_restart, dc_service_status y dc_service_logs.
 * - Comando /dc-services para ver el estado de los servicios.
 */
export default function dcServicesExtension(pi: ExtensionAPI): void {
  registerDcServicesTools(pi);

  pi.registerCommand("dc-services", {
    description: "DC Studio: check status of background workspace services",
    handler: async (_args: string | undefined, ctx: ExtensionContext) => {
      const manager = new DcServicesManager(ctx.cwd ?? process.cwd());
      const statuses = manager.getAllStatuses();

      if (statuses.length === 0) {
        if (ctx.hasUI) {
          dcNotifier.notify(
            ctx,
            "DC Services",
            "No hay servicios configurados. Creá .pi/services.json para definir tus procesos.",
            "info",
          );
        }
        return;
      }

      const runningCount = statuses.filter((s) => s.state === "running").length;
      const summary = `${runningCount}/${statuses.length} corriendo (${statuses.map((s) => `${s.name}: ${s.state}`).join(", ")})`;

      if (ctx.hasUI) {
        dcNotifier.notify(ctx, "DC Services", summary, runningCount > 0 ? "info" : "warning");
      }
      dcNotifier.notifyHerdr(`DC Services: ${summary}`);
    },
  });
}
