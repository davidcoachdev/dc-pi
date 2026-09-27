import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { normalizeCdpUrl, getCdpStatus } from "../src/features/dc-browser/core/dc-browser-cdp.ts";
import dcBrowserExtension from "../src/features/dc-browser/dc-browser.ts";

test("dc-browser: normalizeCdpUrl handles defaults and custom ports cleanly", () => {
  assert.equal(normalizeCdpUrl(), "http://127.0.0.1:9222");
  assert.equal(normalizeCdpUrl("http://localhost:9222/"), "http://localhost:9222");
  assert.equal(normalizeCdpUrl("http://192.168.1.50:9333"), "http://192.168.1.50:9333");
});

test("dc-browser: getCdpStatus fails gracefully when Chrome is not running", async () => {
  // Con un puerto cerrado debe retornar connected: false sin crashear el proceso
  const status = await getCdpStatus("http://127.0.0.1:59999");
  assert.equal(status.connected, false);
  assert.equal(status.pageTargetCount, 0);
  assert.ok(status.warnings.length > 0);
});

test("dcBrowserExtension registers 4 browser tools and command /dc-browser", () => {
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

  dcBrowserExtension(mockPi);

  const expectedTools = [
    "dc_browser_status",
    "dc_browser_tabs",
    "dc_browser_navigate",
    "dc_browser_screenshot",
  ];

  for (const tool of expectedTools) {
    assert.ok(registeredTools.includes(tool), `Tool ${tool} should be registered`);
  }

  assert.ok(registeredCommands.includes("dc-browser"));
});
