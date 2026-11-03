import test from "node:test";
import defaultFs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { dcNotifier } from "../src/integrations/dc-notify/dc-notifier.ts";
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
  extractReferencedFiles,
  verifyItemFreshness,
  DEFAULT_MAX_RECALL_CHARS,
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

test("dc-sentinel: Grounding Gate flags and deprioritizes memories with missing/deleted files", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-grounding-test-"));
  // Crear un archivo real y dejar otro inexistente
  fs.writeFileSync(path.join(tmpDir, "active-module.ts"), "// active code");

  // 1. Test de extracción de referencias de archivos
  const refs = extractReferencedFiles("Refactorizar src/features/old-foo.ts y active-module.ts para mejorar rendimiento");
  assert.ok(refs.includes("src/features/old-foo.ts"));
  assert.ok(refs.includes("active-module.ts"));

  // 2. Test de verificación de frescura
  const freshItem = {
    id: 1,
    type: "feature",
    title: "Módulo Activo",
    content: "Usar active-module.ts para procesar datos",
    scope: "project",
    score: 5,
  };
  const freshCheck = verifyItemFreshness(freshItem, tmpDir);
  assert.equal(freshCheck.isStale, false);

  const staleItem = {
    id: 2,
    type: "bugfix",
    title: "Fix en archivo borrado",
    content: "Corregido en deleted-file.ts y src/legacy.ts",
    scope: "project",
    score: 5,
  };
  const staleCheck = verifyItemFreshness(staleItem, tmpDir);
  assert.equal(staleCheck.isStale, true);
  assert.ok(staleCheck.reason?.includes("deleted-file.ts") || staleCheck.reason?.includes("src/legacy.ts"));

  // 3. Pre-Flight Recall con Grounding Gate: la nota fresca debe ganarle a la obsoleta
  const mockObservations: EngramObservation[] = [
    {
      id: 201,
      type: "bugfix",
      title: "Solución en deleted-file.ts",
      content: "Ver deleted-file.ts para la solución",
      scope: "project",
      created_at: "2026-09-01",
    },
    {
      id: 202,
      type: "decision",
      title: "Arquitectura en active-module.ts",
      content: "Ver active-module.ts para la solución",
      scope: "project",
      created_at: "2026-10-01",
    },
  ];

  const result = performPreFlightRecall("solucion", {
    cwd: tmpDir,
    observationsLoader: () => mockObservations,
    minScore: 1,
    limit: 1,
  });

  // El Grounding Gate debe seleccionar la nota fresca que existe en disco (202), descartando o penalizando la que apunta al archivo inexistente
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.id, 202);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("dc-sentinel: formatRecallPromptSection enforces a strict token/character budget", () => {
  const longItems = [
    {
      id: 1,
      type: "decision",
      title: "Decisión con texto larguísimo 1",
      content: "A".repeat(500),
      scope: "project",
      score: 10,
    },
    {
      id: 2,
      type: "decision",
      title: "Decisión con texto larguísimo 2",
      content: "B".repeat(500),
      scope: "project",
      score: 8,
    },
    {
      id: 3,
      type: "decision",
      title: "Decisión con texto larguísimo 3",
      content: "C".repeat(500),
      scope: "project",
      score: 6,
    },
  ];

  const budget = 450;
  const formatted = formatRecallPromptSection(longItems, budget);
  assert.ok(formatted.length <= budget, `El bloque formateado (${formatted.length}) debe respetar el presupuesto (${budget})`);
  assert.ok(formatted.includes("Decisión con texto larguísimo 1"));
  assert.ok(formatted.includes("<!-- dc:sentinel:recall:end -->"));
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
  const original = { ...prefs };
  assert.equal(writeSentinelPrefs({ recallMinScore: 7, initialMode: "chronicle" }), true);
  assert.equal(readSentinelPrefs().recallMinScore, 7);
  assert.equal(readSentinelPrefs().initialMode, "chronicle");
  assert.equal(writeSentinelPrefs(original), true);
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

test("dc-sentinel: public hooks redact durable capture and live controls gate every hook", async (t) => {
  const childEnv = process.env.GENTLE_PI_AGENTS_CHILD;
  process.env.GENTLE_PI_AGENTS_CHILD = "0";
  t.after(() => { if (childEnv === undefined) delete process.env.GENTLE_PI_AGENTS_CHILD; else process.env.GENTLE_PI_AGENTS_CHILD = childEnv; });
  const frames: any[] = [];
  const chronicles: any[] = [];
  const notices: string[] = [];
  let opens = 0;
  const recorder = new SentinelRecorder("privacy-fixture");
  t.mock.method(recorder, "flushTurnChronicle", (turn: unknown) => { chronicles.push(turn); return null; });
  t.mock.method(dcNotifier, "notify", (_ctx: unknown, msg: string) => { notices.push(msg); return true; });
  const hooks = new Map<string, (...args: any[]) => any>();
  let command: any;
  const pi = {
    on: (name: string, hook: any) => hooks.set(name, hook),
    registerCommand: (name: string, spec: any) => { if (name === "dc-sentinel") command = spec.handler; },
    registerShortcut() {},
  } as unknown as ExtensionAPI;
  const ctx = { cwd: process.env.TMPDIR, hasUI: false } as ExtensionContext;
  writeSentinelPrefs({ enabled: true });
  dcSentinelExtension(pi, {
    recorder, enableRecall: false,
    databaseFactory: () => {
      opens++;
      return { getDbPath: () => ctx.cwd, close() {}, recordFrame: (frame: any) => frames.push(frame),
        saveNote() {}, saveProcedure() {}, getStats: () => ({}) };
    },
  } as any);
  const emit = async (name: string, event: any = {}) => hooks.get(name)?.(event, ctx);
  await emit("session_start");
  const secret = "sk-proj-" + "a".repeat(32);
  await emit("before_agent_start", { prompt: `fix ${secret} <private>user-only</private>` });
  await emit("tool_execution_start", { toolCallId: "task", toolName: "subagent_run",
    args: { agent: "fixture", task: `fix ${secret} <secret>task-only</secret>` } });
  await emit("tool_execution_end", { toolCallId: "task", toolName: "subagent_run",
    output: "<private>" + "hidden-output ".repeat(400) + "</private> visible" });
  const skillToken = "ghp_" + "a".repeat(36);
  const skillArgs = { path: `/skills/${skillToken}/SKILL.md` };
  await emit("tool_execution_start", { toolCallId: "skill", toolName: "read", args: skillArgs });
  await emit("tool_execution_end", { toolCallId: "skill", toolName: "read", args: skillArgs,
    output: "skill instructions", isError: true });
  await emit("message_update", { content: [{ text: `fixed ${secret} <private>assistant-only</private>` }] });
  await emit("agent_settled");
  const capture = JSON.stringify({ frames, chronicles, turns: recorder.getTurns() });
  const skillSummary = recorder.getTurns()[0]!.toolsExecuted.find((tool) => tool.callId === "skill")!.outputSnippet!;
  assert.ok(skillSummary.startsWith("[Skill loaded:"));
  assert.ok(skillSummary.includes("18 bytes omitidos de memoria"));
  assert.ok(!skillSummary.includes(skillToken), "skill summary reintroduced the path token");
  const chronicleMarkdown = recorder.formatTurnMarkdown(chronicles[0]);
  assert.ok(!chronicleMarkdown.includes(skillToken), "durable chronicle leaked the skill path token");
  for (const forbidden of [secret, skillToken, "user-only", "task-only", "assistant-only", "hidden-output"]) {
    assert.ok(!capture.includes(forbidden), `durable capture leaked ${forbidden}`);
  }
  assert.equal(frames.length, 2);
  assert.equal(chronicles.length, 1);

  await emit("before_agent_start", { prompt: "interrupted turn" });
  await command("off", ctx);
  const before = JSON.stringify({ frames, chronicles, turns: recorder.getTurns() });
  const opensBefore = opens;
  for (const name of hooks.keys()) await emit(name, { prompt: "must not capture", content: [{ text: "must not capture" }] });
  assert.equal(JSON.stringify({ frames, chronicles, turns: recorder.getTurns() }), before);
  assert.equal(opens, opensBefore);
  await command("status", ctx);
  assert.match(notices.at(-1)!, /Desactivado/);
  await command("on", ctx);
  await emit("agent_settled");
  assert.equal(chronicles.length, 1, "off/on must not settle a stale turn");
  await emit("before_agent_start", { prompt: "new enabled turn" });
  await emit("agent_settled");
  assert.equal(chronicles.length, 2);

  writeSentinelPrefs({ enabled: false });
  const disabledHooks = new Map<string, any>();
  command = undefined;
  dcSentinelExtension({ ...pi, on: (name: string, hook: any) => disabledHooks.set(name, hook) } as any);
  assert.ok(command, "command remains available when initially disabled");
  assert.ok(disabledHooks.has("before_agent_start"));
  await command("on", ctx);
});

test("dc-sentinel: preference write failure preserves cache and reports command failure", async (t) => {
  const childEnv = process.env.GENTLE_PI_AGENTS_CHILD;
  process.env.GENTLE_PI_AGENTS_CHILD = "0";
  t.after(() => { if (childEnv === undefined) delete process.env.GENTLE_PI_AGENTS_CHILD; else process.env.GENTLE_PI_AGENTS_CHILD = childEnv; });
  writeSentinelPrefs({ enabled: true });
  const before = { ...readSentinelPrefs() };
  let command: any;
  const notices: string[] = [];
  t.mock.method(dcNotifier, "notify", (_ctx: unknown, msg: string) => { notices.push(msg); return true; });
  dcSentinelExtension({ on() {}, registerShortcut() {}, registerCommand(name: string, spec: any) {
    if (name === "dc-sentinel") command = spec.handler;
  } } as any);
  const failingWrite = t.mock.method(defaultFs, "writeFileSync", () => { throw new Error("fixture write failure"); });
  syncBuiltinESMExports();
  try {
    assert.equal(writeSentinelPrefs({ enabled: false }), false);
    assert.deepEqual(readSentinelPrefs(), before);
    await command("off", {});
    assert.match(notices.at(-1)!, /[Ee]rror/);
    assert.ok(!notices.at(-1)!.includes("Desactivado"));
    assert.match(notices.at(-1)!, /solo en esta sesión/);
    await command("on", {});
    assert.match(notices.at(-1)!, /no se activó/);
  } finally {
    failingWrite.mock.restore();
    syncBuiltinESMExports();
  }
});

test("T3: public hooks survive failed switches, use turn root, and close on shutdown", async (t) => {
  const previous = process.env.GENTLE_PI_AGENTS_CHILD;
  process.env.GENTLE_PI_AGENTS_CHILD = "0";
  t.after(() => { if (previous === undefined) delete process.env.GENTLE_PI_AGENTS_CHILD; else process.env.GENTLE_PI_AGENTS_CHILD = previous; });
  writeSentinelPrefs({ enabled: true });
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "hooks-root-"));
  const roots = [path.join(base, "a", "same"), path.join(base, "b", "same")];
  const hooks = new Map<string, any>();
  const opened: string[] = [], closed: string[] = [], frames: any[] = [], chronicles: any[] = [];
  const recorder = new SentinelRecorder("roots", roots[0]);
  t.mock.method(recorder, "flushTurnChronicle", (turn: any) => { chronicles.push(turn); return null; });
  let fail = false;
  dcSentinelExtension({ on: (name: string, hook: any) => hooks.set(name, hook), registerCommand() {}, registerShortcut() {} } as any, {
    recorder, enableRecall: false,
    databaseFactory: (_name, root) => {
      opened.push(root);
      if (fail) throw new Error("fixture unavailable");
      let isClosed = false;
      return { getDbPath: () => `sentinel-same.db`, close: () => { isClosed = true; closed.push(root); },
        recordFrame: (f: any) => { assert.equal(isClosed, false); frames.push({ root, ...f }); },
        saveNote() {}, saveProcedure() {}, getStats: () => ({}) } as any;
    },
  });
  const emit = (name: string, root: string) => hooks.get(name)?.({ prompt: "context root capture" }, { cwd: root });
  await emit("session_start", roots[0]);
  await emit("before_agent_start", path.join(roots[0], "child", ".."));
  await emit("agent_settled", roots[1]);
  assert.equal(frames[1].root, roots[0], "settlement must retain the captured turn root");
  assert.equal(frames[1].project_path, roots[0]);
  assert.equal(opened.length, 1, "lexical aliases reuse the handle");
  fail = true;
  await emit("session_start", roots[1]);
  await emit("before_agent_start", roots[1]);
  await emit("agent_settled", roots[1]);
  assert.equal(chronicles.length, 2, "DB failure must not suppress chronicle");
  assert.equal(closed.length, 1);
  fail = false;
  await emit("before_agent_start", roots[0]);
  await emit("agent_settled", roots[0]);
  assert.equal(frames.length, 4, "failed switch must not reuse the closed handle");
  await emit("session_shutdown", roots[0]);
  assert.equal(closed.length, 2);
});

