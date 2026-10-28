import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";

// DIRECTIVE: HOME isolation MUST be established BEFORE importing any project modules
// to guarantee blast radius zero and protect live ~/.pi/agent state.
const scratchHome = path.resolve(".test-build", `scratch-home-t1-${Date.now()}-${Math.random().toString(36).slice(2)}`);
fs.mkdirSync(scratchHome, { recursive: true });
process.env.HOME = scratchHome;

import test, { after } from "node:test";
import assert from "node:assert/strict";

import {
  prepareEphemeralAgent,
  cleanupEphemeralAgent,
  type EphemeralAgentLaunchPlan,
} from "../src/features/dc-agents/core/dc-ephemeral-manager.ts";
import {
  sweepBackgroundPlansOnce,
  activeBackgroundPlans,
} from "../src/features/dc-agents/tools/dc-ephemeral-tools.ts";
import {
  leaseTaxi,
  loadFleetState,
  saveFleetState,
  createInitialFleetState,
} from "../src/features/dc-agents/core/dc-taxi-dispatcher.ts";
import {
  loadTaxiTripHistory,
  recordTaxiTrip,
} from "../src/features/dc-agents/core/dc-taxi-history.ts";
import { readRecentTaxiLogs } from "../src/features/dc-agents/core/dc-taxi-logger.ts";

after(() => {
  try {
    fs.rmSync(scratchHome, { recursive: true, force: true });
  } catch {
    /* defensive */
  }
});

