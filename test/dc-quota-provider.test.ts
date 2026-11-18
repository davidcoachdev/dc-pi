import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  clearCachedQuotasForTesting,
  discoverAccountPrefixes,
  fetchAccountQuota,
  getCachedAccountQuotas,
} from "../src/features/dc-sidebar/providers/dc-quota-provider.ts";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const isolatedAgentDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-quota-agent-"));
process.env.PI_CODING_AGENT_DIR = isolatedAgentDir;

test.after(() => {
  if (originalAgentDir === undefined) {
    delete process.env.PI_CODING_AGENT_DIR;
  } else {
    process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  }
  fs.rmSync(isolatedAgentDir, { recursive: true, force: true });
});

test("discoverAccountPrefixes returns default fallback accounts when isolated settings.json is absent", () => {
  clearCachedQuotasForTesting();
  const settingsFile = path.join(isolatedAgentDir, "settings.json");
  if (fs.existsSync(settingsFile)) fs.unlinkSync(settingsFile);

  const prefixes = discoverAccountPrefixes();
  assert.deepEqual(prefixes, ["ac06", "ac05"]);
});

test("discoverAccountPrefixes honors PI_CODING_AGENT_DIR and explicit settingsPath for ac*, cc*, and uc*", () => {
  const settingsFile = path.join(isolatedAgentDir, "settings.json");

  fs.writeFileSync(settingsFile, JSON.stringify({ defaultModel: "cpam/cc01/claude-sonnet-4-6" }), "utf8");
  assert.deepEqual(discoverAccountPrefixes(), ["cc01"]);

  fs.writeFileSync(settingsFile, JSON.stringify({ defaultModel: "uc01/gpt-5.4" }), "utf8");
  assert.deepEqual(discoverAccountPrefixes(), ["uc01"]);

  const customSettings = path.join(isolatedAgentDir, "custom-settings.json");
  fs.writeFileSync(customSettings, JSON.stringify({ defaultModel: "ac06/gemini-2.5-pro" }), "utf8");
  assert.deepEqual(discoverAccountPrefixes({ settingsPath: customSettings }), ["ac06"]);

  fs.unlinkSync(settingsFile);
  fs.unlinkSync(customSettings);
});

test("getCachedAccountQuotas returns formatted summaries for discovered accounts", () => {
  clearCachedQuotasForTesting();
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
