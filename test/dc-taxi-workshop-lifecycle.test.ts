import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { DcTaxiQuotaInfo } from "../src/features/dc-agents/core/dc-taxi-quota.ts";

// HOME isolation MUST be applied BEFORE any project modules are loaded.
const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), "dc-workshop-lifecycle-home-"));
process.env.HOME = isolatedHome;

const dcAgentsModule = await import("../src/features/dc-agents/dc-agents.ts");
const dcAgentsExtension = dcAgentsModule.default;
const {
  handleTurnEndForWorkshop,
  handleTurnEndFailover,
  handleOrchestratorQuotaHandover,
  auditAccountForWorkshop,
  KNOWN_FATAL_AUTH_ACCOUNTS,
} = dcAgentsModule;

const {
  createInitialFleetState,
  loadFleetState,
  saveFleetState,
  sendTaxiToWorkshop,
  withFleetLock,
} = await import("../src/features/dc-agents/core/dc-taxi-dispatcher.ts");

const {
  clearTaxiQuotaCache,
  getCachedTaxiQuota,
  setCachedTaxiQuota,
} = await import("../src/features/dc-agents/core/dc-taxi-quota.ts");

const {
  TaxiWorkshopCoordinator,
} = await import("../src/features/dc-agents/core/dc-taxi-workshop.ts");

test.beforeEach(() => {
  clearTaxiQuotaCache();
  for (let i = 1; i <= 45; i++) {
    const ac = `ac${String(i).padStart(2, "0")}`;
    setCachedTaxiQuota(ac, { gemini5hPct: 100, lastChecked: Date.now() });
  }
});

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

test("RULE 1 (T2): Persistent TaxiWorkshopCoordinator is wired into session_start, before_agent_start, and turn_end", async () => {
  const scratchDir = createScratchDir("coord-wiring");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");

  try {
    const customAccounts = ["ac01"];
    const state = createInitialFleetState(customAccounts);
    saveFleetState(state, fleetPath);

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

    dcAgentsExtension(mockPi, { fleetPath });

    // Verify coordinator is instantiated and not disposed
    assert.ok(dcAgentsModule.activeWorkshopCoordinator, "activeWorkshopCoordinator must exist after registering extension");
    assert.equal(dcAgentsModule.activeWorkshopCoordinator.isDisposed(), false, "Coordinator must be active");

    assert.ok(eventHandlers["session_start"]?.length, "session_start must have registered handlers");
    assert.ok(eventHandlers["before_agent_start"]?.length, "before_agent_start must have registered handlers");
    assert.ok(eventHandlers["turn_end"]?.length, "turn_end must have registered handlers");
  } finally {
    cleanupScratchDir(scratchDir);
  }
});

test("RULE 2 (T2): session_shutdown disposes persistent coordinator, preventing any post-shutdown mutations", async () => {
  const scratchDir = createScratchDir("coord-shutdown");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");

  try {
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

    dcAgentsExtension(mockPi, { fleetPath });
    const coordinatorBefore = dcAgentsModule.activeWorkshopCoordinator;
    assert.ok(coordinatorBefore, "Coordinator must exist");

    // Trigger session_shutdown
    const shutdownHandlers = eventHandlers["session_shutdown"] || [];
    assert.ok(shutdownHandlers.length > 0, "session_shutdown handler must be registered");

    const mockCtx = {
      hasUI: true,
      mode: "tui",
      sessionManager: { getSessionId: () => "sess-shutdown" },
    };

    for (const handler of shutdownHandlers) {
      handler({}, mockCtx);
    }

    assert.equal(coordinatorBefore.isDisposed(), true, "Coordinator must be disposed on session_shutdown");
  } finally {
    cleanupScratchDir(scratchDir);
  }
});

test("RULE 3 (T2): Remove blanket status400 - HTTP 400 without provider auth keywords does NOT send taxi to workshop", () => {
  const scratchDir = createScratchDir("blanket-400");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");

  try {
    const customAccounts = ["ac01"];
    const state = createInitialFleetState(customAccounts);
    state.fleet["ac01"].status = "ocupado";
    state.fleet["ac01"].passenger = {
      type: "orchestrator",
      sessionId: "orch-bad-req",
      pid: process.pid,
      model: "cpam/ac01/gemini-3.8-flash-high",
      taskLabel: "Sesión Principal",
      plate: `DC-HOST-${process.pid}`,
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
    };
    saveFleetState(state, fleetPath);

    // Event with HTTP 400 Bad Request (syntax / validation error, NOT an auth error)
    const turnEvent = {
      type: "turn_end",
      turnIndex: 1,
      message: {
        role: "assistant",
        stopReason: "error",
        errorMessage: "Bad Request: prompt tokens exceeded per-request window schema",
        status: 400,
      },
      toolResults: [],
    };

    const ctx = {
      model: { provider: "cpam", id: "ac01/gemini-3.8-flash-high" },
      sessionManager: { getSessionId: () => "orch-bad-req" },
    } as any;

    const outcome = handleTurnEndForWorkshop(turnEvent, ctx, fleetPath);
    assert.equal(outcome.sent, false, "HTTP 400 without auth keywords must NOT be sent to workshop");

    const stateAfter = loadFleetState(fleetPath, customAccounts);
    assert.equal(stateAfter.fleet["ac01"].status, "ocupado", "Unit must remain ocupado");
  } finally {
    cleanupScratchDir(scratchDir);
  }
});

