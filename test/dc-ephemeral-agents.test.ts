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
  leaseAvailableTaxis,
  sendTaxiToWorkshop,
  repairTaxiFromWorkshop,
  updateTaxiPassengerUsage,
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
  activeBackgroundPlans,
  ensureBackgroundSweeper,
  sweepBackgroundPlansOnce,
} from "../src/features/dc-agents/tools/dc-ephemeral-tools.ts";
import {
  DC_TOOL_PRESETS,
  DC_TOOL_BRICKS,
  DC_BEHAVIOR_BRICKS,
  DC_AGENT_ARCHETYPES,
} from "../src/features/dc-agents/core/dc-ephemeral-types.ts";
import {
  auditAccountForWorkshop,
  handleTurnEndForWorkshop,
  sanitizeWorkshopReason,
  isProviderAuthError,
  handleOrchestratorQuotaHandover,
} from "../src/features/dc-agents/dc-agents.ts";
import { createTaxiUnitRows } from "../src/features/dc-sidebar/components/dc-sidebar-status-card.ts";
import {
  evaluateTaxiHandoverRequired,
  executeTaxiHandover,
  DEFAULT_TOKEN_HANDOVER_THRESHOLD,
  DEFAULT_QUOTA_HANDOVER_THRESHOLD_PCT,
} from "../src/features/dc-agents/core/dc-taxi-supervisor.ts";
import type { TaxiHandoverPacket } from "../src/features/dc-agents/core/dc-ephemeral-types.ts";

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

