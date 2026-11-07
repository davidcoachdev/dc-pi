/**
 * src/features/dc-ice/tools/dc-ice-tools.ts — Herramienta `dc_ice_validate` expuesta a Pi.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { validateIceIntent } from "../ice-validator.ts";
import type { IceIntent } from "../types.ts";

export function registerDcIceTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "dc_ice_validate",
    label: "DC ICE Intent Validator",
    description:
      "Valida la anatomía de un Intent bajo el marco IDSD (Kapil Viren Ahuja & Google Cloud AI SDLC). Verifica el test de 2 implementaciones, que el Goal sea atómico sin conjunciones, que las Constraints sean de negocio (no implementación), las Failure Conditions y las 3 preguntas del Freno Manual.",
    parameters: {
      type: "object",
      properties: {
        intent: {
          type: "object",
          description: "Objeto Intent estructurado con 'goal', 'constraints', 'failureConditions' y 'manualBrake'.",
        },
        intentJson: {
          type: "string",
          description: "String JSON con el Intent si no se pasa como objeto.",
        },
      },
    } as any,
    async execute(_id, params: any, _signal, _onUpdate, _ctx): Promise<any> {
      let payload = params?.intent;
      if (!payload && params?.intentJson) {
        try {
          payload = JSON.parse(params.intentJson);
        } catch (err: any) {
          return {
            content: [{ type: "text", text: `❌ JSON inválido en 'intentJson': ${err.message}` }],
            details: { valid: false, error: err.message },
            isError: true,
          };
        }
      }

      if (!payload) {
        return {
          content: [{ type: "text", text: "❌ Parámetro requerido faltante: Provee 'intent' o 'intentJson'." }],
          details: { valid: false, error: "Missing payload" },
          isError: true,
        };
      }

      const result = validateIceIntent(payload);

      const lines: string[] = [
        `### ICE Gate Verdict: ${result.valid ? "✅ APROBADO (Intent Válido)" : "❌ RECHAZADO (Violación de ICE/IDSD)"}`,
      ];

      if (result.intent) {
        lines.push(`\n**🎯 Goal:** ${result.intent.goal}`);
        lines.push(`\n**🛡️ Constraints (${result.intent.constraints.length}):**`);
        result.intent.constraints.forEach((c) => lines.push(`- ${c}`));
        lines.push(`\n**🛑 Failure Conditions (${result.intent.failureConditions.length}):**`);
        result.intent.failureConditions.forEach((f) => lines.push(`- ${f}`));
        lines.push(`\n**🛑 Freno Manual:**`);
        lines.push(`- **¿Quién lo necesita?:** ${result.intent.manualBrake.whoNeedsThis}`);
        lines.push(`- **¿Se construiría si costara 1 semana de devs?:** ${result.intent.manualBrake.costIfOneWeekDevs ? "Sí" : "No / Cuestionable"}`);
        lines.push(`- **Autoridad de Negativa (Dueño del NO):** ${result.intent.manualBrake.refusalOwner}`);
      }

      if (result.errors.length > 0) {
        lines.push(`\n**❌ Errores Críticos a Subsanar:**`);
        result.errors.forEach((e) => lines.push(`- ${e}`));
      }

      if (result.warnings.length > 0) {
        lines.push(`\n**⚠️ Advertencias de Calidad:**`);
        result.warnings.forEach((w) => lines.push(`- ${w}`));
      }

      if (result.suggestedRemediation && result.suggestedRemediation.length > 0) {
        lines.push(`\n**💡 Acciones Correctivas Recomendadas:**`);
        result.suggestedRemediation.forEach((r) => lines.push(`- ${r}`));
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: result,
        isError: !result.valid,
      };
    },
  });
}