test("RULE 4 (T2): Prevent noninteractive RPC turn_end from acquiring or reserving orchestrator taxi", async () => {
  const scratchDir = createScratchDir("rpc-turn-end");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");

  try {
    const customAccounts = ["ac01", "ac02"];
    const state = createInitialFleetState(customAccounts);
    state.fleet["ac01"].status = "ocupado";
    state.fleet["ac01"].passenger = {
      type: "orchestrator",
      sessionId: "rpc-sess",
      pid: process.pid,
      model: "cpam/ac01/gemini-3.8-flash-high",
      taskLabel: "Sesión Principal",
      plate: `DC-HOST-${process.pid}`,
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
    };
    state.fleet["ac02"].status = "libre";
    saveFleetState(state, fleetPath);

    const eventHandlers: Record<string, Function[]> = {};
    const mockPi: any = {
      on: (event: string, handler: Function) => {
        eventHandlers[event] = eventHandlers[event] || [];
        eventHandlers[event].push(handler);
      },
      registerCommand: () => {},
      registerShortcut: () => {},
      registerTool: () => {},
      setModel: async () => true,
    };

    dcAgentsExtension(mockPi, { fleetPath });

    // Simulate RPC mode by setting process.argv containing "rpc"
    const originalArgv = [...process.argv];
    process.argv.push("rpc");

    try {
      const turnEndHandlers = eventHandlers["turn_end"] || [];
      const turnEvent = {
        type: "turn_end",
        turnIndex: 1,
        message: {
          role: "assistant",
          stopReason: "error",
          errorMessage: "Google Auth Error: token revoked (HTTP 401)",
          status: 401,
        },
      };

      const ctx = {
        hasUI: false,
        mode: "rpc",
        model: { provider: "cpam", id: "ac01/gemini-3.8-flash-high" },
        sessionManager: { getSessionId: () => "rpc-sess" },
        fleetPath,
      } as any;

      for (const handler of turnEndHandlers) {
        await handler(turnEvent, ctx);
      }

      const stateAfter = loadFleetState(fleetPath, customAccounts);
      // ac02 must NOT have been reserved as orchestrator taxi in RPC mode
      assert.equal(stateAfter.fleet["ac02"].status, "libre", "ac02 must remain libre in RPC mode");
      assert.equal(stateAfter.fleet["ac02"].passenger, null, "ac02 must have no passenger in RPC mode");
    } finally {
      process.argv = originalArgv;
    }
  } finally {
    cleanupScratchDir(scratchDir);
  }
});

test("RULE 5 (T2): auditAccountForWorkshop - fresh validated diagnostic never HTTP200-only repair", async () => {
  const scratchDir = createScratchDir("fresh-diag-valid");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");

  try {
    const customAccounts = ["ac01"];
    const state = createInitialFleetState(customAccounts);
    saveFleetState(state, fleetPath);
    sendTaxiToWorkshop("ac01", "Google Auth Error", fleetPath, customAccounts);

    // Mock fetcher that returns HTTP 200 but an empty / invalid payload (no recognized entries)
    const invalidPayloadFetcher = async () => ({
      status: 200,
      entries: [], // Empty entries: fails validated diagnostic!
    });

    const sent = await auditAccountForWorkshop("ac01", fleetPath, invalidPayloadFetcher);
    assert.equal(sent, false);

    const stateAfter = loadFleetState(fleetPath, customAccounts);
    // Unit MUST remain in workshop, because empty entries is NOT a fresh validated diagnostic!
    assert.equal(stateAfter.fleet["ac01"].status, "en_taller", "Must NOT repair on HTTP200-only empty payload");
  } finally {
    cleanupScratchDir(scratchDir);
  }
});

test("RULE 6 (T2): auditAccountForWorkshop - healthy low quota (<5%) transitions to recargando, not remaining in workshop", async () => {
  const scratchDir = createScratchDir("low-quota-workshop");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");

  try {
    const customAccounts = ["ac01"];
    const state = createInitialFleetState(customAccounts);
    saveFleetState(state, fleetPath);
    sendTaxiToWorkshop("ac01", "Google Auth Error", fleetPath, customAccounts);

    // Mock fetcher returning valid diagnostic with recognized 5h label and low quota (3%)
    const lowQuotaFetcher = async () => ({
      entries: [
        { name: "gemini-1.5-flash 5h", percentRemaining: 3 },
      ],
    });

    const sent = await auditAccountForWorkshop("ac01", fleetPath, lowQuotaFetcher);
    assert.equal(sent, false);

    const stateAfter = loadFleetState(fleetPath, customAccounts);
    // Must be repaired out of workshop, but since quota is 3% (< 5%), it must be in "recargando"
    assert.equal(stateAfter.fleet["ac01"].status, "recargando", "Low quota valid diagnostic must move to recargando");
  } finally {
    cleanupScratchDir(scratchDir);
  }
});

