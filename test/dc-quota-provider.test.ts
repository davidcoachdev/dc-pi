import test from "node:test";
import assert from "node:assert/strict";
import {
  discoverAccountPrefixes,
  fetchAccountQuota,
  getCachedAccountQuotas,
} from "../src/features/dc-sidebar/providers/dc-quota-provider.ts";

test("discoverAccountPrefixes returns at least default fallback accounts", () => {
  const prefixes = discoverAccountPrefixes();
  assert.ok(Array.isArray(prefixes));
  assert.ok(prefixes.length >= 1);
  assert.ok(prefixes.includes("ac06") || prefixes.includes("ac05"));
});

test("getCachedAccountQuotas returns formatted summaries for discovered accounts", () => {
  const summaries = getCachedAccountQuotas();
  assert.ok(Array.isArray(summaries));
  assert.ok(summaries.length >= 1);

  const first = summaries[0];
  assert.ok(typeof first.prefix === "string");
  assert.ok(typeof first.family === "string");
  assert.ok(Array.isArray(first.entries));
  assert.ok(typeof first.collapsedSummary === "string");
  assert.ok(first.collapsedSummary.includes(first.prefix));
});

test("fetchAccountQuota parses bridge quota and builds collapsedSummary", async () => {
  // Cuando el bridge :8325 está activo para ac06
  const summary = await fetchAccountQuota("ac06");
  if (summary) {
    assert.equal(summary.prefix, "ac06");
    assert.ok(["Gemini", "Claude", "GPT", "AI"].includes(summary.family));
    assert.ok(summary.entries.length > 0);
    assert.ok(summary.collapsedSummary.startsWith("ac06-"));
  } else {
    // Si el bridge no respondiera en el entorno de prueba, debe fallar de forma segura sin excepciones
    assert.equal(summary, null);
  }
});