test("T3: deferred settlement never writes disposed handles after switch or shutdown", async (t) => {
  const child = process.env.GENTLE_PI_AGENTS_CHILD;
  process.env.GENTLE_PI_AGENTS_CHILD = "0";
  t.after(() => { if (child === undefined) delete process.env.GENTLE_PI_AGENTS_CHILD; else process.env.GENTLE_PI_AGENTS_CHILD = child; });
  for (const transition of ["none", "switch", "shutdown", "off-on"]) {
    await t.test(transition, async () => {
    writeSentinelPrefs({ enabled: true });
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "deferred-settlement-"));
    const hooks = new Map<string, any>();
    let command: any, release!: (value: any) => void;
    const pending = new Promise<any>((resolve) => { release = resolve; });
    const writes: string[] = [], staleWrites: string[] = [], chronicles: any[] = [];
    const recorder = new SentinelRecorder("deferred", root);
    t.mock.method(recorder, "flushTurnChronicle", (turn: any) => { chronicles.push(turn); return null; });
    t.mock.method(dcNotifier, "notify", () => true);
    dcSentinelExtension({ on: (name: string, hook: any) => hooks.set(name, hook), registerShortcut() {},
      registerCommand: (name: string, spec: any) => { if (name === "dc-sentinel") command = spec.handler; } } as any, {
      recorder, enableRecall: false, gitStatsExtractor: () => pending,
      databaseFactory: (_name, dbRoot) => {
        let closed = false;
        const save = (kind: string) => {
          if (closed) { staleWrites.push(kind); throw new Error("disposed fixture handle"); }
          writes.push(`${dbRoot}:${kind}`);
        };
        return { close: () => { closed = true; }, getDbPath: () => dbRoot, recordFrame() {},
          saveNote: () => save("note"), saveProcedure: () => save("procedure"), getStats: () => ({}) } as any;
      },
    });
    const emit = (name: string, event: any = {}, cwd = root) => hooks.get(name)?.(event, { cwd });
    await emit("session_start");
    await emit("before_agent_start", { prompt: "fix deferred persistence" });
    await emit("tool_execution_start", { toolCallId: "edit", toolName: "edit", args: { path: "src/fix.ts" } });
    await emit("tool_execution_end", { toolCallId: "edit", toolName: "edit", output: "updated", isError: false });
    await emit("tool_execution_start", { toolCallId: "check", toolName: "bash", args: { command: "npm run typecheck" } });
    await emit("tool_execution_end", { toolCallId: "check", toolName: "bash", output: "passed", isError: false });
    await emit("message_update", { content: [{ text: "### Fix deferred persistence\nCorrected lifecycle ownership." }] });
    const settling = emit("agent_settled");
    assert.equal(writes.length, 0, "extraction is deferred");
    if (transition === "switch") await emit("session_start", {}, path.join(root, "other"));
    if (transition === "shutdown") await emit("session_shutdown");
    if (transition === "off-on") { await command("off", { cwd: root }); await command("on", { cwd: root }); }
    release(undefined);
    await settling;
    assert.deepEqual(staleWrites, [], `${transition}: attempted to write a disposed handle`);
    assert.equal(writes.length, transition === "none" ? 2 : 0, `${transition}: only the owning lifecycle may persist`);
    assert.equal(chronicles.length, transition === "none" ? 1 : 0, `${transition}: stale settlement must not flush under a new lifecycle`);
    await emit("session_shutdown");
    });
  }
});

