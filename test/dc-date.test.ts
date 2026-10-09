import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { formatLocalDateIso, getContextDateString } from "../src/features/dc-date/core/dc-date-formatter.ts";
import {
  isGeminiModelCandidate as isGeminiModel,
  detectGeminiVersionLabel,
  buildDcHarnessPromptBlock,
  DC_UNIVERSAL_DIRECTIVES_MARKER,
  GEMINI_FRONTIER_PROTOCOL_MARKER,
} from "../src/features/dc-date/core/dc-frontier-directives.ts";
import { appendDcSystemPromptOnce } from "../src/core/dc-append-system-prompt.ts";
import dcDateExtension from "../src/features/dc-date/dc-date.ts";

test("dc-date: formatLocalDateIso returns YYYY-MM-DD", () => {
  const d = new Date(2026, 8, 25); // Sept 25, 2026
  assert.equal(formatLocalDateIso(d), "2026-09-25");
});

test("dc-date: getContextDateString includes day name and ISO date", () => {
  const d = new Date(2026, 8, 25); // Viernes
  const res = getContextDateString(d);
  assert.ok(res.includes("2026-09-25"));
  assert.ok(res.includes("Viernes"));
});

test("appendDcSystemPromptOnce appends idempotently without duplicating blocks", () => {
  const options = { appendSystemPrompt: "Existing harness block" };
  appendDcSystemPromptOnce(options, "Block A");
  assert.equal(options.appendSystemPrompt, "Existing harness block\n\nBlock A");

  // Second call with same block is a no-op
  appendDcSystemPromptOnce(options, "Block A");
  assert.equal(options.appendSystemPrompt, "Existing harness block\n\nBlock A");

  // Custom marker check prevents duplicate semantic sections
  appendDcSystemPromptOnce(options, "Block B v2", "Existing harness");
  assert.equal(options.appendSystemPrompt, "Existing harness block\n\nBlock A");
});

test("isGeminiModel and detectGeminiVersionLabel recognize Gemini 3.8, 3.7, 3.6, 3.5, 3.1, and 2.5", () => {
  assert.equal(isGeminiModel({ id: "ac03/gemini-3.8-flash-high" }, {}), true);
  assert.equal(detectGeminiVersionLabel({ id: "ac03/gemini-3.8-flash-high" }, {}), "Gemini 3.8");

  assert.equal(isGeminiModel({ id: "ac01/gemini-3.7-flash-high" }, {}), true);
  assert.equal(detectGeminiVersionLabel({ id: "ac01/gemini-3.7-flash-high" }, {}), "Gemini 3.7");

  assert.equal(isGeminiModel({ id: "ac01/gemini-3.6-flash-high" }, {}), true);
  assert.equal(detectGeminiVersionLabel({ id: "ac01/gemini-3.6-flash-high" }, {}), "Gemini 3.6");

  assert.equal(isGeminiModel({ id: "ac01/gemini-3.5-flash-lite" }, {}), true);
  assert.equal(detectGeminiVersionLabel({ id: "ac01/gemini-3.5-flash-lite" }, {}), "Gemini 3.5");

  assert.equal(isGeminiModel({ id: "ac01/gemini-3.1-pro-low" }, {}), true);
  assert.equal(detectGeminiVersionLabel({ id: "ac01/gemini-3.1-pro-low" }, {}), "Gemini 3.1");

  assert.equal(isGeminiModel({ id: "ac01/gemini-pro-agent" }, {}), true);
  assert.equal(detectGeminiVersionLabel({ id: "ac01/gemini-pro-agent" }, {}), "Gemini 3.x");

  // Fallback to PI_MODEL env var when ctx.model is undefined
  assert.equal(isGeminiModel(undefined, { PI_MODEL: "cpam/ac02/gemini-3.7-flash-high" }), true);
  assert.equal(detectGeminiVersionLabel(undefined, { PI_MODEL: "cpam/ac02/gemini-3.7-flash-high" }), "Gemini 3.7");

  // Non-Gemini models return false
  assert.equal(isGeminiModel({ id: "ac01/claude-opus-4-6-thinking" }, { PI_MODEL: "" }), false);
  assert.equal(isGeminiModel({ id: "ac01/gpt-oss-120b-medium" }, { PI_MODEL: "" }), false);
});

