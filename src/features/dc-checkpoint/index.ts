import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import { createCheckpoint } from "./dc-checkpoint.ts";

export function dcCheckpointExtension(pi: ExtensionAPI): void {
  pi.registerCommand("dc-checkpoint", {
    description: "Crea un snapshot local del worktree (diff.patch + restore.sh) en .pi/checkpoints/",
    handler: async (args: string, ctx: ExtensionContext) => {
      const name = args.trim() || "snapshot";
      const result = createCheckpoint(name, ctx.cwd);
      if (!result.ok) {
        dcNotifier.notify(ctx, "Checkpoint", `dc-checkpoint error: ${result.message}`, "error");
        return;
      }

      const msg = [
        `📸 Checkpoint creado: ${result.id}`,
        `   Directorio: ${result.dir}`,
        `   HEAD: ${result.head} (${result.dirty ? "con cambios locales en diff.patch" : "worktree limpio"})`,
        result.untracked.length > 0 ? `   Aviso: ${result.untracked.length} archivos untracked no incluidos en patch` : "",
        `   Para restaurar: bash "${result.dir}/restore.sh"`,
      ].filter(Boolean).join("\n");

      dcNotifier.notify(ctx, "Checkpoint", msg, "info");
    },
  });
}

export * from "./dc-checkpoint.ts";
export default dcCheckpointExtension;