test("T4a: public capture retains explicit host status/result and rejects stale turn completions", async (t) => {
  const child = process.env.GENTLE_PI_AGENTS_CHILD;
  process.env.GENTLE_PI_AGENTS_CHILD = "0";
  t.after(() => { if (child === undefined) delete process.env.GENTLE_PI_AGENTS_CHILD; else process.env.GENTLE_PI_AGENTS_CHILD = child; });
  const hooks = new Map<string, (...args: any[]) => any>();
  const recorder = new SentinelRecorder("evidence");
  const notes: any[] = [], procedures: any[] = [];
  t.mock.method(recorder, "flushTurnChronicle", () => null);
  const ctx = { cwd: process.env.TMPDIR, hasUI: false } as ExtensionContext;
  writeSentinelPrefs({ enabled: true });
  dcSentinelExtension({ on: (name: string, hook: any) => hooks.set(name, hook),
    registerCommand() {}, registerShortcut() {} } as unknown as ExtensionAPI, {
    recorder, enableRecall: false, enableJournal: true,
    gitStatsExtractor: async () => ({ filesChanged: [], insertions: 0, deletions: 0, statSummary: "", isClean: true }),
    databaseFactory: () => ({ getDbPath: () => ctx.cwd, close() {}, recordFrame() {},
      saveNote: (n: any) => notes.push(n), saveProcedure: (p: any) => procedures.push(p) }),
  } as any);
  const emit = async (name: string, event: any = {}) => hooks.get(name)?.(event, ctx);
  const run = async (id: string, toolName: string, args: any, status?: boolean) => {
    await emit("tool_execution_start", { toolCallId: id, toolName, args });
    await emit("tool_execution_end", { toolCallId: id, toolName,
      result: { content: [{ type: "text", text: "host actual result" }] },
      ...(status === undefined ? {} : { isError: status }) });
  };
  await emit("before_agent_start", { prompt: "fix auth bug" });
  await run("e", "edit", { path: "src/auth.ts" }, false);
  await run("v", "bash", { command: "npm test" }, false);
  await emit("agent_settled");
  assert.equal(notes.at(-1).proofCount, 1);
  assert.equal(procedures.length, 1);
  assert.match(notes.at(-1).content, /host actual result/);
  assert.equal(recorder.getTurns()[0].project_path, ctx.cwd);
  await emit("before_agent_start", { prompt: "fix auth bug" });
  await run("e2", "edit", { path: "src/auth.ts" }, false);
  await run("v2", "bash", { command: "npm test" });
  await emit("agent_settled");
  assert.equal(notes.at(-1).proofCount, 0);
  assert.equal(procedures.length, 1);
  recorder.startTurn("old");
  recorder.recordToolStart("late", "edit", { path: "src/auth.ts" });
  recorder.startTurn("new");
  recorder.recordToolEnd("late", "ok", false);
  assert.equal(recorder.getActiveTurn()?.toolsExecuted.length, 0);
  await emit("session_shutdown");
});

