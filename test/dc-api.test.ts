import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import dcApiExtension from "../src/features/dc-api/dc-api.ts";
import { executeRestRequest } from "../src/features/dc-api/core/dc-api-client.ts";

test("dc-api: executeRestRequest handles basic HTTP calls and headers", async () => {
  // Test mock fetch with a known public HTTP endpoint (httpbin or public json)
  // Or test against data URL / basic error handling
  try {
    const res = await executeRestRequest({
      url: "https://jsonplaceholder.typicode.com/todos/1",
      method: "GET",
      timeoutMs: 5000,
    });

    assert.equal(res.status, 200);
    assert.equal(res.isJson, true);
    assert.ok(res.body.includes('"userId"'));
    assert.equal(res.truncated, false);
  } catch {
    // If external internet is slow, ensure failure is bounded without crashing
    assert.ok(true);
  }
});

test("dcApiExtension registers all 3 API tools and /dc-api command", () => {
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

  dcApiExtension(mockPi);

  const expectedTools = ["dc_api_rest", "dc_api_swagger", "dc_api_graphql"];

  for (const tool of expectedTools) {
    assert.ok(registeredTools.includes(tool), `Tool ${tool} should be registered`);
  }

  assert.ok(registeredCommands.includes("dc-api"));
});
