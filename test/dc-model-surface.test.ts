import { test } from "node:test";
import assert from "node:assert/strict";
import { registerDcEphemeralTools } from "../src/features/dc-agents/tools/dc-ephemeral-tools.ts";
import { registerSubagentInboxTools } from "../src/features/dc-agents/tools/dc-subagent-inbox-tools.ts";
import { registerDcPtcTools } from "../src/features/dc-ptc/tools/dc-ptc-tools.ts";

interface RegisteredTool {
  name: string;
  description: string;
  parameters: any;
}

test("Auditoría de Superficie de Modelos: Presupuesto y Consistencia Léxica", () => {
  const tools: RegisteredTool[] = [];

  // Mock de ExtensionAPI para capturar el registro de herramientas
  const mockPi: any = {
    registerTool: (toolDef: any) => {
      tools.push({
        name: toolDef.name,
        description: toolDef.description || "",
        parameters: toolDef.parameters || {},
      });
    },
    registerCommand: () => {},
    registerShortcut: () => {},
  };

  // Registrar las herramientas agénticas centrales de DC Studio
  registerDcEphemeralTools(mockPi);
  registerSubagentInboxTools(mockPi);
  registerDcPtcTools(mockPi);

  assert.ok(tools.length >= 5, "Deben haberse registrado al menos 5 herramientas centrales");

  let totalChars = 0;
  const TOOL_BUDGET_MAX_CHARS = 25000;
  const SINGLE_TOOL_DESC_MAX_CHARS = 4000;

  for (const t of tools) {
    // 1. Verificación de no-vacío
    assert.ok(t.name.trim().length > 0, "El nombre de la herramienta no puede estar vacío");
    assert.ok(t.description.trim().length > 10, `La herramienta ${t.name} debe tener una descripción sustancial`);

    // 2. Límite individual de descripción
    assert.ok(
      t.description.length <= SINGLE_TOOL_DESC_MAX_CHARS,
      `La descripción de ${t.name} (${t.description.length} chars) excede el máximo de ${SINGLE_TOOL_DESC_MAX_CHARS}`
    );

    // 3. Serialización de schema y conteo de presupuesto
    const schemaStr = JSON.stringify(t.parameters);
    const toolFootprint = t.name.length + t.description.length + schemaStr.length;
    totalChars += toolFootprint;

    // 4. Verificación de léxico prohibido (Anti-adulación y profesionalismo sobrio)
    const forbiddenTerms = ["disculpa", "perdón", "eres un genio", "excelente amo", "todo poderoso"];
    for (const term of forbiddenTerms) {
      assert.equal(
        t.description.toLowerCase().includes(term),
        false,
        `La herramienta ${t.name} contiene léxico no sobrio prohibido: "${term}"`
      );
    }
  }

  // 5. Presupuesto global de superficie de herramientas
  assert.ok(
    totalChars <= TOOL_BUDGET_MAX_CHARS,
    `La superficie total de herramientas (${totalChars} chars) excede el presupuesto máximo de ${TOOL_BUDGET_MAX_CHARS} chars`
  );
});
