import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";

// HOME isolation MUST be applied BEFORE any project modules are loaded.
const scratchHome = path.resolve(".test-build", `scratch-home-recovery-${Date.now()}-${Math.random().toString(36).slice(2)}`);
fs.mkdirSync(scratchHome, { recursive: true });
process.env.HOME = scratchHome;

import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  loadFleetState,
  saveFleetState,
  sendTaxiToWorkshop,
  repairTaxiFromWorkshop,
  withFleetLock,
} from "../src/features/dc-agents/core/dc-taxi-dispatcher.ts";

import {
  clearTaxiQuotaCache,
  getCachedTaxiQuota,
  type DcTaxiQuotaDiagnosticResult,
  UNIT_AMBIGUITY_NOTE,
} from "../src/features/dc-agents/core/dc-taxi-quota.ts";

import {
  TaxiWorkshopCoordinator,
  reconcileWorkshopFleet,
  type TaxiWorkshopRecoveryOptions,
  type TaxiWorkshopReconcileResult,
} from "../src/features/dc-agents/core/dc-taxi-workshop.ts";

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
  const dir = path.resolve(".test-build", `scratch-ws-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

function initFleetWithAccounts(fleetPath: string, accounts: string[]): void {
  const fleet: Record<string, any> = {};
  for (const ac of accounts) {
    fleet[ac] = {
      account: ac,
      status: "libre",
      passenger: null,
    };
  }
  saveFleetState({ fleet, lastUpdated: Date.now() }, fleetPath);
}

function makeDiagnosticResult(
  account: string,
  overrides: Partial<DcTaxiQuotaDiagnosticResult> = {},
): DcTaxiQuotaDiagnosticResult {
  const gemini5h = overrides.gemini5hPct !== undefined ? overrides.gemini5hPct : 85;
  const geminiWeekly = overrides.geminiWeeklyPct !== undefined ? overrides.geminiWeeklyPct : 90;
  const claude5h = overrides.claude5hPct !== undefined ? overrides.claude5hPct : null;
  const claudeWeekly = overrides.claudeWeeklyPct !== undefined ? overrides.claudeWeeklyPct : null;

  const candidates = [gemini5h, geminiWeekly, claude5h, claudeWeekly].filter(
    (v): v is number => typeof v === "number",
  );
  const effectivePct = overrides.effectivePct !== undefined
    ? overrides.effectivePct
    : candidates.length > 0 ? Math.min(...candidates) : null;

  return {
    account,
    gemini5hPct: gemini5h,
    geminiWeeklyPct: geminiWeekly,
    claude5hPct: claude5h,
    claudeWeeklyPct: claudeWeekly,
    resetTimeIso: overrides.resetTimeIso,
    lastChecked: overrides.lastChecked ?? Date.now(),
    isValid: true,
    effectivePct,
    recognizedEntriesCount: 2,
    rawEntriesCount: 2,
    unitAmbiguityNote: UNIT_AMBIGUITY_NOTE,
    ...overrides,
  };
}

test("RULE 1: Late response after new fault MUST NOT repair changed workshop generation", async () => {
  const scratchDir = createScratchDir("late-response");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");
  const accounts = ["ac01"];
  initFleetWithAccounts(fleetPath, accounts);

  try {
    // 1. Send ac01 to workshop for initial auth fault
    sendTaxiToWorkshop("ac01", "HTTP 401 token expired", fleetPath, accounts);
    const initialFleet = loadFleetState(fleetPath, accounts);
    const g1WorkshopSince = initialFleet.fleet["ac01"].workshopSince!;
    assert.ok(g1WorkshopSince > 0, "Initial workshop entry must have workshopSince generation");

    // 2. Setup deferred mock probe that hangs until we trigger it
    let resolveProbe!: (value: DcTaxiQuotaDiagnosticResult) => void;
    const probePromise = new Promise<DcTaxiQuotaDiagnosticResult>((resolve) => {
      resolveProbe = resolve;
    });

    const coordinator = new TaxiWorkshopCoordinator({
      fleetPath,
      allowedAccounts: accounts,
      probeDiagnostic: async () => probePromise,
    });

    // 3. Start reconciliation (inflight probe starts for g1)
    const reconcilePromise = coordinator.reconcileWorkshopUnits();

    // Small yield to let async probe task initiate
    await new Promise((r) => setImmediate(r));

    // 4. While probe is inflight, a NEW FAULT occurs for ac01
    sendTaxiToWorkshop("ac01", "HTTP 403 quota revoked", fleetPath, accounts);
    const fleetAfterNewFault = loadFleetState(fleetPath, accounts);
    const g2WorkshopSince = fleetAfterNewFault.fleet["ac01"].workshopSince!;
    assert.ok(
      g2WorkshopSince > g1WorkshopSince,
      `New fault must have newer generation: ${g2WorkshopSince} > ${g1WorkshopSince}`,
    );

    // 5. Probe for g1 now resolves with healthy response
    resolveProbe(makeDiagnosticResult("ac01", { gemini5hPct: 80 }));
    const result = await reconcilePromise;

    // 6. Verification: ac01 MUST remain in workshop with the NEW fault reason and g2 generation
    const finalFleet = loadFleetState(fleetPath, accounts);
    assert.equal(finalFleet.fleet["ac01"].status, "en_taller", "ac01 must remain en_taller");
    assert.equal(
      finalFleet.fleet["ac01"].workshopReason,
      "HTTP 403 quota revoked",
      "Workshop reason must remain the new fault",
    );
    assert.equal(finalFleet.fleet["ac01"].workshopSince, g2WorkshopSince);
    assert.ok(
      !result.repairedAccounts.includes("ac01"),
      "Stale response must not be recorded as repaired",
    );
  } finally {
    cleanupScratchDir(scratchDir);
  }
});

test("RULE 2: Empty or invalid payload / probe errors leave workshop unchanged", async () => {
  const scratchDir = createScratchDir("invalid-payload");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");
  const accounts = ["ac02"];
  initFleetWithAccounts(fleetPath, accounts);

  try {
    sendTaxiToWorkshop("ac02", "Initial 500 failure", fleetPath, accounts);
    const stateBefore = loadFleetState(fleetPath, accounts);
    const initialSince = stateBefore.fleet["ac02"].workshopSince;

    // Probe rejects with validation error or network failure
    const coordinator = new TaxiWorkshopCoordinator({
      fleetPath,
      allowedAccounts: accounts,
      probeDiagnostic: async () => {
        throw new Error("Invalid quota payload: entries empty");
      },
    });

    const result = await coordinator.reconcileWorkshopUnits();

    assert.equal(result.repairedAccounts.length, 0, "No accounts repaired on invalid payload");
    const stateAfter = loadFleetState(fleetPath, accounts);
    assert.equal(stateAfter.fleet["ac02"].status, "en_taller", "Status must remain en_taller");
    assert.equal(stateAfter.fleet["ac02"].workshopReason, "Initial 500 failure");
    assert.equal(stateAfter.fleet["ac02"].workshopSince, initialSince);
  } finally {
    cleanupScratchDir(scratchDir);
  }
});

test("RULE 3: Low quota recovery (<5%) transitions to recargando, not staying workshop and not libre", async () => {
  const scratchDir = createScratchDir("low-quota");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");
  const accounts = ["ac03"];
  initFleetWithAccounts(fleetPath, accounts);

  try {
    sendTaxiToWorkshop("ac03", "Auth expired", fleetPath, accounts);

    // Mock probe returns healthy authentication but low quota (3% < 5%)
    const coordinator = new TaxiWorkshopCoordinator({
      fleetPath,
      allowedAccounts: accounts,
      probeDiagnostic: async () => makeDiagnosticResult("ac03", {
        gemini5hPct: 3,
        geminiWeeklyPct: 20,
        effectivePct: 3,
      }),
    });

    const result = await coordinator.reconcileWorkshopUnits();

    assert.ok(result.repairedAccounts.includes("ac03"), "ac03 repaired from workshop");
    const stateAfter = loadFleetState(fleetPath, accounts);
    assert.equal(
      stateAfter.fleet["ac03"].status,
      "recargando",
      "Low quota unit MUST transition to 'recargando', NOT 'en_taller' and NOT 'libre'",
    );
    assert.equal(stateAfter.fleet["ac03"].workshopReason, undefined);
    assert.equal(stateAfter.fleet["ac03"].workshopSince, undefined);
  } finally {
    cleanupScratchDir(scratchDir);
  }
});

test("RULE 4: Healthy sufficient quota (>=5%) transitions to libre (no universal >=60 gate)", async () => {
  const scratchDir = createScratchDir("sufficient-quota");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");
  const accounts = ["ac04"];
  initFleetWithAccounts(fleetPath, accounts);

  try {
    sendTaxiToWorkshop("ac04", "Auth expired", fleetPath, accounts);

    // 25% is sufficient (>= 5%) and must transition directly to 'libre' without requiring >= 60%
    const coordinator = new TaxiWorkshopCoordinator({
      fleetPath,
      allowedAccounts: accounts,
      probeDiagnostic: async () => makeDiagnosticResult("ac04", {
        gemini5hPct: 25,
        geminiWeeklyPct: 50,
        effectivePct: 25,
      }),
    });

    const result = await coordinator.reconcileWorkshopUnits();

    assert.ok(result.repairedAccounts.includes("ac04"));
    const stateAfter = loadFleetState(fleetPath, accounts);
    assert.equal(
      stateAfter.fleet["ac04"].status,
      "libre",
      "Sufficient quota (25%) MUST transition to 'libre' (no universal >=60 repair gate)",
    );
  } finally {
    cleanupScratchDir(scratchDir);
  }
});

test("RULE 5: Inflight deduplication prevents duplicate concurrent probes on same account", async () => {
  const scratchDir = createScratchDir("inflight-dedup");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");
  const accounts = ["ac05"];
  initFleetWithAccounts(fleetPath, accounts);

  try {
    sendTaxiToWorkshop("ac05", "Auth timeout", fleetPath, accounts);

    let probeCalls = 0;
    let resolveProbe!: (value: DcTaxiQuotaDiagnosticResult) => void;
    const probePromise = new Promise<DcTaxiQuotaDiagnosticResult>((resolve) => {
      resolveProbe = resolve;
    });

    const coordinator = new TaxiWorkshopCoordinator({
      fleetPath,
      allowedAccounts: accounts,
      probeDiagnostic: async () => {
        probeCalls++;
        return probePromise;
      },
    });

    // Start first reconcile (probe begins and becomes inflight)
    const rec1 = coordinator.reconcileWorkshopUnits();

    // Small yield
    await new Promise((r) => setImmediate(r));

    // Start second reconcile while probe is still inflight
    const rec2 = coordinator.reconcileWorkshopUnits();

    // Verify probe function was called ONLY ONCE
    assert.equal(probeCalls, 1, "Probe function MUST be called only once due to inflight deduplication");

    // Complete probe
    resolveProbe(makeDiagnosticResult("ac05", { gemini5hPct: 80 }));
    const [res1, res2] = await Promise.all([rec1, rec2]);

    assert.ok(res1.attemptedAccounts.includes("ac05"));
    assert.ok(res2.skippedAccounts.includes("ac05"), "Second concurrent call must report ac05 as skipped");
  } finally {
    cleanupScratchDir(scratchDir);
  }
});

test("RULE 6: Cooldown with repeated lifecycle calls enforces bounded retry tracking", async () => {
  const scratchDir = createScratchDir("cooldown-retry");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");
  const accounts = ["ac06"];
  initFleetWithAccounts(fleetPath, accounts);

  try {
    sendTaxiToWorkshop("ac06", "Network failure", fleetPath, accounts);

    let probeCalls = 0;
    let currentTime = 1000;

    const coordinator = new TaxiWorkshopCoordinator({
      fleetPath,
      allowedAccounts: accounts,
      cooldownMs: 5_000,
      now: () => currentTime,
      probeDiagnostic: async () => {
        probeCalls++;
        throw new Error("HTTP 503 Service Unavailable");
      },
    });

    // 1. First lifecycle call: probe runs and fails
    const res1 = await coordinator.reconcileWorkshopUnits();
    assert.equal(probeCalls, 1, "First attempt should call probe");
    assert.equal(res1.attemptedAccounts.length, 1);

    // 2. Immediate second lifecycle call at t=2000 (within cooldownMs of 5000): MUST SKIP
    currentTime = 2000;
    const res2 = await coordinator.reconcileWorkshopUnits();
    assert.equal(probeCalls, 1, "Immediate subsequent call MUST NOT invoke probe (in cooldown)");
    assert.ok(res2.skippedAccounts.includes("ac06"), "ac06 must be in skippedAccounts");

    // 3. Third lifecycle call at t=4000 (still within cooldown): MUST SKIP
    currentTime = 4000;
    const res3 = await coordinator.reconcileWorkshopUnits();
    assert.equal(probeCalls, 1, "Call before cooldown expiry MUST NOT invoke probe");

    // 4. Fourth lifecycle call at t=7000 (cooldown expired: 7000 - 1000 >= 5000): MUST RETRY
    currentTime = 7000;
    const res4 = await coordinator.reconcileWorkshopUnits();
    assert.equal(probeCalls, 2, "Call after cooldown expiry MUST retry probe");
    assert.equal(res4.attemptedAccounts.length, 1);
  } finally {
    cleanupScratchDir(scratchDir);
  }
});

test("RULE 7: Dispose prevents any post-close state and cache mutation", async () => {
  const scratchDir = createScratchDir("dispose-mutation");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");
  const accounts = ["ac07"];
  initFleetWithAccounts(fleetPath, accounts);

  try {
    sendTaxiToWorkshop("ac07", "Fatal 401", fleetPath, accounts);

    let resolveProbe!: (value: DcTaxiQuotaDiagnosticResult) => void;
    const probePromise = new Promise<DcTaxiQuotaDiagnosticResult>((resolve) => {
      resolveProbe = resolve;
    });

    const coordinator = new TaxiWorkshopCoordinator({
      fleetPath,
      allowedAccounts: accounts,
      probeDiagnostic: async () => probePromise,
    });

    const recPromise = coordinator.reconcileWorkshopUnits();
    await new Promise((r) => setImmediate(r));

    // Dispose coordinator while probe is inflight
    coordinator.dispose();
    assert.equal(coordinator.isDisposed(), true);

    // Now let probe resolve
    resolveProbe(makeDiagnosticResult("ac07", { gemini5hPct: 95 }));
    await recPromise;

    // Verify: Fleet state MUST NOT be mutated (remains en_taller)
    const fleetState = loadFleetState(fleetPath, accounts);
    assert.equal(fleetState.fleet["ac07"].status, "en_taller", "Disposed coordinator MUST NOT repair fleet");

    // Verify: Subsequent calls on disposed coordinator do nothing
    const resAfterDispose = await coordinator.reconcileWorkshopUnits();
    assert.equal(resAfterDispose.inspectedCount, 0);
  } finally {
    cleanupScratchDir(scratchDir);
  }
});

test("RULE 8: Successive same-millisecond workshop events cannot share recovery generation", () => {
  const scratchDir = createScratchDir("monotonic-since");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");
  const accounts = ["ac08"];
  initFleetWithAccounts(fleetPath, accounts);

  try {
    // Call sendTaxiToWorkshop twice rapidly in the same synchronous tick
    sendTaxiToWorkshop("ac08", "Fault 1", fleetPath, accounts);
    const state1 = loadFleetState(fleetPath, accounts);
    const since1 = state1.fleet["ac08"].workshopSince!;

    sendTaxiToWorkshop("ac08", "Fault 2", fleetPath, accounts);
    const state2 = loadFleetState(fleetPath, accounts);
    const since2 = state2.fleet["ac08"].workshopSince!;

    assert.ok(
      since2 > since1,
      `Successive workshop events MUST have strictly increasing workshopSince: ${since2} > ${since1}`,
    );
  } finally {
    cleanupScratchDir(scratchDir);
  }
});

test("RULE 9: No repair while active lease exists on unit", () => {
  const scratchDir = createScratchDir("no-repair-active-lease");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");
  const accounts = ["ac09"];
  initFleetWithAccounts(fleetPath, accounts);

  try {
    sendTaxiToWorkshop("ac09", "Crash", fleetPath, accounts);

    // Corrupt unit to have an active passenger
    withFleetLock(fleetPath, () => {
      const state = loadFleetState(fleetPath, accounts);
      state.fleet["ac09"].passenger = {
        type: "ephemeral_subagent",
        sessionId: "sess-fake",
        pid: process.pid,
        taskLabel: "Ghost lease",
        startedAt: Date.now(),
        heartbeatAt: Date.now(),
      };
      saveFleetState(state, fleetPath);
    });

    const repaired = repairTaxiFromWorkshop("ac09", fleetPath, accounts);
    assert.equal(repaired, false, "Must reject repair when active lease is present");

    const stateAfter = loadFleetState(fleetPath, accounts);
    assert.equal(stateAfter.fleet["ac09"].status, "en_taller");
  } finally {
    cleanupScratchDir(scratchDir);
  }
});

test("RULE 10: Claude-only quota reading does not fabricate 100%", async () => {
  const scratchDir = createScratchDir("claude-only");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");
  const accounts = ["ac10", "ac11"];
  initFleetWithAccounts(fleetPath, accounts);

  try {
    sendTaxiToWorkshop("ac10", "Auth glitch", fleetPath, accounts);
    sendTaxiToWorkshop("ac11", "Auth glitch", fleetPath, accounts);

    const coordinator = new TaxiWorkshopCoordinator({
      fleetPath,
      allowedAccounts: accounts,
      probeDiagnostic: async (account) => {
        if (account === "ac10") {
          // Low Claude quota (3%) -> must NOT fabricate 100% -> must go to 'recargando'
          return makeDiagnosticResult("ac10", {
            gemini5hPct: null,
            geminiWeeklyPct: null,
            claude5hPct: 3,
            claudeWeeklyPct: 20,
            effectivePct: 3,
          });
        }
        // Sufficient Claude quota (45%) -> goes to 'libre'
        return makeDiagnosticResult("ac11", {
          gemini5hPct: null,
          geminiWeeklyPct: null,
          claude5hPct: 45,
          claudeWeeklyPct: 50,
          effectivePct: 45,
        });
      },
    });

    await coordinator.reconcileWorkshopUnits();

    const state = loadFleetState(fleetPath, accounts);
    assert.equal(
      state.fleet["ac10"].status,
      "recargando",
      "ac10 with 3% Claude MUST be 'recargando', never fabricated to 100% libre",
    );
    assert.equal(
      state.fleet["ac11"].status,
      "libre",
      "ac11 with 45% Claude MUST be 'libre'",
    );
  } finally {
    cleanupScratchDir(scratchDir);
  }
});

test("RULE 11: Reconcile removes repaired account from knownFatalAccounts set if provided in options", async () => {
  const scratchDir = createScratchDir("known-fatal-set");
  const fleetPath = path.join(scratchDir, "dc-taxis.json");
  const accounts = ["ac12"];
  initFleetWithAccounts(fleetPath, accounts);

  try {
    sendTaxiToWorkshop("ac12", "Fatal auth", fleetPath, accounts);
    const knownFatal = new Set<string>(["ac12"]);

    const coordinator = new TaxiWorkshopCoordinator({
      fleetPath,
      allowedAccounts: accounts,
      knownFatalAccounts: knownFatal,
      probeDiagnostic: async (account) => {
        return makeDiagnosticResult(account, {
          gemini5hPct: 80,
          geminiWeeklyPct: 90,
          effectivePct: 80,
        });
      },
    });

    const result = await coordinator.reconcileWorkshopUnits();

    assert.ok(result.repairedAccounts.includes("ac12"));
    assert.equal(knownFatal.has("ac12"), false, "ac12 must be removed from knownFatalAccounts on repair");
  } finally {
    cleanupScratchDir(scratchDir);
  }
});
