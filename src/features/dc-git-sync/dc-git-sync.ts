import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { appendDcSystemPromptOnce } from "../../core/dc-append-system-prompt.ts";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import { inspectGitSync } from "./core/dc-git-sync-inspector.ts";
import type { GitSyncDiagnostic } from "./core/dc-git-sync-types.ts";

/**
 * Extensión dc-git-sync para Pi y DC Studio.
 * - En el Turn 1 de la sesión (before_agent_start), audita pasivamente el estado de la rama contra upstream.
 * - Si detecta divergencia o commits pendientes, inyecta el diagnóstico al contexto del agente.
 * - Registra el comando /dc-git-sync para inspección interactiva.
 */
export default function dcGitSyncExtension(pi: ExtensionAPI): void {
  let hasCheckedThisSession = false;

  // Al iniciar o resetear sesión
  pi.on("session_start", () => {
    hasCheckedThisSession = false;
  });

  // Chequeo único no invasivo al arrancar el agente en Turn 1
  pi.on("before_agent_start", async (event: any, ctx) => {
    if (hasCheckedThisSession) return;
    hasCheckedThisSession = true;

    try {
      const diag: GitSyncDiagnostic = await inspectGitSync(ctx.cwd ?? process.cwd());

      // Solo avisamos o inyectamos contexto si hay desincronización relevante
      if (diag.isGitRepo && (diag.status === "behind" || diag.status === "diverged" || diag.status === "ahead")) {
        if (ctx.hasUI && (diag.status === "behind" || diag.status === "diverged")) {
          dcNotifier.notify(
            ctx,
            "DC Git Sync",
            diag.summary,
            diag.status === "diverged" ? "error" : "warning",
          );
        }
        dcNotifier.notifyHerdr(`DC Git Sync: ${diag.summary}`);

        const syncNotice = `[DC Git Sync]: ${diag.summary}${diag.recommendation ? ` Requisito: ${diag.recommendation}` : ""}`;
        if (event?.systemPromptOptions && typeof event.systemPromptOptions === "object") {
          appendDcSystemPromptOnce(event.systemPromptOptions, syncNotice, "[DC Git Sync]:");
        } else if (typeof (ctx as any).injectSystemMessage === "function") {
          (ctx as any).injectSystemMessage(syncNotice);
        }
      }
    } catch {
      /* Silencioso para no romper la experiencia si git falla */
    }
  });

  // Comando manual /dc-git-sync
  pi.registerCommand("dc-git-sync", {
    description: "DC Studio: inspect remote git synchronization status",
    handler: async (_args: string | undefined, ctx: ExtensionContext) => {
      const diag = await inspectGitSync(ctx.cwd ?? process.cwd());
      const level = diag.status === "diverged" ? "error" : diag.status === "behind" ? "warning" : "info";

      const details = [
        diag.summary,
        diag.hasUncommittedChanges ? "Hay cambios locales sin commitear." : "Árbol limpio.",
        diag.hasUntrackedFiles ? "Hay archivos sin trackear (??)." : "",
        diag.recommendation ? `Tip: ${diag.recommendation}` : "",
      ].filter(Boolean).join("  ·  ");

      if (ctx.hasUI) {
        dcNotifier.notify(ctx, "DC Git Sync", details, level);
      }
      dcNotifier.notifyHerdr(`DC Git Sync: ${diag.summary}`);
    },
  });
}