test("dc-taxi-dispatcher: reapAbandonedTaxis never evicts a live orchestrator based on elapsed TTL", () => {
  const tempDir = createTempDir("live-orch-ttl");
  const fleetPath = path.join(tempDir, "dc-taxis.json");

  try {
    const state = createInitialFleetState(["ac01", "ac02"]);

    // ac01 ocupado por un orquestador vivo cuyo último heartbeat fue hace 20 minutos (> 5m TTL)
    const twentyMinsAgo = Date.now() - 20 * 60 * 1000;
    state.fleet["ac01"].status = "ocupado";
    state.fleet["ac01"].passenger = {
      type: "orchestrator",
      sessionId: "live-long-sess",
      pid: process.pid, // PID de este proceso que está 100% vivo
      startedAt: twentyMinsAgo,
      heartbeatAt: twentyMinsAgo,
    };

    // ac02 ocupado por un subagente efímero cuyo último heartbeat fue hace 20 minutos (> 5m TTL)
    state.fleet["ac02"].status = "ocupado";
    state.fleet["ac02"].passenger = {
      type: "ephemeral_subagent",
      sessionId: "ephem-hung-sess",
      pid: process.pid,
      startedAt: twentyMinsAgo,
      heartbeatAt: twentyMinsAgo,
    };

    saveFleetState(state, fleetPath);

    // Ejecutar reaper con TTL de 5 minutos (300_000 ms)
    const reaped = reapAbandonedTaxis(state, 300000);

    // Solo debe reapear ac02 (el subagente colgado). ac01 (el orquestador vivo) DEBE permanecer intacto.
    assert.equal(reaped, 1);
    assert.equal(state.fleet["ac01"].status, "ocupado");
    assert.equal(state.fleet["ac01"].passenger?.sessionId, "live-long-sess");

    assert.equal(state.fleet["ac02"].status, "libre");
    assert.equal(state.fleet["ac02"].passenger, null);
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

test("dc-taxi-dispatcher: leased taxis retain host process.pid without false PID overwrites", () => {
  const tempDir = createTempDir("host-pid-integrity");
  const fleetPath = path.join(tempDir, "dc-taxis.json");

  try {
    const customAccounts = ["ac01"];
    saveFleetState(createInitialFleetState(customAccounts), fleetPath);

    const lease = leaseTaxi(
      {
        type: "ephemeral_subagent",
        sessionId: "sess-real",
        pid: process.pid, // El PID siempre es process.pid del host
        model: "gemini-3.8-flash-high",
      },
      "ac01",
      fleetPath,
      300000,
      customAccounts,
    );
    assert.ok(lease);
    assert.equal(lease.unit.passenger?.pid, process.pid);

    // Verificamos que el estado persistido en disco mantiene el process.pid del host
    const reloaded = loadFleetState(fleetPath, customAccounts);
    assert.equal(reloaded.fleet["ac01"].passenger?.pid, process.pid);

    // Verificamos que reapAbandonedTaxis nunca lo elimina mientras el proceso host siga vivo
    const reaped = reapAbandonedTaxis(reloaded, 300000, Date.now());
    assert.equal(reaped, 0);
    assert.equal(reloaded.fleet["ac01"].status, "ocupado");
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

  assert.ok(plan.agentName.startsWith("dc-sub-") || plan.agentName.startsWith("dc-ephem-"));
  assert.ok(plan.agentName.includes("media") || plan.agentName.includes("search"));
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

  assert.equal(registered.length, 3);
  const ephemTool = registered.find((t) => t.name === "dc_ephemeral_agent_run");
  const swarmTool = registered.find((t) => t.name === "dc_research_swarm");
  const batchTool = registered.find((t) => t.name === "dc_ephemeral_batch_run");

  assert.ok(ephemTool, "dc_ephemeral_agent_run must be registered");
  assert.ok(swarmTool, "dc_research_swarm must be registered");
  assert.ok(batchTool, "dc_ephemeral_batch_run must be registered");

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
  assert.ok(executedAgentName.startsWith("dc-sub-") || executedAgentName.startsWith("dc-ephem-"));
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
  assert.ok(executedAgentName.startsWith("dc-sub-") || executedAgentName.startsWith("dc-ephem-"));
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

  assert.ok(executedAgentName.startsWith("dc-sub-") || executedAgentName.startsWith("dc-ephem-"));
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

  assert.ok(executedAgentName.startsWith("dc-sub-") || executedAgentName.startsWith("dc-ephem-"));
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
  assert.ok(DC_TOOL_BRICKS["api"].includes("dc_api_rest"));
  assert.ok(DC_TOOL_BRICKS["api"].includes("dc_api_swagger"));
  assert.ok(DC_TOOL_BRICKS["security"].includes("dc_owasp_query"));
  assert.ok(DC_TOOL_BRICKS["security"].includes("dc_owasp_audit"));

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
    "dc-security-auditor",
    "dc-api-tester",
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

  // 5. prepareEphemeralAgent con arquetipo dc-odd-worker y superficies delimitadas
  const plan = prepareEphemeralAgent(
    {
      task: "Refactorizar modulo de pagos\n\n## Allowed edit surfaces\nsrc/payments/processor.ts\nsrc/payments/types.ts",
      archetype: "dc-odd-worker",
    },
    {
      sessionId: "test-sess-lego",
      parentModel: "cpam/ac05/gemini-3.8-flash-high",
      pid: process.pid,
    },
  );

  assert.ok(plan.agentName.startsWith("dc-sub-") || plan.agentName.startsWith("dc-ephem-"));
  assert.ok(plan.agentName.includes("worker"));
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

test("dc-ephemeral-tools: dc_ephemeral_batch_run executes multiple tasks in parallel via Promise.allSettled", async () => {
  const registered: any[] = [];
  const fakePi = {
    registerTool(toolDef: any) {
      registered.push(toolDef);
    },
  } as any;

  registerDcEphemeralTools(fakePi);
  const batchTool = registered.find((t) => t.name === "dc_ephemeral_batch_run");
  assert.ok(batchTool, "dc_ephemeral_batch_run must be registered");

  const dispatchedAgents: string[] = [];
  const fakeCtx = {
    sessionManager: { getSessionId: () => "sess-batch-test" },
    model: { provider: "cpam", id: "ac01/gemini-3.8-flash-high" },
    executeTool: async (name: string, args: any) => {
      assert.equal(name, "subagent_run");
      dispatchedAgents.push(args.agent);
      return {
        content: [{ type: "text", text: `Resultado de worker ${args.agent}` }],
      };
    },
  } as any;

  const result = await batchTool.execute(
    "call-batch-1",
    {
      items: [
        { task: "Auditar módulo A", role: "auditor-a" },
        { task: "Auditar módulo B", role: "auditor-b" },
        { task: "Auditar módulo C", role: "auditor-c" },
      ],
      mode: "task",
    },
    undefined,
    undefined,
    fakeCtx,
  );

  assert.equal(dispatchedAgents.length, 3);
  assert.ok(result.content[0].text.includes("Fan-Out: 3 Subagentes"));
  assert.ok(result.content[0].text.includes("auditor-a"));
  assert.ok(result.content[0].text.includes("auditor-b"));
  assert.ok(result.content[0].text.includes("auditor-c"));
  assert.equal(result.details.completed, 3);
  assert.equal(result.details.failed, 0);
});

test("dc-ephemeral-manager: injects Lego Tool Guidelines for active tool bricks", () => {
  const plan = assembleLegoAgentPlan({
    task: "Auditar seguridad y probar API",
    toolBricks: ["security", "api"],
  });

  // Directivas de herramientas activas
  assert.ok(plan.directives.some((d) => d.includes("[Tool: security]") && d.includes("dc_owasp_audit")));
  assert.ok(plan.directives.some((d) => d.includes("[Tool: api]") && d.includes("dc_api_swagger")));

  // No debe incluir herramientas no activas
  assert.ok(!plan.directives.some((d) => d.includes("[Tool: youtube]")));
  assert.ok(!plan.directives.some((d) => d.includes("[Tool: browser]")));
});

test("dc-ephemeral-types: dc-tech-analyst está registrado en DC_AGENT_ARCHETYPES con su receta completa", () => {
  const arch = (DC_AGENT_ARCHETYPES as any)["dc-tech-analyst"];
  assert.ok(arch, "dc-tech-analyst debe existir en DC_AGENT_ARCHETYPES");
  assert.equal(arch.name, "dc-tech-analyst");
  assert.ok(arch.toolBricks.includes("fs-read"));
  assert.ok(arch.toolBricks.includes("code-intel"));
  assert.ok(arch.toolBricks.includes("docs"));
  assert.ok(arch.toolBricks.includes("web-search"));
  assert.ok(arch.behaviorBricks.includes("read-only-analyst"));
  assert.ok(arch.behaviorBricks.includes("source-verification"));
  assert.equal(arch.defaultEffort, "high");
});

test("dc-ephemeral-manager: rechaza arquetipo desconocido si falta la receta (cero suposiciones)", () => {
  assert.throws(
    () => {
      assembleLegoAgentPlan({
        task: "Analizar arquitectura sin receta",
        archetype: "dc-invented-role" as any,
      });
    },
    (err: any) => {
      assert.match(err.message, /no existe en el catálogo/i);
      assert.match(err.message, /no se asume nada/i);
      assert.match(err.message, /toolBricks/i);
      return true;
    },
  );
});

test("dc-ephemeral-manager: permite rol o arquetipo ad-hoc cuando el orquestador define la receta explícita", () => {
  const plan = assembleLegoAgentPlan({
    task: "Analizar arquitectura a medida",
    role: "custom-perf-auditor",
    toolBricks: ["fs-read", "terminal"],
    behaviorBricks: ["read-only-analyst"],
  });

  assert.ok(plan.tools.includes("read"));
  assert.ok(plan.tools.includes("bash"));
  assert.ok(!plan.tools.includes("edit"));
  assert.ok(plan.directives.some((d) => d.includes("solo lectura")));
});

test("dc-ephemeral-tools: dc_ephemeral_agent_run y dc_ephemeral_batch_run tienen schemas flexibles sin enum excluyente", () => {
  const registered: any[] = [];
  const fakePi = {
    registerTool(toolDef: any) {
      registered.push(toolDef);
    },
  } as any;

  registerDcEphemeralTools(fakePi);
  const singleTool = registered.find((t) => t.name === "dc_ephemeral_agent_run");
  const batchTool = registered.find((t) => t.name === "dc_ephemeral_batch_run");

  assert.ok(singleTool);
  assert.ok(batchTool);

  // archetype no debe tener enum rígido que rechace en la puerta del JSON Schema de Pi
  assert.equal(singleTool.parameters.properties.archetype.enum, undefined);
  assert.equal(batchTool.parameters.properties.items.items.properties.archetype.enum, undefined);
  assert.ok(singleTool.parameters.properties.archetype.description.includes("catálogo oficial"));
});

test("dc-ephemeral-tools: ensureBackgroundSweeper emits heartbeatTaxi every 5s for running tasks preventing TTL zombie reaping", () => {
  const tempDir = createTempDir("sweeper-heartbeat-test");
  const tasksDir = path.join(tempDir, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });

  const testTaskId = `task-heartbeat-${Date.now()}`;
  const taskFilePath = path.join(tasksDir, `${testTaskId}.json`);

  // Crear la tarea con status: "running"
  fs.writeFileSync(
    taskFilePath,
    JSON.stringify({
      task: {
        id: testTaskId,
        status: "running",
      },
    }),
    "utf8",
  );

  const fleetPath = path.join(tempDir, "dc-taxis.json");
  const customAccounts = ["ac01"];
  const fleetState = createInitialFleetState(customAccounts);

  const mockPlan = {
    agentName: "dc-sub-sweeper-test",
    leasedAccount: "ac01",
    agentFilePath: path.join(tempDir, "dc-sub-sweeper-test.md"),
    ephemeralId: `ephem-${Date.now()}`,
    fullModelRef: "cpam/ac01/gemini-3.8-flash-high",
    mode: "background" as const,
  } as any;

  // Taxi arrendado hace 400s (más de los 300s de leaseTtlMs)
  const initialTimestamp = Date.now() - 400_000;
  fleetState.fleet["ac01"].status = "ocupado";
  fleetState.fleet["ac01"].passenger = {
    type: "ephemeral_subagent",
    sessionId: "sess-heartbeat",
    pid: process.pid,
    model: "gemini-3.8-flash-high",
    startedAt: initialTimestamp,
    heartbeatAt: initialTimestamp,
    agentName: mockPlan.agentName,
  };
  saveFleetState(fleetState, fleetPath);

  // Registrar en activeBackgroundPlans
  activeBackgroundPlans.set(mockPlan.ephemeralId, {
    plan: mockPlan,
    sessionId: "sess-heartbeat",
    startedAt: initialTimestamp,
    taskId: testTaskId,
  });

  try {
    // 1. Antes del heartbeat, verificar que si avanzamos tiempo expiraría el TTL
    const beforeState = loadFleetState(fleetPath, customAccounts);
    assert.equal(beforeState.fleet["ac01"].passenger?.heartbeatAt, initialTimestamp);

    // 2. Ejecutar un pase del sweeper apuntando a nuestro tasksDir
    sweepBackgroundPlansOnce(tasksDir, fleetPath);

    // 3. Comprobar que se emitió el heartbeatTaxi y el heartbeatAt se actualizó a ~now
    const afterState = loadFleetState(fleetPath, customAccounts);
    const updatedHeartbeatAt = afterState.fleet["ac01"].passenger?.heartbeatAt || 0;
    assert.ok(updatedHeartbeatAt > initialTimestamp, "heartbeatAt must be updated by sweeper");
    assert.ok(Date.now() - updatedHeartbeatAt < 5000, "heartbeatAt must be fresh");

    // 4. reapAbandonedTaxis con leaseTtlMs de 300s NO debe reapear el taxi
    const reaped = reapAbandonedTaxis(afterState, 300000, Date.now());
    assert.equal(reaped, 0, "Running task must not be reaped as zombie");
    assert.equal(afterState.fleet["ac01"].status, "ocupado");
  } finally {
    activeBackgroundPlans.delete(mockPlan.ephemeralId);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("dc-ephemeral-tools: dc_ephemeral_batch_run in background mode registers all workers in activeBackgroundPlans with taskId and starts sweeper", async () => {
  const registered: any[] = [];
  const fakePi = {
    registerTool(toolDef: any) {
      registered.push(toolDef);
    },
  } as any;

  registerDcEphemeralTools(fakePi);
  const batchTool = registered.find((t) => t.name === "dc_ephemeral_batch_run");
  assert.ok(batchTool);

  const initialBgCount = activeBackgroundPlans.size;
  const dispatchedWorkers: Array<{ agent: string; taskId: string }> = [];

  const fakeCtx = {
    sessionManager: { getSessionId: () => `sess-batch-bg-${Date.now()}` },
    model: { provider: "cpam", id: "ac01/gemini-3.8-flash-high" },
    executeTool: async (name: string, args: any) => {
      assert.equal(name, "subagent_run");
      assert.equal(args.mode, "background");
      const assignedTaskId = `task-${args.label}-${Date.now()}`;
      dispatchedWorkers.push({ agent: args.agent, taskId: assignedTaskId });
      return {
        toolCall: { id: `call-${args.label}`, name: "subagent_run", arguments: args },
        result: {
          content: [{ type: "text", text: `Subagent started in background with taskId ${assignedTaskId}` }],
          details: { taskId: assignedTaskId, background: true },
        },
      };
    },
  } as any;

  const result = await batchTool.execute(
    "call-batch-bg-1",
    {
      items: [
        { task: "Indexar repositorio A", role: "indexer-a" },
        { task: "Indexar repositorio B", role: "indexer-b" },
      ],
      mode: "background",
    },
    undefined,
    undefined,
    fakeCtx,
  );

  assert.equal(dispatchedWorkers.length, 2);
  assert.equal(activeBackgroundPlans.size, initialBgCount + 2);

  const agentFilesToClean: string[] = [];
  const accountsToClean: string[] = [];

  try {
    for (const worker of dispatchedWorkers) {
      // 1. Cada subagente debe estar registrado en activeBackgroundPlans con su taskId
      const matchingEntry = Array.from(activeBackgroundPlans.values()).find(
        (v: any) => v.plan.agentName === worker.agent,
      );
      assert.ok(matchingEntry, `Worker ${worker.agent} must be tracked in activeBackgroundPlans`);
      assert.equal(matchingEntry.taskId, worker.taskId);
      assert.equal(matchingEntry.plan.mode, "background");

      // 2. El archivo de agente NO debe haberse borrado en background
      assert.equal(fs.existsSync(matchingEntry.plan.agentFilePath), true);
      agentFilesToClean.push(matchingEntry.plan.agentFilePath);
      accountsToClean.push(matchingEntry.plan.leasedAccount);

      // 3. El taxi arrendado debe permanecer en estado ocupado
      const fleet = loadFleetState();
      assert.equal(fleet.fleet[matchingEntry.plan.leasedAccount].status, "ocupado");
    }

    // 4. Los logs de delegación en background deben haberse emitido para cada worker
    const recentLogs = readRecentTaxiLogs(15);
    for (const worker of dispatchedWorkers) {
      const match = recentLogs.find(
        (l) => l.includes("EPHEMERAL_AGENT_BACKGROUND_DELEGATED") && l.includes(worker.agent),
      );
      assert.ok(match, `Delegation log must exist for ${worker.agent}`);
    }
  } finally {
    // Limpieza de planes y archivos de prueba
    for (const worker of dispatchedWorkers) {
      const entry = Array.from(activeBackgroundPlans.entries()).find(
        ([_, v]: [string, any]) => v.plan.agentName === worker.agent,
      );
      if (entry) {
        activeBackgroundPlans.delete(entry[0]);
      }
    }
    for (const f of agentFilesToClean) {
      try {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      } catch {}
    }
    for (const acc of accountsToClean) {
      try {
        releaseTaxi(acc, "cleanup-test");
      } catch {}
    }
  }
});

test("dc-taxi-dispatcher: assigns unique plates to orchestrator and leased taxis", () => {
  const tempDir = createTempDir("taxi-plates");
  const fleetPath = path.join(tempDir, "dc-taxis.json");

  try {
    const customAccounts = ["ac01", "ac02", "ac03"];
    saveFleetState(createInitialFleetState(customAccounts), fleetPath);

    // 1. acquireOrchestratorTaxi assigns DC-HOST-${pid}
    const orcRes = acquireOrchestratorTaxi(
      "sess-orc-plate",
      "cpam/ac01/gemini-3.8-flash-high",
      fleetPath,
      99999,
      customAccounts,
    );
    assert.ok(orcRes);
    const stateOrc = loadFleetState(fleetPath, customAccounts);
    assert.equal(stateOrc.fleet["ac01"].passenger?.plate, "DC-HOST-99999");

    // 2. leaseTaxi with explicit plate
    const lease1 = leaseTaxi(
      {
        type: "ephemeral_subagent",
        sessionId: "sess-sub-1",
        pid: 88888,
        plate: "DC-CUSTOM1",
      },
      undefined,
      fleetPath,
      undefined,
      customAccounts,
    );
    assert.ok(lease1);
    assert.equal(lease1.unit.passenger?.plate, "DC-CUSTOM1");

    // 3. leaseTaxi without plate generates DC-${6-char uppercase hex/alphanumeric}
    const lease2 = leaseTaxi(
      {
        type: "ephemeral_subagent",
        sessionId: "sess-sub-2",
        pid: 77777,
      },
      undefined,
      fleetPath,
      undefined,
      customAccounts,
    );
    assert.ok(lease2);
    assert.ok(lease2.unit.passenger?.plate);
    assert.match(lease2.unit.passenger.plate, /^DC-[0-9A-F]{6}$/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("dc-ephemeral-manager: prepareEphemeralAgent passes plate DC-${uuidShort.toUpperCase()}", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-ephem-plate-test-"));
  try {
    const plan = prepareEphemeralAgent(
      {
        task: "Verificar contratos de telemetría",
        archetype: "dc-odd-worker",
        seedContext: "## Allowed edit surfaces\ntest/dummy.ts",
      },
      {
        sessionId: "sess-plate-ephemeral",
      },
    );

    const fleet = loadFleetState();
    const unit = fleet.fleet[plan.leasedAccount];
    assert.ok(unit && unit.passenger);

    // El nombre del subagente termina en uuidShort (6 chars)
    const suffix = plan.agentName.slice(-6).toUpperCase();
    assert.equal(unit.passenger.plate, `DC-${suffix}`);
    assert.match(unit.passenger.plate, /^DC-[0-9A-F]{6}$/);

    cleanupEphemeralAgent(plan, {
      sessionId: "sess-plate-ephemeral",
      startedAt: Date.now() - 1000,
      endedAt: Date.now(),
      status: "completed",
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("dc-taxis-panel: renders updated vehicular telemetry labels (Pasajero, Circuito, Conductor, Placa, Taxímetro)", () => {
  const fakeTheme = {
    bold: (s: string) => `*${s}*`,
    fg: (_c: string, s: string) => s,
    bg: (_c: string, s: string) => s,
  } as any;

  const panel = new DcTaxisPanel({
    theme: fakeTheme,
    onDone: () => {},
    requestRender: () => {},
  });

  (panel as any).selectedDetailUnit = {
    account: "ac03",
    status: "ocupado",
    passenger: {
      type: "ephemeral_subagent",
      sessionId: "sess-test-panel",
      pid: 54321,
      model: "cpam/ac03/gemini-3.8-flash-high",
      taskLabel: "Ruta de prueba vehicular",
      plate: "DC-TEST99",
      tokens: 4500,
      cost: 0.0035,
      startedAt: Date.now() - 15000,
      heartbeatAt: Date.now(),
    },
  };

  const renderedLines = panel.render(100);

  // 1. Verificar nuevas etiquetas
  assert.ok(renderedLines.some((l: string) => l.includes("Pasajero:")), "Debe contener etiqueta Pasajero:");
  assert.ok(renderedLines.some((l: string) => l.includes("Circuito:") && l.includes("Ruta de prueba vehicular")), "Debe contener etiqueta Circuito:");
  assert.ok(renderedLines.some((l: string) => l.includes("Conductor:") && l.includes("gemini-3.8-flash-high")), "Debe contener etiqueta Conductor:");
  assert.ok(renderedLines.some((l: string) => l.includes("Placa:") && l.includes("DC-TEST99")), "Debe contener etiqueta Placa con matricula DC-*");
  assert.ok(renderedLines.some((l: string) => l.includes("Taxímetro:") && l.includes("15s") && l.includes("tk") && l.includes("0.0035")), "Debe contener etiqueta Taxímetro con duración, tokens y costo");

  // 2. Verificar que las etiquetas antiguas ya no se muestren
  assert.ok(!renderedLines.some((l: string) => l.includes("Tipo Pasajero:")), "No debe contener Tipo Pasajero:");
  assert.ok(!renderedLines.some((l: string) => l.includes("Tarea / Misión:")), "No debe contener Tarea / Misión:");
  assert.ok(!renderedLines.some((l: string) => l.includes("Modelo Activo:")), "No debe contener Modelo Activo:");
  assert.ok(!renderedLines.some((l: string) => l.includes("PID / Proceso:")), "No debe contener PID / Proceso:");

  // 3. Fallback de placa cuando p.plate no está definido: debe usar DC-${p.pid}
  (panel as any).selectedDetailUnit.passenger.plate = undefined;
  const fallbackLines = panel.render(100);
  assert.ok(fallbackLines.some((l: string) => l.includes("Placa:") && l.includes("DC-54321")), "Placa debe caer en DC-${p.pid} como fallback");
});

test("dc-sidebar-status-card: createTaxiUnitRows separates Placa DC-* and Taximetro with elapsed duration and tokens", () => {
  const occupiedUnit = {
    account: "ac02",
    status: "ocupado" as const,
    passenger: {
      type: "ephemeral_subagent" as const,
      sessionId: "sess-sidebar-test",
      pid: 67890,
      model: "cpam/ac02/gemini-3.8-flash-high",
      taskLabel: "Refactorización de telemetría vehicular",
      plate: "DC-SIDE99",
      tokens: 3500,
      startedAt: Date.now() - 25000,
      heartbeatAt: Date.now(),
    },
  };

  const rows = createTaxiUnitRows(occupiedUnit);
  assert.equal(rows.length, 6, "Debe tener 6 filas: Pasajero, Circuito, Conductor, Placa, Taxímetro, y Telemetría en vivo");

  const renderedRows = rows.map((r: any) => r.render(80).join(" "));

  // Verificar Pasajero, Circuito, Conductor, Placa, Taxímetro
  assert.ok(renderedRows.some((l: string) => l.includes("Pasajero:") && l.includes("efímero")), "Debe renderizar Pasajero con rol");
  assert.ok(renderedRows.some((l: string) => l.includes("Circuito:") && l.includes("Refactorización")), "Debe renderizar Circuito con taskShort");
  assert.ok(renderedRows.some((l: string) => l.includes("Conductor:") && l.includes("gemini-3.8-flash-high")), "Debe renderizar Conductor con modelClean");
  assert.ok(renderedRows.some((l: string) => l.includes("Placa:") && l.includes("DC-SIDE99")), "Debe renderizar Placa con prefijo DC-*");
  assert.ok(renderedRows.some((l: string) => l.includes("Taxímetro:") && l.includes("25s") && l.includes("3.5k")), "Debe renderizar Taxímetro con tiempo y tokens formateados");

  // Fallback de placa cuando p.plate no existe
  const fallbackUnit = {
    account: "ac01",
    status: "ocupado" as const,
    passenger: {
      type: "orchestrator" as const,
      sessionId: "sess-orc-fallback",
      pid: 12345,
      model: "cpam/ac01/gemini-3.8-flash-high",
      taskLabel: "Orquestador activo",
      startedAt: Date.now() - 5000,
      heartbeatAt: Date.now(),
    },
  };
  const fallbackRows = createTaxiUnitRows(fallbackUnit);
  const renderedFallback = fallbackRows.map((r: any) => r.render(80).join(" "));
  assert.ok(renderedFallback.some((l: string) => l.includes("Placa:") && l.includes("DC-12345")), "Placa debe usar fallback DC-${p.pid}");
  assert.ok(renderedFallback.some((l: string) => l.includes("Taxímetro:") && l.includes("5s")), "Taxímetro debe mostrar duración sin tokens cuando no hay tokens");
});

test("MÓDULO A: releaseTaxi orchestrator immunity blocks unauthorized release and logs TAXI_ORCHESTRATOR_IMMUNITY_PROTECTED", () => {
  const tempDir = createTempDir("orch-immunity");
  const fleetPath = path.join(tempDir, "dc-taxis.json");

  try {
    const customAccounts = ["ac01", "ac02"];
    const state = createInitialFleetState(customAccounts);

    // Asignar ac01 a un orchestrator
    state.fleet["ac01"].status = "ocupado";
    state.fleet["ac01"].passenger = {
      type: "orchestrator",
      sessionId: "orch-master-session",
      pid: process.pid,
      model: "cpam/ac01/gemini-3.8-flash-high",
      taskLabel: "Sesión Principal",
      plate: `DC-HOST-${process.pid}`,
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
    };
    saveFleetState(state, fleetPath);

    // 1. Intento sin sessionId: PROHIBIDO
    const res1 = releaseTaxi("ac01", undefined, fleetPath, customAccounts);
    assert.equal(res1, false, "releaseTaxi sin sessionId debe retornar false para un orquestador");
    const stateCheck1 = loadFleetState(fleetPath, customAccounts);
    assert.equal(stateCheck1.fleet["ac01"].status, "ocupado", "Taxi debe seguir ocupado");
    assert.equal(stateCheck1.fleet["ac01"].passenger?.sessionId, "orch-master-session");

    // 2. Intento con sessionId erróneo: PROHIBIDO
    const res2 = releaseTaxi("ac01", "imposter-session", fleetPath, customAccounts);
    assert.equal(res2, false, "releaseTaxi con sessionId erróneo debe retornar false");
    const stateCheck2 = loadFleetState(fleetPath, customAccounts);
    assert.equal(stateCheck2.fleet["ac01"].status, "ocupado");

    // 3. Intento con sessionId correcto pero PID diferente: PROHIBIDO
    const res3 = releaseTaxi("ac01", "orch-master-session", fleetPath, customAccounts, undefined, { pid: 999999 });
    assert.equal(res3, false, "releaseTaxi con PID diferente debe retornar false");
    const stateCheck3 = loadFleetState(fleetPath, customAccounts);
    assert.equal(stateCheck3.fleet["ac01"].status, "ocupado");

    // 4. Verificar log de protección de inmunidad
    const logs = readRecentTaxiLogs(10);
    const immunityLog = logs.find((l) => l.includes("TAXI_ORCHESTRATOR_IMMUNITY_PROTECTED"));
    assert.ok(immunityLog, "Debe registrarse advertencia TAXI_ORCHESTRATOR_IMMUNITY_PROTECTED en los logs");

    // 5. Intento con sessionId y PID coincidentes: PERMITIDO
    const res4 = releaseTaxi("ac01", "orch-master-session", fleetPath, customAccounts, undefined, { pid: process.pid });
    assert.equal(res4, true, "releaseTaxi con sessionId y pid coincidentes debe tener éxito");
    const stateCheck4 = loadFleetState(fleetPath, customAccounts);
    assert.equal(stateCheck4.fleet["ac01"].status, "libre", "Taxi debe quedar liberado");
    assert.equal(stateCheck4.fleet["ac01"].passenger, null);

    // 6. releaseOrchestratorTaxi explícito: PERMITIDO
    stateCheck4.fleet["ac01"].status = "ocupado";
    stateCheck4.fleet["ac01"].passenger = {
      type: "orchestrator",
      sessionId: "orch-second-session",
      pid: process.pid,
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
    };
    saveFleetState(stateCheck4, fleetPath);

    releaseOrchestratorTaxi("orch-second-session", process.pid, fleetPath, customAccounts);
    const stateCheck5 = loadFleetState(fleetPath, customAccounts);
    assert.equal(stateCheck5.fleet["ac01"].status, "libre", "releaseOrchestratorTaxi debe liberar la unidad");
    assert.equal(stateCheck5.fleet["ac01"].passenger, null);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("MÓDULO A: leaseAvailableTaxis allocates N free units dynamically without hardcoded account list", () => {
  const tempDir = createTempDir("lease-available");
  const fleetPath = path.join(tempDir, "dc-taxis.json");

  try {
    const customAccounts = ["ac01", "ac02", "ac03", "ac04"];
    const state = createInitialFleetState(customAccounts);
    saveFleetState(state, fleetPath);

    // Arrendar 2 unidades libres
    const leased = leaseAvailableTaxis(
      2,
      (idx) => ({
        type: "ephemeral_subagent",
        sessionId: `batch-sess-${idx}`,
        pid: process.pid,
        taskLabel: `Subtarea paralela #${idx + 1}`,
        model: "cpam/ac-dyn/gemini-3.8-flash-high",
      }),
      fleetPath,
      300000,
      customAccounts,
    );

    assert.equal(leased.length, 2, "Debe arrendar exactamente 2 unidades");
    assert.equal(leased[0].status, "ocupado");
    assert.equal(leased[1].status, "ocupado");
    assert.notEqual(leased[0].account, leased[1].account, "Las cuentas asignadas deben ser distintas");
    assert.equal(leased[0].passenger?.taskLabel, "Subtarea paralela #1");
    assert.equal(leased[1].passenger?.taskLabel, "Subtarea paralela #2");
    assert.ok(leased[0].passenger?.plate?.startsWith("DC-"), "Debe tener placa generada");

    // Verificar en disco
    const updated = loadFleetState(fleetPath, customAccounts);
    assert.equal(updated.fleet[leased[0].account].status, "ocupado");
    assert.equal(updated.fleet[leased[1].account].status, "ocupado");

    // Pedir más unidades de las disponibles (quedan 2 libres, pedimos 5)
    const leasedMore = leaseAvailableTaxis(
      5,
      (idx) => ({
        type: "ephemeral_subagent",
        sessionId: `overflow-sess-${idx}`,
        pid: process.pid,
      }),
      fleetPath,
      300000,
      customAccounts,
    );

    assert.equal(leasedMore.length, 2, "Solo debe retornar las 2 unidades que quedaban libres");

    // Ahora la flota está llena (0 libres)
    const leasedEmpty = leaseAvailableTaxis(
      1,
      (idx) => ({
        type: "ephemeral_subagent",
        sessionId: `empty-sess-${idx}`,
        pid: process.pid,
      }),
      fleetPath,
      300000,
      customAccounts,
    );

    assert.equal(leasedEmpty.length, 0, "Debe retornar array vacío cuando la flota está agotada");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("MÓDULO B: sendTaxiToWorkshop and repairTaxiFromWorkshop lifecycle", () => {
  const tempDir = createTempDir("workshop-lifecycle");
  const fleetPath = path.join(tempDir, "dc-taxis.json");

  try {
    const customAccounts = ["ac01", "ac02", "ac03"];
    const state = createInitialFleetState(customAccounts);

    // Ocupar ac01 con un subagente
    state.fleet["ac01"].status = "ocupado";
    state.fleet["ac01"].passenger = {
      type: "ephemeral_subagent",
      sessionId: "broken-sess",
      pid: process.pid,
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
    };
    saveFleetState(state, fleetPath);

    // 1. Enviar ac01 a taller
    const sent = sendTaxiToWorkshop("ac01", "Google Auth Error / Deshabilitada (HTTP 401)", fleetPath, customAccounts);
    assert.equal(sent, true, "sendTaxiToWorkshop debe retornar true");

    const stateWorkshop = loadFleetState(fleetPath, customAccounts);
    const unit01 = stateWorkshop.fleet["ac01"];
    assert.equal(unit01.status, "en_taller", "Estado debe ser en_taller");
    assert.equal(unit01.passenger, null, "Pasajero debe desalojarse");
    assert.equal(unit01.workshopReason, "Google Auth Error / Deshabilitada (HTTP 401)");
    assert.ok(typeof unit01.workshopSince === "number");

    // 2. leaseTaxi debe ignorar ac01 aunque sea la preferida
    const leaseRes = leaseTaxi(
      {
        type: "ephemeral_subagent",
        sessionId: "lease-try-sess",
        pid: process.pid,
      },
      "ac01", // pedimos ac01 que está en taller
      fleetPath,
      300000,
      customAccounts,
    );
    assert.ok(leaseRes, "Debe asignar otra unidad libre");
    assert.notEqual(leaseRes.account, "ac01", "NUNCA debe arrendar ac01 mientras esté en taller");

    // 3. leaseAvailableTaxis debe ignorar ac01
    const availableLeased = leaseAvailableTaxis(
      3,
      (idx) => ({
        type: "ephemeral_subagent",
        sessionId: `avail-sess-${idx}`,
        pid: process.pid,
      }),
      fleetPath,
      300000,
      customAccounts,
    );
    assert.ok(!availableLeased.some((u) => u.account === "ac01"), "leaseAvailableTaxis no debe incluir ac01");

    // 4. Reparar ac01 desde el taller
    const repaired = repairTaxiFromWorkshop("ac01", fleetPath, customAccounts);
    assert.equal(repaired, true, "repairTaxiFromWorkshop debe retornar true");

    const stateRepaired = loadFleetState(fleetPath, customAccounts);
    const unit01Repaired = stateRepaired.fleet["ac01"];
    assert.equal(unit01Repaired.status, "libre", "Estado debe volver a libre");
    assert.equal(unit01Repaired.workshopReason, undefined);
    assert.equal(unit01Repaired.workshopSince, undefined);

    // Intentar reparar una unidad que no está en taller
    const repairedAgain = repairTaxiFromWorkshop("ac01", fleetPath, customAccounts);
    assert.equal(repairedAgain, false, "Reparar una unidad ya libre debe retornar false");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("MÓDULO B: UI rendering of 🛠️ EN TALLER in dc-sidebar-status-card and dc-taxis-panel", () => {
  // 1. Sidebar status card
  const workshopUnit = {
    account: "ac40",
    status: "en_taller" as const,
    passenger: null,
    workshopReason: "Google Auth Error / Deshabilitada",
    workshopSince: Date.now() - 60000,
  };

  const rows = createTaxiUnitRows(workshopUnit);
  const renderedSidebar = rows.map((r: any) => r.render(80).join(" "));
  assert.ok(
    renderedSidebar.some((l: string) => l.includes("🛠️ EN TALLER")),
    "Sidebar debe mostrar 🛠️ EN TALLER",
  );
  assert.ok(
    renderedSidebar.some((l: string) => l.includes("Google Auth Error / Deshabilitada")),
    "Sidebar debe mostrar el motivo de avería",
  );

  // 2. DcTaxisPanel
  const fakeTheme = {
    bold: (s: string) => `*${s}*`,
    fg: (_c: string, s: string) => s,
    bg: (_c: string, s: string) => s,
  } as any;

  const panel = new DcTaxisPanel({
    theme: fakeTheme,
    onDone: () => {},
    requestRender: () => {},
  });

  (panel as any).selectedDetailUnit = workshopUnit;
  const renderedDetail = panel.render(100);

  assert.ok(
    renderedDetail.some((l: string) => l.includes("🛠️ EN TALLER")),
    "Detalle en DcTaxisPanel debe mostrar 🛠️ EN TALLER",
  );
  assert.ok(
    renderedDetail.some((l: string) => l.includes("Google Auth Error / Deshabilitada")),
    "Detalle en DcTaxisPanel debe mostrar el motivo de avería",
  );
});

test("MÓDULO B: auditAccountForWorkshop sends ac40 and 400/401/403 fatal auth accounts to workshop", async () => {
  const tempDir = createTempDir("audit-workshop");
  const fleetPath = path.join(tempDir, "dc-taxis.json");

  try {
    const customAccounts = ["ac01", "ac02", "ac40"];
    const state = createInitialFleetState(customAccounts);
    saveFleetState(state, fleetPath);

    // 1. ac40 es fatal auth conocido por defecto -> debe enviarse directamente a taller
    const sentAc40 = await auditAccountForWorkshop("ac40", fleetPath);
    assert.equal(sentAc40, true, "ac40 debe ser enviada a taller automáticamente");

    const state1 = loadFleetState(fleetPath, customAccounts);
    assert.equal(state1.fleet["ac40"].status, "en_taller");
    assert.ok(state1.fleet["ac40"].workshopReason?.includes("ac40"));

    // 2. ac01 responde HTTP 401 en fetcher -> debe enviarse a taller
    const mockFetcher401 = async (_acc: string) => {
      const err: any = new Error("Unauthorized access to Gemini provider");
      err.status = 401;
      throw err;
    };
    const sentAc01 = await auditAccountForWorkshop("ac01", fleetPath, mockFetcher401);
    assert.equal(sentAc01, true, "ac01 con HTTP 401 debe enviarse a taller");

    const state2 = loadFleetState(fleetPath, customAccounts);
    assert.equal(state2.fleet["ac01"].status, "en_taller");

    // 3. ac02 responde HTTP 403 (Forbidden / Deshabilitada) -> debe enviarse a taller
    const mockFetcher403 = async (_acc: string) => {
      const err: any = new Error("Google Auth Error: account deshabilitada");
      err.status = 403;
      throw err;
    };
    const sentAc02 = await auditAccountForWorkshop("ac02", fleetPath, mockFetcher403);
    assert.equal(sentAc02, true, "ac02 con HTTP 403 debe enviarse a taller");

    const state3 = loadFleetState(fleetPath, customAccounts);
    assert.equal(state3.fleet["ac02"].status, "en_taller");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("MÓDULO B: handleTurnEndForWorkshop sends taxi to workshop upon provider auth error in turn_end", () => {
  const tempDir = createTempDir("turn-end-workshop");
  const fleetPath = path.join(tempDir, "dc-taxis.json");

  try {
    const customAccounts = ["ac05"];
    const state = createInitialFleetState(customAccounts);
    state.fleet["ac05"].status = "ocupado";
    state.fleet["ac05"].passenger = {
      type: "orchestrator",
      sessionId: "orch-turn-error-sess",
      pid: process.pid,
      model: "cpam/ac05/gemini-3.8-flash-high",
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
    };
    saveFleetState(state, fleetPath);

    // Evento de turn_end con error de autenticación
    const turnEvent = {
      type: "turn_end",
      turnIndex: 1,
      message: {
        role: "assistant",
        stopReason: "error",
        errorMessage: "Google Auth Error: token revoked or unauthorized (HTTP 401)",
        status: 401,
      },
      toolResults: [],
    };

    const ctx = {
      model: {
        provider: "cpam",
        id: "ac05/gemini-3.8-flash-high",
      },
      sessionManager: {
        getSessionId: () => "orch-turn-error-sess",
      },
    } as any;

    const outcome = handleTurnEndForWorkshop(turnEvent, ctx, fleetPath);
    assert.equal(outcome.sent, true, "handleTurnEndForWorkshop debe detectar el error de auth y enviar el taxi a taller");
    assert.equal(outcome.account, "ac05");

    const stateAfter = loadFleetState(fleetPath, customAccounts);
    assert.equal(stateAfter.fleet["ac05"].status, "en_taller");
    assert.ok(stateAfter.fleet["ac05"].workshopReason?.includes("Google Auth Error"));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("MÓDULO C: evaluateTaxiHandoverRequired detects >90% token limit (>120k) and quota <10%", () => {
  assert.equal(DEFAULT_TOKEN_HANDOVER_THRESHOLD, 120_000);
  assert.equal(DEFAULT_QUOTA_HANDOVER_THRESHOLD_PCT, 10);

  // 1. Tokens y cuota normales -> no requerido
  const normal = evaluateTaxiHandoverRequired({
    account: "ac01",
    tokens: 50_000,
    quotaPct: 75,
  });
  assert.equal(normal.required, false);

  // 2. Tokens > 120_000 -> requerido con reason 'token_limit_90'
  const tokenLimit = evaluateTaxiHandoverRequired({
    account: "ac01",
    tokens: 125_000,
    quotaPct: 75,
  });
  assert.equal(tokenLimit.required, true);
  assert.equal(tokenLimit.reason, "token_limit_90");
  assert.equal(tokenLimit.tokens, 125_000);

  // 3. Cuota < 10% -> requerido con reason 'quota_exhausted'
  const quotaLow = evaluateTaxiHandoverRequired({
    account: "ac01",
    tokens: 30_000,
    quotaPct: 8,
  });
  assert.equal(quotaLow.required, true);
  assert.equal(quotaLow.reason, "quota_exhausted");

  // 4. Con transferredTokens previos, se descuentan para evitar loops
  const withTransferred = evaluateTaxiHandoverRequired({
    account: "ac02",
    tokens: 130_000,
    transferredTokens: 125_000,
    quotaPct: 85,
  });
  assert.equal(withTransferred.required, false, "Los tokens de la unidad previa deben descontarse");

  // 5. Extracción automática desde archivo de tarea en tasksDir
  const tempDir = createTempDir("eval-task-file");
  try {
    const taskFile = path.join(tempDir, "task-tok-test.json");
    fs.writeFileSync(taskFile, JSON.stringify({
      task: { id: "task-tok-test", agent: "dc-worker", tokens: 135_000, status: "running" }
    }));

    const fromFile = evaluateTaxiHandoverRequired({
      account: "ac01",
      taskId: "task-tok-test",
      tasksDir: tempDir,
      quotaPct: 90,
    });
    assert.equal(fromFile.required, true);
    assert.equal(fromFile.reason, "token_limit_90");
    assert.equal(fromFile.tokens, 135_000);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("MÓDULO C: executeTaxiHandover leases new unit avoiding occupied/workshop, enriches seedContext, and logs TAXI_HANDOVER_EXECUTED", () => {
  const tempDir = createTempDir("handover-exec");
  const fleetPath = path.join(tempDir, "dc-taxis.json");
  const tasksDir = path.join(tempDir, "tasks");
  const agentsDir = path.join(tempDir, "agents");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(agentsDir, { recursive: true });

  const customAccounts = ["ac01", "ac02", "ac03", "ac04", "ac05", "ac06"];
  const fleetState = createInitialFleetState(customAccounts);

  // ac01: ocupado con subagente que superó tokens
  fleetState.fleet["ac01"].status = "ocupado";
  fleetState.fleet["ac01"].passenger = {
    type: "ephemeral_subagent",
    sessionId: "sess-handover-test",
    pid: process.pid,
    model: "cpam/ac01/gemini-3.8-flash-high",
    taskId: "task-handover-01",
    agentName: "dc-sub-worker-handover",
    startedAt: Date.now() - 50_000,
    heartbeatAt: Date.now(),
  };

  // ac02: en taller (debe evitarse)
  fleetState.fleet["ac02"].status = "en_taller";
  fleetState.fleet["ac02"].workshopReason = "Google Auth Error 401";

  // ac03: ocupado por orquestador (debe evitarse)
  fleetState.fleet["ac03"].status = "ocupado";
  fleetState.fleet["ac03"].passenger = {
    type: "orchestrator",
    sessionId: "orch-sess",
    pid: process.pid,
    startedAt: Date.now(),
    heartbeatAt: Date.now(),
  };

  // ac04: recargando (debe evitarse)
  fleetState.fleet["ac04"].status = "recargando";

  // ac05: libre (cuota 60%)
  fleetState.fleet["ac05"].status = "libre";

  // ac06: libre (cuota 95%) -> mejor opción libre
  fleetState.fleet["ac06"].status = "libre";

  saveFleetState(fleetState, fleetPath);

  // Archivo de definición del agente en disco
  const agentFilePath = path.join(agentsDir, "dc-sub-worker-handover.md");
  fs.writeFileSync(agentFilePath, [
    "---",
    "name: dc-sub-worker-handover",
    "model: cpam/ac01/gemini-3.8-flash-high",
    "effort: high",
    "mode: background",
    "---",
    "",
    "# System Prompt",
    "Eres un worker.",
    "",
    "## Contexto Semilla (Seed Context)",
    "Avance inicial de la tarea."
  ].join("\n"));

  // Archivo de tarea en gentle-agents/tasks/
  const taskFilePath = path.join(tasksDir, "task-handover-01.json");
  fs.writeFileSync(taskFilePath, JSON.stringify({
    task: {
      id: "task-handover-01",
      agent: "dc-sub-worker-handover",
      status: "running",
      tokens: 128_000,
      result: "Fases 1 y 2 ejecutadas con éxito. Pendiente fase 3."
    }
  }));

  const mockQuotaGetter = (acc: string) => {
    if (acc === "ac05") return { gemini5hPct: 60, resetTimeIso: "2026-10-21T18:00:00Z" } as any;
    if (acc === "ac06") return { gemini5hPct: 95, resetTimeIso: "2026-10-21T18:00:00Z" } as any;
    if (acc === "ac01") return { gemini5hPct: 80, resetTimeIso: "2026-10-21T18:00:00Z" } as any;
    return undefined;
  };

  const plan = {
    ephemeralId: "ho1234",
    agentName: "dc-sub-worker-handover",
    agentFilePath,
    leasedAccount: "ac01",
    fullModelRef: "cpam/ac01/gemini-3.8-flash-high",
    effectiveEffort: "high" as const,
    tools: ["read", "write"],
    mode: "background" as const,
  };

  try {
    const outcome = executeTaxiHandover({
      plan,
      sessionId: "sess-handover-test",
      originalTaskId: "task-handover-01",
      reason: "token_limit_90",
      tokens: 128_000,
      tasksDir,
      fleetPath,
      allowedAccounts: customAccounts,
      quotaGetter: mockQuotaGetter,
    });

    assert.equal(outcome.success, true);
    assert.equal(outcome.newAccount, "ac06", "Debe arrendar ac06 por tener mayor cuota (95%) y evitar ocupados/taller");
    assert.equal(outcome.previousAccount, "ac01");

    const packet = outcome.packet!;
    assert.ok(packet);
    assert.equal(packet.originalTaskId, "task-handover-01");
    assert.equal(packet.previousAccount, "ac01");
    assert.equal(packet.newAccount, "ac06");
    assert.equal(packet.transferredTokens, 128_000);
    assert.equal(packet.handoverReason, "token_limit_90");
    assert.ok(packet.handoffSummary.includes("Fases 1 y 2 ejecutadas"));
    assert.ok(packet.handoverTimestamp > 0);

    // Verificar estado de flota
    const stateAfter = loadFleetState(fleetPath, customAccounts);
    assert.equal(stateAfter.fleet["ac06"].status, "ocupado");
    assert.equal(stateAfter.fleet["ac06"].passenger?.taskId, "task-handover-01");
    assert.equal(stateAfter.fleet["ac01"].status, "libre", "ac01 debe liberarse a libre al no tener cuota agotada");
    assert.equal(stateAfter.fleet["ac01"].passenger, null);

    // Verificar actualización del archivo de definición del agente y enriquecimiento de seedContext
    const agentContent = fs.readFileSync(agentFilePath, "utf8");
    assert.ok(agentContent.includes("model: cpam/ac06/gemini-3.8-flash-high"));
    assert.ok(agentContent.includes("Taxi Handover Packet"));
    assert.ok(agentContent.includes("Fases 1 y 2 ejecutadas"));

    // Verificar log estructurado TAXI_HANDOVER_EXECUTED
    const logs = readRecentTaxiLogs(15);
    const handoverLog = logs.find((l) => l.includes("TAXI_HANDOVER_EXECUTED") && l.includes("ac06"));
    assert.ok(handoverLog, "Debe registrar TAXI_HANDOVER_EXECUTED en el log de auditoría");
    assert.ok(handoverLog.includes("ac01"));
    assert.ok(handoverLog.includes("128000"));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("MÓDULO C: executeTaxiHandover releases previous taxi to 'recargando' when quota is exhausted", () => {
  const tempDir = createTempDir("handover-recargando");
  const fleetPath = path.join(tempDir, "dc-taxis.json");

  const customAccounts = ["ac01", "ac02"];
  const fleetState = createInitialFleetState(customAccounts);

  fleetState.fleet["ac01"].status = "ocupado";
  fleetState.fleet["ac01"].passenger = {
    type: "ephemeral_subagent",
    sessionId: "sess-quota-ho",
    pid: process.pid,
    model: "cpam/ac01/gemini-3.8-flash-high",
    taskId: "task-quota-ho",
    agentName: "dc-sub-quota",
    startedAt: Date.now(),
    heartbeatAt: Date.now(),
  };
  fleetState.fleet["ac02"].status = "libre";
  saveFleetState(fleetState, fleetPath);

  const plan = {
    ephemeralId: "qh1234",
    agentName: "dc-sub-quota",
    agentFilePath: path.join(tempDir, "dc-sub-quota.md"),
    leasedAccount: "ac01",
    fullModelRef: "cpam/ac01/gemini-3.8-flash-high",
    effectiveEffort: "high" as const,
    tools: ["read"],
    mode: "background" as const,
  };

  try {
    const outcome = executeTaxiHandover({
      plan,
      sessionId: "sess-quota-ho",
      originalTaskId: "task-quota-ho",
      reason: "quota_exhausted",
      tokens: 45_000,
      fleetPath,
      allowedAccounts: customAccounts,
      quotaGetter: (acc: string) => ({
        gemini5hPct: acc === "ac01" ? 4 : 85,
        resetTimeIso: "2026-10-21T18:00:00Z",
      } as any),
    });

    assert.equal(outcome.success, true);
    assert.equal(outcome.newAccount, "ac02");
    assert.equal(outcome.previousAccount, "ac01");

    const stateAfter = loadFleetState(fleetPath, customAccounts);
    assert.equal(stateAfter.fleet["ac01"].status, "recargando", "ac01 debe enviarse a 'recargando' por cuota agotada (<10%)");
    assert.equal(stateAfter.fleet["ac02"].status, "ocupado");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("MÓDULO C: sweepBackgroundPlansOnce evaluates and executes taxi handover transparently for running tasks", () => {
  const tempDir = createTempDir("sweep-handover");
  const fleetPath = path.join(tempDir, "dc-taxis.json");
  const tasksDir = path.join(tempDir, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });

  const customAccounts = ["ac01", "ac02"];
  const fleetState = createInitialFleetState(customAccounts);

  const testTaskId = `task-sweep-ho-${Date.now()}`;
  fleetState.fleet["ac01"].status = "ocupado";
  fleetState.fleet["ac01"].passenger = {
    type: "ephemeral_subagent",
    sessionId: "sess-sweep-ho",
    pid: process.pid,
    model: "cpam/ac01/gemini-3.8-flash-high",
    agentName: "dc-sub-sweep-ho",
    taskId: testTaskId,
    startedAt: Date.now() - 60_000,
    heartbeatAt: Date.now() - 60_000,
  };
  fleetState.fleet["ac02"].status = "libre";
  saveFleetState(fleetState, fleetPath);

  const agentFilePath = path.join(tempDir, "dc-sub-sweep-ho.md");
  fs.writeFileSync(agentFilePath, [
    "---",
    "name: dc-sub-sweep-ho",
    "model: cpam/ac01/gemini-3.8-flash-high",
    "---",
    "# System Prompt",
    "Tarea continua."
  ].join("\n"));

  // Tarea en gentle-agents/tasks/ con status running y tokens > 120_000
  fs.writeFileSync(path.join(tasksDir, `${testTaskId}.json`), JSON.stringify({
    task: {
      id: testTaskId,
      agent: "dc-sub-sweep-ho",
      status: "running",
      tokens: 124_500,
      result: "Procesados 8 de 10 lotes de datos."
    }
  }));

  const mockPlan = {
    ephemeralId: "swho01",
    agentName: "dc-sub-sweep-ho",
    agentFilePath,
    leasedAccount: "ac01",
    fullModelRef: "cpam/ac01/gemini-3.8-flash-high",
    effectiveEffort: "high" as const,
    tools: ["read"],
    mode: "background" as const,
  };

  activeBackgroundPlans.set(mockPlan.ephemeralId, {
    plan: mockPlan,
    sessionId: "sess-sweep-ho",
    startedAt: Date.now() - 60_000,
    taskId: testTaskId,
  });

  try {
    // Ejecutar un sweep
    sweepBackgroundPlansOnce(tasksDir, fleetPath);

    // Verificar que el handover se ejecutó transparentemente:
    // 1. La tarea sigue en activeBackgroundPlans (no colapsó ni fue descartada)
    const trackedItem = activeBackgroundPlans.get(mockPlan.ephemeralId);
    assert.ok(trackedItem, "La tarea debe seguir activa en background");
    assert.equal(trackedItem.plan.leasedAccount, "ac02", "El arriendo debe haberse transferido a ac02");
    assert.ok(trackedItem.handoverPacket, "El tracking debe contener el HandoverPacket");
    assert.equal(trackedItem.handoverPacket?.previousAccount, "ac01");
    assert.equal(trackedItem.handoverPacket?.newAccount, "ac02");

    // 2. Estado de la flota: ac01 libre, ac02 ocupado con el nuevo pasajero
    const stateAfter = loadFleetState(fleetPath, customAccounts);
    assert.equal(stateAfter.fleet["ac02"].status, "ocupado");
    assert.equal(stateAfter.fleet["ac01"].status, "libre");

    // 3. Log TAXI_HANDOVER_EXECUTED registrado
    const logs = readRecentTaxiLogs(15);
    assert.ok(logs.some((l) => l.includes("TAXI_HANDOVER_EXECUTED") && l.includes("ac02")));
  } finally {
    activeBackgroundPlans.delete(mockPlan.ephemeralId);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("MÓDULO D: sanitizeWorkshopReason resume errores a máximo 3 palabras y evita falso taller por timeout", async () => {
  // 1. Validar que timeouts transitorios NO son clasificados como error de auth
  assert.equal(isProviderAuthError("Request timed out after 400ms"), false);
  assert.equal(isProviderAuthError("connect ECONNREFUSED 127.0.0.1:8325"), false);
  assert.equal(isProviderAuthError("connect ETIMEDOUT"), false);
  assert.equal(isProviderAuthError("Operation timed out after 30000ms"), false);

  // 2. Errores fatales de autenticación SI deben ser detectados
  assert.equal(isProviderAuthError(undefined, 401), true);
  assert.equal(isProviderAuthError(undefined, 403), true);
  assert.equal(isProviderAuthError("invalid_grant: token has expired or been revoked"), true);
  assert.equal(isProviderAuthError("account disabled by administrator"), true);
  assert.equal(isProviderAuthError("token revoked"), true);
  assert.equal(isProviderAuthError("permission_denied: 403 Forbidden"), true);

  // 3. auditAccountForWorkshop no debe enviar taxi a taller ante timeout
  const tempDir = createTempDir("timeout-audit");
  const fleetPath = path.join(tempDir, "dc-taxis.json");
  try {
    const customAccounts = ["ac01"];
    saveFleetState(createInitialFleetState(customAccounts), fleetPath);

    const timeoutFetcher = async () => {
      throw new Error("Request timed out after 400ms");
    };

    const sent = await auditAccountForWorkshop("ac01", fleetPath, timeoutFetcher);
    assert.equal(sent, false, "Timeout de 400ms NO debe mandar la unidad a taller");
    const st = loadFleetState(fleetPath, customAccounts);
    assert.equal(st.fleet["ac01"].status, "libre", "La unidad debe permanecer en estado libre");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  // 4. sanitizeWorkshopReason debe devolver frases de máximo 3 palabras
  const samples = [
    { input: "Google Auth Error: token revoked or unauthorized (HTTP 401)", expected: "Google Auth Error" },
    { input: "Account disabled by platform administrator (Google Cloud IAM)", expected: "Cuenta Deshabilitada" },
    { input: "Token revoked by user session manager", expected: "Token Revocado" },
    { input: "Permission denied for this resource (HTTP 403 Forbidden)", expected: "Permiso Denegado" },
    { input: "invalid_grant: Bad credentials or secret mismatch", expected: "Credencial Invalida" },
    { input: "Some extremely long unclassified unexpected failure inside downstream proxy network layer", maxWords: 3 },
  ];

  for (const s of samples) {
    const res = sanitizeWorkshopReason(s.input);
    const wordCount = res.trim().split(/\s+/).length;
    assert.ok(wordCount <= 3, `"${res}" debe tener máximo 3 palabras (tiene ${wordCount})`);
    if (s.expected) {
      assert.equal(res, s.expected);
    }
  }
});

test("MÓDULO D: updateTaxiPassengerUsage actualiza tokens y costo atómicamente", () => {
  const tempDir = createTempDir("passenger-usage");
  const fleetPath = path.join(tempDir, "dc-taxis.json");

  try {
    const customAccounts = ["ac01", "ac02"];
    const state = createInitialFleetState(customAccounts);
    state.fleet["ac01"].status = "ocupado";
    state.fleet["ac01"].passenger = {
      type: "orchestrator",
      sessionId: "orch-usage-sess",
      pid: process.pid,
      model: "cpam/ac01/gemini-3.8-flash-high",
      taskLabel: "Sesión Principal",
      plate: "DC-USAGE-01",
      startedAt: Date.now() - 10_000,
      heartbeatAt: Date.now(),
    };
    saveFleetState(state, fleetPath);

    // 1. Actualizar cuenta no ocupada -> retorna false
    const okFree = updateTaxiPassengerUsage("ac02", 5000, 0.05, fleetPath);
    assert.equal(okFree, false, "No debe actualizar taxi libre sin pasajero");

    // 2. Actualizar taxi ocupado con tokens y costo
    const okOccupied = updateTaxiPassengerUsage("ac01", 147_000, 1.25, fleetPath);
    assert.equal(okOccupied, true, "Debe retornar true al actualizar taxi ocupado");

    const st1 = loadFleetState(fleetPath, customAccounts);
    assert.equal(st1.fleet["ac01"].passenger?.tokens, 147_000);
    assert.equal(st1.fleet["ac01"].passenger?.cost, 1.25);
    assert.equal(st1.fleet["ac01"].passenger?.plate, "DC-USAGE-01"); // campos previos preservados

    // 3. Actualizar solo tokens omitiendo costo
    const okTokensOnly = updateTaxiPassengerUsage("ac01", 150_000, undefined, fleetPath);
    assert.equal(okTokensOnly, true);
    const st2 = loadFleetState(fleetPath, customAccounts);
    assert.equal(st2.fleet["ac01"].passenger?.tokens, 150_000);
    assert.equal(st2.fleet["ac01"].passenger?.cost, 1.25, "Costo previo debe preservarse si es undefined");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("MÓDULO D: Formato vehicular enriquecido del Taxímetro en Sidebar y Panel TUI", () => {
  // 1. Sidebar status card createTaxiUnitRows: [<duración> - <tokens>tk - $<costo>]
  const unitWithMetrics = {
    account: "ac01",
    status: "ocupado" as const,
    passenger: {
      type: "orchestrator" as const,
      sessionId: "sess-taximeter-1",
      pid: 1234,
      model: "cpam/ac01/gemini-3.8-flash-high",
      taskLabel: "Orquestación",
      plate: "DC-HOST-1234",
      tokens: 147_000,
      cost: 1.25,
      startedAt: Date.now() - 255_000, // ~4m 15s
      heartbeatAt: Date.now(),
    },
  };

  const rows = createTaxiUnitRows(unitWithMetrics);
  const rendered = rows.map((r: any) => r.render(90).join(" "));
  const taximeterRow = rendered.find((l: string) => l.includes("Taxímetro:"));
  assert.ok(taximeterRow, "Debe existir fila Taxímetro:");
  assert.ok(taximeterRow.includes("147k tk - $1.25"), `Taxímetro con tokens y costo debe contener "147k tk - $1.25", obtenido: "${taximeterRow}"`);

  // Tokens sin costo
  const unitTokensOnly = {
    account: "ac02",
    status: "ocupado" as const,
    passenger: {
      type: "orchestrator" as const,
      sessionId: "sess-taximeter-2",
      pid: 5678,
      model: "cpam/ac02/gemini-3.8-flash-high",
      tokens: 45_000,
      startedAt: Date.now() - 30_000,
      heartbeatAt: Date.now(),
    },
  };
  const rowsTok = createTaxiUnitRows(unitTokensOnly);
  const renderedTok = rowsTok.map((r: any) => r.render(90).join(" "));
  const taximeterTok = renderedTok.find((l: string) => l.includes("Taxímetro:"));
  assert.ok(taximeterTok?.includes("45k tk"), `Debe contener "45k tk", obtenido: "${taximeterTok}"`);
  assert.ok(!taximeterTok?.includes("-$"), `No debe contener costo si no fue provisto`);

  // Sin métricas (solo duración)
  const unitNoMetrics = {
    account: "ac03",
    status: "ocupado" as const,
    passenger: {
      type: "orchestrator" as const,
      sessionId: "sess-taximeter-3",
      pid: 9999,
      startedAt: Date.now() - 10_000,
      heartbeatAt: Date.now(),
    },
  };
  const rowsNone = createTaxiUnitRows(unitNoMetrics);
  const renderedNone = rowsNone.map((r: any) => r.render(90).join(" "));
  const taximeterNone = renderedNone.find((l: string) => l.includes("Taxímetro:"));
  assert.ok(taximeterNone?.includes("10s"), "Debe mostrar duración sin tk ni $");
  assert.ok(!taximeterNone?.includes("tk"), "No debe mostrar tk");

  // 2. DcTaxisPanel renderUnitDetail: ${elapsedSec}s (~${elapsedMin}m) - ${tokensStr} tk - $${costStr}
  const theme = {
    fg: (_r: string, t: string) => t,
    bg: (_r: string, t: string) => t,
    bold: (t: string) => t,
  } as any;
  const panel = new DcTaxisPanel({ theme, onDone: () => {}, requestRender: () => {} });
  (panel as any).selectedDetailUnit = unitWithMetrics;
  const panelLines = panel.render(100);
  const panelTaximeter = panelLines.find((l: string) => l.includes("Taxímetro:"));
  assert.ok(panelTaximeter, "Panel de taxis debe contener Taxímetro:");
  assert.ok(panelTaximeter.includes("tk - $"), `Panel debe usar sintaxis concisa "tk - $", obtenido: "${panelTaximeter}"`);
});

test("MÓDULO D: Relevo automático del orquestador ante cuota < 10%", async () => {
  const tempDir = createTempDir("orch-handover");
  const fleetPath = path.join(tempDir, "dc-taxis.json");

  try {
    const customAccounts = ["ac01", "ac02"];
    const state = createInitialFleetState(customAccounts);
    state.fleet["ac01"].status = "ocupado";
    state.fleet["ac01"].passenger = {
      type: "orchestrator",
      sessionId: "orch-ho-sess",
      pid: process.pid,
      model: "cpam/ac01/gemini-3.8-flash-high",
      taskLabel: "Sesión Principal",
      plate: `DC-HOST-${process.pid}`,
      startedAt: Date.now() - 30_000,
      heartbeatAt: Date.now(),
    };
    saveFleetState(state, fleetPath);

    const mockCtx = {
      hasUI: true,
      model: { provider: "cpam", id: "ac01/gemini-3.8-flash-high" },
      sessionManager: { getSessionId: () => "orch-ho-sess" },
    } as any;

    // Caso 1: Cuota >= 10% (ej: 45%) -> no debe relevar
    const mockQuotaGood = (ac: string) => ({
      account: ac,
      gemini5hPct: 45,
      geminiWeeklyPct: 80,
      lastChecked: Date.now(),
    });

    const resGood = await handleOrchestratorQuotaHandover(mockCtx, undefined, fleetPath, mockQuotaGood);
    assert.equal(resGood.performed, false, "No debe relevar si cuota >= 10%");
    const stGood = loadFleetState(fleetPath, customAccounts);
    assert.equal(stGood.fleet["ac01"].status, "ocupado");

    // Caso 2: Cuota cae < 10% (ej: 4%) -> debe relevar a ac02 y enviar ac01 a recargando
    const mockQuotaCritical = (ac: string) => ({
      account: ac,
      gemini5hPct: ac === "ac01" ? 4 : 95,
      geminiWeeklyPct: 80,
      lastChecked: Date.now(),
    });

    const resCritical = await handleOrchestratorQuotaHandover(mockCtx, undefined, fleetPath, mockQuotaCritical);
    assert.equal(resCritical.performed, true, "Debe realizar relevo automático");
    assert.equal(resCritical.previousAccount, "ac01");
    assert.equal(resCritical.newAccount, "ac02");

    // Verificar estado de la flota
    const stHandover = loadFleetState(fleetPath, customAccounts);
    assert.equal(stHandover.fleet["ac01"].status, "recargando", "Taxi anterior debe ir a 'recargando'");
    assert.equal(stHandover.fleet["ac01"].passenger, null, "Pasajero anterior debe liberarse");
    assert.equal(stHandover.fleet["ac02"].status, "ocupado", "Nuevo taxi debe quedar 'ocupado'");
    assert.equal(stHandover.fleet["ac02"].passenger?.type, "orchestrator", "Nuevo taxi debe tener al orquestador");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});





