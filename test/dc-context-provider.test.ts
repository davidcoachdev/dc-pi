import test from "node:test";
import assert from "node:assert/strict";
import {
  formatTokenCount,
  getContextUsageInfo,
} from "../src/features/dc-sidebar/providers/dc-context-provider.ts";

test("formatTokenCount correctly formats tokens", () => {
  assert.equal(formatTokenCount(500), "500");
  assert.equal(formatTokenCount(1200), "1k");
  assert.equal(formatTokenCount(25400), "25k");
  assert.equal(formatTokenCount(1000000), "1M");
  assert.equal(formatTokenCount(35700000), "35.7M");
});

test("getContextUsageInfo returns valid structure and default fallbacks", () => {
  const info = getContextUsageInfo();
  assert.ok(typeof info.tokensUsed === "number");
  assert.ok(typeof info.totalWindow === "number");
  assert.ok(typeof info.pct === "number");
  assert.ok(["Óptimo", "Medio", "Alto", "Crítico"].includes(info.stateLabel));
  assert.ok(typeof info.tokStr === "string");
  assert.ok(typeof info.winStr === "string");
  assert.ok(typeof info.inStr === "string");
  assert.ok(typeof info.outStr === "string");
  assert.ok(typeof info.costStr === "string");
  assert.ok(info.costStr.startsWith("$"));
});