test("RULE 7 (T2): KNOWN_FATAL_AUTH_ACCOUNTS must not permanently prevent real recovery when validated probe succeeds", async () => {
  const scratchDir = createScratchDir("fatal-recovery");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");

  try {
    const customAccounts = ["ac40"];
    const state = createInitialFleetState(customAccounts);
    saveFleetState(state, fleetPath);
    sendTaxiToWorkshop("ac40", "Auth Error ac40", fleetPath, customAccounts);
    KNOWN_FATAL_AUTH_ACCOUNTS.add("ac40");

    // Mock fetcher that now returns a valid healthy diagnostic
    const recoveredFetcher = async () => ({
      entries: [
        { name: "gemini-1.5-flash primary 5h", percentRemaining: 85 },
      ],
    });

    const sent = await auditAccountForWorkshop("ac40", fleetPath, recoveredFetcher);
    assert.equal(sent, false, "Recovered account should not be sent to workshop");

    const stateAfter = loadFleetState(fleetPath, customAccounts);
    assert.equal(stateAfter.fleet["ac40"].status, "libre", "Unit must be repaired to libre");
    assert.equal(KNOWN_FATAL_AUTH_ACCOUNTS.has("ac40"), false, "ac40 must be removed from KNOWN_FATAL_AUTH_ACCOUNTS");
  } finally {
    KNOWN_FATAL_AUTH_ACCOUNTS.delete("ac40");
    cleanupScratchDir(scratchDir);
  }
});

test("RULE 8 (T2): turn_end failover - missing target model rolls back candidate lease and returns performed false", async () => {
  const scratchDir = createScratchDir("failover-missing-model");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");

  try {
    const customAccounts = ["ac01", "ac02"];
    const state = createInitialFleetState(customAccounts);
    state.fleet["ac01"].status = "ocupado";
    state.fleet["ac01"].passenger = {
      type: "orchestrator",
      sessionId: "orch-turn-miss",
      pid: process.pid,
      model: "cpam/ac01/gemini-3.8-flash-high",
      taskLabel: "Sesión Principal",
      plate: `DC-HOST-${process.pid}`,
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
    };
    state.fleet["ac02"].status = "libre";
    saveFleetState(state, fleetPath);

    const eventHandlers: Record<string, Function[]> = {};
    const mockPi: any = {
      on: (event: string, handler: Function) => {
        eventHandlers[event] = eventHandlers[event] || [];
        eventHandlers[event].push(handler);
      },
      registerCommand: () => {},
      registerShortcut: () => {},
      registerTool: () => {},
      setModel: async () => true,
    };

    dcAgentsExtension(mockPi, { fleetPath });

    const turnEvent = {
      type: "turn_end",
      turnIndex: 1,
      message: {
        role: "assistant",
        stopReason: "error",
        errorMessage: "Google Auth Error: token revoked (HTTP 401)",
        status: 401,
      },
    };

    // Model registry has NO model for candidate ac02
    const ctx = {
      hasUI: true,
      mode: "tui",
      model: { provider: "cpam", id: "ac01/gemini-3.8-flash-high" },
      sessionManager: { getSessionId: () => "orch-turn-miss" },
      fleetPath,
      modelRegistry: {
        getAvailable: async () => [],
        find: () => undefined,
      },
    } as any;

    const turnEndHandlers = eventHandlers["turn_end"] || [];
    for (const handler of turnEndHandlers) {
      await handler(turnEvent, ctx);
    }

    const stateAfter = loadFleetState(fleetPath, customAccounts);
    assert.equal(stateAfter.fleet["ac01"].status, "en_taller", "ac01 must be in workshop");
    // Candidate lease ac02 MUST NOT be stuck in ocupado: it must be rolled back to libre
    assert.equal(stateAfter.fleet["ac02"].status, "libre", "ac02 must be rolled back to libre when target model is missing");
    assert.equal(stateAfter.fleet["ac02"].passenger, null, "ac02 must have no active passenger");
  } finally {
    cleanupScratchDir(scratchDir);
  }
});

test("RULE 9 (T2): turn_end failover - setModel false rolls back candidate lease and returns performed false", async () => {
  const scratchDir = createScratchDir("failover-setmodel-false");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");

  try {
    const customAccounts = ["ac01", "ac02"];
    const state = createInitialFleetState(customAccounts);
    state.fleet["ac01"].status = "ocupado";
    state.fleet["ac01"].passenger = {
      type: "orchestrator",
      sessionId: "orch-turn-false",
      pid: process.pid,
      model: "cpam/ac01/gemini-3.8-flash-high",
      taskLabel: "Sesión Principal",
      plate: `DC-HOST-${process.pid}`,
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
    };
    state.fleet["ac02"].status = "libre";
    saveFleetState(state, fleetPath);

    const eventHandlers: Record<string, Function[]> = {};
    const mockPi: any = {
      on: (event: string, handler: Function) => {
        eventHandlers[event] = eventHandlers[event] || [];
        eventHandlers[event].push(handler);
      },
      registerCommand: () => {},
      registerShortcut: () => {},
      registerTool: () => {},
      // setModel explicitly returns false (switch denied)
      setModel: async () => false,
    };

    dcAgentsExtension(mockPi, { fleetPath });

    const turnEvent = {
      type: "turn_end",
      turnIndex: 1,
      message: {
        role: "assistant",
        stopReason: "error",
        errorMessage: "Google Auth Error: token revoked (HTTP 401)",
        status: 401,
      },
    };

    const ctx = {
      hasUI: true,
      mode: "tui",
      model: { provider: "cpam", id: "ac01/gemini-3.8-flash-high" },
      sessionManager: { getSessionId: () => "orch-turn-false" },
      fleetPath,
      modelRegistry: {
        getAvailable: async () => [{ provider: "cpam", id: "ac02/gemini-3.8-flash-high" }],
        find: (_p: string, id: string) => ({ provider: "cpam", id }),
      },
    } as any;

    const turnEndHandlers = eventHandlers["turn_end"] || [];
    for (const handler of turnEndHandlers) {
      await handler(turnEvent, ctx);
    }

    const stateAfter = loadFleetState(fleetPath, customAccounts);
    assert.equal(stateAfter.fleet["ac01"].status, "en_taller", "ac01 must be in workshop");
    // Candidate lease ac02 MUST be rolled back to libre
    assert.equal(stateAfter.fleet["ac02"].status, "libre", "ac02 must be rolled back to libre when setModel returns false");
    assert.equal(stateAfter.fleet["ac02"].passenger, null, "ac02 passenger must be cleared");
  } finally {
    cleanupScratchDir(scratchDir);
  }
});

