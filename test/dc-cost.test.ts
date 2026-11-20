import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { DcTaxiLedgerDb } from "../src/features/dc-agents/core/dc-taxi-ledger-db.ts";

describe("dc-cost ranking and analytics", () => {
  it("debe calcular correctamente el ranking de mayor a menor costo con múltiples cuentas", () => {
    const ledger = new DcTaxiLedgerDb(":memory:");

    // Viajes ac01
    ledger.recordTrip({
      tripId: "t-ac01-1",
      account: "ac01",
      passengerType: "orchestrator",
      model: "gemini-3.8-flash-high",
      sessionId: "s1",
      startedAt: 1000,
      endedAt: 2000,
      durationMs: 1000,
      status: "completed",
      inputTokens: 500,
      outputTokens: 200,
      reasoningTokens: 100,
      costEstimated: 0.005,
    });

    // Viajes ac02 (más costoso)
    ledger.recordTrip({
      tripId: "t-ac02-1",
      account: "ac02",
      passengerType: "ephemeral_subagent",
      model: "gemini-3.8-flash-high",
      sessionId: "s2",
      startedAt: 2000,
      endedAt: 5000,
      durationMs: 3000,
      status: "completed",
      inputTokens: 2000,
      outputTokens: 800,
      reasoningTokens: 400,
      costEstimated: 0.025,
    });

    // Viajes ac03 (con fallo)
    ledger.recordTrip({
      tripId: "t-ac03-1",
      account: "ac03",
      passengerType: "ephemeral_subagent",
      model: "gemini-3.8-flash-high",
      sessionId: "s3",
      startedAt: 6000,
      endedAt: 6500,
      durationMs: 500,
      status: "failed",
      error: "403: TOS_VIOLATION",
      inputTokens: 50,
      outputTokens: 0,
      costEstimated: 0.0001,
    });

    const ranked = ledger.getAllAccountsRankedByCost(10);
    assert.equal(ranked.length, 3);

    // Debe ordenar de mayor a menor costo
    assert.equal(ranked[0].account, "ac02");
    assert.equal(ranked[0].totalCost, 0.025);
    assert.equal(ranked[0].totalTokens, 3200);
    assert.equal(ranked[0].failedTrips, 0);

    assert.equal(ranked[1].account, "ac01");
    assert.equal(ranked[1].totalCost, 0.005);
    assert.equal(ranked[1].totalTokens, 800);

    assert.equal(ranked[2].account, "ac03");
    assert.equal(ranked[2].failedTrips, 1);

    ledger.close();
  });
});