test("buildDcHarnessPromptBlock builds universal directives + Gemini protocol for 3.1, 3.7, and 3.8", () => {
  const block37 = buildDcHarnessPromptBlock({
    dateString: "2026-10-09 (Viernes)",
    model: { id: "ac01/gemini-3.7-flash-high" },
    env: {},
  });

  assert.ok(block37.includes("Current date: 2026-10-09 (Viernes)."));
  assert.ok(block37.includes(DC_UNIVERSAL_DIRECTIVES_MARKER));
  assert.ok(block37.includes("KISS & YAGNI"));
  assert.ok(block37.includes("--no-ff"));
  assert.ok(block37.includes(GEMINI_FRONTIER_PROTOCOL_MARKER));
  assert.ok(block37.includes("Gemini 3.7"));
  assert.ok(block37.includes("Malformed_Function_Call"));

  const block31 = buildDcHarnessPromptBlock({
    dateString: "2026-10-09 (Viernes)",
    model: { id: "ac01/gemini-3.1-pro-low" },
    env: {},
  });
  assert.ok(block31.includes("Gemini 3.1"));
  assert.ok(block31.includes(GEMINI_FRONTIER_PROTOCOL_MARKER));

  // Non-Gemini model gets universal directives + date, without Gemini-specific block
  const blockClaude = buildDcHarnessPromptBlock({
    dateString: "2026-10-09 (Viernes)",
    model: { id: "ac01/claude-opus-4-6-thinking" },
    env: { PI_MODEL: "" },
  });
  assert.ok(blockClaude.includes(DC_UNIVERSAL_DIRECTIVES_MARKER));
  assert.ok(!blockClaude.includes(GEMINI_FRONTIER_PROTOCOL_MARKER));

  // Subagent child (GENTLE_PI_AGENTS_CHILD=1) gets only Current date to keep context thin
  const blockChild = buildDcHarnessPromptBlock({
    dateString: "2026-10-09 (Viernes)",
    model: { id: "ac03/gemini-3.8-flash-high" },
    env: { GENTLE_PI_AGENTS_CHILD: "1" },
  });
  assert.equal(blockChild, "Current date: 2026-10-09 (Viernes).");
});

test("dcDateExtension injects into systemPromptOptions.appendSystemPrompt like gentle-ai and keeps legacy fallback", () => {
  const handlers = new Map<string, Function>();

  const mockPi = {
    on(event: string, handler: Function) {
      handlers.set(event, handler);
    },
  } as unknown as ExtensionAPI;

  dcDateExtension(mockPi, { PI_MODEL: "ac03/gemini-3.8-flash-high" });

  assert.ok(handlers.has("session_start"));
  assert.ok(handlers.has("before_agent_start"));

  const beforeAgentHandler = handlers.get("before_agent_start")!;

  // 1. Modern gentle-ai style: event.systemPromptOptions
  const options = { appendSystemPrompt: "Gentle AI base prompt" };
  const modernEvent = { systemPromptOptions: options };
  const ctx = { model: { id: "ac01/gemini-3.7-flash-high" } } as unknown as ExtensionContext;

  const modernResult = beforeAgentHandler(modernEvent, ctx);
  assert.equal(modernResult, undefined);
  assert.ok(options.appendSystemPrompt.includes("Gentle AI base prompt"));
  assert.ok(options.appendSystemPrompt.includes("Current date:"));
  assert.ok(options.appendSystemPrompt.includes(DC_UNIVERSAL_DIRECTIVES_MARKER));
  assert.ok(options.appendSystemPrompt.includes(GEMINI_FRONTIER_PROTOCOL_MARKER));
  assert.ok(options.appendSystemPrompt.includes("Gemini 3.7"));

  // Idempotent on second call
  const snapshotAfterFirst = options.appendSystemPrompt;
  beforeAgentHandler(modernEvent, ctx);
  assert.equal(options.appendSystemPrompt, snapshotAfterFirst);

  // 2. Legacy fallback: event.systemPrompt without systemPromptOptions
  const legacyEvent = { systemPrompt: "Initial system prompt." };
  const legacyResult = beforeAgentHandler(legacyEvent, ctx);
  assert.ok(legacyResult?.systemPrompt);
  assert.ok(legacyResult.systemPrompt.includes("Initial system prompt."));
  assert.ok(legacyResult.systemPrompt.includes("Current date:"));
  assert.ok(legacyResult.systemPrompt.includes(DC_UNIVERSAL_DIRECTIVES_MARKER));
});