test("RULE 10 (T2): turn_end failover - setModel rejection/throw rolls back candidate lease", async () => {
  const scratchDir = createScratchDir("failover-setmodel-throw");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");

  try {
    const customAccounts = ["ac01", "ac02"];
    const state = createInitialFleetState(customAccounts);
    state.fleet["ac01"].status = "ocupado";
    state.fleet["ac01"].passenger = {
      type: "orchestrator",
      sessionId: "orch-turn-throw",
      pid: process.pid,
      model: "cpam/ac01/gemini-3.8-flash-high",
      taskLabel: "Sesión Principal",
      plate: `DC-HOST-${process.pid}`,
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
    };
    state.fleet["ac02"].status = "libre";
    saveFleetState(state, fleetPath);

    const eventHandlers: Record<string, Function[]> = {};
    const mockPi: any = {
      on: (event: string, handler: Function) => {
        eventHandlers[event] = eventHandlers[event] || [];
        eventHandlers[event].push(handler);
      },
      registerCommand: () => {},
      registerShortcut: () => {},
      registerTool: () => {},
      // setModel throws / rejects
      setModel: async () => {
        throw new Error("Hot switch rejected by provider bridge");
      },
    };

    dcAgentsExtension(mockPi, { fleetPath });

    const turnEvent = {
      type: "turn_end",
      turnIndex: 1,
      message: {
        role: "assistant",
        stopReason: "error",
        errorMessage: "Google Auth Error: token revoked (HTTP 401)",
        status: 401,
      },
    };

    const ctx = {
      hasUI: true,
      mode: "tui",
      model: { provider: "cpam", id: "ac01/gemini-3.8-flash-high" },
      sessionManager: { getSessionId: () => "orch-turn-throw" },
      fleetPath,
      modelRegistry: {
        getAvailable: async () => [{ provider: "cpam", id: "ac02/gemini-3.8-flash-high" }],
        find: (_p: string, id: string) => ({ provider: "cpam", id }),
      },
    } as any;

    const turnEndHandlers = eventHandlers["turn_end"] || [];
    for (const handler of turnEndHandlers) {
      await handler(turnEvent, ctx);
    }

    const stateAfter = loadFleetState(fleetPath, customAccounts);
    assert.equal(stateAfter.fleet["ac01"].status, "en_taller", "ac01 must be in workshop");
    // Candidate lease ac02 MUST be rolled back to libre
    assert.equal(stateAfter.fleet["ac02"].status, "libre", "ac02 must be rolled back to libre when setModel rejects");
    assert.equal(stateAfter.fleet["ac02"].passenger, null, "ac02 passenger must be cleared");
  } finally {
    cleanupScratchDir(scratchDir);
  }
});

test("RULE 11 (T2): turn_end failover - successful interactive setModel confirms switch and retains new lease", async () => {
  const scratchDir = createScratchDir("failover-success");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");

  try {
    const customAccounts = ["ac01", "ac02"];
    const state = createInitialFleetState(customAccounts);
    state.fleet["ac01"].status = "ocupado";
    state.fleet["ac01"].passenger = {
      type: "orchestrator",
      sessionId: "orch-turn-ok",
      pid: process.pid,
      model: "cpam/ac01/gemini-3.8-flash-high",
      taskLabel: "Sesión Principal",
      plate: `DC-HOST-${process.pid}`,
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
    };
    state.fleet["ac02"].status = "libre";
    saveFleetState(state, fleetPath);

    let setModelCalledWith: any = null;
    const eventHandlers: Record<string, Function[]> = {};
    const mockPi: any = {
      on: (event: string, handler: Function) => {
        eventHandlers[event] = eventHandlers[event] || [];
        eventHandlers[event].push(handler);
      },
      registerCommand: () => {},
      registerShortcut: () => {},
      registerTool: () => {},
      setModel: async (m: any) => {
        setModelCalledWith = m;
        return true;
      },
    };

    dcAgentsExtension(mockPi, { fleetPath });

    const turnEvent = {
      type: "turn_end",
      turnIndex: 1,
      message: {
        role: "assistant",
        stopReason: "error",
        errorMessage: "Google Auth Error: token revoked (HTTP 401)",
        status: 401,
      },
    };

    const ctx = {
      hasUI: true,
      mode: "tui",
      model: { provider: "cpam", id: "ac01/gemini-3.8-flash-high" },
      sessionManager: { getSessionId: () => "orch-turn-ok" },
      fleetPath,
      modelRegistry: {
        getAvailable: async () => [{ provider: "cpam", id: "ac02/gemini-3.8-flash-high" }],
        find: (_p: string, id: string) => ({ provider: "cpam", id }),
      },
    } as any;

    const turnEndHandlers = eventHandlers["turn_end"] || [];
    for (const handler of turnEndHandlers) {
      await handler(turnEvent, ctx);
    }

    const stateAfter = loadFleetState(fleetPath, customAccounts);
    assert.equal(stateAfter.fleet["ac01"].status, "en_taller", "ac01 must be in workshop");
    // Candidate lease ac02 MUST be confirmed as ocupado
    assert.equal(stateAfter.fleet["ac02"].status, "ocupado", "ac02 must be ocupado after successful setModel");
    assert.equal(stateAfter.fleet["ac02"].passenger?.sessionId, "orch-turn-ok");
    assert.equal(stateAfter.fleet["ac02"].passenger?.pid, process.pid);
    assert.ok(setModelCalledWith, "setModel must have been called");
  } finally {
    cleanupScratchDir(scratchDir);
  }
});

