import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import {
  type DcDoctorOptions,
  runDoctorDiagnostic,
} from "./dc-doctor-inspector.ts";
import { runEnvironmentChecks } from "./dc-doctor-env.ts";

/**
 * Extensión dc-doctor para Pi y DC Studio.
 * - Registra el comando único en inglés: /dc-doctor.
 * - Captura la referencia del TUI mediante un widget ancla ("dc-doctor-anchor").
 * - Diagnostica el árbol de nodos de layout y notifica si la estructura cambió tras una actualización.
 */
export default function dcDoctorExtension(
  pi: ExtensionAPI,
  options?: DcDoctorOptions,
): void {
  let tuiRef: unknown;

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI || ctx.mode !== "tui") return;

    try {
      ctx.ui.setWidget("dc-doctor-anchor", (tui) => {
        tuiRef = tui;
        return { render: () => [] as string[], invalidate() {} };
      });
    } catch {
      /* noop */
    }

    // Aviso automático si la forma cambió
    const timer = setTimeout(() => {
      try {
        const report = runDoctorDiagnostic(tuiRef, ctx, options);
        if (report.changed) {
          dcNotifier.notifyHerdr("DC UI: la estructura de gentle-pi cambió — corré /dc-doctor");
        }
      } catch {
        /* noop */
      }
    }, 4500);

    (timer as { unref?: () => void }).unref?.();
  });

  // Comando único en inglés: /dc-doctor
  pi.registerCommand("dc-doctor", {
    description: "Check Pi & gentle-pi UI layout structure, Node version, Git status and GitHub CLI auth",
    handler: async (_args: string | undefined, ctx: ExtensionContext) => {
      if (!ctx.hasUI) return;
      const report = runDoctorDiagnostic(tuiRef, ctx, options);
      const envChecks = runEnvironmentChecks(ctx.cwd);

      const envSummary = envChecks
        .map((c) => `${c.ok ? "✓" : "✗"} ${c.name}: ${c.message}`)
        .join("  ·  ");

      const hasEnvWarning = envChecks.some((c) => !c.ok);
      const fullMessage = `${report.message.replace(/\n/g, "  ·  ")}  ·  ${envSummary}`;

      dcNotifier.notify(
        ctx,
        "DC Doctor",
        fullMessage,
        report.changed || hasEnvWarning ? "warning" : "info",
      );
      dcNotifier.notifyHerdr(
        report.changed || hasEnvWarning
          ? "DC Doctor: advertencias en entorno o estructura"
          : "DC Doctor: entorno y estructura OK",
      );
    },
  });
}
