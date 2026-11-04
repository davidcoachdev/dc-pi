import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dcNotifier } from "../../../integrations/dc-notify/dc-notifier.ts";
import { dcWebhookDaemonManager } from "./dc-webhook-daemon-manager.ts";
import { dcConflictGuard } from "./dc-conflict-guard.ts";

export function registerWebhookDaemonCommands(pi: ExtensionAPI): void {
  pi.registerCommand("dc-webhook", {
    description: "Administra el daemon de Webhooks de GitHub para resolución autónoma de issues en segundo plano",
    handler: async (args: string, ctx: ExtensionContext) => {
      const sub = args.trim().toLowerCase();

      if (sub === "start") {
        try {
          const status = await dcWebhookDaemonManager.start(ctx);
          const repoNwo = status.repo?.fullNwo ?? "desconocido";
          dcNotifier.notify(
            ctx,
            "DC Webhook Daemon",
            `✔ Daemon activo para ${repoNwo} en puerto ${status.port} con túnel GitHub`,
            "info",
          );
        } catch (err: any) {
          dcNotifier.notify(ctx, "DC Webhook Daemon", `Error iniciando daemon: ${err.message}`, "error");
        }
        return;
      }

      if (sub === "stop") {
        await dcWebhookDaemonManager.stop();
        dcNotifier.notify(ctx, "DC Webhook Daemon", "Daemon y túnel detenidos correctamente.", "info");
        return;
      }

      if (sub === "status" || sub === "") {
        const st = dcWebhookDaemonManager.getStatus();
        const repo = st.repo?.fullNwo ?? "no detectado";
        const runningText = st.running ? `Activo (puerto ${st.port})` : "Detenido";
        const tunnelText = st.tunnelActive ? "Conectado" : "Desconectado";
        const dispatches = st.activeDispatches.length;
        const conflicts = dcConflictGuard.listReservations().length;

        const info = `Repositorio: ${repo} | Receptor: ${runningText} | Túnel GitHub: ${tunnelText} | Issues en proceso: ${dispatches} | Archivos reservados: ${conflicts}`;
        dcNotifier.notify(ctx, "DC Webhook Status", info, "info");
      }
    },
  });

  // Limpieza al cerrar sesión
  pi.on("session_shutdown", async () => {
    await dcWebhookDaemonManager.stop();
  });
}