test("P1 RACE - audit pending across actual registered shutdown cannot mutate cache, fatal or workshop state", async () => {
  clearTaxiQuotaCache();
  const scratchDir = createScratchDir("audit-shutdown-race");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");

  try {
    const customAccounts = ["ac01", "ac02"];
    const state = createInitialFleetState(customAccounts);
    saveFleetState(state, fleetPath);

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

    dcAgentsExtension(mockPi, { fleetPath });

    let resolveDeferred!: (value: any) => void;
    const probePromise = new Promise<any>((resolve) => {
      resolveDeferred = resolve;
    });

    const deferredFetcher = async (_account: string) => {
      return await probePromise;
    };

    // Lanzar auditoría asíncrona
    const auditPromise = auditAccountForWorkshop("ac01", fleetPath, deferredFetcher);

    // Disparar sesión shutdown registrada
    const shutdownHandlers = eventHandlers["session_shutdown"] || [];
    assert.ok(shutdownHandlers.length > 0, "session_shutdown must be registered");
    for (const h of shutdownHandlers) {
      h({}, { hasUI: true, mode: "tui", sessionManager: { getSessionId: () => "test-sess" } });
    }

    // Resolver probe pendiente tras shutdown con cuota válida
    resolveDeferred({
      entries: [
        { name: "gemini_5h", percentRemaining: 99 },
        { name: "gemini_weekly", percentRemaining: 99 },
      ],
    });

    const sent = await auditPromise;

    // Mutaciones deben quedar estrictamente bloqueadas
    assert.equal(sent, false, "Audit must abort across shutdown");
    assert.equal(getCachedTaxiQuota("ac01"), undefined, "Cache must not be mutated across shutdown");
    assert.equal(KNOWN_FATAL_AUTH_ACCOUNTS.has("ac01"), false, "Fatal set must not be mutated");

    const fleetAfter = loadFleetState(fleetPath, customAccounts);
    assert.equal(fleetAfter.fleet["ac01"].status, "libre", "Fleet unit state must remain unmutated");
    assert.equal(dcAgentsModule.activeWorkshopCoordinator?.isDisposed(), true, "Coordinator must be disposed");
  } finally {
    cleanupScratchDir(scratchDir);
  }
});

test("P1 RACE - newer workshop fault while older audit pending remains unchanged in workshop", async () => {
  const scratchDir = createScratchDir("older-audit-newer-fault");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");

  try {
    const customAccounts = ["ac01"];
    const state = createInitialFleetState(customAccounts);
    saveFleetState(state, fleetPath);

    // Enviar ac01 a taller con falla inicial
    sendTaxiToWorkshop("ac01", "Initial Auth Error 401", fleetPath);
    const initialSummary = loadFleetState(fleetPath, customAccounts);
    const initialWorkshopSince = initialSummary.fleet["ac01"].workshopSince;
    assert.ok(initialWorkshopSince, "Must have initial workshop timestamp");

    let resolveProbe!: (val: any) => void;
    const probePromise = new Promise<any>((resolve) => {
      resolveProbe = resolve;
    });

    const deferredFetcher = async () => {
      return await probePromise;
    };

    // Iniciar auditoría vieja
    const oldAuditPromise = auditAccountForWorkshop("ac01", fleetPath, deferredFetcher);

    // Mientras la auditoría vieja está pendiente, sobreviene una falla más nueva
    // Forzamos un timestamp posterior asegurando una nueva falla
    await new Promise((r) => setTimeout(r, 10));
    withFleetLock(fleetPath, () => {
      const s = loadFleetState(fleetPath, customAccounts);
      s.fleet["ac01"].workshopSince = (initialWorkshopSince as number) + 1000;
      s.fleet["ac01"].workshopReason = "Newer Fatal Token Revoked";
      saveFleetState(s, fleetPath);
    });

    // La auditoría vieja resuelve satisfactoriamente con 100% de cuota
    resolveProbe({
      entries: [
        { name: "gemini_5h", percentRemaining: 100 },
        { name: "gemini_weekly", percentRemaining: 100 },
      ],
    });

    const result = await oldAuditPromise;
    assert.equal(result, false, "Older audit resolution must not confirm fault or repair");

    // Verificar que ac01 SIGUE en taller con la falla nueva y no fue reparado por la auditoría vieja
    const fleetAfter = loadFleetState(fleetPath, customAccounts);
    assert.equal(fleetAfter.fleet["ac01"].status, "en_taller", "ac01 must remain in workshop");
    assert.equal(fleetAfter.fleet["ac01"].workshopReason, "Newer Fatal Token Revoked", "Newer reason must be preserved");
    assert.equal(fleetAfter.fleet["ac01"].workshopSince, (initialWorkshopSince as number) + 1000);
  } finally {
    cleanupScratchDir(scratchDir);
  }
});

