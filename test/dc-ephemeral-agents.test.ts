import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  isProcessAlive,
  createInitialFleetState,
  loadFleetState,
  saveFleetState,
  leaseTaxi,
  releaseTaxi,
  heartbeatTaxi,
  reapAbandonedTaxis,
  getFleetStatusSummary,
  acquireOrchestratorTaxi,
  releaseOrchestratorTaxi,
} from "../src/features/dc-agents/core/dc-taxi-dispatcher.ts";

import {
  calibrateEffortForTask,
  resolveExecutionModel,
  loadDcAgentsConfig,
  saveDcAgentsConfig,
} from "../src/features/dc-agents/core/dc-effort-policy.ts";

import {
  recordTaxiTrip,
  loadTaxiTripHistory,
  getTaxiHistoryMetrics,
  getUnitTaxiMetrics,
  getAgentUsageRanking,
} from "../src/features/dc-agents/core/dc-taxi-history.ts";

import {
  appendTaxiLog,
  readRecentTaxiLogs,
} from "../src/features/dc-agents/core/dc-taxi-logger.ts";

import {
  prepareEphemeralAgent,
  cleanupEphemeralAgent,
  dcCleanOrphanedEphemeralAgents,
  isolateSpecializedToolsForOrchestrator,
} from "../src/features/dc-agents/core/dc-ephemeral-manager.ts";

import { DcTaxisPanel } from "../src/features/dc-agents/views/dc-taxis-panel.ts";
import { registerDcEphemeralTools } from "../src/features/dc-agents/tools/dc-ephemeral-tools.ts";
import { DC_TOOL_PRESETS } from "../src/features/dc-agents/core/dc-ephemeral-types.ts";

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `dc-test-${prefix}-`));
}

test("dc-taxi-dispatcher: isProcessAlive detects live vs dead PIDs accurately", () => {
  // PID actual debe estar vivo
  assert.equal(isProcessAlive(process.pid), true);

  // PID inválido o inexistente
  assert.equal(isProcessAlive(-1), false);
  assert.equal(isProcessAlive(0), false);
  assert.equal(isProcessAlive(99999999), false);
});

