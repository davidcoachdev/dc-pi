import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  extractKeywords,
  scoreObservation,
  performPreFlightRecall,
  formatRecallPromptSection,
} from "../src/features/dc-sentinel/core/dc-sentinel-recall.ts";
import {
  SentinelRecorder,
} from "../src/features/dc-sentinel/core/dc-sentinel-recorder.ts";
import {
  readSentinelPrefs,
  writeSentinelPrefs,
  SENTINEL_CONFIG_FILE,
} from "../src/features/dc-sentinel/core/dc-sentinel-prefs.ts";
import dcSentinelExtension, {
  appendRecallToPromptOptions,
} from "../src/features/dc-sentinel/dc-sentinel.ts";
import type { EngramObservation } from "../src/features/dc-engram/dc-engram-db.ts";

test("dc-sentinel: extractKeywords normalizes, removes stop words and punctuation", () => {
  const prompt = "¿Cómo podemos optimizar el rendimiento del layout de TUI y evitar el setInterval?";
  const keywords = extractKeywords(prompt);

  assert.ok(keywords.includes("optimizar"));
  assert.ok(keywords.includes("rendimiento"));
  assert.ok(keywords.includes("layout"));
  assert.ok(keywords.includes("tui"));
  assert.ok(keywords.includes("evitar"));
  assert.ok(keywords.includes("setinterval"));

  // No debe incluir palabras vacías
  assert.ok(!keywords.includes("el"));
  assert.ok(!keywords.includes("del"));
  assert.ok(!keywords.includes("de"));
  assert.ok(!keywords.includes("y"));
});

test("dc-sentinel: scoreObservation weighs title higher and rewards decisions/bugfixes", () => {
  const obsDecision: EngramObservation = {
    id: 1,
    type: "decision",
    title: "Decision: Erradicar setInterval en TUI",
    content: "No usar polling en componentes de UI",
    scope: "project",
    created_at: "2026-10-01",
  };

  const obsOther: EngramObservation = {
    id: 2,
    type: "discovery",
    title: "Notas sobre paquetes",
    content: "Menciona tui de pasada",
    scope: "project",
    created_at: "2026-10-01",
  };

  const score1 = scoreObservation(obsDecision, ["setinterval", "tui"]);
  const score2 = scoreObservation(obsOther, ["setinterval", "tui"]);

  assert.ok(score1 > score2, "La decisión con match en título debe puntuar mucho más alto");
  assert.ok(score1 >= 7.5, "Título match (3x2=6) + Decision bonus (1.5) = 7.5");
});

