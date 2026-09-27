import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { formatLocalDateIso, getContextDateString } from "../src/features/dc-date/core/dc-date-formatter.ts";
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

test("dcDateExtension hooks into session_start and before_agent_start to inject current date", () => {
  const handlers = new Map<string, Function>();

  const mockPi = {
    on(event: string, handler: Function) {
      handlers.set(event, handler);
    },
  } as unknown as ExtensionAPI;

  dcDateExtension(mockPi);

  assert.ok(handlers.has("session_start"));
  assert.ok(handlers.has("before_agent_start"));

  const beforeAgentHandler = handlers.get("before_agent_start")!;
  const event = { systemPrompt: "Initial system prompt." };
  const result = beforeAgentHandler(event);

  assert.ok(result?.systemPrompt);
  assert.ok(result.systemPrompt.includes("Initial system prompt."));
  assert.ok(result.systemPrompt.includes("Current date:"));
});
