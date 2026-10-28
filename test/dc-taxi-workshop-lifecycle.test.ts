import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// HOME isolation MUST be applied BEFORE any project modules are loaded.
const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), "dc-workshop-lifecycle-home-"));
process.env.HOME = isolatedHome;

import dcAgentsExtension, {
  handleTurnEndForWorkshop,
  auditAccountForWorkshop,
  KNOWN_FATAL_AUTH_ACCOUNTS,
  activeWorkshopCoordinator,
} from "../src/features/dc-agents/dc-agents.ts";

import {
  createInitialFleetState,
  loadFleetState,
  saveFleetState,
  sendTaxiToWorkshop,
  withFleetLock,
} from "../src/features/dc-agents/core/dc-taxi-dispatcher.ts";

import {
  clearTaxiQuotaCache,
  getCachedTaxiQuota,
} from "../src/features/dc-agents/core/dc-taxi-quota.ts";

import {
  TaxiWorkshopCoordinator,
} from "../src/features/dc-agents/core/dc-taxi-workshop.ts";

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

    dcAgentsExtension(mockPi);

    // Verify coordinator is instantiated and not disposed
    assert.ok(activeWorkshopCoordinator, "activeWorkshopCoordinator must exist after registering extension");
    assert.equal(activeWorkshopCoordinator.isDisposed(), false, "Coordinator must be active");

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

    dcAgentsExtension(mockPi);
    const coordinatorBefore = activeWorkshopCoordinator;
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

    dcAgentsExtension(mockPi);

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
