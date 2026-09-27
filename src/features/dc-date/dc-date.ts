import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { formatLocalDateIso, getContextDateString } from "./core/dc-date-formatter.ts";

/**
 * Extensión dc-date para Pi y DC Studio.
 * - Inyecta la fecha actual en el system prompt antes de iniciar cada turno (before_agent_start).
 * - Garantiza que el modelo y los subagentes tengan noción temporal precisa para búsquedas web y análisis de versiones.
 */
export default function dcDateExtension(pi: ExtensionAPI): void {
  let currentDate = getContextDateString();

  pi.on("session_start", () => {
    currentDate = getContextDateString();
  });

  pi.on("before_agent_start", (event) => {
    // Si el system prompt ya contiene la fecha actual, evitamos duplicación
    if (event.systemPrompt && event.systemPrompt.includes(`Current date: ${formatLocalDateIso()}`)) {
      return undefined;
    }

    return {
      systemPrompt: `${event.systemPrompt}\n\nCurrent date: ${currentDate}.`,
    };
  });
}
