import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { appendDcSystemPromptOnce, type AppendableSystemPromptOptions } from "../../core/dc-append-system-prompt.ts";
import { formatLocalDateIso, getContextDateString } from "./core/dc-date-formatter.ts";
import {
  buildDcHarnessPromptBlock,
  DC_UNIVERSAL_DIRECTIVES_MARKER,
  GEMINI_FRONTIER_PROTOCOL_MARKER,
  detectGeminiVersionLabel,
  isGeminiModelCandidate,
  renderDcUniversalDirectives,
  renderGeminiFrontierProtocol,
} from "./core/dc-frontier-directives.ts";

/**
 * Extensión dc-date & Frontier Directives para Pi y DC Studio.
 * - Unifica la inyección de la fecha actual, las Directivas Universales de Ingeniería (cualquier proyecto/stack)
 *   y el Protocolo de Ejecución de Frontera para toda la familia Google Gemini (3.8, 3.7, 3.6, 3.5, 3.1, Pro/Flash).
 * - Inyecta en `event.systemPromptOptions.appendSystemPrompt` usando `appendDcSystemPromptOnce` (al estilo gentle-ai),
 *   manteniendo fallback a `event.systemPrompt` por retrocompatibilidad.
 */
export default function dcDateExtension(
  pi: ExtensionAPI,
  env: Record<string, string | undefined> = process.env,
): void {
  let currentDate = getContextDateString();

  pi.on("session_start", () => {
    currentDate = getContextDateString();
  });

  pi.on("before_agent_start", (event: any, ctx?: ExtensionContext) => {
    const activeModel = ctx?.model as { id?: string; name?: string; provider?: string } | undefined;
    const isChild = env.GENTLE_PI_AGENTS_CHILD === "1";
    const dateLine = `Current date: ${currentDate}.`;
    const dateMarker = `Current date: ${formatLocalDateIso()}`;

    // Camino moderno (gentle-ai / pi-claude-bridge): mutar event.systemPromptOptions.appendSystemPrompt
    if (event?.systemPromptOptions && typeof event.systemPromptOptions === "object") {
      const options = event.systemPromptOptions as AppendableSystemPromptOptions;
      appendDcSystemPromptOnce(options, dateLine, dateMarker);

      if (!isChild) {
        appendDcSystemPromptOnce(options, renderDcUniversalDirectives(), DC_UNIVERSAL_DIRECTIVES_MARKER);
        if (isGeminiModelCandidate(activeModel, env)) {
          const versionLabel = detectGeminiVersionLabel(activeModel, env);
          appendDcSystemPromptOnce(
            options,
            renderGeminiFrontierProtocol(versionLabel),
            GEMINI_FRONTIER_PROTOCOL_MARKER,
          );
        }
      }
      return undefined;
    }

    // Fallback retrocompatible cuando el host o un test pasa únicamente event.systemPrompt
    const fullBlock = buildDcHarnessPromptBlock({
      dateString: currentDate,
      model: activeModel,
      env,
    });

    if (typeof event?.systemPrompt === "string") {
      if (event.systemPrompt.includes(dateMarker) && (isChild || event.systemPrompt.includes(DC_UNIVERSAL_DIRECTIVES_MARKER))) {
        return undefined;
      }
      return {
        systemPrompt: `${event.systemPrompt}\n\n${fullBlock}`,
      };
    }

    return undefined;
  });
}
