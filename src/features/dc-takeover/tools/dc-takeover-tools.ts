/**
 * dc-takeover-tools.ts — LLM tool surface for Human Takeover requests.
 *
 * Enables orchestrators and subagents to yield control to the human for
 * CAPTCHAs, 2FA, biometrics, or physical validation, then resume precisely.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TakeoverResult } from "../core/dc-takeover-types.ts";
import { openDcTakeoverModal } from "../views/dc-takeover-modal.ts";

export const DC_TAKEOVER_HEADLESS_NOTE = "Headless environment, takeover unavailable.";

interface TakeoverToolParams {
  title: string;
  reason: string;
  suggestedAction: string;
}

function takeoverResult(result: TakeoverResult): any {
  const noteLine = result.note ? ` ${result.note}` : "";
  return {
    content: [{
      type: "text",
      text: `Resultado del takeover humano: ${result.outcome}.${noteLine}`.trim(),
    }],
    details: result,
  };
}

function newTakeoverId(): string {
  return `takeover-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function registerDcTakeoverTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "dc_takeover_request",
    label: "DC Takeover Request",
    description:
      "Solicita intervención humana (CAPTCHA, 2FA, biometría o validación física) y espera la decisión: continuar, reintentar o abortar.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Título corto de la solicitud (ej. \"Autenticación 2FA requerida\").",
        },
        reason: {
          type: "string",
          description: "Razón detallada de por qué se requiere intervención humana.",
        },
        suggestedAction: {
          type: "string",
          description: "Acción exacta que el humano debe ejecutar antes de continuar.",
        },
      },
      required: ["title", "reason", "suggestedAction"],
    } as any,
    async execute(
      _toolCallId: string,
      params: TakeoverToolParams,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<any> {
      if (!ctx.hasUI) {
        return takeoverResult({ outcome: "aborted", note: DC_TAKEOVER_HEADLESS_NOTE });
      }

      const outcome = await openDcTakeoverModal(ctx, {
        id: newTakeoverId(),
        title: params.title,
        reason: params.reason,
        suggestedAction: params.suggestedAction,
        createdAt: Date.now(),
      });

      return takeoverResult({ outcome });
    },
  });
}
