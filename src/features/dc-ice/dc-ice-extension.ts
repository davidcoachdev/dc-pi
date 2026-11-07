/**
 * src/features/dc-ice/dc-ice-extension.ts — Extensión principal de DC Studio para ICE / IDSD.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import { registerDcIceTools } from "./tools/dc-ice-tools.ts";
import { validateIceIntent } from "./ice-validator.ts";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";

export function dcIceExtension(pi: ExtensionAPI): void {
  // 1. Registrar herramientas agénticas
  registerDcIceTools(pi);

  // 2. Registrar comando canónico /dc-ice
  pi.registerCommand("dc-ice", {
    description: "Audita y valida un archivo de Intent bajo el marco IDSD / ICE Gate (Ahuja + Google SDLC).",
    handler: async (args: string | undefined, ctx: ExtensionContext) => {
      const targetPath = (args ?? "").trim();
      const cwd = ctx?.cwd ?? process.cwd();

      if (!targetPath) {
        ctx.ui?.notify?.("Uso: /dc-ice <ruta/a/intent.json>", "warning");
        return;
      }

      const fullPath = path.isAbsolute(targetPath) ? targetPath : path.resolve(cwd, targetPath);

      if (!fs.existsSync(fullPath)) {
        ctx.ui?.notify?.(`Archivo no encontrado: ${targetPath}`, "error");
        return;
      }

      try {
        const rawContent = fs.readFileSync(fullPath, "utf8");
        const parsed = JSON.parse(rawContent);
        const result = validateIceIntent(parsed);

        if (result.valid) {
          ctx.ui?.notify?.("✅ Intent validado exitosamente bajo ICE Gate", "info");
        } else {
          ctx.ui?.notify?.(`❌ Intent rechazado: ${result.errors[0]}`, "error");
        }
      } catch (err: any) {
        ctx.ui?.notify?.(`Error al procesar intent: ${err.message}`, "error");
      }
    },
  });
}

export default dcIceExtension;
