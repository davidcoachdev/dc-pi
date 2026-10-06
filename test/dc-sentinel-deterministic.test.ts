import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  deriveSessionTitle,
  compileDeterministicSessionSummary,
  extractSessionGitStats,
} from "../src/features/dc-sentinel/core/dc-sentinel-deterministic-extractor.ts";
import type { SentinelTurnRecord } from "../src/features/dc-sentinel/core/dc-sentinel-types.ts";

describe("dc-sentinel-deterministic: Extractor a Costo Cero sin LLM", () => {
  it("deriva títulos limpios sin slash commands ni espacios dobles", () => {
    assert.equal(deriveSessionTitle("/dc-sentinel revisar estado"), "revisar estado");
    assert.equal(deriveSessionTitle("  arreglar el bug   de auth  "), "arreglar el bug de auth");
    assert.equal(deriveSessionTitle(""), "Sesión de Desarrollo y Mantenimiento");
  });

  it("compila un resumen determinista completo a partir de turnos y stats", async () => {
    const turns: SentinelTurnRecord[] = [
      {
        turnId: "turn-1",
        timestamp: "2026-10-06T00:00:00Z",
        userPrompt: "arreglar el bug de validación en JWT",
        toolsExecuted: [
          {
            callId: "call-1",
            toolName: "read",
            args: { path: "src/auth.ts" },
            startedAt: 1000,
            endedAt: 1050,
          },
          {
            callId: "call-2",
            toolName: "edit",
            args: { path: "src/auth.ts" },
            startedAt: 1100,
            endedAt: 1150,
          },
        ],
        subagentsLaunched: [
          {
            agent: "dc-verify",
            task: "verificar tests de auth",
            startedAt: 1200,
            endedAt: 1400,
            isError: false,
          },
        ],
        errorsDetected: [],
      },
    ];

    const gitStats = {
      filesChanged: ["src/auth.ts", "test/auth.test.ts"],
      insertions: 15,
      deletions: 3,
      statSummary: "src/auth.ts | 10 ++\ntest/auth.test.ts | 8 +-\n",
      isClean: false,
    };

    const summary = await compileDeterministicSessionSummary({
      sessionId: "sess-test-123",
      project: "dc-pi",
      projectRoot: process.cwd(),
      turns,
      gitStats,
    });

    assert.equal(summary.title, "arreglar el bug de validación en JWT");
    assert.equal(summary.filesTouched.length, 2);
    assert.equal(summary.blastRadius.filesCount, 2);
    assert.equal(summary.blastRadius.risk, "low");
    assert.equal(summary.hasErrors, false);

    // Verifica que el Markdown contenga las secciones canónicas
    assert.ok(summary.markdown.includes("# Registro de Vuelo"));
    assert.ok(summary.markdown.includes("## 1. Intención Original del Usuario"));
    assert.ok(summary.markdown.includes("## 2. Superficie de Cambios (Git Diff Determinista)"));
    assert.ok(summary.markdown.includes("## 3. Herramientas y Subagentes Ejecutados"));

    // Verifica que se extraigan notas atómicas (bugfix detectado por 'arreglar el bug')
    assert.equal(summary.notesToPersist.length, 1);
    assert.equal(summary.notesToPersist[0].type, "bugfix");
    assert.equal(summary.notesToPersist[0].glyph, "●");
  });

  it("lee el estado real de git sin fallar en repositorios válidos", async () => {
    const git = await extractSessionGitStats(process.cwd());
    assert.ok(typeof git.isClean === "boolean");
    assert.ok(Array.isArray(git.filesChanged));
    assert.ok(typeof git.insertions === "number");
  });
});
