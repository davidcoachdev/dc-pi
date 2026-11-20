import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { DcTaxiLedgerDb } from "../src/features/dc-agents/core/dc-taxi-ledger-db.ts";
import { getDcTaxisPaths, getDcSentinelPaths, getDcSidebarPaths, getDcAgentsPaths } from "../src/core/dc-paths.ts";
import { isProviderAuthError, sanitizeWorkshopReason } from "../src/features/dc-agents/dc-agents.ts";

describe("dc-paths storage hierarchy", () => {
  it("debe retornar rutas estructuradas por subsistema", () => {
    const taxis = getDcTaxisPaths();
    assert.ok(taxis.dir.endsWith("/taxis"));
    assert.ok(taxis.fleetState.endsWith("/taxis/fleet.json"));
    assert.ok(taxis.ledgerDb.endsWith("/taxis/ledger.db"));

    const sentinel = getDcSentinelPaths();
    assert.ok(sentinel.dir.endsWith("/sentinel"));
    assert.ok(sentinel.catalogueDb.endsWith("/sentinel/catalogue.db"));
    assert.ok(sentinel.sessionsDir.endsWith("/sentinel/sessions"));

    const sidebar = getDcSidebarPaths();
    assert.ok(sidebar.dir.endsWith("/sidebar"));
    assert.ok(sidebar.state.endsWith("/sidebar/sidebar.json"));

    const agents = getDcAgentsPaths();
    assert.ok(agents.dir.endsWith("/agents"));
    assert.ok(agents.worktreesDir.endsWith("/agents/worktrees"));
  });
});

describe("dc-taxi-ledger-db (node:sqlite)", () => {
  it("debe registrar eventos y viajes, y consolidar resumen de cuenta", () => {
    const ledger = new DcTaxiLedgerDb(":memory:");

    // Registrar eventos de taller
    ledger.recordEvent({
      account: "ac45",
      eventType: "workshop_enter",
      reason: "Violacion ToS",
      timestamp: 1000,
    });

    ledger.recordEvent({
      account: "ac45",
      eventType: "workshop_exit",
      timestamp: 2000,
    });

    // Registrar viajes
    ledger.recordTrip({
      tripId: "trip-1",
      account: "ac45",
      passengerType: "orchestrator",
      model: "gemini-3.8-flash-high",
      sessionId: "sess-1",
      startedAt: 3000,
      endedAt: 5000,
      durationMs: 2000,
      status: "completed",
      inputTokens: 100,
      outputTokens: 50,
      reasoningTokens: 25,
      costEstimated: 0.002,
    });

    ledger.recordTrip({
      tripId: "trip-2",
      account: "ac45",
      passengerType: "ephemeral_subagent",
      model: "gemini-3.8-flash-high",
      sessionId: "sess-2",
      startedAt: 6000,
      endedAt: 7000,
      durationMs: 1000,
      status: "failed",
      error: "403: TOS_VIOLATION",
      inputTokens: 10,
      outputTokens: 0,
      reasoningTokens: 0,
      costEstimated: 0.0001,
    });

    const summary = ledger.getAccountSummary("ac45");
    assert.equal(summary.account, "ac45");
    assert.equal(summary.totalTrips, 2);
    assert.equal(summary.completedTrips, 1);
    assert.equal(summary.failedTrips, 1);
    assert.equal(summary.totalInputTokens, 110);
    assert.equal(summary.totalOutputTokens, 50);
    assert.equal(summary.totalReasoningTokens, 25);
    assert.equal(summary.totalTokens, 185);
    assert.equal(summary.workshopEntries, 1);
    assert.equal(summary.lastWorkshopReason, "Violacion ToS");
    assert.equal(summary.successRate, 50);

    const events = ledger.getRecentAccountEvents("ac45", 5);
    assert.equal(events.length, 2);
    assert.equal(events[0].eventType, "workshop_exit");
    assert.equal(events[1].eventType, "workshop_enter");

    const ranked = ledger.getAllAccountsRankedByCost(10);
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0].account, "ac45");
    assert.ok(ranked[0].totalCost > 0);

    ledger.close();
  });
});

describe("TOS_VIOLATION canonical classification", () => {
  it("debe clasificar TOS_VIOLATION como 'Violacion ToS'", () => {
    const rawError = '403: {"code":403,"reason":"TOS_VIOLATION","message":"Terms of Service violation"}';
    assert.equal(sanitizeWorkshopReason(rawError), "Violacion ToS");
    assert.equal(sanitizeWorkshopReason("Violation of Terms of Service"), "Violacion ToS");
    assert.equal(isProviderAuthError(rawError), true);
    assert.equal(isProviderAuthError("Terms of Service disabled"), true);
  });
});
