import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  isEphemeralNotice,
  scrubEphemeralNotices,
  compactToolExecution,
  scrubTurnRecord,
  compactTurnHistory,
} from "../src/features/dc-sentinel/core/dc-sentinel-scrub-edge.ts";
import type {
  SentinelToolExecution,
  SentinelTurnRecord,
} from "../src/features/dc-sentinel/core/dc-sentinel-types.ts";

describe("dc-sentinel-scrub-edge: Filtrado Efímero y Poda de Historial (Patrón Artemis)", () => {
  it("detecta correctamente avisos efímeros de arnés y guardas transitorias", () => {
    assert.equal(isEphemeralNotice("[WARNING] This is your final turn; only 'report_status' is available."), true);
    assert.equal(isEphemeralNotice("You did not call any tools last turn. Please make progress."), true);
    assert.equal(isEphemeralNotice("[REASONING REMINDER] Keep your thoughts focused."), true);
    assert.equal(isEphemeralNotice("<!-- dc:sentinel:memory-pack:start -->"), true);
    assert.equal(isEphemeralNotice("[heartbeat] taxi fleet worker alive"), true);
    assert.equal(isEphemeralNotice("Refactorizar la función auth en src/core/auth.ts"), false);
  });

  it("elimina bloques de guarda, notices efímeros y códigos de color ANSI", () => {
    const raw = `
\x1b[32mTexto normal del usuario\x1b[0m
[WARNING] This is your final turn; wrap up.
<!-- dc:sentinel:memory-pack:start -->
<memory-context title="recuerdo">
- Nota antigua
</memory-context>
<SYSTEM_CUSTOM_STRATEGY_GUARD priority="highest">
Guarda del sistema
</SYSTEM_CUSTOM_STRATEGY_GUARD>
<!-- dc:sentinel:memory-pack:end -->
Instrucción concreta final
    `.trim();

    const scrubbed = scrubEphemeralNotices(raw);

    assert.ok(!scrubbed.includes("This is your final turn"));
    assert.ok(!scrubbed.includes("SYSTEM_CUSTOM_STRATEGY_GUARD"));
    assert.ok(!scrubbed.includes("memory-context"));
    assert.ok(!scrubbed.includes("\x1b[32m"));
    assert.ok(scrubbed.includes("Texto normal del usuario"));
    assert.ok(scrubbed.includes("Instrucción concreta final"));
  });

  it("compacta herramientas a profundidad > 1 eliminando payloads masivos", () => {
    const heavyTool: SentinelToolExecution = {
      callId: "call-123",
      toolName: "read",
      args: { path: "large.json", offset: 0, limit: 1000, extraParam: "foo" },
      startedAt: 1000,
      endedAt: 1045,
      isError: false,
      outputSnippet: "{\"data\": [\"very large json blob...\"]}".repeat(50),
    };

    // Si es reciente, se preserva íntegro
    const recent = compactToolExecution(heavyTool, true);
    assert.equal(recent.outputSnippet, heavyTool.outputSnippet);
    assert.deepEqual(recent.args, heavyTool.args);

    // Si es antiguo (profundidad 1+), se compacta
    const compacted = compactToolExecution(heavyTool, false);
    assert.equal(compacted.outputSnippet, "[OK (45ms)]");
    assert.equal((compacted.args as any)._compacted, true);
  });

  it("preserva el mensaje de error acotado incluso en herramientas antiguas", () => {
    const errorTool: SentinelToolExecution = {
      callId: "call-999",
      toolName: "bash",
      args: { command: "cat nonexistent.txt" },
      startedAt: 1000,
      endedAt: 1020,
      isError: true,
      outputSnippet: "ENOENT: no such file or directory, open 'nonexistent.txt'".repeat(5),
    };

    const compacted = compactToolExecution(errorTool, false);
    assert.equal(compacted.isError, true);
    assert.ok(compacted.outputSnippet?.includes("ENOENT: no such file or directory"));
    assert.ok(compacted.outputSnippet!.length <= 120);
  });

  it("compacta el historial completo de turnos respetando la ventana reciente", () => {
    const turns: SentinelTurnRecord[] = [
      {
        turnId: "turn-1",
        timestamp: "2026-10-19T20:00:00.000Z",
        userPrompt: "Primer paso con aviso [WARNING] This is your final turn",
        toolsExecuted: [
          {
            callId: "c1",
            toolName: "read",
            args: { a: 1, b: 2, c: 3, d: 4 },
            startedAt: 100,
            endedAt: 150,
            isError: false,
            outputSnippet: "Raw payload ".repeat(30),
          },
        ],
        subagentsLaunched: [],
        errorsDetected: ["[WARNING] This is your final turn"],
      },
      {
        turnId: "turn-2",
        timestamp: "2026-10-19T20:01:00.000Z",
        userPrompt: "Segundo paso de compilación",
        toolsExecuted: [
          {
            callId: "c2",
            toolName: "bash",
            args: { command: "npm test" },
            startedAt: 200,
            endedAt: 500,
            isError: false,
            outputSnippet: "Tests passing",
          },
        ],
        subagentsLaunched: [],
        errorsDetected: [],
      },
    ];

    // Con recentWindowSize = 1, el turno 1 es antiguo (compactado) y el turno 2 es reciente
    const compactedHistory = compactTurnHistory(turns, 1);

    // Turno 1 (antiguo): limpiado y compactado
    assert.equal(compactedHistory[0].userPrompt, "Primer paso con aviso");
    assert.equal(compactedHistory[0].toolsExecuted[0].outputSnippet, "[OK (50ms)]");
    assert.equal(compactedHistory[0].errorsDetected.length, 0); // Warning efímero purgado

    // Turno 2 (reciente): íntegro
    assert.equal(compactedHistory[1].userPrompt, "Segundo paso de compilación");
    assert.equal(compactedHistory[1].toolsExecuted[0].outputSnippet, "Tests passing");
  });
});