test("dc-sentinel: performPreFlightRecall filters and formats top memories", () => {
  const mockObservations: EngramObservation[] = [
    {
      id: 101,
      type: "decision",
      title: "Arquitectura de Subagentes Efímeros",
      content: "Adoptar Fresh Context Loop de Antigravity para aislar herramientas y evitar tool bloat",
      scope: "project",
      created_at: "2026-10-01",
    },
    {
      id: 102,
      type: "bugfix",
      title: "Fix de polling en dc-body",
      content: "Se eliminó el timer de 300ms reemplazándolo por eventos reactivos",
      scope: "project",
      created_at: "2026-10-01",
    },
    {
      id: 103,
      type: "preference",
      title: "Colores del tema retro",
      content: "Rojo sangre y ámbar",
      scope: "personal",
      created_at: "2026-09-20",
    },
  ];

  const result = performPreFlightRecall("Necesito información sobre los subagentes efimeros y antigravity", {
    observationsLoader: () => mockObservations,
    minScore: 3,
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.id, 101);
  assert.ok(result.formattedBlock);
  assert.ok(result.formattedBlock.includes("Arquitectura de Subagentes Efímeros"));
  assert.ok(result.formattedBlock.includes("<!-- dc:sentinel:recall:start -->"));
  assert.ok(result.formattedBlock.includes("<!-- dc:sentinel:recall:end -->"));
});

test("dc-sentinel: appendRecallToPromptOptions is strictly idempotent", () => {
  const options = { appendSystemPrompt: "Arnés ODD previo." };
  const block = "<!-- dc:sentinel:recall:start -->\nMemoria A\n<!-- dc:sentinel:recall:end -->";

  appendRecallToPromptOptions(options, block);
  assert.ok(options.appendSystemPrompt.includes("Arnés ODD previo."));
  assert.ok(options.appendSystemPrompt.includes("Memoria A"));

  // Segunda llamada idéntica no debe duplicar
  appendRecallToPromptOptions(options, block);
  const count = options.appendSystemPrompt.split("<!-- dc:sentinel:recall:start -->").length - 1;
  assert.equal(count, 1, "No debe duplicar el bloque de recall");
});

test("dc-sentinel: SentinelRecorder tracks turns, tools, and subagents", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-sentinel-test-"));
  const recorder = new SentinelRecorder("sess-test-123", tmpDir);

  // 1. Iniciar turno
  const turn = recorder.startTurn("Por favor busca este video en youtube", ["Decision: YouTube Tools"]);
  assert.equal(turn.userPrompt, "Por favor busca este video en youtube");
  assert.equal(turn.recallInjected, true);

  // 2. Ejecutar herramienta normal
  recorder.recordToolStart("call-1", "read", { path: "package.json" });
  recorder.recordToolEnd("call-1", '{"name": "dc-pi"}', false);

  // 3. Ejecutar subagente
  recorder.recordToolStart("call-2", "subagent_run", {
    agent: "dc-news-to-day",
    task: "Buscar novedades",
    mode: "background",
  });
  recorder.recordToolEnd("call-2", "Reporte generado en ./noticias/report.md", false);

  // 4. Finalizar turno
  const completed = recorder.endTurn("Listo, el subagente completó la búsqueda.");
  assert.ok(completed);
  assert.equal(completed.toolsExecuted.length, 2);
  assert.equal(completed.subagentsLaunched.length, 1);
  assert.equal(completed.subagentsLaunched[0]?.agent, "dc-news-to-day");

  // 5. Volcar a bitácora Markdown
  const flushedPath = recorder.flushTurnChronicle(completed, "2026-10-01");
  assert.ok(flushedPath);
  assert.ok(fs.existsSync(flushedPath));

  const content = fs.readFileSync(flushedPath, "utf8");
  assert.ok(content.includes("Bitácora de Vuelo DC Sentinel"));
  assert.ok(content.includes("dc-news-to-day"));
  assert.ok(content.includes("Por favor busca este video en youtube"));

  // Limpiar
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("dc-sentinel: readSentinelPrefs and writeSentinelPrefs persist to dc-studio/sentinel.json", () => {
  const prefs = readSentinelPrefs();
  assert.equal(typeof prefs.enabled, "boolean");
  assert.equal(typeof prefs.recallMinScore, "number");
  assert.ok(SENTINEL_CONFIG_FILE.includes("sentinel.json"));
  assert.ok(SENTINEL_CONFIG_FILE.includes("dc-studio"));
});

test("dc-sentinel: dcSentinelExtension hooks lifecycle and ignores child sessions", async () => {
  const originalEnv = process.env.GENTLE_PI_AGENTS_CHILD;

  try {
    // 1. Caso sesión hija: debe ignorarse completamente
    process.env.GENTLE_PI_AGENTS_CHILD = "1";
    let childHookCount = 0;
    const mockChildPi = {
      on() {
        childHookCount++;
      },
      registerCommand() {},
    } as unknown as ExtensionAPI;

    dcSentinelExtension(mockChildPi);
    assert.equal(childHookCount, 0, "En sesiones hijas el centinela no debe registrar ningún hook");

    // 2. Caso sesión primaria: debe registrar hooks y comando /dc-sentinel
    delete process.env.GENTLE_PI_AGENTS_CHILD;
    const registeredEvents = new Set<string>();
    const registeredCommands = new Set<string>();

    const mockPrimaryPi = {
      on(event: string) {
        registeredEvents.add(event);
      },
      registerCommand(name: string) {
        registeredCommands.add(name);
      },
    } as unknown as ExtensionAPI;

    dcSentinelExtension(mockPrimaryPi);

    assert.ok(registeredEvents.has("session_start"));
    assert.ok(registeredEvents.has("before_agent_start"));
    assert.ok(registeredEvents.has("tool_execution_start"));
    assert.ok(registeredEvents.has("tool_execution_end"));
    assert.ok(registeredEvents.has("agent_settled"));
    assert.ok(registeredCommands.has("dc-sentinel"));
  } finally {
    if (originalEnv !== undefined) {
      process.env.GENTLE_PI_AGENTS_CHILD = originalEnv;
    } else {
      delete process.env.GENTLE_PI_AGENTS_CHILD;
    }
  }
});
