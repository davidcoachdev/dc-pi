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
} from "../src/features/dc-agents/core/dc-taxi-history.ts";

import {
  appendTaxiLog,
  readRecentTaxiLogs,
} from "../src/features/dc-agents/core/dc-taxi-logger.ts";

import {
  prepareEphemeralAgent,
  cleanupEphemeralAgent,
  dcCleanOrphanedEphemeralAgents,
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
    );

    assert.equal(lease3, null);

    // 4. Liberar ac02
    const released = releaseTaxi("ac02", "sess-1", fleetPath);
    assert.equal(released, true);

    // 5. Ahora ac02 vuelve a estar libre
    const summary = getFleetStatusSummary(fleetPath);
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

test("dc-taxis-panel: renders all 3 tabs cleanly without crashing", () => {
  const fakeTheme = {
    bold: (s: string) => `*${s}*`,
    fg: (_c: string, s: string) => s,
    bg: (_c: string, s: string) => s,
  } as any;

  let doneCalled = false;
  const panel = new DcTaxisPanel(fakeTheme, () => {
    doneCalled = true;
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