test("P1 RACE - failover candidate reassigned during getAvailable: zero setModel", async () => {
  clearTaxiQuotaCache();
  const scratchDir = createScratchDir("failover-reassigned-getavail");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");

  try {
    const customAccounts = ["ac01", "ac02"];
    const state = createInitialFleetState(customAccounts);
    saveFleetState(state, fleetPath);

    let setModelCount = 0;
    const mockPi: any = {
      setModel: async () => {
        setModelCount++;
        return true;
      },
    };

    const ctx: any = {
      hasUI: true,
      mode: "tui",
      model: { provider: "cpam", id: "ac01/gemini-3.8-flash-high" },
      sessionManager: { getSessionId: () => "orch-race-1" },
      fleetPath,
      modelRegistry: {
        getAvailable: async () => {
          // Durante el await getAvailable, otra sesión o proceso reasigna la titularidad del candidato
          withFleetLock(fleetPath, () => {
            const s = loadFleetState(fleetPath, customAccounts);
            for (const unit of Object.values(s.fleet)) {
              if (unit.passenger && unit.passenger.sessionId === "orch-race-1") {
                unit.passenger.sessionId = "competing-process-session";
                unit.passenger.pid = 999999;
              }
            }
            saveFleetState(s, fleetPath);
          });
          return [
            { provider: "cpam", id: "ac02/gemini-3.8-flash-high" },
            { provider: "cpam", id: "ac03/gemini-3.8-flash-high" },
          ];
        },
        find: (_p: string, id: string) => ({ provider: "cpam", id }),
      },
    };

    const outcome = await handleTurnEndFailover("ac01", ctx, mockPi, fleetPath);

    assert.equal(outcome.performed, false, "Failover must abort when ownership lost during getAvailable");
    assert.equal(setModelCount, 0, "setModel must NOT be invoked when candidate was reassigned during getAvailable");

    // Verificar que el sucesor no fue sobreescrito ni destruido
    const fleetAfter = loadFleetState(fleetPath, customAccounts);
    const competingUnit = Object.values(fleetAfter.fleet).find((u) => u.passenger?.sessionId === "competing-process-session");
    assert.ok(competingUnit, "Candidate reassigned to competing session must remain preserved");
  } finally {
    cleanupScratchDir(scratchDir);
  }
});

test("P1 RACE - failover candidate reassigned during setModel: compensation restores previous runtime, successor preserved and performed false", async () => {
  clearTaxiQuotaCache();
  const scratchDir = createScratchDir("failover-reassigned-setmodel");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");

  try {
    const customAccounts = ["ac01", "ac02"];
    const state = createInitialFleetState(customAccounts);
    saveFleetState(state, fleetPath);

    const previousModel = { provider: "cpam", id: "ac01/gemini-3.8-flash-high" };
    const setModelCalls: any[] = [];

    const mockPi: any = {
      setModel: async (m: any) => {
        setModelCalls.push(m);
        if (setModelCalls.length === 1) {
          // Durante el primer setModel (exitoso), se produce la pérdida de titularidad en el fleet
          withFleetLock(fleetPath, () => {
            const s = loadFleetState(fleetPath, customAccounts);
            if (s.fleet["ac02"] && s.fleet["ac02"].passenger) {
              s.fleet["ac02"].passenger.sessionId = "successor-session-xyz";
              s.fleet["ac02"].passenger.plate = "taxi-successor-plate";
              s.fleet["ac02"].passenger.pid = 888888;
              saveFleetState(s, fleetPath);
            }
          });
          return true;
        }
        // Segunda llamada esperada: compensación al modelo anterior
        return true;
      },
    };

    const ctx: any = {
      hasUI: true,
      mode: "tui",
      model: previousModel,
      sessionManager: { getSessionId: () => "orch-race-2" },
      fleetPath,
      modelRegistry: {
        getAvailable: async () => [{ provider: "cpam", id: "ac02/gemini-3.8-flash-high" }],
        find: (_p: string, id: string) => ({ provider: "cpam", id }),
      },
    };

    const outcome = await handleTurnEndFailover("ac01", ctx, mockPi, fleetPath);

    assert.equal(outcome.performed, false, "Performed must be false when candidate reassigned during setModel");
    assert.equal(setModelCalls.length, 2, "Must call setModel twice: first candidate, second compensation");
    assert.equal(setModelCalls[0].id, "ac02/gemini-3.8-flash-high", "First setModel was candidate");
    assert.equal(setModelCalls[1].id, previousModel.id, "Second setModel compensated back to previousModel");

    // Verificar que el sucesor en el fleet fue preservado íntegro
    const fleetAfter = loadFleetState(fleetPath, customAccounts);
    assert.equal(fleetAfter.fleet["ac02"].passenger?.sessionId, "successor-session-xyz");
    assert.equal(fleetAfter.fleet["ac02"].passenger?.plate, "taxi-successor-plate");
    assert.equal(fleetAfter.fleet["ac02"].passenger?.pid, 888888);
  } finally {
    cleanupScratchDir(scratchDir);
  }
});

