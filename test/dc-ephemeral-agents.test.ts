import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawn } from "node:child_process";

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
  syncActivePiSessionsFromOs,
  withFleetLock,
} from "../src/features/dc-agents/core/dc-taxi-dispatcher.ts";

import {
  setCachedTaxiQuota,
  clearTaxiQuotaCache,
} from "../src/features/dc-agents/core/dc-taxi-quota.ts";

import {
  calibrateEffortForTask,
  resolveExecutionModel,
  isGeminiModel,
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
  assembleLegoAgentPlan,
} from "../src/features/dc-agents/core/dc-ephemeral-manager.ts";

import { DcTaxisPanel } from "../src/features/dc-agents/views/dc-taxis-panel.ts";
import {
  registerDcEphemeralTools,
  extractSubagentMetrics,
} from "../src/features/dc-agents/tools/dc-ephemeral-tools.ts";
import {
  DC_TOOL_PRESETS,
  DC_TOOL_BRICKS,
  DC_BEHAVIOR_BRICKS,
  DC_AGENT_ARCHETYPES,
} from "../src/features/dc-agents/core/dc-ephemeral-types.ts";

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

test("dc-taxi-dispatcher: withFleetLock acquires lockfile, guarantees finally release, and supports reentrancy", () => {
  const tempDir = createTempDir("lock-basic");
  const fleetPath = path.join(tempDir, "dc-taxis.json");
  const lockPath = `${fleetPath}.lock`;

  try {
    let lockExistedDuringFn = false;
    let lockPayloadDuringFn = "";

    const result = withFleetLock(fleetPath, () => {
      lockExistedDuringFn = fs.existsSync(lockPath);
      if (lockExistedDuringFn) {
        lockPayloadDuringFn = fs.readFileSync(lockPath, "utf8");
      }
      // Reentrancy test
      const nested = withFleetLock(fleetPath, () => "nested-ok");
      assert.equal(nested, "nested-ok");
      return "outer-ok";
    });

    assert.equal(result, "outer-ok");
    assert.equal(lockExistedDuringFn, true);
    assert.ok(lockPayloadDuringFn.includes(`"pid":${process.pid}`));
    // Lock must be released after completion
    assert.equal(fs.existsSync(lockPath), false);

    // Guaranteed release on error
    assert.throws(() => {
      withFleetLock(fleetPath, () => {
        assert.equal(fs.existsSync(lockPath), true);
        throw new Error("simulated failure inside lock");
      });
    }, /simulated failure/);

    assert.equal(fs.existsSync(lockPath), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("dc-taxi-dispatcher: withFleetLock breaks stale lock with dead PID or >10s timestamp", () => {
  const tempDir = createTempDir("lock-stale");
  const fleetPath = path.join(tempDir, "dc-taxis.json");
  const lockPath = `${fleetPath}.lock`;

  try {
    // 1. Stale lock due to dead PID
    const deadPidPayload = JSON.stringify({ pid: 99999999, createdAt: Date.now() });
    fs.writeFileSync(lockPath, deadPidPayload, "utf8");

    const res1 = withFleetLock(fleetPath, () => "recovered-dead-pid");
    assert.equal(res1, "recovered-dead-pid");
    assert.equal(fs.existsSync(lockPath), false);

    // 2. Stale lock due to age > 10,000ms
    const staleTimePayload = JSON.stringify({ pid: process.pid, createdAt: Date.now() - 20000 });
    fs.writeFileSync(lockPath, staleTimePayload, "utf8");

    const res2 = withFleetLock(fleetPath, () => "recovered-stale-time");
    assert.equal(res2, "recovered-stale-time");
    assert.equal(fs.existsSync(lockPath), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("dc-taxi-dispatcher: withFleetLock handles inter-process contention and waits with backoff", () => {
  const tempDir = createTempDir("lock-contention");
  const fleetPath = path.join(tempDir, "dc-taxis.json");
  const lockPath = `${fleetPath}.lock`;

  try {
    // Spawn a detached-like node child process that creates lockPath, holds it for 50ms, then releases it
    const childScript = `
      const fs = require("node:fs");
      fs.writeFileSync(${JSON.stringify(lockPath)}, JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
      setTimeout(() => {
        try { fs.unlinkSync(${JSON.stringify(lockPath)}); } catch {}
        process.exit(0);
      }, 50);
    `;

    const child = spawn(process.execPath, ["-e", childScript], { stdio: "ignore" });

    // Wait until child has written the lockfile
    const start = Date.now();
    while (!fs.existsSync(lockPath) && Date.now() - start < 1000) {
      const sab = new SharedArrayBuffer(4);
      Atomics.wait(new Int32Array(sab), 0, 0, 5);
    }
    assert.equal(fs.existsSync(lockPath), true);

    // withFleetLock will block with backoff until the child releases it
    const outcome = withFleetLock(fleetPath, () => "acquired-after-contention");
    assert.equal(outcome, "acquired-after-contention");
    assert.equal(fs.existsSync(lockPath), false);

    child.kill();
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

test("dc-taxi-dispatcher: releaseTaxi sets status to recargando when quota is <5% and libre when >=5%", () => {
  const tempDir = createTempDir("release-recharge");
  const fleetPath = path.join(tempDir, "dc-taxis.json");
  clearTaxiQuotaCache();

  try {
    const customAccounts = ["ac01", "ac02"];
    const initial = createInitialFleetState(customAccounts);

    // Ocupamos ac01 y ac02
    initial.fleet["ac01"].status = "ocupado";
    initial.fleet["ac01"].passenger = {
      type: "ephemeral_subagent",
      sessionId: "sess-critica",
      pid: process.pid,
      model: "gemini-3.8-flash-high",
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
    };

    initial.fleet["ac02"].status = "ocupado";
    initial.fleet["ac02"].passenger = {
      type: "ephemeral_subagent",
      sessionId: "sess-saludable",
      pid: process.pid,
      model: "gemini-3.8-flash-high",
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
    };

    saveFleetState(initial, fleetPath);

    // Caso 1: ac01 con cuota crítica (<5%, ej: 3%)
    setCachedTaxiQuota("ac01", { gemini5hPct: 3 });

    const released1 = releaseTaxi("ac01", "sess-critica", fleetPath, customAccounts);
    assert.equal(released1, true);

    const afterRelease1 = loadFleetState(fleetPath, customAccounts);
    assert.equal(afterRelease1.fleet["ac01"].status, "recargando");
    assert.equal(afterRelease1.fleet["ac01"].passenger, null);

    // Caso 2: ac02 con cuota sana (>=5%, ej: 50%)
    setCachedTaxiQuota("ac02", { gemini5hPct: 50 });

    const released2 = releaseTaxi("ac02", "sess-saludable", fleetPath, customAccounts);
    assert.equal(released2, true);

    const afterRelease2 = loadFleetState(fleetPath, customAccounts);
    assert.equal(afterRelease2.fleet["ac02"].status, "libre");
    assert.equal(afterRelease2.fleet["ac02"].passenger, null);
  } finally {
    clearTaxiQuotaCache();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("dc-taxi-dispatcher: leaseTaxi ignores recharging units (<60%) and reactivates them when recovering (>=60%)", () => {
  const tempDir = createTempDir("lease-recharge");
  const fleetPath = path.join(tempDir, "dc-taxis.json");
  clearTaxiQuotaCache();

  try {
    const customAccounts = ["ac01", "ac02"];
    const initial = createInitialFleetState(customAccounts);

    // ac01 está en recargando (cuota 45% < 60%)
    initial.fleet["ac01"].status = "recargando";
    initial.fleet["ac01"].passenger = null;
    setCachedTaxiQuota("ac01", { gemini5hPct: 45 });

    // ac02 está ocupado
    initial.fleet["ac02"].status = "ocupado";
    initial.fleet["ac02"].passenger = {
      type: "orchestrator",
      sessionId: "orch-sess",
      pid: process.pid,
      model: "gemini-3.8-flash-high",
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
    };

    saveFleetState(initial, fleetPath);

    // 1. Intentar arrendar: ac01 está en recargando (<60%) y ac02 ocupado -> debe devolver null (flota agotada)
    const lease1 = leaseTaxi(
      {
        type: "ephemeral_subagent",
        sessionId: "sub-1",
        pid: process.pid,
        model: "gemini-3.8-flash-high",
      },
      "ac01",
      fleetPath,
      300000,
      customAccounts,
    );
    assert.equal(lease1, null);

    // 2. Intentar sin cuenta preferida: debe seguir ignorando ac01
    const leaseGeneric = leaseTaxi(
      {
        type: "ephemeral_subagent",
        sessionId: "sub-gen",
        pid: process.pid,
        model: "gemini-3.8-flash-high",
      },
      undefined,
      fleetPath,
      300000,
      customAccounts,
    );
    assert.equal(leaseGeneric, null);

    // 3. Simular que ac01 recuperó cuota (>= 60%, ej: 75%)
    setCachedTaxiQuota("ac01", { gemini5hPct: 75 });

    // 4. Ahora leaseTaxi debe reactivar ac01 a 'libre' y arrendarla exitosamente
    const lease2 = leaseTaxi(
      {
        type: "ephemeral_subagent",
        sessionId: "sub-2",
        pid: process.pid,
        model: "gemini-3.8-flash-high",
      },
      "ac01",
      fleetPath,
      300000,
      customAccounts,
    );
    assert.ok(lease2);
    assert.equal(lease2.account, "ac01");
    assert.equal(lease2.unit.status, "ocupado");
    assert.equal(lease2.unit.passenger?.sessionId, "sub-2");

    const stateAfter = loadFleetState(fleetPath, customAccounts);
    assert.equal(stateAfter.fleet["ac01"].status, "ocupado");
  } finally {
    clearTaxiQuotaCache();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("dc-taxi-dispatcher: reapAbandonedTaxis transitions dead PID unit to recargando if quota <5%", () => {
  const tempDir = createTempDir("reap-recharge");
  const fleetPath = path.join(tempDir, "dc-taxis.json");
  clearTaxiQuotaCache();

  try {
    const state = createInitialFleetState(["ac01", "ac02"]);

    // ac01 con PID muerto y cuota crítica (2%)
    state.fleet["ac01"].status = "ocupado";
    state.fleet["ac01"].passenger = {
      type: "subagent",
      sessionId: "dead-crit",
      pid: 99999999,
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
    };
    setCachedTaxiQuota("ac01", { gemini5hPct: 2 });

    // ac02 con PID muerto y cuota normal (80%)
    state.fleet["ac02"].status = "ocupado";
    state.fleet["ac02"].passenger = {
      type: "subagent",
      sessionId: "dead-ok",
      pid: 99999999,
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
    };
    setCachedTaxiQuota("ac02", { gemini5hPct: 80 });

    saveFleetState(state, fleetPath);

    const reaped = reapAbandonedTaxis(state, 300000);
    assert.equal(reaped, 2);

    assert.equal(state.fleet["ac01"].status, "recargando");
    assert.equal(state.fleet["ac01"].passenger, null);

    assert.equal(state.fleet["ac02"].status, "libre");
    assert.equal(state.fleet["ac02"].passenger, null);
  } finally {
    clearTaxiQuotaCache();
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

test("dc-taxi-dispatcher: leaseTaxi selects available unit with highest quota", () => {
  const tempDir = createTempDir("lease-quota-priority");
  const fleetPath = path.join(tempDir, "dc-taxis.json");

  try {
    const customAccounts = ["ac01", "ac02", "ac03"];
    saveFleetState(createInitialFleetState(customAccounts), fleetPath);

    // ac01: 20% cuota, ac02: 85% cuota, ac03: 45% cuota
    const customQuotas = (ac: string) => {
      if (ac === "ac01") return { account: "ac01", gemini5hPct: 20, geminiWeeklyPct: 50, lastChecked: Date.now() };
      if (ac === "ac02") return { account: "ac02", gemini5hPct: 85, geminiWeeklyPct: 90, lastChecked: Date.now() };
      if (ac === "ac03") return { account: "ac03", gemini5hPct: 45, geminiWeeklyPct: 70, lastChecked: Date.now() };
      return undefined;
    };

    const lease = leaseTaxi(
      {
        type: "ephemeral_subagent",
        sessionId: "sess-q",
        pid: process.pid,
        model: "gemini-3.8-flash-high",
      },
      undefined,
      fleetPath,
      300000,
      customAccounts,
      customQuotas,
    );

    assert.ok(lease);
    // Debe seleccionar ac02 porque tiene 85% (mayor cuota disponible)
    assert.equal(lease.account, "ac02");
    assert.equal(lease.unit.status, "ocupado");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("dc-taxi-dispatcher: syncActivePiSessionsFromOs never auto-assigns unknown OS processes as orchestrator", () => {
  const customAccounts = ["ac01", "ac02"];
  const state = createInitialFleetState(customAccounts);

  // Llamar a syncActivePiSessionsFromOs sobre el estado con cuentas libres
  syncActivePiSessionsFromOs(state);

  // Todas las cuentas deben permanecer libres; jamás inventar pasajeros 'orchestrator'
  for (const ac of customAccounts) {
    assert.equal(state.fleet[ac].status, "libre");
    assert.equal(state.fleet[ac].passenger, null);
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

  // Default canónico para subagentes sin preset ni keywords: high
  assert.equal(calibrateEffortForTask("tarea general sin preset"), "high");
  // Preset scout y research calibrados a high para evitar paradas prematuras
  assert.equal(calibrateEffortForTask("mapear estructura", "scout"), "high");
  assert.equal(calibrateEffortForTask("investigar dependencias", "research"), "high");
});

test("dc-effort-policy: resolveExecutionModel enforces provider policy and parses account refs", () => {
  // 0. isGeminiModel guard
  assert.equal(isGeminiModel("gemini-3.8-flash-high"), true);
  assert.equal(isGeminiModel("gemini-3-flash"), true);
  assert.equal(isGeminiModel("claude-sonnet-4-6"), false);
  assert.equal(isGeminiModel("gpt-5.5"), false);

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

  // 3. Intento de solicitar modelo no-Gemini (ej: Claude) es neutralizado y redirigido a Gemini
  const resClaude = resolveExecutionModel({
    requestedModel: "cpam/ac04/claude-sonnet-4-6",
  });
  assert.equal(resClaude.provider, "cpam");
  assert.equal(resClaude.requestedAccount, "ac04");
  assert.equal(resClaude.baseModelName, "gemini-3.8-flash-high"); // Salvaguarda de cuotas activada
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

test("dc-taxi-history: loadTaxiTripHistory creates .corrupt.bak backup when JSON is malformed", () => {
  const tempDir = createTempDir("corrupt-history");
  const historyPath = path.join(tempDir, "dc-taxis-history.json");

  try {
    const corruptContent = "{ this is invalid json content";
    fs.writeFileSync(historyPath, corruptContent, "utf8");

    const history = loadTaxiTripHistory(10, historyPath);
    // Returns empty array
    assert.deepEqual(history, []);

    // Backup file must have been created with .corrupt.<timestamp>.bak
    const files = fs.readdirSync(tempDir);
    const backupFile = files.find((f) => f.includes(".corrupt.") && f.endsWith(".bak"));
    assert.ok(backupFile, "Expected backup file with .corrupt.*.bak to be created");

    const backupContent = fs.readFileSync(path.join(tempDir, backupFile), "utf8");
    assert.equal(backupContent, corruptContent);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("dc-taxi-history: recordTaxiTrip writes atomically with temp file and no leftovers", () => {
  const tempDir = createTempDir("atomic-history");
  const historyPath = path.join(tempDir, "dc-taxis-history.json");

  try {
    recordTaxiTrip(
      {
        tripId: "t-atomic-1",
        account: "ac01",
        passengerType: "ephemeral_subagent",
        model: "gemini-3.8-flash-high",
        sessionId: "s1",
        startedAt: 1000,
        endedAt: 2000,
        durationMs: 1000,
        status: "completed",
      },
      historyPath,
    );

    const files = fs.readdirSync(tempDir);
    // Only the target history file should exist, no .tmp files left
    assert.ok(files.includes("dc-taxis-history.json"));
    const tmpFiles = files.filter((f) => f.endsWith(".tmp"));
    assert.equal(tmpFiles.length, 0);

    const history = loadTaxiTripHistory(10, historyPath);
    assert.equal(history.length, 1);
    assert.equal(history[0].tripId, "t-atomic-1");
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

  assert.equal(registered.length, 2);
  const ephemTool = registered.find((t) => t.name === "dc_ephemeral_agent_run");
  const swarmTool = registered.find((t) => t.name === "dc_research_swarm");

  assert.ok(ephemTool, "dc_ephemeral_agent_run must be registered");
  assert.ok(swarmTool, "dc_research_swarm must be registered");

  assert.ok(ephemTool.parameters.properties.task);
  assert.ok(ephemTool.parameters.properties.archetype);
  assert.ok(ephemTool.parameters.properties.toolBricks);
  assert.ok(ephemTool.parameters.properties.behaviorBricks);
  assert.ok(ephemTool.parameters.properties.toolPreset);
  assert.ok(ephemTool.parameters.properties.effort);
});

test("dc-ephemeral-tools: dc_ephemeral_agent_run executes with archetype and cleans up in finally", async () => {
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
    sessionManager: { getSessionId: () => "sess-archetype-test" },
    model: { provider: "cpam", id: "ac05/gemini-3.8-flash-high" },
    executeTool: async (toolName: string, args: any) => {
      executeToolCalled = true;
      executedAgentName = args.agent;
      return {
        toolCall: { id: "call-1", name: toolName, arguments: args },
        result: {
          content: [{ type: "text", text: "Reporte de scout con lego" }],
          details: { ok: true },
        },
      };
    },
  };

  const outcome = await tool.execute("call-arch-1", {
    task: "Mapear modulo x",
    archetype: "odd-scout",
  }, undefined, undefined, fakeCtx);

  assert.equal(executeToolCalled, true);
  assert.ok(executedAgentName.startsWith("dc-ephem-"));
  assert.ok(outcome.content[0].text.includes("Reporte de scout"));
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

test("dc-ephemeral-tools: dc_ephemeral_agent_run unwraps real Pi NestedToolOutcome structure cleanly", async () => {
  const registered: any[] = [];
  const fakePi = {
    registerTool(toolDef: any) {
      registered.push(toolDef);
    },
  } as any;

  registerDcEphemeralTools(fakePi);
  const tool = registered[0];

  let executedAgentName = "";
  const fakeCtx = {
    sessionManager: { getSessionId: () => "sess-nested-test" },
    model: { provider: "cpam", id: "ac01/gemini-3.8-flash-high" },
    executeTool: async (_name: string, args: any) => {
      executedAgentName = args.agent;
      // Simular exactamente la estructura NestedToolOutcome que retorna Pi nativo
      return {
        toolCall: { type: "toolCall", id: "call-1/1", name: "subagent_run", arguments: args },
        result: {
          content: [{ type: "text", text: "Subagente efímero ejecutado exitosamente vía Pi runner." }],
          details: { exitCode: 0, subagentId: args.agent },
        },
        isError: false,
      };
    },
  } as any;

  const result = await tool.execute(
    "call-1",
    { task: "Test nested unwrap", toolPreset: "scout", role: "scout-tester" },
    undefined,
    undefined,
    fakeCtx,
  );

  // El resultado devuelto por dc_ephemeral_agent_run DEBE tener .content en la raíz
  assert.ok(Array.isArray(result.content), "result.content debe ser un Array en la raíz");
  assert.equal(result.content[0].text, "Subagente efímero ejecutado exitosamente vía Pi runner.");
  assert.equal(result.details?.exitCode, 0);
  assert.equal(result.isError, undefined);

  // Verificar que el archivo temporal del agente fue eliminado
  const agentPath = path.join(os.homedir(), ".pi", "agent", "agents", `${executedAgentName}.md`);
  assert.equal(fs.existsSync(agentPath), false);
});

test("dc-ephemeral-tools: mode background does not destroy agent file nor release taxi prematurely", async () => {
  const registered: any[] = [];
  const fakePi = {
    registerTool(toolDef: any) {
      registered.push(toolDef);
    },
  } as any;

  registerDcEphemeralTools(fakePi);
  const tool = registered[0];

  let executedAgentName = "";
  const testSessionId = `sess-bg-isolation-${Date.now()}`;
  const fakeCtx = {
    sessionManager: { getSessionId: () => testSessionId },
    model: { provider: "cpam", id: "ac02/gemini-3.8-flash-high" },
    executeTool: async (name: string, args: any) => {
      assert.equal(name, "subagent_run");
      assert.equal(args.mode, "background");
      executedAgentName = args.agent;
      return {
        toolCall: { id: "call-bg", name: "subagent_run", arguments: args },
        result: {
          content: [{ type: "text", text: "Background worker started in background." }],
          details: { background: true, agent: args.agent },
        },
      };
    },
  } as any;

  const outcome = await tool.execute(
    "call-bg-1",
    { task: "Proceso asincrono largo", mode: "background", role: "bg-worker" },
    undefined,
    undefined,
    fakeCtx,
  );

  assert.ok(executedAgentName.startsWith("dc-ephem-"));
  assert.ok(outcome.content[0].text.includes("Background worker started"));

  const agentPath = path.join(os.homedir(), ".pi", "agent", "agents", `${executedAgentName}.md`);
  try {
    // 1. El archivo .md DEBE conservarse en disco mientras corre en background
    assert.equal(fs.existsSync(agentPath), true, "Agent file must NOT be destroyed in background mode");

    // 2. El Taxi arrendado debe permanecer 'ocupado' en la flota
    const fleetState = loadFleetState();
    const leasedAccount = Object.keys(fleetState.fleet).find(
      (acc) => fleetState.fleet[acc].passenger?.agentName === executedAgentName,
    );
    assert.ok(leasedAccount, "A taxi must remain assigned to the background agent");
    assert.equal(fleetState.fleet[leasedAccount].status, "ocupado");

    // 3. Debe haberse registrado el log de delegación en background
    const recentLogs = readRecentTaxiLogs(15);
    const bgLog = recentLogs.find((l) => l.includes("EPHEMERAL_AGENT_BACKGROUND_DELEGATED"));
    assert.ok(bgLog, "EPHEMERAL_AGENT_BACKGROUND_DELEGATED must be logged");
    assert.ok(bgLog.includes(executedAgentName));
  } finally {
    // Limpieza manual post-test para no dejar rastro
    if (fs.existsSync(agentPath)) {
      fs.unlinkSync(agentPath);
    }
    const fleetState = loadFleetState();
    const account = Object.keys(fleetState.fleet).find(
      (acc) => fleetState.fleet[acc].passenger?.agentName === executedAgentName,
    );
    if (account) {
      releaseTaxi(account, testSessionId);
    }
  }
});

test("dc-ephemeral-tools: token usage and costEstimated from subagent_run propagate to taxi history", async () => {
  const registered: any[] = [];
  const fakePi = {
    registerTool(toolDef: any) {
      registered.push(toolDef);
    },
  } as any;

  registerDcEphemeralTools(fakePi);
  const tool = registered[0];

  let executedAgentName = "";
  const testSessionId = `sess-tokens-test-${Date.now()}`;
  const fakeCtx = {
    sessionManager: { getSessionId: () => testSessionId },
    model: { provider: "cpam", id: "ac03/gemini-3.8-flash-high" },
    executeTool: async (name: string, args: any) => {
      assert.equal(name, "subagent_run");
      executedAgentName = args.agent;
      return {
        toolCall: { id: "call-tok", name: "subagent_run", arguments: args },
        result: {
          content: [{ type: "text", text: "Tarea de calculo finalizada." }],
          details: {
            tokens: {
              input: 1250,
              output: 320,
              reasoning: 80,
              total: 1650,
            },
            costEstimated: 0.00342,
          },
        },
      };
    },
  } as any;

  const outcome = await tool.execute(
    "call-tok-1",
    { task: "Auditar consumo de tokens", mode: "task", role: "token-auditor" },
    undefined,
    undefined,
    fakeCtx,
  );

  assert.ok(executedAgentName.startsWith("dc-ephem-"));
  assert.equal(outcome.content[0].text, "Tarea de calculo finalizada.");

  // En modo task el archivo SI debe haber sido limpiado
  const agentPath = path.join(os.homedir(), ".pi", "agent", "agents", `${executedAgentName}.md`);
  assert.equal(fs.existsSync(agentPath), false, "Task mode must clean up agent file");

  // El registro de viaje debe contener los tokens reales y el costo estimado
  const history = loadTaxiTripHistory(10);
  const matchedTrip = history.find(
    (t) => t.sessionId === testSessionId || t.tokens?.total === 1650,
  );

  assert.ok(matchedTrip, "History trip must exist with recorded tokens");
  assert.equal(matchedTrip?.tokens?.input, 1250);
  assert.equal(matchedTrip?.tokens?.output, 320);
  assert.equal(matchedTrip?.tokens?.reasoning, 80);
  assert.equal(matchedTrip?.tokens?.total, 1650);
  assert.equal(matchedTrip?.costEstimated, 0.00342);
  assert.equal(matchedTrip?.status, "completed");
});

test("dc-ephemeral-tools: extractSubagentMetrics extracts tokens and cost from multiple candidate structures", () => {
  // 1. Caso estándar de Pi: rawOutcome.result.details.tokens
  const res1 = extractSubagentMetrics({
    result: {
      details: {
        tokens: { input: 100, output: 50, reasoning: 20, total: 170 },
        costEstimated: 0.0015,
      },
    },
  });
  assert.deepEqual(res1.tokens, { input: 100, output: 50, reasoning: 20, total: 170 });
  assert.equal(res1.costEstimated, 0.0015);

  // 2. Caso usage en raíz (promptTokens/completionTokens)
  const res2 = extractSubagentMetrics({
    usage: { promptTokens: 80, completionTokens: 40, totalTokens: 120 },
    cost: 0.0008,
  });
  assert.deepEqual(res2.tokens, { input: 80, output: 40, total: 120 });
  assert.equal(res2.costEstimated, 0.0008);

  // 3. Caso unwrapped.details.tokens con snake_case
  const res3 = extractSubagentMetrics(
    {},
    {
      details: {
        tokens: { prompt_tokens: 300, completion_tokens: 150, reasoning_tokens: 25 },
        costEstimated: 0.004,
      },
    },
  );
  assert.deepEqual(res3.tokens, { input: 300, output: 150, reasoning: 25, total: 475 });
  assert.equal(res3.costEstimated, 0.004);

  // 4. Caso vacío / undefined
  const res4 = extractSubagentMetrics(undefined, undefined);
  assert.equal(res4.tokens, undefined);
  assert.equal(res4.costEstimated, undefined);
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
      "codegraph",
      "dc_youtube_search",
      "dc_youtube_video_get",
      "dc_browser_status",
      "dc_api_rest",
      "dc_services_list",
      "dc_context7_status",
      "dc_web_fetch",
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
  assert.equal(appliedActiveTools.includes("codegraph"), false);
  assert.equal(appliedActiveTools.includes("dc_youtube_search"), false);
  assert.equal(appliedActiveTools.includes("dc_browser_status"), false);
  assert.equal(appliedActiveTools.includes("dc_api_rest"), false);
  assert.equal(appliedActiveTools.includes("dc_context7_status"), false);
  assert.equal(appliedActiveTools.includes("dc_web_fetch"), false);
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

test("dc-ephemeral-types: Tool Bricks, Behavior Bricks, and Canonical Archetypes Catalog contracts", () => {
  // 1. Tool Bricks
  assert.ok(Array.isArray(DC_TOOL_BRICKS["fs-read"]));
  assert.ok(DC_TOOL_BRICKS["fs-read"].includes("read"));
  assert.ok(DC_TOOL_BRICKS["fs-read"].includes("grep"));
  assert.ok(DC_TOOL_BRICKS["fs-read"].includes("find"));

  assert.ok(DC_TOOL_BRICKS["fs-write"].includes("edit"));
  assert.ok(DC_TOOL_BRICKS["fs-write"].includes("write"));
  assert.ok(DC_TOOL_BRICKS["terminal"].includes("bash"));
  assert.ok(DC_TOOL_BRICKS["code-intel"].includes("dc_codegraph_status"));

  // 2. Behavior Bricks
  assert.ok(DC_BEHAVIOR_BRICKS["strict-tdd"].includes("RED"));
  assert.ok(DC_BEHAVIOR_BRICKS["strict-tdd"].includes("GREEN"));
  assert.ok(DC_BEHAVIOR_BRICKS["read-only-analyst"].includes("solo lectura"));
  assert.ok(DC_BEHAVIOR_BRICKS["artifact-contract"].includes("Contrato de Artefacto"));
  assert.ok(DC_BEHAVIOR_BRICKS["non-empty-response"].includes("texto visible"));

  // 3. Catálogo de Arquetipos Canónicos — TODOS con prefijo estricto dc-
  const canonicalArchetypes = [
    "dc-phase-discovery",
    "dc-phase-planning",
    "dc-phase-apply",
    "dc-phase-verify",
    "dc-odd-scout",
    "dc-odd-worker",
    "dc-odd-verifier",
    "dc-odd-planner",
    "dc-researcher",
    "dc-news-to-day",
    "dc-ui-visual-inspector",
    "dc-browser-inspector",
    "dc-pr-comment-analyst",
    "dc-sentinel",
    "dc-smoke",
    "dc-media",
    "dc-service-ops",
  ] as const;

  for (const name of canonicalArchetypes) {
    // REGLA ESTRICTA: Ningún nombre sin el prefijo dc-
    assert.ok(name.startsWith("dc-"), `El arquetipo ${name} debe comenzar estrictamente con el prefijo dc-`);
    const arch = DC_AGENT_ARCHETYPES[name];
    assert.ok(arch, `Archetype ${name} must exist`);
    assert.equal(arch.name, name);
    assert.ok(arch.toolBricks.length > 0, `${name} must have toolBricks`);
    assert.ok(arch.behaviorBricks.length > 0, `${name} must have behaviorBricks`);
    assert.ok(arch.recommendedModel?.includes("gemini"), `${name} must recommend Gemini model`);
  }

  // 4. Comprobar que en DC_AGENT_ARCHETYPES no haya NINGUNA clave sin prefijo dc-
  for (const key of Object.keys(DC_AGENT_ARCHETYPES)) {
    assert.ok(key.startsWith("dc-"), `La clave ${key} en DC_AGENT_ARCHETYPES debe tener prefijo dc-`);
  }

  // 5. Presets retrocompatibles worker y verifier
  assert.ok(DC_TOOL_PRESETS.worker.includes("edit"));
  assert.ok(DC_TOOL_PRESETS.worker.includes("bash"));
  assert.ok(DC_TOOL_PRESETS.verifier.includes("read"));
  assert.ok(DC_TOOL_PRESETS.verifier.includes("bash"));
  assert.ok(!DC_TOOL_PRESETS.verifier.includes("edit")); // verifier no puede escribir
});

test("dc-ephemeral-manager: assembleLegoAgentPlan builds archetypes and custom lego compositions", () => {
  // 1. Arquetipo canónico dc-odd-worker y alias odd-worker
  const workerPlan = assembleLegoAgentPlan({
    task: "Implementar parser TDD",
    archetype: "dc-odd-worker",
  });
  assert.equal(workerPlan.archetype, "dc-odd-worker");
  assert.equal(workerPlan.recommendedModel, "gemini-3.8-flash-high");
  assert.equal(workerPlan.defaultEffort, "high");
  assert.ok(workerPlan.tools.includes("read"));
  assert.ok(workerPlan.tools.includes("edit"));
  assert.ok(workerPlan.tools.includes("write"));
  assert.ok(workerPlan.tools.includes("bash"));
  assert.ok(workerPlan.directives.some((d) => d.includes("RED")));
  assert.ok(workerPlan.directives.some((d) => d.includes("Allowed edit surfaces")));
  assert.ok(workerPlan.directives.some((d) => d.includes("Contrato de Artefacto")));
  assert.ok(workerPlan.directives.some((d) => d.includes("texto visible")));

  // Alias retrocompatible odd-worker -> dc-odd-worker
  const aliasWorkerPlan = assembleLegoAgentPlan({
    task: "Implementar parser TDD con alias",
    archetype: "odd-worker" as any,
  });
  assert.equal(aliasWorkerPlan.archetype, "dc-odd-worker");

  // 2. Arquetipo canónico dc-odd-verifier (solo lectura + tests)
  const verifierPlan = assembleLegoAgentPlan({
    task: "Verificar suite de tests",
    archetype: "dc-odd-verifier",
  });
  assert.ok(verifierPlan.tools.includes("bash"));
  assert.ok(verifierPlan.tools.includes("read"));
  assert.ok(!verifierPlan.tools.includes("edit")); // nunca puede escribir

  // 3. Mini SDD (DC Planned Workflow): dc-phase-discovery, dc-phase-planning, dc-phase-apply, dc-phase-verify
  const discoveryPlan = assembleLegoAgentPlan({
    task: "Investigar código para discovery.md",
    archetype: "dc-phase-discovery",
  });
  assert.equal(discoveryPlan.archetype, "dc-phase-discovery");
  assert.ok(discoveryPlan.tools.includes("read"));
  assert.ok(discoveryPlan.tools.includes("dc_codegraph_explore"));
  assert.ok(!discoveryPlan.tools.includes("edit")); // solo lectura

  const planningPlan = assembleLegoAgentPlan({
    task: "Diseñar plan.md como DAG acíclico",
    archetype: "dc-phase-planning",
  });
  assert.equal(planningPlan.archetype, "dc-phase-planning");
  assert.ok(planningPlan.directives.some((d) => d.includes("DAG")));

  const applyPlan = assembleLegoAgentPlan({
    task: "Implementar tareas TDD para apply.md",
    archetype: "dc-phase-apply",
  });
  assert.equal(applyPlan.archetype, "dc-phase-apply");
  assert.ok(applyPlan.tools.includes("edit"));
  assert.ok(applyPlan.tools.includes("bash"));
  assert.ok(applyPlan.directives.some((d) => d.includes("RED")));

  const verifyPhasePlan = assembleLegoAgentPlan({
    task: "Verificar evidencia y calidad de aserciones en verify.md",
    archetype: "dc-phase-verify",
  });
  assert.equal(verifyPhasePlan.archetype, "dc-phase-verify");
  assert.ok(verifyPhasePlan.tools.includes("bash"));
  assert.ok(!verifyPhasePlan.tools.includes("edit"));
  assert.ok(verifyPhasePlan.directives.some((d) => d.includes("tautologías")));

  // 4. Composición dinámica con legos (toolBricks + behaviorBricks)
  const customPlan = assembleLegoAgentPlan({
    task: "Investigar API y probar endpoint",
    toolBricks: ["fs-read", "browser", "services"],
    behaviorBricks: ["read-only-analyst", "source-verification"],
  });
  assert.ok(customPlan.tools.includes("read"));
  assert.ok(customPlan.tools.includes("dc_browser_navigate"));
  assert.ok(customPlan.tools.includes("dc_service_status"));
  assert.ok(!customPlan.tools.includes("edit")); // no fs-write
  assert.ok(customPlan.directives.some((d) => d.includes("fuente primaria")));
  assert.ok(customPlan.directives.some((d) => d.includes("solo lectura")));

  // 5. prepareEphemeralAgent con arquetipo dc-odd-worker
  const plan = prepareEphemeralAgent(
    {
      task: "Refactorizar modulo de pagos",
      archetype: "dc-odd-worker",
    },
    {
      sessionId: "test-sess-lego",
      parentModel: "cpam/ac05/gemini-3.8-flash-high",
      pid: process.pid,
    },
  );

  assert.ok(plan.agentName.startsWith("dc-ephem-"));
  assert.equal(plan.effectiveEffort, "high");
  assert.ok(plan.tools.includes("edit"));
  assert.ok(plan.tools.includes("bash"));

  const md = fs.readFileSync(plan.agentFilePath, "utf8");
  assert.ok(md.includes("Arquetipo: dc-odd-worker"));
  assert.ok(md.includes("RED"));

  cleanupEphemeralAgent(plan, {
    sessionId: "test-sess-lego",
    startedAt: Date.now() - 1000,
    endedAt: Date.now(),
    status: "completed",
  });
  assert.equal(fs.existsSync(plan.agentFilePath), false);
});
