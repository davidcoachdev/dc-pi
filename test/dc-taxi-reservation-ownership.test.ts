import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  loadFleetState,
  saveFleetState,
  leaseTaxi,
  releaseTaxi,
  heartbeatTaxi,
  updateTaxiPassengerUsage,
  acquireOrchestratorTaxi,
  releaseOrchestratorTaxi,
  reapAbandonedTaxis,
  withFleetLock,
} from "../src/features/dc-agents/core/dc-taxi-dispatcher.ts";

import {
  prepareEphemeralAgent,
  cleanupEphemeralAgent,
} from "../src/features/dc-agents/core/dc-ephemeral-manager.ts";

import {
  activeBackgroundPlans,
  sweepBackgroundPlansOnce,
} from "../src/features/dc-agents/tools/dc-ephemeral-tools.ts";

import {
  executeTaxiHandover,
} from "../src/features/dc-agents/core/dc-taxi-supervisor.ts";

function createScratchDir(name: string): string {
  const dir = path.resolve(".test-build", `scratch-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

test("RULE 1: Stale cleanup A -> B same account/session: mismatch unchanged, matching owner accepted", () => {
  const scratchDir = createScratchDir("rule1-ownership");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");
  const accounts = ["ac01", "ac02"];

  try {
    // 1. Task A leases ac01 with plate DC-TASK-A
    const leaseA = leaseTaxi(
      {
        type: "ephemeral_subagent",
        sessionId: "sess-shared-123",
        pid: process.pid,
        taskLabel: "Task A",
        plate: "DC-TASK-A",
      },
      "ac01",
      fleetPath,
      300_000,
      accounts,
    );
    assert.ok(leaseA);
    assert.equal(leaseA.account, "ac01");
    assert.equal(leaseA.unit.passenger?.plate, "DC-TASK-A");

    // Simulate ac01 re-assigned to Task B (same account, same session) with plate DC-TASK-B
    withFleetLock(fleetPath, () => {
      const state = loadFleetState(fleetPath, accounts);
      state.fleet["ac01"].passenger = {
        type: "ephemeral_subagent",
        sessionId: "sess-shared-123",
        pid: process.pid,
        taskLabel: "Task B",
        plate: "DC-TASK-B",
        startedAt: Date.now(),
        heartbeatAt: Date.now(),
      };
      saveFleetState(state, fleetPath);
    });

    // 2. Stale Task A attempts to release ac01 passing its own plate DC-TASK-A
    const staleRelease = releaseTaxi(
      "ac01",
      "sess-shared-123",
      fleetPath,
      accounts,
      undefined,
      { plate: "DC-TASK-A" },
    );
    assert.equal(staleRelease, false, "Stale Task A release MUST be rejected due to plate mismatch");

    // Fleet state MUST remain occupied by Task B
    const fleetAfterStale = loadFleetState(fleetPath, accounts);
    assert.equal(fleetAfterStale.fleet["ac01"].status, "ocupado");
    assert.equal(fleetAfterStale.fleet["ac01"].passenger?.plate, "DC-TASK-B");

    // 3. Legitimate Task B releases ac01 passing DC-TASK-B
    const validRelease = releaseTaxi(
      "ac01",
      "sess-shared-123",
      fleetPath,
      accounts,
      undefined,
      { plate: "DC-TASK-B" },
    );
    assert.equal(validRelease, true, "Matching owner Task B release MUST succeed");

    const fleetAfterValid = loadFleetState(fleetPath, accounts);
    assert.equal(fleetAfterValid.fleet["ac01"].status, "libre");
    assert.equal(fleetAfterValid.fleet["ac01"].passenger, null);
  } finally {
    cleanupScratchDir(scratchDir);
  }
});

test("RULE 2: Stale task cannot heartbeat another lease", () => {
  const scratchDir = createScratchDir("rule2-heartbeat");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");
  const accounts = ["ac01"];

  try {
    const leaseB = leaseTaxi(
      {
        type: "ephemeral_subagent",
        sessionId: "sess-shared-123",
        pid: process.pid,
        taskLabel: "Task B",
        plate: "DC-TASK-B",
      },
      "ac01",
      fleetPath,
      300_000,
      accounts,
    );
    assert.ok(leaseB);
    const initialHeartbeat = leaseB.unit.passenger?.heartbeatAt || 0;

    // Stale Task A attempts heartbeat on ac01 with plate DC-TASK-A
    const staleHeartbeat = heartbeatTaxi("ac01", fleetPath, { plate: "DC-TASK-A" });
    assert.equal(staleHeartbeat, false, "Stale task heartbeat MUST be rejected on plate mismatch");

    const stateAfterStale = loadFleetState(fleetPath, accounts);
    assert.equal(stateAfterStale.fleet["ac01"].passenger?.heartbeatAt, initialHeartbeat);

    // Matching Task B emits heartbeat
    const validHeartbeat = heartbeatTaxi("ac01", fleetPath, { plate: "DC-TASK-B" });
    assert.equal(validHeartbeat, true, "Matching owner heartbeat MUST succeed");

    const stateAfterValid = loadFleetState(fleetPath, accounts);
    assert.ok(stateAfterValid.fleet["ac01"].passenger!.heartbeatAt >= initialHeartbeat);
  } finally {
    cleanupScratchDir(scratchDir);
  }
});

test("RULE 3: Stale task cannot update usage of another lease", () => {
  const scratchDir = createScratchDir("rule3-usage");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");
  const accounts = ["ac01"];

  try {
    leaseTaxi(
      {
        type: "ephemeral_subagent",
        sessionId: "sess-shared-123",
        pid: process.pid,
        taskLabel: "Task B",
        plate: "DC-TASK-B",
      },
      "ac01",
      fleetPath,
      300_000,
      accounts,
    );

    // Stale Task A attempts to update usage with plate DC-TASK-A
    const staleUsage = updateTaxiPassengerUsage("ac01", 75000, 0.45, fleetPath, { plate: "DC-TASK-A" });
    assert.equal(staleUsage, false, "Stale task usage update MUST be rejected on plate mismatch");

    const stateAfterStale = loadFleetState(fleetPath, accounts);
    assert.equal(stateAfterStale.fleet["ac01"].passenger?.tokens, undefined);

    // Matching Task B updates usage
    const validUsage = updateTaxiPassengerUsage("ac01", 75000, 0.45, fleetPath, { plate: "DC-TASK-B" });
    assert.equal(validUsage, true, "Matching owner usage update MUST succeed");

    const stateAfterValid = loadFleetState(fleetPath, accounts);
    assert.equal(stateAfterValid.fleet["ac01"].passenger?.tokens, 75000);
    assert.equal(stateAfterValid.fleet["ac01"].passenger?.cost, 0.45);
  } finally {
    cleanupScratchDir(scratchDir);
  }
});

test("RULE 4: Stale task cannot handover another lease", () => {
  const scratchDir = createScratchDir("rule4-handover");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");
  const tasksDir = path.join(scratchDir, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  const accounts = ["ac01", "ac02"];

  try {
    leaseTaxi(
      {
        type: "ephemeral_subagent",
        sessionId: "sess-shared-123",
        pid: process.pid,
        taskLabel: "Task B",
        plate: "DC-TASK-B",
      },
      "ac01",
      fleetPath,
      300_000,
      accounts,
    );

    // Stale Task A attempts to trigger handover for ac01 using plate DC-TASK-A
    const staleHandover = executeTaxiHandover({
      previousAccount: "ac01",
      sessionId: "sess-shared-123",
      originalTaskId: "task-stale-A",
      plate: "DC-TASK-A",
      fleetPath,
      tasksDir,
      allowedAccounts: accounts,
    });

    assert.equal(staleHandover.success, false, "Stale task handover MUST fail due to plate mismatch");

    const fleetAfterStale = loadFleetState(fleetPath, accounts);
    assert.equal(fleetAfterStale.fleet["ac01"].status, "ocupado");
    assert.equal(fleetAfterStale.fleet["ac01"].passenger?.plate, "DC-TASK-B");
    assert.equal(fleetAfterStale.fleet["ac02"].status, "libre");
  } finally {
    cleanupScratchDir(scratchDir);
  }
});

test("RULE 5: Long running background worker is preserved beyond 12 minutes", () => {
  const scratchDir = createScratchDir("rule5-timeout");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");
  const tasksDir = path.join(scratchDir, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  const accounts = ["ac01", "ac02"];

  try {
    // Write task file indicating status === "running"
    const taskId = "task-long-running-99";
    const taskFilePath = path.join(tasksDir, `${taskId}.json`);
    fs.writeFileSync(taskFilePath, JSON.stringify({ task: { status: "running", tokens: 1000 } }));

    const lease = leaseTaxi(
      {
        type: "ephemeral_subagent",
        sessionId: "sess-long-run",
        pid: process.pid,
        taskLabel: "Long running worker",
        plate: "DC-LONG-RUN",
      },
      "ac01",
      fleetPath,
      300_000,
      accounts,
    );
    assert.ok(lease);

    // Register in activeBackgroundPlans with startedAt 15 minutes ago
    const startedAt15MinAgo = Date.now() - 15 * 60 * 1000;
    activeBackgroundPlans.set("long-plan-1", {
      plan: {
        ephemeralId: "long1",
        agentName: "dc-sub-long-1",
        agentFilePath: path.join(scratchDir, "agent.md"),
        leasedAccount: "ac01",
        fullModelRef: "cpam/ac01/gemini-3.8-flash-high",
        effectiveEffort: "high",
        tools: [],
        mode: "background",
        plate: "DC-LONG-RUN",
      },
      sessionId: "sess-long-run",
      startedAt: startedAt15MinAgo,
      taskId,
    });

    // Run sweepBackgroundPlansOnce
    sweepBackgroundPlansOnce(tasksDir, fleetPath);

    // The long running task MUST NOT be reaped because it is still 'running'
    assert.equal(activeBackgroundPlans.has("long-plan-1"), true, "Running task must remain tracked in activeBackgroundPlans");
    const fleetAfterSweep = loadFleetState(fleetPath, accounts);
    assert.equal(fleetAfterSweep.fleet["ac01"].status, "ocupado", "Running task taxi must NOT be released merely because 12 min elapsed");
  } finally {
    activeBackgroundPlans.delete("long-plan-1");
    cleanupScratchDir(scratchDir);
  }
});

test("RULE 6: Orchestrator ownership consistency (session + PID)", () => {
  const scratchDir = createScratchDir("rule6-orchestrator");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");
  const accounts = ["ac01", "ac02"];

  try {
    // Acquire orchestrator taxi for Terminal 1 (sess-orch-1, PID 1111)
    const acquired = acquireOrchestratorTaxi(
      "sess-orch-1",
      "cpam/ac01/gemini-3.8-flash-high",
      fleetPath,
      1111,
      accounts,
    );
    assert.ok(acquired);
    assert.equal(acquired.account, "ac01");

    // Attempt release with matching PID but mismatched session
    const mismatchSession = releaseTaxi("ac01", "sess-orch-imposter", fleetPath, accounts, undefined, { pid: 1111 });
    assert.equal(mismatchSession, false, "Release with mismatched session MUST fail for orchestrator");

    // Attempt release with matching session but mismatched PID
    const mismatchPid = releaseTaxi("ac01", "sess-orch-1", fleetPath, accounts, undefined, { pid: 9999 });
    assert.equal(mismatchPid, false, "Release with mismatched PID MUST fail for orchestrator");

    // releaseOrchestratorTaxi with different PID or session must NOT release Terminal 1
    releaseOrchestratorTaxi("sess-orch-imposter", 1111, fleetPath, accounts);
    let state = loadFleetState(fleetPath, accounts);
    assert.equal(state.fleet["ac01"].status, "ocupado");

    releaseOrchestratorTaxi("sess-orch-1", 9999, fleetPath, accounts);
    state = loadFleetState(fleetPath, accounts);
    assert.equal(state.fleet["ac01"].status, "ocupado");

    // Matching session AND PID releases orchestrator
    releaseOrchestratorTaxi("sess-orch-1", 1111, fleetPath, accounts);
    state = loadFleetState(fleetPath, accounts);
    assert.equal(state.fleet["ac01"].status, "libre");
    assert.equal(state.fleet["ac01"].passenger, null);
  } finally {
    cleanupScratchDir(scratchDir);
  }
});

test("RULE 7: EphemeralAgentLaunchPlan propagates plate and protects cleanup against stale release", () => {
  const scratchDir = createScratchDir("rule7-ephemeral-plate");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");
  const accounts = ["ac01", "ac02"];

  try {
    // Initialize fleet
    saveFleetState(loadFleetState(fleetPath, accounts), fleetPath);

    // Mock plan A
    const planA = {
      ephemeralId: "planA",
      agentName: "dc-sub-worker-A",
      agentFilePath: path.join(scratchDir, "dc-sub-worker-A.md"),
      leasedAccount: "ac01",
      fullModelRef: "cpam/ac01/gemini-3.8-flash-high",
      effectiveEffort: "high" as const,
      tools: [],
      mode: "task" as const,
      plate: "DC-PL-AAA",
    };
    fs.writeFileSync(planA.agentFilePath, "# Agent A", "utf8");

    // Unit ac01 is leased with plate DC-PL-AAA
    leaseTaxi(
      {
        type: "ephemeral_subagent",
        sessionId: "sess-same",
        pid: process.pid,
        agentName: planA.agentName,
        plate: planA.plate,
      },
      "ac01",
      fleetPath,
      300_000,
      accounts,
    );

    // Now simulate that unit ac01 was re-assigned to Plan B (same session, plate DC-PL-BBB)
    withFleetLock(fleetPath, () => {
      const state = loadFleetState(fleetPath, accounts);
      state.fleet["ac01"].passenger = {
        type: "ephemeral_subagent",
        sessionId: "sess-same",
        pid: process.pid,
        agentName: "dc-sub-worker-B",
        plate: "DC-PL-BBB",
        startedAt: Date.now(),
        heartbeatAt: Date.now(),
      };
      saveFleetState(state, fleetPath);
    });

    // Plan A runs cleanupEphemeralAgent
    cleanupEphemeralAgent(
      planA,
      {
        sessionId: "sess-same",
        startedAt: Date.now() - 5000,
        endedAt: Date.now(),
        status: "completed",
      },
      fleetPath,
    );

    // ac01 MUST still be ocupado by Plan B
    let state = loadFleetState(fleetPath, accounts);
    assert.equal(state.fleet["ac01"].status, "ocupado");
    assert.equal(state.fleet["ac01"].passenger?.plate, "DC-PL-BBB");

    // Plan B runs cleanupEphemeralAgent
    const planB = {
      ...planA,
      ephemeralId: "planB",
      agentName: "dc-sub-worker-B",
      agentFilePath: path.join(scratchDir, "dc-sub-worker-B.md"),
      plate: "DC-PL-BBB",
    };
    fs.writeFileSync(planB.agentFilePath, "# Agent B", "utf8");

    cleanupEphemeralAgent(
      planB,
      {
        sessionId: "sess-same",
        startedAt: Date.now() - 2000,
        endedAt: Date.now(),
        status: "completed",
      },
      fleetPath,
    );

    // ac01 is now freed
    state = loadFleetState(fleetPath, accounts);
    assert.equal(state.fleet["ac01"].status, "libre");
    assert.equal(state.fleet["ac01"].passenger, null);
  } finally {
    cleanupScratchDir(scratchDir);
  }
});