function createScratchArea(prefix: string): { dir: string; fleetPath: string; historyPath: string; tasksDir: string } {
  const dir = path.join(scratchHome, `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  const tasksDir = path.join(dir, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  const fleetPath = path.join(dir, "dc-taxis.json");
  const historyPath = path.join(dir, "dc-taxis-history.json");
  return { dir, fleetPath, historyPath, tasksDir };
}

test("FINDING 1 (RED): Sweeper must not heartbeat unproven worker when task file is missing, and must not kill/release it", () => {
  const { fleetPath, historyPath, tasksDir } = createScratchArea("finding1-missing");
  const accounts = ["ac01"];
  const fleetState = createInitialFleetState(accounts);
  const initialTimestamp = Date.now() - 30_000;

  fleetState.fleet["ac01"].status = "ocupado";
  fleetState.fleet["ac01"].passenger = {
    type: "ephemeral_subagent",
    sessionId: "sess-sweeper-1",
    pid: process.pid,
    plate: "DC-TEST-UNPROVEN",
    model: "gemini-3.8-flash-high",
    startedAt: initialTimestamp,
    heartbeatAt: initialTimestamp,
    agentName: "dc-sub-unproven",
  };
  saveFleetState(fleetState, fleetPath);

  const mockPlan: EphemeralAgentLaunchPlan = {
    ephemeralId: "unproven-1",
    agentName: "dc-sub-unproven",
    agentFilePath: path.join(scratchHome, "dc-sub-unproven.md"),
    leasedAccount: "ac01",
    fullModelRef: "cpam/ac01/gemini-3.8-flash-high",
    effectiveEffort: "high",
    tools: ["read"],
    mode: "background",
    plate: "DC-TEST-UNPROVEN",
  };

  // Missing task file: taskId is set but file does NOT exist in tasksDir
  const missingTaskId = "task-missing-never-created";
  activeBackgroundPlans.set(mockPlan.ephemeralId, {
    plan: mockPlan,
    sessionId: "sess-sweeper-1",
    startedAt: initialTimestamp,
    taskId: missingTaskId,
  });

  try {
    sweepBackgroundPlansOnce(tasksDir, fleetPath, historyPath);

    const fleetAfter = loadFleetState(fleetPath, accounts);

    // 1. MUST NOT heartbeat unproven worker: heartbeatAt must NOT have been updated!
    assert.equal(
      fleetAfter.fleet["ac01"].passenger?.heartbeatAt,
      initialTimestamp,
      "Sweeper must NOT heartbeat unproven worker when task file is missing",
    );

    // 2. MUST NOT assume terminated: still tracked in activeBackgroundPlans and unit still ocupado
    assert.equal(
      activeBackgroundPlans.has(mockPlan.ephemeralId),
      true,
      "Sweeper must NOT assume missing file proves terminated or delete active tracking",
    );
    assert.equal(
      fleetAfter.fleet["ac01"].status,
      "ocupado",
      "Sweeper must NOT release worker taxi when task file is missing",
    );

    // 3. Exact blocker reported in taxi log
    const logs = readRecentTaxiLogs(10);
    assert.ok(
      logs.some((l) => l.includes("TAXI_SWEEPER_CANNOT_RECLAIM") && l.includes("task_file_not_found")),
      "Sweeper must report exact blocker in taxi logs when worker cannot be safely reclaimed",
    );
  } finally {
    activeBackgroundPlans.delete(mockPlan.ephemeralId);
  }
});

test("FINDING 1 (RED): Sweeper must not heartbeat unproven worker when task file is unreadable JSON", () => {
  const { fleetPath, historyPath, tasksDir } = createScratchArea("finding1-unreadable");
  const accounts = ["ac01"];
  const fleetState = createInitialFleetState(accounts);
  const initialTimestamp = Date.now() - 30_000;

  fleetState.fleet["ac01"].status = "ocupado";
  fleetState.fleet["ac01"].passenger = {
    type: "ephemeral_subagent",
    sessionId: "sess-sweeper-corrupt",
    pid: process.pid,
    plate: "DC-TEST-CORRUPT",
    model: "gemini-3.8-flash-high",
    startedAt: initialTimestamp,
    heartbeatAt: initialTimestamp,
    agentName: "dc-sub-corrupt",
  };
  saveFleetState(fleetState, fleetPath);

  const mockPlan: EphemeralAgentLaunchPlan = {
    ephemeralId: "corrupt-1",
    agentName: "dc-sub-corrupt",
    agentFilePath: path.join(scratchHome, "dc-sub-corrupt.md"),
    leasedAccount: "ac01",
    fullModelRef: "cpam/ac01/gemini-3.8-flash-high",
    effectiveEffort: "high",
    tools: ["read"],
    mode: "background",
    plate: "DC-TEST-CORRUPT",
  };

  const corruptTaskId = "task-corrupt-json";
  fs.writeFileSync(path.join(tasksDir, `${corruptTaskId}.json`), "{ bad-json-structure-not-parsable", "utf8");

  activeBackgroundPlans.set(mockPlan.ephemeralId, {
    plan: mockPlan,
    sessionId: "sess-sweeper-corrupt",
    startedAt: initialTimestamp,
    taskId: corruptTaskId,
  });

  try {
    sweepBackgroundPlansOnce(tasksDir, fleetPath, historyPath);

    const fleetAfter = loadFleetState(fleetPath, accounts);

    // 1. MUST NOT heartbeat corrupt/unreadable task
    assert.equal(
      fleetAfter.fleet["ac01"].passenger?.heartbeatAt,
      initialTimestamp,
      "Sweeper must NOT heartbeat worker when task file is unreadable",
    );

    // 2. MUST NOT assume terminated: still in active tracking
    assert.equal(activeBackgroundPlans.has(mockPlan.ephemeralId), true);
    assert.equal(fleetAfter.fleet["ac01"].status, "ocupado");

    // 3. Exact blocker reported in taxi log
    const logs = readRecentTaxiLogs(10);
    assert.ok(
      logs.some((l) => l.includes("TAXI_SWEEPER_CANNOT_RECLAIM") && l.includes("task_file_unreadable")),
      "Sweeper must report task_file_unreadable blocker in taxi logs",
    );
  } finally {
    activeBackgroundPlans.delete(mockPlan.ephemeralId);
  }
});

test("FINDING 1: Sweeper preserves genuinely observed running task past 12 minutes and emits heartbeat", () => {
  const { fleetPath, historyPath, tasksDir } = createScratchArea("finding1-running");
  const accounts = ["ac01"];
  const fleetState = createInitialFleetState(accounts);
  const fifteenMinutesAgo = Date.now() - 15 * 60 * 1000;
  const initialHeartbeat = Date.now() - 20_000;

  fleetState.fleet["ac01"].status = "ocupado";
  fleetState.fleet["ac01"].passenger = {
    type: "ephemeral_subagent",
    sessionId: "sess-sweeper-running",
    pid: process.pid,
    plate: "DC-TEST-RUNNING",
    model: "gemini-3.8-flash-high",
    startedAt: fifteenMinutesAgo,
    heartbeatAt: initialHeartbeat,
    agentName: "dc-sub-running",
  };
  saveFleetState(fleetState, fleetPath);

  const mockPlan: EphemeralAgentLaunchPlan = {
    ephemeralId: "running-1",
    agentName: "dc-sub-running",
    agentFilePath: path.join(scratchHome, "dc-sub-running.md"),
    leasedAccount: "ac01",
    fullModelRef: "cpam/ac01/gemini-3.8-flash-high",
    effectiveEffort: "high",
    tools: ["read"],
    mode: "background",
    plate: "DC-TEST-RUNNING",
  };

  const runningTaskId = "task-running-genuinely";
  fs.writeFileSync(
    path.join(tasksDir, `${runningTaskId}.json`),
    JSON.stringify({
      task: {
        id: runningTaskId,
        status: "running",
        tokens: 4200,
      },
    }),
    "utf8",
  );

  activeBackgroundPlans.set(mockPlan.ephemeralId, {
    plan: mockPlan,
    sessionId: "sess-sweeper-running",
    startedAt: fifteenMinutesAgo,
    taskId: runningTaskId,
  });

  try {
    sweepBackgroundPlansOnce(tasksDir, fleetPath, historyPath);

    const fleetAfter = loadFleetState(fleetPath, accounts);

    // 1. Task genuinely running is preserved past 12 minutes
    assert.equal(activeBackgroundPlans.has(mockPlan.ephemeralId), true);
    assert.equal(fleetAfter.fleet["ac01"].status, "ocupado");

    // 2. Heartbeat IS updated
    const updatedHeartbeat = fleetAfter.fleet["ac01"].passenger?.heartbeatAt || 0;
    assert.ok(updatedHeartbeat > initialHeartbeat, "Heartbeat must be refreshed for genuinely running task");
  } finally {
    activeBackgroundPlans.delete(mockPlan.ephemeralId);
  }
});

test("FINDING 1: Authoritative termination via terminal status or dead PID cleanly reclaims task", () => {
  const { fleetPath, historyPath, tasksDir } = createScratchArea("finding1-auth-term");
  const accounts = ["ac01"];
  const fleetState = createInitialFleetState(accounts);
  const startedAt = Date.now() - 10_000;

  fleetState.fleet["ac01"].status = "ocupado";
  fleetState.fleet["ac01"].passenger = {
    type: "ephemeral_subagent",
    sessionId: "sess-sweeper-term",
    pid: process.pid,
    plate: "DC-TEST-TERM",
    model: "gemini-3.8-flash-high",
    startedAt,
    heartbeatAt: startedAt,
    agentName: "dc-sub-term",
  };
  saveFleetState(fleetState, fleetPath);

  const mockPlan: EphemeralAgentLaunchPlan = {
    ephemeralId: "term-1",
    agentName: "dc-sub-term",
    agentFilePath: path.join(scratchHome, "dc-sub-term.md"),
    leasedAccount: "ac01",
    fullModelRef: "cpam/ac01/gemini-3.8-flash-high",
    effectiveEffort: "high",
    tools: ["read"],
    mode: "background",
    plate: "DC-TEST-TERM",
  };

  const completedTaskId = "task-auth-completed";
  fs.writeFileSync(
    path.join(tasksDir, `${completedTaskId}.json`),
    JSON.stringify({
      task: {
        id: completedTaskId,
        status: "completed",
        tokens: 1500,
      },
    }),
    "utf8",
  );

  activeBackgroundPlans.set(mockPlan.ephemeralId, {
    plan: mockPlan,
    sessionId: "sess-sweeper-term",
    startedAt,
    taskId: completedTaskId,
  });

  try {
    sweepBackgroundPlansOnce(tasksDir, fleetPath, historyPath);

    // Reclaimed: removed from activeBackgroundPlans and unit is libre
    assert.equal(activeBackgroundPlans.has(mockPlan.ephemeralId), false);
    const fleetAfter = loadFleetState(fleetPath, accounts);
    assert.equal(fleetAfter.fleet["ac01"].status, "libre");
    assert.equal(fleetAfter.fleet["ac01"].passenger, null);

    // Trip recorded in history
    const history = loadTaxiTripHistory(10, historyPath);
    assert.equal(history.length, 1);
    assert.equal(history[0].status, "completed");
  } finally {
    activeBackgroundPlans.delete(mockPlan.ephemeralId);
  }
});

test("FINDING 2 (RED): Stale cleanup A -> B in same account and session must reject ownership, not modify fleet/history/counters or emit CLEANED", () => {
  const { fleetPath, historyPath } = createScratchArea("finding2-stale-cleanup");
  const accounts = ["ac01"];
  const sessionId = "sess-shared-account-and-session";

  // Step 1: Task A leases ac01
  const leaseA = leaseTaxi(
    {
      type: "ephemeral_subagent",
      sessionId,
      pid: process.pid,
      taskLabel: "Task A",
      plate: "DC-TASK-A",
      agentName: "dc-sub-task-a",
    },
    "ac01",
    fleetPath,
    300_000,
    accounts,
  );
  assert.ok(leaseA, "Task A must lease ac01");

  const planA: EphemeralAgentLaunchPlan = {
    ephemeralId: "task-a-uuid",
    agentName: "dc-sub-task-a",
    agentFilePath: path.join(scratchHome, "dc-sub-task-a.md"),
    leasedAccount: "ac01",
    fullModelRef: "cpam/ac01/gemini-3.8-flash-high",
    effectiveEffort: "high",
    tools: ["read"],
    mode: "task",
    plate: "DC-TASK-A",
  };

  // Step 2: Task A legitimately completes and calls cleanup
  const cleanResultA = cleanupEphemeralAgent(
    planA,
    {
      sessionId,
      startedAt: Date.now() - 5000,
      endedAt: Date.now() - 1000,
      status: "completed",
      taskId: "task-a-exec",
      tokens: { total: 1000 },
    },
    fleetPath,
    historyPath,
  );
  assert.equal(cleanResultA, true, "Legitimate cleanup of Task A must succeed");

  // Verify Task A was recorded in history
  const historyAfterA = loadTaxiTripHistory(10, historyPath);
  assert.equal(historyAfterA.length, 1, "Legitimate Task A completion must be recorded in history");
  assert.equal(historyAfterA[0].status, "completed");

  // Step 3: Now Task B leases ac01 with a new plate under the same session
  const leaseB = leaseTaxi(
    {
      type: "ephemeral_subagent",
      sessionId,
      pid: process.pid,
      taskLabel: "Task B",
      plate: "DC-TASK-B",
      agentName: "dc-sub-task-b",
    },
    "ac01",
    fleetPath,
    300_000,
    accounts,
  );
  assert.ok(leaseB, "Task B must lease ac01");

  const fleetWhileBActive = loadFleetState(fleetPath, accounts);
  assert.equal(fleetWhileBActive.fleet["ac01"].status, "ocupado");
  assert.equal(fleetWhileBActive.fleet["ac01"].passenger?.plate, "DC-TASK-B");

  // Step 4: Now a STALE duplicate cleanup attempt for Task A arrives
  // This must be REJECTED because ac01 now belongs to Task B (DC-TASK-B)
  const staleCleanResult = cleanupEphemeralAgent(
    planA,
    {
      sessionId,
      startedAt: Date.now() - 5000,
      endedAt: Date.now(),
      status: "completed",
      taskId: "task-a-exec-stale",
      tokens: { total: 9999 },
    },
    fleetPath,
    historyPath,
  );

  // 1. Rejected ownership must return false
  assert.equal(staleCleanResult, false, "Stale cleanup must report false (rejected ownership)");

  // 2. Fleet MUST NOT be changed: ac01 must remain ocupado by Task B with plate DC-TASK-B
  const fleetAfterStale = loadFleetState(fleetPath, accounts);
  assert.equal(fleetAfterStale.fleet["ac01"].status, "ocupado", "Fleet unit must remain ocupado by Task B");
  assert.equal(
    fleetAfterStale.fleet["ac01"].passenger?.plate,
    "DC-TASK-B",
    "Successor Task B plate identity must be strictly preserved",
  );

  // 3. History MUST NOT be mutated or duplicated: still exactly 1 record (Task A's original legitimate trip)
  const historyAfterStale = loadTaxiTripHistory(10, historyPath);
  assert.equal(
    historyAfterStale.length,
    1,
    "Stale cleanup must NOT add duplicate trip to history or modify counters",
  );
  assert.equal(
    historyAfterStale[0].tokens?.total,
    1000,
    "Legitimate trip accounting must NOT be overwritten with stale successor data",
  );

  // 4. Stale cleanup MUST NOT report successful cleanup log (EPHEMERAL_AGENT_CLEANED)
  const logs = readRecentTaxiLogs(15);
  const cleanedLogsForStale = logs.filter(
    (l) => l.includes("EPHEMERAL_AGENT_CLEANED") && l.includes("task-a-exec-stale"),
  );
  assert.equal(
    cleanedLogsForStale.length,
    0,
    "Stale cleanup MUST NOT emit EPHEMERAL_AGENT_CLEANED log",
  );

  // 5. Warning log for rejected ownership must be recorded
  assert.ok(
    logs.some((l) => l.includes("TAXI_RELEASE_PLATE_MISMATCH") || l.includes("TAXI_CLEANUP_OWNERSHIP_REJECTED")),
    "Rejection of stale cleanup must be logged with ownership mismatch warning",
  );
});

test("FINDING 1: Authoritative termination via dead worker PID reclaims task even if status was running", () => {
  const { fleetPath, historyPath, tasksDir } = createScratchArea("finding1-dead-pid");
  const accounts = ["ac01"];
  const fleetState = createInitialFleetState(accounts);
  const startedAt = Date.now() - 10_000;

  fleetState.fleet["ac01"].status = "ocupado";
  fleetState.fleet["ac01"].passenger = {
    type: "ephemeral_subagent",
    sessionId: "sess-sweeper-dead-pid",
    pid: process.pid,
    plate: "DC-TEST-DEADPID",
    model: "gemini-3.8-flash-high",
    startedAt,
    heartbeatAt: startedAt,
    agentName: "dc-sub-deadpid",
  };
  saveFleetState(fleetState, fleetPath);

  const mockPlan: EphemeralAgentLaunchPlan = {
    ephemeralId: "deadpid-1",
    agentName: "dc-sub-deadpid",
    agentFilePath: path.join(scratchHome, "dc-sub-deadpid.md"),
    leasedAccount: "ac01",
    fullModelRef: "cpam/ac01/gemini-3.8-flash-high",
    effectiveEffort: "high",
    tools: ["read"],
    mode: "background",
    plate: "DC-TEST-DEADPID",
  };

  // Find a definitely dead PID (e.g. 9999999 on Linux)
  const deadPid = 9999999;
  const deadTaskId = "task-auth-dead-pid";
  fs.writeFileSync(
    path.join(tasksDir, `${deadTaskId}.json`),
    JSON.stringify({
      task: {
        id: deadTaskId,
        status: "running", // file says running, but worker process is dead in OS
        pid: deadPid,
        tokens: 300,
      },
    }),
    "utf8",
  );

  activeBackgroundPlans.set(mockPlan.ephemeralId, {
    plan: mockPlan,
    sessionId: "sess-sweeper-dead-pid",
    startedAt,
    taskId: deadTaskId,
  });

  try {
    sweepBackgroundPlansOnce(tasksDir, fleetPath, historyPath);

    // Reclaimed authoritatively because OS confirmed worker PID is dead
    assert.equal(activeBackgroundPlans.has(mockPlan.ephemeralId), false);
    const fleetAfter = loadFleetState(fleetPath, accounts);
    assert.equal(fleetAfter.fleet["ac01"].status, "libre");

    const history = loadTaxiTripHistory(10, historyPath);
    assert.equal(history.length, 1);
    assert.equal(history[0].status, "failed");
  } finally {
    activeBackgroundPlans.delete(mockPlan.ephemeralId);
  }
});

test("FINDING 2: Stale cleanup when unit is libre rejects ownership and records no history", () => {
  const { fleetPath, historyPath } = createScratchArea("finding2-libre-stale");
  const accounts = ["ac01"];
  const fleetState = createInitialFleetState(accounts);
  saveFleetState(fleetState, fleetPath); // ac01 is libre

  const planA: EphemeralAgentLaunchPlan = {
    ephemeralId: "task-libre-uuid",
    agentName: "dc-sub-libre",
    agentFilePath: path.join(scratchHome, "dc-sub-libre.md"),
    leasedAccount: "ac01",
    fullModelRef: "cpam/ac01/gemini-3.8-flash-high",
    effectiveEffort: "high",
    tools: ["read"],
    mode: "task",
    plate: "DC-TASK-LIBRE",
  };

  const cleanResult = cleanupEphemeralAgent(
    planA,
    {
      sessionId: "sess-libre",
      startedAt: Date.now() - 5000,
      endedAt: Date.now(),
      status: "completed",
      taskId: "task-libre",
    },
    fleetPath,
    historyPath,
  );

  assert.equal(cleanResult, false, "Cleanup of non-occupied taxi must return false");
  const history = loadTaxiTripHistory(10, historyPath);
  assert.equal(history.length, 0, "No trip must be recorded when taxi is not occupied");
});