test("dc-sentinel: scientific extraction captures assistant experience facts, edited files, procedures and skips noise", async () => {
  const {
    extractDeterministicNotes,
    extractDeterministicProcedures,
    compressCavememProse,
    resolveMetroLine,
  } = await import("../src/features/dc-sentinel/core/dc-sentinel-deterministic-extractor.ts");

  // 1. Compresión Cavemem preserva código y elimina muletillas
  const rawProse = "¡Listo, che! Por favor tener en cuenta que editamos `src/ui/dc-window.ts` con `minRows = 36`.";
  const compressed = compressCavememProse(rawProse);
  assert.ok(!compressed.toLowerCase().includes("listo, che"));
  assert.ok(compressed.includes("`src/ui/dc-window.ts`"));
  assert.ok(compressed.includes("`minRows = 36`"));

  // 2. Turno trivial ("hola como vamos") se salta (When to Skip)
  const trivialTurn = {
    turnId: "turn-1",
    timestamp: new Date().toISOString(),
    userPrompt: "hola como vamos",
    toolsExecuted: [],
    subagentsLaunched: [],
    errorsDetected: [],
    assistantSummary: "Todo impecable.",
  };
  const skippedNotes = extractDeterministicNotes([trivialTurn], "dc-pi");
  assert.equal(skippedNotes.length, 0, "No debe guardar notas para saludos triviales sin cambios");

  // 3. Turno con instrucción corta pero edición real de código + verificación -> extrae Nota autocontenida y Receta
  const workTurn = {
    turnId: "turn-2",
    timestamp: new Date().toISOString(),
    userPrompt: "dale 12 mas para ver como se ve",
    toolsExecuted: [
      {
        callId: "c1",
        toolName: "edit",
        args: { path: "src/features/dc-changes/dc-changes-panel.ts" },
        startedAt: 100,
        endedAt: 200,
        isError: false,
      },
      {
        callId: "c2",
        toolName: "bash",
        args: { command: "npm run typecheck && node --test .test-build/test/dc-changes.test.js" },
        startedAt: 200,
        endedAt: 500,
        isError: false,
      },
    ],
    subagentsLaunched: [],
    errorsDetected: [],
    assistantSummary: "### Ajuste de Altura en dc-changes\nSe incrementó `minRows` de 24 a 36 filas en `DcChangesPanel` para expandir el diff.",
  };

  const notes = extractDeterministicNotes([workTurn], "dc-pi");
  assert.equal(notes.length, 1);
  assert.equal(notes[0]!.type, "change");
  assert.ok(notes[0]!.title.includes("Ajuste de Altura en dc-changes"));
  assert.ok(notes[0]!.content.includes("Se incrementó `minRows` de 24 a 36 filas"));
  assert.ok(notes[0]!.filesAffected?.includes("src/features/dc-changes/dc-changes-panel.ts"));

  // Verificar clasificación de Línea de Metro
  const metro = resolveMetroLine(notes[0]!);
  assert.equal(metro.code, "L5");

  // Verificar extracción de Receta (Procedure)
  const procs = extractDeterministicProcedures([workTurn], "dc-pi");
  assert.equal(procs.length, 1);
  assert.ok(procs[0]!.title.includes("Ajuste de Altura en dc-changes"));
  assert.ok(procs[0]!.verificationCmd?.includes("npm run typecheck"));
  assert.ok(procs[0]!.steps.some((s) => s.includes("dc-changes-panel.ts")));
});
