import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { dcContext7Client } from "../src/features/dc-context7/core/dc-context7-client.ts";
import dcContext7Extension from "../src/features/dc-context7/dc-context7.ts";

test("dc-context7 client: getStatus detects absence or presence of key gracefully", () => {
  const status = dcContext7Client.getStatus();
  assert.equal(typeof status.configured, "boolean");
  assert.equal(typeof status.hasApiKey, "boolean");
});

test("dcContext7Extension registers tools and command /dc-context7", () => {
  const registeredTools: string[] = [];
  const registeredCommands: string[] = [];

  const mockPi = {
    registerTool(tool: { name: string }) {
      registeredTools.push(tool.name);
    },
    registerCommand(name: string) {
      registeredCommands.push(name);
    },
  } as unknown as ExtensionAPI;

  dcContext7Extension(mockPi);

  assert.ok(registeredTools.includes("dc_context7_status"));
  assert.ok(registeredTools.includes("dc_context7_search"));
  assert.ok(registeredTools.includes("dc_context7_get_context"));
  assert.ok(registeredCommands.includes("dc-context7"));
});
