import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  sanitizeMemoryDefense,
  redactSkillResult,
  pruneToolOutput,
} from "../src/features/dc-sentinel/core/dc-sentinel-defense.ts";

describe("dc-sentinel-defense: Memory Defense, Privacidad y Redactor de Ruido", () => {
  it("censura tokens de IA, GitHub, AWS y passwords de Postgres", () => {
    const raw = `
      Configurando servicios con sk-ant-api03-abcdef12345678901234567890
      y OpenAI sk-proj-9876543210abcdef9876543210
      Token de git: ghp_123456789012345678901234567890123456
      AWS: AKIAIOSFODNN7EXAMPLE
      DB: postgres://admin:superSecretPassword123@db.internal:5432/production
    `;

    const res = sanitizeMemoryDefense(raw);

    assert.ok(!res.text.includes("sk-ant-api03"));
    assert.ok(!res.text.includes("sk-proj-987654"));
    assert.ok(!res.text.includes("ghp_12345678"));
    assert.ok(!res.text.includes("AKIAIOSFODNN7EXAMPLE"));
    assert.ok(!res.text.includes("superSecretPassword123"));

    assert.ok(res.text.includes("[REDACTED:anthropic_key]"));
    assert.ok(res.text.includes("[REDACTED:openai_project_key]"));
    assert.ok(res.text.includes("[REDACTED:github_token]"));
    assert.ok(res.text.includes("[REDACTED:aws_access_key]"));
    assert.ok(res.text.includes("[REDACTED_PASSWORD]"));

    assert.equal(res.redactedCount, 5);
  });

  it("elimina quirúrgicamente bloques envueltos en <private>...</private>", () => {
    const raw = `
      El servidor corre en puerto 3000.
      <private>
        Esta es una nota privada con datos personales de prueba.
      </private>
      El health check respondió OK.
    `;

    const res = sanitizeMemoryDefense(raw);
    assert.ok(!res.text.includes("datos personales de prueba"));
    assert.ok(res.text.includes("[PRIVATE_CONTENT_REDACTED]"));
    assert.equal(res.privateBlocksStripped, 1);
  });

  it("redacta el resultado de lectura de SKILL.md usando skillResultRedactor de Mastra", () => {
    const toolOutput = "# Acceptance Contract Skill\n" + "Directivas y reglas para contratos de aceptación...\n".repeat(50);
    const args = { path: "/home/dc-studio/.pi/agent/skills/acceptance-contract/SKILL.md" };

    const redacted = redactSkillResult("read", args, toolOutput);

    assert.ok(redacted.startsWith("[Skill loaded: acceptance-contract"));
    assert.ok(!redacted.includes("Directivas y reglas"));

    // Para archivos normales que no son skills, no debe redactar
    const normalOutput = "export const a = 1;";
    const normalArgs = { path: "src/index.ts" };
    assert.equal(redactSkillResult("read", normalArgs, normalOutput), normalOutput);
  });

  it("trunca volcados gigantes de herramientas conservando cabecera y cola", () => {
    const hugeOutput = "A".repeat(5000);
    const pruned = pruneToolOutput(hugeOutput, 1000);

    assert.ok(pruned.length < 2000);
    assert.ok(pruned.includes("caracteres omitidos por dc-sentinel para proteger el contexto"));
    assert.ok(pruned.startsWith("AAA"));
    assert.ok(pruned.endsWith("AAA"));
  });
});
