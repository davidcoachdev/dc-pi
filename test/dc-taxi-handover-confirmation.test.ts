import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// 1. HOME isolation BEFORE any dc-agents / dispatcher imports
const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), "dc-handover-home-"));
process.env.HOME = isolatedHome;

import {
  handleOrchestratorQuotaHandover,
} from "../src/features/dc-agents/dc-agents.ts";
import dcAgentsExtension from "../src/features/dc-agents/dc-agents.ts";

import {
  executeTaxiHandover,
} from "../src/features/dc-agents/core/dc-taxi-supervisor.ts";

import {
  activeBackgroundPlans,
  sweepBackgroundPlansOnce,
} from "../src/features/dc-agents/tools/dc-ephemeral-tools.ts";

import {
  createInitialFleetState,
  loadFleetState,
  saveFleetState,
  withFleetLock,
  acquireOrchestratorTaxi,
  releaseOrchestratorTaxi,
} from "../src/features/dc-agents/core/dc-taxi-dispatcher.ts";

import {
  readRecentTaxiLogs,
} from "../src/features/dc-agents/core/dc-taxi-logger.ts";

function createScratchDir(name: string): string {
  const dir = path.join(isolatedHome, `scratch-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupScratchDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* defensive */
  }
}

test("RULE 1: Orchestrator handover - setModel rejects -> rolls back candidate, preserves old lease, returns performed false", async () => {
  const scratchDir = createScratchDir("orch-rej");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");
  const customAccounts = ["ac01", "ac02"];

  try {
    const state = createInitialFleetState(customAccounts);
    state.fleet["ac01"].status = "ocupado";
    state.fleet["ac01"].passenger = {
      type: "orchestrator",
      sessionId: "orch-sess-rej",
      pid: process.pid,
      model: "cpam/ac01/gemini-3.8-flash-high",
      taskLabel: "Sesión Principal",
      plate: `DC-HOST-${process.pid}`,
      startedAt: Date.now() - 10_000,
      heartbeatAt: Date.now(),
    };
    state.fleet["ac02"].status = "libre";
    saveFleetState(state, fleetPath);

    const mockPi: any = {
      setModel: async () => {
        throw new Error("Provider connection refused on hot model switch");
      },
    };

    const mockCtx = {
      hasUI: false,
      mode: "tui",
      model: { provider: "cpam", id: "ac01/gemini-3.8-flash-high" },
      sessionManager: { getSessionId: () => "orch-sess-rej" },
      modelRegistry: {
        getAvailable: async () => [{ provider: "cpam", id: "ac02/gemini-3.8-flash-high" }],
        find: (_p: string, id: string) => ({ provider: "cpam", id }),
      },
    } as any;

    const mockQuotaCritical = (ac: string) => ({
      account: ac,
      gemini5hPct: ac === "ac01" ? 3 : 95,
      geminiWeeklyPct: 80,
      lastChecked: Date.now(),
    });

    const res = await handleOrchestratorQuotaHandover(mockCtx, mockPi, fleetPath, mockQuotaCritical);

    // Verificaciones obligatorias
    assert.equal(res.performed, false, "performed MUST be false when setModel rejects");

    const stateAfter = loadFleetState(fleetPath, customAccounts);
    // 1. Vieja unidad intacta
    assert.equal(stateAfter.fleet["ac01"].status, "ocupado", "Old lease must remain ocupado");
    assert.equal(stateAfter.fleet["ac01"].passenger?.sessionId, "orch-sess-rej");
    assert.equal(stateAfter.fleet["ac01"].passenger?.plate, `DC-HOST-${process.pid}`);

    // 2. Candidato revertido a libre
    assert.equal(stateAfter.fleet["ac02"].status, "libre", "Candidate lease ac02 must be rolled back to libre");
    assert.equal(stateAfter.fleet["ac02"].passenger, null, "Candidate passenger must be cleared");
  } finally {
    cleanupScratchDir(scratchDir);
  }
});

test("RULE 2: Orchestrator handover - setModel returns false -> rolls back candidate, preserves old lease, returns performed false", async () => {
  const scratchDir = createScratchDir("orch-false");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");
  const customAccounts = ["ac01", "ac02"];

  try {
    const state = createInitialFleetState(customAccounts);
    state.fleet["ac01"].status = "ocupado";
    state.fleet["ac01"].passenger = {
      type: "orchestrator",
      sessionId: "orch-sess-false",
      pid: process.pid,
      model: "cpam/ac01/gemini-3.8-flash-high",
      taskLabel: "Sesión Principal",
      plate: `DC-HOST-${process.pid}`,
      startedAt: Date.now() - 10_000,
      heartbeatAt: Date.now(),
    };
    state.fleet["ac02"].status = "libre";
    saveFleetState(state, fleetPath);

    const mockPi: any = {
      setModel: async () => false,
    };

    const mockCtx = {
      hasUI: false,
      mode: "tui",
      model: { provider: "cpam", id: "ac01/gemini-3.8-flash-high" },
      sessionManager: { getSessionId: () => "orch-sess-false" },
      modelRegistry: {
        getAvailable: async () => [{ provider: "cpam", id: "ac02/gemini-3.8-flash-high" }],
        find: (_p: string, id: string) => ({ provider: "cpam", id }),
      },
    } as any;

    const mockQuotaCritical = (ac: string) => ({
      account: ac,
      gemini5hPct: ac === "ac01" ? 3 : 95,
      geminiWeeklyPct: 80,
      lastChecked: Date.now(),
    });

    const res = await handleOrchestratorQuotaHandover(mockCtx, mockPi, fleetPath, mockQuotaCritical);

    assert.equal(res.performed, false, "performed MUST be false when setModel returns false");

    const stateAfter = loadFleetState(fleetPath, customAccounts);
    assert.equal(stateAfter.fleet["ac01"].status, "ocupado");
    assert.equal(stateAfter.fleet["ac01"].passenger?.sessionId, "orch-sess-false");
    assert.equal(stateAfter.fleet["ac02"].status, "libre");
    assert.equal(stateAfter.fleet["ac02"].passenger, null);
  } finally {
    cleanupScratchDir(scratchDir);
  }
});

test("RULE 3: Orchestrator handover - target model missing in registry -> candidate rolled back, performed false", async () => {
  const scratchDir = createScratchDir("orch-missing");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");
  const customAccounts = ["ac01", "ac02"];

  try {
    const state = createInitialFleetState(customAccounts);
    state.fleet["ac01"].status = "ocupado";
    state.fleet["ac01"].passenger = {
      type: "orchestrator",
      sessionId: "orch-sess-missing",
      pid: process.pid,
      model: "cpam/ac01/gemini-3.8-flash-high",
      taskLabel: "Sesión Principal",
      plate: `DC-HOST-${process.pid}`,
      startedAt: Date.now() - 10_000,
      heartbeatAt: Date.now(),
    };
    state.fleet["ac02"].status = "libre";
    saveFleetState(state, fleetPath);

    let setModelCalled = false;
    const mockPi: any = {
      setModel: async () => {
        setModelCalled = true;
      },
    };

    const mockCtx = {
      hasUI: false,
      mode: "tui",
      model: { provider: "cpam", id: "ac01/gemini-3.8-flash-high" },
      sessionManager: { getSessionId: () => "orch-sess-missing" },
      modelRegistry: {
        getAvailable: async () => [],
        find: () => undefined,
      },
    } as any;

    const mockQuotaCritical = (ac: string) => ({
      account: ac,
      gemini5hPct: ac === "ac01" ? 3 : 95,
      geminiWeeklyPct: 80,
      lastChecked: Date.now(),
    });

    const res = await handleOrchestratorQuotaHandover(mockCtx, mockPi, fleetPath, mockQuotaCritical);

    assert.equal(res.performed, false);
    assert.equal(setModelCalled, false, "setModel must NOT be called when target model is not found");

    const stateAfter = loadFleetState(fleetPath, customAccounts);
    assert.equal(stateAfter.fleet["ac01"].status, "ocupado");
    assert.equal(stateAfter.fleet["ac02"].status, "libre");
  } finally {
    cleanupScratchDir(scratchDir);
  }
});

test("RULE 4: Orchestrator handover - no pi/runtime API -> candidate rolled back, performed false, original intact", async () => {
  const scratchDir = createScratchDir("orch-no-pi");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");
  const customAccounts = ["ac01", "ac02"];

  try {
    const state = createInitialFleetState(customAccounts);
    state.fleet["ac01"].status = "ocupado";
    state.fleet["ac01"].passenger = {
      type: "orchestrator",
      sessionId: "orch-sess-no-pi",
      pid: process.pid,
      model: "cpam/ac01/gemini-3.8-flash-high",
      taskLabel: "Sesión Principal",
      plate: `DC-HOST-${process.pid}`,
      startedAt: Date.now() - 10_000,
      heartbeatAt: Date.now(),
    };
    state.fleet["ac02"].status = "libre";
    saveFleetState(state, fleetPath);

    const mockCtx = {
      hasUI: false,
      mode: "tui",
      model: { provider: "cpam", id: "ac01/gemini-3.8-flash-high" },
      sessionManager: { getSessionId: () => "orch-sess-no-pi" },
    } as any;

    const mockQuotaCritical = (ac: string) => ({
      account: ac,
      gemini5hPct: ac === "ac01" ? 3 : 95,
      geminiWeeklyPct: 80,
      lastChecked: Date.now(),
    });

    // Sin pi ExtensionAPI
    const res = await handleOrchestratorQuotaHandover(mockCtx, undefined, fleetPath, mockQuotaCritical);

    assert.equal(res.performed, false, "handover without runtime model switch capability must report performed: false");

    const stateAfter = loadFleetState(fleetPath, customAccounts);
    assert.equal(stateAfter.fleet["ac01"].status, "ocupado", "Original unit must be preserved");
    assert.equal(stateAfter.fleet["ac02"].status, "libre", "Candidate lease must be rolled back");
  } finally {
    cleanupScratchDir(scratchDir);
  }
});

test("RULE 5: Orchestrator handover - success path confirms setModel and finalizes old lease to recargando", async () => {
  const scratchDir = createScratchDir("orch-success");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");
  const customAccounts = ["ac01", "ac02"];

  try {
    const state = createInitialFleetState(customAccounts);
    state.fleet["ac01"].status = "ocupado";
    state.fleet["ac01"].passenger = {
      type: "orchestrator",
      sessionId: "orch-sess-ok",
      pid: process.pid,
      model: "cpam/ac01/gemini-3.8-flash-high",
      taskLabel: "Sesión Principal",
      plate: `DC-HOST-${process.pid}`,
      startedAt: Date.now() - 10_000,
      heartbeatAt: Date.now(),
    };
    state.fleet["ac02"].status = "libre";
    saveFleetState(state, fleetPath);

    let switchedModel: any = undefined;
    const mockPi: any = {
      setModel: async (m: any) => {
        switchedModel = m;
        return true;
      },
    };

    const mockCtx = {
      hasUI: false,
      mode: "tui",
      model: { provider: "cpam", id: "ac01/gemini-3.8-flash-high" },
      sessionManager: { getSessionId: () => "orch-sess-ok" },
      modelRegistry: {
        getAvailable: async () => [{ provider: "cpam", id: "ac02/gemini-3.8-flash-high" }],
        find: (_p: string, id: string) => ({ provider: "cpam", id }),
      },
    } as any;

    const mockQuotaCritical = (ac: string) => ({
      account: ac,
      gemini5hPct: ac === "ac01" ? 3 : 95,
      geminiWeeklyPct: 80,
      lastChecked: Date.now(),
    });

    const res = await handleOrchestratorQuotaHandover(mockCtx, mockPi, fleetPath, mockQuotaCritical);

    assert.equal(res.performed, true);
    assert.equal(res.previousAccount, "ac01");
    assert.equal(res.newAccount, "ac02");
    assert.equal(switchedModel?.id, "ac02/gemini-3.8-flash-high");

    const stateAfter = loadFleetState(fleetPath, customAccounts);
    assert.equal(stateAfter.fleet["ac01"].status, "recargando", "Old lease finalized to recargando");
    assert.equal(stateAfter.fleet["ac01"].passenger, null);
    assert.equal(stateAfter.fleet["ac02"].status, "ocupado", "New lease occupied by orchestrator");
    assert.equal(stateAfter.fleet["ac02"].passenger?.type, "orchestrator");
    assert.equal(stateAfter.fleet["ac02"].passenger?.sessionId, "orch-sess-ok");
  } finally {
    cleanupScratchDir(scratchDir);
  }
});

test("RULE 6: Orchestrator handover - old lease ownership changed during await setModel -> does NOT overwrite successor", async () => {
  const scratchDir = createScratchDir("orch-stale-finalize");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");
  const customAccounts = ["ac01", "ac02"];

  try {
    const state = createInitialFleetState(customAccounts);
    state.fleet["ac01"].status = "ocupado";
    state.fleet["ac01"].passenger = {
      type: "orchestrator",
      sessionId: "orch-sess-orig",
      pid: process.pid,
      model: "cpam/ac01/gemini-3.8-flash-high",
      taskLabel: "Sesión Principal",
      plate: `DC-HOST-${process.pid}`,
      startedAt: Date.now() - 10_000,
      heartbeatAt: Date.now(),
    };
    state.fleet["ac02"].status = "libre";
    saveFleetState(state, fleetPath);

    // Durante el await de setModel, otro proceso o sesión se apropia de ac01
    const mockPi: any = {
      setModel: async () => {
        withFleetLock(fleetPath, () => {
          const s = loadFleetState(fleetPath, customAccounts);
          s.fleet["ac01"].passenger = {
            type: "orchestrator",
            sessionId: "orch-sess-DIFFERENT",
            pid: 9999999,
            plate: "DC-DIFFERENT-PLATE",
            startedAt: Date.now(),
            heartbeatAt: Date.now(),
          };
          saveFleetState(s, fleetPath);
        });
        return true;
      },
    };

    const mockCtx = {
      hasUI: false,
      mode: "tui",
      model: { provider: "cpam", id: "ac01/gemini-3.8-flash-high" },
      sessionManager: { getSessionId: () => "orch-sess-orig" },
      modelRegistry: {
        getAvailable: async () => [{ provider: "cpam", id: "ac02/gemini-3.8-flash-high" }],
        find: (_p: string, id: string) => ({ provider: "cpam", id }),
      },
    } as any;

    const mockQuotaCritical = (ac: string) => ({
      account: ac,
      gemini5hPct: ac === "ac01" ? 3 : 95,
      geminiWeeklyPct: 80,
      lastChecked: Date.now(),
    });

    const res = await handleOrchestratorQuotaHandover(mockCtx, mockPi, fleetPath, mockQuotaCritical);

    assert.equal(res.performed, true);

    const stateAfter = loadFleetState(fleetPath, customAccounts);
    // ac01 NO debe ser destruido a recargando con passenger null porque ya no nos pertenecía
    assert.equal(stateAfter.fleet["ac01"].passenger?.sessionId, "orch-sess-DIFFERENT", "Must NOT mutate successor's lease");
    assert.equal(stateAfter.fleet["ac01"].passenger?.plate, "DC-DIFFERENT-PLATE");

    // ac02 sí queda arrendado por nosotros
    assert.equal(stateAfter.fleet["ac02"].status, "ocupado");
    assert.equal(stateAfter.fleet["ac02"].passenger?.sessionId, "orch-sess-orig");
  } finally {
    cleanupScratchDir(scratchDir);
  }
});

test("RULE 7: Orchestrator handover - does NOT hold fleet lock across await setModel", async () => {
  const scratchDir = createScratchDir("orch-no-lock-await");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");
  const customAccounts = ["ac01", "ac02"];

  try {
    const state = createInitialFleetState(customAccounts);
    state.fleet["ac01"].status = "ocupado";
    state.fleet["ac01"].passenger = {
      type: "orchestrator",
      sessionId: "orch-sess-lock-test",
      pid: process.pid,
      model: "cpam/ac01/gemini-3.8-flash-high",
      taskLabel: "Sesión Principal",
      plate: `DC-HOST-${process.pid}`,
      startedAt: Date.now() - 10_000,
      heartbeatAt: Date.now(),
    };
    state.fleet["ac02"].status = "libre";
    saveFleetState(state, fleetPath);

    let concurrentLockAcquired = false;
    const mockPi: any = {
      setModel: async () => {
        // Mientras setModel está en curso (await), intentamos adquirir el lock desde otra operación
        concurrentLockAcquired = withFleetLock(fleetPath, () => {
          return true;
        });
        return true;
      },
    };

    const mockCtx = {
      hasUI: false,
      mode: "tui",
      model: { provider: "cpam", id: "ac01/gemini-3.8-flash-high" },
      sessionManager: { getSessionId: () => "orch-sess-lock-test" },
      modelRegistry: {
        getAvailable: async () => [{ provider: "cpam", id: "ac02/gemini-3.8-flash-high" }],
        find: (_p: string, id: string) => ({ provider: "cpam", id }),
      },
    } as any;

    const mockQuotaCritical = (ac: string) => ({
      account: ac,
      gemini5hPct: ac === "ac01" ? 3 : 95,
      geminiWeeklyPct: 80,
      lastChecked: Date.now(),
    });

    await handleOrchestratorQuotaHandover(mockCtx, mockPi, fleetPath, mockQuotaCritical);

    assert.equal(concurrentLockAcquired, true, "Fleet lock must be released during await setModel to prevent holding lock across await");
  } finally {
    cleanupScratchDir(scratchDir);
  }
});

test("RULE 8: Background handover - executeTaxiHandover preserves reservation when mode is background (no runtime switch API)", () => {
  const scratchDir = createScratchDir("bg-unsupported-exec");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");
  const tasksDir = path.join(scratchDir, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });

  const customAccounts = ["ac01", "ac02"];
  const state = createInitialFleetState(customAccounts);
  state.fleet["ac01"].status = "ocupado";
  state.fleet["ac01"].passenger = {
    type: "ephemeral_subagent",
    sessionId: "sess-bg-ho",
    pid: process.pid,
    model: "cpam/ac01/gemini-3.8-flash-high",
    taskId: "task-bg-ho",
    agentName: "dc-worker-bg",
    plate: "DC-BG-PLATE-01",
    startedAt: Date.now() - 30_000,
    heartbeatAt: Date.now(),
  };
  state.fleet["ac02"].status = "libre";
  saveFleetState(state, fleetPath);

  const agentFilePath = path.join(scratchDir, "dc-worker-bg.md");
  const originalAgentContent = [
    "---",
    "name: dc-worker-bg",
    "model: cpam/ac01/gemini-3.8-flash-high",
    "mode: background",
    "---",
    "# System Prompt",
    "Contenido original.",
  ].join("\n");
  fs.writeFileSync(agentFilePath, originalAgentContent);

  const plan = {
    ephemeralId: "eph-bg-01",
    agentName: "dc-worker-bg",
    agentFilePath,
    leasedAccount: "ac01",
    fullModelRef: "cpam/ac01/gemini-3.8-flash-high",
    effectiveEffort: "high" as const,
    tools: ["read"],
    mode: "background" as const,
    plate: "DC-BG-PLATE-01",
  };

  const outcome = executeTaxiHandover({
    plan,
    sessionId: "sess-bg-ho",
    originalTaskId: "task-bg-ho",
    reason: "token_limit_90",
    tokens: 130_000,
    tasksDir,
    fleetPath,
    allowedAccounts: customAccounts,
    quotaGetter: () => ({ gemini5hPct: 90 } as any),
  });

  // Relevo debe ser explícitamente no realizado / unsupported
  assert.equal(outcome.success, false, "executeTaxiHandover must not succeed for background worker");
  assert.equal(outcome.unsupported, true, "outcome must indicate unsupported");
  assert.ok(outcome.error?.includes("background"), "outcome error must truthfully explain background runtime limitation");

  // Estado de la flota: reserva original PRESERVADA
  const stateAfter = loadFleetState(fleetPath, customAccounts);
  assert.equal(stateAfter.fleet["ac01"].status, "ocupado", "ac01 must remain ocupado by original background worker");
  assert.equal(stateAfter.fleet["ac01"].passenger?.plate, "DC-BG-PLATE-01");
  assert.equal(stateAfter.fleet["ac02"].status, "libre", "ac02 must remain libre");

  // Archivo de definición en disco NO debe haber cambiado
  const contentAfter = fs.readFileSync(agentFilePath, "utf8");
  assert.equal(contentAfter, originalAgentContent, "Agent markdown file must NOT be mutated for background worker");

  // Bitácora registra mensaje veraz
  const logs = readRecentTaxiLogs(15);
  assert.ok(logs.some((l) => l.includes("TAXI_HANDOVER_BACKGROUND_UNSUPPORTED")), "Must log truthful TAXI_HANDOVER_BACKGROUND_UNSUPPORTED");

  cleanupScratchDir(scratchDir);
});

test("RULE 9: Background handover - sweepBackgroundPlansOnce preserves running background worker without fake handover", () => {
  const scratchDir = createScratchDir("bg-sweep-preserved");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");
  const tasksDir = path.join(scratchDir, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });

  const customAccounts = ["ac01", "ac02"];
  const state = createInitialFleetState(customAccounts);
  const testTaskId = `task-bg-sweep-${Date.now()}`;

  state.fleet["ac01"].status = "ocupado";
  state.fleet["ac01"].passenger = {
    type: "ephemeral_subagent",
    sessionId: "sess-sweep-bg",
    pid: process.pid,
    model: "cpam/ac01/gemini-3.8-flash-high",
    agentName: "dc-worker-sweep",
    taskId: testTaskId,
    plate: "DC-SWEEP-01",
    startedAt: Date.now() - 60_000,
    heartbeatAt: Date.now() - 60_000,
  };
  state.fleet["ac02"].status = "libre";
  saveFleetState(state, fleetPath);

  const agentFilePath = path.join(scratchDir, "dc-worker-sweep.md");
  const originalAgentContent = [
    "---",
    "name: dc-worker-sweep",
    "model: cpam/ac01/gemini-3.8-flash-high",
    "---",
    "# System Prompt",
    "Tarea continua.",
  ].join("\n");
  fs.writeFileSync(agentFilePath, originalAgentContent);

  fs.writeFileSync(path.join(tasksDir, `${testTaskId}.json`), JSON.stringify({
    task: {
      id: testTaskId,
      agent: "dc-worker-sweep",
      status: "running",
      tokens: 125_000, // Supera umbral de 120k
      result: "Procesando lote...",
    },
  }));

  const mockPlan = {
    ephemeralId: "eph-sweep-01",
    agentName: "dc-worker-sweep",
    agentFilePath,
    leasedAccount: "ac01",
    fullModelRef: "cpam/ac01/gemini-3.8-flash-high",
    effectiveEffort: "high" as const,
    tools: ["read"],
    mode: "background" as const,
    plate: "DC-SWEEP-01",
  };

  activeBackgroundPlans.set(mockPlan.ephemeralId, {
    plan: mockPlan,
    sessionId: "sess-sweep-bg",
    startedAt: Date.now() - 60_000,
    taskId: testTaskId,
  });

  try {
    sweepBackgroundPlansOnce(tasksDir, fleetPath);

    // Tarea sigue activa en activeBackgroundPlans con su reserva intacta en ac01
    const trackedItem = activeBackgroundPlans.get(mockPlan.ephemeralId);
    assert.ok(trackedItem, "Task must remain tracked");
    assert.equal(trackedItem.plan.leasedAccount, "ac01", "leasedAccount must NOT fake switch to ac02");

    // Flota: ac01 ocupada, ac02 libre
    const stateAfter = loadFleetState(fleetPath, customAccounts);
    assert.equal(stateAfter.fleet["ac01"].status, "ocupado", "ac01 must remain ocupado");
    assert.equal(stateAfter.fleet["ac01"].passenger?.plate, "DC-SWEEP-01");
    assert.equal(stateAfter.fleet["ac02"].status, "libre", "ac02 must remain libre");

    // Archivo intacto
    const contentAfter = fs.readFileSync(agentFilePath, "utf8");
    assert.equal(contentAfter, originalAgentContent, "Agent markdown must NOT be modified");
  } finally {
    activeBackgroundPlans.delete(mockPlan.ephemeralId);
    cleanupScratchDir(scratchDir);
  }
});

test("RULE 10: Pending setModel + candidate reassigned -> aborts finalization, preserves old unit, does not mutate successor", async () => {
  const scratchDir = createScratchDir("orch-candidate-lost");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");
  const customAccounts = ["ac01", "ac02"];

  try {
    const state = createInitialFleetState(customAccounts);
    state.fleet["ac01"].status = "ocupado";
    state.fleet["ac01"].passenger = {
      type: "orchestrator",
      sessionId: "orch-sess-clost",
      pid: process.pid,
      model: "cpam/ac01/gemini-3.8-flash-high",
      taskLabel: "Sesión Principal",
      plate: `DC-HOST-${process.pid}`,
      startedAt: Date.now() - 10_000,
      heartbeatAt: Date.now(),
    };
    state.fleet["ac02"].status = "libre";
    saveFleetState(state, fleetPath);

    const mockPi: any = {
      setModel: async () => {
        // Durante await setModel, ac02 es reasignado a un sucesor (cambia startedAt y sesión)
        withFleetLock(fleetPath, () => {
          const s = loadFleetState(fleetPath, customAccounts);
          s.fleet["ac02"].passenger = {
            type: "orchestrator",
            sessionId: "orch-successor-sess",
            pid: process.pid,
            plate: `DC-HOST-${process.pid}`,
            startedAt: Date.now() + 5_000, // Generación distinta
            heartbeatAt: Date.now() + 5_000,
          };
          saveFleetState(s, fleetPath);
        });
        return true;
      },
    };

    const mockCtx = {
      hasUI: false,
      mode: "tui",
      model: { provider: "cpam", id: "ac01/gemini-3.8-flash-high" },
      sessionManager: { getSessionId: () => "orch-sess-clost" },
      modelRegistry: {
        getAvailable: async () => [{ provider: "cpam", id: "ac02/gemini-3.8-flash-high" }],
        find: (_p: string, id: string) => ({ provider: "cpam", id }),
      },
    } as any;

    const mockQuotaCritical = (ac: string) => ({
      account: ac,
      gemini5hPct: ac === "ac01" ? 3 : 95,
      geminiWeeklyPct: 80,
      lastChecked: Date.now(),
    });

    const res = await handleOrchestratorQuotaHandover(mockCtx, mockPi, fleetPath, mockQuotaCritical);

    // Al haber perdido el candidato, no se puede garantizar alineación
    assert.equal(res.performed, false, "Must return performed: false when candidate generation is lost");

    const stateAfter = loadFleetState(fleetPath, customAccounts);
    // ac01 NO debe ser enviado a recargando
    assert.equal(stateAfter.fleet["ac01"].status, "ocupado", "Old unit ac01 must remain ocupado");
    assert.equal(stateAfter.fleet["ac01"].passenger?.sessionId, "orch-sess-clost");

    // ac02 NO debe ser liberado ni mutado, debe pertenecer al sucesor
    assert.equal(stateAfter.fleet["ac02"].passenger?.sessionId, "orch-successor-sess", "Candidate successor must NOT be clobbered");

    // Bitácora registra pérdida de candidato
    const logs = readRecentTaxiLogs(15);
    assert.ok(logs.some((l) => l.includes("TAXI_ORCHESTRATOR_HANDOVER_CANDIDATE_LOST")));
  } finally {
    cleanupScratchDir(scratchDir);
  }
});

test("RULE 11: Late rollback with candidate reassigned -> skips rollback, preserves successor's lease", async () => {
  const scratchDir = createScratchDir("orch-late-rollback-succ");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");
  const customAccounts = ["ac01", "ac02"];

  try {
    const state = createInitialFleetState(customAccounts);
    state.fleet["ac01"].status = "ocupado";
    state.fleet["ac01"].passenger = {
      type: "orchestrator",
      sessionId: "orch-sess-late",
      pid: process.pid,
      model: "cpam/ac01/gemini-3.8-flash-high",
      taskLabel: "Sesión Principal",
      plate: `DC-HOST-${process.pid}`,
      startedAt: Date.now() - 10_000,
      heartbeatAt: Date.now(),
    };
    state.fleet["ac02"].status = "libre";
    saveFleetState(state, fleetPath);

    const mockPi: any = {
      setModel: async () => {
        // Durante setModel, ac02 es reasignado a otro proceso sucesor
        withFleetLock(fleetPath, () => {
          const s = loadFleetState(fleetPath, customAccounts);
          s.fleet["ac02"].passenger = {
            type: "orchestrator",
            sessionId: "orch-successor-late",
            pid: 8888888,
            plate: `DC-HOST-8888888`,
            startedAt: Date.now() + 500,
            heartbeatAt: Date.now() + 500,
          };
          saveFleetState(s, fleetPath);
        });
        // Falla setModel para gatillar rollback
        return false;
      },
    };

    const mockCtx = {
      hasUI: false,
      mode: "tui",
      model: { provider: "cpam", id: "ac01/gemini-3.8-flash-high" },
      sessionManager: { getSessionId: () => "orch-sess-late" },
      modelRegistry: {
        getAvailable: async () => [{ provider: "cpam", id: "ac02/gemini-3.8-flash-high" }],
        find: (_p: string, id: string) => ({ provider: "cpam", id }),
      },
    } as any;

    const mockQuotaCritical = (ac: string) => ({
      account: ac,
      gemini5hPct: ac === "ac01" ? 3 : 95,
      geminiWeeklyPct: 80,
      lastChecked: Date.now(),
    });

    const res = await handleOrchestratorQuotaHandover(mockCtx, mockPi, fleetPath, mockQuotaCritical);

    assert.equal(res.performed, false);

    const stateAfter = loadFleetState(fleetPath, customAccounts);
    // ac01 preservado
    assert.equal(stateAfter.fleet["ac01"].status, "ocupado");
    assert.equal(stateAfter.fleet["ac01"].passenger?.sessionId, "orch-sess-late");

    // ac02 NO debe ser liberado por rollback tardío porque su generación ya no coincide
    assert.equal(stateAfter.fleet["ac02"].status, "ocupado", "Candidate must NOT be released by stale rollback");
    assert.equal(stateAfter.fleet["ac02"].passenger?.sessionId, "orch-successor-late");

    const logs = readRecentTaxiLogs(15);
    assert.ok(logs.some((l) => l.includes("TAXI_ORCHESTRATOR_ROLLBACK_SKIPPED_GENERATION_MISMATCH")));
  } finally {
    cleanupScratchDir(scratchDir);
  }
});

test("RULE 12: acquireOrchestratorTaxi generates unique host lease token on each NEW reservation, preserved on existing lease", () => {
  const scratchDir = createScratchDir("orch-unique-token");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");
  const customAccounts = ["ac01", "ac02"];

  try {
    const state = createInitialFleetState(customAccounts);
    saveFleetState(state, fleetPath);

    // 1. Primera adquisición para ses-1
    const res1 = acquireOrchestratorTaxi("ses-1", "cpam/ac01/gemini-3.8-flash-high", fleetPath, process.pid, customAccounts);
    assert.ok(res1, "res1 must be acquired");
    const st1 = loadFleetState(fleetPath, customAccounts);
    const plate1 = st1.fleet[res1.account].passenger?.plate;
    assert.ok(plate1, "Must have a plate");
    assert.notEqual(plate1, `DC-HOST-${process.pid}`, "Host plate must NOT be static DC-HOST-PID");
    assert.ok(plate1.startsWith(`DC-HOST-${process.pid}-`), "Plate must contain host prefix and unique token");

    // 2. Llamada subsiguiente para la misma sesión preserva el lease token existente
    const res1Same = acquireOrchestratorTaxi("ses-1", "cpam/ac01/gemini-3.8-flash-high", fleetPath, process.pid, customAccounts);
    assert.equal(res1Same?.changed, false);
    const st1Same = loadFleetState(fleetPath, customAccounts);
    assert.equal(st1Same.fleet[res1.account].passenger?.plate, plate1, "Existing lease must preserve plate token");

    // 3. Adquisición NUEVA para otra sesión diferente genera un token ÚNICO distinto
    const res2 = acquireOrchestratorTaxi("ses-2", "cpam/ac02/gemini-3.8-flash-high", fleetPath, process.pid, customAccounts);
    assert.ok(res2, "res2 must be acquired");
    const st2 = loadFleetState(fleetPath, customAccounts);
    const plate2 = st2.fleet[res2.account].passenger?.plate;
    assert.ok(plate2, "Must have plate2");
    assert.notEqual(plate1, plate2, "Each NEW reservation must have a unique host lease token");
  } finally {
    cleanupScratchDir(scratchDir);
  }
});

test("RULE 13: model_select hook invokes syncOrchestratorTaxi during await setModel -> does NOT free old lease before finalization", async () => {
  // Use default FLEET_STATE_PATH inside isolatedHome to test actual production interaction
  const fleetPath = path.join(os.homedir(), ".pi", "agent", "dc-studio", "dc-taxis.json");
  const customAccounts = ["ac01", "ac02"];

  try {
    fs.mkdirSync(path.dirname(fleetPath), { recursive: true });
    const state = createInitialFleetState(customAccounts);
    state.fleet["ac01"].status = "ocupado";
    state.fleet["ac01"].passenger = {
      type: "orchestrator",
      sessionId: "orch-sess-race",
      pid: process.pid,
      model: "cpam/ac01/gemini-3.8-flash-high",
      taskLabel: "Sesión Principal",
      plate: `DC-HOST-${process.pid}-TOKEN1`,
      startedAt: Date.now() - 10_000,
      heartbeatAt: Date.now(),
    };
    state.fleet["ac02"].status = "libre";
    saveFleetState(state, fleetPath);

    // Register extension in fake Pi to get actual registered hooks
    const eventHandlers: Record<string, Function[]> = {};
    const mockPi: any = {
      on: (event: string, handler: Function) => {
        eventHandlers[event] = eventHandlers[event] || [];
        eventHandlers[event].push(handler);
      },
      registerCommand: () => {},
      registerShortcut: () => {},
      registerTool: () => {},
    };

    dcAgentsExtension(mockPi);
    assert.ok(eventHandlers["model_select"]?.length, "model_select handler must be registered");

    const mockCtx = {
      hasUI: true,
      mode: "tui",
      model: { provider: "cpam", id: "ac01/gemini-3.8-flash-high" },
      sessionManager: { getSessionId: () => "orch-sess-race" },
      modelRegistry: {
        getAvailable: async () => [{ provider: "cpam", id: "ac02/gemini-3.8-flash-high" }],
        find: (_p: string, id: string) => ({ provider: "cpam", id }),
      },
    } as any;

    mockPi.setModel = async (targetModel: any) => {
      // Simulate Pi firing the registered model_select event during hot setModel await
      const modelSelectHandlers = eventHandlers["model_select"] || [];
      const updatedCtx = {
        ...mockCtx,
        model: targetModel,
      };
      for (const handler of modelSelectHandlers) {
        handler({}, updatedCtx);
      }
      // Simulate setModel rejection (e.g. provider network error)
      throw new Error("Provider rejected connection during hot model switch");
    };

    const mockQuotaCritical = (ac: string) => ({
      account: ac,
      gemini5hPct: ac === "ac01" ? 3 : 95,
      geminiWeeklyPct: 80,
      lastChecked: Date.now(),
    });

    const res = await handleOrchestratorQuotaHandover(mockCtx, mockPi, undefined, mockQuotaCritical);

    assert.equal(res.performed, false, "Handover must fail when setModel rejects");

    const stateAfter = loadFleetState(fleetPath, customAccounts);
    // CRITICAL: The old lease ac01 MUST NOT have been freed by model_select's syncOrchestratorTaxi!
    assert.equal(
      stateAfter.fleet["ac01"].status,
      "ocupado",
      "Old lease ac01 MUST remain ocupado even when model_select fired during setModel",
    );
    assert.equal(stateAfter.fleet["ac01"].passenger?.sessionId, "orch-sess-race");
    assert.equal(stateAfter.fleet["ac01"].passenger?.plate, `DC-HOST-${process.pid}-TOKEN1`);

    // Candidate ac02 must be safely rolled back to libre
    assert.equal(stateAfter.fleet["ac02"].status, "libre", "Candidate ac02 must be rolled back to libre");
    assert.equal(stateAfter.fleet["ac02"].passenger, null);
  } finally {
    try {
      fs.rmSync(fleetPath, { force: true });
    } catch {
      /* defensive */
    }
  }
});

test("RULE 14: Overlapping same-session handovers are rejected and do not interfere", async () => {
  const scratchDir = createScratchDir("orch-overlap");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");
  const customAccounts = ["ac01", "ac02", "ac03"];

  try {
    const state = createInitialFleetState(customAccounts);
    state.fleet["ac01"].status = "ocupado";
    state.fleet["ac01"].passenger = {
      type: "orchestrator",
      sessionId: "orch-sess-overlap",
      pid: process.pid,
      model: "cpam/ac01/gemini-3.8-flash-high",
      taskLabel: "Sesión Principal",
      plate: `DC-HOST-${process.pid}-OVERLAP`,
      startedAt: Date.now() - 10_000,
      heartbeatAt: Date.now(),
    };
    state.fleet["ac02"].status = "libre";
    state.fleet["ac03"].status = "libre";
    saveFleetState(state, fleetPath);

    let secondResult: any = null;
    const mockCtx = {
      hasUI: false,
      mode: "tui",
      model: { provider: "cpam", id: "ac01/gemini-3.8-flash-high" },
      sessionManager: { getSessionId: () => "orch-sess-overlap" },
      modelRegistry: {
        getAvailable: async () => [
          { provider: "cpam", id: "ac02/gemini-3.8-flash-high" },
          { provider: "cpam", id: "ac03/gemini-3.8-flash-high" },
        ],
        find: (_p: string, id: string) => ({ provider: "cpam", id }),
      },
    } as any;

    const mockQuotaCritical = (ac: string) => ({
      account: ac,
      gemini5hPct: ac === "ac01" ? 3 : 95,
      geminiWeeklyPct: 80,
      lastChecked: Date.now(),
    });

    let calledSecond = false;
    const mockPi: any = {
      setModel: async () => {
        // While the first handover is awaiting setModel, trigger a second handover for the SAME session
        if (!calledSecond) {
          calledSecond = true;
          secondResult = await handleOrchestratorQuotaHandover(mockCtx, mockPi, fleetPath, mockQuotaCritical);
        }
        return true;
      },
    };

    const firstResult = await handleOrchestratorQuotaHandover(mockCtx, mockPi, fleetPath, mockQuotaCritical);

    assert.equal(firstResult.performed, true, "First handover should succeed");
    assert.ok(secondResult, "Second handover must have returned");
    assert.equal(secondResult.performed, false, "Overlapping same-session handover MUST be rejected");

    const stateAfter = loadFleetState(fleetPath, customAccounts);
    assert.equal(stateAfter.fleet["ac01"].status, "recargando", "Old lease finalized to recargando");
    assert.equal(stateAfter.fleet["ac02"].status, "ocupado", "Candidate ac02 acquired");
    assert.equal(stateAfter.fleet["ac03"].status, "libre", "ac03 must remain untouched");
  } finally {
    cleanupScratchDir(scratchDir);
  }
});
