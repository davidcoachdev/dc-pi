/**
 * dc-owasp.ts — Punto de entrada para la extensión dc-owasp en dc-pi.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerDcOwaspTools } from "./tools/dc-owasp-tools.ts";
import { openOwaspModal } from "./views/dc-owasp-modal.ts";
import { DcOwaspClient } from "./core/dc-owasp-client.ts";

export default function dcOwaspExtension(pi: ExtensionAPI): void {
  const client = new DcOwaspClient();

  // 1. Registrar herramientas para el LLM
  registerDcOwaspTools(pi, client);

  // 2. Registrar comandos TUI (/dc-owasp y alias /owasp)
  pi.registerCommand("dc-owasp", {
    description: "Explora interactivamente las guías defensivas de OWASP Cheat Sheets y directivas de seguridad.",
    handler: async (args: string, ctx: ExtensionContext) => {
      await openOwaspModal(ctx, args);
    },
  });

  pi.registerCommand("owasp", {
    description: "Alias de /dc-owasp para abrir el explorador de seguridad OWASP.",
    handler: async (args: string, ctx: ExtensionContext) => {
      await openOwaspModal(ctx, args);
    },
  });

  // Atajo de teclado global: Alt+O / Alt+Shift+O
  try {
    pi.registerShortcut("alt+o" as never, {
      description: "Explorador de seguridad OWASP Cheat Sheets",
      handler: async (ctx: ExtensionContext) => {
        await openOwaspModal(ctx);
      },
    });
  } catch {
    /* fallback si el host no soporta registerShortcut */
  }
}
