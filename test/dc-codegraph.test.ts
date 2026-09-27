import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getCodeGraphStatus } from "../src/features/dc-codegraph/core/dc-codegraph-engine.ts";
import dcCodegraphExtension from "../src/features/dc-codegraph/dc-codegraph.ts";

test("dc-codegraph: getCodeGraphStatus returns status structure without crashing", async () => {
  const status = await getCodeGraphStatus(process.cwd());
  assert.equal(typeof status.indexed, "boolean");
  assert.equal(typeof status.isGitRepo, "boolean");
  assert.ok(status.projectRoot);
  assert.ok(typeof status.rawText === "string");
});

test("dcCodegraphExtension registers all 5 tools and /dc-codegraph command", () => {
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

  dcCodegraphExtension(mockPi);

  const expectedTools = [
    "dc_codegraph_status",
    "dc_codegraph_node",
    "dc_codegraph_impact",
    "dc_codegraph_explore",
    "dc_codegraph_sync",
  ];

  for (const tool of expectedTools) {
    assert.ok(registeredTools.includes(tool), `Tool ${tool} should be registered`);
  }

  assert.ok(registeredCommands.includes("dc-codegraph"));
});