test("dc-taxi-dispatcher: initial state and atomic fleet persistence", () => {
  const tempDir = createTempDir("fleet");
  const fleetPath = path.join(tempDir, "dc-taxis.json");

  try {
    const customAccounts = ["ac01", "ac02", "ac03"];
    const initial = loadFleetState(fleetPath, customAccounts);

    assert.equal(Object.keys(initial.fleet).length, 3);
    assert.equal(initial.fleet["ac01"].status, "libre");
    assert.equal(initial.fleet["ac01"].passenger, null);

    // Modificar y guardar
    initial.fleet["ac01"].status = "ocupado";
    saveFleetState(initial, fleetPath);

    const reloaded = loadFleetState(fleetPath, customAccounts);
    assert.equal(reloaded.fleet["ac01"].status, "ocupado");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("dc-taxi-dispatcher: leaseTaxi respects preferred account and allocates next available", () => {
  const tempDir = createTempDir("lease");
  const fleetPath = path.join(tempDir, "dc-taxis.json");

  try {
    const customAccounts = ["ac01", "ac02"];
    const initial = createInitialFleetState(customAccounts);
    saveFleetState(initial, fleetPath);

    // 1. Arrendar cuenta preferida ac02
    const lease1 = leaseTaxi(
      {
        type: "ephemeral_subagent",
        sessionId: "sess-1",
        pid: process.pid,
        model: "gemini-3.8-flash-high",
      },
      "ac02",
      fleetPath,
      300000,
      customAccounts,
    );

    assert.ok(lease1);
    assert.equal(lease1.account, "ac02");
    assert.equal(lease1.unit.status, "ocupado");

    // 2. Intentar pedir ac02 nuevamente (está ocupada) -> debe entregar ac01
    const lease2 = leaseTaxi(
      {
        type: "ephemeral_subagent",
        sessionId: "sess-2",
        pid: process.pid,
        model: "gemini-3.8-flash-high",
      },
      "ac02",
      fleetPath,
      300000,
      customAccounts,
    );

    assert.ok(lease2);
    assert.equal(lease2.account, "ac01");
    assert.equal(lease2.unit.status, "ocupado");

    // 3. Intentar pedir otra unidad cuando la flota está agotada -> debe retornar null
    const lease3 = leaseTaxi(
      {
        type: "ephemeral_subagent",
        sessionId: "sess-3",
        pid: process.pid,
        model: "gemini-3.8-flash-high",
      },
      undefined,
      fleetPath,
      300000,
      customAccounts,
    );

    assert.equal(lease3, null);

    // 4. Liberar ac02
    const released = releaseTaxi("ac02", "sess-1", fleetPath, customAccounts);
    assert.equal(released, true);

    // 5. Ahora ac02 vuelve a estar libre
    const summary = getFleetStatusSummary(fleetPath, customAccounts);
    assert.equal(summary.libres, 1);
    assert.equal(summary.ocupados, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("dc-taxi-dispatcher: reapAbandonedTaxis auto-recovers dead PID and expired TTL taxis", () => {
  const tempDir = createTempDir("reap");
  const fleetPath = path.join(tempDir, "dc-taxis.json");

  try {
    const state = createInitialFleetState(["ac01", "ac02", "ac03"]);

    // ac01 con PID muerto
    state.fleet["ac01"].status = "ocupado";
    state.fleet["ac01"].passenger = {
      type: "subagent",
      sessionId: "dead-sess",
      pid: 99999999, // muerto
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
    };

    // ac02 con TTL expirado (10 minutos atrás)
    state.fleet["ac02"].status = "ocupado";
    state.fleet["ac02"].passenger = {
      type: "ephemeral_subagent",
      sessionId: "expired-sess",
      pid: process.pid, // PID vivo pero TTL vencido
      startedAt: Date.now() - 600000,
      heartbeatAt: Date.now() - 600000,
    };

    // ac03 activo y sano
    state.fleet["ac03"].status = "ocupado";
    state.fleet["ac03"].passenger = {
      type: "orchestrator",
      sessionId: "healthy-sess",
      pid: process.pid,
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
    };

    saveFleetState(state, fleetPath);

    const reaped = reapAbandonedTaxis(state, 300000); // 5 min TTL
    assert.equal(reaped, 2);

    assert.equal(state.fleet["ac01"].status, "libre");
    assert.equal(state.fleet["ac02"].status, "libre");
    assert.equal(state.fleet["ac03"].status, "ocupado");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("dc-taxi-dispatcher: acquireOrchestratorTaxi prevents collisions between multiple Pi terminals", () => {
  const tempDir = createTempDir("multi-pi");
  const fleetPath = path.join(tempDir, "dc-taxis.json");

  try {
    const customAccounts = ["ac01", "ac02", "ac03"];
    saveFleetState(createInitialFleetState(customAccounts), fleetPath);

    // Terminal 1 arranca con ac02
    const res1 = acquireOrchestratorTaxi(
      "sess-term-1",
      "cpam/ac02/gemini-3.8-flash-high",
      fleetPath,
      process.pid,
      customAccounts,
    );

    assert.ok(res1);
    assert.equal(res1.account, "ac02");
    assert.equal(res1.changed, false);
    assert.equal(res1.modelId, "cpam/ac02/gemini-3.8-flash-high");

    // Terminal 2 (en otro PID vivo) arranca TAMBIÉN pidiendo ac02 por default
    // Como ac02 está ocupada por Terminal 1, debe auto-reasignar el primer taxi libre (ac01)
    const res2 = acquireOrchestratorTaxi(
      "sess-term-2",
      "cpam/ac02/gemini-3.8-flash-high",
      fleetPath,
      process.ppid, // PID vivo del proceso padre
      customAccounts,
    );

    assert.ok(res2);
    assert.equal(res2.account, "ac01");
    assert.equal(res2.changed, true);
    assert.equal(res2.modelId, "cpam/ac01/gemini-3.8-flash-high");

    // Ambas terminales están registradas como ocupadas en taxis diferentes
    const summary = getFleetStatusSummary(fleetPath, customAccounts);
    assert.equal(summary.ocupados, 2);
    assert.equal(summary.libres, 1);

    // Terminal 1 se cierra y libera su taxi
    releaseOrchestratorTaxi("sess-term-1", process.pid, fleetPath, customAccounts);
    const summaryAfter = getFleetStatusSummary(fleetPath, customAccounts);
    assert.equal(summaryAfter.ocupados, 1);
    assert.equal(summaryAfter.libres, 2);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("dc-taxi-dispatcher: acquireOrchestratorTaxi auto-binds free CPAM taxi when starting with non-CPAM model or no default", () => {
  const tempDir = createTempDir("kimi-fallback");
  const fleetPath = path.join(tempDir, "dc-taxis.json");

  try {
    const customAccounts = ["ac01", "ac02"];
    saveFleetState(createInitialFleetState(customAccounts), fleetPath);

    // Terminal arranca con un modelo externo (ej: Kimi de opencode-go)
    const resKimi = acquireOrchestratorTaxi(
      "sess-kimi",
      "opencode-go/kimi-k2.7-code",
      fleetPath,
      process.pid,
      customAccounts,
    );

    assert.ok(resKimi);
    assert.equal(resKimi.changed, true);
    assert.equal(resKimi.account, "ac01");
    assert.equal(resKimi.modelId, "cpam/ac01/gemini-3.8-flash-high");

    // Terminal arranca sin modelo previo (undefined)
    const resNoModel = acquireOrchestratorTaxi(
      "sess-none",
      undefined,
      fleetPath,
      process.ppid,
      customAccounts,
    );

    assert.ok(resNoModel);
    assert.equal(resNoModel.changed, true);
    assert.equal(resNoModel.account, "ac02");
    assert.equal(resNoModel.modelId, "cpam/ac02/gemini-3.8-flash-high");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("dc-effort-policy: calibrateEffortForTask respects presets, keywords and parent fallback", () => {
  // Presets
  assert.equal(calibrateEffortForTask("extraer video", "youtube"), "low");
  assert.equal(calibrateEffortForTask("generar audio", "audio"), "low");
  assert.equal(calibrateEffortForTask("inspeccionar DOM", "browser"), "medium");
  assert.equal(calibrateEffortForTask("consultar endpoint", "api"), "medium");
  assert.equal(calibrateEffortForTask("analizar impacto", "codegraph"), "high");

  // Palabras clave
  assert.equal(calibrateEffortForTask("por favor transcribe el video"), "low");
  assert.equal(calibrateEffortForTask("investigate bug concurrency and deadlock in mutex"), "high");

  // Override explícito gana siempre
  assert.equal(calibrateEffortForTask("tarea simple", "youtube", "high"), "high");

  // Fallback al padre
  assert.equal(calibrateEffortForTask("tarea general sin preset ni keywords", undefined, undefined, "high"), "high");
  assert.equal(calibrateEffortForTask("tarea general", undefined, undefined, "low"), "low");
});

test("dc-effort-policy: resolveExecutionModel enforces provider policy and parses account refs", () => {
  // 1. Force Gemini
  const res1 = resolveExecutionModel({
    config: {
      routing: {
        defaultSubagentProvider: "cpam",
        defaultSubagentModel: "gemini-3.8-flash-high",
        enforceProviderPolicy: "force_gemini",
        fallbackToParent: false,
      },
      ephemeral: {} as any,
      accountPool: {} as any,
    },
    parentModel: "openai/gpt-5.5",
  });

  assert.equal(res1.provider, "cpam");
  assert.equal(res1.baseModelName, "gemini-3.8-flash-high");

  // 2. Modelo explícito con cuenta cpam/ac03/gemini-3.8-flash-high
  const res2 = resolveExecutionModel({
    requestedModel: "cpam/ac03/gemini-3.8-flash-high",
  });
  assert.equal(res2.provider, "cpam");
  assert.equal(res2.requestedAccount, "ac03");
  assert.equal(res2.baseModelName, "gemini-3.8-flash-high");
});

test("dc-taxi-history: records trips, bounds history and computes aggregate metrics", () => {
  const tempDir = createTempDir("history");
  const historyPath = path.join(tempDir, "dc-taxis-history.json");

  try {
    recordTaxiTrip(
      {
        tripId: "t1",
        account: "ac01",
        passengerType: "ephemeral_subagent",
        model: "cpam/ac01/gemini-3.8-flash-high",
        sessionId: "s1",
        startedAt: 1000,
        endedAt: 6000,
        durationMs: 5000,
        tokens: { input: 100, output: 50, reasoning: 200, total: 350 },
        costEstimated: 0.001,
        status: "completed",
      },
      historyPath,
    );

    recordTaxiTrip(
      {
        tripId: "t2",
        account: "ac02",
        passengerType: "ephemeral_subagent",
        model: "cpam/ac02/gemini-3.8-flash-high",
        sessionId: "s1",
        startedAt: 10000,
        endedAt: 14000,
        durationMs: 4000,
        tokens: { input: 200, output: 80, reasoning: 0, total: 280 },
        costEstimated: 0.0008,
        status: "failed",
      },
      historyPath,
    );

    const history = loadTaxiTripHistory(10, historyPath);
    assert.equal(history.length, 2);

    const metrics = getTaxiHistoryMetrics(historyPath);
    assert.equal(metrics.totalTrips, 2);
    assert.equal(metrics.completedTrips, 1);
    assert.equal(metrics.failedTrips, 1);
    assert.equal(metrics.totalTokens, 630);
    assert.equal(metrics.totalDurationMs, 9000);
    assert.equal(metrics.successRate, 50);

    // Métricas por unidad ac01
    const ac01Metrics = getUnitTaxiMetrics("ac01", historyPath);
    assert.equal(ac01Metrics.totalTrips, 1);
    assert.equal(ac01Metrics.completedTrips, 1);
    assert.equal(ac01Metrics.totalTokens, 350);
    assert.equal(ac01Metrics.successRate, 100);

    // Métricas por unidad ac02
    const ac02Metrics = getUnitTaxiMetrics("ac02", historyPath);
    assert.equal(ac02Metrics.totalTrips, 1);
    assert.equal(ac02Metrics.failedTrips, 1);
    assert.equal(ac02Metrics.totalTokens, 280);
    assert.equal(ac02Metrics.successRate, 0);

    // Ranking de subagentes
    const ranking = getAgentUsageRanking(historyPath);
    assert.ok(ranking.length > 0);
    assert.equal(ranking[0].totalTrips, 2);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("dc-taxi-logger: appends structured logs and retrieves recent lines", () => {
  const tempDir = createTempDir("logger");
  const logPath = path.join(tempDir, "dc-taxis.log");

  try {
    appendTaxiLog("INFO", "TEST_EVENT_1", { key: "val1" }, logPath);
    appendTaxiLog("WARN", "TEST_EVENT_2", { key: "val2" }, logPath);

    const logs = readRecentTaxiLogs(10, logPath);
    assert.equal(logs.length, 2);
    assert.ok(logs[0].includes("TEST_EVENT_2")); // más reciente primero
    assert.ok(logs[1].includes("TEST_EVENT_1"));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("dc-ephemeral-manager: prepareEphemeralAgent and cleanup lifecycle", () => {
  // Prepara un agente efímero real
  const plan = prepareEphemeralAgent(
    {
      task: "Buscar tutoriales de React 19 y extraer transcripción",
      toolPreset: "youtube",
      seedContext: "Target query: 'React 19 Server Components'",
    },
    {
      sessionId: "test-sess-lifecycle",
      parentModel: "cpam/ac05/gemini-3.8-flash-high",
      pid: process.pid,
    },
  );

  assert.ok(plan.agentName.startsWith("dc-ephem-"));
  assert.ok(fs.existsSync(plan.agentFilePath));
  assert.equal(plan.tools.length, DC_TOOL_PRESETS.youtube.length);
  assert.equal(plan.effectiveEffort, "low"); // Preset youtube -> low

  // Contenido del markdown efímero generado
  const mdContent = fs.readFileSync(plan.agentFilePath, "utf8");
  assert.ok(mdContent.includes(plan.agentName));
  assert.ok(mdContent.includes("dc_youtube_search"));
  assert.ok(mdContent.includes("React 19 Server Components"));

  // Limpieza
  cleanupEphemeralAgent(plan, {
    sessionId: "test-sess-lifecycle",
    startedAt: Date.now() - 2000,
    endedAt: Date.now(),
    status: "completed",
    tokens: { total: 420 },
  });

  // El archivo efímero debe haber sido destruido
  assert.equal(fs.existsSync(plan.agentFilePath), false);
});

test("dc-ephemeral-tools: registerDcEphemeralTools registers tool in ExtensionAPI", () => {
  const registered: any[] = [];
  const fakePi = {
    registerTool(toolDef: any) {
      registered.push(toolDef);
    },
  } as any;

  registerDcEphemeralTools(fakePi);

  assert.equal(registered.length, 1);
  assert.equal(registered[0].name, "dc_ephemeral_agent_run");
  assert.ok(registered[0].parameters.properties.task);
  assert.ok(registered[0].parameters.properties.toolPreset);
  assert.ok(registered[0].parameters.properties.effort);
});

test("dc-ephemeral-tools: dc_ephemeral_agent_run executes subagent atomically and cleans up in finally", async () => {
  const registered: any[] = [];
  const fakePi = {
    registerTool(toolDef: any) {
      registered.push(toolDef);
    },
  } as any;

  registerDcEphemeralTools(fakePi);
  const tool = registered[0];

  let executeToolCalled = false;
  let executedAgentName = "";
  const fakeCtx = {
    sessionManager: { getSessionId: () => "sess-atomic-test" },
    model: { provider: "cpam", id: "ac05/gemini-3.8-flash-high" },
    executeTool: async (name: string, args: any) => {
      executeToolCalled = true;
      executedAgentName = args.agent;
      assert.equal(name, "subagent_run");
      assert.equal(args.task, "Auditoría de prueba");
      return { content: [{ type: "text", text: "Auditoría completada sin fallos." }] };
    },
  } as any;

  const result = await tool.execute(
    "call-1",
    { task: "Auditoría de prueba", toolPreset: "youtube", role: "auditor" },
    undefined,
    undefined,
    fakeCtx,
  );

  assert.equal(executeToolCalled, true);
  assert.ok(executedAgentName.startsWith("dc-ephem-"));
  assert.equal(result.content[0].text, "Auditoría completada sin fallos.");

  // Comprobar que el archivo temporal .md ya fue eliminado en el bloque finally
  const agentPath = path.join(os.homedir(), ".pi", "agent", "agents", `${executedAgentName}.md`);
  assert.equal(fs.existsSync(agentPath), false);
});

test("dc-ephemeral-manager: isolateSpecializedToolsForOrchestrator removes heavy tools from active set while keeping dc_ephemeral_agent_run", () => {
  let appliedActiveTools: string[] = [];
  const fakePi = {
    getActiveTools: () => [
      "read",
      "bash",
      "edit",
      "write",
      "todo",
      "dc_youtube_search",
      "dc_youtube_video_get",
      "dc_browser_status",
      "dc_api_rest",
      "dc_services_list",
    ],
    setActiveTools: (tools: string[]) => {
      appliedActiveTools = tools;
    },
  };

  const report = isolateSpecializedToolsForOrchestrator(fakePi);

  assert.equal(report.removedCount > 0, true);
  assert.equal(appliedActiveTools.includes("read"), true);
  assert.equal(appliedActiveTools.includes("bash"), true);
  assert.equal(appliedActiveTools.includes("dc_ephemeral_agent_run"), true);
  assert.equal(appliedActiveTools.includes("dc_youtube_search"), false);
  assert.equal(appliedActiveTools.includes("dc_browser_status"), false);
  assert.equal(appliedActiveTools.includes("dc_api_rest"), false);
});

test("dc-taxis-panel: renders all 3 tabs cleanly without crashing", () => {
  const fakeTheme = {
    bold: (s: string) => `*${s}*`,
    fg: (_c: string, s: string) => s,
    bg: (_c: string, s: string) => s,
  } as any;

  let doneCalled = false;
  const panel = new DcTaxisPanel({
    theme: fakeTheme,
    onDone: () => {
      doneCalled = true;
    },
    requestRender: () => {},
  });

  // 1. Render Pestaña 1 (Flota)
  const linesTab1 = panel.render(80);
  assert.ok(linesTab1.length > 0);
  assert.ok(linesTab1.some((l) => l.includes("Flota de Taxis")));

  // 2. Alternar a Pestaña 2 (Historial)
  panel.handleInput("2");
  const linesTab2 = panel.render(80);
  assert.ok(linesTab2.some((l) => l.includes("Historial y Tokens")));

  // 3. Alternar a Pestaña 3 (Logs)
  panel.handleInput("3");
  const linesTab3 = panel.render(80);
  assert.ok(linesTab3.some((l) => l.includes("Auditoría y Logs")));

  // 4. Salir con escape
  panel.handleInput("q");
  assert.equal(doneCalled, true);
});

test("dc-taxis-panel: escape key clears search input first and only closes modal when empty", () => {
  const fakeTheme = {
    bold: (s: string) => `*${s}*`,
    fg: (_c: string, s: string) => s,
    bg: (_c: string, s: string) => s,
  } as any;

  let doneCalled = false;
  const panel = new DcTaxisPanel({
    theme: fakeTheme,
    onDone: () => {
      doneCalled = true;
    },
    requestRender: () => {},
  });

  // 1. Escribir en el buscador: "ac05"
  panel.handleInput("a");
  panel.handleInput("c");
  panel.handleInput("0");
  panel.handleInput("5");

  // El render debe reflejar el filtro
  const linesFiltered = panel.render(80);
  assert.ok(linesFiltered.length > 0);

  // 2. Presionar Escape -> NO debe cerrar la modal (doneCalled sigue false), debe limpiar el buscador
  const consumedFirst = panel.handleInput("\x1b");
  assert.equal(consumedFirst, true); // Debe consumir el evento para que DcWindow no cierre
  assert.equal(doneCalled, false);

  // 3. Presionar Escape por segunda vez con buscador vacío -> AHORA SÍ debe cerrar la modal
  const consumedSecond = panel.handleInput("\x1b");
  assert.equal(consumedSecond, true);
  assert.equal(doneCalled, true);
});

test("dc-taxis-panel: integration with DcWindow handles Escape without prematurely closing window", () => {
  const fakeTheme = {
    bold: (s: string) => `*${s}*`,
    fg: (_c: string, s: string) => s,
    bg: (_c: string, s: string) => s,
  } as any;

  let windowClosed = false;
  const panel = new DcTaxisPanel({
    theme: fakeTheme,
    onDone: () => {
      windowClosed = true;
    },
    requestRender: () => {},
  });

  // Simular cómo DcWindow despacha el input
  // (dc-window.ts:243: if (this.options.content.handleInput?.(data) === true) return true;)
  const dispatchToWindow = (key: string) => {
    if (panel.handleInput(key) === true) {
      return true; // consumido por el panel
    }
    // Si no fue consumido, DcWindow cierra la ventana:
    if (key === "\x1b") {
      windowClosed = true;
      return true;
    }
    return false;
  };

  // Escribir en la búsqueda
  dispatchToWindow("a");
  dispatchToWindow("c");
  dispatchToWindow("0");
  dispatchToWindow("5");

  // Presionar Escape: debe consumir el evento (retornar true) y la ventana NO debe cerrarse
  const consumed = dispatchToWindow("\x1b");
  assert.equal(consumed, true);
  assert.equal(windowClosed, false); // <--- VENTANA SIGUE ABIERTA Y BUSCADOR LIMPIO

  // Presionar Escape de nuevo con buscador vacío: ahora sí se cierra
  dispatchToWindow("\x1b");
  assert.equal(windowClosed, true);
});

test("dc-taxis-panel: Enter or Space on taxi unit opens live telemetry detail, Esc returns to list", () => {
  const fakeTheme = {
    bold: (s: string) => `*${s}*`,
    fg: (_c: string, s: string) => s,
    bg: (_c: string, s: string) => s,
  } as any;

  let windowClosed = false;
  const panel = new DcTaxisPanel({
    theme: fakeTheme,
    onDone: () => {
      windowClosed = true;
    },
    requestRender: () => {},
  });

  // Presionar Enter en la primera unidad de la flota
  const enterConsumed = panel.handleInput("\r");
  assert.equal(enterConsumed, true);

  // Renderizar la vista actual: debe contener el detalle de telemetría de la unidad
  const detailLines = panel.render(80);
  assert.ok(detailLines.some((l) => l.includes("TELEMETRÍA EN VIVO")));
  assert.ok(detailLines.some((l) => l.includes("Volver a la lista")));

  // Presionar Escape: debe volver a la lista de taxis sin cerrar la ventana principal
  const escConsumed = panel.handleInput("\x1b");
  assert.equal(escConsumed, true);
  assert.equal(windowClosed, false);

  // El render debe volver a la lista general de la flota
  const listLines = panel.render(80);
  assert.ok(listLines.some((l) => l.includes("Flota de Taxis")));
});