test("ITEM4 FINAL - saturated fallback does not switch after lease reassignment", async () => {
  const scratch = createScratchDir("saturated-reassigned");
  const fleetPath = path.join(scratch, "dc-taxis.json");
  const state = createInitialFleetState(["ac01"]);
  state.fleet.ac01.status = "ocupado";
  state.fleet.ac01.passenger = {
    type: "orchestrator", sessionId: "saturated-session", pid: process.pid,
    model: "cpam/ac01/claude-sonnet-4-6", plate: "original-lease",
    startedAt: Date.now(), heartbeatAt: Date.now(),
  };
  saveFleetState(state, fleetPath);
  let switches = 0;
  try {
    const outcome = await dcAgentsModule.handleOrchestratorQuotaHandover({
      hasUI: true, mode: "tui", model: { provider: "cpam", id: "ac01/claude-sonnet-4-6" },
      sessionManager: { getSessionId: () => "saturated-session" },
      modelRegistry: {
        getAvailable: async () => {
          withFleetLock(fleetPath, () => {
            const current = loadFleetState(fleetPath, ["ac01"]);
            current.fleet.ac01.passenger!.sessionId = "successor";
            current.fleet.ac01.passenger!.plate = "successor-lease";
            saveFleetState(current, fleetPath);
          });
          return [{ provider: "cpam", id: "ac01/gemini-3.8-flash-high" }];
        },
        find: (_p: string, id: string) => ({ provider: "cpam", id }),
      },
    } as any, { setModel: async () => { switches++; return true; } } as any, fleetPath,
    () => ({ account: "ac01", gemini5hPct: 2, claude5hPct: 2, geminiWeeklyPct: 90, lastChecked: Date.now() }));
    assert.equal(outcome.performed, false);
    assert.equal(switches, 0);
    assert.equal(loadFleetState(fleetPath, ["ac01"]).fleet.ac01.passenger?.plate, "successor-lease");
  } finally { cleanupScratchDir(scratch); }
});

test("ITEM4 FINAL - shutdown stops remaining fleet audits", async () => {
  const scratch = createScratchDir("fleet-stop");
  const fleetPath = path.join(scratch, "dc-taxis.json");
  saveFleetState(createInitialFleetState(["ac01", "ac02"]), fleetPath);
  const handlers: Record<string, Function[]> = {};
  dcAgentsExtension({ on: (name: string, cb: Function) => (handlers[name] ||= []).push(cb), registerTool() {}, registerCommand() {}, registerShortcut() {} } as any, { fleetPath });
  let finish!: (value: any) => void;
  const calls: string[] = [];
  const response = new Promise((resolve) => { finish = resolve; });
  try {
    const result = dcAgentsModule.auditFleetAccountsForWorkshop(["ac01", "ac02"], fleetPath, async (account) => { calls.push(account); return response; });
    for (const shutdown of handlers.session_shutdown) shutdown({}, { hasUI: false });
    finish({ entries: [{ name: "gemini_5h", percentRemaining: 95 }] });
    assert.deepEqual(await result, []);
    assert.deepEqual(calls, ["ac01"]);
  } finally { cleanupScratchDir(scratch); }
});

test("ITEM4 FINAL - initially free account preserves newer fatal state and cache", async () => {
  clearTaxiQuotaCache();
  const scratch = createScratchDir("free-new-fault");
  const fleetPath = path.join(scratch, "dc-taxis.json");
  saveFleetState(createInitialFleetState(["ac01"]), fleetPath);
  KNOWN_FATAL_AUTH_ACCOUNTS.delete("ac01");
  let finish!: (value: any) => void;
  const response = new Promise((resolve) => { finish = resolve; });
  try {
    const result = auditAccountForWorkshop("ac01", fleetPath, async () => response);
    sendTaxiToWorkshop("ac01", "New fatal", fleetPath);
    KNOWN_FATAL_AUTH_ACCOUNTS.add("ac01");
    const before = loadFleetState(fleetPath, ["ac01"]).fleet.ac01;
    finish({ entries: [{ name: "gemini_5h", percentRemaining: 95 }] });
    assert.equal(await result, false);
    assert.equal(KNOWN_FATAL_AUTH_ACCOUNTS.has("ac01"), true);
    assert.equal(getCachedTaxiQuota("ac01"), undefined);
    assert.deepEqual(loadFleetState(fleetPath, ["ac01"]).fleet.ac01, before);
  } finally { KNOWN_FATAL_AUTH_ACCOUNTS.delete("ac01"); cleanupScratchDir(scratch); }
});

test("ITEM4 FINAL - rejected compensation reports unsafe runtime and alerts operator", async () => {
  for (const rejects of [false, true]) {
    const scratch = createScratchDir("compensation-failure");
    const fleetPath = path.join(scratch, "dc-taxis.json");
    saveFleetState(createInitialFleetState(["ac01", "ac02"]), fleetPath);
    const previous = { provider: "cpam", id: "ac01/gemini-3.8-flash-high" };
    let runtime = previous;
    let calls = 0;
    const notices: string[] = [];
    try {
      const outcome = await handleTurnEndFailover("ac01", {
        hasUI: true, mode: "tui", model: previous,
        sessionManager: { getSessionId: () => "compensation-test" },
        modelRegistry: { getAvailable: async () => [], find: (_p: string, id: string) => ({ provider: "cpam", id }) },
        ui: { notify: (message: string) => notices.push(message) },
      } as any, {
        setModel: async (model: typeof previous) => {
          calls++;
          if (calls === 1) {
            runtime = model;
            withFleetLock(fleetPath, () => {
              const state = loadFleetState(fleetPath, ["ac01", "ac02"]);
              state.fleet.ac02.passenger!.sessionId = "successor";
              saveFleetState(state, fleetPath);
            });
            return true;
          }
          if (rejects) throw new Error("restore rejected");
          return false;
        },
      } as any, fleetPath);
      assert.equal(outcome.performed, false);
      assert.equal(outcome.compensationFailed, true);
      assert.equal(runtime.id, "ac02/gemini-3.8-flash-high");
      assert.equal(loadFleetState(fleetPath, ["ac01", "ac02"]).fleet.ac02.passenger?.sessionId, "successor");
      assert.equal(notices.length, 1);
      assert.match(notices[0], /No se pudo restaurar/);
    } finally { cleanupScratchDir(scratch); }
  }
});

