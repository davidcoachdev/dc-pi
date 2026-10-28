import * as path from "node:path";
import * as fs from "node:fs";

// HOME isolation MUST be applied BEFORE any project modules are loaded.
const scratchHome = path.resolve(
  ".test-build",
  `scratch-home-excluded-${Date.now()}-${Math.random().toString(36).slice(2)}`,
);
fs.mkdirSync(scratchHome, { recursive: true });
process.env.HOME = scratchHome;

import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  loadFleetState,
  saveFleetState,
  acquireOrchestratorTaxi,
} from "../src/features/dc-agents/core/dc-taxi-dispatcher.ts";

import type {
  DcTaxiFleetState,
  DcTaxiPassenger,
} from "../src/features/dc-agents/core/dc-ephemeral-types.ts";

import {
  clearTaxiQuotaCache,
  setCachedTaxiQuota,
} from "../src/features/dc-agents/core/dc-taxi-quota.ts";

after(() => {
  try {
    fs.rmSync(scratchHome, { recursive: true, force: true });
  } catch {
    /* defensive */
  }
});

beforeEach(() => {
  clearTaxiQuotaCache();
});

function createScratchDir(name: string): string {
  const dir = path.resolve(
    ".test-build",
    `scratch-excluded-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
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

test("EXCLUDED RESERVATION: input model points to B with excludedAccounts[A] retains A byte-for-byte and occupies B", () => {
  const scratchDir = createScratchDir("points-b");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");
  const accounts = ["ac01", "ac02"];
  const sessionId = "sess-orch-switch-1";
  const pid = process.pid;

  // Mock quota for candidates so no real network requests are attempted
  setCachedTaxiQuota("ac01", { gemini5hPct: 90 });
  setCachedTaxiQuota("ac02", { gemini5hPct: 95 });

  try {
    // Initial state: Orchestrator A (ac01) occupied, B (ac02) libre
    const initialPassengerA: DcTaxiPassenger = {
      type: "orchestrator",
      sessionId,
      pid,
      model: "cpam/ac01/gemini-3.8-flash-high",
      taskLabel: "Sesión Principal (Orquestador)",
      plate: `DC-HOST-${pid}`,
      startedAt: Date.now() - 5000,
      heartbeatAt: Date.now() - 1000,
    };

    const initialState: DcTaxiFleetState = {
      fleet: {
        ac01: {
          account: "ac01",
          status: "ocupado",
          passenger: { ...initialPassengerA },
        },
        ac02: {
          account: "ac02",
          status: "libre",
          passenger: null,
        },
      },
      lastUpdated: Date.now() - 1000,
    };
    saveFleetState(initialState, fleetPath);

    const initialAOnDiskRaw = JSON.stringify(loadFleetState(fleetPath, accounts).fleet["ac01"]);

    // Attempt switch to ac02 while ac01 is excluded
    const acquired = acquireOrchestratorTaxi(
      sessionId,
      "cpam/ac02/gemini-3.8-flash-high",
      fleetPath,
      pid,
      accounts,
      "gemini-3.8-flash-high",
      "cpam",
      ["ac01"],
    );

    assert.ok(acquired, "acquireOrchestratorTaxi must succeed when candidate ac02 is available");
    assert.equal(acquired.account, "ac02");

    // Exact disk verification via public API
    const diskState = loadFleetState(fleetPath, accounts);

    // Orchestrator A (ac01) MUST retain byte-for-byte reservation
    assert.equal(diskState.fleet["ac01"].status, "ocupado", "Excluded unit A must remain occupied");
    assert.deepEqual(
      diskState.fleet["ac01"].passenger,
      initialPassengerA,
      "Excluded unit A passenger must be byte-for-byte identical to pre-switch state",
    );
    assert.equal(
      JSON.stringify(diskState.fleet["ac01"]),
      initialAOnDiskRaw,
      "Full unit A representation on disk must match exactly",
    );

    // Candidate B (ac02) MUST be valid occupied orchestrator
    assert.equal(diskState.fleet["ac02"].status, "ocupado");
    assert.ok(diskState.fleet["ac02"].passenger);
    assert.equal(diskState.fleet["ac02"].passenger.type, "orchestrator");
    assert.equal(diskState.fleet["ac02"].passenger.sessionId, sessionId);
    assert.equal(diskState.fleet["ac02"].passenger.pid, pid);
  } finally {
    cleanupScratchDir(scratchDir);
  }
});

test("EXCLUDED RESERVATION: input model points to external/no-account with excludedAccounts[A] retains A byte-for-byte and load-balances candidate", () => {
  const scratchDir = createScratchDir("points-external");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");
  const accounts = ["ac01", "ac02"];
  const sessionId = "sess-orch-switch-ext";
  const pid = process.pid;

  setCachedTaxiQuota("ac01", { gemini5hPct: 80 });
  setCachedTaxiQuota("ac02", { gemini5hPct: 90 });

  try {
    const initialPassengerA: DcTaxiPassenger = {
      type: "orchestrator",
      sessionId,
      pid,
      model: "cpam/ac01/gemini-3.8-flash-high",
      taskLabel: "Sesión Principal (Orquestador)",
      plate: `DC-HOST-${pid}`,
      startedAt: Date.now() - 4000,
      heartbeatAt: Date.now() - 2000,
    };

    const initialState: DcTaxiFleetState = {
      fleet: {
        ac01: {
          account: "ac01",
          status: "ocupado",
          passenger: { ...initialPassengerA },
        },
        ac02: {
          account: "ac02",
          status: "libre",
          passenger: null,
        },
      },
      lastUpdated: Date.now() - 2000,
    };
    saveFleetState(initialState, fleetPath);

    const initialAOnDiskRaw = JSON.stringify(loadFleetState(fleetPath, accounts).fleet["ac01"]);

    // Model points to external/no-account provider (e.g., anthropic/claude-3-5-sonnet)
    const acquired = acquireOrchestratorTaxi(
      sessionId,
      "anthropic/claude-3-5-sonnet",
      fleetPath,
      pid,
      accounts,
      "gemini-3.8-flash-high",
      "cpam",
      ["ac01"],
    );

    assert.ok(acquired, "acquireOrchestratorTaxi must succeed finding free candidate ac02");
    assert.equal(acquired.account, "ac02");

    const diskState = loadFleetState(fleetPath, accounts);

    // Orchestrator A (ac01) reservation retained byte-for-byte
    assert.equal(diskState.fleet["ac01"].status, "ocupado");
    assert.deepEqual(diskState.fleet["ac01"].passenger, initialPassengerA);
    assert.equal(
      JSON.stringify(diskState.fleet["ac01"]),
      initialAOnDiskRaw,
      "Full unit A representation on disk must match exactly",
    );

    // Candidate ac02 occupied
    assert.equal(diskState.fleet["ac02"].status, "ocupado");
    assert.ok(diskState.fleet["ac02"].passenger);
    assert.equal(diskState.fleet["ac02"].passenger.sessionId, sessionId);
  } finally {
    cleanupScratchDir(scratchDir);
  }
});

test("EXCLUDED RESERVATION: when candidate is unavailable, returns null and retains A byte-for-byte", () => {
  const scratchDir = createScratchDir("candidate-unavailable");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");
  const accounts = ["ac01", "ac02"];
  const sessionId = "sess-orch-no-cand";
  const pid = process.pid;

  try {
    const initialPassengerA: DcTaxiPassenger = {
      type: "orchestrator",
      sessionId,
      pid,
      model: "cpam/ac01/gemini-3.8-flash-high",
      taskLabel: "Sesión Principal (Orquestador)",
      plate: `DC-HOST-${pid}`,
      startedAt: Date.now() - 6000,
      heartbeatAt: Date.now() - 1000,
    };

    // ac01 is occupied by orchestrator; ac02 is occupied by someone else (no candidate free)
    const initialState: DcTaxiFleetState = {
      fleet: {
        ac01: {
          account: "ac01",
          status: "ocupado",
          passenger: { ...initialPassengerA },
        },
        ac02: {
          account: "ac02",
          status: "ocupado",
          passenger: {
            type: "ephemeral_subagent",
            sessionId: "other-session",
            pid: process.pid,
            taskLabel: "Other work",
            plate: "DC-SUB-999",
            startedAt: Date.now(),
            heartbeatAt: Date.now(),
          },
        },
      },
      lastUpdated: Date.now() - 1000,
    };
    saveFleetState(initialState, fleetPath);

    const initialAOnDiskRaw = JSON.stringify(loadFleetState(fleetPath, accounts).fleet["ac01"]);

    // Attempt switch to ac02 while ac01 is excluded and ac02 is occupied
    const acquired = acquireOrchestratorTaxi(
      sessionId,
      "cpam/ac02/gemini-3.8-flash-high",
      fleetPath,
      pid,
      accounts,
      "gemini-3.8-flash-high",
      "cpam",
      ["ac01"],
    );

    assert.equal(acquired, null, "Acquisition must fail when no candidate is available");

    const diskState = loadFleetState(fleetPath, accounts);

    // Unit A must still be occupied and retained byte-for-byte
    assert.equal(diskState.fleet["ac01"].status, "ocupado");
    assert.deepEqual(diskState.fleet["ac01"].passenger, initialPassengerA);
    assert.equal(JSON.stringify(diskState.fleet["ac01"]), initialAOnDiskRaw);
  } finally {
    cleanupScratchDir(scratchDir);
  }
});

test("REGRESSION: Non-excluded prior lease cleanup still frees prior orchestrator taxi on account switch", () => {
  const scratchDir = createScratchDir("non-excluded-regression");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");
  const accounts = ["ac01", "ac02"];
  const sessionId = "sess-orch-switch-clean";
  const pid = process.pid;

  setCachedTaxiQuota("ac01", { gemini5hPct: 85 });
  setCachedTaxiQuota("ac02", { gemini5hPct: 85 });

  try {
    const initialState: DcTaxiFleetState = {
      fleet: {
        ac01: {
          account: "ac01",
          status: "ocupado",
          passenger: {
            type: "orchestrator",
            sessionId,
            pid,
            model: "cpam/ac01/gemini-3.8-flash-high",
            taskLabel: "Sesión Principal (Orquestador)",
            plate: `DC-HOST-${pid}`,
            startedAt: Date.now() - 3000,
            heartbeatAt: Date.now() - 1000,
          },
        },
        ac02: {
          account: "ac02",
          status: "libre",
          passenger: null,
        },
      },
      lastUpdated: Date.now() - 1000,
    };
    saveFleetState(initialState, fleetPath);

    // Switch to ac02 without excluding ac01 -> ac01 MUST be freed
    const acquired = acquireOrchestratorTaxi(
      sessionId,
      "cpam/ac02/gemini-3.8-flash-high",
      fleetPath,
      pid,
      accounts,
      "gemini-3.8-flash-high",
      "cpam",
      [], // no exclusions
    );

    assert.ok(acquired);
    assert.equal(acquired.account, "ac02");

    const diskState = loadFleetState(fleetPath, accounts);

    // ac01 was NOT excluded, so it must be cleaned up to libre
    assert.equal(diskState.fleet["ac01"].status, "libre", "Non-excluded prior unit must be cleaned up");
    assert.equal(diskState.fleet["ac01"].passenger, null);

    // ac02 occupied
    assert.equal(diskState.fleet["ac02"].status, "ocupado");
    assert.equal(diskState.fleet["ac02"].passenger?.sessionId, sessionId);
  } finally {
    cleanupScratchDir(scratchDir);
  }
});