test("P1 RACE - RPC quota handover low quota both free/saturated no model switch/no fleet changes", async () => {
  const scratchDir = createScratchDir("rpc-quota-handover");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");

  try {
    const customAccounts = ["ac01", "ac02"];
    const state = createInitialFleetState(customAccounts);
    saveFleetState(state, fleetPath);

    // Forzar presencia de "rpc" en process.argv
    const originalArgv = [...process.argv];
    if (!process.argv.includes("rpc")) {
      process.argv.push("rpc");
    }

    try {
      let setModelCalls = 0;
      const mockPi: any = {
        setModel: async () => {
          setModelCalls++;
          return true;
        },
      };

      // Escenario A: flota libre disponible pero en modo RPC
      const ctxFree: any = {
        hasUI: true,
        mode: "tui",
        model: { provider: "cpam", id: "ac01/gemini-3.8-flash-high" },
        sessionManager: { getSessionId: () => "rpc-sess-1" },
      };

      const lowQuotaGetter = (ac: string): DcTaxiQuotaInfo => {
        if (ac === "ac01") return { account: ac, gemini5hPct: 4, geminiWeeklyPct: 50, lastChecked: Date.now() };
        return { account: ac, gemini5hPct: 90, geminiWeeklyPct: 90, lastChecked: Date.now() };
      };

      const resFree = await handleOrchestratorQuotaHandover(ctxFree, mockPi, fleetPath, lowQuotaGetter);
      assert.equal(resFree.performed, false, "Handover in RPC must return performed: false with free fleet");
      assert.equal(setModelCalls, 0, "No setModel allowed in RPC mode");

      const fleetFree = loadFleetState(fleetPath, customAccounts);
      assert.equal(fleetFree.fleet["ac01"].status, "libre", "Fleet state ac01 must not change");
      assert.equal(fleetFree.fleet["ac02"].status, "libre", "Fleet state ac02 must not change");

      // Escenario B: flota saturada (todas las demás unidades ocupadas) en modo RPC
      withFleetLock(fleetPath, () => {
        const s = loadFleetState(fleetPath, customAccounts);
        s.fleet["ac02"].status = "ocupado";
        s.fleet["ac02"].passenger = { plate: "taxi-ac02", type: "subagent", sessionId: "sub-1", pid: 1234, startedAt: Date.now(), heartbeatAt: Date.now() };
        saveFleetState(s, fleetPath);
      });

      const resSat = await handleOrchestratorQuotaHandover(ctxFree, mockPi, fleetPath, lowQuotaGetter);
      assert.equal(resSat.performed, false, "Handover in RPC must return performed: false with saturated fleet");
      assert.equal(setModelCalls, 0, "No setModel allowed in RPC mode");

      const fleetSat = loadFleetState(fleetPath, customAccounts);
      assert.equal(fleetSat.fleet["ac02"].passenger?.sessionId, "sub-1", "Saturated fleet must remain unchanged");
    } finally {
      process.argv = originalArgv;
    }
  } finally {
    cleanupScratchDir(scratchDir);
  }
});

test("P1 RACE - positive auth-specific HTTP 400 sends to workshop, generic HTTP 400 unchanged", async () => {
  const scratchDir = createScratchDir("http400-auth-vs-generic");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");

  try {
    const customAccounts = ["ac01", "ac02"];
    const state = createInitialFleetState(customAccounts);
    saveFleetState(state, fleetPath);

    // 1. Positive auth-specific HTTP 400 (e.g. invalid_grant / token revoked / unauthorized)
    const authEvent = {
      type: "turn_end",
      turnIndex: 1,
      message: {
        role: "assistant",
        stopReason: "error",
        errorMessage: "OAuth 2.0 error: invalid_grant - token was revoked by administrator",
        status: 400,
      },
    };

    const ctxAuth: any = {
      model: { provider: "cpam", id: "ac01/gemini-3.8-flash-high" },
      fleetPath,
    };

    const resAuth = handleTurnEndForWorkshop(authEvent, ctxAuth, fleetPath);
    assert.equal(resAuth.sent, true, "Auth-specific HTTP 400 must trigger workshop");
    assert.equal(resAuth.account, "ac01");

    const fleetAfterAuth = loadFleetState(fleetPath, customAccounts);
    assert.equal(fleetAfterAuth.fleet["ac01"].status, "en_taller", "ac01 must be placed in workshop");

    // 2. Generic HTTP 400 (e.g. bad request, malformed parameters, invalid json)
    const genericEvent = {
      type: "turn_end",
      turnIndex: 2,
      message: {
        role: "assistant",
        stopReason: "error",
        errorMessage: "Bad Request: JSON parse error in parameters payload",
        status: 400,
      },
    };

    const ctxGeneric: any = {
      model: { provider: "cpam", id: "ac02/gemini-3.8-flash-high" },
      fleetPath,
    };

    const resGeneric = handleTurnEndForWorkshop(genericEvent, ctxGeneric, fleetPath);
    assert.equal(resGeneric.sent, false, "Generic HTTP 400 must NOT trigger workshop");

    const fleetAfterGeneric = loadFleetState(fleetPath, customAccounts);
    assert.equal(fleetAfterGeneric.fleet["ac02"].status, "libre", "ac02 must remain untouched");
  } finally {
    cleanupScratchDir(scratchDir);
  }
});
